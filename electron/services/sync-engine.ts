/**
 * Sync Engine — Incremental updates when repositories change
 *
 * Strategy:
 * - For GitHub repos: git pull → diff → re-index only changed files
 * - For local repos: file watcher (chokidar) → detect changes → re-index delta
 * - Complexity: O(changed_files) not O(total_files)
 *
 * Sync Triggers:
 * 1. Manual: User clicks "Refresh Brain"
 * 2. Auto: File watcher detects changes (local repos)
 * 3. On Import: If project exists → UPDATE mode (delta sync)
 */

import { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { join, relative } from 'path'
import { readFile, stat } from 'fs/promises'
import { getDb, repoQueries, chunkQueries } from './db'
import { chunkCode } from './code-chunker'
import { readFileContent, scanDirectory, getDirectoryTree } from './file-scanner'
import { pullLatest, getChangedFiles, getLatestSha, switchBranch, getCurrentBranch, listBranches, getGitHubToken, getBranchDiffFiles } from './git-service'
import { embedProjectChunks } from './embedder'
import { invalidateCacheForProject } from './skills/efficiency/semantic-cache'
import { rebuildGraphForFiles } from './skills/rag/graph-builder'

// Active file watchers per repo
const activeWatchers = new Map<string, FSWatcher>()

export interface SyncResult {
  repoId: string
  filesAdded: number
  filesModified: number
  filesDeleted: number
  chunksAdded: number
  chunksRemoved: number
  newSha: string | null
}

/**
 * Sync a GitHub repository (pull + delta re-index)
 */
export async function syncGithubRepo(
  projectId: string,
  repoId: string,
  window: BrowserWindow | null
): Promise<SyncResult> {
  const db = getDb()
  const repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as any
  if (!repo) throw new Error('Repository not found')

  const sendProgress = (msg: string) => {
    window?.webContents.send('sync:progress', { repoId, message: msg })
  }

  sendProgress('Đang pull changes từ GitHub...')

  // Get stored token
  const token = getGitHubToken(repoId) || undefined

  // Pull latest
  const localPath = join(
    require('electron').app.getPath('userData'),
    'cortex-data',
    'clones',
    repoId
  )
  const { newSha, changed } = await pullLatest(localPath, token)

  if (!changed) {
    sendProgress('Không có thay đổi mới.')
    return {
      repoId,
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksAdded: 0,
      chunksRemoved: 0,
      newSha
    }
  }

  sendProgress('Đang phân tích thay đổi...')

  // Get changed files
  const oldSha = repo.last_indexed_sha
  const { added, modified, deleted } = await getChangedFiles(localPath, oldSha, newSha)

  let chunksAdded = 0
  let chunksRemoved = 0

  const insertChunk = chunkQueries.insert(db)

  // Process deletions
  for (const filePath of deleted) {
    const deleteResult = chunkQueries.deleteByFile(db).run(repoId, filePath)
    chunksRemoved += deleteResult.changes
  }

  // Process additions and modifications
  const filesToProcess = [...added, ...modified]

  for (const relPath of filesToProcess) {
    sendProgress(`Đang cập nhật: ${relPath}`)

    // Delete old chunks for modified files
    if (modified.includes(relPath)) {
      const deleteResult = chunkQueries.deleteByFile(db).run(repoId, relPath)
      chunksRemoved += deleteResult.changes
    }

    // Read and chunk the file
    try {
      const fullPath = join(localPath, relPath)
      const content = await readFileContent(fullPath)
      const ext = relPath.split('.').pop() || ''
      const language = detectLanguage(ext)

      const activeBranch = repo.active_branch || 'main'
      const chunks = chunkCode(content, fullPath, relPath, language, projectId, repoId, activeBranch)

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.projectId,
          chunk.repoId,
          chunk.filePath,
          chunk.relativePath,
          chunk.language,
          chunk.chunkType,
          chunk.name,
          chunk.content,
          chunk.lineStart,
          chunk.lineEnd,
          chunk.tokenEstimate,
          JSON.stringify(chunk.dependencies),
          JSON.stringify(chunk.exports),
          JSON.stringify(chunk.metadata),
          chunk.branch
        )
        chunksAdded++
      }
    } catch (err) {
      console.error(`Failed to process ${relPath}:`, err)
    }
  }

  // Update repo record
  repoQueries.updateIndexed(db).run(
    newSha,
    Date.now(),
    'ready',
    repo.total_files + added.length - deleted.length,
    repo.total_chunks + chunksAdded - chunksRemoved,
    repoId
  )

  // Re-embed new chunks
  sendProgress('Đang cập nhật embeddings...')
  try {
    await embedProjectChunks(projectId)
  } catch {
    // Non-fatal
  }

  invalidateCacheForProject(projectId)

  const changedFiles = [...added, ...modified]
  if (changedFiles.length > 0) {
    try {
      rebuildGraphForFiles(projectId, changedFiles)
    } catch (graphErr) {
      console.warn('[Sync] Graph rebuild failed (non-fatal):', graphErr)
    }
  }

  sendProgress('Sync hoàn tất!')

  return {
    repoId,
    filesAdded: added.length,
    filesModified: modified.length,
    filesDeleted: deleted.length,
    chunksAdded,
    chunksRemoved,
    newSha
  }
}

