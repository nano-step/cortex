/**
 * Embedder — Voyage AI primary, Jina fallback, proxy last resort
 *
 * Voyage 4: 1024 dims, compatible with existing SQLite + Qdrant DB.
 * Token-based throttle: tracks tokens/min, enforces limit BEFORE sending.
 * Batch size reduced to 8 (was 32) to stay well under token limits.
 */

import { getDb, chunkQueries } from './db'
import { BrowserWindow } from 'electron'
import { getProxyUrl, getProxyKey, getJinaApiKey, getVoyageApiKey, getGitHubPAT, getEmbeddingProvider, getBulkEmbeddingProvider, getSetting, setSetting, getOllamaUrl, getOllamaEmbeddingModel } from './settings-service'
import type { EmbeddingProviderType } from './settings-service'

export const EMBEDDING_DIMENSIONS = 1024
export const LEGACY_EMBEDDING_DIMENSIONS = 384

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const JINA_API_URL = 'https://api.jina.ai/v1/embeddings'
const GITHUB_MODELS_API_URL = 'https://models.github.ai/inference/embeddings'
const GITHUB_MODELS_EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const JINA_MODEL = 'jina-embeddings-v3'

export const VOYAGE_MODELS = [
  { id: 'voyage-4-large', name: 'Voyage 4 Large', dims: 1024, description: 'Flagship MoE — SOTA quality, 40% cheaper than dense' },
  { id: 'voyage-4', name: 'Voyage 4', dims: 1024, description: 'Near voyage-3-large quality, mid-size efficiency' },
  { id: 'voyage-4-lite', name: 'Voyage 4 Lite', dims: 1024, description: 'Fast + cheap, near voyage-3.5 quality' },
  { id: 'voyage-code-3', name: 'Voyage Code 3', dims: 1024, description: 'Optimized for code search' },
  { id: 'voyage-3-large', name: 'Voyage 3 Large', dims: 1024, description: 'Previous gen flagship' },
  { id: 'voyage-3.5', name: 'Voyage 3.5', dims: 1024, description: 'Previous gen balanced' },
] as const

export function getSelectedVoyageModel(): string {
  return getSetting('voyage_model') || 'voyage-4'
}

export function setSelectedVoyageModel(modelId: string): void {
  const valid = VOYAGE_MODELS.some(m => m.id === modelId)
  if (valid) setSetting('voyage_model', modelId, false)
}

function getVoyageModelDims(): number {
  const model = VOYAGE_MODELS.find(m => m.id === getSelectedVoyageModel())
  return model?.dims || 1024
}

const MAX_TEXT_LENGTH = 8192
const MAX_RETRIES = 3
const MAX_RETRY_AFTER_SECONDS = 120

interface ProviderLimits {
  batchSize: number
  tokenLimitPerMinute: number
  requestsPerMinute: number
  requestsPerDay: number
  minBatchIntervalMs: number
}

// Source: https://docs.voyageai.com/docs/rate-limits (Tier 1)
//   voyage-4: 3M TPM, 2000 RPM. No daily limit.
// Source: https://docs.github.com/en/github-models/prototyping-with-ai-models (Copilot Free/Pro)
//   text-embedding-3-small: 15 RPM, 150 RPD, 64K tokens/request. No TPM limit.
// Source: https://docs.jina.ai (Free tier)
//   jina-embeddings-v3: 500 RPM, ~1M TPM
const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  voyage: { batchSize: 8, tokenLimitPerMinute: 2_000_000, requestsPerMinute: 1500, requestsPerDay: Infinity, minBatchIntervalMs: 50 },
  jina:   { batchSize: 8, tokenLimitPerMinute: 500_000,   requestsPerMinute: 400,  requestsPerDay: Infinity, minBatchIntervalMs: 200 },
  github: { batchSize: 48, tokenLimitPerMinute: Infinity,  requestsPerMinute: 14,   requestsPerDay: 145,      minBatchIntervalMs: 4_500 },
  proxy:  { batchSize: 8, tokenLimitPerMinute: 500_000,   requestsPerMinute: 300,  requestsPerDay: Infinity, minBatchIntervalMs: 200 },
}

function getLimits(provider?: EmbeddingProviderType): ProviderLimits {
  return PROVIDER_LIMITS[provider || getEmbeddingProvider()] || PROVIDER_LIMITS.proxy
}

