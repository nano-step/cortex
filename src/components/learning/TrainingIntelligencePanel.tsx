import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Brain, RefreshCw, Loader2, Zap, BookOpen, Clock,
  CheckCircle2, Circle, ChevronDown, ChevronRight,
  TrendingUp, Target, Activity, Shield, Bot
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { useProjectStore } from '../../stores/projectStore'

interface TrainingIntelligencePanelProps {
  open: boolean
  onClose: () => void
  projectId: string | null
}

type TabKey = 'today' | 'yesterday' | 'month'

interface IntelligenceScore {
  score: number
  breakdown: { pairs: number; weights: number; feedback: number; compression: number }
  rawCounts: { pairs: number; weights: number; feedback: number; compressionPercent: number; chunksTotal: number; autoscanRuns: number; autoscanPairsAccepted: number; autoscanChunksScanned: number; autoscanPairsGenerated: number; autoscanAcceptanceRate: number }
}

interface TimelineRow { day?: string; hour?: string; count: number; autoscan_count: number; positive_count: number }

interface RecentPair {
  id: string
  query: string
  source: string
  label: number
  created_at: number
  file_path: string | null
  language: string | null
  feedback_count?: number
  positive_count?: number
  negative_count?: number
}

interface TopicRow { file_path: string; language: string; pair_count: number }
interface UpcomingRow { file_path: string; language: string; chunk_count: number }
interface RunRow {
  id: string; pipeline: string; status: string; metrics: string;
  duration_ms: number; error: string | null; created_at: number; completed_at: number | null
}

interface AutoScanProgress {
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
  currentActivity: AutoScanActivity | null
  recentActivities: AutoScanActivity[]
  circuitStatus?: { state: 'closed' | 'open' | 'half-open'; dailyCostUsd: number; dailyBudgetUsd: number }
}

