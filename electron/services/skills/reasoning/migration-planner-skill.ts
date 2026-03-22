import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const MIGRATION_KEYWORDS = [
  'migrate', 'migration', 'upgrade', 'schema change', 'database migration',
  'api version', 'breaking change', 'backwards compatible', 'rollback',
  'version upgrade', 'framework upgrade'
]

type MigrationType = 'database' | 'api' | 'framework' | 'general'

function detectMigrationType(query: string): MigrationType {
  const lower = query.toLowerCase()
  if (/\b(schema|table|column|database|db|sql|migration file|alter)\b/.test(lower)) return 'database'
  if (/\b(endpoint|api version|route|rest|graphql|breaking api)\b/.test(lower)) return 'api'
  if (/\b(package|upgrade|framework|react|next|vue|angular|django|rails)\b/.test(lower)) return 'framework'
  return 'general'
}

const SEARCH_QUERIES: Record<MigrationType, string[]> = {
  database: ['schema migration database model', 'CREATE TABLE ALTER TABLE'],
  api: ['api route endpoint controller handler', 'REST GraphQL version'],
  framework: ['package.json dependencies config', 'framework configuration'],
  general: ['migration config schema version']
}

async function callLLM(systemPrompt: string, userContent: string, temperature: number = 0.2): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false,
      temperature,
      max_tokens: 4096
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

export function createMigrationPlannerSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'migration-planner',
    version: '4.0.0',
    category: 'reasoning',
    priority: 'p1',
    description: 'Plans database migrations, API version migrations, and framework upgrades with rollback strategies',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return MIGRATION_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const migrationType = detectMigrationType(input.query)
        const searchQueries = SEARCH_QUERIES[migrationType]

        const searchResults = await Promise.allSettled(
          searchQueries.map(q => hybridSearch(input.projectId, q, 8))
        )

        const codeContext = searchResults
          .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof hybridSearch>>> => r.status === 'fulfilled')
          .flatMap(r => r.value)
          .slice(0, 15)
          .map(c => `${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}):\n${c.content}`)
          .join('\n\n---\n\n')

        const analysis = await callLLM(
          `You are a migration analysis expert specializing in ${migrationType} migrations.
Analyze the current codebase state and the user's migration request.
Identify: current state, target state, risks, breaking changes, data integrity concerns, affected components.
Be specific — reference actual files and code from the context.`,
          `Migration request: ${input.query}\n\nType: ${migrationType}\n\n=== CURRENT CODEBASE ===\n${codeContext}`
        )

        const plan = await callLLM(
          `You are a migration planning expert. Based on the analysis provided, generate a detailed migration plan.

OUTPUT FORMAT:
# Migration Plan: [Title]

## Type: ${migrationType}
## Risk Level: [LOW/MEDIUM/HIGH]

## Pre-Migration Checklist
- [ ] ...

## Migration Steps
### Step 1: ...
- Action: ...
- SQL/Code: ...
- Verification: ...

### Step 2: ...

## Rollback Strategy
### If failure at Step N:
- ...

## Post-Migration Verification
1. ...

## Estimated Timeline
- Preparation: ...
- Execution: ...
- Verification: ...

## Dependencies & Blockers
- ...`,
          `Migration request: ${input.query}\n\n=== ANALYSIS ===\n${analysis}\n\n=== CODEBASE CONTEXT ===\n${codeContext}`,
          0.3
        )

        const riskLevel = /HIGH/i.test(plan) ? 'high' : /MEDIUM/i.test(plan) ? 'medium' : 'low'
        const stepsMatch = plan.match(/### Step \d+/g)

        updateMetrics(Date.now() - start, true)
        return {
          content: plan,
          metadata: {
            migrationType,
            stepsCount: stepsMatch?.length || 0,
            riskLevel,
            analysisLength: analysis.length
          },
          suggestedFollowups: [
            'Generate the migration files',
            'Review rollback strategy in detail',
            'Estimate migration downtime'
          ]
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
