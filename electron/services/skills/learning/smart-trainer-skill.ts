import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { optimizePrompt, getOptimizationStatus, shouldAutoOptimize, markAutoOptimized } from './prompt-optimizer'
import { getSessionMetrics } from './event-collector'
import { getActivePrompt, getOptimizationHistory } from './dspy-bridge'
import { getFeedbackStats } from '../../feedback-collector'

const TRAIN_KEYWORDS = ['train', 'optimize', 'improve', 'learning status', 'how am i doing', 'training', 'self-improve', 'get better', 'prompt optimization']

export function createSmartTrainerSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'smart-trainer',
    version: '4.0.0',
    category: 'learning',
    priority: 'p0',
    description: 'Real prompt optimization using behavioral feedback analysis, LLM-driven rewriting, few-shot selection, and A/B testing',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return TRAIN_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const lower = input.query.toLowerCase()
        const isStatusQuery = lower.includes('status') || lower.includes('how') || lower.includes('progress')

        if (isStatusQuery) {
          return buildStatusReport(input.projectId, start)
        }

        return await runTrainingCycle(input.projectId, start)
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

  function buildStatusReport(projectId: string, start: number): SkillOutput {
    const optStatus = getOptimizationStatus(projectId)
    const feedbackStats = getFeedbackStats(projectId)
    const eventMetrics = getSessionMetrics(projectId)

    const sections: string[] = []
    sections.push('# 🧠 Cortex Learning Status\n')

    sections.push('## Feedback Data')
    sections.push(`| Metric | Value |`)
    sections.push(`|--------|-------|`)
    sections.push(`| Total Feedback Signals | ${feedbackStats.totalFeedback} |`)
    sections.push(`| Positive Signals | ${feedbackStats.positiveCount} |`)
    sections.push(`| Negative Signals | ${feedbackStats.negativeCount} |`)
    sections.push(`| Training Pairs | ${feedbackStats.totalTrainingPairs} |`)
    sections.push(`| Behavioral Events | ${eventMetrics.totalEvents} |`)
    sections.push('')

    sections.push('## Event Breakdown')
    if (Object.keys(eventMetrics.eventBreakdown).length > 0) {
      sections.push('| Event Type | Count |')
      sections.push('|-----------|-------|')
      for (const [type, count] of Object.entries(eventMetrics.eventBreakdown)) {
        sections.push(`| ${type} | ${count} |`)
      }
    } else {
      sections.push('No behavioral events recorded yet.')
    }
    sections.push('')

    sections.push('## Optimization Status')
    sections.push(`- **Ready to optimize:** ${optStatus.readyToOptimize ? '✅ Yes' : `❌ No (need ${5 - optStatus.totalPairs} more training pairs)`}`)
    if (optStatus.lastOptimization) {
      sections.push(`- **Last optimization:** ${new Date(optStatus.lastOptimization.timestamp).toLocaleString()} (improvement: ${(optStatus.lastOptimization.improvement * 100).toFixed(1)}%)`)
    } else {
      sections.push('- **Last optimization:** Never run')
    }

    const versionCount = Object.keys(optStatus.activePromptVersions).length
    if (versionCount > 0) {
      sections.push(`- **Active prompt versions:** ${versionCount}`)
      for (const [skill, version] of Object.entries(optStatus.activePromptVersions)) {
        sections.push(`  - ${skill}: v${version}`)
      }
    }

    const positiveRate = feedbackStats.totalFeedback > 0
      ? ((feedbackStats.positiveCount / feedbackStats.totalFeedback) * 100).toFixed(1)
      : '0'
    sections.push(`\n## Health Score: ${positiveRate}% positive feedback rate`)

    updateMetrics(Date.now() - start, true)
    return {
      content: sections.join('\n'),
      metadata: { type: 'status', feedbackStats, eventMetrics, optStatus }
    }
  }

  async function runTrainingCycle(projectId: string, start: number): Promise<SkillOutput> {
    const db = getDb()
    const defaultTemplate = `You are Cortex, an AI coding assistant. You help with code analysis, debugging, and architecture questions. Provide accurate, concise answers with code examples when relevant.`

    const currentTemplate = getActivePrompt(projectId, 'default') || defaultTemplate

    const result = await optimizePrompt(projectId, currentTemplate, 'default')

    if (result.improvement > 0) {
      markAutoOptimized(projectId)
    }

    const sections: string[] = []
    sections.push('# 🎯 Training Cycle Complete\n')
    sections.push(`| Metric | Value |`)
    sections.push(`|--------|-------|`)
    sections.push(`| Method | ${result.method} |`)
    sections.push(`| Improvement | ${(result.improvement * 100).toFixed(1)}% |`)
    sections.push(`| Training Pairs Used | ${result.pairsUsed} |`)
    sections.push(`| Prompt Version | v${result.version} |`)
    sections.push(`| Duration | ${Date.now() - start}ms |`)
    sections.push('')

    if (result.report) {
      sections.push('## Analysis Report')
      sections.push(result.report)
      sections.push('')
    }

    if (result.improvement > 0) {
      sections.push('✅ Prompt has been optimized and deployed. Previous version saved for rollback.')
    } else {
      sections.push('ℹ️ No improvement found in this cycle. Current prompt is already well-tuned, or more training data is needed.')
    }

    updateMetrics(Date.now() - start, true)
    return {
      content: sections.join('\n'),
      metadata: {
        type: 'training',
        method: result.method,
        improvement: result.improvement,
        pairsUsed: result.pairsUsed,
        version: result.version
      }
    }
  }
}
