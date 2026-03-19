import { create } from 'zustand'

interface SyncState {
  isSyncing: boolean
  syncProgress: string | null
  lastSyncAt: number | null
  syncStartedAt: number | null

  // Indexing progress (from indexing:progress event)
  indexingPhase: string | null
  totalFiles: number
  processedFiles: number
  totalChunks: number
  currentFile: string | null

  // File watcher
  watchingRepoIds: Set<string>
  hasFileChanges: boolean

  // Actions
  triggerSync: (projectId: string, repoId: string) => Promise<void>
  startWatcher: (repoId: string, localPath: string) => void
  stopWatcher: (repoId: string) => void
  stopAllWatchers: () => void
  clearFileChanges: () => void

  // Internal — called by event listeners
  _setIndexingProgress: (data: {
    repoId: string
    phase: string
    totalFiles: number
    processedFiles: number
    totalChunks: number
    currentFile?: string
    error?: string
  }) => void
  _setSyncProgress: (data: { repoId: string; message: string }) => void
  _setFileChanged: (data: { repoId: string }) => void
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  syncProgress: null,
  lastSyncAt: null,
  syncStartedAt: null,

  indexingPhase: null,
  totalFiles: 0,
  processedFiles: 0,
  totalChunks: 0,
  currentFile: null,

  watchingRepoIds: new Set(),
  hasFileChanges: false,

  triggerSync: async (projectId, repoId) => {
    if (get().isSyncing) return
    set({
      isSyncing: true,
      syncStartedAt: Date.now(),
      syncProgress: 'Đang bắt đầu sync...',
      hasFileChanges: false,
      indexingPhase: null,
      processedFiles: 0,
      totalFiles: 0,
      totalChunks: 0,
      currentFile: null
    })

    try {
      const result = await window.electronAPI.syncRepo(projectId, repoId)
      const filesChanged = (result.filesAdded || 0) + (result.filesModified || 0)
      const chunksChanged = (result.chunksAdded || 0)
      set({
        isSyncing: false,
        lastSyncAt: Date.now(),
        syncProgress: null,
        syncStartedAt: null,
        indexingPhase: result.success ? null : 'error',
        currentFile: null,
        totalFiles: filesChanged,
        totalChunks: chunksChanged
      })
      if (!result.success) {
        console.error('Sync failed:', result.error)
      }
    } catch (err) {
      console.error('Sync error:', err)
      set({
        isSyncing: false,
        syncProgress: null,
        syncStartedAt: null,
        indexingPhase: 'error'
      })
    }
  },

  startWatcher: (repoId, localPath) => {
    const state = get()
    if (state.watchingRepoIds.has(repoId)) return

    window.electronAPI?.startWatcher?.(repoId, localPath)?.catch(() => {})
    set((s) => {
      const next = new Set(s.watchingRepoIds)
      next.add(repoId)
      return { watchingRepoIds: next }
    })
  },

  stopWatcher: (repoId) => {
    window.electronAPI?.stopWatcher?.(repoId)?.catch(() => {})
    set((s) => {
      const next = new Set(s.watchingRepoIds)
      next.delete(repoId)
      return { watchingRepoIds: next }
    })
  },

  stopAllWatchers: () => {
    const state = get()
    Array.from(state.watchingRepoIds).forEach((repoId) => {
      window.electronAPI?.stopWatcher?.(repoId)?.catch(() => {})
    })
    set({ watchingRepoIds: new Set() })
  },

  clearFileChanges: () => set({ hasFileChanges: false }),

  _setIndexingProgress: (data) => {
    if (data.phase === 'done') {
      set({
        isSyncing: false,
        lastSyncAt: Date.now(),
        syncProgress: null,
        syncStartedAt: null,
        indexingPhase: 'done',
        totalFiles: data.totalFiles,
        processedFiles: data.processedFiles,
        totalChunks: data.totalChunks,
        currentFile: null
      })
    } else if (data.phase === 'error') {
      set({
        isSyncing: false,
        syncProgress: null,
        syncStartedAt: null,
        indexingPhase: 'error',
        currentFile: null
      })
    } else {
      set({
        isSyncing: true,
        indexingPhase: data.phase,
        totalFiles: data.totalFiles,
        processedFiles: data.processedFiles,
        totalChunks: data.totalChunks,
        currentFile: data.currentFile || null,
        syncStartedAt: get().syncStartedAt || Date.now()
      })
    }
  },

  _setSyncProgress: (data) => {
    set({ syncProgress: data.message })
  },

  _setFileChanged: () => {
    set({ hasFileChanges: true })
  }
}))

/**
 * Calculate estimated time remaining for sync/indexing
 */
export function getEstimatedTimeRemaining(state: SyncState): string | null {
  if (!state.isSyncing || !state.syncStartedAt) return null
  if (state.totalFiles === 0 || state.processedFiles < 2) return 'Đang tính...'

  const elapsed = Date.now() - state.syncStartedAt
  const rate = state.processedFiles / elapsed // files per ms
  const remaining = (state.totalFiles - state.processedFiles) / rate // ms

  if (remaining < 1000) return '< 1 giây còn lại'
  if (remaining < 60_000) return `~${Math.ceil(remaining / 1000)} giây còn lại`
  return `~${Math.ceil(remaining / 60_000)} phút còn lại`
}

/**
 * Format a timestamp as relative time in Vietnamese
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 30) return 'vừa xong'
  if (seconds < 60) return `${seconds} giây trước`
  if (minutes < 60) return `${minutes} phút trước`
  if (hours < 24) return `${hours} giờ trước`
  if (days === 1) return 'hôm qua'
  return `${days} ngày trước`
}

/**
 * Get Vietnamese label for indexing phase
 */
export function getPhaseLabel(state: SyncState): string | null {
  if (!state.isSyncing) return null

  switch (state.indexingPhase) {
    case 'scanning':
      return 'Đang quét...'
    case 'chunking':
      return `Đang phân tích... (${state.processedFiles}/${state.totalFiles})`
    case 'embedding':
      return 'Đang tạo embeddings...'
    default:
      return state.syncProgress || 'Đang sync...'
  }
}
