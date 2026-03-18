/**
 * OpenRouter Fallback Provider — Free models as backup when proxy models fail
 *
 * OpenRouter provides free-tier models that can serve as fallback inference
 * when all proxy models are exhausted (quota/auth errors). Uses OpenAI-compatible
 * API format so it integrates seamlessly with existing streamChatCompletion.
 */

import { getSetting, setSetting } from '../../settings-service'

export interface OpenRouterModel {
  id: string
  role: 'classifier' | 'coder' | 'reasoning' | 'general'
  contextWindow: number
  supportsTools: boolean
}

const FREE_MODELS: OpenRouterModel[] = [
  { id: 'stepfun/step-3.5-flash:free', role: 'classifier', contextWindow: 256000, supportsTools: true },
  { id: 'qwen/qwen3-coder:free', role: 'coder', contextWindow: 262000, supportsTools: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', role: 'reasoning', contextWindow: 262000, supportsTools: true },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', role: 'general', contextWindow: 262000, supportsTools: true },
  { id: 'openai/gpt-oss-120b:free', role: 'general', contextWindow: 131000, supportsTools: true },
  { id: 'google/gemma-3-27b-it:free', role: 'general', contextWindow: 131000, supportsTools: true },
]

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export function getOpenRouterApiKey(): string {
  return getSetting('openrouter_api_key') || ''
}

export function setOpenRouterApiKey(key: string): void {
  setSetting('openrouter_api_key', key)
}

export function isOpenRouterConfigured(): boolean {
  return getOpenRouterApiKey().length > 0
}

export function getOpenRouterEnabled(): boolean {
  return getSetting('openrouter_enabled') !== 'false' && isOpenRouterConfigured()
}

export function setOpenRouterEnabled(enabled: boolean): void {
  setSetting('openrouter_enabled', enabled ? 'true' : 'false')
}

export function getFreeModels(): OpenRouterModel[] {
  return FREE_MODELS
}

export function getBestFreeModel(role: OpenRouterModel['role'] = 'general'): OpenRouterModel {
  return FREE_MODELS.find(m => m.role === role) || FREE_MODELS[0]
}

export function getOpenRouterBaseUrl(): string {
  return OPENROUTER_BASE_URL
}

export function getOpenRouterHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getOpenRouterApiKey()}`,
    'HTTP-Referer': 'https://cortex.hoainho.info',
    'X-Title': 'Cortex AI'
  }
}

export async function testOpenRouterConnection(): Promise<{ ok: boolean; model?: string; error?: string }> {
  if (!isOpenRouterConfigured()) {
    return { ok: false, error: 'API key not configured' }
  }

  const model = getBestFreeModel('classifier')
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: getOpenRouterHeaders(),
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        max_tokens: 5,
        stream: false
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    }

    return { ok: true, model: model.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
