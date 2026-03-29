import type { IpcMain, BrowserWindow } from 'electron'
import { getDb } from '../services/db'
import { recordFeedbackSignal, convertSignalsToTrainingPairs, getFeedbackStats } from '../services/feedback-collector'
import { trainFromPairs, getLearnedWeightCount } from '../services/learned-reranker'
import { initDefaultVariant } from '../services/query-optimizer'
import { getCompressionStats } from '../services/skills/efficiency/cost-tracker'
import { optimizePrompt } from '../services/skills/learning/prompt-optimizer'
import { getAutoScanProgress, getAutoScanConfig, setAutoScanConfig, onActivityUpdate, syncEnabledFromDb } from '../services/skills/learning/autoscan-engine'
import { triggerManualTraining } from '../services/training/training-engine'
import { getRunHistory } from '../services/training/training-db'
import { checkForUpdates } from '../services/updater-service'
import { getAuditLog } from '../services/audit-service'

export function registerLearningIPC(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  syncEnabledFromDb()

  onActivityUpdate((activity) => {
    getMainWindow()?.webContents.send('autoscan:activity', activity)
  })

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

  // =====================
  // Training Intelligence — Timeline & History
  // =====================

  ipcMain.handle('training:getTimeline', (_event, projectId: string, granularity: 'hour' | 'day' = 'day', sinceMs?: number) => {
    try {
      const db = getDb()
      const since = sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000
      if (granularity === 'hour') {
        const rows = db.prepare(`
          SELECT
            STRFTIME('%H', created_at / 1000, 'unixepoch') as hour,
            COUNT(*) as count,
            SUM(CASE WHEN source = 'autoscan' THEN 1 ELSE 0 END) as autoscan_count,
            SUM(CASE WHEN label > 0 THEN 1 ELSE 0 END) as positive_count
          FROM training_pairs
          WHERE project_id = ? AND created_at > ?
          GROUP BY hour
          ORDER BY hour ASC
        `).all(projectId, since) as Array<{ hour: string; count: number; autoscan_count: number; positive_count: number }>
        const filled: Array<{ hour: string; count: number; autoscan_count: number; positive_count: number }> = []
        for (let h = 0; h < 24; h++) {
          const key = String(h).padStart(2, '0')
          const found = rows.find(r => r.hour === key)
          filled.push({ hour: key, count: found?.count ?? 0, autoscan_count: found?.autoscan_count ?? 0, positive_count: found?.positive_count ?? 0 })
        }
        return filled
      }
      const rows = db.prepare(`
        SELECT
          DATE(created_at / 1000, 'unixepoch') as day,
          COUNT(*) as count,
          SUM(CASE WHEN source = 'autoscan' THEN 1 ELSE 0 END) as autoscan_count,
          SUM(CASE WHEN label > 0 THEN 1 ELSE 0 END) as positive_count
        FROM training_pairs
        WHERE project_id = ? AND created_at > ?
        GROUP BY day
        ORDER BY day DESC
      `).all(projectId, since)
      return rows
    } catch { return [] }
  })

  ipcMain.handle('training:getRecentPairs', (_event, projectId: string, limit: number = 20) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT
          MIN(tp.id) as id,
          tp.query,
          tp.source,
          tp.label,
          MAX(tp.created_at) as created_at,
          c.file_path,
          c.language,
          COUNT(*) as feedback_count,
          SUM(CASE WHEN tp.label > 0 THEN 1 ELSE 0 END) as positive_count,
          SUM(CASE WHEN tp.label < 0 THEN 1 ELSE 0 END) as negative_count
        FROM training_pairs tp
        LEFT JOIN chunks c ON tp.chunk_id = c.id
        WHERE tp.project_id = ?
          AND LENGTH(TRIM(tp.query)) >= 10
          AND tp.source NOT IN ('implicit_positive', 'implicit_negative')
        GROUP BY LOWER(TRIM(tp.query))
        ORDER BY MAX(tp.created_at) DESC
        LIMIT ?
      `).all(projectId, limit)
      return rows
    } catch { return [] }
  })

  ipcMain.handle('training:getRunHistory', () => {
    try {
      return getRunHistory(50)
    } catch { return [] }
  })

  ipcMain.handle('training:getIntelligenceScore', (_event, projectId: string) => {
    try {
      const db = getDb()

      const pairsRow = db.prepare('SELECT COUNT(*) as count FROM training_pairs WHERE project_id = ?').get(projectId) as { count: number } | undefined
      const weightsRow = db.prepare('SELECT COUNT(*) as count FROM learned_weights WHERE project_id = ?').get(projectId) as { count: number } | undefined
      const feedbackRow = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN signal_type IN ('thumbs_up', 'copy', 'no_follow_up') THEN 1 ELSE 0 END) as positive
        FROM feedback_signals WHERE project_id = ?
      `).get(projectId) as { total: number; positive: number } | undefined
      const compression = getCompressionStats(projectId)

      const autoscanPairsRow = db.prepare(`
        SELECT COUNT(*) as accepted FROM training_pairs
        WHERE project_id = ? AND source = 'autoscan'
      `).get(projectId) as { accepted: number } | undefined

      const chunksScannedRow = db.prepare(`
        SELECT COUNT(DISTINCT chunk_id) as scanned FROM training_pairs
        WHERE project_id = ? AND source = 'autoscan'
      `).get(projectId) as { scanned: number } | undefined

      const chunksRow = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE project_id = ?').get(projectId) as { count: number } | undefined

      const runsRow = db.prepare(`
        SELECT COUNT(*) as count FROM training_runs
        WHERE pipeline = 'autoscan' AND status = 'completed'
        AND (project_id = ? OR project_id IS NULL)
      `).get(projectId) as { count: number } | undefined

      const pairsCount = pairsRow?.count ?? 0
      const weightsCount = weightsRow?.count ?? 0
      const feedbackTotal = feedbackRow?.total ?? 0
      const feedbackPositive = feedbackRow?.positive ?? 0
      const autoscanAccepted = autoscanPairsRow?.accepted ?? 0
      const chunksScanned = chunksScannedRow?.scanned ?? 0
      const chunksTotal = chunksRow?.count ?? 0

      const pairsScore = Math.min(40, (pairsCount / 1000) * 40)
      const weightsScore = Math.min(30, (weightsCount / 500) * 30)
      const feedbackScore = feedbackTotal > 0 ? (feedbackPositive / feedbackTotal) * 20 : 0
      const compressionScore = Math.min(10, (compression.savingsPercent / 100) * 10)

      const score = Math.round(pairsScore + weightsScore + feedbackScore + compressionScore)
      return {
        score,
        breakdown: {
          pairs: Math.round(pairsScore),
          weights: Math.round(weightsScore),
          feedback: Math.round(feedbackScore),
          compression: Math.round(compressionScore)
        },
        rawCounts: {
          pairs: pairsCount,
          weights: weightsCount,
          feedback: feedbackTotal,
          compressionPercent: compression.savingsPercent,
          chunksTotal,
          chunksScanned,
          autoscanRuns: runsRow?.count ?? 0,
          autoscanPairsAccepted: autoscanAccepted,
          autoscanChunksScanned: chunksScanned,
          autoscanPairsGenerated: pairsCount,
          autoscanAcceptanceRate: chunksTotal > 0
            ? Math.round((chunksScanned / chunksTotal) * 100)
            : 0
        }
      }
    } catch (err) {
      console.error('[Intelligence] Score calc failed:', err)
      return { score: 0, breakdown: { pairs: 0, weights: 0, feedback: 0, compression: 0 }, rawCounts: { pairs: 0, weights: 0, feedback: 0, compressionPercent: 0, chunksTotal: 0, chunksScanned: 0, autoscanRuns: 0, autoscanPairsAccepted: 0, autoscanChunksScanned: 0, autoscanPairsGenerated: 0, autoscanAcceptanceRate: 0 } }
    }
  })

  ipcMain.handle('training:getTopTopics', (_event, projectId: string, sinceMs: number) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT c.file_path, c.language, COUNT(*) as pair_count
        FROM training_pairs tp
        LEFT JOIN chunks c ON tp.chunk_id = c.id
        WHERE tp.project_id = ? AND tp.created_at > ? AND c.file_path IS NOT NULL
        GROUP BY c.file_path
        ORDER BY pair_count DESC
        LIMIT 10
      `).all(projectId, sinceMs)
      return rows
    } catch { return [] }
  })

  ipcMain.handle('training:getUpcomingWork', (_event, projectId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT file_path, language, COUNT(*) as chunk_count
        FROM chunks
        WHERE project_id = ?
          AND id NOT IN (
            SELECT DISTINCT chunk_id FROM training_pairs WHERE project_id = ?
          )
        GROUP BY file_path
        ORDER BY chunk_count DESC
        LIMIT 10
      `).all(projectId, projectId)
      return rows
    } catch { return [] }
  })

  ipcMain.handle('updater:checkForUpdates', async () => checkForUpdates())
  ipcMain.handle('audit:getLog', (_event, projectId?: string, limit?: number) => getAuditLog(projectId, limit))
}
