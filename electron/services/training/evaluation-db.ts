import { randomUUID } from 'crypto'
import { getDb } from '../db'

export interface Tier1Metrics {
  acceptanceRate: number
  avgJudgeScore: number
  p25Score: number
  p75Score: number
  dedupRate: number
  coverageRate: number
  totalPairs: number
  totalChunks: number
  weeklyDelta: number
  sourceBreakdown: Record<string, number>
}

export interface Tier2Metrics {
  recallAt5: number
  recallAt10: number
  mrr: number
  ndcgAt10: number
  queriesEvaluated: number
  avgRelevantRank: number
}

export interface Tier3Metrics {
  feedbackPositiveRate: number
  copyRate: number
  autoscanVsFeedbackCorrelation: number
  weeklyFeedbackTrend: number
  topChunksByFeedback: Array<{ chunkId: string; positiveCount: number; negativeCount: number }>
  requereryRate: number
}

export interface EvalSnapshot {
  id: string
  projectId: string
  tier: 1 | 2 | 3
  metrics: Tier1Metrics | Tier2Metrics | Tier3Metrics
  evaluatedAt: number
}

export function initEvalSchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS autoscan_eval_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      tier INTEGER NOT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      evaluated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_eval_runs_project
    ON autoscan_eval_runs(project_id, tier, evaluated_at DESC)
  `)
}

export function saveEvalSnapshot(
  projectId: string,
  tier: 1 | 2 | 3,
  metrics: Tier1Metrics | Tier2Metrics | Tier3Metrics
): string {
  const db = getDb()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO autoscan_eval_runs (id, project_id, tier, metrics) VALUES (?, ?, ?, ?)'
  ).run(id, projectId, tier, JSON.stringify(metrics))
  return id
}

export function getLatestEvalSnapshot(projectId: string, tier: 1 | 2 | 3): EvalSnapshot | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM autoscan_eval_runs WHERE project_id = ? AND tier = ? ORDER BY evaluated_at DESC LIMIT 1'
  ).get(projectId, tier) as { id: string; project_id: string; tier: number; metrics: string; evaluated_at: number } | undefined
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    tier: row.tier as 1 | 2 | 3,
    metrics: JSON.parse(row.metrics),
    evaluatedAt: row.evaluated_at
  }
}

export function getEvalHistory(projectId: string, tier: 1 | 2 | 3, limit = 30): EvalSnapshot[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM autoscan_eval_runs WHERE project_id = ? AND tier = ? ORDER BY evaluated_at DESC LIMIT ?'
  ).all(projectId, tier, limit) as Array<{ id: string; project_id: string; tier: number; metrics: string; evaluated_at: number }>
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    tier: row.tier as 1 | 2 | 3,
    metrics: JSON.parse(row.metrics),
    evaluatedAt: row.evaluated_at
  }))
}
