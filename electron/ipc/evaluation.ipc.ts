import type { IpcMain } from 'electron'
import { initEvalSchema, saveEvalSnapshot, getLatestEvalSnapshot, getEvalHistory } from '../services/training/evaluation-db'
import { computeTier1Metrics } from '../services/training/evaluators/tier1-proxy'
import { computeTier2Metrics } from '../services/training/evaluators/tier2-retrieval'
import { computeTier3Metrics } from '../services/training/evaluators/tier3-feedback'

export function registerEvaluationIPC(ipcMain: IpcMain): void {
  initEvalSchema()

  ipcMain.handle('evaluation:runTier1', (_event, projectId: string) => {
    try {
      const metrics = computeTier1Metrics(projectId)
      saveEvalSnapshot(projectId, 1, metrics)
      return metrics
    } catch (err) {
      console.error('[EvalIPC] Tier1 failed:', err)
      return null
    }
  })

  ipcMain.handle('evaluation:runTier2', async (_event, projectId: string, sampleSize?: number) => {
    try {
      const metrics = await computeTier2Metrics(projectId, sampleSize)
      saveEvalSnapshot(projectId, 2, metrics)
      return metrics
    } catch (err) {
      console.error('[EvalIPC] Tier2 failed:', err)
      return null
    }
  })

  ipcMain.handle('evaluation:runTier3', (_event, projectId: string) => {
    try {
      const metrics = computeTier3Metrics(projectId)
      saveEvalSnapshot(projectId, 3, metrics)
      return metrics
    } catch (err) {
      console.error('[EvalIPC] Tier3 failed:', err)
      return null
    }
  })

  ipcMain.handle('evaluation:runAll', async (_event, projectId: string) => {
    try {
      const tier1 = computeTier1Metrics(projectId)
      saveEvalSnapshot(projectId, 1, tier1)
      const tier3 = computeTier3Metrics(projectId)
      saveEvalSnapshot(projectId, 3, tier3)
      const tier2 = await computeTier2Metrics(projectId)
      saveEvalSnapshot(projectId, 2, tier2)
      return { tier1, tier2, tier3 }
    } catch (err) {
      console.error('[EvalIPC] RunAll failed:', err)
      return null
    }
  })

  ipcMain.handle('evaluation:getLatest', (_event, projectId: string) => {
    try {
      return {
        tier1: getLatestEvalSnapshot(projectId, 1),
        tier2: getLatestEvalSnapshot(projectId, 2),
        tier3: getLatestEvalSnapshot(projectId, 3)
      }
    } catch (err) {
      console.error('[EvalIPC] GetLatest failed:', err)
      return { tier1: null, tier2: null, tier3: null }
    }
  })

  ipcMain.handle('evaluation:getHistory', (_event, projectId: string, tier: 1 | 2 | 3, limit?: number) => {
    try {
      return getEvalHistory(projectId, tier, limit)
    } catch (err) {
      console.error('[EvalIPC] GetHistory failed:', err)
      return []
    }
  })
}
