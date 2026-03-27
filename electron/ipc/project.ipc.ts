import type { IpcMain, BrowserWindow, App } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb, projectQueries, repoQueries, conversationQueries, messageQueries, chunkQueries } from '../services/db'
import { indexLocalRepository, getProjectStats } from '../services/brain-engine'
import { stopFileWatcher } from '../services/sync-engine'
import { cloneRepository, checkRepoAccess, storeGitHubToken, getGitHubToken, getCurrentBranch, listOrgRepos } from '../services/git-service'
import type { OrgRepo } from '../services/git-service'
import { initNanoBrain } from '../services/nano-brain-service'

export function registerProjectIPC(ipcMain: IpcMain, app: App, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:create', (_event, name: string, brainName: string) => {
    const db = getDb()
    const id = randomUUID()
    projectQueries.create(db).run(id, name, brainName)
    return projectQueries.getById(db).get(id)
  })
  ipcMain.handle('project:getAll', () => projectQueries.getAll(getDb()).all())
  ipcMain.handle('project:delete', (_event, projectId: string) => { projectQueries.delete(getDb()).run(projectId); return true })
  ipcMain.handle('project:rename', (_event, projectId: string, newName: string) => { projectQueries.updateName(getDb()).run(newName, projectId); return true })
  ipcMain.handle('project:setAutoScanEnabled', (_event, projectId: string, enabled: boolean) => {
    projectQueries.updateAutoScanEnabled(getDb()).run(enabled ? 1 : 0, projectId); return true
  })
  ipcMain.handle('project:getAutoScanEnabled', (_event, projectId: string) => {
    const row = projectQueries.getById(getDb()).get(projectId) as { auto_scan_enabled: number } | undefined
    return row ? row.auto_scan_enabled === 1 : false
  })
  ipcMain.handle('project:stats', (_event, projectId: string) => getProjectStats(projectId))

  ipcMain.handle('repo:importLocal', async (_event, projectId: string, localPath: string) => {
    const mainWindow = getMainWindow()
    const db = getDb()
    const repoId = randomUUID()
    const detectedBranch = await getCurrentBranch(localPath).catch(() => 'main')
    repoQueries.create(db).run(repoId, projectId, 'local', localPath, detectedBranch)
    indexLocalRepository(projectId, repoId, localPath, mainWindow, detectedBranch)
      .then(() => {
        const project = projectQueries.getById(getDb()).get(projectId) as any
        if (project) initNanoBrain(project.name, localPath).catch(err => console.warn('[NanoBrain] Post-index init failed:', err))
      })
      .catch(err => console.error('Indexing failed:', err))
    return { repoId, status: 'indexing' }
  })

  ipcMain.handle('repo:getByProject', (_event, projectId: string) => repoQueries.getByProject(getDb()).all(projectId))

  ipcMain.handle('repo:delete', async (_event, repoId: string) => {
    const db = getDb()
    try {
      stopFileWatcher(repoId)
      const cloneDir = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
      if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true })
      repoQueries.delete(db).run(repoId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('repo:importGithub', async (_event, projectId: string, repoUrl: string, token?: string, branch?: string) => {
    const mainWindow = getMainWindow()
    const db = getDb()
    const repoId = randomUUID()
    if (token) storeGitHubToken(repoId, token)
    const access = await checkRepoAccess(repoUrl, token)
    if (!access.accessible) return { success: false, error: access.error, needsToken: !token && access.isPrivate }
    repoQueries.create(db).run(repoId, projectId, 'github', repoUrl, branch || 'main')
    repoQueries.updateStatus(db).run('indexing', null, repoId)
    ;(async () => {
      try {
        const cloneResult = await cloneRepository(repoUrl, repoId, token, branch)
        await indexLocalRepository(projectId, repoId, cloneResult.localPath, mainWindow, cloneResult.branch)
        repoQueries.updateActiveBranch(db).run(cloneResult.branch, repoId)
        const project = projectQueries.getById(db).get(projectId) as any
        if (project) initNanoBrain(project.name, cloneResult.localPath).catch(err => console.warn('[NanoBrain] Post-clone init failed:', err))
        repoQueries.updateIndexed(db).run(cloneResult.latestSha, Date.now(), 'ready', 0, 0, repoId)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        repoQueries.updateStatus(db).run('error', errorMsg, repoId)
        mainWindow?.webContents.send('indexing:progress', { repoId, phase: 'error', totalFiles: 0, processedFiles: 0, totalChunks: 0, error: errorMsg })
      }
    })()
    return { success: true, repoId, status: 'indexing' }
  })

  ipcMain.handle('github:checkAccess', async (_event, repoUrl: string, token?: string) => checkRepoAccess(repoUrl, token))

  ipcMain.handle('org:listRepos', async (_event, orgUrl: string, token: string) => {
    const match = orgUrl.match(/github\.com\/(?:orgs\/)?([^/]+)\/?$/)
    if (!match) throw new Error('Invalid org URL. Expected: https://github.com/orgs/ORG_NAME')
    return listOrgRepos(match[1], token)
  })

  ipcMain.handle('org:importAll', async (_event, projectId: string, repos: OrgRepo[], token: string) => {
    const mainWindow = getMainWindow()
    const db = getDb()
    const results: Array<{ name: string; repoId: string; status: string; error?: string }> = []
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i]
      const repoId = randomUUID()
      mainWindow?.webContents.send('org:importProgress', { projectId, current: i + 1, total: repos.length, repoName: repo.name, phase: 'cloning' })
      try {
        storeGitHubToken(repoId, token)
        repoQueries.create(db).run(repoId, projectId, 'github', repo.htmlUrl, repo.defaultBranch)
        repoQueries.updateStatus(db).run('indexing', null, repoId)
        const cloneResult = await cloneRepository(repo.cloneUrl, repoId, token, repo.defaultBranch)
        mainWindow?.webContents.send('org:importProgress', { projectId, current: i + 1, total: repos.length, repoName: repo.name, phase: 'indexing' })
        await indexLocalRepository(projectId, repoId, cloneResult.localPath, mainWindow, cloneResult.branch)
        repoQueries.updateActiveBranch(db).run(cloneResult.branch, repoId)
        repoQueries.updateIndexed(db).run(cloneResult.latestSha, Date.now(), 'ready', 0, 0, repoId)
        results.push({ name: repo.name, repoId, status: 'ready' })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        repoQueries.updateStatus(db).run('error', errorMsg, repoId)
        results.push({ name: repo.name, repoId, status: 'error', error: errorMsg })
      }
      mainWindow?.webContents.send('org:importProgress', {
        projectId, current: i + 1, total: repos.length, repoName: repo.name,
        phase: results[results.length - 1].status === 'ready' ? 'done' : 'error'
      })
    }
    mainWindow?.webContents.send('org:importProgress', { projectId, current: repos.length, total: repos.length, repoName: '', phase: 'complete' })
    return results
  })

  ipcMain.handle('conversation:create', (_event, projectId: string, title: string, mode: string, branch?: string) => {
    const db = getDb()
    const id = randomUUID()
    conversationQueries.create(db).run(id, projectId, title, mode, branch || 'main')
    return conversationQueries.getById(db).get(id)
  })
  ipcMain.handle('conversation:getByProject', (_event, projectId: string) => conversationQueries.getByProject(getDb()).all(projectId))
  ipcMain.handle('conversation:updateTitle', (_event, conversationId: string, title: string) => { conversationQueries.updateTitle(getDb()).run(title, conversationId); return true })
  ipcMain.handle('conversation:delete', (_event, conversationId: string) => { conversationQueries.delete(getDb()).run(conversationId); return true })
  ipcMain.handle('conversation:pin', (_event, conversationId: string) => { conversationQueries.togglePin(getDb()).run(conversationId); return true })

  ipcMain.handle('message:create', (_event, conversationId: string, role: string, content: string, mode: string, contextChunks?: string) => {
    const db = getDb()
    const id = randomUUID()
    messageQueries.create(db).run(id, conversationId, role, content, mode, contextChunks || '[]')
    conversationQueries.touch(db).run(conversationId)
    return { id, conversationId, role, content, mode, contextChunks: contextChunks || '[]', created_at: Date.now() }
  })
  ipcMain.handle('message:getByConversation', (_event, conversationId: string) => messageQueries.getByConversation(getDb()).all(conversationId))
  ipcMain.handle('message:updateContent', (_event, messageId: string, content: string) => { messageQueries.updateContent(getDb()).run(content, messageId); return true })
}
