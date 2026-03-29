import { getDb } from '../../db'
import { searchChunksHybrid } from '../../brain-engine'
import type { Tier2Metrics } from '../evaluation-db'

function ndcgIdeal(relevantCount: number, k: number): number {
  let ideal = 0
  const n = Math.min(relevantCount, k)
  for (let i = 1; i <= n; i++) ideal += 1 / Math.log2(i + 1)
  return ideal
}

export async function computeTier2Metrics(
  projectId: string,
  sampleSize = 50
): Promise<Tier2Metrics> {
  const db = getDb()

  const pairs = db.prepare(
    `SELECT query, chunk_id FROM training_pairs
    WHERE project_id = ? AND label > 0 AND source IN ('thumbs_up', 'copy', 'autoscan')
    ORDER BY RANDOM() LIMIT ?`
  ).all(projectId, sampleSize * 3) as Array<{ query: string; chunk_id: string }>

  const queryMap = new Map<string, Set<string>>()
  for (const p of pairs) {
    if (!queryMap.has(p.query)) queryMap.set(p.query, new Set())
    queryMap.get(p.query)!.add(p.chunk_id)
  }

  const queries = Array.from(queryMap.keys()).slice(0, sampleSize)
  if (queries.length === 0) {
    return { recallAt5: 0, recallAt10: 0, mrr: 0, ndcgAt10: 0, queriesEvaluated: 0, avgRelevantRank: 0 }
  }

  let totalRecallAt5 = 0
  let totalRecallAt10 = 0
  let totalMrr = 0
  let totalNdcg = 0
  let totalFirstRelevantRank = 0
  let queriesWithRelevant = 0

  for (const query of queries) {
    const relevant = queryMap.get(query)!
    let results: Array<{ chunkId: string }>
    try {
      results = await searchChunksHybrid(projectId, query, 10)
    } catch {
      continue
    }

    const rankedIds = results.map(r => r.chunkId)

    const hitAt5 = rankedIds.slice(0, 5).filter(id => relevant.has(id)).length
    const hitAt10 = rankedIds.slice(0, 10).filter(id => relevant.has(id)).length
    totalRecallAt5 += relevant.size > 0 ? hitAt5 / relevant.size : 0
    totalRecallAt10 += relevant.size > 0 ? hitAt10 / relevant.size : 0

    let firstRank = 0
    for (let i = 0; i < rankedIds.length; i++) {
      if (relevant.has(rankedIds[i])) { firstRank = i + 1; break }
    }
    totalMrr += firstRank > 0 ? 1 / firstRank : 0
    if (firstRank > 0) {
      totalFirstRelevantRank += firstRank
      queriesWithRelevant++
    }

    let dcg = 0
    for (let i = 0; i < rankedIds.length; i++) {
      if (relevant.has(rankedIds[i])) dcg += 1 / Math.log2(i + 2)
    }
    const ideal = ndcgIdeal(relevant.size, 10)
    totalNdcg += ideal > 0 ? dcg / ideal : 0
  }

  const n = queries.length
  return {
    recallAt5: n > 0 ? totalRecallAt5 / n : 0,
    recallAt10: n > 0 ? totalRecallAt10 / n : 0,
    mrr: n > 0 ? totalMrr / n : 0,
    ndcgAt10: n > 0 ? totalNdcg / n : 0,
    queriesEvaluated: n,
    avgRelevantRank: queriesWithRelevant > 0 ? totalFirstRelevantRank / queriesWithRelevant : 0
  }
}
