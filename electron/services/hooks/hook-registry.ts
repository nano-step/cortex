import type { HookDefinition, HookTrigger, HookPriority, HookStats } from './types'
import { isHookDisabled } from '../plugin-config'

const PRIORITY_ORDER: Record<HookPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
}

const hooks = new Map<string, HookDefinition>()
const stats = new Map<string, HookStats>()

function defaultStats(): HookStats {
  return { totalExecutions: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastExecutedAt: null }
}

export function registerHook(hook: HookDefinition): void {
  hooks.set(hook.id, hook)
  if (!stats.has(hook.id)) {
    stats.set(hook.id, defaultStats())
  }
}

export function unregisterHook(id: string): boolean {
  const existed = hooks.delete(id)
  stats.delete(id)
  return existed
}

export function getHooksByTrigger(trigger: HookTrigger): HookDefinition[] {
  const matched: HookDefinition[] = []
  for (const hook of hooks.values()) {
    if (!hook.enabled) continue
    if (isHookDisabled(hook.name)) continue
    const triggers = Array.isArray(hook.trigger) ? hook.trigger : [hook.trigger]
    if (triggers.includes(trigger)) {
      matched.push(hook)
    }
  }
  return matched.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}

export function listHooks(): Array<HookDefinition & { stats: HookStats }> {
  return Array.from(hooks.values()).map(hook => ({
    ...hook,
    stats: stats.get(hook.id) || defaultStats()
  }))
}

export function enableHook(id: string): boolean {
  const hook = hooks.get(id)
  if (!hook) return false
  hook.enabled = true
  return true
}

export function disableHook(id: string): boolean {
  const hook = hooks.get(id)
  if (!hook) return false
  hook.enabled = false
  return true
}

export function getHookStats(id: string): HookStats | null {
  return stats.get(id) || null
}

export function updateHookStats(id: string, success: boolean, latencyMs: number): void {
  const existing = stats.get(id) || defaultStats()
  const totalExecs = existing.totalExecutions + 1
  const newAvg = (existing.avgLatencyMs * existing.totalExecutions + latencyMs) / totalExecs
  stats.set(id, {
    totalExecutions: totalExecs,
    successCount: existing.successCount + (success ? 1 : 0),
    errorCount: existing.errorCount + (success ? 0 : 1),
    avgLatencyMs: Math.round(newAvg * 100) / 100,
    lastExecutedAt: Date.now()
  })
}

export function resetRegistry(): void {
  hooks.clear()
  stats.clear()
}
