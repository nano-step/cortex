/**
 * Skill Registry — Central skill management and lifecycle
 */

import type {
  CortexSkill,
  SkillRegistryEntry,
  SkillConfig,
  SkillInput,
  SkillOutput,
  SkillStatus,
  SkillInfo,
  HealthStatus
} from './types'
import { recordSkillCall, loadSkillMetrics, getAllSkillMetrics } from './skill-metrics'

const registry = new Map<string, SkillRegistryEntry>()

export async function registerSkill(
  skill: CortexSkill,
  config: SkillConfig = {}
): Promise<boolean> {
  try {
    if (registry.has(skill.name)) {
      console.warn(`[SkillRegistry] Skill '${skill.name}' already registered, updating`)
      await unregisterSkill(skill.name)
    }

    const entry: SkillRegistryEntry = {
      skill,
      status: 'loading',
      config,
      registeredAt: Date.now()
    }

    registry.set(skill.name, entry)

    try {
      await skill.initialize(config)
      entry.status = 'active'
      console.log(`[SkillRegistry] Registered and activated: ${skill.name} v${skill.version}`)
    } catch (err) {
      entry.status = 'error'
      entry.lastError = String(err)
      console.error(`[SkillRegistry] Init failed for ${skill.name}:`, err)
    }

    return true
  } catch (err) {
    console.error(`[SkillRegistry] Registration failed for ${skill.name}:`, err)
    return false
  }
}

export async function unregisterSkill(name: string): Promise<boolean> {
  const entry = registry.get(name)
  if (!entry) return false

  try {
    await entry.skill.shutdown()
  } catch (err) {
    console.warn(`[SkillRegistry] Shutdown error for ${name}:`, err)
  }

  registry.delete(name)
  console.log(`[SkillRegistry] Unregistered: ${name}`)
  return true
}

export function activateSkill(name: string): boolean {
  const entry = registry.get(name)
  if (!entry) {
    console.error(`[SkillRegistry] Skill '${name}' not found`)
    return false
  }
  entry.status = 'active'
  return true
}

export function deactivateSkill(name: string): boolean {
  const entry = registry.get(name)
  if (!entry) {
    console.error(`[SkillRegistry] Skill '${name}' not found`)
    return false
  }
  entry.status = 'inactive'
  return true
}

export function getSkill(name: string): SkillRegistryEntry | undefined {
  return registry.get(name)
}

export function listSkills(filter?: {
  category?: string
  status?: SkillStatus
}): SkillInfo[] {
  const entries = Array.from(registry.values())

  return entries
    .filter(entry => {
      if (filter?.category && entry.skill.category !== filter.category) return false
      if (filter?.status && entry.status !== filter.status) return false
      return true
    })
    .map(entry => {
      const dbMetrics = loadSkillMetrics(entry.skill.name)
      const inMemMetrics = entry.skill.getMetrics()
      let mergedMetrics = dbMetrics.totalCalls > inMemMetrics.totalCalls ? dbMetrics : inMemMetrics

      if (mergedMetrics.totalCalls === 0) {
        const allMetrics = getAllSkillMetrics()
        const skillPrefix = entry.skill.name.replace(/^mcp-/, '')
        const aggregated = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null as number | null }
        let totalLatency = 0
        for (const [toolName, m] of Object.entries(allMetrics)) {
          if (toolName.includes(skillPrefix) || toolName.startsWith(entry.skill.name)) {
            aggregated.totalCalls += m.totalCalls
            aggregated.successCount += m.successCount
            aggregated.errorCount += m.errorCount
            totalLatency += m.avgLatencyMs * m.totalCalls
            if (m.lastUsed && (!aggregated.lastUsed || m.lastUsed > aggregated.lastUsed)) aggregated.lastUsed = m.lastUsed
          }
        }
        if (aggregated.totalCalls > 0) {
          aggregated.avgLatencyMs = totalLatency / aggregated.totalCalls
          mergedMetrics = aggregated
        }
      }

      return {
        name: entry.skill.name,
        version: entry.skill.version,
        category: entry.skill.category,
        priority: entry.skill.priority,
        status: entry.status,
        description: entry.skill.description,
        metrics: mergedMetrics,
        dependencies: entry.skill.dependencies,
        lastError: entry.lastError
      }
    })
}

export async function executeSkill(
  name: string,
  input: SkillInput
): Promise<SkillOutput> {
  const entry = registry.get(name)
  if (!entry) {
    throw new Error(`Skill '${name}' not found`)
  }

  if (entry.status !== 'active') {
    throw new Error(`Skill '${name}' is not active (status: ${entry.status})`)
  }

  const start = Date.now()
  try {
    const result = await entry.skill.execute(input)
    recordSkillCall(name, true, Date.now() - start)
    return result
  } catch (err) {
    recordSkillCall(name, false, Date.now() - start)
    entry.lastError = String(err)
    console.error(`[SkillRegistry] Execution failed for ${name}:`, err)
    throw err
  }
}

export async function getHealthReport(): Promise<Record<string, HealthStatus>> {
  const report: Record<string, HealthStatus> = {}

  for (const [name, entry] of registry) {
    if (entry.status === 'active') {
      try {
        report[name] = await entry.skill.healthCheck()
      } catch (err) {
        report[name] = {
          healthy: false,
          message: String(err),
          lastCheck: Date.now()
        }
      }
    }
  }

  return report
}

export async function shutdownAll(): Promise<void> {
  console.log(`[SkillRegistry] Shutting down ${registry.size} skills`)
  for (const [name, entry] of registry) {
    try {
      await entry.skill.shutdown()
    } catch (err) {
      console.error(`[SkillRegistry] Shutdown failed for ${name}:`, err)
    }
  }
  registry.clear()
}

export function getActiveSkills(): CortexSkill[] {
  return Array.from(registry.values())
    .filter(e => e.status === 'active')
    .map(e => e.skill)
}

export function getRegistrySize(): number {
  return registry.size
}