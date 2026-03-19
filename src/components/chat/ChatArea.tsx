import { useEffect, useCallback, useState, useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useSyncStore, getEstimatedTimeRemaining, formatRelativeTime, getPhaseLabel } from '../../stores/syncStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { EmptyState } from './EmptyState'
import { Tooltip } from '../ui/Tooltip'
import { Brain, RefreshCw, ChevronDown, Cpu, FolderPlus, Network, BarChart3, Zap, X, Database, Puzzle, GraduationCap, Bot } from 'lucide-react'
import { cn } from '../../lib/utils'
import { AddRepoModal } from '../project/AddRepoModal'

export function ChatArea() {
  const { activeProjectId, projects, activeBranch } = useProjectStore()
  const { conversations, activeConversationId, addMessage, createConversation, loadConversations, setMessageStreaming } = useChatStore()
  const { mode, setArchitectureOpen, setDashboardOpen, setMemoryOpen, setSkillsOpen, setLearningOpen, setAgentOpen } = useUIStore()
  const syncState = useSyncStore()
  const { isSyncing, hasFileChanges, lastSyncAt } = syncState

  // Cache repoId for the active project
  const [activeRepo, setActiveRepo] = useState<{ id: string; sourceType: string; sourcePath: string } | null>(null)

  // Model selector state
  const [activeModel, setActiveModel] = useState<string>('loading...')
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; tier: number; active: boolean; status: string }>>([])
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [isRefreshingModels, setIsRefreshingModels] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)


  // Model rotation notification
  const [rotationNotice, setRotationNotice] = useState<{ fromModel: string; reason: string } | null>(null)
  // Sync toast notification
  const [syncToast, setSyncToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // Add repo modal state
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false)

  // Implicit feedback timing refs
  const lastAssistantTimestamp = useRef<number | null>(null)
  const lastAssistantId = useRef<string | null>(null)
  const noFollowUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastContextChunkIds = useRef<string[]>([])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  // Ensure conversation belongs to active project
  const validConversation =
    activeConversation && activeConversation.projectId === activeProjectId
      ? activeConversation
      : null

  // Load conversations when project changes
  useEffect(() => {
    if (activeProjectId) {
      loadConversations(activeProjectId)
    }
  }, [activeProjectId, loadConversations])

  useEffect(() => {
    let pendingUpdate: { conversationId: string; content: string } | null = null
    let rafId = 0

    const flush = () => {
      if (pendingUpdate) {
        useChatStore.getState().updateLastMessage(pendingUpdate.conversationId, pendingUpdate.content)
        pendingUpdate = null
      }
      rafId = 0
    }

    const cleanup = window.electronAPI?.onChatStream?.((data) => {
      if (data.conversationId && data.content) {
        if (data.done) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
          pendingUpdate = null
          useChatStore.getState().updateLastMessage(data.conversationId, data.content)
        } else {
          pendingUpdate = { conversationId: data.conversationId, content: data.content }
          if (!rafId) rafId = requestAnimationFrame(flush)
        }
      }
    })

    return () => {
      cleanup?.()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // Listen for thinking process updates
  useEffect(() => {
    const cleanup = window.electronAPI?.onChatThinking?.((data) => {
      if (data.conversationId && data.step) {
        useChatStore.getState().pushThinkingStep(data.conversationId, {
          step: data.step,
          status: data.status,
          label: data.label,
          detail: data.detail,
          durationMs: data.durationMs,
        })
      }
    })
    return () => { cleanup?.() }
  }, [])

  // Listen for model rotation events
  useEffect(() => {
    const cleanup = window.electronAPI?.onModelRotated?.((data) => {
      // Refresh model info after rotation
      window.electronAPI?.getActiveModel?.().then(m => { if (m) setActiveModel(m) })
      window.electronAPI?.getAvailableModels?.().then(m => { if (m) setAvailableModels(m) })

      setRotationNotice({
        fromModel: data.fromModel,
        reason: data.reason
      })

      // Auto-dismiss after 6s
      setTimeout(() => setRotationNotice(null), 6000)
    })
    return () => { cleanup?.() }
  }, [])

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const model = await window.electronAPI?.getActiveModel?.()
        if (model) setActiveModel(model)
        const models = await window.electronAPI?.getAvailableModels?.()
        if (models) {
          setAvailableModels(models)
          const nonReady = models.filter(m => m.status !== 'ready')
          if (nonReady.length > 0) {
            console.log(`[Models] ${models.length} models loaded, non-ready:`, nonReady.map(m => `${m.id}(${m.status})`))
          }
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
      }
    }
    fetchModels()
  }, [])

  // Close model dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close branch dropdown on outside click


  const handleModelSelect = useCallback(async (modelId: string) => {
    try {
      const result = await window.electronAPI?.setModel?.(modelId)
      if (result?.success) {
        setActiveModel(modelId)
        setAvailableModels((prev) =>
          prev.map((m) => ({ ...m, active: m.id === modelId }))
        )
      }
    } catch (err) {
      console.error('Failed to set model:', err)
    }
    setModelDropdownOpen(false)
  }, [])

  const handleRefreshModels = useCallback(async () => {
    setIsRefreshingModels(true)
    try {
      const models = await window.electronAPI?.refreshModelsWithCheck?.()
      if (models) {
        setAvailableModels(models)
        const active = models.find(m => m.active)
        if (active) setActiveModel(active.id)
        const byStatus = models.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc }, {} as Record<string, number>)
        console.log(`[Models] Hard refresh result:`, byStatus)
      }
    } catch (err) {
      console.error('Failed to refresh models:', err)
    } finally {
      setIsRefreshingModels(false)
    }
  }, [])

  const sortedModels = [...availableModels].sort((a, b) => {
    const statusOrder: Record<string, number> = { ready: 0, quota_exhausted: 1, unavailable: 2 }
    const orderA = statusOrder[a.status] ?? 1
    const orderB = statusOrder[b.status] ?? 1
    if (orderA !== orderB) return orderA - orderB
    return b.tier - a.tier
  })

  // Load repo info + auto-start file watcher when project changes
  useEffect(() => {
    if (!activeProjectId) {
      setActiveRepo(null)
      return
    }

    let cancelled = false

    const loadRepo = async () => {
      try {
        const repos = await window.electronAPI.getReposByProject(activeProjectId)
        if (cancelled || repos.length === 0) return
        const repo = repos[0]
        setActiveRepo({ id: repo.id, sourceType: repo.source_type, sourcePath: repo.source_path })

        // Auto-start file watcher for local repos
        if (repo.source_type === 'local' && repo.source_path) {
          useSyncStore.getState().startWatcher(repo.id, repo.source_path)
        }

        // Set initial lastSyncAt from repo data
        if (repo.last_indexed_at && !useSyncStore.getState().lastSyncAt) {
          useSyncStore.setState({ lastSyncAt: repo.last_indexed_at })
        }
      } catch (err) {
        console.error('Failed to load repo info:', err)
      }
    }

    loadRepo()

    // Cleanup: stop watcher for previous project's repo
    return () => {
      cancelled = true
      if (activeRepo?.id) {
        useSyncStore.getState().stopWatcher(activeRepo.id)
      }
    }
  }, [activeProjectId])

  // Subscribe to sync/indexing events
  useEffect(() => {
    const cleanups: Array<() => void> = []

    const cleanupIndexing = window.electronAPI?.onIndexingProgress?.((data) => {
      useSyncStore.getState()._setIndexingProgress(data)
    })
    if (cleanupIndexing) cleanups.push(cleanupIndexing)

    const cleanupSync = window.electronAPI?.onSyncProgress?.((data) => {
      useSyncStore.getState()._setSyncProgress(data)
    })
    if (cleanupSync) cleanups.push(cleanupSync)

    const cleanupFileChanged = window.electronAPI?.onFileChanged?.((data) => {
      useSyncStore.getState()._setFileChanged(data)
    })
    if (cleanupFileChanged) cleanups.push(cleanupFileChanged)

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [])

  const handleSync = useCallback(async () => {
    if (!activeProjectId || !activeRepo) return
    await syncState.triggerSync(activeProjectId, activeRepo.id)
    useProjectStore.getState().loadProjects()

    const { indexingPhase, totalFiles, totalChunks } = useSyncStore.getState()
    if (indexingPhase === 'error') {
      setSyncToast({ type: 'error', message: 'Sync Brain thất bại' })
      setTimeout(() => setSyncToast(null), 6000)
    } else if (totalFiles === 0 && totalChunks === 0) {
      setSyncToast({ type: 'success', message: 'Sync hoàn tất — không có thay đổi mới' })
      setTimeout(() => setSyncToast(null), 4000)
    } else {
      setSyncToast({ type: 'success', message: `Sync hoàn tất — ${totalFiles} files thay đổi, ${totalChunks} chunks mới` })
      setTimeout(() => setSyncToast(null), 4000)
    }
  }, [activeProjectId, activeRepo, syncState])

  const handleFeedback = useCallback((messageId: string, type: 'thumbs_up' | 'thumbs_down') => {
    if (!activeProjectId || !validConversation) return
    const message = validConversation.messages.find(m => m.id === messageId)
    if (!message) return

    const prevUserMsg = validConversation.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]

    window.electronAPI?.sendFeedback?.(
      messageId,
      validConversation.id,
      activeProjectId,
      type,
      prevUserMsg?.content || '',
      lastContextChunkIds.current
    )
  }, [activeProjectId, validConversation])

  const handleCopy = useCallback((messageId: string) => {
    if (!activeProjectId || !validConversation) return

    const prevUserMsg = validConversation.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]

    window.electronAPI?.sendFeedback?.(
      messageId,
      validConversation.id,
      activeProjectId,
      'copy',
      prevUserMsg?.content || '',
      lastContextChunkIds.current
    )
  }, [activeProjectId, validConversation])

  const handleSend = useCallback(async (content: string, attachments?: import('../../types').ChatAttachment[], agentModeId?: string | null) => {
    if (!activeProjectId) return

    let convId: string | null | undefined = validConversation?.id
    if (!convId) {
      convId = await createConversation(activeProjectId, mode, activeBranch)
    }
    if (!convId) return

    if (lastAssistantTimestamp.current && lastAssistantId.current) {
      const elapsed = Date.now() - lastAssistantTimestamp.current
      const signalType = elapsed < 30000 ? 'follow_up_quick' : 'follow_up_slow'
      window.electronAPI?.sendFeedback?.(lastAssistantId.current, convId, activeProjectId, signalType, content, lastContextChunkIds.current)
      lastAssistantTimestamp.current = null
      lastAssistantId.current = null
      if (noFollowUpTimer.current) { clearTimeout(noFollowUpTimer.current); noFollowUpTimer.current = null }
    }

    await addMessage(convId, 'user', content, mode, attachments)
    useChatStore.getState().clearThinkingSteps(convId)

    const assistantMessageId = await addMessage(convId, 'assistant', '', mode)

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
    const history = (conv?.messages || [])
      .filter((m) => m.role !== 'assistant' || m.content)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const result = await window.electronAPI.sendChatMessage(
        activeProjectId,
        convId,
        content,
        mode,
        history,
        attachments,
        agentModeId || undefined
      )

      if (result.success) {
        lastContextChunkIds.current = (result.contextChunks || []).map((c: { relativePath: string }) => c.relativePath)

        // Ensure content is in store before clearing streaming state (prevents race with rAF-batched stream events)
        const finalContent = result.content || useChatStore.getState().conversations
          .find((c) => c.id === convId)?.messages.slice(-1)[0]?.content || ''
        if (finalContent && convId) {
          useChatStore.getState().updateLastMessage(convId, finalContent)
        }

        if (assistantMessageId && finalContent && window.electronAPI.updateMessageContent) {
          try {
            await window.electronAPI.updateMessageContent(assistantMessageId, finalContent)
          } catch (err) {
            console.error('Failed to persist assistant message:', err)
          }
        }
        if (assistantMessageId && convId) {
          setMessageStreaming(convId, assistantMessageId, false)
          lastAssistantTimestamp.current = Date.now()
          lastAssistantId.current = assistantMessageId
          if (noFollowUpTimer.current) clearTimeout(noFollowUpTimer.current)
          noFollowUpTimer.current = setTimeout(() => {
            if (lastAssistantId.current === assistantMessageId) {
              window.electronAPI?.sendFeedback?.(assistantMessageId, convId!, activeProjectId!, 'no_follow_up', '', lastContextChunkIds.current)
              lastAssistantTimestamp.current = null
              lastAssistantId.current = null
            }
          }, 5 * 60 * 1000)
        }
      } else {
        // Update with error message
        const errorContent = `⚠️ Lỗi: ${result.error || 'Không thể kết nối đến AI. Kiểm tra kết nối internet.'}`
        useChatStore.getState().updateLastMessage(convId!, errorContent)
        // Also persist error to DB so it shows on reload
        if (assistantMessageId && window.electronAPI.updateMessageContent) {
          await window.electronAPI.updateMessageContent(assistantMessageId, errorContent).catch(() => {})
        }
      }
        // Clear streaming state on API error
        if (assistantMessageId && convId) {
          setMessageStreaming(convId!, assistantMessageId, false)
        }
    } catch (err) {
      const errorContent = '⚠️ Lỗi kết nối. Vui lòng thử lại.'
      useChatStore.getState().updateLastMessage(convId!, errorContent)
      if (assistantMessageId && window.electronAPI.updateMessageContent) {
        await window.electronAPI.updateMessageContent(assistantMessageId, errorContent).catch(() => {})
      }
      // Clear streaming state on network error
      if (assistantMessageId && convId) {
        setMessageStreaming(convId!, assistantMessageId, false)
      }
    }
  }, [activeProjectId, validConversation, mode, addMessage, createConversation])

  // No project selected
  if (!activeProjectId || !activeProject) {
    return <EmptyState />
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar with project info */}
      <div
        className="titlebar-drag flex items-center gap-3 px-6 border-b border-[var(--border-primary)] shrink-0"
        style={{ height: 'var(--titlebar-height)' }}
      >
        <div className="titlebar-no-drag flex items-center gap-3 flex-1">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
            <Brain size={15} className="text-[var(--accent-primary)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[14px] font-semibold text-[var(--text-primary)] truncate leading-tight">
              {activeProject.brainName}
            </h1>
            <p className="text-[11px] text-[var(--text-tertiary)] truncate leading-tight">
              {activeProject.name}
            </p>
          </div>
        </div>

        <div className="titlebar-no-drag flex items-center gap-2">
          {/* Model selector */}
          <div ref={modelDropdownRef} className="relative">
            <button
              onClick={() => setModelDropdownOpen((prev) => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)] transition-all duration-100',
                modelDropdownOpen && 'bg-[var(--bg-sidebar-hover)] text-[var(--text-primary)]'
              )}
            >
              <Cpu size={12} />
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                (() => {
                  const current = availableModels.find(m => m.id === activeModel)
                  if (!current || current.status === 'ready') return 'bg-emerald-500'
                  if (current.status === 'quota_exhausted') return 'bg-amber-400'
                  return 'bg-red-500'
                })()
              )} />
              <span className="max-w-[120px] truncate font-mono">{activeModel}</span>
              <ChevronDown size={11} className={cn('transition-transform', modelDropdownOpen && 'rotate-180')} />
            </button>

            {modelDropdownOpen && sortedModels.length > 0 && (
              <div className="absolute top-full right-0 mt-1 w-72 max-h-[340px] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg z-50">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
                  <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Models</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRefreshModels() }}
                    disabled={isRefreshingModels}
                    className={cn(
                      'p-1 rounded-md transition-all',
                      'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                      'hover:bg-[var(--bg-sidebar-hover)]',
                      'disabled:opacity-50'
                    )}
                    title="Kiểm tra lại trạng thái models"
                  >
                    <RefreshCw size={12} className={cn(isRefreshingModels && 'animate-spin')} />
                  </button>
                </div>
                <div className="p-1">
                  {sortedModels.map((model) => {
                    const isReady = model.status === 'ready'
                    const isQuotaExhausted = model.status === 'quota_exhausted'

                    return (
                      <button
                        key={model.id}
                        onClick={() => handleModelSelect(model.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all',
                          'text-[12px] font-mono',
                          model.active
                            ? 'bg-[var(--accent-light)] text-[var(--accent-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-hover)]',
                          !isReady && 'opacity-50'
                        )}
                      >
                        <span className={cn(
                          'shrink-0 w-1.5 h-1.5 rounded-full',
                          isReady && 'bg-emerald-500',
                          isQuotaExhausted && 'bg-amber-400',
                          !isReady && !isQuotaExhausted && 'bg-red-500'
                        )} />
                        <span className="truncate flex-1">{model.id}</span>
                        <span className={cn(
                          'shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-sans',
                          model.tier >= 8 ? 'bg-[var(--tier-high-bg)] text-[var(--tier-high-text)]' :
                          model.tier >= 6 ? 'bg-[var(--tier-mid-bg)] text-[var(--tier-mid-text)]' :
                          model.tier >= 4 ? 'bg-[var(--tier-low-bg)] text-[var(--tier-low-text)]' :
                          'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]'
                        )}>
                          T{model.tier}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sync button */}
          {activeRepo && (
            <Tooltip
              content={isSyncing ? (getPhaseLabel(syncState) || 'Đang sync...') : 'Sync Brain'}
              side="bottom"
            >
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className={cn(
                  'relative p-1.5 rounded-lg transition-all duration-100',
                  'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  'hover:bg-[var(--bg-sidebar-hover)]',
                  'disabled:opacity-50 disabled:pointer-events-none'
                )}
              >
                <RefreshCw size={15} className={cn(isSyncing && 'animate-spin')} />
                {/* Blue dot for pending file changes */}
                {hasFileChanges && !isSyncing && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-[var(--status-info-text)] rounded-full" />
                )}
              </button>
            </Tooltip>
          )}

          {/* Sync progress or last sync time */}
          {isSyncing ? (
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-[var(--status-warning-text)] font-medium">
                {getPhaseLabel(syncState) || 'Đang sync...'}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {getEstimatedTimeRemaining(syncState) || ''}
              </span>
            </div>
          ) : lastSyncAt ? (
            <span className="text-[11px] text-[var(--text-tertiary)]">
              Sync: {formatRelativeTime(lastSyncAt)}
            </span>
          ) : null}

          {/* Architecture button */}
          <Tooltip content="Phân tích kiến trúc" side="bottom">
            <button
              onClick={() => setArchitectureOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <Network size={15} />
            </button>
          </Tooltip>

          {/* Brain Dashboard button */}
          <Tooltip content="Brain Dashboard" side="bottom">
            <button
              onClick={() => setDashboardOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <BarChart3 size={15} />
            </button>
          </Tooltip>

          {/* V2: Memory button */}
          <Tooltip content="Bộ nhớ" side="bottom">
            <button
              onClick={() => setMemoryOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <Database size={15} />
            </button>
          </Tooltip>

          {/* V2: Skills button */}
          <Tooltip content="Kỹ năng" side="bottom">
            <button
              onClick={() => setSkillsOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <Puzzle size={15} />
            </button>
          </Tooltip>

          {/* V2: Learning button */}
          <Tooltip content="Tự học" side="bottom">
            <button
              onClick={() => setLearningOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <GraduationCap size={15} />
            </button>
          </Tooltip>

          {/* V2: Agent button */}
          <Tooltip content="Agent Mode" side="bottom">
            <button
              onClick={() => setAgentOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <Bot size={15} />
            </button>
          </Tooltip>

          {/* Add repo button */}
          <Tooltip content="Import thêm repo" side="bottom">
            <button
              onClick={() => setAddRepoModalOpen(true)}
              className={cn(
                'p-1.5 rounded-lg transition-all duration-100',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]'
              )}
            >
              <FolderPlus size={15} />
            </button>
          </Tooltip>

          {/* Brain status badge */}
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
              activeProject.brainStatus === 'ready' && 'bg-[var(--status-success-bg)] text-[var(--status-success-text)]',
              activeProject.brainStatus === 'indexing' && 'bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]',
              activeProject.brainStatus === 'error' && 'bg-[var(--status-error-bg)] text-[var(--status-error-text)]',
              activeProject.brainStatus === 'idle' && 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]'
            )}
          >
            {activeProject.brainStatus === 'indexing' && (
              <RefreshCw size={10} className="animate-spin" />
            )}
            {activeProject.brainStatus === 'ready' && '● Sẵn sàng'}
            {activeProject.brainStatus === 'indexing' && 'Đang học...'}
            {activeProject.brainStatus === 'error' && 'Lỗi'}
            {activeProject.brainStatus === 'idle' && 'Chờ import'}
          </span>
        </div>
      </div>

      {/* Model rotation notification */}
      {rotationNotice && (
        <div className="px-6 py-2 bg-[var(--status-warning-bg)] border-b border-[var(--status-warning-border)] flex items-center gap-2 text-[12px] text-[var(--status-warning-text)] animate-in slide-in-from-top duration-200">
          <Zap size={14} className="shrink-0" />
          <span>
            Model <span className="font-mono font-medium">{rotationNotice.fromModel}</span> gặp lỗi ({rotationNotice.reason}).
            Đã tự động chuyển sang <span className="font-mono font-medium">{activeModel}</span>
          </span>
          <button onClick={() => setRotationNotice(null)} className="ml-auto p-0.5 rounded hover:bg-[var(--status-warning-bg)]">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Sync toast */}
      {syncToast && (
        <div className={cn(
          'px-6 py-2 border-b flex items-center gap-2 text-[12px] animate-in fade-in slide-in-from-top duration-200',
          syncToast.type === 'success'
            ? 'bg-[var(--status-success-bg)] border-[var(--status-success-border)] text-[var(--status-success-text)]'
            : 'bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-[var(--status-error-text)]'
        )}>
          <span>{syncToast.message}</span>
          <button onClick={() => setSyncToast(null)} className="ml-auto p-0.5 rounded hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Messages or empty */}
      {validConversation && validConversation.messages.length > 0 ? (
        <MessageList messages={validConversation.messages} onFeedback={handleFeedback} onCopy={handleCopy} />
      ) : (
        <EmptyState />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={() => {
          if (validConversation?.id) {
            window.electronAPI.abortChat(validConversation.id)
          }
        }}
        isStreaming={
          validConversation
            ? validConversation.messages.length > 0 &&
              validConversation.messages[validConversation.messages.length - 1].isStreaming === true
            : false
        }
        disabled={false}
        placeholder={
          activeProject.brainStatus === 'ready'
            ? 'Hỏi về dự án của bạn...'
            : activeProject.brainStatus === 'indexing'
            ? 'Brain đang indexing... (bạn vẫn có thể chat)'
            : 'Hỏi về dự án của bạn...'
        }
      />
    </div>

    {/* Add repo modal */}
    {activeProject && (
      <AddRepoModal
        open={addRepoModalOpen}
        onClose={() => setAddRepoModalOpen(false)}
        projectId={activeProject.id}
        projectName={activeProject.name}
      />
    )}
    </>
  )
}
