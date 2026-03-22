/**
 * ReAct Skill — Reasoning + Acting loop for multi-step tasks
 */
import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getActiveModel } from '../../llm-client'
import { hybridSearch } from '../../vector-search'
import { getDiff, getStatus, getLog, gitListBranches } from '../agent/git-actions'

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

const REACT_KEYWORDS = ['fix', 'implement', 'debug', 'create', 'build', 'step by step', 'figure out', 'work through']
const MAX_ITERATIONS = 10

interface ReActStep {
  thought: string
  action: string
  actionInput: string
  observation: string
}

export function createReActSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  return {
    name: 'react-agent',
    version: '4.0.0',
    category: 'reasoning',
    priority: 'p0',
    description: 'ReAct reasoning loop for multi-step problem solving',
    dependencies: [],
    async initialize(_config: SkillConfig) {},
    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return REACT_KEYWORDS.some(kw => lower.includes(kw))
    },
    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      const steps: ReActStep[] = []

      try {
        let context = input.query
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          if (input.signal?.aborted) throw new DOMException('Agent aborted', 'AbortError')
          const step = await reasonAndAct(input.projectId, context, steps, input.signal)
          steps.push(step)

          if (step.action === 'finish') {
            metrics.totalCalls++; metrics.successCount++
            metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + (Date.now() - start)) / metrics.totalCalls
            metrics.lastUsed = Date.now()
            return {
              content: step.observation,
              metadata: { steps: steps.length, iterations: i + 1 }
            }
          }
          context = `Previous steps:\n${steps.map((s, idx) => `Step ${idx + 1}: ${s.thought} -> ${s.action}(${s.actionInput}) -> ${s.observation.slice(0, 200)}`).join('\n')}\n\nOriginal task: ${input.query}`
        }

        metrics.totalCalls++; metrics.successCount++
        metrics.lastUsed = Date.now()
        return {
          content: `Reached max iterations (${MAX_ITERATIONS}). Last result: ${steps[steps.length - 1]?.observation || 'none'}`,
          metadata: { steps: steps.length, maxReached: true }
        }
      } catch (err) { metrics.totalCalls++; metrics.errorCount++; throw err }
    },
    async shutdown() {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics() { return { ...metrics } }
  }
}

async function reasonAndAct(projectId: string, context: string, previousSteps: ReActStep[], signal?: AbortSignal): Promise<ReActStep> {
  // Use LLM to determine next action
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
          { role: 'system', content: 'You are a reasoning agent. For each step, output:\nThought: <reasoning>\nAction: <search_code|git_status|git_diff|git_log|git_branches|finish>\nInput: <action input>\nIf the task is complete, use Action: finish with the final answer as Input.' },
          { role: 'user', content: context }
        ],
        max_tokens: 1000,
        temperature: 0.1
      })
    })

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const text = data.choices?.[0]?.message?.content || ''

    const thought = text.match(/Thought:\s*(.+?)(?=\n|Action:)/s)?.[1]?.trim() || 'Analyzing...'
    const action = text.match(/Action:\s*(\w+)/)?.[1] || 'finish'
    const actionInput = text.match(/Input:\s*(.+?)$/s)?.[1]?.trim() || ''

    let observation = ''
    if (action === 'search_code') {
      const results = await hybridSearch(projectId, actionInput, 5)
      observation = results.map(r => `${r.relativePath}: ${r.content.slice(0, 200)}`).join('\n')
    } else if (action === 'git_status') {
      observation = await getStatus(actionInput).catch(e => `Error: ${e}`)
    } else if (action === 'git_diff') {
      const diff = await getDiff(actionInput).catch(e => `Error: ${e}`)
      observation = diff.slice(0, 2000)
    } else if (action === 'git_log') {
      observation = await getLog(actionInput, 10).catch(e => `Error: ${e}`)
    } else if (action === 'git_branches') {
      const branches = await gitListBranches(actionInput).catch(() => [])
      observation = branches.join(', ') || 'No branches found'
    } else {
      observation = actionInput
    }

    return { thought, action, actionInput, observation }
  } catch (err) {
    return { thought: 'Error occurred', action: 'finish', actionInput: '', observation: `Error: ${String(err)}` }
  }
}