/**
 * Sync a local repository (scan for changes)
 */
export async function syncLocalRepo(
  projectId: string,
  repoId: string,
  localPath: string,
  window: BrowserWindow | null
): Promise<SyncResult> {
  const db = getDb()
  const repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as any
  if (!repo) throw new Error('Repository not found')

  const sendProgress = (msg: string) => {
    window?.webContents.send('sync:progress', { repoId, message: msg })
  }

  sendProgress('Đang quét thay đổi...')

  // Get current files
  const currentFiles = await scanDirectory(localPath)
  const currentFileMap = new Map(currentFiles.map((f) => [f.relativePath, f]))

  // Get indexed files from DB
  const indexedFiles = db
    .prepare(
      'SELECT DISTINCT relative_path, MAX(created_at) as indexed_at FROM chunks WHERE repo_id = ? GROUP BY relative_path'
    )
    .all(repoId) as Array<{ relative_path: string; indexed_at: number }>

  const indexedFileMap = new Map(indexedFiles.map((f) => [f.relative_path, f.indexed_at]))

  // Determine changes
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  // New or modified files
  for (const [relPath, file] of currentFileMap) {
    const indexedAt = indexedFileMap.get(relPath)
    if (!indexedAt) {
      added.push(relPath)
    } else if (file.lastModified > indexedAt) {
      modified.push(relPath)
    }
  }

  // Deleted files
  for (const [relPath] of indexedFileMap) {
    if (!currentFileMap.has(relPath)) {
      deleted.push(relPath)
    }
  }

  const totalChanges = added.length + modified.length + deleted.length
  if (totalChanges === 0) {
    sendProgress('Không có thay đổi.')
    return {
      repoId,
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksAdded: 0,
      chunksRemoved: 0,
      newSha: null
    }
  }

  sendProgress(`Phát hiện ${totalChanges} thay đổi. Đang cập nhật...`)

  let chunksAdded = 0
  let chunksRemoved = 0

  const insertChunk = chunkQueries.insert(db)

  // Delete chunks for removed/modified files
  for (const relPath of [...deleted, ...modified]) {
    const result = chunkQueries.deleteByFile(db).run(repoId, relPath)
    chunksRemoved += result.changes
  }

  // Add chunks for new/modified files
  for (const relPath of [...added, ...modified]) {
    try {
      const file = currentFileMap.get(relPath)
      if (!file) continue

      sendProgress(`Cập nhật: ${relPath}`)
      const content = await readFileContent(file.path)
      const activeBranch = repo.active_branch || 'main'
      const chunks = chunkCode(content, file.path, relPath, file.language, projectId, repoId, activeBranch)

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.projectId,
          chunk.repoId,
          chunk.filePath,
          chunk.relativePath,
          chunk.language,
          chunk.chunkType,
          chunk.name,
          chunk.content,
          chunk.lineStart,
          chunk.lineEnd,
          chunk.tokenEstimate,
          JSON.stringify(chunk.dependencies),
          JSON.stringify(chunk.exports),
          JSON.stringify(chunk.metadata),
          chunk.branch
        )
        chunksAdded++
      }
    } catch (err) {
      console.error(`Failed to process ${relPath}:`, err)
    }
  }

  // Update repo record
  repoQueries.updateIndexed(db).run(
    null,
    Date.now(),
    'ready',
    currentFiles.length,
    (repo.total_chunks || 0) + chunksAdded - chunksRemoved,
    repoId
  )

  // Re-embed new chunks
  sendProgress('Đang cập nhật embeddings...')
  try {
    await embedProjectChunks(projectId)
  } catch {
    // Non-fatal
  }

  invalidateCacheForProject(projectId)

  const changedFilesLocal = [...added, ...modified]
  if (changedFilesLocal.length > 0) {
    try {
      rebuildGraphForFiles(projectId, changedFilesLocal)
    } catch (graphErr) {
      console.warn('[Sync] Graph rebuild failed (non-fatal):', graphErr)
    }
  }

  sendProgress('Sync hoàn tất!')

  return {
    repoId,
    filesAdded: added.length,
    filesModified: modified.length,
    filesDeleted: deleted.length,
    chunksAdded,
    chunksRemoved,
    newSha: null
  }
}

