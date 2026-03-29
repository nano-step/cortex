import { getDb } from '../../db'
import type { Tier3Metrics } from '../evaluation-db'

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 5) return 0
  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n
  let cov = 0, varX = 0, varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  const denom = Math.sqrt(varX * varY)
  return denom === 0 ? 0 : cov / denom
}

export function computeTier3Metrics(projectId: string): Tier3Metrics {
  const db = getDb()
  const now = Date.now()
  const oneWeekAgo = now - 7 * 86400000
  const twoWeeksAgo = now - 14 * 86400000
  const thirtyDaysAgo = now - 30 * 86400000

  const fbRow = db.prepare(
    `SELECT
      COUNT(CASE WHEN signal_type = 'thumbs_up' THEN 1 END) as ups,
      COUNT(CASE WHEN signal_type = 'thumbs_down' THEN 1 END) as downs,
      COUNT(CASE WHEN signal_type = 'copy' THEN 1 END) as copies,
      COUNT(CASE WHEN signal_type = 'follow_up_quick' THEN 1 END) as quick,
      COUNT(*) as total
    FROM feedback_signals WHERE project_id = ?`
  ).get(projectId) as { ups: number; downs: number; copies: number; quick: number; total: number }

  const feedbackPositiveRate = (fbRow.ups + fbRow.downs) > 0
    ? fbRow.ups / (fbRow.ups + fbRow.downs) : 0
  const copyRate = fbRow.total > 0 ? fbRow.copies / fbRow.total : 0
  const requereryRate = fbRow.total > 0 ? fbRow.quick / fbRow.total : 0

  const thisWeekFb = db.prepare(
    `SELECT
      COUNT(CASE WHEN signal_type = 'thumbs_up' THEN 1 END) as ups,
      COUNT(CASE WHEN signal_type = 'thumbs_down' THEN 1 END) as downs
    FROM feedback_signals WHERE project_id = ? AND created_at > ?`
  ).get(projectId, oneWeekAgo) as { ups: number; downs: number }

  const lastWeekFb = db.prepare(
    `SELECT
      COUNT(CASE WHEN signal_type = 'thumbs_up' THEN 1 END) as ups,
      COUNT(CASE WHEN signal_type = 'thumbs_down' THEN 1 END) as downs
    FROM feedback_signals WHERE project_id = ? AND created_at BETWEEN ? AND ?`
  ).get(projectId, twoWeeksAgo, oneWeekAgo) as { ups: number; downs: number }

  const thisRate = (thisWeekFb.ups + thisWeekFb.downs) > 0
    ? thisWeekFb.ups / (thisWeekFb.ups + thisWeekFb.downs) : 0
  const lastRate = (lastWeekFb.ups + lastWeekFb.downs) > 0
    ? lastWeekFb.ups / (lastWeekFb.ups + lastWeekFb.downs) : 0
  const weeklyFeedbackTrend = thisRate - lastRate

  const dailyAutoscan = db.prepare(
    `SELECT
      date(created_at/1000, 'unixepoch') as day,
      AVG(CASE WHEN label > 0 THEN 1.0 ELSE 0.0 END) as rate
    FROM training_pairs
    WHERE project_id = ? AND source = 'autoscan' AND created_at > ?
    GROUP BY day ORDER BY day`
  ).all(projectId, thirtyDaysAgo) as Array<{ day: string; rate: number }>

  const dailyFeedback = db.prepare(
    `SELECT
      date(created_at/1000, 'unixepoch') as day,
      AVG(CASE WHEN signal_type = 'thumbs_up' THEN 1.0 WHEN signal_type = 'thumbs_down' THEN 0.0 END) as rate
    FROM feedback_signals
    WHERE project_id = ? AND created_at > ?
    GROUP BY day ORDER BY day`
  ).all(projectId, thirtyDaysAgo) as Array<{ day: string; rate: number }>

  const autoscanMap = new Map(dailyAutoscan.map(r => [r.day, r.rate]))
  const commonDays = dailyFeedback.filter(r => autoscanMap.has(r.day))
  const xsCorr = commonDays.map(r => autoscanMap.get(r.day)!)
  const ysCorr = commonDays.map(r => r.rate)
  const autoscanVsFeedbackCorrelation = pearsonCorrelation(xsCorr, ysCorr)

  const topChunksRows = db.prepare(
    `SELECT tp.chunk_id,
      COUNT(CASE WHEN fs.signal_type = 'thumbs_up' THEN 1 END) as positive_count,
      COUNT(CASE WHEN fs.signal_type = 'thumbs_down' THEN 1 END) as negative_count
    FROM feedback_signals fs
    JOIN training_pairs tp ON tp.project_id = fs.project_id AND tp.query = fs.query
    WHERE fs.project_id = ?
    GROUP BY tp.chunk_id
    ORDER BY positive_count DESC
    LIMIT 10`
  ).all(projectId) as Array<{ chunk_id: string; positive_count: number; negative_count: number }>

  return {
    feedbackPositiveRate,
    copyRate,
    autoscanVsFeedbackCorrelation,
    weeklyFeedbackTrend,
    topChunksByFeedback: topChunksRows.map(r => ({
      chunkId: r.chunk_id,
      positiveCount: r.positive_count,
      negativeCount: r.negative_count
    })),
    requereryRate
  }
}
