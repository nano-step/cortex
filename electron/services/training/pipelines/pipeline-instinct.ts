import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import {
  loadInstincts, saveInstinct, deleteInstinct, extractInstinctsFromSession,
  getRelevantInstincts, updateInstinctUsage, type Instinct
} from '../../skills/learning/instinct-system'

const LOW_CONFIDENCE_THRESHOLD = 0.15
const STALE_DAYS = 90
const MAX_INSTINCTS = 200

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()
  let extracted = 0
  let pruned = 0
  let decayed = 0

  try {
    if (context.trigger === 'post_chat') {
      extracted = await extractFromRecentConversations(context.projectId)
    }

    const pruneResult = pruneStaleInstincts()
    pruned = pruneResult.pruned
    decayed = pruneResult.decayed

    const metrics = {
      instinctsExtracted: extracted,
      instinctsPruned: pruned,
      instinctsDecayed: decayed,
      totalInstincts: loadInstincts().length
    }

    console.log(`[Pipeline:Instinct] Completed — ${extracted} extracted, ${pruned} pruned, ${decayed} decayed`)
    return { pipeline: 'instinct', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'instinct', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

async function extractFromRecentConversations(projectId?: string): Promise<number> {
  const db = getDb()
  const since = Date.now() - 2 * 60 * 60 * 1000

  let query = 'SELECT c.id FROM conversations c WHERE c.updated_at > ?'
  const params: unknown[] = [since]
  if (projectId) {
    query += ' AND c.project_id = ?'
    params.push(projectId)
  }
  query += ' ORDER BY c.updated_at DESC LIMIT 5'

  const conversations = db.prepare(query).all(...params) as Array<{ id: string }>
  let totalExtracted = 0

  for (const conv of conversations) {
    const messages = db.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 30'
    ).all(conv.id) as Array<{ role: string; content: string }>

    if (messages.length < 4) continue

    try {
      const instincts = await extractInstinctsFromSession(messages)
      for (const instinct of instincts) {
        if (isDuplicate(instinct)) continue
        saveInstinct(instinct)
        totalExtracted++
      }
    } catch {
      continue
    }
  }

  return totalExtracted
}

function isDuplicate(newInstinct: Instinct): boolean {
  const existing = loadInstincts()
  const newWords = new Set(newInstinct.pattern.toLowerCase().split(/\s+/).filter(w => w.length > 3))

  for (const inst of existing) {
    const existingWords = new Set(inst.pattern.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    let overlap = 0
    for (const word of newWords) {
      if (existingWords.has(word)) overlap++
    }
    const similarity = newWords.size > 0 ? overlap / newWords.size : 0
    if (similarity > 0.7) return true
  }

  return false
}

function pruneStaleInstincts(): { pruned: number; decayed: number } {
  const instincts = loadInstincts()
  let pruned = 0
  let decayed = 0
  const now = Date.now()
  const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000

  for (const inst of instincts) {
    if (inst.confidence < LOW_CONFIDENCE_THRESHOLD) {
      deleteInstinct(inst.id)
      pruned++
      continue
    }

    const lastActivity = inst.lastUsed || inst.createdAt
    if (lastActivity < staleCutoff && inst.useCount < 3) {
      const newConfidence = inst.confidence * 0.8
      if (newConfidence < LOW_CONFIDENCE_THRESHOLD) {
        deleteInstinct(inst.id)
        pruned++
      } else {
        saveInstinct({ ...inst, confidence: newConfidence })
        decayed++
      }
    }
  }

  if (instincts.length - pruned > MAX_INSTINCTS) {
    const sorted = loadInstincts().sort((a, b) => a.confidence - b.confidence)
    const toRemove = sorted.length - MAX_INSTINCTS
    for (let i = 0; i < toRemove; i++) {
      deleteInstinct(sorted[i].id)
      pruned++
    }
  }

  return { pruned, decayed }
}

export function createInstinctPipeline(): TrainingPipeline {
  return {
    name: 'instinct',
    priority: 0,
    triggers: ['post_chat', 'idle', 'interval'],
    enabled: true,
    execute
  }
}