function getBatchSize(provider?: EmbeddingProviderType): number {
  return getLimits(provider).batchSize
}

interface ThrottleState {
  tokensUsed: number
  tokenWindowStart: number
  requestsThisMinute: number
  requestsLastMinute: number
  minuteWindowStart: number
  requestsToday: number
  dayWindowStart: number
  totalRequestsSession: number
}

const providerThrottles: Record<string, ThrottleState> = {}

function getThrottle(provider: string): ThrottleState {
  if (!providerThrottles[provider]) {
    providerThrottles[provider] = {
      tokensUsed: 0, tokenWindowStart: Date.now(),
      requestsThisMinute: 0, requestsLastMinute: 0, minuteWindowStart: Date.now(),
      requestsToday: 0, dayWindowStart: Date.now(),
      totalRequestsSession: 0,
    }
  }
  return providerThrottles[provider]
}

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)
}

function resetWindowIfExpired(t: ThrottleState): void {
  const now = Date.now()
  if (now - t.tokenWindowStart >= 60_000) { t.tokensUsed = 0; t.tokenWindowStart = now }
  if (now - t.minuteWindowStart >= 60_000) {
    t.requestsLastMinute = t.requestsThisMinute
    t.requestsThisMinute = 0
    t.minuteWindowStart = now
  }
  if (now - t.dayWindowStart >= 86_400_000) { t.requestsToday = 0; t.dayWindowStart = now }
}

function canSend(provider: string, tokenCount: number): { ok: boolean; reason?: string } {
  const t = getThrottle(provider)
  resetWindowIfExpired(t)
  const limits = getLimits(provider as EmbeddingProviderType)
  if (t.requestsToday >= limits.requestsPerDay) return { ok: false, reason: 'daily limit' }
  if (t.requestsThisMinute >= limits.requestsPerMinute) return { ok: false, reason: 'RPM limit' }
  if (limits.tokenLimitPerMinute !== Infinity && t.tokensUsed + tokenCount > limits.tokenLimitPerMinute) return { ok: false, reason: 'token limit' }
  return { ok: true }
}

function recordRequest(provider: string, tokenCount: number): void {
  const t = getThrottle(provider)
  resetWindowIfExpired(t)
  t.tokensUsed += tokenCount
  t.requestsThisMinute++
  t.requestsToday++
  t.totalRequestsSession++
}

async function waitForBudget(provider: string, tokenCount: number): Promise<void> {
  const limits = getLimits(provider as EmbeddingProviderType)
  const t = getThrottle(provider)
  let check = canSend(provider, tokenCount)
  while (!check.ok) {
    if (check.reason === 'daily limit') {
      const remaining = 86_400_000 - (Date.now() - t.dayWindowStart)
      const hours = Math.ceil(remaining / 3_600_000)
      console.warn(`[Embedder] ${provider} daily limit reached (${limits.requestsPerDay}/day). Re-sync in ~${hours}h.`)
      throw new Error(`DAILY_QUOTA_EXHAUSTED: ${provider} daily limit reached. Re-sync later (~${hours}h).`)
    }
    const remaining = 60_000 - (Date.now() - t.minuteWindowStart)
    const waitMs = Math.min(remaining + 500, 30_000)
    console.log(`[Embedder] Throttle [${provider}]: ${check.reason} (${t.requestsThisMinute}/${limits.requestsPerMinute} RPM, ${t.tokensUsed}/${limits.tokenLimitPerMinute === Infinity ? '∞' : limits.tokenLimitPerMinute} tokens), waiting ${Math.round(waitMs / 1000)}s`)
    await new Promise(r => setTimeout(r, waitMs))
    resetWindowIfExpired(t)
    check = canSend(provider, tokenCount)
  }
}

// Sequential queue — one request at a time
interface QueueItem {
  resolve: (v: number[][]) => void
  reject: (e: Error) => void
  texts: string[]
  task?: 'retrieval.passage' | 'retrieval.query'
  providerOverride?: EmbeddingProviderType
}

let requestQueue: QueueItem[] = []
let processingQueue = false
let lastRequestTime = 0

function drainQueueWithError(msg: string): void {
  const pending = requestQueue.splice(0)
  const err = new Error(msg)
  for (const item of pending) item.reject(err)
}

