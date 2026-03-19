/**
 * Agentic RAG — Multi-step intelligent retrieval for code Q&A
 *
 * Pipeline:
 * 1. Query Decomposition — LLM breaks complex query into sub-queries
 * 2. Iterative Retrieval — hybrid search per sub-query
 * 3. Relevance Boosting — heuristic keyword matching
 * 4. Gap Detection — follow-up search for missing aspects
 * 5. Context Assembly — deduplicate, rank, cap
 * 6. Confidence Scoring — evaluate retrieval quality
 */

import { hybridSearch, type SearchResult } from './vector-search'
import { getProxyUrl, getProxyKey } from './settings-service'
import { optimizeDecompositionPrompt, recordQueryPattern, recordQueryOutcome } from './query-optimizer'
import { routeRAGQuery } from './skills/rag/rag-router'
import { graphSearch } from './skills/rag/graphrag-skill'
import { reciprocalRankFusion, generateQueryVariants } from './skills/rag/rag-fusion-skill'

// =====================
// Types
// =====================

export interface AgenticRAGResult {
  /** Final assembled context chunks */
  context: SearchResult[]
  /** Decomposed sub-queries used */
  subQueries: string[]
  /** How many retrieval iterations performed */
  iterations: number
  /** 0-1 confidence that context is sufficient */
  confidence: number
  /** Brief explanation of what was found/missing */
  reasoning: string
}

interface AgenticRAGOptions {
  maxIterations?: number
  minConfidence?: number
  maxChunks?: number
  branch?: string
}

// =====================
// Query Decomposition
// =====================

const DECOMPOSE_SYSTEM = `You decompose user questions into search sub-queries for a code repository.
CRITICAL: Respond with ONLY a valid JSON array of strings. No explanation, no preamble, no markdown.
Example: ["auth middleware handler", "database schema model"]`

const DECOMPOSE_PROMPT = `Break this into 1-3 focused code search sub-queries. Reply with ONLY a JSON array.

Examples:
"How does authentication work and what database?" → ["authentication middleware login handler", "database connection schema model"]
"What is the project structure?" → ["project directory structure architecture"]

Question: `

/**
 * Decompose a complex query into focused sub-queries using a lightweight LLM call.
 * Falls back to the original query on any failure.
 */
async function decomposeQuery(query: string, projectId?: string): Promise<string[]> {
  try {
    const proxyUrl = getProxyUrl()
    const proxyKey = getProxyKey()

    const userPrompt = projectId
      ? optimizeDecompositionPrompt(projectId, DECOMPOSE_PROMPT)
      : DECOMPOSE_PROMPT

    const response = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${proxyKey}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: DECOMPOSE_SYSTEM },
          { role: 'user', content: userPrompt + query }
        ],
        max_tokens: 200,
        temperature: 0
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (response.status === 429) {
      console.warn('[AgenticRAG] Decomposition LLM rate limited (429), using original query')
      return [query]
    }

    if (!response.ok) {
      console.warn(`[AgenticRAG] Decomposition LLM call failed: ${response.status}`)
      return [query]
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return [query]

    const parsed = parseJsonArray(content)
    if (parsed) {
      console.log(`[AgenticRAG] Decomposed into ${parsed.length} sub-queries: ${parsed.join(' | ')}`)
      return parsed.slice(0, 3)
    }

    console.log('[AgenticRAG] No valid JSON array in decomposition response, using original query')
    return [query]
  } catch (err) {
    console.warn('[AgenticRAG] Query decomposition failed, using original query:', (err as Error).message)
    return [query]
  }
}

