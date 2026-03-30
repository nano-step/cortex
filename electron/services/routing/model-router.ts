import type { RoutingDecision, CategoryConfig } from './types'
import { getCategoryOverride } from '../plugin-config'
import { getAvailableModels } from '../llm-client'

export function routeToModel(
  decision: RoutingDecision,
  availableModels: string[]
): { model: string; config: CategoryConfig; fallbackUsed: boolean } {
  const override = getCategoryOverride(decision.category)
  if (override?.model) {
    return { model: override.model, config: decision.config, fallbackUsed: false }
  }

  const liveReadyIds = new Set(
    getAvailableModels()
      .filter(m => m.status === 'ready')
      .map(m => m.id)
  )

  const readyModels = availableModels.length > 0
    ? availableModels.filter(id => liveReadyIds.has(id))
    : Array.from(liveReadyIds)

  if (readyModels.length === 0) {
    return { model: decision.config.defaultModel, config: decision.config, fallbackUsed: false }
  }

  if (readyModels.includes(decision.config.defaultModel)) {
    return { model: decision.config.defaultModel, config: decision.config, fallbackUsed: false }
  }

  for (const fallback of decision.config.fallbackChain) {
    if (readyModels.includes(fallback)) {
      console.log(`[ModelRouter] ${decision.config.defaultModel} not ready, using fallback: ${fallback}`)
      return { model: fallback, config: decision.config, fallbackUsed: true }
    }
  }

  console.log(`[ModelRouter] No preferred model ready for ${decision.category}, using best available: ${readyModels[0]}`)
  return { model: readyModels[0], config: decision.config, fallbackUsed: true }
}
