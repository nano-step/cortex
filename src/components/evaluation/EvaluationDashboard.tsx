import React, { useEffect } from 'react'
import { useEvaluationStore, type Tier1Metrics, type Tier2Metrics, type Tier3Metrics } from '../../stores/evaluationStore'
import { MetricCard } from './MetricCard'

interface Props {
  projectId: string
}

function acceptanceColor(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.4) return 'green'
  if (rate >= 0.2) return 'yellow'
  return 'red'
}

function recallColor(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.6) return 'green'
  if (rate >= 0.4) return 'yellow'
  return 'red'
}

function correlationColor(c: number): 'green' | 'yellow' | 'red' {
  if (c >= 0.5) return 'green'
  if (c >= 0) return 'yellow'
  return 'red'
}

function Skeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-8 bg-gray-700 rounded w-24" />
      <div className="h-4 bg-gray-700 rounded w-40" />
      <div className="h-4 bg-gray-700 rounded w-32" />
    </div>
  )
}

function EmptyState({ onRun, loading }: { onRun: () => void; loading: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3">
      <span className="text-gray-500 text-sm">Chưa có dữ liệu</span>
      <button
        onClick={onRun}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
      >
        {loading ? 'Đang chạy...' : 'Chạy đánh giá'}
      </button>
    </div>
  )
}

function Tier1Panel({ metrics, loading, onRun }: { metrics: Tier1Metrics | null; loading: boolean; onRun: () => void }): React.ReactElement {
  if (loading) return <Skeleton />
  if (!metrics) return <EmptyState onRun={onRun} loading={loading} />

  const sources = Object.entries(metrics.sourceBreakdown).filter(([, v]) => v > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <MetricCard
          label="Acceptance Rate"
          value={metrics.acceptanceRate}
          format="percent"
          trend={metrics.weeklyDelta}
          color={acceptanceColor(metrics.acceptanceRate)}
          size="lg"
        />
        <MetricCard
          label="Coverage"
          value={metrics.coverageRate}
          format="percent"
          color="blue"
          size="md"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Avg Score" value={metrics.avgJudgeScore} format="score" size="sm" />
        <MetricCard label="P25 Score" value={metrics.p25Score} format="score" size="sm" />
        <MetricCard label="P75 Score" value={metrics.p75Score} format="score" size="sm" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map(([src, count]) => (
          <span key={src} className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
            {src}: {count}
          </span>
        ))}
      </div>
      <div className="text-xs text-gray-600">
        {metrics.totalPairs} pairs · {metrics.totalChunks} chunks total
      </div>
    </div>
  )
}

function Tier2Panel({ metrics, loading, onRun }: { metrics: Tier2Metrics | null; loading: boolean; onRun: () => void }): React.ReactElement {
  if (loading) return <Skeleton />
  if (!metrics) return <EmptyState onRun={onRun} loading={loading} />

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <MetricCard
          label="Recall@5"
          value={metrics.recallAt5}
          format="percent"
          color={recallColor(metrics.recallAt5)}
          size="lg"
        />
        <MetricCard
          label="Recall@10"
          value={metrics.recallAt10}
          format="percent"
          color={recallColor(metrics.recallAt10)}
          size="md"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="MRR" value={metrics.mrr} format="percent" size="sm" />
        <MetricCard label="NDCG@10" value={metrics.ndcgAt10} format="percent" size="sm" />
      </div>
      <MetricCard
        label="Avg Relevant Rank"
        value={metrics.avgRelevantRank.toFixed(1)}
        subtitle={`Based on ${metrics.queriesEvaluated} queries`}
        size="sm"
      />
    </div>
  )
}

function Tier3Panel({ metrics, loading, onRun }: { metrics: Tier3Metrics | null; loading: boolean; onRun: () => void }): React.ReactElement {
  if (loading) return <Skeleton />
  if (!metrics) return <EmptyState onRun={onRun} loading={loading} />

  const topChunks = metrics.topChunksByFeedback.slice(0, 3)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <MetricCard
          label="Positive Feedback"
          value={metrics.feedbackPositiveRate}
          format="percent"
          trend={metrics.weeklyFeedbackTrend}
          color={metrics.feedbackPositiveRate >= 0.6 ? 'green' : metrics.feedbackPositiveRate >= 0.4 ? 'yellow' : 'red'}
          size="lg"
        />
        <MetricCard
          label="AutoScan Correlation"
          value={metrics.autoscanVsFeedbackCorrelation}
          format="correlation"
          color={correlationColor(metrics.autoscanVsFeedbackCorrelation)}
          size="md"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Copy Rate" value={metrics.copyRate} format="percent" size="sm" />
        <MetricCard
          label="Re-query Rate"
          value={metrics.requereryRate}
          format="percent"
          color={metrics.requereryRate < 0.2 ? 'green' : metrics.requereryRate < 0.4 ? 'yellow' : 'red'}
          subtitle="lower = better"
          size="sm"
        />
      </div>
      {topChunks.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Top chunks by feedback</span>
          {topChunks.map(c => (
            <div key={c.chunkId} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 font-mono truncate max-w-[120px]">{c.chunkId.slice(0, 8)}…</span>
              <span className="text-green-400">+{c.positiveCount}</span>
              <span className="text-red-400">-{c.negativeCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function EvaluationDashboard({ projectId }: Props): React.ReactElement {
  const { tier1, tier2, tier3, running, lastEvaluatedAt, loadLatest, runTier1, runTier2, runTier3, runAll } = useEvaluationStore()

  useEffect(() => {
    void loadLatest(projectId)
  }, [projectId])

  const anyRunning = running.tier1 || running.tier2 || running.tier3

  const cards = [
    {
      title: 'Data Quality',
      badge: 'Tier 1',
      description: 'Acceptance rate, judge scores, coverage',
      loading: running.tier1,
      ts: lastEvaluatedAt.tier1,
      panel: <Tier1Panel metrics={tier1} loading={running.tier1} onRun={() => void runTier1(projectId)} />,
      onRun: () => void runTier1(projectId)
    },
    {
      title: 'Retrieval Quality',
      badge: 'Tier 2',
      description: 'Recall@K, MRR, NDCG',
      loading: running.tier2,
      ts: lastEvaluatedAt.tier2,
      panel: <Tier2Panel metrics={tier2} loading={running.tier2} onRun={() => void runTier2(projectId)} />,
      onRun: () => void runTier2(projectId),
      slow: true
    },
    {
      title: 'User Satisfaction',
      badge: 'Tier 3',
      description: 'Feedback correlation, copy rate',
      loading: running.tier3,
      ts: lastEvaluatedAt.tier3,
      panel: <Tier3Panel metrics={tier3} loading={running.tier3} onRun={() => void runTier3(projectId)} />,
      onRun: () => void runTier3(projectId)
    }
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Training Evaluation</h3>
          <p className="text-xs text-gray-500">3-tier quality measurement</p>
        </div>
        <button
          onClick={() => void runAll(projectId)}
          disabled={anyRunning}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {anyRunning && (
            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          Run All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.badge} className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">{card.badge}</span>
                  <span className="text-sm font-medium text-gray-200">{card.title}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
              </div>
              <button
                onClick={card.onRun}
                disabled={card.loading}
                title={card.slow ? '~30s — samples queries' : undefined}
                className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 shrink-0"
              >
                {card.loading ? '…' : 'Run'}
              </button>
            </div>
            {card.panel}
            {card.ts && (
              <p className="text-xs text-gray-600">
                Last run: {new Date(card.ts).toLocaleTimeString()}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
