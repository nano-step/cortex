/**
 * Chat Skill — Core conversation capability (fallback skill)
 *
 * Uses llm-client's buildPrompt (positional args) and streamChatCompletion
 * to produce a response. This skill is the universal fallback when no
 * specialised skill matches.
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { buildPrompt, streamChatCompletion, type ChatMode, type ChatMessage } from '../../llm-client'
import type { SearchResult } from '../../vector-search'

export function createChatSkill(): CortexSkill {
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
    name: 'cortex-chat',
    version: '4.0.0',
    category: 'reasoning',
    priority: 'p0',
    description: 'Core conversation and reasoning skill. Fallback for all queries.',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(_input: SkillInput): boolean {
      // Chat skill always handles — it's the universal fallback
      return true
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const mode: ChatMode = (input.mode as ChatMode) || 'engineering'
        const history: ChatMessage[] = input.context?.history as ChatMessage[] || []
        const contextChunks = (input.context?.chunks as SearchResult[]) || []
        const projectName = (input.context?.projectName as string) || 'Unknown'
        const brainName = (input.context?.brainName as string) || 'default'
        const conversationId = input.conversationId || 'skill-chat'

        const { messages } = buildPrompt(
          mode,
          input.query,
          contextChunks,
          projectName,
          brainName,
          null,           // directoryTree
          history,        // conversationHistory
          null,           // projectStats
          null,           // externalContext
          null            // memoryContext
        )

        const result = await streamChatCompletion(
          messages,
          conversationId,
          null
        )

        updateMetrics(Date.now() - start, true)
        return {
          content: result.content,
          metadata: { mode, messageCount: messages.length }
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