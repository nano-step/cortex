import { getDb } from '../../db'
import type { Tier1Metrics } from '../evaluation-db'

export function computeTier1Metrics(projectId: string): Tier1Metrics {
  const db = getDb()
  const now = Date.now()
  const oneWeekAgo = now - 7 * 86400000
  const twoWeeksAgo = now - 14 * 86400000

  const autoscanRow = db.prepare(
    `SELECT
      COUNT(CASE WHEN label > 0 THEN 1 END) as accepted,
      COUNT(*) as total
    FROM training_pairs WHERE project_id = ? AND source = 'autoscan'`
  ).get(projectId) as { accepted: number; total: number }

  const acceptanceRate = autoscanRow.total > 0 ? autoscanRow.accepted / autoscanRow.total : 0

  const scoreRows = db.prepare(
    `SELECT label * 5 as score FROM training_pairs
    WHERE project_id = ? AND source = 'autoscan' AND label > 0
    ORDER BY label ASC`
  ).all(projectId) as Array<{ score: number }>

  const scores = scoreRows.map(r => r.score)
  const avgJudgeScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const p25Score = scores.length > 0 ? scores[Math.floor(scores.length * 0.25)] ?? 0 : 0
  const p75Score = scores.length > 0 ? scores[Math.floor(scores.length * 0.75)] ?? 0 : 0

  const nearMissRow = db.prepare(
    `SELECT COUNT(*) as count FROM training_pairs
    WHERE project_id = ? AND source = 'autoscan' AND label = -0.1`
  ).get(projectId) as { count: number }
  const dedupRate = autoscanRow.total > 0 ? nearMissRow.count / autoscanRow.total : 0

  const distinctChunksRow = db.prepare(
    `SELECT COUNT(DISTINCT chunk_id) as count FROM training_pairs WHERE project_id = ?`
  ).get(projectId) as { count: number }
  const totalChunksRow = db.prepare(
    `SELECT COUNT(*) as count FROM chunks WHERE project_id = ?`
  ).get(projectId) as { count: number }
  const coverageRate = totalChunksRow.count > 0 ? distinctChunksRow.count / totalChunksRow.count : 0

  const totalPairsRow = db.prepare(
    `SELECT COUNT(*) as count FROM training_pairs WHERE project_id = ?`
  ).get(projectId) as { count: number }

  const thisWeekRow = db.prepare(
    `SELECT
      COUNT(CASE WHEN label > 0 THEN 1 END) as accepted,
      COUNT(*) as total
    FROM training_pairs WHERE project_id = ? AND source = 'autoscan' AND created_at > ?`
  ).get(projectId, oneWeekAgo) as { accepted: number; total: number }

  const lastWeekRow = db.prepare(
    `SELECT
      COUNT(CASE WHEN label > 0 THEN 1 END) as accepted,
      COUNT(*) as total
    FROM training_pairs WHERE project_id = ? AND source = 'autoscan'
    AND created_at BETWEEN ? AND ?`
  ).get(projectId, twoWeeksAgo, oneWeekAgo) as { accepted: number; total: number }

  const thisWeekRate = thisWeekRow.total > 0 ? thisWeekRow.accepted / thisWeekRow.total : 0
  const lastWeekRate = lastWeekRow.total > 0 ? lastWeekRow.accepted / lastWeekRow.total : 0
  const weeklyDelta = thisWeekRate - lastWeekRate

  const sourceRows = db.prepare(
    `SELECT source, COUNT(*) as count FROM training_pairs WHERE project_id = ? GROUP BY source`
  ).all(projectId) as Array<{ source: string; count: number }>
  const sourceBreakdown: Record<string, number> = {}
  for (const row of sourceRows) sourceBreakdown[row.source] = row.count

  return {
    acceptanceRate,
    avgJudgeScore,
    p25Score,
    p75Score,
    dedupRate,
    coverageRate,
    totalPairs: totalPairsRow.count,
    totalChunks: totalChunksRow.count,
    weeklyDelta,
    sourceBreakdown
  }
}
