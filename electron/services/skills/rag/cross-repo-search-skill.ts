import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { embedQuery } from '../../embedder'
import { hybridSearch } from '../../vector-search'

const CROSS_REPO_KEYWORDS = ['across repo', 'cross repo', 'all repo', 'multi repo', 'search repo', 'frontend backend', 'which repo', 'every repo']

interface RepoInfo {
  id: string
  source_path: string
  source_type: string
  total_files: number
  total_chunks: number
}

interface RepoSearchResult {
  repoId: string
  repoPath: string
  chunkId: string
  score: number
  content: string
  relativePath: string
  language: string
  chunkType: string
  name: string | null
  lineStart: number
  lineEnd: number
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i] }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function bufferToFloatArray(buffer: Buffer): number[] {
  if (!buffer || buffer.length === 0) return []
  const f32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  return Array.from(f32)
}

function getRepos(projectId: string): RepoInfo[] {
  const db = getDb()
  return db.prepare(
    'SELECT id, source_path, source_type, total_files, total_chunks FROM repositories WHERE project_id = ?'
  ).all(projectId) as RepoInfo[]
}

async function searchRepo(projectId: string, repoId: string, queryEmbedding: number[], topK: number): Promise<RepoSearchResult[]> {
  const db = getDb()
  const chunks = db.prepare(
    `SELECT id, content, relative_path, language, chunk_type, name, line_start, line_end, embedding
     FROM chunks WHERE project_id = ? AND repo_id = ? AND embedding IS NOT NULL`
  ).all(projectId, repoId) as Array<{
    id: string; content: string; relative_path: string; language: string
    chunk_type: string; name: string | null; line_start: number; line_end: number; embedding: Buffer
  }>

  return chunks
    .map(chunk => ({
      repoId,
      repoPath: '',
      chunkId: chunk.id,
      score: cosineSimilarity(queryEmbedding, bufferToFloatArray(chunk.embedding)),
      content: chunk.content,
      relativePath: chunk.relative_path,
      language: chunk.language,
      chunkType: chunk.chunk_type,
      name: chunk.name,
      lineStart: chunk.line_start,
      lineEnd: chunk.line_end
    }))
    .filter(r => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export function createCrossRepoSearchSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'cross-repo-search',
    version: '4.0.0',
    category: 'rag',
    priority: 'p0',
    description: 'Multi-repo scoped search — searches each repo independently and merges results with repo context',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return CROSS_REPO_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const repos = getRepos(input.projectId)

        if (repos.length <= 1) {
          const results = await hybridSearch(input.projectId, input.query, 10)
          const content = results
            .map(c => `**${c.relativePath}** (${c.chunkType}${c.name ? ': ' + c.name : ''}) L${c.lineStart}-${c.lineEnd}\n\`\`\`${c.language}\n${c.content}\n\`\`\``)
            .join('\n\n')
          updateMetrics(Date.now() - start, true)
          return { content: content || 'No results found.', metadata: { reposSearched: 1, totalResults: results.length } }
        }

        const queryEmbedding = await embedQuery(input.query)
        if (queryEmbedding.length === 0) {
          throw new Error('Failed to embed query')
        }

        const repoResults = await Promise.allSettled(
          repos.map(repo => searchRepo(input.projectId, repo.id, queryEmbedding, 8))
        )

        const allResults: RepoSearchResult[] = []
        const repoPathMap = new Map<string, string>()
        for (const repo of repos) {
          repoPathMap.set(repo.id, repo.source_path)
        }

        for (let i = 0; i < repoResults.length; i++) {
          const result = repoResults[i]
          if (result.status === 'fulfilled') {
            for (const r of result.value) {
              r.repoPath = repoPathMap.get(r.repoId) || ''
              allResults.push(r)
            }
          }
        }

        allResults.sort((a, b) => b.score - a.score)
        const topResults = allResults.slice(0, 15)

        const grouped = new Map<string, RepoSearchResult[]>()
        for (const r of topResults) {
          const repoName = r.repoPath.split('/').pop() || r.repoId
          const existing = grouped.get(repoName) || []
          existing.push(r)
          grouped.set(repoName, existing)
        }

        const sections: string[] = []
        const repoNames = Array.from(grouped.keys())
        for (const repoName of repoNames) {
          const results = grouped.get(repoName)!
          sections.push(`## 📁 ${repoName}\n`)
          for (const r of results) {
            sections.push(
              `**${r.relativePath}** (${r.chunkType}${r.name ? ': ' + r.name : ''}) score: ${r.score.toFixed(3)}\n\`\`\`${r.language}\n${r.content}\n\`\`\`\n`
            )
          }
        }

        const resultsByRepo: Record<string, number> = {}
        for (const repoName of repoNames) {
          resultsByRepo[repoName] = grouped.get(repoName)!.length
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: sections.join('\n') || 'No results found across repos.',
          metadata: {
            reposSearched: repos.length,
            totalResults: topResults.length,
            resultsByRepo
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},

    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}
