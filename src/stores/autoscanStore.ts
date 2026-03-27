import { create } from 'zustand'

export interface AutoScanConfig {
  batchSize: number
  judgeThreshold: number
  maxQuestionsPerChunk: number
  enableEvolInstruct: boolean
  pauseDuringChat: boolean
  enabled: boolean
}

export interface AutoScanProgress {
  phase: 'chunks' | 'crystals' | 'idle'
  currentBatch: number
  totalBatches: number
  chunksScanned: number
  pairsGenerated: number
  pairsAccepted: number
  pairsRejected: number
  lastRunAt: number | null
  isRunning: boolean
  currentProjectId: string | null
}

const DEFAULT_CONFIG: AutoScanConfig = {
  batchSize: 20,
  judgeThreshold: 4.0,
  maxQuestionsPerChunk: 3,
  enableEvolInstruct: true,
  pauseDuringChat: true,
  enabled: false
}

interface AutoScanState {
  progress: AutoScanProgress | null
  config: AutoScanConfig
  loading: boolean
  pollingInterval: ReturnType<typeof setInterval> | null

  loadProgress: () => Promise<void>
  loadConfig: () => Promise<void>
  updateConfig: (config: Partial<AutoScanConfig>) => Promise<void>
  triggerManual: (projectId: string) => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useAutoscanStore = create<AutoScanState>((set, get) => ({
  progress: null,
  config: DEFAULT_CONFIG,
  loading: false,
  pollingInterval: null,

  loadProgress: async () => {
    try {
      const progress = await window.electronAPI?.autoscanGetProgress?.()
      if (progress) set({ progress })
    } catch (err) {
      console.error('[AutoscanStore] Failed to load progress:', err)
    }
  },

  loadConfig: async () => {
    try {
      const config = await window.electronAPI?.autoscanGetConfig?.()
      if (config) set({ config })
    } catch (err) {
      console.error('[AutoscanStore] Failed to load config:', err)
    }
  },

  updateConfig: async (partial: Partial<AutoScanConfig>) => {
    const newConfig = { ...get().config, ...partial }
    set({ config: newConfig })
    try {
      await window.electronAPI?.autoscanSetConfig?.(newConfig)
    } catch (err) {
      console.error('[AutoscanStore] Failed to update config:', err)
    }
  },

  triggerManual: async (projectId: string) => {
    set({ loading: true })
    try {
      await window.electronAPI?.autoscanTrigger?.(projectId)
      await get().loadProgress()
    } catch (err) {
      console.error('[AutoscanStore] Failed to trigger manual scan:', err)
    } finally {
      set({ loading: false })
    }
  },

  startPolling: () => {
    const existing = get().pollingInterval
    if (existing) return

    const interval = setInterval(async () => {
      await get().loadProgress()
    }, 5_000)

    set({ pollingInterval: interval })
  },

  stopPolling: () => {
    const interval = get().pollingInterval
    if (interval) {
      clearInterval(interval)
      set({ pollingInterval: null })
    }
  }
}))
