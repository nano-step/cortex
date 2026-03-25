import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { optimizePrompt, shouldAutoOptimize, markAutoOptimized } from '../../skills/learning/prompt-optimizer'

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

function getDefaultTemplate(): string {
  return `You are Cortex, an AI assistant that deeply understands the user's codebase. 
Answer questions using retrieved code context. Be precise, reference specific files and functions.
Match the user's coding conventions and style.`
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let optimized = 0
  let skipped = 0
  let totalImprovement = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      try {
        if (context.trigger !== 'manual' && !shouldAutoOptimize(projectId)) {
          skipped++
          continue
        }

        const currentTemplate = getDefaultTemplate()
        const result = await optimizePrompt(projectId, currentTemplate)

        if (result.improvement > 0) {
          optimized++
          totalImprovement += result.improvement
          markAutoOptimized(projectId)
          console.log(`[Pipeline:Prompt] Project ${projectId}: +${(result.improvement * 100).toFixed(1)}% improvement (${result.method})`)
        } else {
          skipped++
        }
      } catch (err) {
        console.error(`[Pipeline:Prompt] Failed for project ${projectId}:`, err)
      }
    }

    const metrics = {
      projectsOptimized: optimized,
      projectsSkipped: skipped,
      avgImprovement: optimized > 0 ? totalImprovement / optimized : 0
    }

    console.log(`[Pipeline:Prompt] Completed — ${optimized} optimized, ${skipped} skipped`)
    return { pipeline: 'prompt', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'prompt', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

export function createPromptPipeline(): TrainingPipeline {
  return {
    name: 'prompt',
    priority: 1,
    triggers: ['threshold', 'interval', 'idle'],
    enabled: true,
    execute
  }
}
