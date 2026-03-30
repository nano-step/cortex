import type { HookDefinition, HookContext, HookResult } from '../types'
import { getAvailableModels } from '../../llm-client'

export const modelFallbackHook: HookDefinition = {
  id: 'model-fallback',
  name: 'Model Fallback',
  description: 'Suggests next model in fallback chain on error',
  trigger: 'on:error',
  priority: 'high',
  enabled: true,
  handler(context: HookContext): HookResult {
    if (!context.error || !context.model) return {}

    const readyModels = getAvailableModels()
      .filter(m => m.status === 'ready' && m.id !== context.model)
      .sort((a, b) => b.tier - a.tier)

    const explicitChain = context.metadata?.fallbackChain as string[] | undefined
    const nextModel = explicitChain
      ? explicitChain.find(id => readyModels.some(m => m.id === id))
      : readyModels[0]?.id

    if (nextModel) {
      return {
        modified: true,
        data: {
          model: nextModel,
          metadata: {
            ...context.metadata,
            fallbackFrom: context.model,
            fallbackTo: nextModel,
            fallbackReason: context.error.message
          }
        },
        message: `Model fallback: ${context.model} → ${nextModel}`
      }
    }
    return { message: 'No fallback model available' }
  }
}
