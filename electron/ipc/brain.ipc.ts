import type { IpcMain, BrowserWindow, App } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb, repoQueries, repoTreeQueries, conversationQueries, messageQueries, chunkQueries } from '../services/db'
import { indexLocalRepository, searchChunks, searchChunksHybrid, getProjectStats } from '../services/brain-engine'
import { exportBrain, importBrain } from '../services/brain-export'
import { analyzeArchitecture } from '../services/architecture-analyzer'
import { analyzeImpact } from '../services/impact-analyzer'
import { estimateFeature } from '../services/estimate-service'
import { embedProjectChunks, embedQuery, getEmbedderStatus, getThrottleStatus, EMBEDDING_DIMENSIONS, VOYAGE_MODELS, getSelectedVoyageModel, setSelectedVoyageModel } from '../services/embedder'
import { syncGithubRepo, syncLocalRepo, startFileWatcher, stopFileWatcher, indexBranch } from '../services/sync-engine'
import { listBranches, getCurrentBranch, getGitHubToken } from '../services/git-service'
import { resetQdrantClient } from '../services/qdrant-store'

export function registerBrainIPC(ipcMain: IpcMain, app: App, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('brain:search', async (_event, projectId: string, query: string, limit?: number, branch?: string) => {
    try {
      return await searchChunksHybrid(projectId, query, limit, branch)
    } catch {
      return searchChunks(projectId, query, limit, branch)
    }
  })

  ipcMain.handle('architecture:analyze', (_event, projectId: string) => analyzeArchitecture(projectId))
  ipcMain.handle('impact:analyze', (_event, projectId: string, changedFiles: string[]) => analyzeImpact(projectId, changedFiles))
  ipcMain.handle('estimate:feature', async (_event, projectId: string, description: string) => estimateFeature(projectId, description))

  ipcMain.handle('brain:export', async (_event, projectId: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `cortex-brain-${Date.now()}.cbx`,
      filters: [{ name: 'Cortex Brain Export', extensions: ['cbx'] }]
    })
    if (result.canceled || !result.filePath) return null
    return exportBrain(projectId, result.filePath)
  })

  ipcMain.handle('brain:import', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'Cortex Brain Export', extensions: ['cbx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importBrain(result.filePaths[0])
  })

  ipcMain.handle('sync:repo', async (_event, projectId: string, repoId: string) => {
    const mainWindow = getMainWindow()
    const db = getDb()
    const repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as any
    if (!repo) return { success: false, error: 'Repository not found' }
    try {
      const result = repo.source_type === 'github'
        ? await syncGithubRepo(projectId, repoId, mainWindow)
        : await syncLocalRepo(projectId, repoId, repo.source_path, mainWindow)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('sync:startWatcher', (_event, repoId: string, localPath: string) => {
    const mainWindow = getMainWindow()
    startFileWatcher(repoId, localPath, () => {
      mainWindow?.webContents.send('sync:fileChanged', { repoId })
    })
    return true
  })

  ipcMain.handle('sync:stopWatcher', (_event, repoId: string) => { stopFileWatcher(repoId); return true })

  ipcMain.handle('branch:list', async (_event, repoId: string) => {
    const localPath = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
    if (!existsSync(localPath)) return []
    const token = getGitHubToken(repoId) || undefined
    return listBranches(localPath, token)
  })

  ipcMain.handle('branch:switch', async (_event, projectId: string, repoId: string, branch: string) => {
    const mainWindow = getMainWindow()
    return indexBranch(projectId, repoId, branch, mainWindow)
  })

  ipcMain.handle('branch:getCurrent', async (_event, repoId: string) => {
    const localPath = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
    if (!existsSync(localPath)) return 'main'
    return getCurrentBranch(localPath)
  })

  ipcMain.handle('embedder:getThrottleStatus', () => getThrottleStatus())
}
