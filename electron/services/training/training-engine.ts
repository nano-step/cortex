import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type {
  TrainingJob, TrainingPipeline, PipelineName, PipelineContext,
  PipelineResult, TrainingEngineStatus, SchedulerConfig
} from './types'
import { createAutoscanPipeline } from './pipelines/pipeline-autoscan'
import { DEFAULT_SCHEDULER_CONFIG, ALL_PIPELINES } from './types'
import { initTrainingSchema, insertRun, startRun, completeRun, getLastRunTime, recordMetric, getRunCountByPipeline } from './training-db'
import { startScheduler, stopScheduler, notifyPostChat, notifyEvent, notifyChatStarted, notifyChatEnded, getSchedulerStatus } from './training-scheduler'

let mainWindow: BrowserWindow | null = null
let engineRunning = false
let processing = false
const pipelineRegistry: Map<PipelineName, TrainingPipeline> = new Map()
const jobQueue: TrainingJob[] = []
let currentJob: TrainingJob | null = null

export function initTrainingEngine(window: BrowserWindow | null): void {
  if (engineRunning) return
  mainWindow = window

  try {
    initTrainingSchema()
  } catch (err) {
    console.error('[TrainingEngine] Schema init failed:', err)
    return
  }

  const config = loadConfig()
  registerPipeline(createAutoscanPipeline())
  startScheduler(config, handleTrigger)
  engineRunning = true
  console.log('[TrainingEngine] Initialized — auto-training active')
  emitStatus()

  setTimeout(() => {
    if (engineRunning) enqueueJob('autoscan', 'manual')
  }, 10_000)
}

export function shutdownTrainingEngine(): void {
  if (!engineRunning) return
  stopScheduler()
  jobQueue.length = 0
  currentJob = null
  processing = false
  engineRunning = false
  console.log('[TrainingEngine] Shutdown complete')
}

export function registerPipeline(pipeline: TrainingPipeline): void {
  pipelineRegistry.set(pipeline.name, pipeline)
}

export function enqueueJob(pipelineName: PipelineName, trigger: TrainingJob['trigger'], projectId?: string): void {
  if (!engineRunning) return

  const pipeline = pipelineRegistry.get(pipelineName)
  if (!pipeline || !pipeline.enabled) return

  const alreadyQueued = jobQueue.some(j => j.pipeline === pipelineName && j.status === 'pending' && j.projectId === projectId)
  if (alreadyQueued) return
  if (currentJob?.pipeline === pipelineName && currentJob.projectId === projectId) return

  const job: TrainingJob = {
    id: randomUUID(),
    pipeline: pipelineName,
    priority: pipeline.priority,
    trigger,
    status: 'pending',
    projectId,
    createdAt: Date.now()
  }

  jobQueue.push(job)
  jobQueue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)

  scheduleProcessing()
}

export function getEngineStatus(): TrainingEngineStatus {
  const pipelineStatuses = {} as TrainingEngineStatus['pipelineStatuses']
  for (const name of ALL_PIPELINES) {
    const counts = getRunCountByPipeline(name)
    const lastRun = getLastRunTime(name)
    pipelineStatuses[name] = {
      lastRun,
      lastResult: null,
      totalRuns: counts.total,
      totalSuccesses: counts.successes
    }
  }

  return {
    running: engineRunning,
    idle: !processing && jobQueue.length === 0,
    lastActivity: currentJob?.startedAt || Date.now(),
    pipelineStatuses,
    queueLength: jobQueue.length,
    currentJob
  }
}

export function notifyChatCompleted(projectId: string): void {
  if (!engineRunning) return
  notifyPostChat(projectId)
}

export function notifyBehavioralEvent(projectId: string): void {
  if (!engineRunning) return
  notifyEvent(projectId)
}

export function pauseTraining(): void {
  notifyChatStarted()
}

export function resumeTraining(): void {
  notifyChatEnded()
  scheduleProcessing()
}

export function triggerManualTraining(pipelineName?: PipelineName, projectId?: string): void {
  if (!engineRunning) return

  if (pipelineName) {
    enqueueJob(pipelineName, 'manual', projectId)
  } else {
    for (const name of ALL_PIPELINES) {
      enqueueJob(name, 'manual', projectId)
    }
  }
}

function handleTrigger(pipeline: PipelineName, trigger: TrainingJob['trigger'], projectId?: string): void {
  enqueueJob(pipeline, trigger, projectId)
}

function scheduleProcessing(): void {
  if (processing || jobQueue.length === 0) return
  setImmediate(() => processQueue())
}

async function processQueue(): Promise<void> {
  if (processing || jobQueue.length === 0 || !engineRunning) return
  processing = true

  try {
    while (jobQueue.length > 0 && engineRunning) {
      const job = jobQueue.shift()
      if (!job) break

      const pipeline = pipelineRegistry.get(job.pipeline)
      if (!pipeline) {
        job.status = 'skipped'
        continue
      }

      currentJob = job
      job.status = 'running'
      job.startedAt = Date.now()

      const runId = insertRun(job.pipeline, job.trigger, job.projectId)
      startRun(runId)
      emitProgress(job.pipeline, 'running')

      const context: PipelineContext = {
        projectId: job.projectId,
        trigger: job.trigger,
        lastRunAt: getLastRunTime(job.pipeline),
        eventsSinceLastRun: 0
      }

      let result: PipelineResult
      try {
        result = await pipeline.execute(context)
      } catch (err) {
        result = {
          pipeline: job.pipeline,
          success: false,
          metrics: {},
          durationMs: Date.now() - (job.startedAt || Date.now()),
          error: (err as Error).message
        }
      }

      job.status = result.success ? 'completed' : 'failed'
      job.completedAt = Date.now()
      job.result = result
      completeRun(runId, result)

      for (const [key, value] of Object.entries(result.metrics)) {
        recordMetric(job.pipeline, key, value, job.projectId)
      }

      emitProgress(job.pipeline, result.success ? 'completed' : 'failed', result)
      currentJob = null

      if (job.pipeline === 'autoscan' && result.success && engineRunning) {
        setTimeout(() => enqueueJob('autoscan', 'interval'), 5_000)
      }

      await yieldToEventLoop()
    }
  } catch (err) {
    console.error('[TrainingEngine] Queue processing error:', err)
  } finally {
    processing = false
    currentJob = null
    emitStatus()
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function emitProgress(pipeline: PipelineName, status: string, result?: PipelineResult): void {
  mainWindow?.webContents.send('training:progress', { pipeline, status, result, timestamp: Date.now() })
}

function emitStatus(): void {
  mainWindow?.webContents.send('training:status', getEngineStatus())
}

function loadConfig(): SchedulerConfig {
  return { ...DEFAULT_SCHEDULER_CONFIG }
}
