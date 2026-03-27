import type { SearchResult } from '../vector-search'
import { getDb } from '../db'
import { isQdrantConfigured, searchVectors, syncProjectToQdrant } from '../qdrant-store'

export interface VectorStoreSearchOptions {
  branch?: string
  filter?: Record<string, unknown>
}

export interface VectorStore {
  search(projectId: string, queryVector: number[], topK: number, opts?: VectorStoreSearchOptions): Promise<SearchResult[]>
  isAvailable(): boolean
  name(): string
}

function rowToSearchResult(chunk: Record<string, unknown>, score: number): SearchResult {
  return {
    chunkId: chunk.id as string,
    score,
    content: chunk.content as string,
    filePath: chunk.file_path as string,
    relativePath: chunk.relative_path as string,
    language: chunk.language as string,
    chunkType: chunk.chunk_type as string,
    name: chunk.name as string | null,
    lineStart: chunk.line_start as number,
    lineEnd: chunk.line_end as number,
    dependencies: JSON.parse((chunk.dependencies as string) || '[]'),
    exports: JSON.parse((chunk.exports as string) || '[]'),
    branch: (chunk.branch as string) || 'main',
    repoId: (chunk.repo_id as string) || '',
    repoName: ''
  }
}

function fetchChunksByIds(ids: string[]): Map<string, Record<string, unknown>> {
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const chunks = db.prepare(
    `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
            name, line_start, line_end, dependencies, exports, branch
     FROM chunks WHERE id IN (${placeholders})`
  ).all(...ids) as Array<Record<string, unknown>>
  return new Map(chunks.map(c => [c.id as string, c]))
}

export class SQLiteVectorStore implements VectorStore {
  name(): string { return 'sqlite' }
  isAvailable(): boolean { return true }

  async search(projectId: string, queryVector: number[], topK: number, opts?: VectorStoreSearchOptions): Promise<SearchResult[]> {
    const db = getDb()
    const branchFilter = opts?.branch
    const query = branchFilter
      ? `SELECT c.id, c.repo_id, c.content, c.file_path, c.relative_path, c.language,
                c.chunk_type, c.name, c.line_start, c.line_end, c.dependencies, c.exports, c.branch,
                e.embedding
         FROM chunks c JOIN embeddings e ON c.id = e.chunk_id
         WHERE c.project_id = ? AND c.branch = ? AND e.embedding IS NOT NULL`
      : `SELECT c.id, c.repo_id, c.content, c.file_path, c.relative_path, c.language,
                c.chunk_type, c.name, c.line_start, c.line_end, c.dependencies, c.exports, c.branch,
                e.embedding
         FROM chunks c JOIN embeddings e ON c.id = e.chunk_id
         WHERE c.project_id = ? AND e.embedding IS NOT NULL`

    const rows = branchFilter
      ? db.prepare(query).all(projectId, branchFilter) as any[]
      : db.prepare(query).all(projectId) as any[]

    if (rows.length === 0) return []

    const scored: Array<{ row: any; score: number }> = []
    for (const row of rows) {
      if (!row.embedding) continue
      const embBuffer = row.embedding as Buffer
      const stored = new Float32Array(embBuffer.buffer, embBuffer.byteOffset, embBuffer.byteLength / 4)
      let dot = 0, normA = 0, normB = 0
      for (let i = 0; i < queryVector.length && i < stored.length; i++) {
        dot += queryVector[i] * stored[i]
        normA += queryVector[i] ** 2
        normB += stored[i] ** 2
      }
      const sim = (normA > 0 && normB > 0) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0
      scored.push({ row, score: sim })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ row, score }) => rowToSearchResult(row, score))
  }
}

export class QdrantVectorStore implements VectorStore {
  name(): string { return 'qdrant' }
  isAvailable(): boolean { return isQdrantConfigured() }

  async search(projectId: string, queryVector: number[], topK: number, opts?: VectorStoreSearchOptions): Promise<SearchResult[]> {
    const branchFilter = opts?.branch
    const filter = branchFilter ? { must: [{ key: 'branch', match: { value: branchFilter } }] } : undefined
    const qdrantResults = await searchVectors(projectId, queryVector, topK, filter)
    if (qdrantResults.length === 0) return []
    const chunkMap = fetchChunksByIds(qdrantResults.map(r => r.id))
    return qdrantResults
      .map(qr => { const chunk = chunkMap.get(qr.id); return chunk ? rowToSearchResult(chunk, qr.score) : null })
      .filter((r): r is SearchResult => r !== null)
  }
}

export class HybridVectorStore implements VectorStore {
  private qdrant = new QdrantVectorStore()
  private sqlite = new SQLiteVectorStore()

  name(): string { return 'hybrid' }
  isAvailable(): boolean { return true }

  async search(projectId: string, queryVector: number[], topK: number, opts?: VectorStoreSearchOptions): Promise<SearchResult[]> {
    if (this.qdrant.isAvailable()) {
      try {
        const results = await this.qdrant.search(projectId, queryVector, topK, opts)
        if (results.length > 0) return results

        console.log('[HybridVectorStore] Qdrant returned empty, syncing from SQLite...')
        try {
          const synced = await syncProjectToQdrant(projectId)
          if (synced > 0) {
            const retryResults = await this.qdrant.search(projectId, queryVector, topK, opts)
            if (retryResults.length > 0) return retryResults
          }
        } catch (syncErr) {
          console.error('[HybridVectorStore] Qdrant sync failed:', syncErr)
        }
      } catch (err) {
        const errMsg = String(err instanceof Error ? err.message : err)
        console.warn(`[HybridVectorStore] Qdrant failed (${errMsg}), falling back to SQLite`)
      }
    }

    const db = getDb()
    const chunkCount = (db.prepare('SELECT COUNT(*) as count FROM chunks WHERE project_id = ?').get(projectId) as { count: number })?.count || 0
    if (chunkCount > 50_000) {
      console.warn(`[HybridVectorStore] Large project (${chunkCount} chunks) without Qdrant — vector search may be slow`)
    }

    return this.sqlite.search(projectId, queryVector, topK, opts)
  }
}

let _store: VectorStore | null = null

export function getVectorStore(): VectorStore {
  if (!_store) _store = new HybridVectorStore()
  return _store
}

export function resetVectorStore(): void {
  _store = null
}