async function processQueue(): Promise<void> {
  if (processingQueue) return
  processingQueue = true

  while (requestQueue.length > 0) {
    const item = requestQueue.shift()!
    const itemProvider = item.providerOverride || getEmbeddingProvider()
    const itemLimits = getLimits(itemProvider)
    const tokenEstimate = estimateTokens(item.texts)

    try {
      await waitForBudget(itemProvider, tokenEstimate)
    } catch (limitErr) {
      item.reject(limitErr as Error)
      drainQueueWithError((limitErr as Error).message)
      break
    }

    const now = Date.now()
    const elapsed = now - lastRequestTime
    if (elapsed < itemLimits.minBatchIntervalMs) {
      await new Promise(r => setTimeout(r, itemLimits.minBatchIntervalMs - elapsed))
    }

    try {
      lastRequestTime = Date.now()
      const result = await embedTextsRaw(item.texts, item.task || 'retrieval.passage', itemProvider)
      recordRequest(itemProvider, tokenEstimate)
      item.resolve(result)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : ''
      if (errMsg.includes('DAILY_QUOTA_EXHAUSTED')) {
        item.reject(err as Error)
        drainQueueWithError(errMsg)
        break
      }
      const is429 = errMsg.includes('429')
      if (is429) {
        const t = getThrottle(itemProvider)
        console.warn(`[Embedder] ${itemProvider} rate limited (429), pausing 60s before retry`)
        t.requestsThisMinute = itemLimits.requestsPerMinute
        t.minuteWindowStart = Date.now()
        requestQueue.unshift(item)
        await new Promise(r => setTimeout(r, 60_000))
        resetWindowIfExpired(t)
        continue
      }
      item.reject(err as Error)
    }
  }

  processingQueue = false
}

export interface EmbeddingResult {
  chunkId: string
  embedding: number[]
}

function truncateText(text: string): string {
  return text.length <= MAX_TEXT_LENGTH ? text : text.slice(0, MAX_TEXT_LENGTH)
}

function sendModelDownloadProgress(data: { model: string; status: string; progress?: number; file?: string }) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('model:downloadProgress', data)
  }
}

async function embedTexts(texts: string[], providerOverride?: EmbeddingProviderType): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, texts, providerOverride })
    processQueue()
  })
}

async function embedTextsForQuery(texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, texts, task: 'retrieval.query' })
    processQueue()
  })
}

async function embedTextsRaw(
  texts: string[],
  task: 'retrieval.passage' | 'retrieval.query' = 'retrieval.passage',
  providerOverride?: EmbeddingProviderType
): Promise<number[][]> {
  const provider = providerOverride || getEmbeddingProvider()
  const truncated = texts.map(truncateText)

  let baseUrl: string
  let apiKey: string
  let reqBody: Record<string, unknown>

  switch (provider) {
    case 'voyage': {
      baseUrl = VOYAGE_API_URL
      apiKey = getVoyageApiKey()!
      reqBody = {
        model: getSelectedVoyageModel(),
        input: truncated,
        input_type: task === 'retrieval.query' ? 'query' : 'document'
      }
      break
    }
    case 'jina': {
      baseUrl = JINA_API_URL
      apiKey = getJinaApiKey()!
      reqBody = {
        model: JINA_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
        task
      }
      break
    }
    case 'github': {
      baseUrl = GITHUB_MODELS_API_URL
      apiKey = getGitHubPAT()!
      reqBody = {
        model: GITHUB_MODELS_EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float'
      }
      break
    }
    case 'ollama': {
      const ollamaBase = getOllamaUrl().replace(/\/$/, '')
      baseUrl = `${ollamaBase}/api/embed`
      apiKey = ''
      reqBody = { model: getOllamaEmbeddingModel(), input: truncated }
      break
    }
    default: {
      baseUrl = `${getProxyUrl()}/v1/embeddings`
      apiKey = getProxyKey()
      reqBody = {
        model: JINA_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float'
      }
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(30000)
    })

    if (response.status === 429) {
      const rateLimitType = response.headers.get('x-ratelimit-type') || ''
      const rawRetryAfter = Number(response.headers.get('retry-after')) || (2 ** attempt * 10)

      if (rateLimitType.includes('ByDay') || rawRetryAfter > 3600) {
        const hours = Math.ceil(rawRetryAfter / 3600)
        console.error(`[Embedder] ${provider} DAILY QUOTA EXHAUSTED (${rateLimitType}, reset in ~${hours}h). Stopping embedding.`)
        throw new Error(`DAILY_QUOTA_EXHAUSTED: ${provider} daily limit reached. Re-sync later to continue (~${hours}h).`)
      }

      if (attempt < MAX_RETRIES) {
        const retryAfter = Math.min(rawRetryAfter, MAX_RETRY_AFTER_SECONDS)
        console.warn(`[Embedder] ${provider} rate limited (429), retry in ${retryAfter}s (${attempt + 1}/${MAX_RETRIES})`)
        await new Promise(r => setTimeout(r, retryAfter * 1000))
        continue
      }
    }

    if (response.status === 403) {
      const errBody = await response.text().catch(() => '')
      console.error(`[Embedder] ${provider} auth failed (403): ${errBody.slice(0, 150)}`)
      console.error(`[Embedder] Disabling ${provider} for this session — falling back to keyword search`)
      throw new Error(`Embedding provider ${provider} auth failed (403). Check API key or balance.`)
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      throw new Error(`Embedding API error ${response.status} (${provider}): ${errBody.slice(0, 200)}`)
    }

    const rawData = await response.json() as Record<string, unknown>

    const result: number[][] = new Array(texts.length)

    if (provider === 'ollama' && Array.isArray(rawData['embeddings'])) {
      const embeddings = rawData['embeddings'] as number[][]
      for (let i = 0; i < embeddings.length; i++) result[i] = embeddings[i]
    } else {
      const items = (rawData['data'] || rawData['embeddings']) as Array<{ embedding: number[]; index: number }> | undefined
      if (items) {
        for (const item of items) result[item.index] = item.embedding
      }
    }

    console.log(`[Embedder] ${provider}: embedded ${texts.length} texts (${estimateTokens(truncated)} tokens)`)
    return result
  }

  throw new Error(`Embedding API error 429 (${provider}): max retries exceeded`)
}

