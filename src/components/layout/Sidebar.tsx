import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Brain,
  Plus,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Trash2,
  ChevronDown,
  SquarePen,
  FolderOpen,
  MoreHorizontal,
  Check,
  Pin,
  PinOff
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { useChatStore } from '../../stores/chatStore'
import { Tooltip } from '../ui/Tooltip'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Toggle } from '../ui/Toggle'

// Group conversations by time period (like ChatGPT)
function groupConversationsByTime(conversations: Array<{ id: string; title: string; pinned?: boolean; createdAt?: number }>) {
  const now = Date.now()
  const day = 86400000
  const groups: { label: string; items: typeof conversations }[] = []

  const pinned: typeof conversations = []
  const today: typeof conversations = []
  const yesterday: typeof conversations = []
  const last7: typeof conversations = []
  const last30: typeof conversations = []
  const older: typeof conversations = []

  for (const conv of conversations) {
    if (conv.pinned) { pinned.push(conv); continue }
    const age = now - (conv.createdAt || 0)
    if (age < day) today.push(conv)
    else if (age < 2 * day) yesterday.push(conv)
    else if (age < 7 * day) last7.push(conv)
    else if (age < 30 * day) last30.push(conv)
    else older.push(conv)
  }

  if (pinned.length) groups.push({ label: '📌 Đã ghim', items: pinned })
  if (today.length) groups.push({ label: 'Hôm nay', items: today })
  if (yesterday.length) groups.push({ label: 'Hôm qua', items: yesterday })
  if (last7.length) groups.push({ label: '7 ngày trước', items: last7 })
  if (last30.length) groups.push({ label: '30 ngày trước', items: last30 })
  if (older.length) groups.push({ label: 'Cũ hơn', items: older })

  return groups
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mode, setMode, openNewProjectModal, toggleSettings } = useUIStore()
  const { projects, activeProjectId, setActiveProject, removeProject, activeBranch } = useProjectStore()
  const { conversations, activeConversationId, setActiveConversation, createConversation, deleteConversation, renameConversation, pinConversation, isLoadingConversations } = useChatStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectConversations = activeProjectId
    ? conversations.filter((c) => c.projectId === activeProjectId)
    : []

  const groupedConversations = useMemo(
    () => groupConversationsByTime(projectConversations),
    [projectConversations]
  )

  const handleNewConversation = async () => {
    if (!activeProjectId) return
    await createConversation(activeProjectId, mode, activeBranch)
  }

  // Project dropdown
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'project' | 'conversation'; id: string; name: string } | null>(null)

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.type === 'project') {
      await removeProject(deleteTarget.id)
    } else {
      await deleteConversation(deleteTarget.id)
    }
    setDeleteTarget(null)
  }

  // Hover action for conversations
  const [hoveredConv, setHoveredConv] = useState<string | null>(null)

  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const startRename = (convId: string, currentTitle: string) => {
    setEditingConvId(convId)
    setEditingTitle(currentTitle)
  }

  const commitRename = async () => {
    if (editingConvId && editingTitle.trim()) {
      await renameConversation(editingConvId, editingTitle)
    }
    setEditingConvId(null)
    setEditingTitle('')
  }

  const cancelRename = () => {
    setEditingConvId(null)
    setEditingTitle('')
  }

  return (
    <>
    <aside
      className={cn(
        'h-full flex flex-col bg-[var(--bg-sidebar)]',
        'transition-all duration-300 ease-out shrink-0 overflow-hidden'
      )}
      style={{ width: sidebarCollapsed ? 68 : 260 }}
    >
      {sidebarCollapsed ? (
        /* ── Collapsed: 68px icon column ── */
        <div className="flex flex-col h-full items-center">
          <div className="titlebar-drag shrink-0 w-full" style={{ height: 'var(--titlebar-height)' }} />

          <div className="py-1">
            <Tooltip content="Mở rộng sidebar" side="right">
              <button
                onClick={toggleSidebar}
                className={cn(
                  'titlebar-no-drag p-2 rounded-xl',
                  'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  'hover:bg-[var(--bg-sidebar-hover)]',
                  'transition-all duration-100'
                )}
              >
                <PanelLeftOpen size={18} />
              </button>
            </Tooltip>
          </div>

          <div className="py-1">
            <Tooltip content="Trò chuyện mới" side="right">
              <button
                onClick={handleNewConversation}
                disabled={!activeProjectId}
                className={cn(
                  'titlebar-no-drag p-2 rounded-xl',
                  'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  'hover:bg-[var(--bg-sidebar-hover)]',
                  'transition-all duration-100',
                  !activeProjectId && 'opacity-40 cursor-not-allowed'
                )}
              >
                <SquarePen size={18} />
              </button>
            </Tooltip>
          </div>

          {/* Project icons */}
          <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 w-full">
            {projects.map((project) => (
              <Tooltip key={project.id} content={project.name} side="right">
                <button
                  onClick={() => setActiveProject(project.id)}
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center',
                    'text-[13px] font-semibold',
                    'transition-all duration-100',
                    project.id === activeProjectId
                      ? 'bg-[var(--bg-sidebar-active)] text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-sidebar-hover)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {project.name.charAt(0).toUpperCase()}
                </button>
              </Tooltip>
            ))}
          </div>

          {/* Mode toggle */}
          <div className="py-1">
            <Tooltip content={mode === 'pm' ? 'PM Mode' : 'Engineer Mode'} side="right">
              <Toggle mode={mode} onChange={setMode} collapsed />
            </Tooltip>
          </div>

          {/* Bottom icons */}
          <div className="py-3 flex flex-col items-center gap-1.5 w-full">
            <Tooltip content="Tạo dự án mới" side="right">
              <Button variant="ghost" size="icon" onClick={openNewProjectModal}>
                <Plus size={18} />
              </Button>
            </Tooltip>
            <Tooltip content="Cài đặt" side="right">
              <Button variant="ghost" size="icon" onClick={toggleSettings}>
                <Settings size={18} />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : (
        /* ── Expanded: 260px ChatGPT-style sidebar ── */
        <>
          {/* Header — Sidebar toggle + New Chat */}
          <div
            className="titlebar-drag flex items-center justify-between px-3 shrink-0"
            style={{ height: 'var(--titlebar-height)' }}
          >
            <div className="w-[68px] shrink-0" />
            <button
              onClick={toggleSidebar}
              className={cn(
                'titlebar-no-drag p-1.5 rounded-lg',
                'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]',
                'transition-all duration-100'
              )}
            >
              <PanelLeftClose size={18} />
            </button>
            <div className="flex-1" />
            <Tooltip content="Trò chuyện mới">
              <button
                onClick={handleNewConversation}
                disabled={!activeProjectId}
                className={cn(
                  'titlebar-no-drag p-1.5 rounded-lg',
                  'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  'hover:bg-[var(--bg-sidebar-hover)]',
                  'transition-all duration-100',
                  !activeProjectId && 'opacity-40 cursor-not-allowed'
                )}
              >
                <SquarePen size={18} />
              </button>
            </Tooltip>
          </div>

          {/* Project Selector — compact dropdown */}
          <div className="px-3 pb-2" ref={dropdownRef}>
            <button
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
                'text-[14px] font-medium text-[var(--text-primary)]',
                'hover:bg-[var(--bg-sidebar-hover)]',
                'transition-all duration-100'
              )}
            >
              <Brain size={18} className="text-[var(--accent-primary)] shrink-0" />
              <span className="truncate flex-1 text-left">
                {activeProject?.name || 'Chọn dự án'}
              </span>
              <ChevronDown size={14} className={cn(
                'text-[var(--text-tertiary)] transition-transform duration-200',
                projectDropdownOpen && 'rotate-180'
              )} />
            </button>

            {/* Dropdown */}
            {projectDropdownOpen && (
              <div className="mt-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg overflow-hidden z-50 relative">
                <div className="py-1 max-h-[240px] overflow-y-auto">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => {
                        setActiveProject(project.id)
                        setProjectDropdownOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left',
                        'text-[13px] transition-all duration-100',
                        project.id === activeProjectId
                          ? 'text-[var(--text-primary)] bg-[var(--bg-secondary)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-hover)]'
                      )}
                    >
                      <FolderOpen size={14} className="shrink-0 opacity-60" />
                      <span className="truncate flex-1">{project.name}</span>
                      {project.id === activeProjectId && (
                        <Check size={14} className="text-[var(--accent-primary)] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-[var(--border-primary)]">
                  <button
                    onClick={() => {
                      setProjectDropdownOpen(false)
                      openNewProjectModal()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-hover)] transition-all"
                  >
                    <Plus size={14} className="shrink-0" />
                    <span>Tạo dự án mới</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Conversation List — main content area */}
          <div className="flex-1 overflow-y-auto px-2">
            {!activeProjectId ? (
              <div className="px-3 py-8 text-center">
                <Brain size={32} className="text-[var(--text-tertiary)] mx-auto mb-3 opacity-40" />
                <p className="text-[13px] text-[var(--text-tertiary)]">
                  Chọn một dự án để bắt đầu
                </p>
              </div>
            ) : isLoadingConversations ? (
              <div className="px-3 py-4 space-y-2">
                {[70, 85, 60, 90, 50].map((w, i) => (
                  <div key={i} className="h-8 rounded-lg skeleton-shimmer" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : projectConversations.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <MessageSquare size={28} className="text-[var(--text-tertiary)] mx-auto mb-3 opacity-40" />
                <p className="text-[13px] text-[var(--text-tertiary)] mb-2">
                  Chưa có cuộc trò chuyện nào
                </p>
                <button
                  onClick={handleNewConversation}
                  className="text-[13px] text-[var(--accent-primary)] hover:underline"
                >
                  Tạo cuộc trò chuyện mới
                </button>
              </div>
            ) : (
              /* Grouped conversations */
              groupedConversations.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => {
                          if (editingConvId !== conv.id) setActiveConversation(conv.id)
                        }}
                        onDoubleClick={() => startRename(conv.id, conv.title)}
                        onMouseEnter={() => setHoveredConv(conv.id)}
                        onMouseLeave={() => setHoveredConv(null)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg group/conv relative cursor-pointer',
                          'text-[13px] text-[var(--text-secondary)]',
                          'hover:bg-[var(--bg-sidebar-hover)]',
                          'transition-all duration-100',
                          conv.id === activeConversationId &&
                            'bg-[var(--bg-sidebar-active)] text-[var(--text-primary)]'
                        )}
                      >
                        <div className="flex items-center gap-2 pr-14">
                          {editingConvId === conv.id ? (
                            <input
                              autoFocus
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') cancelRename()
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                'flex-1 min-w-0 bg-transparent outline-none',
                                'text-[13px] text-[var(--text-primary)]',
                                'border-b border-[var(--accent-primary)]',
                                'py-0'
                              )}
                            />
                          ) : (
                            <span className="truncate flex-1">{conv.title}</span>
                          )}
                        </div>

                        {editingConvId !== conv.id && (hoveredConv === conv.id || conv.id === activeConversationId) && (
                          <div className={cn(
                            'absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5',
                            'before:content-[\'\'] before:w-8 before:h-full before:absolute before:-left-8',
                            conv.id === activeConversationId
                              ? 'before:bg-gradient-to-r before:from-transparent before:to-[var(--bg-sidebar-active)]'
                              : 'before:bg-gradient-to-r before:from-transparent before:to-[var(--bg-sidebar-hover)]'
                          )}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                pinConversation(conv.id)
                              }}
                              className={cn(
                                'p-1 rounded-md transition-colors',
                                conv.pinned
                                  ? 'text-[var(--accent-primary)]'
                                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                              )}
                              title={conv.pinned ? 'Bỏ ghim' : 'Ghim'}
                            >
                              {conv.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                startRename(conv.id, conv.title)
                              }}
                              className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                              title="Đổi tên"
                            >
                              <SquarePen size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget({ type: 'conversation', id: conv.id, name: conv.title })
                              }}
                              className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--status-error-text)] transition-colors"
                              title="Xóa"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>


          {/* Mode toggle */}
          <div className="px-3 pb-2">
            <Toggle mode={mode} onChange={setMode} />
          </div>

          {/* Bottom — Settings */}
          <div className="p-2 border-t border-[var(--border-primary)]">
            <button
              onClick={toggleSettings}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg',
                'text-[13px] text-[var(--text-secondary)]',
                'hover:bg-[var(--bg-sidebar-hover)]',
                'transition-all duration-100'
              )}
            >
              <Settings size={16} className="shrink-0" />
              <span>Cài đặt</span>
            </button>
          </div>
        </>
      )}
    </aside>

    {/* Delete confirm dialog */}
    <ConfirmDialog
      open={deleteTarget !== null}
      onClose={() => setDeleteTarget(null)}
      onConfirm={handleConfirmDelete}
      title={
        deleteTarget?.type === 'project'
          ? `Xóa dự án "${deleteTarget?.name}"?`
          : `Xóa cuộc trò chuyện "${deleteTarget?.name}"?`
      }
      description={
        deleteTarget?.type === 'project'
          ? 'Toàn bộ brain, dữ liệu và cuộc trò chuyện của dự án sẽ bị xóa vĩnh viễn.'
          : 'Cuộc trò chuyện này sẽ bị xóa vĩnh viễn.'
      }
    />
    </>
  )
}
