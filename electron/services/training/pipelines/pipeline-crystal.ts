import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { consolidateCrystals } from '../../knowledge/crystal-consolidator'
import { getCrystalsByProject, searchCrystalsByDomain } from '../../knowledge/crystal-store'
import { crossKnowledgeQueries } from '../training-db'
import { randomUUID } from 'crypto'
import type { KnowledgeCrystal } from '../../agents/types'

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let totalMerged = 0
  let totalPruned = 0
  let totalShared = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      try {
        const result = await consolidateCrystals(projectId)
        totalMerged += result.merged
        totalPruned += result.pruned
      } catch (err) {
        console.error(`[Pipeline:Crystal] Consolidation failed for ${projectId}:`, err)
      }
    }

    if (projectIds.length > 1) {
      totalShared = shareCrossProject(projectIds)
    }

    decayOldCrystals()

    const metrics = {
      crystalsMerged: totalMerged,
      crystalsPruned: totalPruned,
      crossProjectShared: totalShared
    }

    console.log(`[Pipeline:Crystal] Completed — ${totalMerged} merged, ${totalPruned} pruned, ${totalShared} cross-shared`)
    return { pipeline: 'crystal', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'crystal', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

function shareCrossProject(projectIds: string[]): number {
  const db = getDb()
  let shared = 0
  const HIGH_CONFIDENCE = 0.7
  const MIN_REINFORCEMENTS = 2

  for (const projectId of projectIds) {
    const crystals = getCrystalsByProject(projectId, 100)
    const shareable = crystals.filter(c =>
      c.confidence >= HIGH_CONFIDENCE &&
      c.reinforcementCount >= MIN_REINFORCEMENTS &&
      ['decision', 'pattern', 'architecture', 'error_fix'].includes(c.crystalType)
    )

    for (const crystal of shareable) {
      try {
        crossKnowledgeQueries.insert(db).run(
          randomUUID(),
          projectId,
          crystal.crystalType,
          crystal.domain || null,
          crystal.content,
          crystal.confidence
        )
        shared++
      } catch {
        // deduplicate — INSERT OR IGNORE handles existing entries
      }
    }
  }

  return shared
}

function decayOldCrystals(): void {
  const db = getDb()
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000

  try {
    db.prepare(`
      UPDATE knowledge_crystals
      SET confidence = MAX(0.1, confidence * 0.9)
      WHERE access_count = 0 AND last_reinforced_at < ? AND confidence > 0.1
    `).run(sixtyDaysAgo)
  } catch (err) {
    console.error('[Pipeline:Crystal] Decay failed:', err)
  }
}

export function getRelevantCrystalsForQuery(projectId: string, query: string, limit: number = 5): KnowledgeCrystal[] {
  const crystals = getCrystalsByProject(projectId, 50)
  if (crystals.length === 0) return []

  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3))

  const scored = crystals.map(crystal => {
    const contentWords = crystal.content.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    let matchCount = 0
    for (const word of contentWords) {
      if (queryWords.has(word)) matchCount++
    }
    const relevance = queryWords.size > 0 ? matchCount / queryWords.size : 0
    const score = relevance * crystal.confidence * (1 + crystal.reinforcementCount * 0.1)
    return { crystal, score }
  })

  return scored
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.crystal)
}

export function formatCrystalsAsContext(crystals: KnowledgeCrystal[]): string {
  if (crystals.length === 0) return ''
  const items = crystals.map(c => `- [${c.crystalType}] ${c.summary || c.content.slice(0, 200)}`)
  return `\n\n## Relevant Knowledge Crystals\n${items.join('\n')}\n`
}

export function createCrystalPipeline(): TrainingPipeline {
  return {
    name: 'crystal',
    priority: 2,
    triggers: ['idle', 'interval'],
    enabled: true,
    execute
  }
}