export async function embedQuery(query: string): Promise<number[]> {
  const results = await embedTextsForQuery([query])
  return results[0] || []
}

export async function embedProjectChunks(
  projectId: string,
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  const db = getDb()

  const chunks = db
    .prepare(
      'SELECT id, content, name, relative_path, chunk_type FROM chunks WHERE project_id = ? AND embedding IS NULL'
    )
    .all(projectId) as Array<{
    id: string
    content: string
    name: string | null
    relative_path: string
    chunk_type: string
  }>

  if (chunks.length === 0) return 0

  const bulkProvider = getBulkEmbeddingProvider()
  const queryProvider = getEmbeddingProvider()
  const batchSize = getBatchSize(bulkProvider)
  if (bulkProvider !== queryProvider) {
    console.log(`[Embedder] Strategy: bulk=${bulkProvider} (fast), query=${queryProvider} (default)`)
  }
  console.log(`[Embedder] Starting batch embed: ${chunks.length} chunks via ${bulkProvider} (batch=${batchSize})`)

  await preloadEmbeddingModel(bulkProvider)

  const updateEmbedding = chunkQueries.updateEmbedding(db)
  let processed = 0
  let failed = 0

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)

    const texts = batch.map((chunk) => {
      const prefix = [
        chunk.relative_path,
        chunk.chunk_type !== 'other' ? `[${chunk.chunk_type}]` : '',
        chunk.name ? chunk.name : ''
      ]
        .filter(Boolean)
        .join(' | ')

      const content =
        chunk.content.length > MAX_TEXT_LENGTH
          ? chunk.content.slice(0, MAX_TEXT_LENGTH)
          : chunk.content

      return `${prefix}\n\n${content}`
    })

    try {
      const embeddings = await embedTexts(texts, bulkProvider)

      const transaction = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const embedding = embeddings[j]
          if (embedding) {
            const buffer = Buffer.from(new Float32Array(embedding).buffer)
            updateEmbedding.run(buffer, batch[j].id)
          }
        }
      })
      transaction()

      processed += batch.length
      onProgress?.(processed, chunks.length)
    } catch (err) {
      const errMsg = (err as Error).message || ''
      if (errMsg.includes('DAILY_QUOTA_EXHAUSTED') || errMsg.includes('Daily embedding limit')) {
        const remaining = chunks.length - processed
        console.warn(`[Embedder] Daily quota hit after ${processed}/${chunks.length} chunks. ${remaining} chunks will be embedded on next sync.`)
        break
      }
      failed += batch.length
      console.error(`[Embedder] Batch failed (${i}-${i + batchSize}):`, errMsg)
    }
  }

  if (failed > 0) {
    console.warn(`[Embedder] Completed with ${failed} failures out of ${chunks.length} chunks`)
  }

  return processed
}

