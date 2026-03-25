import { getDb } from '../../db'
import { randomUUID } from 'crypto'
import { crossKnowledgeQueries } from '../training-db'
import { loadInstincts, saveInstinct, type Instinct } from '../../skills/learning/instinct-system'
import { getCrystalsByProject } from '../../knowledge/crystal-store'
import type { KnowledgeCrystal } from '../../agents/types'

export function shareInstinctsGlobally(): number {
  const instincts = loadInstincts()
  const db = getDb()
  let shared = 0

  const highConfidence = instincts.filter(i => i.confidence >= 0.7 && i.useCount >= 2)

  for (const instinct of highConfidence) {
    try {
      crossKnowledgeQueries.insert(db).run(
        randomUUID(),
        'global',
        'instinct',
        null,
        JSON.stringify({ name: instinct.name, pattern: instinct.pattern, action: instinct.action }),
        instinct.confidence
      )
      shared++
    } catch {
      continue
    }
  }

  return shared
}

export function getGlobalInstincts(limit: number = 10): Instinct[] {
  const db = getDb()
  const rows = crossKnowledgeQueries.search(db).all('instinct', null, limit) as Array<{
    id: string; content: string; confidence: number; usage_count: number; created_at: number
  }>

  return rows.map(row => {
    try {
      const data = JSON.parse(row.content) as { name: string; pattern: string; action: string }
      return {
        id: `global_${row.id}`,
        name: data.name,
        pattern: data.pattern,
        action: data.action,
        evidence: 'Cross-project shared instinct',
        confidence: row.confidence,
        useCount: row.usage_count,
        createdAt: row.created_at,
        lastUsed: null
      } satisfies Instinct
    } catch {
      return null
    }
  }).filter((i): i is Instinct => i !== null)
}

export function getCrossProjectCrystals(domain: string, limit: number = 5): Array<{
  content: string; crystalType: string; confidence: number; sourceProjectId: string
}> {
  const db = getDb()
  const rows = crossKnowledgeQueries.search(db).all('crystal', domain, limit) as Array<{
    id: string; source_project_id: string; knowledge_type: string;
    content: string; confidence: number; usage_count: number
  }>

  return rows.map(row => ({
    content: row.content,
    crystalType: row.knowledge_type,
    confidence: row.confidence,
    sourceProjectId: row.source_project_id
  }))
}

export function recordCrossKnowledgeUsage(knowledgeId: string): void {
  const db = getDb()
  try {
    crossKnowledgeQueries.incrementUsage(db).run(Date.now(), knowledgeId)
  } catch {
    return
  }
}

export function pruneUnusedKnowledge(): number {
  const db = getDb()
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000

  try {
    const result = crossKnowledgeQueries.prune(db).run(ninetyDaysAgo)
    return result.changes
  } catch {
    return 0
  }
}

export function getCrossProjectStats(): {
  totalKnowledge: number
  byType: Record<string, number>
  topDomains: Array<{ domain: string; count: number }>
} {
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) as count FROM cross_project_knowledge').get() as { count: number }).count

  const byTypeRows = db.prepare(
    'SELECT knowledge_type, COUNT(*) as count FROM cross_project_knowledge GROUP BY knowledge_type'
  ).all() as Array<{ knowledge_type: string; count: number }>
  const byType: Record<string, number> = {}
  for (const row of byTypeRows) byType[row.knowledge_type] = row.count

  const topDomains = db.prepare(
    'SELECT domain, COUNT(*) as count FROM cross_project_knowledge WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC LIMIT 10'
  ).all() as Array<{ domain: string; count: number }>

  return { totalKnowledge: total, byType, topDomains }
}