interface AutoScanActivity {
  filePath: string
  question: string
  answer: string
  score: number
  status: 'generating' | 'answering' | 'judging' | 'accepted' | 'rejected'
  timestamp: number
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'vừa xong'
  if (min < 60) return `${min} phút trước`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} giờ trước`
  return `${Math.floor(h / 24)} ngày trước`
}

function shortPath(p: string | null, max = 40): string {
  if (!p) return 'unknown'
  if (p.length <= max) return p
  const parts = p.split('/')
  const filename = parts[parts.length - 1]
  return `…/${filename}`
}

function langColor(lang: string | null): string {
  const m: Record<string, string> = {
    typescript: 'bg-blue-500/20 text-blue-400',
    javascript: 'bg-yellow-500/20 text-yellow-400',
    python: 'bg-green-500/20 text-green-400',
    rust: 'bg-orange-500/20 text-orange-400',
    go: 'bg-cyan-500/20 text-cyan-400',
    java: 'bg-red-500/20 text-red-400',
    css: 'bg-pink-500/20 text-pink-400',
    html: 'bg-orange-400/20 text-orange-300',
  }
  return m[(lang ?? '').toLowerCase()] ?? 'bg-[var(--bg-primary)] text-[var(--text-tertiary)]'
}

function sourceColor(source: string): string {
  const m: Record<string, string> = {
    autoscan: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    thumbs_up: 'bg-green-500/20 text-green-400 border border-green-500/30',
    copy: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    thumbs_down: 'bg-red-500/20 text-red-400 border border-red-500/30',
    implicit_positive: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
    implicit_negative: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  }
  return m[source] ?? 'bg-[var(--bg-primary)] text-[var(--text-tertiary)]'
}

function sourceLabel(source: string): string {
  const m: Record<string, string> = {
    autoscan: 'AutoScan',
    thumbs_up: '👍 Thích',
    copy: '📋 Copy',
    thumbs_down: '👎 Không thích',
    implicit_positive: 'Không phản hồi tiêu cực',
    implicit_negative: 'Hỏi lại ngay',
  }
  return m[source] ?? source
}

function circuitColor(state: string): string {
  if (state === 'closed') return 'text-green-400 bg-green-500/10 border border-green-500/30'
  if (state === 'open') return 'text-red-400 bg-red-500/10 border border-red-500/30'
  return 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/30'
}

function circuitLabel(state: string): string {
  if (state === 'closed') return 'Đang hoạt động'
  if (state === 'open') return 'Tạm dừng'
  return 'Thăm dò'
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 40) return '#eab308'
  return '#ef4444'
}

function IntelligenceRing({ score }: { score: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = scoreColor(score)
  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute inset-0 -rotate-90" width="144" height="144" viewBox="0 0 144 144">
        <circle cx="72" cy="72" r={r} fill="none" stroke="var(--border-primary)" strokeWidth="10" />
        <circle
          cx="72" cy="72" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">/100</span>
      </div>
    </div>
  )
}

function BreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[var(--text-tertiary)] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border-primary)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-medium w-6 text-right" style={{ color }}>{value}</span>
    </div>
  )
}

function SkeletonLine({ w = 'full' }: { w?: string }) {
  return <div className={`h-3 bg-[var(--border-primary)] rounded animate-pulse w-${w}`} />
}

const ACTIVITY_STATUS_CONFIG = {
  generating: { label: 'Đang tạo câu hỏi', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400 animate-pulse' },
  answering:  { label: 'Đang trả lời',     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',   dot: 'bg-blue-400 animate-pulse' },
  judging:    { label: 'Đang đánh giá',    color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', dot: 'bg-purple-400 animate-pulse' },
  accepted:   { label: 'Đã lưu',           color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',  dot: 'bg-green-400' },
  rejected:   { label: 'Bị từ chối',       color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',      dot: 'bg-red-400' },
}

function ActivityCard({ activity, isCurrent = false }: { activity: AutoScanActivity; isCurrent?: boolean }) {
  const cfg = ACTIVITY_STATUS_CONFIG[activity.status]
  const file = activity.filePath.split('/').slice(-2).join('/')
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2 text-[11px] space-y-1.5',
      cfg.bg,
      isCurrent && 'ring-1 ring-[var(--accent-primary)]/30'
    )}>
      <div className="flex items-center gap-2">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
        <span className={cn('font-medium', cfg.color)}>{cfg.label}</span>
        <span className="text-[var(--text-tertiary)] font-mono truncate flex-1">{file}</span>
        {(activity.status === 'accepted' || activity.status === 'rejected') && activity.score > 0 && (
          <span className={cn('shrink-0 font-semibold', cfg.color)}>{activity.score.toFixed(1)}/5</span>
        )}
      </div>
      <p className="text-[var(--text-secondary)] line-clamp-2 leading-relaxed">{activity.question}</p>
      {activity.answer && (activity.status === 'accepted' || activity.status === 'rejected') && (
        <p className="text-[var(--text-tertiary)] line-clamp-2 leading-relaxed border-t border-[var(--border-primary)] pt-1.5">{activity.answer}</p>
      )}
    </div>
  )
}


export function TrainingIntelligencePanel({ open, onClose, projectId }: TrainingIntelligencePanelProps) {
  const { projects, setAutoScanEnabled } = useProjectStore()
  const currentProject = projectId ? projects.find(p => p.id === projectId) : null

  const [activeTab, setActiveTab] = useState<TabKey>('today')
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [togglingAutoScan, setTogglingAutoScan] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [intelligence, setIntelligence] = useState<IntelligenceScore | null>(null)
  const [autoscanProgress, setAutoscanProgress] = useState<AutoScanProgress | null>(null)
  const [todayRows, setTodayRows] = useState<TimelineRow[]>([])
  const [yesterdayRows, setYesterdayRows] = useState<TimelineRow[]>([])
  const [monthRows, setMonthRows] = useState<TimelineRow[]>([])
  const [topTopicsMap, setTopTopicsMap] = useState<Record<TabKey, TopicRow[]>>({ today: [], yesterday: [], month: [] })
  const [recentPairs, setRecentPairs] = useState<RecentPair[]>([])
  const [upcomingWork, setUpcomingWork] = useState<UpcomingRow[]>([])
  const [runHistory, setRunHistory] = useState<RunRow[]>([])

  const fetchedTabs = useRef<Set<TabKey>>(new Set())

  const [loadingScore, setLoadingScore] = useState(false)
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [loadingUpcoming, setLoadingUpcoming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const autoScanEnabled = currentProject?.autoScanEnabled ?? false

  const fetchProgress = useCallback(async () => {
    const p = await window.electronAPI?.autoscanGetProgress?.()
    if (p) setAutoscanProgress(p as AutoScanProgress)
  }, [])

  const fetchScore = useCallback(async () => {
    if (!projectId) return
    setLoadingScore(true)
    const s = await window.electronAPI?.getIntelligenceScore?.(projectId)
    if (s) setIntelligence(s as IntelligenceScore)
    setLoadingScore(false)
  }, [projectId])

  const fetchTimelineForTab = useCallback(async (tab: TabKey, force = false) => {
    if (!projectId) return
    if (!force && fetchedTabs.current.has(tab)) return
    setLoadingTimeline(true)

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const monthStart = Date.now() - 30 * 24 * 60 * 60 * 1000

    if (tab === 'today') {
      const [rows, topics] = await Promise.all([
        window.electronAPI?.getTrainingTimeline?.(projectId, 'hour', todayStart).then(r => r ?? []),
        window.electronAPI?.getTopTrainingTopics?.(projectId, todayStart).then(r => r ?? []),
      ])
      setTodayRows(rows as TimelineRow[])
      setTopTopicsMap(prev => ({ ...prev, today: topics as TopicRow[] }))
    } else if (tab === 'yesterday') {
      const [rows, topics] = await Promise.all([
        window.electronAPI?.getTrainingTimeline?.(projectId, 'hour', yesterdayStart).then(r => r ?? []),
        window.electronAPI?.getTopTrainingTopics?.(projectId, yesterdayStart).then(r => r ?? []),
      ])
      setYesterdayRows(rows as TimelineRow[])
      setTopTopicsMap(prev => ({ ...prev, yesterday: topics as TopicRow[] }))
    } else {
      const [rows, topics] = await Promise.all([
        window.electronAPI?.getTrainingTimeline?.(projectId, 'day').then(r => r ?? []),
        window.electronAPI?.getTopTrainingTopics?.(projectId, monthStart).then(r => r ?? []),
      ])
      setMonthRows(rows as TimelineRow[])
      setTopTopicsMap(prev => ({ ...prev, month: topics as TopicRow[] }))
    }

    fetchedTabs.current.add(tab)
    setLoadingTimeline(false)
  }, [projectId])

  const fetchRecent = useCallback(async () => {
    if (!projectId) return
    setLoadingRecent(true)
    const pairs = (await window.electronAPI?.getRecentTrainingPairs?.(projectId, 20) ?? []) as RecentPair[]
    setRecentPairs(pairs)
    setLoadingRecent(false)
  }, [projectId])

  const fetchUpcoming = useCallback(async () => {
    if (!projectId) return
    setLoadingUpcoming(true)
    const upcoming = (await window.electronAPI?.getUpcomingTrainingWork?.(projectId) ?? []) as UpcomingRow[]
    setUpcomingWork(upcoming)
    setLoadingUpcoming(false)
  }, [projectId])

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    const history = ((await window.electronAPI?.getTrainingRunHistory?.() ?? []) as unknown) as RunRow[]
    setRunHistory(history)
    setLoadingHistory(false)
  }, [])

  const fetchAll = useCallback(async () => {
    fetchedTabs.current.clear()
    await Promise.all([
      fetchScore(),
      fetchProgress(),
      fetchTimelineForTab('today', true),
      fetchTimelineForTab('yesterday', true),
      fetchTimelineForTab('month', true),
      fetchRecent(),
      fetchUpcoming(),
    ])
  }, [fetchScore, fetchProgress, fetchTimelineForTab, fetchRecent, fetchUpcoming])

  const activeTabRef = useRef<TabKey>('today')

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    if (!open || !projectId) return
    fetchedTabs.current.clear()
    fetchAll()
  }, [open, projectId])

  useEffect(() => {
    if (!open) return
    const id = setInterval(fetchProgress, 2000)
    return () => clearInterval(id)
  }, [open, fetchProgress])

  useEffect(() => {
    if (!open || !projectId) return
    const id = setInterval(fetchScore, 30_000)
    return () => clearInterval(id)
  }, [open, projectId, fetchScore])

  useEffect(() => {
    if (!open) return
    const unsubscribe = window.electronAPI?.onAutoscanActivity?.((activity) => {
      setAutoscanProgress(prev => {
        if (!prev) return prev
        const act = activity as AutoScanActivity | null
        if (!act) return { ...prev, currentActivity: null }
        const updated = [act, ...(prev.recentActivities ?? [])].slice(0, 20)
        return { ...prev, currentActivity: act, recentActivities: updated }
      })
    })
    return () => { unsubscribe?.() }
  }, [open])

  useEffect(() => {
    if (!open || !projectId) return
    fetchTimelineForTab(activeTab)
  }, [activeTab])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }

  const handleAutoScanToggle = async () => {
    if (!projectId || togglingAutoScan) return
    setTogglingAutoScan(true)
    const newEnabled = !autoScanEnabled
    await setAutoScanEnabled(projectId, newEnabled)
    await window.electronAPI?.autoscanSetConfig?.({ enabled: newEnabled })
    if (newEnabled) await window.electronAPI?.autoscanTrigger?.(projectId)
    await fetchProgress()
    setTogglingAutoScan(false)
  }

  const handleHistoryToggle = async () => {
    const next = !historyCollapsed
    setHistoryCollapsed(next)
    if (!next && runHistory.length === 0) await fetchHistory()
  }

  if (!open) return null


  const chartRows: TimelineRow[] =
    activeTab === 'today' ? todayRows :
    activeTab === 'yesterday' ? yesterdayRows :
    monthRows.slice(0, 30)
  const topTopics = topTopicsMap[activeTab]
  const tabTotal = chartRows.reduce((s: number, r: TimelineRow) => s + r.count, 0)
  const tabAutoscan = chartRows.reduce((s: number, r: TimelineRow) => s + r.autoscan_count, 0)
  const tabPositive = chartRows.reduce((s: number, r: TimelineRow) => s + r.positive_count, 0)
  const barMax = Math.max(...chartRows.map((r: TimelineRow) => r.count), 1)

  const cs = autoscanProgress?.circuitStatus
  const scanIsRunning = autoscanProgress?.isRunning ?? false

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className={cn(
        'relative ml-auto w-[700px] h-full bg-[var(--bg-primary)]',
        'border-l border-[var(--border-primary)]',
        'flex flex-col overflow-hidden',
        'animate-in slide-in-from-right duration-300'
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)] shrink-0">
          <div className="flex items-center gap-2.5">
            <Brain size={20} className="text-[var(--accent-primary)]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)] leading-tight">Trí Tuệ Cortex</h2>
              {currentProject && (
                <p className="text-[11px] text-[var(--text-tertiary)]">{currentProject.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── Intelligence Score ─────────────────────── */}
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4">
            <div className="flex items-center gap-4">
              {loadingScore ? (
                <div className="w-36 h-36 rounded-full border-[10px] border-[var(--border-primary)] flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : (
                <IntelligenceRing score={intelligence?.score ?? 0} />
              )}
              <div className="flex-1 space-y-2.5">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Mức độ thông minh</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                    {intelligence
                      ? `${intelligence.rawCounts.pairs.toLocaleString()} pairs · ${intelligence.rawCounts.autoscanChunksScanned.toLocaleString()} chunks scanned · ${intelligence.rawCounts.autoscanRuns} runs`
                      : 'Đang tính...'}
                  </p>
                </div>
                <BreakdownBar label="Training pairs" value={intelligence?.breakdown.pairs ?? 0} max={40} color="#3b82f6" />
                <BreakdownBar label="Trọng số học" value={intelligence?.breakdown.weights ?? 0} max={30} color="#a855f7" />
                <BreakdownBar label="Phản hồi" value={intelligence?.breakdown.feedback ?? 0} max={20} color="#22c55e" />
                <BreakdownBar label="Nén prompt" value={intelligence?.breakdown.compression ?? 0} max={10} color="#f97316" />
              </div>
            </div>
          </div>

          {/* ── AutoScan Live Status ───────────────────── */}
          <div className={cn(
            'rounded-xl p-4 border transition-colors',
            autoScanEnabled
              ? 'bg-[var(--accent-light)] border-[var(--accent-primary)]/30'
              : 'bg-[var(--bg-secondary)] border-[var(--border-primary)]'
          )}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center relative',
                  autoScanEnabled ? 'bg-[var(--accent-primary)]/20' : 'bg-[var(--bg-primary)]'
                )}>
                  <Bot size={15} className={autoScanEnabled ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]'} />
                  {scanIsRunning && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                  )}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {scanIsRunning ? 'Đang học...' : autoScanEnabled ? 'Tự động học bật' : 'Tự động học tắt'}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {autoscanProgress?.lastRunAt ? `Lần cuối: ${timeAgo(autoscanProgress.lastRunAt)}` : 'Chưa chạy lần nào'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleAutoScanToggle}
                disabled={togglingAutoScan}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  autoScanEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--border-secondary)]'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                  autoScanEnabled ? 'translate-x-5' : 'translate-x-0'
                )} />
              </button>
            </div>

            {scanIsRunning && autoscanProgress && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span>{autoscanProgress.phase === 'chunks' ? '📄 Code chunks' : autoscanProgress.phase === 'crystals' ? '💎 Crystals' : '⏳ Idle'}</span>
                  <span>{autoscanProgress.currentBatch}/{autoscanProgress.totalBatches} batch</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-primary)] rounded-full transition-all duration-500"
                    style={{ width: `${autoscanProgress.totalBatches > 0 ? (autoscanProgress.currentBatch / autoscanProgress.totalBatches) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  {autoscanProgress.pairsAccepted} đã lưu · {autoscanProgress.pairsRejected} từ chối · {autoscanProgress.chunksScanned} chunks
                </p>

                {autoscanProgress.currentActivity && (
                  <ActivityCard activity={autoscanProgress.currentActivity} isCurrent />
                )}

                {(autoscanProgress.recentActivities?.length ?? 0) > 0 && (
                  <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                    {autoscanProgress.recentActivities.map((a, i) => (
                      <ActivityCard key={i} activity={a} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {cs && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-primary)]">
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', circuitColor(cs.state))}>
                  {circuitLabel(cs.state)}
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  Chi phí hôm nay: <span className="font-semibold text-[var(--text-primary)]">${cs.dailyCostUsd.toFixed(3)}</span>
                </span>
              </div>
            )}
          </div>

          {/* ── Timeline Tabs ──────────────────────────── */}
          <div className="bg-[var(--bg-secondary)] rounded-xl overflow-hidden">
            <div className="flex border-b border-[var(--border-primary)]">
              {(['today', 'yesterday', 'month'] as TabKey[]).map(tab => {
                const label = tab === 'today' ? 'Hôm nay' : tab === 'yesterday' ? 'Hôm qua' : 'Tháng này'
                let cnt = 0
                if (tab === 'today') cnt = todayRows.reduce((s: number, r: TimelineRow) => s + r.count, 0)
                else if (tab === 'yesterday') cnt = yesterdayRows.reduce((s: number, r: TimelineRow) => s + r.count, 0)
                else cnt = monthRows.reduce((s: number, r: TimelineRow) => s + r.count, 0)
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'flex-1 py-2.5 text-[12px] font-medium transition-colors',
                      activeTab === tab
                        ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {label}
                    <span className={cn(
                      'ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full',
                      activeTab === tab ? 'bg-[var(--accent-primary)]/20' : 'bg-[var(--border-primary)]'
                    )}>
                      {cnt}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="p-4">
              {loadingTimeline ? (
                <div className="space-y-2">
                  <SkeletonLine w="full" />
                  <SkeletonLine w="3/4" />
                  <SkeletonLine w="1/2" />
                </div>
              ) : tabTotal === 0 && chartRows.length === 0 ? (
                <div className="text-center py-6">
                  <Brain size={24} className="text-[var(--text-tertiary)] mx-auto mb-2 opacity-30" />
                  <p className="text-[12px] text-[var(--text-tertiary)]">Chưa có dữ liệu học trong khoảng này</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-3 text-[11px] text-[var(--text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                      autoscan: {tabAutoscan}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                      tích cực: {tabPositive}
                    </span>
                    <span className="ml-auto font-medium text-[var(--text-secondary)]">tổng: {tabTotal}</span>
                  </div>

                  {chartRows.length > 0 && (
                    <div className="flex items-end gap-px h-20 mb-2 bg-[var(--bg-primary)] rounded-lg p-2">
                      {chartRows.map((row, i) => (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center justify-end group relative h-full"
                          title={`${row.hour !== undefined ? `${row.hour}:00` : row.day}: ${row.count} cặp`}
                        >
                          <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-1 z-10">
                            {row.count}
                          </span>
                          <div
                            className="w-full min-h-[3px] rounded-sm bg-[var(--accent-primary)] group-hover:brightness-125 transition-all"
                            style={{ height: `${Math.max(3, (row.count / barMax) * 64)}px` }}
                          />
                          {chartRows.length <= 24 && (
                            <span className="text-[7px] text-[var(--text-tertiary)] mt-0.5 truncate w-full text-center">
                              {row.hour !== undefined ? `${row.hour}h` : (row.day?.slice(5) ?? '')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {topTopics.length > 0 && (
                    <div>
                      <p className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Top files học được</p>
                      <div className="space-y-1.5">
                        {topTopics.slice(0, 5).map((t, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--text-tertiary)] w-4">{i + 1}</span>
                            <span className="flex-1 text-[11px] text-[var(--text-secondary)] truncate font-mono">{shortPath(t.file_path)}</span>
                            {t.language && (
                              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', langColor(t.language))}>
                                {t.language}
                              </span>
                            )}
                            <span className="text-[11px] font-semibold text-[var(--text-primary)] w-6 text-right">{t.pair_count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Recent Training Pairs ──────────────────── */}
          <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
            <button
              onClick={() => setRecentCollapsed(!recentCollapsed)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-[var(--accent-primary)]" />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">Học gần đây</span>
                {recentPairs.length > 0 && (
                  <span className="text-[10px] bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] px-1.5 py-0.5 rounded-full">
                    {recentPairs.length}
                  </span>
                )}
              </div>
              {recentCollapsed ? <ChevronRight size={14} className="text-[var(--text-tertiary)]" /> : <ChevronDown size={14} className="text-[var(--text-tertiary)]" />}
            </button>

            {!recentCollapsed && (
              <div className="border-t border-[var(--border-primary)]">
                {loadingRecent ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map(i => <SkeletonLine key={i} w="full" />)}
                  </div>
                ) : recentPairs.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-[12px] text-[var(--text-tertiary)]">Chưa có dữ liệu học nào</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border-primary)]">
                    {recentPairs.map(pair => (
                      <div key={pair.id} className="px-4 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors">
                        <div className="flex items-start gap-2">
                          <span className={cn('shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium mt-0.5', sourceColor(pair.source))}>
                            {sourceLabel(pair.source)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[var(--text-primary)] line-clamp-2">
                              {pair.query.length > 100 ? pair.query.slice(0, 100) + '…' : pair.query}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {pair.file_path && (
                                <span className="text-[10px] text-[var(--text-tertiary)] font-mono">{shortPath(pair.file_path, 35)}</span>
                              )}
                              {(pair.feedback_count ?? 0) > 1 && (
                                <span className="text-[10px] text-[var(--accent-primary)] font-medium">
                                  ×{pair.feedback_count}
                                </span>
                              )}
                              {(pair.positive_count ?? 0) > 0 && (pair.negative_count ?? 0) > 0 && (
                                <span className="text-[10px] text-[var(--status-warning-text)]">
                                  {pair.positive_count}↑ {pair.negative_count}↓
                                </span>
                              )}
                              <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{timeAgo(pair.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Upcoming Training Work ─────────────────── */}
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target size={14} className="text-[var(--accent-primary)]" />
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">Sắp được học</span>
            </div>
            {loadingUpcoming ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <SkeletonLine key={i} w="full" />)}
              </div>
            ) : upcomingWork.length === 0 ? (
              <div className="flex items-center gap-2 py-2">
                <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                <p className="text-[12px] text-green-400 font-medium">Đã học tất cả files! Cortex rất thông minh rồi 🎉</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingWork.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Circle size={10} className="text-[var(--text-tertiary)] shrink-0" />
                    <span className="flex-1 text-[11px] text-[var(--text-secondary)] font-mono truncate">{shortPath(item.file_path)}</span>
                    {item.language && (
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0', langColor(item.language))}>
                        {item.language}
                      </span>
                    )}
                    <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">{item.chunk_count} chunk</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Pipeline Run History ───────────────────── */}
          <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
            <button
              onClick={handleHistoryToggle}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[var(--accent-primary)]" />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">Lịch sử huấn luyện</span>
              </div>
              {historyCollapsed ? <ChevronRight size={14} className="text-[var(--text-tertiary)]" /> : <ChevronDown size={14} className="text-[var(--text-tertiary)]" />}
            </button>

            {!historyCollapsed && (
              <div className="border-t border-[var(--border-primary)]">
                {loadingHistory ? (
                  <div className="p-4 flex items-center justify-center">
                    <Loader2 size={16} className="animate-spin text-[var(--text-tertiary)]" />
                  </div>
                ) : runHistory.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-[12px] text-[var(--text-tertiary)]">Chưa có lịch sử</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border-primary)] max-h-64 overflow-y-auto">
                    {runHistory.map(run => {
                      const statusColor = run.status === 'completed'
                        ? 'text-green-400'
                        : run.status === 'failed'
                          ? 'text-red-400'
                          : 'text-blue-400'
                      const pipelineColors: Record<string, string> = {
                        autoscan: 'bg-blue-500/15 text-blue-400',
                        reranker: 'bg-purple-500/15 text-purple-400',
                        prompt: 'bg-orange-500/15 text-orange-400',
                        crystal: 'bg-yellow-500/15 text-yellow-400',
                        memory: 'bg-teal-500/15 text-teal-400',
                        instinct: 'bg-pink-500/15 text-pink-400',
                        agent: 'bg-indigo-500/15 text-indigo-400',
                        embedding: 'bg-cyan-500/15 text-cyan-400',
                      }
                      let metrics: Record<string, number> = {}
                      try { metrics = JSON.parse(run.metrics) } catch {}
                      return (
                        <div key={run.id} className="px-4 py-2.5 flex items-center gap-2 hover:bg-[var(--bg-secondary)] transition-colors">
                          <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium shrink-0', pipelineColors[run.pipeline] ?? 'bg-[var(--bg-primary)] text-[var(--text-tertiary)]')}>
                            {run.pipeline}
                          </span>
                          <span className={cn('text-[11px] font-medium shrink-0', statusColor)}>
                            {run.status === 'completed' ? '✓' : run.status === 'failed' ? '✗' : '⟳'}
                          </span>
                          <span className="flex-1 text-[11px] text-[var(--text-tertiary)] truncate">
                            {metrics.pairsAccepted != null ? `${metrics.pairsAccepted}/${metrics.pairsGenerated ?? '?'} accepted` :
                             metrics.chunksScanned != null ? `${metrics.chunksScanned} chunks` :
                             run.error ? run.error.slice(0, 40) : '—'}
                          </span>
                          <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : ''}</span>
                          <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">{timeAgo(run.created_at)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 pb-2">
            {[
              {
                icon: BookOpen,
                label: 'Training pairs',
                value: intelligence?.rawCounts.pairs ?? 0,
                sub: `${intelligence?.rawCounts.autoscanRuns ?? 0} autoscan runs`,
                color: 'text-blue-400'
              },
              {
                icon: Activity,
                label: 'Chunks đã scan',
                value: intelligence?.rawCounts.autoscanChunksScanned ?? 0,
                sub: `/ ${(intelligence?.rawCounts.chunksTotal ?? 0).toLocaleString()} tổng`,
                color: 'text-purple-400'
              },
              {
                icon: TrendingUp,
                label: 'Tỷ lệ accept',
                value: intelligence?.rawCounts.autoscanAcceptanceRate ?? 0,
                sub: `${(intelligence?.rawCounts.autoscanPairsGenerated ?? 0).toLocaleString()} generated`,
                color: 'text-green-400',
                suffix: '%'
              },
            ].map(({ icon: Icon, label, value, sub, color, suffix }) => (
              <div key={label} className="bg-[var(--bg-secondary)] rounded-xl p-3 text-center">
                <Icon size={14} className={cn('mx-auto mb-1.5', color)} />
                <p className="text-[18px] font-bold text-[var(--text-primary)]">{value.toLocaleString()}{suffix ?? ''}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{label}</p>
                {sub && <p className="text-[10px] text-[var(--text-tertiary)]/60 mt-0.5">{sub}</p>}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
