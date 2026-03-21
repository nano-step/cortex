import { getDb } from './db'
import { embedQuery } from './embedder'
import { rerank } from './learned-reranker'
import { isQdrantConfigured, searchVectors } from './qdrant-store'
import { cloudRerank, isCloudRerankerEnabled } from './cloud-reranker'
import { syncProjectToQdrant } from './qdrant-store'

export interface SearchResult {
  chunkId: string
  score: number
  content: string
  filePath: string
  relativePath: string
  language: string
  chunkType: string
  name: string | null
  lineStart: number
  lineEnd: number
  dependencies: string[]
  exports: string[]
  branch: string
  repoId: string
  repoName: string
}

/**
 * Hybrid search: vector similarity + keyword matching
 * Returns top-k results ranked by combined score
 */
export async function hybridSearch(
  projectId: string,
  query: string,
  topK: number = 10,
  branch?: string
): Promise<SearchResult[]> {
  const candidateMultiplier = isCloudRerankerEnabled() ? 5 : 2
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(projectId, query, topK * candidateMultiplier, branch),
    keywordSearch(projectId, query, topK * Math.ceil(candidateMultiplier / 2), branch)
  ])

  const scoreMap = new Map<string, { score: number; result: SearchResult }>()

  for (const result of vectorResults) {
    scoreMap.set(result.chunkId, {
      score: result.score * 0.7,
      result
    })
  }

  for (const result of keywordResults) {
    const existing = scoreMap.get(result.chunkId)
    if (existing) {
      existing.score += result.score * 0.3
    } else {
      scoreMap.set(result.chunkId, {
        score: result.score * 0.3,
        result
      })
    }
  }

  let merged = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.result, score: entry.score }))

  if (isCloudRerankerEnabled()) {
    merged = await cloudRerank(query, merged, topK)
  } else {
    merged = merged.slice(0, topK)
  }

  return rerank(projectId, query, merged)
}

/**
 * Pure vector similarity search
 */
async function vectorSearch(
  projectId: string,
  query: string,
  topK: number,
  branch?: string
): Promise<SearchResult[]> {
  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(query)
  } catch (err) {
    console.error('Failed to embed query:', err)
    return []
  }

  if (queryEmbedding.length === 0) return []

  if (isQdrantConfigured()) {
    return qdrantVectorSearch(projectId, queryEmbedding, topK, branch)
  }

  return bruteForceVectorSearch(projectId, queryEmbedding, topK, branch)
}

