import type { IpcMain, App, BrowserWindow } from 'electron'
import { ipcMain as electronIpcMain } from 'electron'
import type { HookTrigger, HookContext } from '../services/hooks/types'
import type { BackgroundTaskStatus } from '../services/background'
import type { TaskCategory } from '../services/routing'
import {
  registerHook, unregisterHook, listHooks, enableHook, disableHook, runHooks
} from '../services/hooks'
import { resolveCategory, routeToModel } from '../services/routing'
import {
  launchTask, cancelTask, getTask, getAllTasks, getTasksByStatus,
  cleanupCompleted, detectStaleTasks, configureConcurrency, getConcurrencyConfig
} from '../services/background'
import {
  createLoop, getLoop, getAllLoops, getLoopsByStatus,
  startLoop, pauseLoop, resumeLoop, cancelLoop,
  saveBoulder, getBoulder, getBoulderByProject,
  updateBoulderCheckpoint, restoreBoulder, deleteBoulder, getAllBoulders,
  createRalphConfig, createUltraworkConfig, createBoulderConfig
} from '../services/loops'
import {
  getAllCapabilities, getCapability, canDelegate,
  getDelegationHistory
} from '../services/agents/agent-capabilities'
import {
  initNanoBrain, getNanoBrainStatus, queryNanoBrain, listCollections, triggerEmbedding
} from '../services/nano-brain-service'
import { getPluginConfig, loadPluginConfig } from '../services/plugin-config'

export function registerSystemIPC(ipcMain: IpcMain, app: App, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('hooks:list', () =>
    listHooks().map(h => ({
      id: h.id, name: h.name, description: h.description,
      trigger: h.trigger, priority: h.priority, enabled: h.enabled, stats: h.stats
    }))
  )
  ipcMain.handle('hooks:enable', (_event, hookId: string) => enableHook(hookId))
  ipcMain.handle('hooks:disable', (_event, hookId: string) => disableHook(hookId))
  ipcMain.handle('hooks:run', async (_event, trigger: HookTrigger, context: HookContext) => runHooks(trigger, context))

  ipcMain.handle('routing:resolve', (_event, input: { prompt?: string; category?: TaskCategory; slashCommand?: string }) =>
    resolveCategory(input))
  ipcMain.handle('routing:routeModel', (_event, category: TaskCategory, availableModels: string[]) => {
    const decision = resolveCategory({ category })
    return routeToModel(decision, availableModels)
  })

  ipcMain.handle('background:launch', (_event, options: {
    description: string; category?: string; agentType?: string;
    provider?: string; priority?: number; metadata?: Record<string, unknown>
  }) => {
    return launchTask({
      ...options,
      execute: async () => ({ status: 'delegated', description: options.description })
    })
  })
  ipcMain.handle('background:cancel', (_event, taskId: string) => cancelTask(taskId))
  ipcMain.handle('background:get', (_event, taskId: string) => getTask(taskId) ?? null)
  ipcMain.handle('background:getAll', () => getAllTasks())
  ipcMain.handle('background:getByStatus', (_event, status: BackgroundTaskStatus) => getTasksByStatus(status))
  ipcMain.handle('background:cleanup', (_event, olderThanMs?: number) => cleanupCompleted(olderThanMs))
  ipcMain.handle('background:detectStale', () => detectStaleTasks())
  ipcMain.handle('background:concurrency:get', () => getConcurrencyConfig())
  ipcMain.handle('background:concurrency:set', (_event, config: Record<string, unknown>) => {
    configureConcurrency(config as Parameters<typeof configureConcurrency>[0])
    return getConcurrencyConfig()
  })

  ipcMain.handle('loop:create', (_event, type: 'ralph' | 'ultrawork' | 'boulder', metadata?: Record<string, unknown>) => {
    const configMap = { ralph: createRalphConfig, ultrawork: createUltraworkConfig, boulder: createBoulderConfig }
    return createLoop(configMap[type](), metadata)
  })
  ipcMain.handle('loop:get', (_event, loopId: string) => getLoop(loopId) ?? null)
  ipcMain.handle('loop:getAll', () => getAllLoops())
  ipcMain.handle('loop:getByStatus', (_event, status: string) => getLoopsByStatus(status as Parameters<typeof getLoopsByStatus>[0]))
  ipcMain.handle('loop:pause', (_event, loopId: string) => pauseLoop(loopId))
  ipcMain.handle('loop:resume', (_event, loopId: string) => resumeLoop(loopId))
  ipcMain.handle('loop:cancel', (_event, loopId: string) => cancelLoop(loopId))

  ipcMain.handle('boulder:get', (_event, loopId: string) => getBoulder(loopId) ?? null)
  ipcMain.handle('boulder:getByProject', (_event, projectId: string) => getBoulderByProject(projectId))
  ipcMain.handle('boulder:getAll', () => getAllBoulders())
  ipcMain.handle('boulder:restore', (_event, loopId: string) => restoreBoulder(loopId) ?? null)
  ipcMain.handle('boulder:delete', (_event, loopId: string) => deleteBoulder(loopId))
  ipcMain.handle('boulder:updateCheckpoint', (_event, loopId: string, checkpoint: Record<string, unknown>) =>
    updateBoulderCheckpoint(loopId, checkpoint))

  ipcMain.handle('capabilities:getAll', () => getAllCapabilities())
  ipcMain.handle('capabilities:get', (_event, role: string) =>
    getCapability(role as Parameters<typeof getCapability>[0]) ?? null)
  ipcMain.handle('capabilities:canDelegate', (_event, from: string, to: string) =>
    canDelegate(from as Parameters<typeof canDelegate>[0], to as Parameters<typeof canDelegate>[1]))
  ipcMain.handle('capabilities:delegationHistory', (_event, fromAgent?: string) =>
    getDelegationHistory(fromAgent as Parameters<typeof getDelegationHistory>[0]))

  ipcMain.handle('nanobrain:status', async () => getNanoBrainStatus())
  ipcMain.handle('nanobrain:query', async (_event, query: string, options?: { limit?: number; collection?: string }) =>
    queryNanoBrain(query, options))
  ipcMain.handle('nanobrain:collections', async () => listCollections())
  ipcMain.handle('nanobrain:embed', async () => triggerEmbedding())
}
