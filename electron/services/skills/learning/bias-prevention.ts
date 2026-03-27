import { getDb } from '../../db'

const ROUGE_SIMILARITY_THRESHOLD = 0.7

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(t => t.length > 2))
}

function rouge1(a: string, b: string): number {
  const tokA = tokenize(a)
  const tokB = tokenize(b)
  if (tokA.size === 0 || tokB.size === 0) return 0
  let overlap = 0
  for (const t of tokA) { if (tokB.has(t)) overlap++ }
  const precision = overlap / tokA.size
  const recall = overlap / tokB.size
  if (precision + recall === 0) return 0
  return 2 * precision * recall / (precision + recall)
}

export function isTooSimilarToExisting(
  newInstruction: string,
  projectId: string,
  threshold = ROUGE_SIMILARITY_THRESHOLD
): boolean {
  try {
    const db = getDb()
    const existing = db.prepare(
      'SELECT question FROM training_pairs WHERE project_id = ? ORDER BY created_at DESC LIMIT 500'
    ).all(projectId) as Array<{ question: string }>
    for (const { question } of existing) {
      if (rouge1(newInstruction, question) >= threshold) return true
    }
    return false
  } catch {
    return false
  }
}

export function decayConfidenceScores(projectId: string): number {
  try {
    const db = getDb()
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    const result = db.prepare(`
      UPDATE training_pairs
      SET relevance_score = MAX(0.1, relevance_score * 0.9)
      WHERE project_id = ? AND created_at < ? AND confirmed_at IS NULL
    `).run(projectId, thirtyDaysAgo)

    if (result.changes > 0) {
      console.log(`[BiasPrevention] Decayed ${result.changes} pairs for project ${projectId}`)
    }
    return result.changes
  } catch {
    return 0
  }
}

export function confirmPair(pairId: string): void {
  try {
    const db = getDb()
    db.prepare('UPDATE training_pairs SET confirmed_at = ?, relevance_score = MIN(1.0, relevance_score + 0.1) WHERE id = ?')
      .run(Date.now(), pairId)
  } catch { }
}

export function archiveLowConfidencePairs(projectId: string, minScore = 0.3): number {
  try {
    const db = getDb()
    const result = db.prepare(`
      UPDATE training_pairs SET archived = 1
      WHERE project_id = ? AND relevance_score < ? AND archived IS NULL
    `).run(projectId, minScore)
    if (result.changes > 0) {
      console.log(`[BiasPrevention] Archived ${result.changes} low-confidence pairs`)
    }
    return result.changes
  } catch {
    return 0
  }
}

export function ensureIndependentJudgeModel(generatorModel: string): string {
  const weak = ['flash-lite', 'nano', 'mini', 'haiku']
  const isWeak = (m: string) => weak.some(w => m.toLowerCase().includes(w))

  if (isWeak(generatorModel)) {
    return 'gemini-2.5-flash'
  }
  if (generatorModel.toLowerCase().includes('gemini')) {
    return 'claude-3-haiku-20240307'
  }
  return 'gemini-2.5-flash-lite'
}
