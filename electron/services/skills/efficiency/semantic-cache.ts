/**
 * Semantic Cache — Embedding-based response cache
 */
import Database from 'better-sqlite3'
import { getDb } from '../../db'
import { randomUUID } from 'crypto'
import { embedQuery } from '../../embedder'
import { generateCacheKey, cosineSimilarity, bufferToFloat32 } from './cache-key'

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

export function initCacheSchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id TEXT PRIMARY KEY,
      query_hash TEXT NOT NULL,
      query_text TEXT NOT NULL,
      query_embedding BLOB,
      response TEXT NOT NULL,
      model TEXT,
      project_id TEXT,
      tokens_saved INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_hash ON semantic_cache(query_hash);
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON semantic_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_cache_project ON semantic_cache(project_id);
  `)

  // Migration: add project_id column if it doesn't exist yet (for existing installs)
  try {
    db.exec(`ALTER TABLE semantic_cache ADD COLUMN project_id TEXT`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_project ON semantic_cache(project_id)`)
  } catch {
    // Column already exists — expected on fresh installs
  }
}

export async function getCachedResponse(query: string, threshold: number = 0.92): Promise<{ response: string, tokensSaved: number } | null> {
  try {
    const db = getDb()
    const now = Date.now()

    // Try exact hash match first
    const hash = generateCacheKey(query)
    const exact = db.prepare('SELECT * FROM semantic_cache WHERE query_hash = ? AND expires_at > ?').get(hash, now) as { response: string, tokens_saved: number, id: string } | undefined
    if (exact) {
      db.prepare('UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = ?').run(exact.id)
      return { response: exact.response, tokensSaved: exact.tokens_saved }
    }

    // Try semantic similarity
    const queryEmbedding = await embedQuery(query)
    const entries = db.prepare('SELECT * FROM semantic_cache WHERE query_embedding IS NOT NULL AND expires_at > ?').all(now) as Array<{ id: string, query_embedding: Buffer, response: string, tokens_saved: number }>

    for (const entry of entries) {
      const entryEmbedding = bufferToFloat32(entry.query_embedding)
      const sim = cosineSimilarity(queryEmbedding, entryEmbedding)
      if (sim >= threshold) {
        db.prepare('UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = ?').run(entry.id)
        return { response: entry.response, tokensSaved: entry.tokens_saved }
      }
    }

    return null
  } catch (err) {
    console.error('[SemanticCache] Lookup failed:', err)
    return null
  }
}

export async function cacheResponse(query: string, response: string, model: string, tokenCount: number, projectId?: string): Promise<void> {
  try {
    const db = getDb()
    const hash = generateCacheKey(query)
    let embeddingBuffer: Buffer | null = null
    try {
      const embedding = await embedQuery(query)
      embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer)
    } catch { /* skip embedding */ }

    db.prepare('INSERT OR REPLACE INTO semantic_cache (id, query_hash, query_text, query_embedding, response, model, project_id, tokens_saved, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), hash, query, embeddingBuffer, response, model, projectId ?? null, tokenCount, Date.now() + CACHE_TTL
    )
  } catch (err) {
    console.error('[SemanticCache] Cache write failed:', err)
  }
}

export function invalidateCacheForQuery(query: string): number {
  try {
    const db = getDb()
    const hash = generateCacheKey(query)
    const result = db.prepare('DELETE FROM semantic_cache WHERE query_hash = ?').run(hash)
    return result.changes
  } catch {
    return 0
  }
}

export function invalidateCache(): number {
  try {
    const db = getDb()
    const result = db.prepare('DELETE FROM semantic_cache').run()
    return result.changes
  } catch (err) {
    console.error('[SemanticCache] Invalidation failed:', err)
    return 0
  }
}

export function invalidateCacheForProject(projectId: string): number {
  try {
    const db = getDb()
    const result = db.prepare('DELETE FROM semantic_cache WHERE project_id = ?').run(projectId)
    if (result.changes > 0) {
      console.log(`[SemanticCache] Invalidated ${result.changes} entries for project ${projectId}`)
    }
    return result.changes
  } catch (err) {
    console.error('[SemanticCache] Project invalidation failed:', err)
    return 0
  }
}

export function getCacheStats(): { totalEntries: number, totalHits: number, totalTokensSaved: number } {
  try {
    const db = getDb()
    const stats = db.prepare('SELECT COUNT(*) as total, SUM(hit_count) as hits, SUM(tokens_saved * hit_count) as saved FROM semantic_cache').get() as { total: number, hits: number | null, saved: number | null }
    return { totalEntries: stats.total, totalHits: stats.hits || 0, totalTokensSaved: stats.saved || 0 }
  } catch (err) {
    console.error('[SemanticCache] Stats failed:', err)
    return { totalEntries: 0, totalHits: 0, totalTokensSaved: 0 }
  }
}