import { enableHook, disableHook, listHooks } from '../hooks/hook-registry'

export type HookProfile = 'minimal' | 'standard' | 'strict'

const PROFILE_CONFIGS: Record<HookProfile, { enabled: string[]; disabled: string[] }> = {
  minimal: {
    enabled: ['session-lifecycle:start', 'prompt-sanitizer', 'model-fallback'],
    disabled: [
      'context-window-monitor', 'memory-saver', 'cost-guard',
      'response-validator', 'session-lifecycle:end', 'session-lifecycle:track',
      'cache-check', 'audit-logger', 'thinking-step-emitter', 'error-recovery'
    ]
  },
  standard: {
    enabled: [
      'session-lifecycle:start', 'session-lifecycle:end', 'session-lifecycle:track',
      'prompt-sanitizer', 'context-window-monitor', 'memory-saver',
      'model-fallback', 'error-recovery', 'thinking-step-emitter'
    ],
    disabled: ['cost-guard', 'audit-logger', 'cache-check', 'response-validator']
  },
  strict: {
    enabled: [
      'session-lifecycle:start', 'session-lifecycle:end', 'session-lifecycle:track',
      'prompt-sanitizer', 'context-window-monitor', 'memory-saver',
      'model-fallback', 'error-recovery', 'thinking-step-emitter',
      'cost-guard', 'audit-logger', 'cache-check', 'response-validator'
    ],
    disabled: []
  }
}

let activeProfile: HookProfile = 'standard'

export function setHookProfile(profile: HookProfile): { enabled: number; disabled: number } {
  const config = PROFILE_CONFIGS[profile]
  if (!config) throw new Error(`Unknown profile: ${profile}`)

  let enabled = 0
  let disabled = 0

  for (const id of config.enabled) {
    if (enableHook(id)) enabled++
  }
  for (const id of config.disabled) {
    if (disableHook(id)) disabled++
  }

  activeProfile = profile
  console.log(`[HookProfiles] Applied "${profile}" profile: ${enabled} enabled, ${disabled} disabled`)
  return { enabled, disabled }
}

export function getActiveProfile(): HookProfile {
  return activeProfile
}

export function getProfileInfo(profile?: HookProfile): {
  profile: HookProfile
  enabledHooks: string[]
  disabledHooks: string[]
} {
  const p = profile || activeProfile
  const config = PROFILE_CONFIGS[p]
  return { profile: p, enabledHooks: config.enabled, disabledHooks: config.disabled }
}

export function getAllProfiles(): HookProfile[] {
  return ['minimal', 'standard', 'strict']
}
