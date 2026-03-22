/**
 * RAG Skill — Wraps agentic-rag for intelligent code search
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { agenticRetrieve } from '../../agentic-rag'

const RAG_KEYWORDS = ['search', 'find', 'where', 'locate', 'what', 'how', 'show', 'explain', 'which', 'look']

export function createRagSkill(): CortexSkill {
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
    name: 'rag-search',
    version: '4.0.0',
    category: 'rag',
    priority: 'p0',
    description: 'Intelligent code search using agentic RAG pipeline with query decomposition and iterative retrieval',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {
      // No initialization needed
    },

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return RAG_KEYWORDS.some(kw => lower.includes(kw)) ||
        /^(how|what|where|which|show|find|explain)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const mode = (input.mode || 'engineering') as 'pm' | 'engineering'
        const result = await agenticRetrieve(input.projectId, input.query, mode)

        const contextText = result.context
          .map(c => `**${c.relativePath}** (${c.chunkType}${c.name ? ': ' + c.name : ''})\nLines ${c.lineStart}-${c.lineEnd}\n\`\`\`${c.language}\n${c.content}\n\`\`\``)
          .join('\n\n')

        updateMetrics(Date.now() - start, true)
        return {
          content: contextText || 'No relevant code found for your query.',
          metadata: {
            subQueries: result.subQueries,
            iterations: result.iterations,
            confidence: result.confidence,
            resultCount: result.context.length
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