function parseJsonArray(raw: string): string[] | null {
  // Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // Try direct parse first (fast path for well-behaved models)
  try {
    const direct = JSON.parse(stripped)
    if (Array.isArray(direct) && direct.length > 0 && direct.every(s => typeof s === 'string')) {
      return direct
    }
  } catch { /* not pure JSON, try extraction */ }

  // Extract JSON array from surrounding text (handles "Understood, here is the result: [...]")
  const arrayMatch = stripped.match(/\[[\s\S]*\]/)
  if (!arrayMatch) return null

  try {
    const extracted = JSON.parse(arrayMatch[0])
    if (Array.isArray(extracted) && extracted.length > 0 && extracted.every(s => typeof s === 'string')) {
      return extracted
    }
  } catch { /* malformed JSON array */ }

  // Last resort: extract quoted strings manually (handles broken JSON like ["foo", "bar)
  const quotedStrings = [...stripped.matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(s => s.length >= 3)
  if (quotedStrings.length > 0 && quotedStrings.length <= 5) {
    return quotedStrings.slice(0, 3)
  }

  return null
}

// =====================
// Relevance Boosting
// =====================

/**
 * Extract meaningful keywords from a query for relevance scoring.
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-_.]/g, ' ')
    .split(/\s+/)
    .filter(k => k.length >= 3)
    .filter(k => !STOP_WORDS.has(k))
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'been', 'have', 'has',
  'how', 'does', 'what', 'when', 'where', 'which', 'that', 'this',
  'with', 'from', 'into', 'about', 'than', 'they', 'them', 'their',
  'there', 'here', 'just', 'also', 'more', 'some', 'only', 'very',
  'can', 'will', 'should', 'would', 'could', 'may', 'might',
  'not', 'but', 'all', 'any', 'each', 'every', 'both', 'few',
  // Vietnamese stop words
  'là', 'của', 'và', 'trong', 'cho', 'với', 'này', 'đó', 'được',
  'các', 'những', 'một', 'hay', 'hoặc', 'khi', 'nào', 'thì',
  'làm', 'gì', 'sao', 'thế', 'nên', 'cần', 'phải', 'muốn'
])

/**
 * Boost relevance score based on keyword overlap between query and chunk.
 */
function computeRelevanceBoost(queryKeywords: string[], chunk: SearchResult): number {
  const chunkText = `${chunk.relativePath} ${chunk.name || ''} ${chunk.content}`.toLowerCase()
  let hits = 0

  for (const keyword of queryKeywords) {
    if (chunkText.includes(keyword)) hits++
  }

  // Boost: 0.0 to 0.3 based on keyword match ratio
  return queryKeywords.length > 0 ? (hits / queryKeywords.length) * 0.3 : 0
}

// =====================
// Gap Detection
// =====================

/** Patterns that indicate specific file/function references in a query */
const CODE_REF_PATTERNS = [
  /(?:file|module|component|service)\s+[`"']?(\S+?)[`"']?(?:\s|$|,|\.)/gi,
  /(\w+(?:\.\w+)+)(?:\s|$)/g, // Dotted paths like auth.service.ts
  /(?:function|method|class)\s+[`"']?(\w+)[`"']?/gi,
  /[`"']([a-zA-Z][\w-]+\.[a-zA-Z]+)[`"']/g, // Quoted file names
]

/**
 * Detect specific code references in the query that weren't found in results.
 */
function detectGaps(query: string, results: SearchResult[]): string[] {
  const foundPaths = new Set(results.map(r => r.relativePath.toLowerCase()))
  const foundNames = new Set(results.filter(r => r.name).map(r => r.name!.toLowerCase()))
  const gaps: string[] = []

  for (const pattern of CODE_REF_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(query)) !== null) {
      const ref = match[1].toLowerCase()
      const inPaths = Array.from(foundPaths).some(p => p.includes(ref))
      const inNames = Array.from(foundNames).some(n => n.includes(ref))
      if (!inPaths && !inNames) {
        gaps.push(ref)
      }
    }
  }

  return [...new Set(gaps)]
}

// =====================
// Main Agentic Retrieve
// =====================

/**
 * Perform multi-step agentic retrieval for a code-related query.
 *
 * 1. Decompose query into sub-queries (1 LLM call)
 * 2. Run hybrid search for each sub-query
 * 3. Detect gaps and run follow-up search if needed
 * 4. Assemble, deduplicate, rank, and return
 */
export async function agenticRetrieve(
  projectId: string,
  query: string,
  mode: 'pm' | 'engineering',
  options?: AgenticRAGOptions
): Promise<AgenticRAGResult> {
  const maxIterations = options?.maxIterations ?? 3
  const minConfidence = options?.minConfidence ?? 0.6
  const maxChunks = options?.maxChunks ?? 15
  const branch = options?.branch

  const queryKeywords = extractKeywords(query)
  let iterations = 0
  const allResults = new Map<string, SearchResult & { boostedScore: number }>()

  const subQueries = await decomposeQuery(query, projectId)
  iterations++

  // Step 2: Route query and retrieve for each sub-query in parallel
  const route = routeRAGQuery(projectId, query)
  console.log(`[AgenticRAG] Strategy: ${route.strategy} (confidence ${route.confidence.toFixed(2)}, ${route.reason})`)
  const perQueryLimit = Math.max(6, Math.ceil(maxChunks / subQueries.length))

  // Strategy-aware search function
  async function strategySearch(sq: string, limit: number): Promise<SearchResult[]> {
    switch (route.strategy) {
      case 'graphrag': {
        // Graph search returns text, so also do hybrid and merge
        const [graphText, hybridResults] = await Promise.all([
          graphSearch(projectId, sq, limit).catch(() => ''),
          hybridSearch(projectId, sq, limit, branch)
        ])
        // Graph results supplement hybrid, don't replace
        return hybridResults
      }
      case 'fusion': {
        const variants = generateQueryVariants(sq, 3)
        const resultSets = await Promise.all(variants.map(q => hybridSearch(projectId, q, limit, branch)))
        return reciprocalRankFusion(resultSets).slice(0, limit)
      }
      case 'contextual':
      case 'hybrid':
      default:
        return hybridSearch(projectId, sq, limit, branch)
    }
  }

  const searchPromises = subQueries.map(sq => strategySearch(sq, perQueryLimit))

  let searchResults: SearchResult[][]
  try {
    searchResults = await Promise.all(searchPromises)
  } catch (err) {
    console.error('[AgenticRAG] Search failed:', err)
    // Fallback to single hybrid query
    try {
      const fallback = await hybridSearch(projectId, query, maxChunks, branch)
      return {
        context: fallback.slice(0, maxChunks),
        subQueries: [query],
        iterations: 1,
        confidence: fallback.length > 0 ? 0.5 : 0.1,
        reasoning: 'Fallback to single query search due to error'
      }
    } catch {
      return {
        context: [],
        subQueries: [query],
        iterations: 1,
        confidence: 0,
        reasoning: 'All search attempts failed'
      }
    }
  }
  iterations++

  // Collect and deduplicate results with relevance boost
  for (const results of searchResults) {
    for (const result of results) {
      if (!allResults.has(result.chunkId)) {
        const boost = computeRelevanceBoost(queryKeywords, result)
        allResults.set(result.chunkId, {
          ...result,
          boostedScore: result.score + boost
        })
      } else {
        // If seen before, increase score (found by multiple sub-queries = more relevant)
        const existing = allResults.get(result.chunkId)!
        existing.boostedScore += 0.15 // Multi-query bonus
      }
    }
  }

  // Step 3: Gap detection and follow-up
  const currentResults = Array.from(allResults.values())
  const gaps = detectGaps(query, currentResults)

  if (gaps.length > 0 && iterations < maxIterations) {
    console.log(`[AgenticRAG] Detected ${gaps.length} gaps: ${gaps.join(', ')}`)

    // Follow-up search for each gap
    const gapSearches = gaps.slice(0, 3).map(gap =>
      hybridSearch(projectId, gap, 5, branch).catch(() => [] as SearchResult[])
    )
    const gapResults = await Promise.all(gapSearches)
    iterations++

    for (const results of gapResults) {
      for (const result of results) {
        if (!allResults.has(result.chunkId)) {
          const boost = computeRelevanceBoost(queryKeywords, result)
          allResults.set(result.chunkId, {
            ...result,
            boostedScore: result.score + boost + 0.1 // Gap-fill bonus
          })
        }
      }
    }
  }

  // Step 4: Assemble final context
  const finalResults = Array.from(allResults.values())
    .sort((a, b) => b.boostedScore - a.boostedScore)
    .slice(0, maxChunks)
    .map(({ boostedScore, ...result }) => ({
      ...result,
      score: boostedScore
    }))

  // Step 5: Compute confidence
  const subQueryHits = searchResults.map(r => r.length > 0 ? 1 : 0)
  const hitRatio = subQueryHits.reduce((a, b) => a + b, 0) / subQueries.length
  const hasGoodResults = finalResults.some(r => r.score > 0.5)
  const confidence = Math.min(1, hitRatio * 0.6 + (hasGoodResults ? 0.3 : 0) + (gaps.length === 0 ? 0.1 : 0))

  // Step 6: Generate reasoning
  const reasoning = buildReasoning(subQueries, searchResults, gaps, finalResults, confidence)

  console.log(`[AgenticRAG] Completed: ${finalResults.length} chunks, ${iterations} iterations, confidence ${confidence.toFixed(2)}`)

  if (finalResults.length > 0) {
    try {
      const matchedPaths = Array.from(new Set(finalResults.slice(0, 5).map(r => r.relativePath)))
      recordQueryPattern(projectId, query, matchedPaths)
      recordQueryOutcome(projectId, query, confidence >= 0.5)
    } catch {
      // best-effort learning
    }
  }

  return {
    context: finalResults,
    subQueries,
    iterations,
    confidence,
    reasoning
  }
}

/**
 * Build human-readable reasoning about retrieval quality.
 */
function buildReasoning(
  subQueries: string[],
  searchResults: SearchResult[][],
  gaps: string[],
  finalResults: SearchResult[],
  confidence: number
): string {
  const parts: string[] = []

  // Sub-query coverage
  const covered = searchResults.filter(r => r.length > 0).length
  parts.push(`Searched ${subQueries.length} sub-quer${subQueries.length === 1 ? 'y' : 'ies'}, ${covered}/${subQueries.length} found results.`)

  // Gaps
  if (gaps.length > 0) {
    parts.push(`Missing references: ${gaps.join(', ')}.`)
  }

  // Result summary
  if (finalResults.length > 0) {
    const topFiles = [...new Set(finalResults.slice(0, 5).map(r => r.relativePath))]
    parts.push(`Top files: ${topFiles.join(', ')}.`)
  }

  // Confidence assessment
  if (confidence >= 0.8) {
    parts.push('High confidence — relevant code found for all aspects.')
  } else if (confidence >= 0.5) {
    parts.push('Moderate confidence — some aspects may need more specific questions.')
  } else {
    parts.push('Low confidence — limited relevant code found. Try asking about specific files or functions.')
  }

  return parts.join(' ')
}
