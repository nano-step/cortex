import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const CONTRACT_KEYWORDS = [
  'api contract', 'api schema', 'endpoint', 'api validation',
  'request schema', 'response schema', 'openapi', 'swagger',
  'rest api', 'api mismatch', 'contract test'
]

interface ApiChunk {
  content: string
  relative_path: string
  name: string | null
  chunk_type: string
  repo_id: string
}

interface RepoRow {
  id: string
  source_path: string
}

function findApiChunks(projectId: string): ApiChunk[] {
  const db = getDb()
  return db.prepare(
    `SELECT content, relative_path, name, chunk_type, repo_id FROM chunks
     WHERE project_id = ? AND (
       content LIKE '%router%' OR content LIKE '%fetch(%' OR content LIKE '%axios%'
       OR content LIKE '%endpoint%' OR content LIKE '%app.get%' OR content LIKE '%app.post%'
       OR relative_path LIKE '%api%' OR relative_path LIKE '%route%'
       OR relative_path LIKE '%controller%' OR relative_path LIKE '%handler%'
     )
     LIMIT 40`
  ).all(projectId) as ApiChunk[]
}

function getRepos(projectId: string): RepoRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT id, source_path FROM repositories WHERE project_id = ?'
  ).all(projectId) as RepoRow[]
}

export function createApiContractSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'api-contract',
    version: '4.0.0',
    category: 'code',
    priority: 'p1',
    description: 'Validates API contracts between frontend and backend repos by analyzing endpoints and schemas',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return CONTRACT_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const repos = getRepos(input.projectId)
        const apiChunks = findApiChunks(input.projectId)
        const searchResults = await hybridSearch(input.projectId, input.query, 10).catch(() => [])

        if (apiChunks.length === 0 && searchResults.length === 0) {
          return { content: 'No API-related code found in the project.' }
        }

        const repoPathMap = new Map<string, string>()
        for (const repo of repos) {
          repoPathMap.set(repo.id, repo.source_path.split('/').pop() || repo.id)
        }

        const chunksWithRepo = apiChunks.map(c => ({
          ...c,
          repoName: repoPathMap.get(c.repo_id) || 'unknown'
        }))

        const apiContext = chunksWithRepo
          .map(c => `[${c.repoName}] ${c.relative_path} (${c.chunk_type}${c.name ? ': ' + c.name : ''}):\n${c.content.slice(0, 800)}`)
          .join('\n\n---\n\n')

        const additionalContext = searchResults
          .map(r => `${r.relativePath}: ${r.content.slice(0, 500)}`)
          .join('\n\n')

        const messages = [
          {
            role: 'system',
            content: `You are an API contract validator. Analyze code from multiple repositories to validate API contracts.

ANALYSIS:
1. **Backend endpoints**: List all API endpoints exposed (method, path, request/response types)
2. **Frontend API calls**: List all API calls made (method, URL, expected request/response)
3. **Contract mismatches**: Compare backend endpoints with frontend calls and identify:
   - Missing endpoints (frontend calls endpoint that doesn't exist)
   - Schema mismatches (different field names, types, or structures)
   - Missing error handling on frontend for backend error responses
   - Inconsistent naming between repos
4. **Type safety**: Are request/response types shared or duplicated?
5. **Versioning**: Is there API versioning? Are versions consistent?

OUTPUT FORMAT:
# API Contract Validation Report

## Endpoints Discovered
### Backend ([repo name])
| Method | Path | Request Type | Response Type |
|--------|------|-------------|---------------|

### Frontend ([repo name])
| Method | URL | Expected Request | Expected Response |
|--------|-----|-----------------|-------------------|

## ⚠️ Contract Mismatches
| # | Type | Backend | Frontend | Severity | Fix |
|---|------|---------|----------|----------|-----|

## ✅ Validated Contracts
| Endpoint | Status |
|----------|--------|

## Recommendations
1. ...`
          },
          {
            role: 'user',
            content: `${input.query}\n\n=== API CODE (by repo) ===\n${apiContext}\n\n=== ADDITIONAL CONTEXT ===\n${additionalContext}`
          }
        ]

        const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
          body: JSON.stringify({ model: 'gemini-2.5-flash', messages, stream: false, temperature: 0.1, max_tokens: 4096 })
        })

        if (!response.ok) throw new Error(`LLM error: ${response.status}`)

        const data = await response.json() as { choices: Array<{ message: { content: string } }> }
        const content = data.choices?.[0]?.message?.content || 'Validation failed.'

        const mismatchCount = (content.match(/Mismatch|⚠️/g) || []).length

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: {
            reposAnalyzed: repos.length,
            apiChunksFound: apiChunks.length,
            mismatches: mismatchCount
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
