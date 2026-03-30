/**
 * Agent Pool — Parallel execution engine for multi-agent system
 *
 * Runs multiple agents concurrently via Promise.allSettled.
 * Each agent makes a non-streaming LLM call to the proxy.
 *
 * Retry strategy:
 * - 429 / 5xx: exponential backoff with jitter, up to MAX_AGENT_RETRIES attempts
 * - Retry-After header: respected when present (server hint wins if > computed backoff)
 * - Model tier fallback: fast → balanced → premium when quota exhausted after all retries
 * - Data safety: original error always preserved in AgentOutput.metadata.errors
 */

import type {
  AgentTask, AgentOutput, AgentInput, PoolConfig, ModelTier, AgentStatus
} from './types'
import { getProxyUrl, getProxyKey } from '../settings-service'
import { sanitizeTemperature, getAvailableModels, fetchAvailableModels } from '../llm-client'
import { getAgentOverride } from '../plugin-config'

// =====================
// Model Tier Mapping (dynamic — uses actual proxy models)
// =====================

const TIER_RANGES: Record<ModelTier, { min: number; max: number }> = {
  fast: { min: 1, max: 5 },
  balanced: { min: 5, max: 7 },
  premium: { min: 8, max: 10 }
}

const HARDCODED_FALLBACKS: Record<ModelTier, string> = {
  fast: 'gemini-2.5-flash-lite',
  balanced: 'gemini-2.5-flash',
  premium: 'gpt-5.1'
}

const TIER_FALLBACK_CHAIN: ModelTier[] = ['fast', 'balanced', 'premium']

function resolveModel(tier: ModelTier, override?: string): string {
  if (override) return override

  const available = getAvailableModels()
  const ready = available.filter(m => m.status === 'ready')

  const { min, max } = TIER_RANGES[tier]
  const inRange = ready.filter(m => m.tier >= min && m.tier <= max)
  if (inRange.length > 0) {
    return inRange.sort((a, b) => b.tier - a.tier)[0].id
  }

  if (ready.length > 0) {
    return ready.sort((a, b) => b.tier - a.tier)[0].id
  }

  return HARDCODED_FALLBACKS[tier]
}

function nextTierAfter(tier: ModelTier): ModelTier | null {
  const idx = TIER_FALLBACK_CHAIN.indexOf(tier)
  return idx >= 0 && idx < TIER_FALLBACK_CHAIN.length - 1
    ? TIER_FALLBACK_CHAIN[idx + 1]
    : null
}

// =====================
// Retry / Backoff
// =====================

const MAX_AGENT_RETRIES = 3
const BASE_BACKOFF_MS = 1000   // 1 s
const MAX_BACKOFF_MS = 16000   // 16 s cap
const JITTER_RATIO = 0.3       // ±30 % jitter

/** True for errors we should retry (rate-limit or transient server errors) */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/** True when a 429 body signals quota exhaustion rather than transient throttling */
function isQuotaExhaustedBody(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('exceeded') ||
    lower.includes('resource has been exhausted')
  )
}

/**
 * Compute how long to wait before the next retry.
 * Respects Retry-After header when provided; otherwise exponential + jitter.
 */
function computeBackoffMs(attempt: number, retryAfterHeader?: string | null): number {
  // Server hint (Retry-After in seconds)
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds) && seconds > 0) {
      // Still cap at MAX_BACKOFF_MS to avoid hanging forever
      return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    }
  }

  // Exponential: 1s, 2s, 4s, 8s … capped at 16s
  const exp = BASE_BACKOFF_MS * Math.pow(2, attempt)
  const capped = Math.min(exp, MAX_BACKOFF_MS)
  // ±JITTER_RATIO of base window
  const jitter = capped * JITTER_RATIO * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitter))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =====================
// Message Building
// =====================

function buildAgentMessages(task: AgentTask): Array<{ role: string; content: string }> {
  const { agent, input } = task
  const ctx = input.sharedContext

  let systemContent = agent.systemPrompt

  // Append shared context
  if (ctx.coreMemory) {
    systemContent += '\n\n=== MEMORY ===\n' + ctx.coreMemory
  }

  if (ctx.archivalMemories.length > 0) {
    const archival = ctx.archivalMemories
      .slice(0, 5)
      .map((m, i) => `[${i + 1}] (score: ${m.score.toFixed(2)}) ${m.content}`)
      .join('\n')
    systemContent += '\n\n=== ARCHIVAL MEMORIES ===\n' + archival
  }

  if (ctx.codeChunks.length > 0) {
    const chunks = ctx.codeChunks
      .slice(0, 10)
      .map((c, i) => {
        const header = `--- [${i + 1}] ${c.relativePath} :: ${c.name || ''} (${c.chunkType}, ${c.language}) L${c.lineStart}-${c.lineEnd}`
        return `${header}\n${c.content}`
      })
      .join('\n\n')
    systemContent += '\n\n=== CODE CONTEXT ===\n' + chunks
  }

  if (ctx.directoryTree) {
    systemContent += '\n\n=== DIRECTORY STRUCTURE ===\n' + ctx.directoryTree.slice(0, 2000)
  }

  let userContent = input.query
  if (input.instructions) {
    userContent += '\n\n[Orchestrator Instructions]: ' + input.instructions
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ]
}

// =====================
// Single Agent Execution
// =====================