/**
 * Start watching a local directory for changes
 */
export function startFileWatcher(
  repoId: string,
  localPath: string,
  onChanged: () => void
): void {
  // Stop existing watcher
  stopFileWatcher(repoId)

  let debounceTimer: NodeJS.Timeout | null = null

  const watcher = watch(localPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return

    // Skip irrelevant files
    if (
      filename.includes('node_modules') ||
      filename.includes('.git') ||
      filename.includes('dist') ||
      filename.includes('build') ||
      filename.includes('out')
    ) {
      return
    }

    // Debounce: wait 2 seconds after last change before triggering sync
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      onChanged()
    }, 2000)
  })

  activeWatchers.set(repoId, watcher)
}

/**
 * Stop watching a directory
 */
export function stopFileWatcher(repoId: string): void {
  const watcher = activeWatchers.get(repoId)
  if (watcher) {
    watcher.close()
    activeWatchers.delete(repoId)
  }
}

/**
 * Stop all file watchers (app shutdown)
 */
export function stopAllWatchers(): void {
  for (const [repoId, watcher] of activeWatchers) {
    watcher.close()
  }
  activeWatchers.clear()
}

function detectLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    vue: 'vue',
    svelte: 'svelte',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash'
  }
  return map[ext] || 'text'
}

/**
 * Switch branch and re-index changes
 * Uses delta indexing if the target branch was previously indexed,
 * otherwise falls back to full re-index.
 */
