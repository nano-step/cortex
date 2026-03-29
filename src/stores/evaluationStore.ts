import { create } from 'zustand'

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

interface EvaluationState {
  tier1: Tier1Metrics | null
  tier2: Tier2Metrics | null
  tier3: Tier3Metrics | null
  tier1History: EvalSnapshot[]
  tier2History: EvalSnapshot[]
  tier3History: EvalSnapshot[]
  running: { tier1: boolean; tier2: boolean; tier3: boolean }
  lastEvaluatedAt: { tier1: number | null; tier2: number | null; tier3: number | null }

  loadLatest: (projectId: string) => Promise<void>
  runTier1: (projectId: string) => Promise<void>
  runTier2: (projectId: string) => Promise<void>
  runTier3: (projectId: string) => Promise<void>
  runAll: (projectId: string) => Promise<void>
  loadHistory: (projectId: string, tier: 1 | 2 | 3) => Promise<void>
}

export const useEvaluationStore = create<EvaluationState>((set, get) => ({
  tier1: null,
  tier2: null,
  tier3: null,
  tier1History: [],
  tier2History: [],
  tier3History: [],
  running: { tier1: false, tier2: false, tier3: false },
  lastEvaluatedAt: { tier1: null, tier2: null, tier3: null },

  loadLatest: async (projectId: string) => {
    try {
      const result = await window.electronAPI?.evaluationGetLatest?.(projectId)
      if (!result) return
      const t1 = result.tier1?.metrics as Tier1Metrics | null
      const t2 = result.tier2?.metrics as Tier2Metrics | null
      const t3 = result.tier3?.metrics as Tier3Metrics | null
      set({
        tier1: t1 ?? null,
        tier2: t2 ?? null,
        tier3: t3 ?? null,
        lastEvaluatedAt: {
          tier1: result.tier1?.evaluatedAt ?? null,
          tier2: result.tier2?.evaluatedAt ?? null,
          tier3: result.tier3?.evaluatedAt ?? null,
        }
      })
    } catch (err) {
      console.error('[EvaluationStore] loadLatest failed:', err)
    }
  },

  runTier1: async (projectId: string) => {
    set(s => ({ running: { ...s.running, tier1: true } }))
    try {
      const metrics = await window.electronAPI?.evaluationRunTier1?.(projectId)
      if (metrics) set({ tier1: metrics as Tier1Metrics, lastEvaluatedAt: { ...get().lastEvaluatedAt, tier1: Date.now() } })
    } catch (err) {
      console.error('[EvaluationStore] runTier1 failed:', err)
    } finally {
      set(s => ({ running: { ...s.running, tier1: false } }))
    }
  },

  runTier2: async (projectId: string) => {
    set(s => ({ running: { ...s.running, tier2: true } }))
    try {
      const metrics = await window.electronAPI?.evaluationRunTier2?.(projectId)
      if (metrics) set({ tier2: metrics as Tier2Metrics, lastEvaluatedAt: { ...get().lastEvaluatedAt, tier2: Date.now() } })
    } catch (err) {
      console.error('[EvaluationStore] runTier2 failed:', err)
    } finally {
      set(s => ({ running: { ...s.running, tier2: false } }))
    }
  },

  runTier3: async (projectId: string) => {
    set(s => ({ running: { ...s.running, tier3: true } }))
    try {
      const metrics = await window.electronAPI?.evaluationRunTier3?.(projectId)
      if (metrics) set({ tier3: metrics as Tier3Metrics, lastEvaluatedAt: { ...get().lastEvaluatedAt, tier3: Date.now() } })
    } catch (err) {
      console.error('[EvaluationStore] runTier3 failed:', err)
    } finally {
      set(s => ({ running: { ...s.running, tier3: false } }))
    }
  },

  runAll: async (projectId: string) => {
    set({ running: { tier1: true, tier2: true, tier3: true } })
    try {
      const result = await window.electronAPI?.evaluationRunAll?.(projectId)
      if (result) {
        const now = Date.now()
        set({
          tier1: result.tier1 as Tier1Metrics ?? null,
          tier2: result.tier2 as Tier2Metrics ?? null,
          tier3: result.tier3 as Tier3Metrics ?? null,
          lastEvaluatedAt: { tier1: now, tier2: now, tier3: now }
        })
      }
    } catch (err) {
      console.error('[EvaluationStore] runAll failed:', err)
    } finally {
      set({ running: { tier1: false, tier2: false, tier3: false } })
    }
  },

  loadHistory: async (projectId: string, tier: 1 | 2 | 3) => {
    try {
      const history = await window.electronAPI?.evaluationGetHistory?.(projectId, tier)
      if (!history) return
      if (tier === 1) set({ tier1History: history as EvalSnapshot[] })
      else if (tier === 2) set({ tier2History: history as EvalSnapshot[] })
      else set({ tier3History: history as EvalSnapshot[] })
    } catch (err) {
      console.error('[EvaluationStore] loadHistory failed:', err)
    }
  }
}))
