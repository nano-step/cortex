/**
 * Training Engine Types — Shared types for the infinite auto-training system
 */

export type PipelineName = 'reranker' | 'prompt' | 'instinct' | 'agent' | 'crystal' | 'memory' | 'embedding' | 'autoscan'
export type TriggerType = 'idle' | 'interval' | 'threshold' | 'post_chat' | 'manual'
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type JobPriority = 0 | 1 | 2 | 3 // 0 = highest

export interface TrainingPipeline {
  name: PipelineName
  priority: JobPriority
  triggers: TriggerType[]
  enabled: boolean
  execute: (context: PipelineContext) => Promise<PipelineResult>
}

export interface PipelineContext {
  projectId?: string // undefined = all projects
  trigger: TriggerType
  lastRunAt: number | null
  eventsSinceLastRun: number
}

export interface PipelineResult {
  pipeline: PipelineName
  success: boolean
  metrics: Record<string, number>
  durationMs: number
  error?: string
}

export interface TrainingJob {
  id: string
  pipeline: PipelineName
  priority: JobPriority
  trigger: TriggerType
  status: JobStatus
  projectId?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: PipelineResult
}

export interface PipelineScheduleConfig {
  enabled: boolean
  intervalMs: number
  thresholdCount: number
  idleMinutes: number
}

export interface SchedulerConfig {
  enabled: boolean
  idleThresholdMinutes: number
  globalIntervalMs: number
  maxConcurrentJobs: number
  pauseDuringChat: boolean
  pipelines: Record<PipelineName, PipelineScheduleConfig>
}

export interface AgentScore {
  agentName: string
  projectId: string
  totalCalls: number
  successCount: number
  avgLatencyMs: number
  avgSatisfaction: number // -1 to 1
  lastUpdated: number
}

export interface TrainingEngineStatus {
  running: boolean
  idle: boolean
  lastActivity: number
  pipelineStatuses: Record<PipelineName, {
    lastRun: number | null
    lastResult: PipelineResult | null
    totalRuns: number
    totalSuccesses: number
  }>
  queueLength: number
  currentJob: TrainingJob | null
}

export const ALL_PIPELINES: PipelineName[] = ['reranker', 'prompt', 'instinct', 'agent', 'crystal', 'memory', 'embedding', 'autoscan']

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  idleThresholdMinutes: 5,
  globalIntervalMs: 30 * 60 * 1000,
  maxConcurrentJobs: 1,
  pauseDuringChat: true,
  pipelines: {
    reranker: { enabled: true, intervalMs: 15 * 60 * 1000, thresholdCount: 20, idleMinutes: 3 },
    prompt: { enabled: true, intervalMs: 60 * 60 * 1000, thresholdCount: 50, idleMinutes: 10 },
    instinct: { enabled: true, intervalMs: 30 * 60 * 1000, thresholdCount: 0, idleMinutes: 5 },
    agent: { enabled: true, intervalMs: 60 * 60 * 1000, thresholdCount: 30, idleMinutes: 10 },
    crystal: { enabled: true, intervalMs: 45 * 60 * 1000, thresholdCount: 0, idleMinutes: 10 },
    memory: { enabled: true, intervalMs: 2 * 60 * 60 * 1000, thresholdCount: 0, idleMinutes: 15 },
    embedding: { enabled: true, intervalMs: 4 * 60 * 60 * 1000, thresholdCount: 0, idleMinutes: 20 },
    autoscan: { enabled: true, intervalMs: 0, thresholdCount: 0, idleMinutes: 2 }
  }
}
