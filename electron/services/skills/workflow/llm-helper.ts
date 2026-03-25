import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getActiveModel } from '../../llm-client'

const MAX_RETRIES = 3
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503])

export async function callWorkflowLLM(
  messages: Array<{ role: string; content: string }>,
  options?: { maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number }
): Promise<string> {
  const { maxTokens = 2048, temperature = 0.3, model, timeoutMs = 60000 } = options || {}
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
        body: JSON.stringify({
          model: model || getActiveModel(),
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })

      if (RETRYABLE_STATUSES.has(response.status)) {
        console.warn(`[WorkflowLLM] Attempt ${attempt + 1}/${MAX_RETRIES}: HTTP ${response.status}, retrying...`)
        lastError = new Error(`LLM error: ${response.status}`)
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }

      if (!response.ok) throw new Error(`LLM error: ${response.status}`)

      const data = await response.json() as { choices: Array<{ message: { content: string } }> }
      return data.choices?.[0]?.message?.content || ''
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES - 1) {
        const isTimeout = lastError.message.includes('timeout') || lastError.message.includes('aborted')
        if (isTimeout || lastError.message.includes('502') || lastError.message.includes('503') || lastError.message.includes('429')) {
          console.warn(`[WorkflowLLM] Attempt ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}, retrying...`)
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
      }
      throw lastError
    }
  }

  throw lastError || new Error('All retry attempts failed')
}