export async function preloadEmbeddingModel(providerOverride?: EmbeddingProviderType): Promise<void> {
  try {
    await embedTexts(['preload test'], providerOverride)
    const provider = providerOverride || getEmbeddingProvider()
    const model = provider === 'voyage' ? getSelectedVoyageModel()
      : provider === 'github' ? GITHUB_MODELS_EMBEDDING_MODEL
      : JINA_MODEL
    console.log(`[Embedder] Ready: ${model} via ${provider} (${EMBEDDING_DIMENSIONS} dims, batch=${getBatchSize(provider)})`)
  } catch (err) {
    console.warn('[Embedder] Not available:', (err as Error).message)
  }
}

export function needsReEmbed(projectId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    'SELECT embedding FROM chunks WHERE project_id = ? AND embedding IS NOT NULL LIMIT 1'
  ).get(projectId) as { embedding: Buffer } | undefined
  if (!row?.embedding) return false
  const dims = row.embedding.byteLength / 4
  return dims !== EMBEDDING_DIMENSIONS
}

export async function reEmbedProject(
  projectId: string,
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  const db = getDb()
  db.prepare('UPDATE chunks SET embedding = NULL WHERE project_id = ?').run(projectId)
  return embedProjectChunks(projectId, onProgress)
}

export function isEmbedderAvailable(): boolean {
  return !!getVoyageApiKey() || !!getJinaApiKey() || getEmbeddingProvider() === 'github' || (!!getProxyUrl() && !!getProxyKey())
}

export interface ThrottleStatusInfo {
  provider: string
  rpmCurrent: number
  rpmLastMinute: number
  requestsPerMinute: number
  requestsToday: number
  requestsPerDay: number
  totalRequestsSession: number
  dailyQuotaExhausted: boolean
  recoveryTimeMs: number
}

export function getThrottleStatus(): ThrottleStatusInfo[] {
  const providers = ['voyage', 'jina', 'github', 'proxy'] as const
  return providers
    .filter(p => {
      if (p === 'voyage') return !!getVoyageApiKey()
      if (p === 'jina') return !!getJinaApiKey()
      if (p === 'github') return !!(getGitHubPAT() && (getEmbeddingProvider() === 'github' || getBulkEmbeddingProvider() === 'github'))
      return false
    })
    .map(p => {
      const t = getThrottle(p)
      const limits = getLimits(p)
      resetWindowIfExpired(t)
      const dailyExhausted = t.requestsToday >= limits.requestsPerDay
      const recoveryMs = dailyExhausted
        ? Math.max(0, 86_400_000 - (Date.now() - t.dayWindowStart))
        : 0
      return {
        provider: p,
        rpmCurrent: t.requestsThisMinute,
        rpmLastMinute: t.requestsLastMinute,
        requestsPerMinute: limits.requestsPerMinute,
        requestsToday: t.requestsToday,
        requestsPerDay: limits.requestsPerDay === Infinity ? -1 : limits.requestsPerDay,
        totalRequestsSession: t.totalRequestsSession,
        dailyQuotaExhausted: dailyExhausted,
        recoveryTimeMs: recoveryMs,
      }
    })
}

export function getEmbedderStatus(): { provider: string; model: string; batchSize: number; tokenLimit: number; tokensUsed: number; requestsToday: number; dailyLimit: number } {
  const provider = getEmbeddingProvider()
  const limits = getLimits()
  const model = provider === 'voyage' ? getSelectedVoyageModel()
    : provider === 'github' ? GITHUB_MODELS_EMBEDDING_MODEL
    : JINA_MODEL
  return {
    provider,
    model,
    batchSize: limits.batchSize,
    tokenLimit: limits.tokenLimitPerMinute,
    tokensUsed: getThrottle(provider).tokensUsed,
    requestsToday: getThrottle(provider).requestsToday,
    dailyLimit: limits.requestsPerDay,
  }
}
