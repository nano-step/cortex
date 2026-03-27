import type { IpcMain } from 'electron'
import {
  initMemory, buildMemoryPrompt, searchMemory, getMemoryStats,
  updateCoreMemory, getCoreMemory, addArchivalMemory, deleteArchivalMemory,
  addRecallMemory, deleteConversationRecall
} from '../services/memory/memory-manager'
import { getCoreMemoryForPrompt, getCoreMemorySection, deleteCoreMemory } from '../services/memory/core-memory'
import { searchArchivalMemory, getArchivalMemories } from '../services/memory/archival-memory'
import { searchRecallMemory, getConversationRecall, getRecentRecall } from '../services/memory/recall-memory'
import { runMigration } from '../services/memory/migration'

export function registerMemoryIPC(ipcMain: IpcMain): void {
  try { initMemory() } catch (err) { console.error('[Main] Memory init failed:', err) }

  ipcMain.handle('memory:core:get', (_event, projectId: string) => getCoreMemory(projectId))
  ipcMain.handle('memory:core:update', (_event, projectId: string, section: string, content: string) =>
    updateCoreMemory(projectId, section as Parameters<typeof updateCoreMemory>[1], content))
  ipcMain.handle('memory:core:delete', (_event, projectId: string, section: string) =>
    deleteCoreMemory(projectId, section as Parameters<typeof deleteCoreMemory>[1]))
  ipcMain.handle('memory:core:prompt', (_event, projectId: string) => getCoreMemoryForPrompt(projectId))

  ipcMain.handle('memory:archival:search', async (_event, projectId: string, query: string, limit?: number) =>
    searchArchivalMemory(projectId, query, limit))
  ipcMain.handle('memory:archival:add', async (_event, projectId: string, content: string, metadata?: Record<string, unknown>) =>
    addArchivalMemory(projectId, content, metadata as Parameters<typeof addArchivalMemory>[2]))
  ipcMain.handle('memory:archival:list', (_event, projectId: string, limit?: number, offset?: number) =>
    getArchivalMemories(projectId, limit, offset))
  ipcMain.handle('memory:archival:delete', (_event, id: string) => deleteArchivalMemory(id))

  ipcMain.handle('memory:recall:search', async (_event, projectId: string, query: string, limit?: number) =>
    searchRecallMemory(projectId, query, limit))
  ipcMain.handle('memory:recall:conversation', (_event, projectId: string, conversationId: string, limit?: number) =>
    getConversationRecall(projectId, conversationId, limit))
  ipcMain.handle('memory:recall:recent', (_event, projectId: string, limit?: number) =>
    getRecentRecall(projectId, limit))

  ipcMain.handle('memory:search', async (_event, projectId: string, query: string, limit?: number) =>
    searchMemory(projectId, query, limit))
  ipcMain.handle('memory:stats', (_event, projectId: string) => getMemoryStats(projectId))
  ipcMain.handle('memory:migrate', (_event, projectId: string) => runMigration(projectId))
  ipcMain.handle('memory:buildPrompt', (_event, projectId: string) => buildMemoryPrompt(projectId))
}
