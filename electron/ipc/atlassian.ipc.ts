import type { IpcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb, repoQueries, chunkQueries } from '../services/db'
import { getProjectAtlassianConfig, setProjectAtlassianConfig, clearProjectAtlassianConfig, hasProjectAtlassianConfig } from '../services/atlassian-config-service'
import { testJiraConnection, fetchJiraProjects, fetchProjectIssues, issueToChunkContent } from '../services/jira-service'
import { fetchSpaces, fetchPagesBySpace, pageToChunkContent } from '../services/confluence-service'
import { getGitHubPAT, setGitHubPAT } from '../services/settings-service'
import { embedProjectChunks } from '../services/embedder'

export function registerAtlassianIPC(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('atlassian:getConfig', (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return null
    return { siteUrl: config.siteUrl, email: config.email, hasToken: true }
  })
  ipcMain.handle('atlassian:setConfig', (_event, projectId: string, siteUrl: string, email: string, apiToken: string) => {
    setProjectAtlassianConfig(projectId, siteUrl, email, apiToken)
    return true
  })
  ipcMain.handle('atlassian:clearConfig', (_event, projectId: string) => {
    clearProjectAtlassianConfig(projectId)
    return true
  })
  ipcMain.handle('atlassian:testConnection', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình cho project này' }
    return testJiraConnection({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })
  ipcMain.handle('atlassian:getConnections', (_event, projectId: string) => {
    if (!hasProjectAtlassianConfig(projectId)) return []
    return []
  })
  ipcMain.handle('atlassian:syncConnection', async () => ({ success: true }))
  ipcMain.handle('atlassian:deleteConnection', async () => true)

  ipcMain.handle('jira:testConnection', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình cho project này' }
    return testJiraConnection({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })
  ipcMain.handle('jira:getProjects', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return []
    return fetchJiraProjects({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })
  ipcMain.handle('jira:importProject', async (_event, projectId: string, jiraProjectKey: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình' }
    const mainWindow = getMainWindow()
    const db = getDb()
    const sourcePath = `${config.siteUrl}/projects/${jiraProjectKey}`
    const existing = db.prepare('SELECT id FROM repositories WHERE project_id = ? AND source_type = ? AND source_path = ?').get(projectId, 'jira', sourcePath) as { id: string } | undefined
    if (existing) {
      chunkQueries.deleteByRepo(db).run(existing.id)
      repoQueries.updateStatus(db).run('indexing', null, existing.id)
    }
    const repoId = existing?.id || randomUUID()
    if (!existing) {
      repoQueries.create(db).run(repoId, projectId, 'jira', sourcePath, 'main')
      repoQueries.updateStatus(db).run('indexing', null, repoId)
    }
    try {
      mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang tải issues từ ${jiraProjectKey}...` })
      const issues = await fetchProjectIssues(
        { siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken },
        jiraProjectKey,
        (fetched, total) => mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang tải ${fetched}/${total} issues...` })
      )
      mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang index ${issues.length} issues...` })
      const insertChunk = chunkQueries.insert(db)
      let chunksCreated = 0
      db.transaction(() => {
        for (const issue of issues) {
          const content = issueToChunkContent(issue)
          insertChunk.run(
            randomUUID(), projectId, repoId,
            `jira/${jiraProjectKey}/${issue.key}`, `${jiraProjectKey}/${issue.key}`,
            'jira', 'jira_issue', issue.key, content, 0, 0, Math.ceil(content.length / 4),
            '[]', '[]', JSON.stringify({ issueType: issue.issueType, status: issue.status, priority: issue.priority }), 'main'
          )
          chunksCreated++
        }
      })()
      repoQueries.updateIndexed(db).run(null, Date.now(), 'ready', issues.length, chunksCreated, repoId)
      mainWindow?.webContents.send('sync:progress', { repoId, message: 'Đang tạo embeddings...' })
      try { await embedProjectChunks(projectId) } catch (e) { console.warn('[Jira] Embedding failed (non-fatal):', e) }
      return { success: true, issuesImported: issues.length }
    } catch (err) {
      repoQueries.updateStatus(db).run('error', err instanceof Error ? err.message : 'Import thất bại', repoId)
      return { success: false, error: err instanceof Error ? err.message : 'Import thất bại' }
    }
  })

  ipcMain.handle('github:getPAT', () => !!getGitHubPAT())
  ipcMain.handle('github:setPAT', (_event, token: string) => { setGitHubPAT(token); return true })

  ipcMain.handle('confluence:getSpaces', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return []
    return fetchSpaces({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })
  ipcMain.handle('confluence:importSpace', async (_event, projectId: string, spaceId: string, spaceKey: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình' }
    const mainWindow = getMainWindow()
    const db = getDb()
    const sourcePath = `${config.siteUrl}/wiki/spaces/${spaceKey}`
    const existing = db.prepare('SELECT id FROM repositories WHERE project_id = ? AND source_type = ? AND source_path = ?').get(projectId, 'confluence', sourcePath) as { id: string } | undefined
    if (existing) {
      chunkQueries.deleteByRepo(db).run(existing.id)
      repoQueries.updateStatus(db).run('indexing', null, existing.id)
    }
    const repoId = existing?.id || randomUUID()
    if (!existing) {
      repoQueries.create(db).run(repoId, projectId, 'confluence', sourcePath, 'main')
      repoQueries.updateStatus(db).run('indexing', null, repoId)
    }
    try {
      mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang tải pages từ ${spaceKey}...` })
      const pages = await fetchPagesBySpace(
        { siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken },
        spaceId,
        (fetched) => mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang tải ${fetched} pages...` })
      )
      mainWindow?.webContents.send('sync:progress', { repoId, message: `Đang index ${pages.length} pages...` })
      const insertChunk = chunkQueries.insert(db)
      let chunksCreated = 0
      db.transaction(() => {
        for (const page of pages) {
          const content = pageToChunkContent(page)
          if (content.length < 10) continue
          insertChunk.run(
            randomUUID(), projectId, repoId,
            `confluence/${spaceKey}/${page.id}`, `${spaceKey}/${page.title}`,
            'confluence', 'confluence_page', page.title, content, 0, 0, Math.ceil(content.length / 4),
            '[]', '[]', JSON.stringify({ spaceKey, labels: page.labels }), 'main'
          )
          chunksCreated++
        }
      })()
      repoQueries.updateIndexed(db).run(null, Date.now(), 'ready', pages.length, chunksCreated, repoId)
      mainWindow?.webContents.send('sync:progress', { repoId, message: 'Đang tạo embeddings...' })
      try { await embedProjectChunks(projectId) } catch (e) { console.warn('[Confluence] Embedding failed (non-fatal):', e) }
      return { success: true, pagesImported: pages.length }
    } catch (err) {
      repoQueries.updateStatus(db).run('error', err instanceof Error ? err.message : 'Import thất bại', repoId)
      return { success: false, error: err instanceof Error ? err.message : 'Import thất bại' }
    }
  })
}
