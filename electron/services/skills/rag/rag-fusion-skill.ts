/**
 * RAG Fusion Skill — Multi-query with Reciprocal Rank Fusion
 */
import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch, type SearchResult } from '../../vector-search'

export function createRAGFusionSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  return {
    name: 'rag-fusion',
    version: '4.0.0',
    category: 'rag',
    priority: 'p0',
    description: 'Multi-query RAG with Reciprocal Rank Fusion for complex queries',
    dependencies: [],
    async initialize(_config: SkillConfig) {},
    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return lower.includes('comprehensive') || lower.includes('thorough') ||
        lower.includes('detailed') || input.query.split(' ').length > 10
    },
    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const variants = generateQueryVariants(input.query, 3)
        const resultSets = await Promise.all(
          variants.map(q => hybridSearch(input.projectId, q, 10))
        )
        const fused = reciprocalRankFusion(resultSets)
        const content = fused.slice(0, 10).map(r =>
          `**${r.relativePath}** (${r.chunkType}${r.name ? ': ' + r.name : ''})\n\`\`\`${r.language}\n${r.content.slice(0, 500)}\n\`\`\``
        ).join('\n\n')
        metrics.totalCalls++; metrics.successCount++
        metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + (Date.now() - start)) / metrics.totalCalls
        metrics.lastUsed = Date.now()
        return { content: content || 'No results found.', metadata: { variants, fusedCount: fused.length } }
      } catch (err) { metrics.totalCalls++; metrics.errorCount++; throw err }
    },
    async shutdown() {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics() { return { ...metrics } }
  }
}

export function generateQueryVariants(query: string, n: number = 3): string[] {
  const variants = [query]
  const words = query.split(' ')
  if (n >= 2 && words.length > 3) {
    variants.push(words.slice(0, Math.ceil(words.length / 2)).join(' '))
  }
  if (n >= 3) {
    const keywords = words.filter(w => w.length > 4)
    if (keywords.length > 0) variants.push(keywords.join(' '))
  }
  return variants.slice(0, n)
}

export function reciprocalRankFusion(resultSets: SearchResult[][], k: number = 60): SearchResult[] {
  const scores = new Map<string, { score: number, result: SearchResult }>()

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank]
      const existing = scores.get(r.chunkId)
      const rrfScore = 1 / (k + rank + 1)
      if (existing) {
        existing.score += rrfScore
      } else {
        scores.set(r.chunkId, { score: rrfScore, result: r })
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }))
}