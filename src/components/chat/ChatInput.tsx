import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import {
  SendHorizontal, Paperclip, X, FileText, Image as ImageIcon,
  Bot, Shield, Gauge, Code, Blocks, Sparkles, Wrench, Globe, Palette,
  GitBranch, FlaskConical, Brain, RefreshCw, Activity, PenLine, Lightbulb,
  MessageCircle, Users, Database, Repeat, Zap, XCircle, Play, Square,
  ArrowRightLeft, ArrowUpCircle, CheckCircle, Package, FileJson, GitCompare, Settings, Search
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ChatAttachment } from '../../types'

interface SlashCommand {
  command: string
  label: string
  description: string
  icon: string
  skillName?: string
  agentRole?: string
}

const ICON_MAP: Record<string, typeof Bot> = {
  Bot, Sparkles, Shield, Gauge, Code, Blocks, Wrench, Globe, Palette,
  GitBranch, FlaskConical, Brain, RefreshCw, Activity, PenLine, Lightbulb,
  MessageCircle, Users, Database, Repeat, Zap, XCircle, Play, Square,
  ArrowRightLeft, ArrowUpCircle, CheckCircle, Package, FileJson, GitCompare, Settings, Search,
}

const FALLBACK_COMMANDS: SlashCommand[] = [
  { command: '/review', label: 'Code Review', description: 'Deep PR review với 4 perspectives (security, quality, performance, testing)', icon: 'Sparkles' },
  { command: '/pr-code-reviewer', label: 'PR Code Reviewer', description: 'Deep PR review — hỗ trợ GitHub PR URL', icon: 'Sparkles' },
  { command: '/security', label: 'Security Audit', description: 'Phân tích bảo mật và phát hiện lỗ hổng', icon: 'Shield' },
  { command: '/performance', label: 'Performance', description: 'Profile hiệu suất và đề xuất tối ưu', icon: 'Gauge' },
  { command: '/implement', label: 'Implement', description: 'Triển khai tính năng hoặc thay đổi code', icon: 'Code' },
  { command: '/architect', label: 'Architecture', description: 'Phân tích và đề xuất kiến trúc hệ thống', icon: 'Blocks' },
  { command: '/refactor', label: 'Refactor', description: 'Intelligent refactoring với LSP, AST-grep, và TDD verification', icon: 'Wrench' },
  { command: '/playwright', label: 'Playwright', description: 'Browser automation — verification, scraping, testing, screenshots', icon: 'Globe' },
  { command: '/frontend-ui-ux', label: 'Frontend UI/UX', description: 'UI/UX design — crafts stunning interfaces', icon: 'Palette' },
  { command: '/git-master', label: 'Git Master', description: 'Git operations — atomic commits, rebase, squash, blame, bisect', icon: 'GitBranch' },
  { command: '/dev-browser', label: 'Dev Browser', description: 'Browser automation với persistent page state', icon: 'Globe' },
  { command: '/test', label: 'Test Generator', description: 'Tạo test cases tự động cho code', icon: 'FlaskConical' },
  { command: '/rri-t-testing', label: 'RRI Testing', description: 'Testing framework và patterns', icon: 'FlaskConical' },
  { command: '/nano-brain-init', label: 'Nano Brain Init', description: 'Initialize nano-brain persistent memory cho workspace', icon: 'Brain' },
  { command: '/nano-brain-reindex', label: 'Nano Brain Reindex', description: 'Rescan codebase và refresh all indexes', icon: 'RefreshCw' },
  { command: '/nano-brain-status', label: 'Nano Brain Status', description: 'Show nano-brain memory health và statistics', icon: 'Activity' },
  { command: '/blog', label: 'Blog Writer', description: 'Draft SEO-optimized blog posts dựa trên project hiện tại', icon: 'PenLine' },
  { command: '/idea', label: 'Idea Analyzer', description: 'Phân tích source code và tạo monetization strategy', icon: 'Lightbulb' },
  { command: '/reddit', label: 'Reddit Post', description: 'Draft Reddit post tối ưu cho subreddit cụ thể', icon: 'MessageCircle' },
  { command: '/team', label: 'Team Proposal', description: 'Phân tích feature/idea, tạo proposal với architecture và plan', icon: 'Users' },
  { command: '/init-deep', label: 'Init Deep', description: 'Initialize hierarchical knowledge base', icon: 'Database' },
  { command: '/ralph-loop', label: 'Ralph Loop', description: 'Start self-referential development loop until completion', icon: 'Repeat' },
  { command: '/ulw-loop', label: 'Ultrawork Loop', description: 'Start ultrawork loop — continues until completion', icon: 'Zap' },
  { command: '/cancel-ralph', label: 'Cancel Ralph', description: 'Cancel active development loop', icon: 'XCircle' },
  { command: '/start-work', label: 'Start Work', description: 'Start work session from plan', icon: 'Play' },
  { command: '/stop-continuation', label: 'Stop Continuation', description: 'Stop all continuation mechanisms', icon: 'Square' },
  { command: '/handoff', label: 'Handoff', description: 'Create context summary for continuing in new session', icon: 'ArrowRightLeft' },
  { command: '/migration', label: 'Migration Planner', description: 'Plan và execute codebase migration', icon: 'ArrowUpCircle' },
  { command: '/code-quality', label: 'Code Quality', description: 'Phân tích chất lượng code toàn diện', icon: 'CheckCircle' },
  { command: '/dependency-audit', label: 'Dependency Audit', description: 'Audit dependencies cho security và updates', icon: 'Package' },
  { command: '/api-contract', label: 'API Contract', description: 'Validate và generate API contracts', icon: 'FileJson' },
  { command: '/diff-review', label: 'Diff Review', description: 'Review git diff với multi-perspective analysis', icon: 'GitCompare' },
  { command: '/rtk-setup', label: 'RTK Setup', description: 'Redux Toolkit setup và enforcement', icon: 'Settings' },
  { command: '/multi-agent', label: 'Multi-Agent', description: 'Phân tích toàn diện với 8 agents chuyên biệt', icon: 'Users' },
  { command: '/perplexity', label: 'Perplexity Deep Search', description: 'Deep research với Perplexity Pro — tìm kiếm web, đọc URL, phân tích', icon: 'Search' },
  { command: '/agents', label: 'Agent Mode', description: 'Chọn agent mode (Sisyphus, Hephaestus, Prometheus, Atlas)', icon: 'Bot' },
]

