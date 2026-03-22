import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch, type SearchResult } from '../../vector-search'
import { embedQuery } from '../../embedder'
import { getProxyUrl, getProxyKey } from '../../settings-service'

async function callLLM(systemPrompt: string, userContent: string, maxTokens: number = 2048): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false, temperature: 0.3, max_tokens: maxTokens
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

async function generateHypotheticalDocument(query: string): Promise<string> {
  return callLLM(
    `You are a code generation assistant. Given a user's question about code, generate a HYPOTHETICAL code snippet that would perfectly answer their question. This code doesn't need to be real — it just needs to be semantically similar to the real answer.

Rules:
- Generate realistic TypeScript/JavaScript code
- Include function signatures, variable names, and patterns that the REAL code would likely use
- Include comments that describe the logic
- Keep it 20-60 lines
- Do NOT wrap in markdown code blocks
- Generate ONLY the code, no explanations`,
    query,
    1024
  )
}

async function rerankByHydeEmbedding(
  hypotheticalEmbedding: number[],
  results: SearchResult[]
): Promise<Array<{ result: SearchResult, hydeScore: number }>> {
  const scored: Array<{ result: SearchResult, hydeScore: number }> = []

  for (const result of results) {
    try {
      const chunkEmbedding = await embedQuery(result.content.slice(0, 1000))
      const hydeScore = cosineSimilarity(hypotheticalEmbedding, chunkEmbedding)
      scored.push({ result, hydeScore })
    } catch {
      scored.push({ result, hydeScore: result.score || 0 })
    }
  }

  scored.sort((a, b) => b.hydeScore - a.hydeScore)
  return scored
}

function mergeAndDeduplicate(
  normalResults: SearchResult[],
  hydeReranked: Array<{ result: SearchResult, hydeScore: number }>,
  maxResults: number
): SearchResult[] {
  const seen = new Set<string>()
  const merged: SearchResult[] = []

  for (const item of hydeReranked) {
    if (seen.has(item.result.chunkId)) continue
    seen.add(item.result.chunkId)
    merged.push(item.result)
    if (merged.length >= maxResults) return merged
  }

  for (const item of normalResults) {
    if (seen.has(item.chunkId)) continue
    seen.add(item.chunkId)
    merged.push(item)
    if (merged.length >= maxResults) return merged
  }

  return merged
}

export function createHydeSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'hyde-rag',
    version: '4.0.0',
    category: 'rag',
    priority: 'p1',
    description: 'HyDE RAG: generates hypothetical code answer, embeds it, then searches for real code semantically similar to the ideal answer',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      const conceptualPatterns = [
        'how does', 'how is', 'how to', 'what is the', 'what does',
        'where is', 'show me', 'find the', 'explain how', 'implement',
        'architecture', 'pattern', 'flow', 'pipeline', 'mechanism'
      ]
      return conceptualPatterns.some(p => lower.includes(p)) && lower.length > 20
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const normalResults = await hybridSearch(input.projectId, input.query, 15)
        const hypotheticalDoc = await generateHypotheticalDocument(input.query)
        const hydeEmbedding = await embedQuery(hypotheticalDoc)

        const hydeTextQuery = hypotheticalDoc.split('\n').slice(0, 3).join(' ').slice(0, 200)
        const hydeSearchResults = await hybridSearch(input.projectId, hydeTextQuery, 10)

        const allCandidates = [...normalResults]
        const normalIds = new Set(normalResults.map(r => r.chunkId))
        for (const r of hydeSearchResults) {
          if (!normalIds.has(r.chunkId)) {
            allCandidates.push(r)
            normalIds.add(r.chunkId)
          }
        }

        const reranked = await rerankByHydeEmbedding(hydeEmbedding, allCandidates)
        const finalResults = mergeAndDeduplicate(normalResults, reranked, 8)

        if (finalResults.length === 0) {
          updateMetrics(Date.now() - start, true)
          return { content: 'No relevant code found in the codebase for this query.', metadata: { phase: 'no_results' } }
        }

        const contextText = finalResults.map(r =>
          `**${r.relativePath}** (${r.chunkType}${r.name ? ': ' + r.name : ''})\nLines ${r.lineStart}-${r.lineEnd}\n` +
          '```' + (r.language || '') + '\n' + r.content + '\n```'
        ).join('\n\n')

        const response = await callLLM(
          `You are Cortex, an AI code assistant. Answer the user's question using the provided code context. Cite file paths when referencing code. Be specific and technical.`,
          `Question: ${input.query}\n\nCode Context:\n${contextText}`,
          3072
        )

        updateMetrics(Date.now() - start, true)
        return {
          content: response,
          metadata: {
            technique: 'hyde',
            normalResultCount: normalResults.length,
            hydeSearchResultCount: hydeSearchResults.length,
            totalCandidates: allCandidates.length,
            finalResultCount: finalResults.length,
            topHydeScores: reranked.slice(0, 5).map(r => ({
              path: r.result.relativePath,
              hydeScore: Math.round(r.hydeScore * 1000) / 1000
            })),
            hypotheticalDocPreview: hypotheticalDoc.slice(0, 200),
            citations: finalResults.map(r => r.relativePath)
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
