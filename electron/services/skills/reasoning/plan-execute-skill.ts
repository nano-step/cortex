/**
 * Plan & Execute Skill — Two-phase reasoning: plan first, then execute steps
 */
import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getActiveModel } from '../../llm-client'
import { hybridSearch } from '../../vector-search'

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (response.ok || (response.status < 500 && response.status !== 429)) return response
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        continue
      }
      return response
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (attempt >= maxRetries - 1) throw err
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
    }
  }
  throw new Error('fetchWithRetry: exhausted retries')
}

const PLAN_KEYWORDS = ['plan', 'break down', 'step by step', 'strategy', 'approach', 'outline', 'design', 'architect']

interface PlanStep {
  id: number
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
}

export function createPlanExecuteSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'plan-execute',
    version: '4.0.0',
    category: 'reasoning',
    priority: 'p1',
    description: 'Two-phase reasoning: creates a plan then executes each step',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return PLAN_KEYWORDS.some(kw => lower.includes(kw)) && input.query.split(' ').length > 8
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const plan = await generatePlan(input.query, input.signal)
        if (plan.length === 0) {
          updateMetrics(Date.now() - start, true)
          return { content: 'Could not generate a plan for this task.', metadata: { type: 'plan-execute', steps: 0 } }
        }

        const results: string[] = [`## Kế hoạch (${plan.length} bước)\n`]
        for (const step of plan) {
          if (input.signal?.aborted) throw new DOMException('Agent aborted', 'AbortError')
          step.status = 'running'
          try {
            const context = await hybridSearch(input.projectId, step.description, 5)
            const contextStr = context.map(r => `${r.relativePath}: ${r.content.slice(0, 200)}`).join('\n')
            step.result = await executeStep(step.description, contextStr, plan, input.signal)
            step.status = 'done'
            results.push(`### Bước ${step.id}: ${step.description}\n${step.result}\n`)
          } catch (err) {
            step.status = 'failed'
            step.result = String(err)
            results.push(`### Bước ${step.id}: ${step.description}\n❌ Lỗi: ${step.result}\n`)
          }
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: results.join('\n'),
          metadata: { type: 'plan-execute', steps: plan.length, completed: plan.filter(s => s.status === 'done').length }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}

async function generatePlan(task: string, signal?: AbortSignal): Promise<PlanStep[]> {
  const proxyUrl = getProxyUrl()
  const proxyKey = getProxyKey()

  try {
    const response = await fetchWithRetry(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${proxyKey}` },
      signal,
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          { role: 'system', content: 'You are a planning assistant. Break the task into 2-6 concrete steps. Output ONLY a numbered list (1. step\n2. step...). No preamble.' },
          { role: 'user', content: task }
        ],
        max_tokens: 500,
        temperature: 0.2
      })
    })

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const text = data.choices?.[0]?.message?.content || ''
    const lines = text.split('\n').filter(l => /^\d+\./.test(l.trim()))

    return lines.map((line, idx) => ({
      id: idx + 1,
      description: line.replace(/^\d+\.\s*/, '').trim(),
      status: 'pending' as const
    }))
  } catch {
    return []
  }
}

async function executeStep(stepDescription: string, context: string, allSteps: PlanStep[], signal?: AbortSignal): Promise<string> {
  const proxyUrl = getProxyUrl()
  const proxyKey = getProxyKey()
  const completedSteps = allSteps.filter(s => s.status === 'done').map(s => `Step ${s.id}: ${s.description} -> ${s.result?.slice(0, 100)}`).join('\n')

  try {
    const response = await fetchWithRetry(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${proxyKey}` },
      signal,
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          { role: 'system', content: `You are executing a step in a plan. Use the code context to provide a specific, actionable answer.\n\nCompleted steps:\n${completedSteps}\n\nCode context:\n${context}` },
          { role: 'user', content: `Execute this step: ${stepDescription}` }
        ],
        max_tokens: 800,
        temperature: 0.1
      })
    })

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content || 'No response'
  } catch (err) {
    return `Error: ${String(err)}`
  }
}