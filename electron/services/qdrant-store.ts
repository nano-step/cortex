import { QdrantClient } from '@qdrant/js-client-rest'
import { createHash } from 'crypto'
import { getSetting } from './settings-service'
import { EMBEDDING_DIMENSIONS } from './embedder'
import { getDb } from './db'

export function toQdrantId(chunkId: string): string {
  const hex = createHash('md5').update(chunkId).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

let client: QdrantClient | null = null

function getClient(): QdrantClient {
  if (client) return client
  const url = getSetting('qdrant_url')
  const apiKey = getSetting('qdrant_api_key')
  if (!url) throw new Error('Qdrant URL not configured — set in Settings > Cloud Services')
  client = new QdrantClient({ url, apiKey: apiKey || undefined })
  return client
}

export function resetQdrantClient(): void {
  client = null
}

function collectionName(projectId: string): string {
  return `cortex_${projectId.replace(/-/g, '_')}`
}

async function ensureCollection(projectId: string): Promise<void> {
  const qdrant = getClient()
  const name = collectionName(projectId)
  const { collections } = await qdrant.getCollections()
  const exists = collections.some(c => c.name === name)

  if (!exists) {
    await qdrant.createCollection(name, {
      vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' }
    })
    console.log(`[Qdrant] Created collection ${name}`)
  }

  try {
    await qdrant.createPayloadIndex(name, {
      field_name: 'branch',
      field_schema: 'keyword'
    })
  } catch {
    // Index already exists — ignore
  }
}

export async function upsertVectors(
  projectId: string,
  points: Array<{ id: string; vector: number[]; payload?: Record<string, unknown> }>
): Promise<void> {
  if (points.length === 0) return
  await ensureCollection(projectId)
  const qdrant = getClient()
  const name = collectionName(projectId)

  const BATCH = 100
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH)
    await qdrant.upsert(name, {
      wait: true,
      points: batch.map(p => ({
        id: toQdrantId(p.id),
        vector: p.vector,
        payload: { ...p.payload, chunk_id: p.id }
      }))
    })
  }
}

export async function searchVectors(
  projectId: string,
  queryVector: number[],
  topK: number,
  filter?: Record<string, unknown>
): Promise<Array<{ id: string; score: number }>> {
  const qdrant = getClient()
  const name = collectionName(projectId)

  try {
    const results = await qdrant.search(name, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
      filter: filter || undefined
    })
    return results.map(r => ({
      id: (r.payload as any)?.chunk_id || (typeof r.id === 'string' ? r.id : String(r.id)),
      score: r.score
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not found') || msg.includes('Not found')) return []
    throw err
  }
}

export async function deleteProjectVectors(projectId: string): Promise<void> {
  const qdrant = getClient()
  const name = collectionName(projectId)
  try {
    await qdrant.deleteCollection(name)
  } catch { /* non-existent collection — safe to ignore */ }
}

export function isQdrantConfigured(): boolean {
  return !!getSetting('qdrant_url')
}

const syncFailedProjects = new Set<string>()
const syncInProgress = new Set<string>()

export function resetSyncCache(projectId?: string): void {
  if (projectId) {
    syncFailedProjects.delete(projectId)
    syncInProgress.delete(projectId)
  } else {
    syncFailedProjects.clear()
    syncInProgress.clear()
  }
}

export async function recreateCollection(projectId: string): Promise<void> {
  if (!isQdrantConfigured()) return
  const qdrant = getClient()
  const name = collectionName(projectId)
  try { await qdrant.deleteCollection(name) } catch { /* ignore */ }
  await qdrant.createCollection(name, {
    vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' }
  })
  try {
    await qdrant.createPayloadIndex(name, {
      field_name: 'branch',
      field_schema: 'keyword'
    })
  } catch { /* ignore */ }
  console.log(`[Qdrant] Recreated collection ${name} with branch index`)
}

export async function syncProjectToQdrant(projectId: string): Promise<number> {
  if (!isQdrantConfigured()) return 0
  if (syncFailedProjects.has(projectId)) return 0
  if (syncInProgress.has(projectId)) return 0
  syncInProgress.add(projectId)

  const db = getDb()
  const embeddedChunks = db.prepare(
    'SELECT id, embedding, branch FROM chunks WHERE project_id = ? AND embedding IS NOT NULL'
  ).all(projectId) as Array<{ id: string; embedding: Buffer; branch: string }>

  if (embeddedChunks.length === 0) return 0

  const expectedBytes = EMBEDDING_DIMENSIONS * 4
  const validChunks = embeddedChunks.filter(c => c.embedding.byteLength === expectedBytes)

  if (validChunks.length === 0) {
    console.warn(`[Qdrant] No ${EMBEDDING_DIMENSIONS}d embeddings found for project ${projectId} (${embeddedChunks.length} chunks have wrong dimensions, need re-embed)`)
    syncFailedProjects.add(projectId)
    return 0
  }

  if (validChunks.length < embeddedChunks.length) {
    console.warn(`[Qdrant] Skipping ${embeddedChunks.length - validChunks.length} legacy embeddings (wrong dimensions)`)
  }

  const points = validChunks.map(c => ({
    id: c.id,
    vector: Array.from(new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4)),
    payload: { branch: c.branch || 'main' }
  }))

  try {
    await upsertVectors(projectId, points)
    console.log(`[Qdrant] Synced ${points.length} vectors for project ${projectId}`)
    return points.length
  } catch (err) {
    console.error('[Qdrant] Sync failed, disabling for this project:', (err as Error).message?.slice(0, 100))
    syncFailedProjects.add(projectId)
    throw err
  } finally {
    syncInProgress.delete(projectId)
  }
}
