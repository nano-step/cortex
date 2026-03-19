import { getSetting } from './settings-service'
import type { SearchResult } from './vector-search'

const JINA_RERANK_URL = 'https://api.jina.ai/v1/rerank'
const MAX_RETRIES = 2
let consecutive429 = 0
let cooldownUntil = 0
let permanentlyDisabled = false
let disableReason = ''

export function isCloudRerankerEnabled(): boolean {
  if (permanentlyDisabled) return false
  return !!getSetting('jina_api_key')
}

export function getRerankerStatus(): { enabled: boolean; disabled: boolean; reason: string } {
  return { enabled: isCloudRerankerEnabled(), disabled: permanentlyDisabled, reason: disableReason }
}

export async function cloudRerank(
  query: string,
  candidates: SearchResult[],
  topK: number = 10
): Promise<SearchResult[]> {
  if (candidates.length === 0) return []

  const apiKey = getSetting('jina_api_key')
  if (!apiKey) return candidates.slice(0, topK)

  if (Date.now() < cooldownUntil) return candidates.slice(0, topK)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(JINA_RERANK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'jina-reranker-v2-base-multilingual',
          query,
          documents: candidates.map(c => c.content.slice(0, 1024)),
          top_n: topK
        }),
        signal: AbortSignal.timeout(15000)
      })

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const wait = 2 ** attempt * 3
        console.warn(`[CloudReranker] Rate limited, retrying in ${wait}s (${attempt + 1}/${MAX_RETRIES})`)
        await new Promise(r => setTimeout(r, wait * 1000))
        continue
      }

      if (response.status === 429) {
        consecutive429++
        if (consecutive429 >= 3) {
          cooldownUntil = Date.now() + 60_000
          console.warn('[CloudReranker] 3 consecutive 429s, entering 60s cooldown')
          consecutive429 = 0
        }
        return candidates.slice(0, topK)
      }

      if (response.status === 403) {
        const body = await response.text().catch(() => '')
        permanentlyDisabled = true
        disableReason = body.includes('INSUFFICIENT_BALANCE')
          ? 'Jina balance exhausted — reranker disabled for this session'
          : `Jina auth failed (403) — reranker disabled`
        console.warn(`[CloudReranker] ${disableReason}`)
        return candidates.slice(0, topK)
      }

      if (!response.ok) {
        console.warn(`[CloudReranker] Jina API error: ${response.status}`)
        return candidates.slice(0, topK)
      }

      consecutive429 = 0
      const data = await response.json() as {
        results: Array<{ index: number; relevance_score: number }>
      }

      return data.results
        .map(r => ({ ...candidates[r.index], score: r.relevance_score }))
        .slice(0, topK)
    } catch (err) {
      console.warn('[CloudReranker] Failed, returning original order:', err)
      return candidates.slice(0, topK)
    }
  }

  return candidates.slice(0, topK)
}
