/**
 * Reflexion Skill — Self-evaluating reasoning with retry loop
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

const REFLEXION_KEYWORDS = ['review', 'evaluate', 'improve', 'optimize', 'critique', 'better', 'refine', 'quality']
const MAX_REFLECTIONS = 3

interface ReflexionAttempt {
  answer: string
  evaluation: string
  score: number
}

export function createReflexionSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'reflexion',
    version: '4.0.0',
    category: 'reasoning',
    priority: 'p1',
    description: 'Self-evaluating reasoning that iteratively improves answers through reflection',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return REFLEXION_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        // Get code context
        const context = await hybridSearch(input.projectId, input.query, 8)
        const contextStr = context.map(r => `${r.relativePath}: ${r.content.slice(0, 300)}`).join('\n\n')

        const attempts: ReflexionAttempt[] = []
        let currentAnswer = ''

        for (let i = 0; i < MAX_REFLECTIONS; i++) {
          if (input.signal?.aborted) throw new DOMException('Agent aborted', 'AbortError')
          currentAnswer = await generateAnswer(input.query, contextStr, attempts, input.signal)
          const evaluation = await evaluateAnswer(input.query, currentAnswer, contextStr, input.signal)

          attempts.push({
            answer: currentAnswer,
            evaluation: evaluation.feedback,
            score: evaluation.score
          })

          // Good enough - stop iterating
          if (evaluation.score >= 8) break
        }

        const bestAttempt = attempts.reduce((best, curr) => curr.score > best.score ? curr : best, attempts[0])

        const reflectionLog = attempts.map((a, i) =>
          `### Lần ${i + 1} (Điểm: ${a.score}/10)\n${a.evaluation}`
        ).join('\n\n')

        updateMetrics(Date.now() - start, true)
        return {
          content: `${bestAttempt.answer}\n\n---\n## Quá trình đánh giá (${attempts.length} lần)\n\n${reflectionLog}`,
          metadata: {
            type: 'reflexion',
            attempts: attempts.length,
            bestScore: bestAttempt.score,
            scores: attempts.map(a => a.score)
          }
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

async function generateAnswer(query: string, context: string, previousAttempts: ReflexionAttempt[], signal?: AbortSignal): Promise<string> {
  const proxyUrl = getProxyUrl()
  const proxyKey = getProxyKey()
  const feedback = previousAttempts.length > 0
    ? `\n\nPrevious attempt feedback:\n${previousAttempts[previousAttempts.length - 1].evaluation}\n\nPrevious answer:\n${previousAttempts[previousAttempts.length - 1].answer.slice(0, 500)}`
    : ''

  try {
    const response = await fetchWithRetry(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${proxyKey}` },
      signal,
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          { role: 'system', content: `You are a code expert. Answer based on the code context provided. Be specific and actionable.${feedback}\n\nCode context:\n${context}` },
          { role: 'user', content: query }
        ],
        max_tokens: 1200,
        temperature: 0.3
      })
    })
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content || 'No response'
  } catch (err) {
    return `Error generating answer: ${String(err)}`
  }
}

async function evaluateAnswer(query: string, answer: string, context: string, signal?: AbortSignal): Promise<{ feedback: string, score: number }> {
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
          { role: 'system', content: 'You are a code review evaluator. Score the answer 1-10 and give specific improvement feedback. Format: Score: N/10\nFeedback: ...' },
          { role: 'user', content: `Question: ${query}\n\nAnswer: ${answer.slice(0, 800)}\n\nCode context: ${context.slice(0, 500)}` }
        ],
        max_tokens: 300,
        temperature: 0.1
      })
    })
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const text = data.choices?.[0]?.message?.content || ''
    const scoreMatch = text.match(/Score:\s*(\d+)/)
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 5
    const feedback = text.replace(/Score:\s*\d+\/10\s*/, '').trim()
    return { feedback: feedback || 'No feedback', score: Math.min(score, 10) }
  } catch {
    return { feedback: 'Evaluation failed', score: 5 }
  }
}