async function fetchAgentCompletion(
  role: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number | undefined,
  timeoutMs: number
): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    max_tokens: maxTokens
  }
  if (temperature !== undefined) {
    requestBody.temperature = temperature
  }

  let response: Response
  try {
    response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getProxyKey()}`
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Agent '${role}' timed out after ${timeoutMs}ms`)
    }
    throw err
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After')
    const errorText = await response.text()
    const err = new Error(`Agent '${role}' LLM error ${response.status}: ${errorText.slice(0, 400)}`) as Error & {
      httpStatus: number
      retryAfter: string | null
      isQuotaExhausted: boolean
    }
    err.httpStatus = response.status
    err.retryAfter = retryAfter
    err.isQuotaExhausted = response.status === 429 && isQuotaExhaustedBody(errorText)
    throw err
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens: number; completion_tokens: number }
  }

  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage
  }
}

async function executeAgent(task: AgentTask, defaultTimeoutMs: number): Promise<AgentOutput> {
  const startTime = Date.now()
  task.status = 'running'
  task.startedAt = startTime

  const messages = buildAgentMessages(task)
  const timeoutMs = task.agent.config.timeoutMs || defaultTimeoutMs
  const retryErrors: string[] = []

  let currentTier = task.agent.config.modelTier
  const configOverride = getAgentOverride(task.agent.role)?.model
  let model = resolveModel(currentTier, configOverride ?? task.agent.config.modelOverride)

  console.log(`[AgentPool] Starting agent '${task.agent.role}' (model: ${model}, timeout: ${timeoutMs}ms)`)

  for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt++) {
    const temperature = sanitizeTemperature(model, task.agent.config.temperature)

    try {
      const { content, usage } = await fetchAgentCompletion(
        task.agent.role,
        model,
        messages,
        task.agent.config.maxTokens,
        temperature,
        timeoutMs
      )

      const durationMs = Date.now() - startTime
      task.status = 'completed'
      task.completedAt = Date.now()

      if (attempt > 0) {
        console.log(`[AgentPool] Agent '${task.agent.role}' recovered after ${attempt} retries (${durationMs}ms)`)
      } else {
        console.log(`[AgentPool] Agent '${task.agent.role}' completed in ${durationMs}ms (${content.length} chars)`)
      }

      return {
        role: task.agent.role,
        status: 'completed',
        content,
        confidence: 0.8,
        durationMs,
        metadata: {
          model,
          tokensUsed: usage
            ? { input: usage.prompt_tokens, output: usage.completion_tokens }
            : undefined,
          skillsUsed: task.agent.skills,
          errors: retryErrors.length > 0 ? retryErrors : undefined
        }
      }
    } catch (err) {
      const error = err as Error & { httpStatus?: number; retryAfter?: string | null; isQuotaExhausted?: boolean }
      const errMsg = error.message || String(err)
      retryErrors.push(errMsg)

      const status = error.httpStatus ?? 0
      const isRetryable = isRetryableStatus(status) || status === 0

      if (!isRetryable || attempt === MAX_AGENT_RETRIES) {
        if (error.isQuotaExhausted) {
          const fallbackTier = nextTierAfter(currentTier)
          if (fallbackTier && !task.agent.config.modelOverride) {
            currentTier = fallbackTier
            model = resolveModel(currentTier)
            console.warn(`[AgentPool] Agent '${task.agent.role}' quota exhausted on tier '${task.agent.config.modelTier}', falling back to '${currentTier}' (${model})`)
            continue
          }
        }
        throw new Error(errMsg)
      }

      const delayMs = computeBackoffMs(attempt, error.retryAfter)
      console.warn(
        `[AgentPool] Agent '${task.agent.role}' got ${status || 'network'} error (attempt ${attempt + 1}/${MAX_AGENT_RETRIES}), retrying in ${delayMs}ms: ${errMsg.slice(0, 120)}`
      )
      await sleep(delayMs)
    }
  }

  throw new Error(`Agent '${task.agent.role}' exhausted all retries`)
}

// =====================
// Pool Execution
// =====================

export async function executeAgentPool(
  tasks: AgentTask[],
  config: PoolConfig
): Promise<AgentOutput[]> {
  if (tasks.length === 0) return []

  const available = getAvailableModels()
  if (available.length === 0 || available.every(m => m.status !== 'ready')) {
    await fetchAvailableModels()
  }

  console.log(`[AgentPool] Executing ${tasks.length} agents (maxConcurrency: ${config.maxConcurrency})`)
  const startTime = Date.now()

  const concurrency = Math.max(1, config.maxConcurrency)
  const settled: PromiseSettledResult<AgentOutput>[] = []

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map(task => executeAgent(task, config.defaultTimeoutMs))
    )
    settled.push(...batchResults)
  }

  const outputs: AgentOutput[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value
    }

    // Task failed
    const task = tasks[i]
    const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
    console.error(`[AgentPool] Agent '${task.agent.role}' failed: ${errorMsg}`)

    task.status = 'error'
    task.completedAt = Date.now()

    return {
      role: task.agent.role,
      status: 'error' as AgentStatus,
      content: `Agent error: ${errorMsg}`,
      confidence: 0,
      durationMs: Date.now() - (task.startedAt || Date.now()),
      metadata: {
        errors: [errorMsg]
      }
    }
  })

  const succeeded = outputs.filter(o => o.status === 'completed').length
  const totalMs = Date.now() - startTime
  console.log(`[AgentPool] Pool complete: ${succeeded}/${tasks.length} succeeded in ${totalMs}ms`)

  return outputs
}