async function qdrantVectorSearch(
  projectId: string,
  queryEmbedding: number[],
  topK: number,
  branch?: string
): Promise<SearchResult[]> {
  try {
    const filter = branch ? { must: [{ key: 'branch', match: { value: branch } }] } : undefined
    const qdrantResults = await searchVectors(projectId, queryEmbedding, topK, filter)
    if (qdrantResults.length === 0) {
      return bruteForceVectorSearch(projectId, queryEmbedding, topK, branch)
    }

    const db = getDb()
    const ids = qdrantResults.map(r => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const chunks = db.prepare(
      `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
              name, line_start, line_end, dependencies, exports, branch
       FROM chunks WHERE id IN (${placeholders})`
    ).all(...ids) as Array<Record<string, unknown>>

    const chunkMap = new Map(chunks.map(c => [c.id as string, c]))

    return qdrantResults
      .map(qr => {
        const chunk = chunkMap.get(qr.id)
        if (!chunk) return null
        return {
          chunkId: chunk.id as string,
          score: qr.score,
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
      })
      .filter((r): r is SearchResult => r !== null)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errData = (err as any)?.data?.status?.error || ''
    const combined = `${errMsg} ${errData}`.toLowerCase()
    const isNotFound = combined.includes('not found') || combined.includes("doesn't exist")

    if (isNotFound) {
      console.log('[VectorSearch] Qdrant collection missing, syncing from SQLite...')
      try {
        const synced = await syncProjectToQdrant(projectId)
        if (synced > 0) {
          const filter = branch ? { must: [{ key: 'branch', match: { value: branch } }] } : undefined
          const retryResults = await searchVectors(projectId, queryEmbedding, topK, filter)
          if (retryResults.length > 0) {
            const db = getDb()
            const ids = retryResults.map(r => r.id)
            const placeholders = ids.map(() => '?').join(',')
            const chunks = db.prepare(
              `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
                      name, line_start, line_end, dependencies, exports, branch
               FROM chunks WHERE id IN (${placeholders})`
            ).all(...ids) as Array<Record<string, unknown>>
            const chunkMap = new Map(chunks.map(c => [c.id as string, c]))
            return retryResults
              .map(qr => {
                const chunk = chunkMap.get(qr.id)
                if (!chunk) return null
                return {
                  chunkId: chunk.id as string,
                  score: qr.score,
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
              })
              .filter((r): r is SearchResult => r !== null)
          }
        }
      } catch (syncErr) {
        console.error('[VectorSearch] Qdrant auto-sync failed:', syncErr)
      }
    } else {
      console.error('[VectorSearch] Qdrant search failed, falling back to brute-force:', err)
    }

    return bruteForceVectorSearch(projectId, queryEmbedding, topK, branch)
  }
}

function bruteForceVectorSearch(
  projectId: string,
  queryEmbedding: number[],
  topK: number,
  branch?: string
): SearchResult[] {
  const db = getDb()

  const sql = branch
    ? `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
              name, line_start, line_end, dependencies, exports, embedding, branch
       FROM chunks
       WHERE project_id = ? AND branch = ? AND embedding IS NOT NULL`
    : `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
              name, line_start, line_end, dependencies, exports, embedding, branch
       FROM chunks
       WHERE project_id = ? AND embedding IS NOT NULL`
  const chunks = branch
    ? (db.prepare(sql).all(projectId, branch) as Array<any>)
    : (db.prepare(sql).all(projectId) as Array<any>)

  return chunks
    .map((chunk) => {
      const embedding = bufferToFloatArray(chunk.embedding)
      const score = cosineSimilarity(queryEmbedding, embedding)
      return {
        chunkId: chunk.id,
        score,
        content: chunk.content,
        filePath: chunk.file_path,
        relativePath: chunk.relative_path,
        language: chunk.language,
        chunkType: chunk.chunk_type,
        name: chunk.name,
        lineStart: chunk.line_start,
        lineEnd: chunk.line_end,
        dependencies: JSON.parse(chunk.dependencies || '[]'),
        exports: JSON.parse(chunk.exports || '[]'),
        branch: chunk.branch || 'main',
        repoId: chunk.repo_id || '',
        repoName: ''
      }
    })
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Keyword-based search (BM25-like scoring)
 */
function keywordSearch(
  projectId: string,
  query: string,
  topK: number,
  branch?: string
): SearchResult[] {
  const db = getDb()

  // Tokenize query into keywords
  const keywords = query
    .toLowerCase()
    .split(/[\s,.;:!?(){}[\]'"]+/)
    .filter((k) => k.length >= 2)

  if (keywords.length === 0) return []

  // Search by each keyword and combine scores
  const scoreMap = new Map<string, { hits: number; chunk: any }>()

  for (const keyword of keywords) {
    const pattern = `%${keyword}%`

    // Search in content (optionally filtered by branch)
    const sql = branch
      ? `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
                name, line_start, line_end, dependencies, exports, branch
         FROM chunks
         WHERE project_id = ? AND branch = ? AND (content LIKE ? OR name LIKE ? OR relative_path LIKE ?)
         LIMIT 50`
      : `SELECT id, repo_id, content, file_path, relative_path, language, chunk_type,
                name, line_start, line_end, dependencies, exports, branch
         FROM chunks
         WHERE project_id = ? AND (content LIKE ? OR name LIKE ? OR relative_path LIKE ?)
         LIMIT 50`
    const contentHits = branch
      ? (db.prepare(sql).all(projectId, branch, pattern, pattern, pattern) as Array<any>)
      : (db.prepare(sql).all(projectId, pattern, pattern, pattern) as Array<any>)

    for (const chunk of contentHits) {
      const existing = scoreMap.get(chunk.id)
      if (existing) {
        existing.hits++
      } else {
        scoreMap.set(chunk.id, { hits: 1, chunk })
      }
    }
  }

  // Score based on hit count and normalize
  return Array.from(scoreMap.values())
    .map(({ hits, chunk }) => ({
      chunkId: chunk.id,
      score: hits / keywords.length, // Normalize 0-1
      content: chunk.content,
      filePath: chunk.file_path,
      relativePath: chunk.relative_path,
      language: chunk.language,
      chunkType: chunk.chunk_type,
      name: chunk.name,
      lineStart: chunk.line_start,
      lineEnd: chunk.line_end,
      dependencies: JSON.parse(chunk.dependencies || '[]'),
      exports: JSON.parse(chunk.exports || '[]'),
      branch: chunk.branch || 'main',
      repoId: chunk.repo_id || '',
      repoName: ''
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Convert SQLite BLOB (Buffer) back to float array
 */
function bufferToFloatArray(buffer: Buffer): number[] {
  if (!buffer || buffer.length === 0) return []
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 4
  )
  return Array.from(float32)
}
