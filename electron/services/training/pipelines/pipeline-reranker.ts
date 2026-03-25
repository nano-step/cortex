import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { trainFromPairs } from '../../learned-reranker'
import { convertSignalsToTrainingPairs } from '../../feedback-collector'
import { recordMetric } from '../training-db'

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let totalTrained = 0
  let totalWeights = 0
  let totalConverted = 0
  let projectsProcessed = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      try {
        const { converted } = convertSignalsToTrainingPairs(projectId)
        totalConverted += converted

        const { trained, weightsUpdated } = trainFromPairs(projectId)
        totalTrained += trained
        totalWeights += weightsUpdated
        projectsProcessed++
      } catch (err) {
        console.error(`[Pipeline:Reranker] Failed for project ${projectId}:`, err)
      }
    }

    const metrics = {
      projectsProcessed,
      signalsConverted: totalConverted,
      pairsTrained: totalTrained,
      weightsUpdated: totalWeights
    }

    console.log(`[Pipeline:Reranker] Completed — ${projectsProcessed} projects, ${totalTrained} trained, ${totalWeights} weights`)
    return { pipeline: 'reranker', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'reranker', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

export function createRerankerPipeline(): TrainingPipeline {
  return {
    name: 'reranker',
    priority: 0,
    triggers: ['threshold', 'interval', 'idle', 'post_chat'],
    enabled: true,
    execute
  }
}
