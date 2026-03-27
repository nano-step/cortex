import { useState, useEffect } from 'react'
import {
  X, GraduationCap, RefreshCw, Loader2, CheckCircle,
  TrendingUp, Zap, BarChart3, Play, Bot
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { useLearningStore } from '../../stores/learningStore'
import { useProjectStore } from '../../stores/projectStore'

interface LearningDashboardProps {
  open: boolean
  onClose: () => void
  projectId: string | null
}

export function LearningDashboard({ open, onClose, projectId }: LearningDashboardProps) {
  const { stats, training, loading, loadStats, triggerTraining } = useLearningStore()
  const { projects, setAutoScanEnabled } = useProjectStore()
  const [refreshing, setRefreshing] = useState(false)
  const [trainResult, setTrainResult] = useState<{ trained: number; weights: number; optimized?: boolean } | null>(null)
  const [togglingAutoScan, setTogglingAutoScan] = useState(false)

  const currentProject = projectId ? projects.find(p => p.id === projectId) : null
  const autoScanEnabled = currentProject?.autoScanEnabled ?? false

  useEffect(() => {
    if (!open || !projectId) return
    loadStats(projectId)
  }, [open, projectId, loadStats])

  const handleAutoScanToggle = async () => {
    if (!projectId || togglingAutoScan) return
    setTogglingAutoScan(true)
    const newEnabled = !autoScanEnabled
    await setAutoScanEnabled(projectId, newEnabled)
    await window.electronAPI?.autoscanSetConfig?.({ enabled: newEnabled })
    if (newEnabled) {
      await window.electronAPI?.autoscanTrigger?.(projectId)
    }
    setTogglingAutoScan(false)
  }

  const handleRefresh = async () => {
    if (!projectId) return
    setRefreshing(true)
    await loadStats(projectId)
    setRefreshing(false)
  }

  const handleTrain = async () => {
    if (!projectId) return
    setTrainResult(null)
    const result = await triggerTraining(projectId)
    // triggerTraining returns boolean, but we need to read the actual response
    // Re-fetch stats to show updated numbers
    await loadStats(projectId)
    // Show result toast based on refreshed stats
    const latestStats = useLearningStore.getState().stats
    if (latestStats) {
      setTrainResult({
        trained: latestStats.totalTrainingPairs,
        weights: latestStats.totalLearnedWeights,
        optimized: false
      })
    } else {
      setTrainResult({ trained: 0, weights: 0 })
    }
    setTimeout(() => setTrainResult(null), 5000)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className={cn(
        'relative ml-auto w-[560px] h-full bg-[var(--bg-primary)]',
        'border-l border-[var(--border-primary)]',
        'flex flex-col overflow-hidden',
        'animate-in slide-in-from-right duration-300'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2.5">
            <GraduationCap size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Tự học</h2>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {currentProject && (
            <div className={cn(
              'flex items-center justify-between p-4 rounded-xl border transition-colors',
              autoScanEnabled
                ? 'bg-[var(--accent-light)] border-[var(--accent-primary)]/30'
                : 'bg-[var(--bg-secondary)] border-[var(--border-primary)]'
            )}>
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  autoScanEnabled ? 'bg-[var(--accent-primary)]/20' : 'bg-[var(--bg-primary)]'
                )}>
                  <Bot size={16} className={autoScanEnabled ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]'} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Tự động học</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {autoScanEnabled ? 'AutoScan & AutoTraining đang chạy' : 'Tạm dừng — không scan dự án này'}
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
                aria-label={autoScanEnabled ? 'Tắt AutoScan' : 'Bật AutoScan'}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm',
                  'transition-transform duration-200',
                  autoScanEnabled ? 'translate-x-5' : 'translate-x-0'
                )} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : !stats ? (
            <div className="text-center py-12">
              <GraduationCap size={32} className="text-[var(--text-tertiary)] mx-auto mb-3 opacity-40" />
              <p className="text-[13px] text-[var(--text-tertiary)]">Chưa có dữ liệu học</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1">Sử dụng Cortex để bắt đầu thu thập phản hồi</p>
            </div>
          ) : (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--bg-secondary)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 size={14} className="text-[var(--accent-primary)]" />
                    <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">Phản hồi</span>
                  </div>
                  <p className="text-[22px] font-bold text-[var(--text-primary)]">{stats.totalFeedback}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                    {(stats.positiveRatio * 100).toFixed(0)}% tích cực
                  </p>
                </div>

                <div className="bg-[var(--bg-secondary)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={14} className="text-[var(--accent-primary)]" />
                    <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">Dữ liệu huấn luyện</span>
                  </div>
                  <p className="text-[22px] font-bold text-[var(--text-primary)]">{stats.totalTrainingPairs}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                    {stats.totalLearnedWeights} trọng số đã học
                  </p>
                </div>

                <div className="bg-[var(--bg-secondary)] rounded-xl p-4 col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap size={14} className="text-[var(--accent-primary)]" />
                    <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">Nén prompt</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                        {stats.compressionSavings.savingsPercent.toFixed(1)}%
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)]">tiết kiệm</p>
                    </div>
                    <div className="flex-1 bg-[var(--bg-primary)] rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-primary)] rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(stats.compressionSavings.savingsPercent, 100)}%` }}
                      />
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] text-[var(--text-secondary)]">
                        {stats.compressionSavings.tokensOriginal.toLocaleString()} → {stats.compressionSavings.tokensCompressed.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)]">tokens</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Training */}
              <div className="border border-[var(--border-primary)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Huấn luyện</h3>
                    <p className="text-[12px] text-[var(--text-tertiary)]">
                      {stats.lastTrainedAt
                        ? `Lần cuối: ${new Date(stats.lastTrainedAt).toLocaleString('vi-VN')}`
                        : 'Chưa huấn luyện'}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleTrain}
                    disabled={training}
                  >
                    {training ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    <span className="ml-1.5">{training ? 'Đang huấn luyện...' : 'Huấn luyện'}</span>
                  </Button>
                </div>

                {training && (
                  <div className="bg-[var(--bg-secondary)] rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        Đang tối ưu hóa prompt và trọng số...
                      </span>
                    </div>
                  </div>
                )}

                {/* Training result toast */}
                {!training && trainResult && (
                  <div className={cn(
                    'rounded-lg p-3 text-[12px] animate-in fade-in duration-200',
                    trainResult.trained > 0 || trainResult.weights > 0
                      ? 'bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[var(--status-success-text)]'
                      : 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)]'
                  )}>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={14} className="shrink-0" />
                      {trainResult.trained > 0 || trainResult.weights > 0 ? (
                        <span>
                          <strong>Hoàn tất!</strong> {trainResult.trained} training pairs, {trainResult.weights} trọng số đã học
                          {trainResult.optimized && ' — prompt đã tối ưu'}
                        </span>
                      ) : (
                        <span>Chưa có đủ dữ liệu để huấn luyện. Hãy dùng Brain để tạo feedback.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
