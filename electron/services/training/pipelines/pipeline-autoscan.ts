import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import {
  runBatch,
  runCrystalBatch,
  runJiraBatch,
  runConfluenceBatch,
  getAutoScanConfig,
  setAutoScanProgress,
  getTotalChunkCount
} from '../../skills/learning/autoscan-engine'

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  const scanConfig = getAutoScanConfig()

  if (!scanConfig.enabled) {
    return { pipeline: 'autoscan', success: true, metrics: { skipped: 1 }, durationMs: 0 }
  }

  let totalChunksScanned = 0
  let totalPairsGenerated = 0
  let totalPairsAccepted = 0
  let totalPairsRejected = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      const totalChunks = getTotalChunkCount(projectId)
      const totalBatches = Math.ceil(totalChunks / scanConfig.batchSize)

      setAutoScanProgress({
        phase: 'chunks',
        currentBatch: 0,
        totalBatches,
        isRunning: true,
        currentProjectId: projectId
      })

      console.log(`[AutoScan] Project ${projectId}: ${totalChunks} chunks, ${totalBatches} batches`)

      let offset = 0
      let batchIndex = 0

      while (offset < totalChunks) {
        setAutoScanProgress({ currentBatch: batchIndex + 1 })

        const batchResult = await runBatch(projectId, offset, scanConfig.batchSize)

        totalChunksScanned += batchResult.chunksScanned
        totalPairsGenerated += batchResult.pairsGenerated
        totalPairsAccepted += batchResult.pairsAccepted
        totalPairsRejected += batchResult.pairsRejected

        setAutoScanProgress({
          chunksScanned: totalChunksScanned,
          pairsGenerated: totalPairsGenerated,
          pairsAccepted: totalPairsAccepted,
          pairsRejected: totalPairsRejected
        })

        if (batchResult.chunksScanned === 0) break
        offset += scanConfig.batchSize
        batchIndex++
      }

      setAutoScanProgress({ phase: 'crystals' })
      const crystalResult = await runCrystalBatch(projectId)
      totalPairsGenerated += crystalResult.pairsGenerated
      totalPairsAccepted += crystalResult.pairsAccepted
      totalPairsRejected += crystalResult.pairsRejected

      const jiraResult = await runJiraBatch(projectId)
      totalChunksScanned += jiraResult.chunksScanned
      totalPairsGenerated += jiraResult.pairsGenerated
      totalPairsAccepted += jiraResult.pairsAccepted
      totalPairsRejected += jiraResult.pairsRejected

      const confResult = await runConfluenceBatch(projectId)
      totalChunksScanned += confResult.chunksScanned
      totalPairsGenerated += confResult.pairsGenerated
      totalPairsAccepted += confResult.pairsAccepted
      totalPairsRejected += confResult.pairsRejected
    }

    setAutoScanProgress({
      phase: 'idle',
      isRunning: false,
      lastRunAt: Date.now(),
      currentProjectId: null
    })

    const metrics = {
      chunksScanned: totalChunksScanned,
      pairsGenerated: totalPairsGenerated,
      pairsAccepted: totalPairsAccepted,
      pairsRejected: totalPairsRejected,
      acceptanceRate: totalPairsGenerated > 0
        ? totalPairsAccepted / totalPairsGenerated
        : 0
    }

    console.log(
      `[AutoScan] Complete — ${totalChunksScanned} chunks, ${totalPairsAccepted}/${totalPairsGenerated} pairs accepted`
    )

    return { pipeline: 'autoscan', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    setAutoScanProgress({ phase: 'idle', isRunning: false, currentProjectId: null })
    return {
      pipeline: 'autoscan',
      success: false,
      metrics: {},
      durationMs: Date.now() - start,
      error: (err as Error).message
    }
  }
}

export function createAutoscanPipeline(): TrainingPipeline {
  return {
    name: 'autoscan',
    priority: 2,
    triggers: ['interval', 'idle', 'manual'],
    enabled: true,
    execute
  }
}
