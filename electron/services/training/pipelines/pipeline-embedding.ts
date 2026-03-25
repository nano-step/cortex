import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { needsReEmbed, reEmbedProject } from '../../embedder'
import { recordMetric } from '../training-db'

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let projectsChecked = 0
  let projectsReEmbedded = 0
  let chunksReEmbedded = 0
  let staleDetected = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      projectsChecked++

      try {
        const staleCount = detectStaleEmbeddings(projectId)
        staleDetected += staleCount

        if (staleCount > 0 || needsReEmbed(projectId)) {
          try {
            const reEmbedded = await reEmbedProject(projectId)
            chunksReEmbedded += reEmbedded
            projectsReEmbedded++
          } catch (err) {
            console.error(`[Pipeline:Embedding] Re-embed failed for project ${projectId}:`, err)
          }
        }
      } catch (err) {
        console.error(`[Pipeline:Embedding] Failed for project ${projectId}:`, err)
      }
    }

    const metrics = {
      projectsChecked,
      projectsReEmbedded,
      chunksReEmbedded,
      staleDetected
    }

    console.log(`[Pipeline:Embedding] Completed — ${projectsChecked} checked, ${projectsReEmbedded} re-embedded, ${staleDetected} stale found`)
    return { pipeline: 'embedding', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'embedding', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

function detectStaleEmbeddings(projectId: string): number {
  const db = getDb()

  const nullEmbeddings = (db.prepare(
    'SELECT COUNT(*) as count FROM chunks WHERE project_id = ? AND embedding IS NULL'
  ).get(projectId) as { count: number }).count

  const oldEmbeddings = (db.prepare(`
    SELECT COUNT(*) as count FROM chunks
    WHERE project_id = ? AND embedding IS NOT NULL
    AND created_at < ?
  `).get(projectId, Date.now() - 30 * 24 * 60 * 60 * 1000) as { count: number }).count

  return nullEmbeddings + oldEmbeddings
}

export function createEmbeddingPipeline(): TrainingPipeline {
  return {
    name: 'embedding',
    priority: 3,
    triggers: ['idle'],
    enabled: true,
    execute
  }
}
