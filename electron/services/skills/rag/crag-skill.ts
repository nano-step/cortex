import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch, type SearchResult } from '../../vector-search'
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

async function evaluateRetrievalQuality(query: string, results: SearchResult[]): Promise<number> {
  if (results.length === 0) return 0
  const chunkSummary = results.slice(0, 5).map((r, i) =>
    `[${i}] ${r.relativePath}: ${r.content.slice(0, 300)}`
  ).join('\n')

  const result = await callLLM(
    'Rate how well these code chunks answer the query. Return ONLY a number 0.0-1.0. 1.0 = perfect match, 0.0 = completely irrelevant.',
    `Query: "${query}"\n\nRetrieved chunks:\n${chunkSummary}`
  )

  const score = parseFloat(result.trim())
  return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score))
}

async function refineQuery(originalQuery: string, context: string): Promise<string> {
  return callLLM(
    'The original search query returned poor results. Rewrite it to be more specific and effective for code search. Return ONLY the rewritten query.',
    `Original query: "${originalQuery}"\nContext of what was found: ${context.slice(0, 500)}`
  )
}

async function rewriteQueryFromScratch(originalQuery: string): Promise<string> {
  return callLLM(
    'The original search query completely failed to find relevant code. Rewrite it from a completely different angle. Think about what file names, function names, or code patterns might be relevant. Return ONLY the rewritten query.',
    `Failed query: "${originalQuery}"`
  )
}

function transformResults(query: string, results: SearchResult[]): SearchResult[] {
  return results.filter(r => r.content.trim().length > 20)
}

export function createCragSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'corrective-rag',
    version: '4.0.0',
    category: 'rag',
    priority: 'p1',
    description: 'Corrective RAG: evaluates retrieval quality and auto-corrects by refining or rewriting queries when results are poor',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return /\b(how|what|where|why|which|show|find|explain|implement|debug)\b/i.test(lower) && lower.length > 15
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        let results = await hybridSearch(input.projectId, input.query, 10)
        const originalScore = await evaluateRetrievalQuality(input.query, results)

        let correctionAction = 'none'
        let finalScore = originalScore

        if (originalScore < 0.3 && results.length > 0) {
          correctionAction = 'rewrite'
          const rewrittenQuery = await rewriteQueryFromScratch(input.query)
          const newResults = await hybridSearch(input.projectId, rewrittenQuery.trim(), 10)
          const newScore = await evaluateRetrievalQuality(input.query, newResults)

          if (newScore > originalScore) {
            results = newResults
            finalScore = newScore
          }
        } else if (originalScore < 0.7 && originalScore >= 0.3) {
          correctionAction = 'refine'
          const context = results.slice(0, 3).map(r => r.content.slice(0, 200)).join(' ')
          const refinedQuery = await refineQuery(input.query, context)
          const newResults = await hybridSearch(input.projectId, refinedQuery.trim(), 10)

          const existingIds = new Set(results.map(r => r.chunkId))
          for (const nr of newResults) {
            if (!existingIds.has(nr.chunkId)) {
              results.push(nr)
            }
          }
          results.sort((a, b) => b.score - a.score)
          results = results.slice(0, 10)
          finalScore = Math.max(originalScore, await evaluateRetrievalQuality(input.query, results))
        }

        results = transformResults(input.query, results)

        const contextText = results.slice(0, 6).map(r =>
          `**${r.relativePath}** (${r.chunkType}${r.name ? ': ' + r.name : ''})\nLines ${r.lineStart}-${r.lineEnd}\n` +
          '```' + (r.language || '') + '\n' + r.content + '\n```'
        ).join('\n\n')

        const response = await callLLM(
          'You are Cortex, an AI code assistant. Answer the question using the provided code context. Cite file paths. If context is insufficient, say so.',
          `Question: ${input.query}\n\nCode Context:\n${contextText}`,
          3072
        )

        updateMetrics(Date.now() - start, true)
        return {
          content: response,
          metadata: {
            originalScore,
            finalScore,
            correctionAction,
            resultCount: results.length,
            citations: results.slice(0, 6).map(r => r.relativePath)
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}
