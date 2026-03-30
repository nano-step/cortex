export type { HookTrigger, HookPriority, HookContext, HookResult, HookDefinition, HookStats } from './types'
export { registerHook, unregisterHook, getHooksByTrigger, listHooks, enableHook, disableHook, getHookStats, updateHookStats, resetRegistry } from './hook-registry'
export { runHooks } from './hook-runner'
export type { HookPipelineResult } from './hook-runner'

import { registerHook } from './hook-registry'
import { errorRecoveryHook } from './implementations/error-recovery'
import { contextWindowMonitorHook } from './implementations/context-window-monitor'
import { modelFallbackHook } from './implementations/model-fallback'
import { promptSanitizerHook } from './implementations/prompt-sanitizer'
import { responseValidatorHook } from './implementations/response-validator'
import { costGuardHook } from './implementations/cost-guard'
import { thinkingStepEmitterHook } from './implementations/thinking-step-emitter'
import { memorySaverHook } from './implementations/memory-saver'
import { cacheCheckHook } from './implementations/cache-check'
import { auditLoggerHook } from './implementations/audit-logger'
import { sessionStartHook, sessionEndHook, sessionTrackingHook } from './implementations/session-lifecycle'

export function registerDefaultHooks(): void {
  registerHook(errorRecoveryHook)
  registerHook(contextWindowMonitorHook)
  registerHook(modelFallbackHook)
  registerHook(promptSanitizerHook)
  registerHook(responseValidatorHook)
  registerHook(costGuardHook)
  registerHook(thinkingStepEmitterHook)
  registerHook(memorySaverHook)
  registerHook(cacheCheckHook)
  registerHook(auditLoggerHook)
  registerHook(sessionStartHook)
  registerHook(sessionEndHook)
  registerHook(sessionTrackingHook)
}
