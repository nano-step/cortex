import { computeTier1Metrics } from './evaluators/tier1-proxy'
import { computeTier3Metrics } from './evaluators/tier3-feedback'
import { saveEvalSnapshot, initEvalSchema } from './evaluation-db'

export async function runPostScanEvaluation(projectId: string): Promise<void> {
  try {
    initEvalSchema()
    const tier1 = computeTier1Metrics(projectId)
    saveEvalSnapshot(projectId, 1, tier1)
    const tier3 = computeTier3Metrics(projectId)
    saveEvalSnapshot(projectId, 3, tier3)
  } catch (err) {
    console.error(`[EvalRunner] Post-scan evaluation failed for ${projectId}:`, err)
  }
}
