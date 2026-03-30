import type { RoutingDecision, CategoryConfig } from './types'
import { getCategoryOverride } from '../plugin-config'

export function routeToModel(
  decision: RoutingDecision,
  availableModels: string[]
): { model: string; config: CategoryConfig; fallbackUsed: boolean } {
  const override = getCategoryOverride(decision.category)
  if (override?.model) {
    return { model: override.model, config: decision.config, fallbackUsed: false }
  }

  if (availableModels.length === 0) {
    return { model: decision.config.defaultModel, config: decision.config, fallbackUsed: false }
  }

  if (availableModels.includes(decision.config.defaultModel)) {
    return { model: decision.config.defaultModel, config: decision.config, fallbackUsed: false }
  }

  for (const fallback of decision.config.fallbackChain) {
    if (availableModels.includes(fallback)) {
      return { model: fallback, config: decision.config, fallbackUsed: true }
    }
  }

  return { model: availableModels[0], config: decision.config, fallbackUsed: true }
}
