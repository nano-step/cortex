/**
 * Memory Skill — Wraps memory manager for recall and archival
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { searchMemory, getMemoryStats, getCoreMemory, loadMemoryContext } from '../../memory/memory-manager'
import type { CoreMemorySection } from '../../memory/types'

const MEMORY_KEYWORDS = ['remember', 'recall', 'memory', 'prefer', 'history', 'past', 'previously', 'forgot', 'my style', 'my preference', 'what do i']

export function createMemorySkill(): CortexSkill {
  let metrics: SkillMetrics = {
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    lastUsed: null
  }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'memory-recall',
    version: '4.0.0',
    category: 'memory',
    priority: 'p0',
    description: 'Searches and retrieves memories from core, archival, and recall tiers',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return MEMORY_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const parts: string[] = []

        // Check core memory first
        const coreEntries = getCoreMemory(input.projectId)
        if (coreEntries.length > 0) {
          parts.push('## Core Memory')
          for (const entry of coreEntries) {
            const label = entry.section.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            parts.push(`### ${label}`)
            parts.push(entry.content)
            parts.push('')
          }
        }

        // Search archival + recall
        const results = await searchMemory(input.projectId, input.query, 10)
        if (results.length > 0) {
          parts.push('## Relevant Memories')
          for (const r of results) {
            const tierLabel = r.tier === 'archival' ? '📦 Archival' : '💬 Recall'
            parts.push(`**${tierLabel}** (relevance: ${(r.score * 100).toFixed(0)}%)`)
            parts.push(r.entry.content.slice(0, 500))
            parts.push('')
          }
        }

        const content = parts.length > 0
          ? parts.join('\n')
          : 'No memories found matching your query.'

        // Add stats
        const stats = getMemoryStats(input.projectId)

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: {
            coreEntries: stats.coreEntries,
            archivalEntries: stats.archivalEntries,
            recallEntries: stats.recallEntries,
            searchResults: results.length
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},

    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}