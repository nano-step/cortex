import { useState, useEffect, useRef } from 'react'
import { Search, Brain, Globe, Zap, Loader2, Check, SkipForward, AlertCircle, ChevronDown, ChevronRight, Shield, Database, HardDrive, ListOrdered, Route, Bot, Cpu, GitBranch, Wrench } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ThinkingStepData {
  step: 'sanitize' | 'memory' | 'rag' | 'external_context' | 'web_search' | 'build_prompt' | 'cache' | 'streaming' | 'queue' | 'routing' | 'agent_init' | 'agent_mode' | 'orchestrate' | 'tool_call' | 'skill_chain' | 'background'
  status: 'running' | 'done' | 'skipped' | 'error'
  label: string
  detail?: string
  durationMs?: number
}

interface ThinkingProcessProps {
  steps: ThinkingStepData[]
}

const STEP_ICONS: Record<string, typeof Brain> = {
  sanitize: Shield,
  memory: Database,
  rag: Brain,
  external_context: Globe,
  web_search: Search,
  build_prompt: Zap,
  cache: HardDrive,
  streaming: Loader2,
  queue: ListOrdered,
  routing: Route,
  agent_init: Bot,
  agent_mode: Bot,
  orchestrate: Cpu,
  tool_call: Wrench,
  skill_chain: GitBranch,
  background: Loader2,
}

function StatusIcon({ status }: { status: ThinkingStepData['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={12} className="animate-spin text-[var(--accent-primary)]" />
    case 'done':
      return <Check size={12} className="text-[var(--status-success-text)]" />
    case 'skipped':
      return <SkipForward size={12} className="text-[var(--text-tertiary)]" />
    case 'error':
      return <AlertCircle size={12} className="text-[var(--status-error-text)]" />
  }
}

function StepRow({ step, index }: { step: ThinkingStepData; index: number }) {
  const Icon = step.step === 'streaming' && step.status === 'done' ? Check : (STEP_ICONS[step.step] || Zap)

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1 animate-in fade-in slide-in-from-left duration-200',
        step.status === 'skipped' && 'opacity-50'
      )}
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
    >
      <Icon
        size={13}
        className={cn(
          step.status === 'running' && step.step !== 'streaming' && 'text-[var(--accent-primary)]',
          step.status === 'done' && 'text-[var(--status-success-text)]',
          step.status === 'skipped' && 'text-[var(--text-tertiary)]',
          step.status === 'error' && 'text-[var(--status-error-text)]',
          step.status === 'running' && step.step === 'streaming' && 'animate-spin text-[var(--accent-primary)]'
        )}
      />

      <span className="text-[13px] text-[var(--text-secondary)] flex-1 min-w-0 truncate">
        {step.label}
        {step.detail && (
          <span className="text-[11px] text-[var(--text-tertiary)] ml-1.5">
            — {step.detail}
          </span>
        )}
      </span>

      <div className="flex items-center gap-1.5 shrink-0">
        {step.status === 'done' && step.durationMs != null && (
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            {step.durationMs}ms
          </span>
        )}
        <StatusIcon status={step.status} />
      </div>
    </div>
  )
}

export function ThinkingProcess({ steps }: ThinkingProcessProps) {
  const [collapsed, setCollapsed] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasRunning = steps.some(s => s.status === 'running')
  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0)

  useEffect(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }

    if (hasRunning) {
      setCollapsed(false)
    } else if (steps.length > 0) {
      collapseTimer.current = setTimeout(() => setCollapsed(true), 1000)
    }

    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [hasRunning, steps.length])

  if (steps.length === 0) return null

  return (
    <div className="mb-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {collapsed ? (
          <span>
            Brain đã xử lý {steps.length} bước
            <span className="font-mono ml-1">({(totalDuration / 1000).toFixed(2)}s)</span>
          </span>
        ) : (
          <span>{hasRunning ? 'Brain đang xử lý...' : 'Quá trình xử lý'}</span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-1 ml-1 pl-3 border-l-2 border-[var(--border-primary)] space-y-0">
          {steps.map((step, i) => (
            <StepRow key={step.step} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
