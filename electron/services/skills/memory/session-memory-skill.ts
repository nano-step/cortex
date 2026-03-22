import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { getProxyUrl, getProxyKey } from '../../settings-service'

async function callLLM(systemPrompt: string, userContent: string, maxTokens: number = 2048): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false, temperature: 0.1, max_tokens: maxTokens
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

function initSessionMemorySchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_insights (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      insight_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source_query TEXT,
      confidence REAL DEFAULT 0.8,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_insights_project ON session_insights(project_id);
    CREATE INDEX IF NOT EXISTS idx_insights_type ON session_insights(insight_type);
  `)
}

interface SessionInsight {
  id: string
  project_id: string
  insight_type: string
  content: string
  confidence: number
  access_count: number
  created_at: number
}

function searchInsights(projectId: string, query: string, limit: number = 10): SessionInsight[] {
  const db = getDb()
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (keywords.length === 0) {
    return db.prepare('SELECT * FROM session_insights WHERE project_id = ? ORDER BY last_accessed DESC, access_count DESC LIMIT ?').all(projectId, limit) as SessionInsight[]
  }

  const likeConditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ')
  const params = keywords.map(k => `%${k}%`)
  return db.prepare(`SELECT * FROM session_insights WHERE project_id = ? AND (${likeConditions}) ORDER BY confidence DESC, access_count DESC LIMIT ?`).all(projectId, ...params, limit) as SessionInsight[]
}

function storeInsight(projectId: string, insightType: string, content: string, sourceQuery: string, confidence: number, sessionId?: string): void {
  const db = getDb()
  const id = `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  db.prepare('INSERT OR REPLACE INTO session_insights (id, project_id, session_id, insight_type, content, source_query, confidence, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, projectId, sessionId || null, insightType, content, sourceQuery, confidence, Date.now(), Date.now()
  )
}

function markAccessed(insightIds: string[]): void {
  if (insightIds.length === 0) return
  const db = getDb()
  const placeholders = insightIds.map(() => '?').join(',')
  db.prepare(`UPDATE session_insights SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`).run(Date.now(), ...insightIds)
}

function getInsightStats(projectId: string): { total: number, byType: Record<string, number>, avgConfidence: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM session_insights WHERE project_id = ?').get(projectId) as { cnt: number }).cnt
  const types = db.prepare('SELECT insight_type, COUNT(*) as cnt FROM session_insights WHERE project_id = ? GROUP BY insight_type').all(projectId) as Array<{ insight_type: string, cnt: number }>
  const avg = (db.prepare('SELECT AVG(confidence) as avg_conf FROM session_insights WHERE project_id = ?').get(projectId) as { avg_conf: number | null }).avg_conf

  const byType: Record<string, number> = {}
  for (const t of types) byType[t.insight_type] = t.cnt

  return { total, byType, avgConfidence: avg || 0 }
}

async function extractInsightsFromConversation(query: string, response: string): Promise<Array<{ type: string, content: string, confidence: number }>> {
  const result = await callLLM(
    `You extract reusable insights from coding conversations. An insight is a piece of knowledge that would be valuable in future conversations about the same codebase.

Types of insights:
- "pattern": Coding patterns, conventions, or architectural decisions
- "preference": User preferences for code style, libraries, or approaches
- "fact": Facts about the codebase structure, dependencies, or configurations
- "debug": Debugging knowledge — what caused a bug and how it was fixed
- "decision": Technical decisions and their rationale

Return ONLY a JSON array. Each item: {"type": "...", "content": "...", "confidence": 0.0-1.0}
Return empty array [] if no reusable insights found.
Be selective — only extract genuinely reusable knowledge.`,
    `User query: "${query}"\n\nAssistant response: "${response.slice(0, 2000)}"`
  )

  try {
    const parsed = JSON.parse(result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item: { type?: string, content?: string, confidence?: number }) =>
      item.type && item.content && typeof item.confidence === 'number'
    )
  } catch {
    return []
  }
}

export function createSessionMemorySkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }
  let schemaInitialized = false

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'session-memory',
    version: '4.0.0',
    category: 'memory',
    priority: 'p1',
    description: 'Cross-session memory: stores and retrieves insights, patterns, and decisions learned from past conversations',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {
      try {
        initSessionMemorySchema()
        schemaInitialized = true
      } catch (err) {
        console.error('[SessionMemorySkill] Schema init failed:', err)
      }
    },

    canHandle(input: SkillInput): boolean {
      if (!schemaInitialized) return false
      const lower = input.query.toLowerCase()
      return /\b(remember|recall|what did|last time|previous|insight|memory stats|store insight|learned)\b/.test(lower) ||
        input.mode === 'recall' ||
        input.mode === 'store'
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const lower = input.query.toLowerCase()

        if (/\b(memory stats|insight stats)\b/.test(lower)) {
          const stats = getInsightStats(input.projectId)
          const typeBreakdown = Object.entries(stats.byType)
            .map(([type, count]) => `| ${type} | ${count} |`).join('\n')

          updateMetrics(Date.now() - start, true)
          return {
            content: `## Session Memory Statistics\n\n` +
              `- Total insights: ${stats.total}\n` +
              `- Average confidence: ${(stats.avgConfidence * 100).toFixed(1)}%\n\n` +
              `| Type | Count |\n|---|---|\n${typeBreakdown}`,
            metadata: stats
          }
        }

        if (input.mode === 'store' && input.context?.response) {
          const insights = await extractInsightsFromConversation(
            input.query,
            String(input.context.response)
          )

          for (const insight of insights) {
            storeInsight(input.projectId, insight.type, insight.content, input.query, insight.confidence, input.conversationId)
          }

          updateMetrics(Date.now() - start, true)
          return {
            content: `Stored ${insights.length} insights from this conversation.`,
            metadata: { insightsStored: insights.length, types: insights.map(i => i.type) }
          }
        }

        const relevantInsights = searchInsights(input.projectId, input.query, 8)

        if (relevantInsights.length === 0) {
          updateMetrics(Date.now() - start, true)
          return {
            content: 'No relevant insights found from previous sessions.',
            metadata: { insightsFound: 0 }
          }
        }

        markAccessed(relevantInsights.map(i => i.id))

        const insightText = relevantInsights.map(i => {
          const age = Date.now() - i.created_at
          const ageStr = age < 86400000 ? 'today' : `${Math.floor(age / 86400000)}d ago`
          return `- **[${i.insight_type}]** (${(i.confidence * 100).toFixed(0)}% confidence, ${ageStr}, used ${i.access_count}x)\n  ${i.content}`
        }).join('\n')

        const synthesized = await callLLM(
          `You are Cortex's memory system. The user is asking a question and you have relevant insights from past sessions. Synthesize these insights into a helpful response that directly addresses the user's current query. Be concise and reference the most relevant insights.`,
          `Current query: "${input.query}"\n\nRelevant past insights:\n${insightText}`
        )

        updateMetrics(Date.now() - start, true)
        return {
          content: synthesized,
          metadata: {
            insightsFound: relevantInsights.length,
            insightTypes: Array.from(new Set(relevantInsights.map(i => i.insight_type))),
            avgConfidence: relevantInsights.reduce((s, i) => s + i.confidence, 0) / relevantInsights.length
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},

    async healthCheck(): Promise<HealthStatus> {
      if (!schemaInitialized) return { healthy: false, message: 'Schema not initialized', lastCheck: Date.now() }
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}
