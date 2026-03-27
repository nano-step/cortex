/**
 * Nano-Brain Service — DEPRECATED
 *
 * This service is being phased out in favour of the 3-tier Memory system
 * (electron/services/memory/memory-manager.ts) which provides Core, Archival,
 * and Recall memory with proper vector search and no external CLI dependency.
 *
 * Migration path:
 *   queryNanoBrain()  → searchArchivalMemory() / searchMemory()
 *   initNanoBrain()   → memory system is auto-initialised per project
 *   triggerEmbedding() → embedProjectChunks() in embedder.ts
 *
 * This file is kept temporarily to avoid breaking IPC handlers that still
 * call into it. Remove once IPC modules are refactored (Track A1).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const EXEC_TIMEOUT = 30_000 // 30 seconds
const NPX_PATH = 'npx'

// =====================
// Types
// =====================

export interface NanoBrainStatus {
  /** Whether nano-brain has been initialized */
  initialized: boolean
  /** List of collection names */
  collections: string[]
  /** Total indexed chunks */
  totalChunks: number
  /** Embedding generation status */
  embeddingStatus: 'ready' | 'pending' | 'error' | 'unknown'
}

export interface NanoBrainQueryResult {
  /** Content of the matched chunk */
  content: string
  /** File path of the source */
  filePath: string
  /** Relevance score */
  score: number
  /** Collection name */
  collection: string
}

// =====================
// CLI Helper
// =====================

/**
 * Execute a nano-brain CLI command via npx.
 * Returns stdout/stderr. Throws on timeout or non-zero exit.
 */
async function execNanoBrain(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(NPX_PATH, ['nano-brain', ...args], {
      timeout: EXEC_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024, // 5MB output buffer
      env: { ...process.env, NO_COLOR: '1' } // Disable color codes in output
    })
    return { stdout: result.stdout || '', stderr: result.stderr || '' }
  } catch (err: any) {
    const stderr = err.stderr || ''
    const stdout = err.stdout || ''
    console.error(`[NanoBrain] Command failed: npx nano-brain ${args.join(' ')}`, err.message)
    // Return partial output even on failure
    return { stdout, stderr: stderr || err.message }
  }
}

// =====================
// Initialization
// =====================

/**
 * Initialize nano-brain for a project workspace.
 *
 * Runs `npx nano-brain init --root=<localPath>` then adds a collection
 * named after the project.
 */
export async function initNanoBrain(projectName: string, localPath: string): Promise<boolean> {
  console.warn('[NanoBrain] DEPRECATED: initNanoBrain() — memory system auto-initialises per project via memory-manager.ts')
  try {
    console.log(`[NanoBrain] Initializing for project "${projectName}" at ${localPath}`)

    // Step 1: Init workspace
    const initResult = await execNanoBrain(['init', `--root=${localPath}`])
    if (initResult.stderr && !initResult.stderr.includes('already initialized')) {
      console.warn('[NanoBrain] Init warning:', initResult.stderr)
    }

    // Step 2: Add collection for this project
    const safeName = sanitizeCollectionName(projectName)
    await addCollection(safeName, localPath)

    console.log(`[NanoBrain] Initialized successfully: collection "${safeName}"`)
    return true
  } catch (err) {
    console.error('[NanoBrain] Initialization failed:', err)
    return false
  }
}

// =====================
// Collection Management
// =====================

/**
 * Add a nano-brain collection for a directory.
 */
export async function addCollection(name: string, path: string, pattern?: string): Promise<boolean> {
  try {
    const args = ['collection', 'add', name, path]
    if (pattern) args.push(`--pattern=${pattern}`)

    const result = await execNanoBrain(args)

    if (result.stderr && !result.stderr.includes('already exists')) {
      console.warn(`[NanoBrain] addCollection warning: ${result.stderr}`)
    }

    console.log(`[NanoBrain] Collection added: ${name} → ${path}`)
    return true
  } catch (err) {
    console.error(`[NanoBrain] Failed to add collection "${name}":`, err)
    return false
  }
}

/**
 * Remove a nano-brain collection by name.
 */
export async function removeCollection(name: string): Promise<boolean> {
  try {
    await execNanoBrain(['collection', 'remove', name])
    console.log(`[NanoBrain] Collection removed: ${name}`)
    return true
  } catch (err) {
    console.error(`[NanoBrain] Failed to remove collection "${name}":`, err)
    return false
  }
}

/**
 * List all nano-brain collections.
 */
export async function listCollections(): Promise<string[]> {
  try {
    const result = await execNanoBrain(['collection', 'list'])
    // Parse collection names from output (one per line)
    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('Collections') && !line.startsWith('---'))
  } catch (err) {
    console.error('[NanoBrain] Failed to list collections:', err)
    return []
  }
}