interface AgentMode {
  id: string
  name: string
  description: string
  icon: string
  systemPrefix: string
}

const AGENT_MODES: AgentMode[] = [
  {
    id: 'sisyphus',
    name: 'Sisyphus',
    description: 'Ultraworker — relentless execution',
    icon: 'Zap',
    systemPrefix: 'You are Sisyphus — the Ultraworker. A relentless, high-output execution agent. You take complex tasks and break them into atomic steps, then execute each step with maximum precision and speed. You never stop until the task is fully complete. '
  },
  {
    id: 'hephaestus',
    name: 'Hephaestus',
    description: 'Deep Agent — research-first problem solving',
    icon: 'Wrench',
    systemPrefix: 'You are Hephaestus — the Deep Agent. A thorough, research-first problem solver. You investigate problems deeply before acting, examining all angles and dependencies. You prefer understanding root causes over quick fixes. '
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    description: 'Strategic Planner — architecture & plans',
    icon: 'Lightbulb',
    systemPrefix: 'You are Prometheus — the Strategic Planner. You analyze features and ideas comprehensively, producing detailed execution plans with architecture decisions, task breakdowns, risk assessments, and dependency graphs. You plan before anyone builds. '
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Heavy Lifter — large-scale operations',
    icon: 'Blocks',
    systemPrefix: 'You are Atlas — the Heavy Lifter. A powerful execution agent for large-scale tasks involving multiple files, systems, or complex refactoring. You handle the heaviest workloads with systematic, methodical precision. '
  },
]

