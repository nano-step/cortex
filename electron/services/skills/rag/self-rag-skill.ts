import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch, type SearchResult } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const SELF_RAG_KEYWORDS = ['how does', 'what is', 'where is', 'explain', 'show me', 'find', 'describe', 'what does']
const NO_RETRIEVAL_PATTERNS = /^(hi|hello|hey|thanks|thank you|ok|bye|good morning|good night)\b/i

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

async function evaluateRelevance(query: string, chunks: SearchResult[]): Promise<Array<{ chunk: SearchResult, relevance: number }>> {
  if (chunks.length === 0) return []

  const chunkDescriptions = chunks.map((c, i) =>
    `[${i}] ${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}): ${c.content.slice(0, 400)}`
  ).join('\n\n')

  const result = await callLLM(
    `You evaluate code chunk relevance to a user query. For each chunk, rate relevance 0.0-1.0. Return ONLY a JSON array of numbers, one per chunk. Example: [0.9, 0.3, 0.7]`,
    `Query: "${query}"\n\nChunks:\n${chunkDescriptions}`
  )

  try {
    const scores = JSON.parse(result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) as number[]
    return chunks.map((chunk, i) => ({
      chunk,
      relevance: typeof scores[i] === 'number' ? Math.max(0, Math.min(1, scores[i])) : 0.5
    }))
  } catch {
    return chunks.map(chunk => ({ chunk, relevance: chunk.score || 0.5 }))
  }
}

async function verifySupport(query: string, response: string, chunks: SearchResult[]): Promise<number> {
  const evidence = chunks.map(c => `${c.relativePath}: ${c.content.slice(0, 300)}`).join('\n')

  const result = await callLLM(
    `You verify whether a response is supported by the provided code evidence. Return ONLY a JSON object: {"support": 0.0-1.0, "unsupported_claims": ["claim1", ...]}. support=1.0 means fully supported, 0.0 means no support.`,
    `Query: "${query}"\n\nResponse: ${response.slice(0, 1500)}\n\nEvidence:\n${evidence}`
  )

  try {
    const parsed = JSON.parse(result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    return typeof parsed.support === 'number' ? parsed.support : 0.5
  } catch {
    return 0.5
  }
}

export function createSelfRagSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'self-rag',
    version: '4.0.0',
    category: 'rag',
    priority: 'p1',
    description: 'Self-evaluating RAG: checks retrieval relevance before use, verifies response is supported by evidence, re-retrieves if needed',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      if (NO_RETRIEVAL_PATTERNS.test(lower)) return false
      return SELF_RAG_KEYWORDS.some(kw => lower.includes(kw)) || /^(how|what|where|which|why|show|find|explain)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const rawResults = await hybridSearch(input.projectId, input.query, 10)
        if (rawResults.length === 0) {
          updateMetrics(Date.now() - start, true)
          return { content: 'No relevant code found in the codebase for this query.', metadata: { phase: 'no_results' } }
        }

        const evaluated = await evaluateRelevance(input.query, rawResults)
        let relevant = evaluated.filter(e => e.relevance > 0.5).sort((a, b) => b.relevance - a.relevance)

        let reRetrieved = false
        if (relevant.length < 2) {
          const refinedQuery = await callLLM(
            'Rewrite this code search query to be more specific and effective. Return ONLY the rewritten query, nothing else.',
            input.query
          )
          const newResults = await hybridSearch(input.projectId, refinedQuery.trim(), 10)
          const newEvaluated = await evaluateRelevance(input.query, newResults)
          const newRelevant = newEvaluated.filter(e => e.relevance > 0.4)

          const existingIds = new Set(relevant.map(r => r.chunk.chunkId))
          for (const item of newRelevant) {
            if (!existingIds.has(item.chunk.chunkId)) {
              relevant.push(item)
              existingIds.add(item.chunk.chunkId)
            }
          }
          relevant.sort((a, b) => b.relevance - a.relevance)
          reRetrieved = true
        }

        const topChunks = relevant.slice(0, 6)
        const contextText = topChunks.map(r =>
          `**${r.chunk.relativePath}** (relevance: ${(r.relevance * 100).toFixed(0)}%)\n` +
          `Lines ${r.chunk.lineStart}-${r.chunk.lineEnd}\n` +
          '```' + (r.chunk.language || '') + '\n' + r.chunk.content + '\n```'
        ).join('\n\n')

        const response = await callLLM(
          `You are Cortex, an AI code assistant. Answer the user's question using ONLY the provided code context. Cite file paths when referencing code. If the context doesn't contain enough info, say so clearly.`,
          `Question: ${input.query}\n\nCode Context:\n${contextText}`,
          3072
        )

        const supportScore = await verifySupport(input.query, response, topChunks.map(r => r.chunk))

        let finalResponse = response
        if (supportScore < 0.4) {
          finalResponse += '\n\n⚠️ **Low confidence**: This response may not be fully supported by the retrieved code. Consider refining your question or checking the referenced files directly.'
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: finalResponse,
          metadata: {
            totalRetrieved: rawResults.length,
            relevantCount: topChunks.length,
            reRetrieved,
            supportScore,
            avgRelevance: topChunks.reduce((s, r) => s + r.relevance, 0) / topChunks.length,
            citations: topChunks.map(r => r.chunk.relativePath)
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