export async function indexBranch(
  projectId: string,
  repoId: string,
  targetBranch: string,
  window: BrowserWindow | null
): Promise<SyncResult & { success: boolean; error?: string }> {
  const db = getDb()
  const repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as any
  if (!repo) return { success: false, error: 'Repository not found', repoId, filesAdded: 0, filesModified: 0, filesDeleted: 0, chunksAdded: 0, chunksRemoved: 0, newSha: null }

  const sendProgress = (msg: string) => {
    window?.webContents.send('sync:progress', { repoId, message: msg })
  }

  const localPath = join(
    require('electron').app.getPath('userData'),
    'cortex-data',
    'clones',
    repoId
  )

  try {
    // 1. Update repo status
    repoQueries.updateStatus(db).run('indexing', null, repoId)

    // 2. Switch to target branch
    sendProgress(`Đang chuyển sang branch ${targetBranch}...`)
    const { sha } = await switchBranch(localPath, targetBranch)

    // 3. Check if target branch was previously indexed
    const existingChunks = chunkQueries.getByRepoBranch(db).all(repoId, targetBranch) as any[]
    const previousBranch = repo.active_branch || 'main'
    const hasPreviousIndex = existingChunks.length > 0 && previousBranch !== targetBranch

    let chunksAdded = 0
    let chunksRemoved = 0
    let filesAdded = 0
    let filesModified = 0
    let filesDeleted = 0
    const insertChunk = chunkQueries.insert(db)

    if (hasPreviousIndex) {
      // ===== DELTA PATH: Only re-index changed files =====
      sendProgress(`Đang phân tích thay đổi giữa ${previousBranch} và ${targetBranch}...`)
      const diff = await getBranchDiffFiles(localPath, previousBranch, targetBranch)
      const totalChanges = diff.added.length + diff.modified.length + diff.deleted.length

      if (totalChanges === 0) {
        // No diff detected — branches might be identical or diff failed
        // Just update the active branch and move on
        sendProgress('Không phát hiện thay đổi giữa hai branch.')
      } else {
        sendProgress(`Phát hiện ${totalChanges} file thay đổi. Đang cập nhật...`)

        // Process deleted files
        for (const filePath of diff.deleted) {
          const deleteResult = chunkQueries.deleteByFileBranch(db).run(repoId, filePath, targetBranch)
          chunksRemoved += deleteResult.changes
        }
        filesDeleted = diff.deleted.length

        // Process added and modified files
        const filesToProcess = [...diff.added, ...diff.modified]
        filesAdded = diff.added.length
        filesModified = diff.modified.length

        for (const relPath of filesToProcess) {
          sendProgress(`Đang cập nhật: ${relPath}`)

          // Delete old chunks for modified files
          if (diff.modified.includes(relPath)) {
            const deleteResult = chunkQueries.deleteByFileBranch(db).run(repoId, relPath, targetBranch)
            chunksRemoved += deleteResult.changes
          }

          try {
            const fullPath = join(localPath, relPath)
            const content = await readFileContent(fullPath)
            const ext = relPath.split('.').pop() || ''
            const language = detectLanguage(ext)
            const chunks = chunkCode(content, fullPath, relPath, language, projectId, repoId, targetBranch)

            for (const chunk of chunks) {
              insertChunk.run(
                chunk.id,
                chunk.projectId,
                chunk.repoId,
                chunk.filePath,
                chunk.relativePath,
                chunk.language,
                chunk.chunkType,
                chunk.name,
                chunk.content,
                chunk.lineStart,
                chunk.lineEnd,
                chunk.tokenEstimate,
                JSON.stringify(chunk.dependencies),
                JSON.stringify(chunk.exports),
                JSON.stringify(chunk.metadata),
                chunk.branch
              )
              chunksAdded++
            }
          } catch (err) {
            console.error(`Failed to process ${relPath}:`, err)
          }
        }

        sendProgress(`Đã chuyển sang branch ${targetBranch}! (delta: ${totalChanges} files)`)
      }
    } else {
      // ===== FULL RE-INDEX PATH: First time on this branch =====
      sendProgress(`Đang xóa chunks cũ của branch ${targetBranch}...`)
      const deleteResult = chunkQueries.deleteByRepoBranch(db).run(repoId, targetBranch)
      chunksRemoved = deleteResult.changes

      sendProgress('Đang quét files...')
      const files = await scanDirectory(localPath)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          if (i % 10 === 0) {
            sendProgress(`Đang index: ${file.relativePath} (${i + 1}/${files.length})`)
          }
          const content = await readFileContent(file.path)
          const chunks = chunkCode(content, file.path, file.relativePath, file.language, projectId, repoId, targetBranch)

          for (const chunk of chunks) {
            insertChunk.run(
              chunk.id,
              chunk.projectId,
              chunk.repoId,
              chunk.filePath,
              chunk.relativePath,
              chunk.language,
              chunk.chunkType,
              chunk.name,
              chunk.content,
              chunk.lineStart,
              chunk.lineEnd,
              chunk.tokenEstimate,
              JSON.stringify(chunk.dependencies),
              JSON.stringify(chunk.exports),
              JSON.stringify(chunk.metadata),
              chunk.branch
            )
            chunksAdded++
          }
        } catch (err) {
          console.error(`Failed to process ${file.relativePath}:`, err)
        }
      }

      filesAdded = files.length
      sendProgress(`Đã chuyển sang branch ${targetBranch}!`)
    }

    // 4. Update repo record
    repoQueries.updateActiveBranch(db).run(targetBranch, repoId)
    repoQueries.updateIndexed(db).run(
      sha,
      Date.now(),
      'ready',
      filesAdded + filesModified,
      chunksAdded || existingChunks.length,
      repoId
    )

    // 4b. Update directory tree for the new branch
    try {
      const tree = await getDirectoryTree(localPath)
      db.prepare('INSERT OR REPLACE INTO project_directory_trees (project_id, tree_text, updated_at) VALUES (?, ?, ?)').run(projectId, tree, Date.now())
    } catch {
      // Non-fatal — tree is a nice-to-have
    }

    // 5. Re-embed new chunks (only if we added chunks)
    if (chunksAdded > 0) {
      sendProgress('Đang cập nhật embeddings...')
      try {
        await embedProjectChunks(projectId)
      } catch {
        // Non-fatal
      }
    }

    return {
      success: true,
      repoId,
      filesAdded,
      filesModified,
      filesDeleted,
      chunksAdded,
      chunksRemoved,
      newSha: sha
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    repoQueries.updateStatus(db).run('error', errorMsg, repoId)
    sendProgress(`Lỗi chuyển branch: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
      repoId,
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksAdded: 0,
      chunksRemoved: 0,
      newSha: null
    }
  }
}
