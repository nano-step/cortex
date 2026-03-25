import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { getArchivalMemories, searchArchivalMemory, deleteArchivalMemory } from '../../memory/archival-memory'
import { getRecentRecall } from '../../memory/recall-memory'
import { addArchivalMemory } from '../../memory/memory-manager'

const MAX_ARCHIVAL_PER_PROJECT = 500
const STALE_DAYS = 120
const DUPLICATE_SIMILARITY_THRESHOLD = 0.75

function getAllProjectIds(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  return rows.map(r => r.id)
}

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let totalPruned = 0
  let totalPromoted = 0
  let totalDecayed = 0

  try {
    const projectIds = context.projectId ? [context.projectId] : getAllProjectIds()

    for (const projectId of projectIds) {
      try {
        const pruned = pruneStaleMemories(projectId)
        totalPruned += pruned

        const promoted = await promoteValuableRecall(projectId)
        totalPromoted += promoted

        const decayed = decayUnusedMemories(projectId)
        totalDecayed += decayed

        enforceMemoryBudget(projectId)
      } catch (err) {
        console.error(`[Pipeline:Memory] Failed for project ${projectId}:`, err)
      }
    }

    const metrics = {
      memoriesPruned: totalPruned,
      recallPromoted: totalPromoted,
      memoriesDecayed: totalDecayed
    }

    console.log(`[Pipeline:Memory] Completed — ${totalPruned} pruned, ${totalPromoted} promoted, ${totalDecayed} decayed`)
    return { pipeline: 'memory', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'memory', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

function pruneStaleMemories(projectId: string): number {
  const db = getDb()
  const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
  let pruned = 0

  const staleRows = db.prepare(`
    SELECT id FROM archival_memory
    WHERE project_id = ? AND access_count = 0 AND relevance_score < 0.3 AND created_at < ?
    LIMIT 50
  `).all(projectId, staleCutoff) as Array<{ id: string }>

  for (const row of staleRows) {
    try {
      deleteArchivalMemory(row.id)
      pruned++
    } catch {
      continue
    }
  }

  return pruned
}

async function promoteValuableRecall(projectId: string): Promise<number> {
  const db = getDb()
  let promoted = 0

  const valuableRecalls = db.prepare(`
    SELECT content, role FROM recall_memory
    WHERE project_id = ? AND role = 'assistant'
    AND LENGTH(content) > 200
    ORDER BY created_at DESC LIMIT 20
  `).all(projectId) as Array<{ content: string; role: string }>

  for (const recall of valuableRecalls) {
    const hasDecisionMarkers = /(?:decided|chose|because|therefore|conclusion|recommendation)/i.test(recall.content)
    const hasPatternMarkers = /(?:pattern|convention|always|never|best practice|approach)/i.test(recall.content)

    if (!hasDecisionMarkers && !hasPatternMarkers) continue

    const existing = await searchArchivalMemory(projectId, recall.content.slice(0, 100), 3)
    const isDuplicate = existing.some(e => e.score > DUPLICATE_SIMILARITY_THRESHOLD)
    if (isDuplicate) continue

    const category = hasDecisionMarkers ? 'decision' : 'pattern'
    await addArchivalMemory(projectId, recall.content, { category, source: 'auto_promotion' })
    promoted++

    if (promoted >= 5) break
  }

  return promoted
}

function decayUnusedMemories(projectId: string): number {
  const db = getDb()
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const result = db.prepare(`
    UPDATE archival_memory
    SET relevance_score = MAX(0.05, relevance_score * 0.9)
    WHERE project_id = ? AND access_count = 0 AND accessed_at < ? AND relevance_score > 0.1
  `).run(projectId, thirtyDaysAgo)

  return result.changes
}

function enforceMemoryBudget(projectId: string): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as count FROM archival_memory WHERE project_id = ?').get(projectId) as { count: number }).count

  if (count <= MAX_ARCHIVAL_PER_PROJECT) return

  const excess = count - MAX_ARCHIVAL_PER_PROJECT
  const toRemove = db.prepare(`
    SELECT id FROM archival_memory
    WHERE project_id = ?
    ORDER BY relevance_score ASC, access_count ASC, created_at ASC
    LIMIT ?
  `).all(projectId, excess) as Array<{ id: string }>

  for (const row of toRemove) {
    try {
      deleteArchivalMemory(row.id)
    } catch {
      continue
    }
  }

  if (toRemove.length > 0) {
    console.log(`[Pipeline:Memory] Budget enforced: removed ${toRemove.length} memories from project ${projectId}`)
  }
}

export function createMemoryPipeline(): TrainingPipeline {
  return {
    name: 'memory',
    priority: 2,
    triggers: ['idle', 'interval'],
    enabled: true,
    execute
  }
}
