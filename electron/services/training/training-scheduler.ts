import { powerMonitor } from 'electron'
import type { PipelineName, TriggerType, SchedulerConfig, ALL_PIPELINES } from './types'
import { DEFAULT_SCHEDULER_CONFIG } from './types'

type TriggerCallback = (pipeline: PipelineName, trigger: TriggerType, projectId?: string) => void

let config: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG }
let onTrigger: TriggerCallback | null = null
let running = false
let chatActive = false

const intervalTimers: Map<PipelineName, ReturnType<typeof setInterval>> = new Map()
let idleCheckTimer: ReturnType<typeof setInterval> | null = null
const eventCounters: Map<string, number> = new Map()
const lastTriggerTime: Map<string, number> = new Map()

export function startScheduler(cfg: SchedulerConfig, callback: TriggerCallback): void {
  if (running) stopScheduler()
  config = { ...cfg }
  onTrigger = callback
  running = true

  for (const [name, pipelineCfg] of Object.entries(config.pipelines)) {
    const pName = name as PipelineName
    if (!pipelineCfg.enabled) continue

    if (pipelineCfg.intervalMs > 0) {
      const timer = setInterval(() => {
        if (!running || (config.pauseDuringChat && chatActive)) return
        fireTrigger(pName, 'interval')
      }, pipelineCfg.intervalMs)
      intervalTimers.set(pName, timer)
    }
  }

  idleCheckTimer = setInterval(() => {
    if (!running || (config.pauseDuringChat && chatActive)) return
    checkIdleTriggers()
  }, 30_000)

  console.log('[Scheduler] Started with', Object.keys(config.pipelines).length, 'pipelines')
}

export function stopScheduler(): void {
  running = false
  for (const timer of intervalTimers.values()) clearInterval(timer)
  intervalTimers.clear()
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer)
    idleCheckTimer = null
  }
  eventCounters.clear()
  lastTriggerTime.clear()
  onTrigger = null
  console.log('[Scheduler] Stopped')
}

export function notifyPostChat(projectId: string): void {
  if (!running) return
  chatActive = false

  for (const [name, pipelineCfg] of Object.entries(config.pipelines)) {
    const pName = name as PipelineName
    if (!pipelineCfg.enabled) continue
    fireTrigger(pName, 'post_chat', projectId)
  }
}

export function notifyEvent(projectId: string): void {
  if (!running) return

  for (const [name, pipelineCfg] of Object.entries(config.pipelines)) {
    const pName = name as PipelineName
    if (!pipelineCfg.enabled || pipelineCfg.thresholdCount <= 0) continue

    const key = `${pName}:${projectId}`
    const count = (eventCounters.get(key) || 0) + 1
    eventCounters.set(key, count)

    if (count >= pipelineCfg.thresholdCount) {
      eventCounters.set(key, 0)
      fireTrigger(pName, 'threshold', projectId)
    }
  }
}

export function notifyChatStarted(): void {
  chatActive = true
}

export function notifyChatEnded(): void {
  chatActive = false
}

export function isUserIdle(): boolean {
  try {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    return idleSeconds >= config.idleThresholdMinutes * 60
  } catch {
    return false
  }
}

export function getSchedulerStatus(): {
  running: boolean
  chatActive: boolean
  idle: boolean
  eventCounters: Record<string, number>
} {
  return {
    running,
    chatActive,
    idle: isUserIdle(),
    eventCounters: Object.fromEntries(eventCounters)
  }
}

function checkIdleTriggers(): void {
  if (!isUserIdle()) return

  for (const [name, pipelineCfg] of Object.entries(config.pipelines)) {
    const pName = name as PipelineName
    if (!pipelineCfg.enabled || pipelineCfg.idleMinutes <= 0) continue

    const key = `idle:${pName}`
    const lastFired = lastTriggerTime.get(key) || 0
    const cooldownMs = pipelineCfg.idleMinutes * 60 * 1000

    if (Date.now() - lastFired >= cooldownMs) {
      fireTrigger(pName, 'idle')
      lastTriggerTime.set(key, Date.now())
    }
  }
}

function fireTrigger(pipeline: PipelineName, trigger: TriggerType, projectId?: string): void {
  const debounceKey = `${pipeline}:${trigger}`
  const lastFired = lastTriggerTime.get(debounceKey) || 0
  const MIN_DEBOUNCE_MS = 60_000

  if (Date.now() - lastFired < MIN_DEBOUNCE_MS) return
  lastTriggerTime.set(debounceKey, Date.now())

  if (onTrigger) {
    try {
      onTrigger(pipeline, trigger, projectId)
    } catch (err) {
      console.error(`[Scheduler] Trigger callback error for ${pipeline}:`, err)
    }
  }
}
