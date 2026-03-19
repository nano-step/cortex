/**
 * Embedder — Voyage AI primary, Jina fallback, proxy last resort
 *
 * Voyage 4: 1024 dims, compatible with existing SQLite + Qdrant DB.
 * Token-based throttle: tracks tokens/min, enforces limit BEFORE sending.
 * Batch size reduced to 8 (was 32) to stay well under token limits.
 */

import { getDb, chunkQueries } from './db'
import { BrowserWindow } from 'electron'
import { getProxyUrl, getProxyKey, getJinaApiKey, getVoyageApiKey, getEmbeddingProvider, getSetting, setSetting } from './settings-service'

export const EMBEDDING_DIMENSIONS = 1024
export const LEGACY_EMBEDDING_DIMENSIONS = 384

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const JINA_API_URL = 'https://api.jina.ai/v1/embeddings'
const JINA_MODEL = 'jina-embeddings-v3'

export const VOYAGE_MODELS = [
  { id: 'voyage-3-large', name: 'Voyage 3 Large', dims: 1024, description: 'Best quality, general purpose' },
  { id: 'voyage-3', name: 'Voyage 3', dims: 1024, description: 'Balanced quality/speed' },
  { id: 'voyage-3-lite', name: 'Voyage 3 Lite', dims: 512, description: 'Fastest, lower quality' },
  { id: 'voyage-code-3', name: 'Voyage Code 3', dims: 1024, description: 'Optimized for code' },
] as const

export function getSelectedVoyageModel(): string {
  return getSetting('voyage_model') || 'voyage-3-large'
}

export function setSelectedVoyageModel(modelId: string): void {
  const valid = VOYAGE_MODELS.some(m => m.id === modelId)
  if (valid) setSetting('voyage_model', modelId, false)
}

function getVoyageModelDims(): number {
  const model = VOYAGE_MODELS.find(m => m.id === getSelectedVoyageModel())
  return model?.dims || 1024
}

const BATCH_SIZE = 8
const MAX_TEXT_LENGTH = 8192
const MAX_RETRIES = 3

// Token-based throttle: 80K tokens/min (safe margin under 100K limit)
const TOKEN_LIMIT_PER_MINUTE = 80_000
const TOKEN_WINDOW_MS = 60_000
const MIN_BATCH_INTERVAL_MS = 2_000

interface TokenBucket {
  tokens: number
  windowStart: number
}

const tokenBucket: TokenBucket = { tokens: 0, windowStart: Date.now() }

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)
}

function canSendTokens(count: number): boolean {
  const now = Date.now()
  if (now - tokenBucket.windowStart >= TOKEN_WINDOW_MS) {
    tokenBucket.tokens = 0
    tokenBucket.windowStart = now
  }
  return tokenBucket.tokens + count <= TOKEN_LIMIT_PER_MINUTE
}

function recordTokens(count: number): void {
  const now = Date.now()
  if (now - tokenBucket.windowStart >= TOKEN_WINDOW_MS) {
    tokenBucket.tokens = 0
    tokenBucket.windowStart = now
  }
  tokenBucket.tokens += count
}

async function waitForTokenBudget(needed: number): Promise<void> {
  while (!canSendTokens(needed)) {
    const remaining = TOKEN_WINDOW_MS - (Date.now() - tokenBucket.windowStart)
    const waitMs = Math.min(remaining + 500, 30_000)
    console.log(`[Embedder] Throttle: ${tokenBucket.tokens}/${TOKEN_LIMIT_PER_MINUTE} tokens used, waiting ${Math.round(waitMs / 1000)}s`)
    await new Promise(r => setTimeout(r, waitMs))
    if (Date.now() - tokenBucket.windowStart >= TOKEN_WINDOW_MS) {
      tokenBucket.tokens = 0
      tokenBucket.windowStart = Date.now()
    }
  }
}

// Sequential queue — one request at a time
interface QueueItem {
  resolve: (v: number[][]) => void
  reject: (e: Error) => void
  texts: string[]
  task?: 'retrieval.passage' | 'retrieval.query'
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
    const tokenEstimate = estimateTokens(item.texts)

    await waitForTokenBudget(tokenEstimate)

    const now = Date.now()
    const elapsed = now - lastRequestTime
    if (elapsed < MIN_BATCH_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_BATCH_INTERVAL_MS - elapsed))
    }

    try {
      lastRequestTime = Date.now()
      const result = await embedTextsRaw(item.texts, item.task || 'retrieval.passage')
      recordTokens(tokenEstimate)
      item.resolve(result)
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes('429')
      if (is429) {
        // On 429, wait full minute then retry this item
        console.warn(`[Embedder] Rate limited (429), waiting 60s before retry`)
        tokenBucket.tokens = TOKEN_LIMIT_PER_MINUTE
        tokenBucket.windowStart = Date.now()
        requestQueue.unshift(item)
        await new Promise(r => setTimeout(r, 60_000))
        tokenBucket.tokens = 0
        tokenBucket.windowStart = Date.now()
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

async function embedTexts(texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, texts })
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
  task: 'retrieval.passage' | 'retrieval.query' = 'retrieval.passage'
): Promise<number[][]> {
  const provider = getEmbeddingProvider()
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

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after')) || (2 ** attempt * 10)
      console.warn(`[Embedder] ${provider} rate limited (429), retry in ${retryAfter}s (${attempt + 1}/${MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
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

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    const result: number[][] = new Array(texts.length)
    for (const item of data.data) {
      result[item.index] = item.embedding
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

  const provider = getEmbeddingProvider()
  console.log(`[Embedder] Starting batch embed: ${chunks.length} chunks via ${provider} (batch=${BATCH_SIZE})`)

  await preloadEmbeddingModel()

  const updateEmbedding = chunkQueries.updateEmbedding(db)
  let processed = 0
  let failed = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

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
      const embeddings = await embedTexts(texts)

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
      failed += batch.length
      console.error(`[Embedder] Batch failed (${i}-${i + BATCH_SIZE}):`, (err as Error).message)
    }
  }

  if (failed > 0) {
    console.warn(`[Embedder] Completed with ${failed} failures out of ${chunks.length} chunks`)
  }

  return processed
}

export async function preloadEmbeddingModel(): Promise<void> {
  try {
    await embedTexts(['preload test'])
    const provider = getEmbeddingProvider()
    const model = provider === 'voyage' ? getSelectedVoyageModel() : JINA_MODEL
    console.log(`[Embedder] Ready: ${model} via ${provider} (${EMBEDDING_DIMENSIONS} dims, batch=${BATCH_SIZE})`)
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
  return !!getVoyageApiKey() || !!getJinaApiKey() || (!!getProxyUrl() && !!getProxyKey())
}

export function getEmbedderStatus(): { provider: string; model: string; batchSize: number; tokenLimit: number; tokensUsed: number } {
  const provider = getEmbeddingProvider()
  return {
    provider,
    model: provider === 'voyage' ? getSelectedVoyageModel() : JINA_MODEL,
    batchSize: BATCH_SIZE,
    tokenLimit: TOKEN_LIMIT_PER_MINUTE,
    tokensUsed: tokenBucket.tokens
  }
}
