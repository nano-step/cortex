import { useState, useEffect, useRef } from 'react'
import {
  X,
  Brain,
  FileCode,
  MessageSquare,
  Database,
  RefreshCw,
  Download,
  GitGraph,
  GitBranch,
  Loader2,
  Upload,
  Ticket,
  BookOpen,
  Cloud,
  Trash2,
  Plus,
  FolderOpen,
  Github,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Unplug,
  Sparkles,
  TrendingUp,
  Gauge
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { MCPServerList } from './MCPServerList'

interface BrainDashboardProps {
  open: boolean
  onClose: () => void
  projectId: string | null
}

interface DashboardStats {
  totalFiles: number
  totalChunks: number
  totalConversations: number
  repos: Array<{ id: string; source_type: string; source_path: string; status: string; last_indexed_at: number | null }>
  atlassianConnections: Array<{
    id: string
    source_type: 'jira' | 'confluence'
    source_key: string
    source_name: string
    status: string
    last_synced_at: number | null
    total_items: number
  }>
}

export function BrainDashboard({ open, onClose, projectId }: BrainDashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState('')
  const { toggleArchitecture, setLearningOpen: openLearningPanel } = useUIStore()
  const [syncToast, setSyncToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [syncingAtlassian, setSyncingAtlassian] = useState<string | null>(null)

  // Per-repo branch state
  const { loadBranches, switchBranch: switchProjectBranch, getRepoBranch } = useProjectStore()
  const [branchDropdownRepoId, setBranchDropdownRepoId] = useState<string | null>(null)
  const branchDropdownRef = useRef<HTMLDivElement>(null)
  const [branchSearch, setBranchSearch] = useState('')
  const [branchesLoading, setBranchesLoading] = useState<string | null>(null)

  // Add repo form
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [addRepoType, setAddRepoType] = useState<'local' | 'github' | 'jira' | 'confluence' | null>(null)
  const [addRepoUrl, setAddRepoUrl] = useState('')
  const [addRepoToken, setAddRepoToken] = useState('')
  const [addRepoLoading, setAddRepoLoading] = useState(false)
  const [addRepoError, setAddRepoError] = useState('')
  const [addRepoSuccess, setAddRepoSuccess] = useState('')

  // Jira/Confluence picker data
  const [jiraProjects, setJiraProjects] = useState<Array<{ key: string; name: string }>>([]) 
  const [confluenceSpaces, setConfluenceSpaces] = useState<Array<{ id: string; key: string; name: string }>>([]) 
  const [selectedJiraKey, setSelectedJiraKey] = useState('')
  const [selectedConfluenceSpace, setSelectedConfluenceSpace] = useState('')

  const [learningStats, setLearningStats] = useState<{
    totalFeedback: number; totalTrainingPairs: number; totalLearnedWeights: number
    positiveRatio: number; lastTrainedAt: number | null
    compressionSavings: { tokensOriginal: number; tokensCompressed: number; savingsPercent: number }
  } | null>(null)
  const [training, setTraining] = useState(false)
  const [trainResult, setTrainResult] = useState<{ trained: number; weights: number; optimized: boolean } | null>(null)
  const [learningOpen, setLearningOpen] = useState(true)
  const [mcpOpen, setMcpOpen] = useState(false)

  const [atlassianOpen, setAtlassianOpen] = useState(false)
  const [atlSiteUrl, setAtlSiteUrl] = useState('')
  const [atlEmail, setAtlEmail] = useState('')
  const [atlApiToken, setAtlApiToken] = useState('')
  const [atlShowToken, setAtlShowToken] = useState(false)
  const [atlStatus, setAtlStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle')
  const [atlError, setAtlError] = useState('')
  const [atlSaving, setAtlSaving] = useState(false)

  useEffect(() => {
    if (!open || !projectId) return
    loadStats()
    // Load per-project Atlassian config
    window.electronAPI.getProjectAtlassianConfig(projectId).then(config => {
      if (config) {
        setAtlSiteUrl(config.siteUrl)
        setAtlEmail(config.email)
        if (config.hasToken) {
          setAtlApiToken('••••••••')
          setAtlStatus('connected')
        }
      } else {
        setAtlSiteUrl('')
        setAtlEmail('')
        setAtlApiToken('')
        setAtlStatus('idle')
      }
    }).catch(() => {})
  }, [open, projectId])

  // Load branches for all git repos (both github and local) when stats loads
  useEffect(() => {
    if (!stats?.repos) return
    stats.repos.forEach((repo) => {
      if (repo.source_type === 'github' || repo.source_type === 'local') {
        loadBranches(repo.id)
      }
    })
  }, [stats?.repos, loadBranches])

  // Close branch dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownRepoId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadStats = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projectStats, repos, conversations, atlassianConns, lStats] = await Promise.all([
        window.electronAPI.getProjectStats(projectId),
        window.electronAPI.getReposByProject(projectId),
        window.electronAPI.getConversationsByProject(projectId),
        window.electronAPI.getAtlassianConnections(projectId).catch(() => []),
        window.electronAPI.getLearningStats(projectId).catch(() => null)
      ])
      setStats({
        totalFiles: projectStats?.totalFiles || 0,
        totalChunks: projectStats?.totalChunks || 0,
        totalConversations: conversations?.length || 0,
        repos: repos || [],
        atlassianConnections: atlassianConns || []
      })
      setLearningStats(lStats)
    } catch (err) {
      console.error('Failed to load dashboard stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    if (!projectId || !stats?.repos.length) return
    setSyncing(true)
    setSyncToast(null)
    try {
      for (const repo of stats.repos) {
        await window.electronAPI.syncRepo(projectId, repo.id)
      }
      await loadStats()
      setSyncToast({ type: 'success', message: 'Sync hoàn tất — đã cập nhật dữ liệu' })
      setTimeout(() => setSyncToast(null), 4000)
    } catch (err) {
      console.error('Sync failed:', err)
      setSyncToast({ type: 'error', message: 'Sync thất bại' })
      setTimeout(() => setSyncToast(null), 6000)
    } finally {
      setSyncing(false)
    }
  }

  const handleExport = async () => {
    if (!projectId) return
    setExporting(true)
    setExportResult('')
    try {
      const result = await window.electronAPI.exportBrain(projectId)
      if (result) {
        setExportResult(`Đã export ${result.chunks} chunks, ${result.conversations} cuộc trò chuyện`)
      } else {
        setExportResult('Export đã bị hủy')
      }
    } catch {
      setExportResult('Lỗi export')
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    try {
      const result = await window.electronAPI.importBrain()
      if (result) {
        setExportResult(`Đã import ${result.chunks} chunks thành công`)
      } else {
        setExportResult('Import đã bị hủy')
      }
    } catch {
      setExportResult('Lỗi import')
    }
  }

  const handleArchitecture = () => {
    onClose()
    toggleArchitecture()
  }

  const handleTrain = async () => {
    if (!projectId) return
    setTraining(true)
    setTrainResult(null)
    try {
      const result = await window.electronAPI.triggerLearning(projectId)
      setTrainResult(result)
      const newStats = await window.electronAPI.getLearningStats(projectId)
      setLearningStats(newStats)
      // Auto-dismiss after 5s
      setTimeout(() => setTrainResult(null), 5000)
    } catch (err) {
      console.error('Training failed:', err)
      setTrainResult({ trained: 0, weights: 0, optimized: false })
      setTimeout(() => setTrainResult(null), 5000)
    } finally {
      setTraining(false)
    }
  }

  const handleExportTraining = async () => {
    if (!projectId) return
    try {
      const result = await window.electronAPI.exportTrainingData(projectId)
      if (result) {
        setExportResult(`Đã export ${result.pairs} training pairs`)
      }
    } catch {
      setExportResult('Lỗi export training data')
    }
  }

  const handleSyncAtlassian = async (connectionId: string) => {
    if (!projectId) return
    setSyncingAtlassian(connectionId)
    try {
      await window.electronAPI.syncAtlassianConnection(projectId, connectionId)
      await loadStats()
    } catch {
      // handled silently
    } finally {
      setSyncingAtlassian(null)
    }
  }

  const handleDeleteAtlassian = async (connectionId: string) => {
    try {
      await window.electronAPI.deleteAtlassianConnection(connectionId)
      await loadStats()
    } catch {
      // handled silently
    }
  }

  const handleDeleteRepo = async (repoId: string) => {
    if (!window.confirm('Bạn có chắc muốn xóa repository này? Tất cả dữ liệu đã index sẽ bị mất.')) return
    try {
      await window.electronAPI.deleteRepo(repoId)
      await loadStats()
    } catch {
      // handled silently
    }
  }

  const handleReplaceRepo = async (repoId: string) => {
    if (!window.confirm('Bạn có chắc muốn thay thế repository này?')) return
    try {
      await window.electronAPI.deleteRepo(repoId)
      await loadStats()
      resetAddRepo()
      setAddRepoOpen(true)
    } catch {
      // handled silently
    }
  }

  const resetAddRepo = () => {
    setAddRepoType(null)
    setAddRepoUrl('')
    setAddRepoToken('')
    setAddRepoError('')
    setAddRepoSuccess('')
    setAddRepoLoading(false)
    setJiraProjects([])
    setConfluenceSpaces([])
    setSelectedJiraKey('')
    setSelectedConfluenceSpace('')
  }

  const handleAddLocal = async () => {
    try {
      const folderPath = await window.electronAPI.openFolderDialog()
      if (folderPath && projectId) {
        setAddRepoLoading(true)
        setAddRepoError('')
        await window.electronAPI.importLocalRepo(projectId, folderPath)
        setAddRepoSuccess(`Đã import: ${folderPath.split('/').pop()}`)
        await loadStats()
        setTimeout(() => { resetAddRepo(); setAddRepoOpen(false) }, 1500)
      }
    } catch (err) {
      setAddRepoError(err instanceof Error ? err.message : 'Import thất bại')
    } finally {
      setAddRepoLoading(false)
    }
  }

  const handleAddGithub = async () => {
    if (!projectId || !addRepoUrl.trim()) return
    setAddRepoLoading(true)
    setAddRepoError('')
    try {
      const result = await window.electronAPI.importGithubRepo(
        projectId, addRepoUrl.trim(), addRepoToken || undefined
      )
      if (result.success) {
        setAddRepoSuccess(`Đã import: ${addRepoUrl.split('/').pop()}`)
        await loadStats()
        setTimeout(() => { resetAddRepo(); setAddRepoOpen(false) }, 1500)
      } else if (result.needsToken) {
        setAddRepoError('Repository private — cần GitHub token')
      } else {
        setAddRepoError(result.error || 'Import thất bại')
      }
    } catch (err) {
      setAddRepoError(err instanceof Error ? err.message : 'Import thất bại')
    } finally {
      setAddRepoLoading(false)
    }
  }

  const handleLoadJiraProjects = async () => {
    if (!projectId) return
    setAddRepoType('jira')
    setAddRepoError('')
    try {
      const projects = await window.electronAPI.getJiraProjects(projectId)
      setJiraProjects(projects)
      if (projects.length === 0) setAddRepoError('Không tìm thấy Jira project. Cấu hình Atlassian trong Brain Dashboard.')
    } catch {
      setAddRepoError('Không thể kết nối Jira. Cấu hình Atlassian trong Brain Dashboard.')
    }
  }

  const handleLoadConfluenceSpaces = async () => {
    if (!projectId) return
    setAddRepoType('confluence')
    setAddRepoError('')
    try {
      const spaces = await window.electronAPI.getConfluenceSpaces(projectId)
      setConfluenceSpaces(spaces)
      if (spaces.length === 0) setAddRepoError('Không tìm thấy Confluence space. Cấu hình Atlassian trong Brain Dashboard.')
    } catch {
      setAddRepoError('Không thể kết nối Confluence. Cấu hình Atlassian trong Brain Dashboard.')
    }
  }

  const handleAddJira = async () => {
    if (!projectId || !selectedJiraKey) return
    setAddRepoLoading(true)
    setAddRepoError('')
    try {
      const result = await window.electronAPI.importJiraProject(projectId, selectedJiraKey)
      if (result.success) {
        setAddRepoSuccess(`Đã kết nối Jira: ${selectedJiraKey}`)
        await loadStats()
        setTimeout(() => { resetAddRepo(); setAddRepoOpen(false) }, 1500)
      } else {
        setAddRepoError(result.error || 'Import thất bại')
      }
    } catch (err) {
      setAddRepoError(err instanceof Error ? err.message : 'Import thất bại')
    } finally {
      setAddRepoLoading(false)
    }
  }

  const handleAddConfluence = async () => {
    if (!projectId || !selectedConfluenceSpace) return
    const space = confluenceSpaces.find(s => s.id === selectedConfluenceSpace)
    if (!space) return
    setAddRepoLoading(true)
    setAddRepoError('')
    try {
      const result = await window.electronAPI.importConfluenceSpace(projectId, space.id, space.key)
      if (result.success) {
        setAddRepoSuccess(`Đã kết nối Confluence: ${space.name}`)
        await loadStats()
        setTimeout(() => { resetAddRepo(); setAddRepoOpen(false) }, 1500)
      } else {
        setAddRepoError(result.error || 'Import thất bại')
      }
    } catch (err) {
      setAddRepoError(err instanceof Error ? err.message : 'Import thất bại')
    } finally {
      setAddRepoLoading(false)
    }
  }

  if (!open) return null

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Chưa sync'
    const date = new Date(timestamp)
    return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[400px] z-50',
        'bg-[var(--bg-primary)] border-l border-[var(--border-primary)]',
        'shadow-2xl flex flex-col',
        'animate-in slide-in-from-right duration-200'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-[var(--accent-primary)]" />
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Brain Dashboard</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {syncToast && (
          <div className={cn(
            'mx-6 mt-3 px-3 py-2 rounded-lg text-[12px] animate-in fade-in slide-in-from-top duration-200',
            syncToast.type === 'success'
              ? 'bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[var(--status-success-text)]'
              : 'bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--status-error-text)]'
          )}>
            {syncToast.message}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {!projectId ? (
            <p className="text-[14px] text-[var(--text-tertiary)] text-center py-12">
              Chọn một dự án để xem thống kê
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : stats ? (
            <>
              {/* Stats Grid */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Database size={16} className="text-[var(--accent-primary)]" />
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                    Thống kê
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={FileCode} label="Files" value={stats.totalFiles} />
                  <StatCard icon={Database} label="Chunks" value={stats.totalChunks} />
                  <StatCard icon={MessageSquare} label="Cuộc trò chuyện" value={stats.totalConversations} />
                  <StatCard icon={GitGraph} label="Repositories" value={stats.repos.length} />
                  {stats.atlassianConnections.filter(c => c.source_type === 'jira').length > 0 && (
                    <StatCard
                      icon={Ticket}
                      label="Jira Issues"
                      value={stats.atlassianConnections.filter(c => c.source_type === 'jira').reduce((sum, c) => sum + c.total_items, 0)}
                    />
                  )}
                  {stats.atlassianConnections.filter(c => c.source_type === 'confluence').length > 0 && (
                    <StatCard
                      icon={BookOpen}
                      label="Confluence Pages"
                      value={stats.atlassianConnections.filter(c => c.source_type === 'confluence').reduce((sum, c) => sum + c.total_items, 0)}
                    />
                  )}
                </div>
              </section>

              {/* Self-Learning */}
              <section>
                <button
                  onClick={() => setLearningOpen(!learningOpen)}
                  className="flex items-center gap-2 w-full mb-3"
                >
                  {learningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                      Tự học
                    </h3>
                  </div>
                  {learningStats && learningStats.totalFeedback > 0 && (
                    <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                      {learningStats.totalFeedback} feedback
                    </span>
                  )}
                </button>

                {learningOpen && learningStats && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard icon={TrendingUp} label="Feedback" value={learningStats.totalFeedback} />
                      <div className="px-3 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                        <div className="flex items-center gap-2 mb-1">
                          <Gauge size={14} className="text-[var(--text-tertiary)]" />
                          <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">Tỷ lệ tích cực</span>
                        </div>
                        <p className="text-[20px] font-bold text-[var(--text-primary)]">
                          {Math.round(learningStats.positiveRatio * 100)}%
                        </p>
                      </div>
                      <StatCard icon={Database} label="Training Pairs" value={learningStats.totalTrainingPairs} />
                      <StatCard icon={Sparkles} label="Learned Weights" value={learningStats.totalLearnedWeights} />
                    </div>

                    {learningStats.compressionSavings.savingsPercent > 0 && (
                      <div className="px-3 py-2 rounded-lg bg-[var(--status-success-bg)] border border-[var(--status-success-border)]">
                        <span className="text-[12px] text-[var(--status-success-text)] font-medium">
                          Tiết kiệm {learningStats.compressionSavings.savingsPercent}% tokens qua nén ngữ cảnh
                        </span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleTrain}
                        disabled={training}
                      >
                        {training ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Huấn luyện
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleExportTraining}
                      >
                        <Download size={14} />
                        Export dữ liệu
                      </Button>
                    </div>

                    {/* Training result toast */}
                    {trainResult && (
                      <div className={cn(
                        'px-3 py-2.5 rounded-lg text-[12px] animate-in fade-in slide-in-from-top duration-200',
                        trainResult.trained > 0 || trainResult.weights > 0
                          ? 'bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[var(--status-success-text)]'
                          : 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)]'
                      )}>
                        {trainResult.trained > 0 || trainResult.weights > 0 ? (
                          <span>
                            <strong>Huấn luyện xong!</strong> {trainResult.trained} pairs xử lý, {trainResult.weights} trọng số cập nhật
                            {trainResult.optimized && ' — prompt đã tối ưu'}
                          </span>
                        ) : (
                          <span>Chưa có đủ dữ liệu để huấn luyện. Hãy chat với Brain để tạo feedback trước.</span>
                        )}
                      </div>
                    )}

                    {/* Open detailed learning panel */}
                    <button
                      onClick={() => { onClose(); openLearningPanel(true) }}
                      className="text-[12px] text-[var(--accent-primary)] hover:underline"
                    >
                      Xem chi tiết tự học →
                    </button>
                  </div>
                )}

                {learningOpen && !learningStats && (
                  <p className="text-[12px] text-[var(--text-tertiary)] pl-6">
                    Chưa có dữ liệu học. Hãy dùng Brain để tạo feedback.
                  </p>
                )}
              </section>

              {/* Repos */}
              {stats.repos.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <GitGraph size={16} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                      Repositories
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {stats.repos.map((repo) => (
                      <div
                        key={repo.id}
                        className="px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] text-[var(--text-primary)] font-medium truncate max-w-[200px]">
                            {repo.source_path.split('/').pop()}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              'text-[11px] px-2 py-0.5 rounded-full font-medium',
                              repo.status === 'ready' ? 'bg-[var(--status-success-bg)] text-[var(--status-success-text)]' :
                              repo.status === 'indexing' ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]' :
                              'bg-[var(--status-error-bg)] text-[var(--status-error-text)]'
                            )}>
                              {repo.status}
                            </span>
                            <button
                              onClick={() => handleReplaceRepo(repo.id)}
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors"
                              title="Thay thế repository"
                            >
                              <RefreshCw size={12} />
                            </button>
                            <button
                              onClick={() => handleDeleteRepo(repo.id)}
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--status-error-text)] transition-colors"
                              title="Xóa repository"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                          {{ github: 'GitHub', local: 'Local', jira: 'Jira', confluence: 'Confluence' }[repo.source_type] || repo.source_type} · Sync: {formatTime(repo.last_indexed_at)}
                        </p>
                        {repo.source_type === 'github' && (() => {
                          const branchState = getRepoBranch(repo.id)
                          const isLoading = branchesLoading === repo.id
                          const hasBranches = branchState.availableBranches.length > 0
                          const handleBranchClick = async () => {
                            if (branchDropdownRepoId === repo.id) {
                              setBranchDropdownRepoId(null)
                              return
                            }
                            setBranchSearch('')
                            // Always refresh branches on dropdown open
                            setBranchesLoading(repo.id)
                            await loadBranches(repo.id)
                            setBranchesLoading(null)
                            setBranchDropdownRepoId(repo.id)
                          }
                          return (
                            <div className="mt-1.5 relative" ref={branchDropdownRepoId === repo.id ? branchDropdownRef : undefined}>
                              <button
                                onClick={handleBranchClick}
                                className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                              >
                                {isLoading ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <GitBranch size={11} />
                                )}
                                <span className="font-mono max-w-[150px] truncate">{branchState.activeBranch}</span>
                                <ChevronDown size={10} className={cn('transition-transform', branchDropdownRepoId === repo.id && 'rotate-180')} />
                              </button>
                              {branchDropdownRepoId === repo.id && (() => {
                                // Re-read branchState inside dropdown (may have updated after lazy load)
                                const latestState = getRepoBranch(repo.id)
                                const filtered = latestState.availableBranches.filter(b =>
                                  b.toLowerCase().includes(branchSearch.toLowerCase())
                                )
                                return (
                                  <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg z-50">
                                    {/* Mini search */}
                                    <div className="p-1.5 border-b border-[var(--border-primary)]">
                                      <input
                                        type="text"
                                        placeholder="Tìm branch..."
                                        value={branchSearch}
                                        onChange={(e) => setBranchSearch(e.target.value)}
                                        autoFocus
                                        className="w-full px-2 py-1 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] text-[11px] font-mono border border-[var(--border-primary)] focus:outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-tertiary)]"
                                      />
                                    </div>
                                    <div className="p-1 max-h-[200px] overflow-y-auto">
                                      {latestState.availableBranches.length === 0 ? (
                                        <p className="text-[11px] text-[var(--text-tertiary)] text-center py-2">
                                          {isLoading ? 'Đang tải...' : 'Không có branch nào'}
                                        </p>
                                      ) : filtered.length === 0 ? (
                                        <p className="text-[11px] text-[var(--text-tertiary)] text-center py-2">Không tìm thấy</p>
                                      ) : filtered.map((branch) => (
                                        <button
                                          key={branch}
                                          onClick={async () => {
                                            setBranchDropdownRepoId(null)
                                            setBranchSearch('')
                                            if (projectId) {
                                              await switchProjectBranch(projectId, repo.id, branch)
                                              useProjectStore.getState().loadProjects()
                                              await loadStats()
                                            }
                                          }}
                                          className={cn(
                                            'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all',
                                            'text-[11px] font-mono',
                                            branch === latestState.activeBranch
                                              ? 'bg-[var(--accent-light)] text-[var(--accent-primary)]'
                                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-hover)]'
                                          )}
                                        >
                                          <GitBranch size={11} className="shrink-0" />
                                          <span className="truncate">{branch}</span>
                                          {branch === latestState.activeBranch && (
                                            <span className="ml-auto text-[10px] text-[var(--accent-primary)]">●</span>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })()}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Atlassian Connections */}
              {stats.atlassianConnections.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Cloud size={16} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                      Atlassian
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {stats.atlassianConnections.map((conn) => (
                      <div
                        key={conn.id}
                        className="px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {conn.source_type === 'jira' ? (
                              <Ticket size={14} className="text-[var(--status-info-text)]" />
                            ) : (
                              <BookOpen size={14} className="text-[var(--status-info-text)]" />
                            )}
                            <span className="text-[13px] text-[var(--text-primary)] font-medium truncate max-w-[160px]">
                              {conn.source_name || conn.source_key}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              'text-[11px] px-2 py-0.5 rounded-full font-medium',
                              conn.status === 'ready' ? 'bg-[var(--status-success-bg)] text-[var(--status-success-text)]' :
                              conn.status === 'indexing' ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]' :
                              'bg-[var(--status-error-bg)] text-[var(--status-error-text)]'
                            )}>
                              {conn.status}
                            </span>
                            <button
                              onClick={() => handleSyncAtlassian(conn.id)}
                              disabled={syncingAtlassian === conn.id}
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors"
                              title="Sync"
                            >
                              {syncingAtlassian === conn.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RefreshCw size={12} />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeleteAtlassian(conn.id)}
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--status-error-text)] transition-colors"
                              title="Xóa kết nối"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                          {conn.source_type === 'jira' ? 'Jira' : 'Confluence'} · {conn.total_items} items · Sync: {formatTime(conn.last_synced_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Per-project Atlassian Config */}
              <section>
                <button
                  onClick={() => setAtlassianOpen(!atlassianOpen)}
                  className="flex items-center gap-2 w-full mb-3"
                >
                  {atlassianOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className="flex items-center gap-2">
                    <Cloud size={16} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                      Atlassian
                    </h3>
                  </div>
                  {atlStatus === 'connected' && (
                    <span className="ml-auto text-[11px] text-[var(--status-success-text)] flex items-center gap-1">
                      <CheckCircle size={12} /> Đã kết nối
                    </span>
                  )}
                </button>

                {atlassianOpen && (
                  <div className="space-y-3 pl-2">
                    <div>
                      <label className="block text-[12px] text-[var(--text-secondary)] mb-1">Site URL</label>
                      <Input
                        value={atlSiteUrl}
                        onChange={(e) => setAtlSiteUrl(e.target.value)}
                        placeholder="mysite.atlassian.net"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] text-[var(--text-secondary)] mb-1">Email</label>
                      <Input
                        value={atlEmail}
                        onChange={(e) => setAtlEmail(e.target.value)}
                        placeholder="you@company.com"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] text-[var(--text-secondary)] mb-1">API Token</label>
                      <div className="relative">
                        <Input
                          type={atlShowToken ? 'text' : 'password'}
                          value={atlApiToken}
                          onChange={(e) => setAtlApiToken(e.target.value)}
                          placeholder="Nhập API token..."
                          className="pr-10"
                        />
                        <button
                          onClick={() => setAtlShowToken(!atlShowToken)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        >
                          {atlShowToken ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <a
                        href="https://id.atlassian.com/manage-profile/security/api-tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline mt-1"
                      >
                        Lấy API Token <ExternalLink size={10} />
                      </a>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={atlSaving || !atlSiteUrl || !atlEmail || !atlApiToken || atlApiToken === '••••••••'}
                        onClick={async () => {
                          if (!projectId) return
                          setAtlSaving(true)
                          setAtlError('')
                          try {
                            await window.electronAPI.setProjectAtlassianConfig(projectId, atlSiteUrl, atlEmail, atlApiToken)
                            const result = await window.electronAPI.testProjectAtlassianConnection(projectId)
                            if (result.success) {
                              setAtlStatus('connected')
                              setAtlApiToken('••••••••')
                            } else {
                              setAtlStatus('error')
                              setAtlError(result.error || 'Kết nối thất bại')
                            }
                          } catch (err) {
                            setAtlStatus('error')
                            const msg = err instanceof Error ? err.message : 'Lỗi kết nối'
                            setAtlError(msg.includes('No handler registered') ? 'Backend chưa sẵn sàng, thử lại sau vài giây' : msg)
                          } finally {
                            setAtlSaving(false)
                          }
                        }}
                      >
                        {atlSaving ? (
                          <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
                        ) : (
                          <>Lưu & Kiểm tra</>
                        )}
                      </Button>

                      {atlStatus === 'connected' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            if (!projectId) return
                            await window.electronAPI.clearProjectAtlassianConfig(projectId)
                            setAtlSiteUrl('')
                            setAtlEmail('')
                            setAtlApiToken('')
                            setAtlStatus('idle')
                            setAtlError('')
                          }}
                        >
                          <Unplug size={14} /> Ngắt kết nối
                        </Button>
                      )}
                    </div>

                    {atlStatus === 'connected' && (
                      <span className="flex items-center gap-1 text-[12px] text-[var(--status-success-text)]">
                        <CheckCircle size={14} /> Kết nối thành công
                      </span>
                    )}
                    {atlStatus === 'error' && (
                      <span className="flex items-center gap-1 text-[12px] text-[var(--status-error-text)]">
                        <AlertCircle size={14} /> {atlError}
                      </span>
                    )}
                  </div>
                )}
              </section>

              {/* Add Repository */}
              <section>
                <button
                  onClick={() => { setAddRepoOpen(!addRepoOpen); if (addRepoOpen) resetAddRepo() }}
                  className="flex items-center gap-2 w-full mb-3"
                >
                  {addRepoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className="flex items-center gap-2">
                    <Plus size={16} className="text-[var(--accent-primary)]" />
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                      Thêm Repository
                    </h3>
                  </div>
                </button>

                {addRepoOpen && (
                  <div className="space-y-3 pl-2">
                    {/* Source type picker */}
                    {!addRepoType && !addRepoSuccess && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleAddLocal}
                          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] transition-all"
                        >
                          <FolderOpen size={18} className="text-[var(--text-secondary)]" />
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">Từ máy tính</span>
                        </button>
                        <button
                          onClick={() => setAddRepoType('github')}
                          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] transition-all"
                        >
                          <Github size={18} className="text-[var(--text-secondary)]" />
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">GitHub</span>
                        </button>
                        <button
                          onClick={handleLoadJiraProjects}
                          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] transition-all"
                        >
                          <Ticket size={18} className="text-[var(--text-secondary)]" />
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">Jira</span>
                        </button>
                        <button
                          onClick={handleLoadConfluenceSpaces}
                          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] transition-all"
                        >
                          <BookOpen size={18} className="text-[var(--text-secondary)]" />
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">Confluence</span>
                        </button>
                      </div>
                    )}

                    {/* GitHub form */}
                    {addRepoType === 'github' && !addRepoSuccess && (
                      <div className="space-y-3">
                        <Input
                          placeholder="https://github.com/user/repo"
                          value={addRepoUrl}
                          onChange={(e) => setAddRepoUrl(e.target.value)}
                          autoFocus
                        />
                        <Input
                          placeholder="GitHub Token (cho private repo)"
                          type="password"
                          value={addRepoToken}
                          onChange={(e) => setAddRepoToken(e.target.value)}
                        />
                        <a
                          href="https://github.com/settings/tokens/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline"
                        >
                          Tạo token tại đây <ExternalLink size={10} />
                        </a>
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => { resetAddRepo() }}>
                            Hủy
                          </Button>
                          <Button size="sm" onClick={handleAddGithub} disabled={addRepoLoading || !addRepoUrl.trim()}>
                            {addRepoLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Import
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Jira project picker */}
                    {addRepoType === 'jira' && !addRepoSuccess && jiraProjects.length > 0 && (
                      <div className="space-y-3">
                        <select
                          value={selectedJiraKey}
                          onChange={(e) => setSelectedJiraKey(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-input)] text-[14px] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--accent-light)]"
                        >
                          <option value="">Chọn Jira Project...</option>
                          {jiraProjects.map(p => (
                            <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => { resetAddRepo() }}>
                            Hủy
                          </Button>
                          <Button size="sm" onClick={handleAddJira} disabled={addRepoLoading || !selectedJiraKey}>
                            {addRepoLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Import
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Confluence space picker */}
                    {addRepoType === 'confluence' && !addRepoSuccess && confluenceSpaces.length > 0 && (
                      <div className="space-y-3">
                        <select
                          value={selectedConfluenceSpace}
                          onChange={(e) => setSelectedConfluenceSpace(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-input)] text-[14px] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--accent-light)]"
                        >
                          <option value="">Chọn Confluence Space...</option>
                          {confluenceSpaces.map(s => (
                            <option key={s.id} value={s.id}>{s.key} — {s.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => { resetAddRepo() }}>
                            Hủy
                          </Button>
                          <Button size="sm" onClick={handleAddConfluence} disabled={addRepoLoading || !selectedConfluenceSpace}>
                            {addRepoLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Import
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Status messages */}
                    {addRepoError && (
                      <p className="text-[12px] text-[var(--status-error-text)]">{addRepoError}</p>
                    )}
                    {addRepoSuccess && (
                      <p className="text-[12px] text-[var(--status-success-text)]">{addRepoSuccess}</p>
                    )}
                    {addRepoLoading && !addRepoType && (
                      <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
                        <Loader2 size={14} className="animate-spin" /> Đang import...
                      </div>
                    )}
                  </div>
                )}
              </section>

              <MCPServerList expanded={mcpOpen} onToggle={() => setMcpOpen(!mcpOpen)} />

              {/* Quick Actions */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw size={16} className="text-[var(--accent-primary)]" />
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                    Hành động
                  </h3>
                </div>
                <div className="space-y-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Sync Brain
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start"
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Export Brain
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start"
                    onClick={handleImport}
                  >
                    <Upload size={14} />
                    Import Brain
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start"
                    onClick={handleArchitecture}
                  >
                    <GitGraph size={14} />
                    Phân tích kiến trúc
                  </Button>
                </div>
                {exportResult && (
                  <p className="text-[12px] text-[var(--text-secondary)] mt-2">{exportResult}</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof FileCode; label: string; value: number }) {
  return (
    <div className="px-3 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--text-tertiary)]" />
        <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-[var(--text-primary)]">
        {value.toLocaleString('vi-VN')}
      </p>
    </div>
  )
}