interface ChatInputProps {
  onSend: (message: string, attachments: ChatAttachment[], agentModeId?: string | null) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function AttachmentPreview({ attachment, onRemove }: { attachment: ChatAttachment; onRemove: () => void }) {
  return (
    <div className="relative group/att flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl max-w-[200px]">
      {attachment.isImage && attachment.base64 ? (
        <img
          src={`data:${attachment.mimeType};base64,${attachment.base64}`}
          alt={attachment.name}
          className="w-10 h-10 rounded-lg object-cover shrink-0"
        />
      ) : attachment.mimeType === 'application/pdf' ? (
        <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
          <FileText size={18} className="text-red-500" />
        </div>
      ) : (
        <div className="w-10 h-10 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
          <FileText size={18} className="text-[var(--accent-primary)]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{attachment.name}</p>
        <p className="text-[11px] text-[var(--text-tertiary)]">{formatFileSize(attachment.size)}</p>
      </div>
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-primary)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all opacity-0 group-hover/att:opacity-100"
      >
        <X size={10} />
      </button>
    </div>
  )
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const agentPopupRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)

  const [activeAgentMode, setActiveAgentMode] = useState<AgentMode | null>(AGENT_MODES[0])
  const [showAgentPopup, setShowAgentPopup] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [commands, setCommands] = useState<SlashCommand[]>(FALLBACK_COMMANDS)

  useEffect(() => {
    window.electronAPI?.getSlashCommands?.().then((cmds: SlashCommand[]) => {
      if (cmds && cmds.length > 0) setCommands(cmds)
    }).catch(() => {})
  }, [])

  const filteredCommands = commands.filter((cmd: SlashCommand) =>
    cmd.command.startsWith('/' + slashFilter) || cmd.label.toLowerCase().includes(slashFilter.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false)
      }
    }
    if (showSlashMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSlashMenu])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentPopupRef.current && !agentPopupRef.current.contains(e.target as Node)) {
        setShowAgentPopup(false)
      }
    }
    if (showAgentPopup) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAgentPopup])

  const selectAgentMode = useCallback((agent: AgentMode) => {
    setActiveAgentMode(agent)
    setShowAgentPopup(false)
    textareaRef.current?.focus()
  }, [])

  const clearAgentMode = useCallback(() => {
    setActiveAgentMode(null)
  }, [])

  const selectSlashCommand = useCallback((cmd: SlashCommand) => {
    if (cmd.command === '/agents') {
      setShowAgentPopup(true)
      setShowSlashMenu(false)
      setSlashFilter('')
      setValue('')
      return
    }
    setValue(cmd.command + ' ')
    setShowSlashMenu(false)
    setSlashFilter('')
    textareaRef.current?.focus()
  }, [])

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    onSend(trimmed, attachments, activeAgentMode?.id || null)
    setValue('')
    setAttachments([])
    setShowSlashMenu(false)
    setSlashFilter('')
    setShowAgentPopup(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, attachments, disabled, onSend, activeAgentMode])

  const handleValueChange = useCallback((newValue: string) => {
    setValue(newValue)
    const match = newValue.match(/^\/(\S*)$/)
    if (match) {
      setSlashFilter(match[1])
      setShowSlashMenu(true)
    } else if (!newValue.startsWith('/') || newValue.includes(' ')) {
      setShowSlashMenu(false)
      setSlashFilter('')
    }
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectSlashCommand(filteredCommands[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlashMenu(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAttach = useCallback(async () => {
    try {
      const files = await window.electronAPI.openFileDialog()
      if (files && files.length > 0) {
        setAttachments(prev => [...prev, ...files])
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err)
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const paths = files.map(f => (f as File & { path?: string }).path).filter(Boolean) as string[]

    if (paths.length > 0 && window.electronAPI?.openFilesFromPaths) {
      try {
        const loaded = await window.electronAPI.openFilesFromPaths(paths)
        if (loaded && loaded.length > 0) {
          setAttachments(prev => [...prev, ...loaded])
          return
        }
      } catch (err) {
        console.error('Failed to load via paths:', err)
      }
    }

    // Fallback: read files directly via FileReader (when File.path unavailable)
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const isImage = file.type.startsWith('image/')
        const attachment = {
          id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          path: (file as File & { path?: string }).path || file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          isImage,
          base64: isImage ? base64 : undefined,
          textContent: !isImage ? new TextDecoder().decode(new Uint8Array(buffer)) : undefined
        }
        setAttachments(prev => [...prev, attachment])
      } catch (err) {
        console.error('Failed to read dropped file:', file.name, err)
      }
    }
  }, [])

  const canSend = value.trim() || attachments.length > 0

  return (
    <div
      className="px-6 pb-5 pt-2 relative"
      ref={dropZoneRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--accent-primary)]/10 border-2 border-dashed border-[var(--accent-primary)] rounded-2xl backdrop-blur-sm transition-all">
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-primary)] flex items-center justify-center">
              <ImageIcon size={24} className="text-white" />
            </div>
            <span className="text-[14px] font-semibold text-[var(--accent-primary)]">
              Thả file để upload
            </span>
            <span className="text-[12px] text-[var(--text-tertiary)]">
              Hỗ trợ: ảnh, PDF, text, code
            </span>
          </div>
        </div>
      )}
      <div className="max-w-[720px] mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachments.map(att => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {activeAgentMode && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--accent-light)] border border-[var(--accent-primary)]/20 rounded-lg">
              {(() => { const AgentIcon = ICON_MAP[activeAgentMode.icon] || Bot; return <AgentIcon size={12} className="text-[var(--accent-primary)]" /> })()}
              <span className="text-[12px] font-medium text-[var(--accent-primary)]">
                {activeAgentMode.name}
              </span>
              <button
                onClick={clearAgentMode}
                className="ml-0.5 p-0.5 rounded hover:bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]/60 hover:text-[var(--accent-primary)] transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {activeAgentMode.description}
            </span>
          </div>
        )}

        <div className="relative">
          {showAgentPopup && (
            <div
              ref={agentPopupRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg z-50"
            >
              <div className="p-1">
                <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                  Agent Mode
                </div>
                {AGENT_MODES.map((agent) => {
                  const AgentIcon = ICON_MAP[agent.icon] || Bot
                  const isActive = activeAgentMode?.id === agent.id
                  return (
                    <button
                      key={agent.id}
                      onClick={() => selectAgentMode(agent)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                        isActive
                          ? 'bg-[var(--accent-light)]'
                          : 'hover:bg-[var(--bg-sidebar-hover)]'
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                        isActive
                          ? 'bg-[var(--accent-primary)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)]'
                      )}>
                        <AgentIcon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                          {agent.name}
                        </span>
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {agent.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {showSlashMenu && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg z-50 max-h-[240px] overflow-y-auto"
            >
              <div className="p-1">
                <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                  Lệnh
                </div>
                {filteredCommands.map((cmd, idx) => {
                  const Icon = ICON_MAP[cmd.icon] || Bot
                  return (
                    <button
                      key={cmd.command}
                      onClick={() => selectSlashCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all',
                        idx === selectedIndex
                          ? 'bg-[var(--accent-light)]'
                          : 'hover:bg-[var(--bg-sidebar-hover)]'
                      )}
                    >
                      <div className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                        idx === selectedIndex
                          ? 'bg-[var(--accent-primary)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)]'
                      )}>
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-mono font-semibold text-[var(--text-primary)]">
                            {cmd.command}
                          </span>
                          <span className="text-[12px] text-[var(--text-secondary)]">
                            {cmd.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                          {cmd.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        <div
          className={cn(
            'flex items-end gap-2 px-4 py-3',
            'bg-[var(--bg-input)] rounded-2xl',
            'border border-[var(--border-input)]',
            'shadow-sm',
            'focus-within:border-[var(--border-focus)]',
            'focus-within:shadow-md',
            'transition-all duration-200'
          )}
        >
          <button
            onClick={handleAttach}
            disabled={disabled}
            className={cn(
              'p-1 rounded-lg transition-all shrink-0 mb-0.5',
              attachments.length > 0
                ? 'text-[var(--accent-primary)] hover:bg-[var(--accent-light)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
            title="Đính kèm file"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              handleValueChange(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Hỏi về dự án của bạn... (gõ / để xem lệnh)'}
            disabled={disabled}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent',
              'text-[15px] text-[var(--text-primary)] leading-[1.6]',
              'placeholder:text-[var(--text-tertiary)]',
              'focus:outline-none',
              'disabled:opacity-50',
              'max-h-[200px]'
            )}
          />

          {isStreaming ? (
            <button
              onClick={onStop}
              className={cn(
                'p-2 rounded-xl shrink-0 mb-0.5',
                'transition-all duration-100',
                'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-80 active:scale-95'
              )}
              title="Dừng phản hồi"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend || disabled}
              className={cn(
                'p-2 rounded-xl shrink-0 mb-0.5',
                'transition-all duration-100',
                canSend
                  ? 'bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)] active:scale-95'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)]',
                'disabled:opacity-40 disabled:pointer-events-none'
              )}
            >
              <SendHorizontal size={18} />
            </button>
          )}
        </div>
        </div>

        <p className="text-[11px] text-[var(--text-tertiary)] text-center mt-2">
          Cortex có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.
        </p>
      </div>
    </div>
  )
}