// =====================
// Status
// =====================

/**
 * Get nano-brain system status.
 */
export async function getNanoBrainStatus(): Promise<NanoBrainStatus> {
  try {
    const result = await execNanoBrain(['status'])
    const output = result.stdout

    // Parse status output
    const initialized = !output.includes('not initialized') && output.length > 0
    const collections = await listCollections()

    // Try to extract chunk count from status output
    const chunkMatch = output.match(/(\d+)\s*chunks?/i)
    const totalChunks = chunkMatch ? parseInt(chunkMatch[1], 10) : 0

    // Parse embedding status
    let embeddingStatus: NanoBrainStatus['embeddingStatus'] = 'unknown'
    if (output.includes('embeddings: ready') || output.includes('✓')) {
      embeddingStatus = 'ready'
    } else if (output.includes('embeddings: pending') || output.includes('unembedded')) {
      embeddingStatus = 'pending'
    } else if (output.includes('embeddings: error') || output.includes('✗')) {
      embeddingStatus = 'error'
    }

    return { initialized, collections, totalChunks, embeddingStatus }
  } catch (err) {
    console.error('[NanoBrain] Failed to get status:', err)
    return {
      initialized: false,
      collections: [],
      totalChunks: 0,
      embeddingStatus: 'unknown'
    }
  }
}

// =====================
// Query
// =====================

/**
 * Query nano-brain for supplementary context.
 * Returns parsed results from `npx nano-brain query <query> --json`.
 */
export async function queryNanoBrain(
  query: string,
  options?: { limit?: number; collection?: string }
): Promise<NanoBrainQueryResult[]> {
  console.warn('[NanoBrain] DEPRECATED: queryNanoBrain() — migrate to searchMemory() in memory-manager.ts')
  try {
    const args = ['query', query, '--json']
    if (options?.limit) args.push('-n', String(options.limit))
    if (options?.collection) args.push('-c', options.collection)

    const result = await execNanoBrain(args)

    if (!result.stdout.trim()) return []

    // Parse JSON output
    const parsed = JSON.parse(result.stdout)

    // nano-brain returns an array of results
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => ({
        content: item.content || item.text || '',
        filePath: item.filePath || item.file || item.path || '',
        score: typeof item.score === 'number' ? item.score : 0,
        collection: item.collection || item.source || ''
      }))
    }

    // Or it might wrap in a results key
    if (parsed.results && Array.isArray(parsed.results)) {
      return parsed.results.map((item: any) => ({
        content: item.content || item.text || '',
        filePath: item.filePath || item.file || item.path || '',
        score: typeof item.score === 'number' ? item.score : 0,
        collection: item.collection || item.source || ''
      }))
    }

    return []
  } catch (err) {
    console.error('[NanoBrain] Query failed:', err)
    return []
  }
}

/**
 * Exact search in nano-brain.
 */
export async function searchNanoBrain(
  term: string,
  options?: { limit?: number; collection?: string }
): Promise<NanoBrainQueryResult[]> {
  try {
    const args = ['search', term, '--json']
    if (options?.limit) args.push('-n', String(options.limit))
    if (options?.collection) args.push('-c', options.collection)

    const result = await execNanoBrain(args)
    if (!result.stdout.trim()) return []

    const parsed = JSON.parse(result.stdout)
    const items = Array.isArray(parsed) ? parsed : (parsed.results || [])

    return items.map((item: any) => ({
      content: item.content || item.text || '',
      filePath: item.filePath || item.file || item.path || '',
      score: typeof item.score === 'number' ? item.score : 0,
      collection: item.collection || item.source || ''
    }))
  } catch (err) {
    console.error('[NanoBrain] Search failed:', err)
    return []
  }
}

// =====================
// Embedding
// =====================

/**
 * Trigger nano-brain embedding generation for all unembedded chunks.
 */
export async function triggerEmbedding(): Promise<boolean> {
  try {
    console.log('[NanoBrain] Triggering embedding generation...')
    const result = await execNanoBrain(['embed'])

    if (result.stderr && !result.stderr.includes('warn')) {
      console.warn('[NanoBrain] Embedding warning:', result.stderr)
    }

    console.log('[NanoBrain] Embedding complete:', result.stdout.trim())
    return true
  } catch (err) {
    console.error('[NanoBrain] Embedding failed:', err)
    return false
  }
}

// =====================
// Helpers
// =====================

/**
 * Sanitize a project name for use as a nano-brain collection name.
 * Collections must be alphanumeric with dashes/underscores.
 */
function sanitizeCollectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'project'
}
