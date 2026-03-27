import type { IpcMain, BrowserWindow } from 'electron'
import { getDb } from '../services/db'
import { recordFeedbackSignal, convertSignalsToTrainingPairs, getFeedbackStats } from '../services/feedback-collector'
import { trainFromPairs, getLearnedWeightCount } from '../services/learned-reranker'
import { initDefaultVariant } from '../services/query-optimizer'
import { getCompressionStats } from '../services/skills/efficiency/cost-tracker'
import { optimizePrompt } from '../services/skills/learning/prompt-optimizer'
import { getAutoScanProgress, getAutoScanConfig, setAutoScanConfig } from '../services/skills/learning/autoscan-engine'
import { triggerManualTraining } from '../services/training/training-engine'
import { checkForUpdates } from '../services/updater-service'
import { getAuditLog } from '../services/audit-service'

export function registerLearningIPC(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'learning:sendFeedback',
    (_event, messageId: string, conversationId: string, projectId: string, signalType: string, query: string, chunkIds: string[]) => {
      try {
        recordFeedbackSignal({
          projectId, messageId, conversationId,
          signalType: signalType as 'thumbs_up' | 'thumbs_down' | 'copy' | 'follow_up_quick' | 'follow_up_slow' | 'no_follow_up',
          query, chunkIds
        })
        return true
      } catch (err) {
        console.error('[Learning] Failed to record feedback:', err)
        return false
      }
    }
  )

  ipcMain.handle('learning:getStats', (_event, projectId: string) => {
    try {
      const feedback = getFeedbackStats(projectId)
      const weightCount = getLearnedWeightCount(projectId)
      const compression = getCompressionStats(projectId)
      return {
        totalFeedback: feedback.totalFeedback,
        totalTrainingPairs: feedback.totalTrainingPairs,
        totalLearnedWeights: weightCount,
        positiveRatio: feedback.totalFeedback > 0 ? feedback.positiveCount / feedback.totalFeedback : 0,
        lastTrainedAt: null,
        compressionSavings: compression
      }
    } catch {
      return { totalFeedback: 0, totalTrainingPairs: 0, totalLearnedWeights: 0, positiveRatio: 0, lastTrainedAt: null, compressionSavings: { tokensOriginal: 0, tokensCompressed: 0, savingsPercent: 0 } }
    }
  })

  ipcMain.handle('learning:train', async (_event, projectId: string) => {
    try {
      const { converted } = convertSignalsToTrainingPairs(projectId)
      const { trained, weightsUpdated } = trainFromPairs(projectId)
      initDefaultVariant(projectId, '')
      let optimized = false
      try {
        const result = await optimizePrompt(projectId, '')
        optimized = result.improvement > 0
      } catch { }
      return { trained, weights: weightsUpdated, optimized }
    } catch {
      return { trained: 0, weights: 0, optimized: false }
    }
  })

  ipcMain.handle('learning:exportData', async (_event, projectId: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `cortex-training-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    try {
      const db = getDb()
      const pairs = db.prepare('SELECT * FROM training_pairs WHERE project_id = ?').all(projectId)
      const { writeFileSync } = await import('fs')
      writeFileSync(result.filePath, JSON.stringify(pairs, null, 2))
      return { pairs: pairs.length, path: result.filePath }
    } catch { return null }
  })

  ipcMain.handle('autoscan:progress', () => getAutoScanProgress())
  ipcMain.handle('autoscan:config:get', () => getAutoScanConfig())
  ipcMain.handle('autoscan:config:set', (_event, config: Record<string, unknown>) => {
    setAutoScanConfig(config)
    return true
  })
  ipcMain.handle('autoscan:trigger', (_event, projectId: string) => {
    triggerManualTraining('autoscan', projectId)
    return true
  })

  ipcMain.handle('updater:checkForUpdates', async () => checkForUpdates())
  ipcMain.handle('audit:getLog', (_event, projectId?: string, limit?: number) => getAuditLog(projectId, limit))
}
