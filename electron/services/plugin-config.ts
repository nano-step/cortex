/**
 * Plugin Config Loader — OmO-compatible JSONC configuration
 *
 * Config locations (priority order):
 * 1. .cortex/cortex-config.jsonc (project-level)
 * 2. .cortex/cortex-config.json (project-level)
 * 3. ~/.config/cortex/config.jsonc (user-level)
 * 4. ~/.config/cortex/config.json (user-level)
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface AgentOverride {
  model?: string
  variant?: string
  temperature?: number
  maxTokens?: number
  disabled?: boolean
  prompt_append?: string
}

export interface CategoryOverride {
  model?: string
  variant?: string
  temperature?: number
  maxTokens?: number
}

export interface CortexPluginConfig {
  agents?: Record<string, AgentOverride>
  categories?: Record<string, CategoryOverride>
  disabled_hooks?: string[]
  background?: {
    defaultConcurrency?: number
    providerConcurrency?: Record<string, number>
    modelConcurrency?: Record<string, number>
    staleTimeoutMs?: number
  }
  experimental?: {
    aggressive_truncation?: boolean
    auto_resume?: boolean
    preemptive_compaction?: boolean
  }
}

const CONFIG_FILENAMES = ['cortex-config.jsonc', 'cortex-config.json']

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([\]}])/g, '$1')
}

function tryLoadFile(filePath: string): CortexPluginConfig | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const cleaned = filePath.endsWith('.jsonc') ? stripJsonComments(raw) : raw
    return JSON.parse(cleaned) as CortexPluginConfig
  } catch (err) {
    console.warn(`[PluginConfig] Failed to parse ${filePath}:`, (err as Error).message)
    return null
  }
}

let cachedConfig: CortexPluginConfig | null = null
let cachedConfigPath: string | null = null

export function loadPluginConfig(projectDir?: string): CortexPluginConfig {
  if (cachedConfig) return cachedConfig

  // Project-level config
  if (projectDir) {
    for (const name of CONFIG_FILENAMES) {
      const path = join(projectDir, '.cortex', name)
      const config = tryLoadFile(path)
      if (config) {
        console.log(`[PluginConfig] Loaded project config: ${path}`)
        cachedConfig = config
        cachedConfigPath = path
        return config
      }
    }
  }

  // User-level config
  const userDir = join(homedir(), '.config', 'cortex')
  for (const name of ['config.jsonc', 'config.json']) {
    const path = join(userDir, name)
    const config = tryLoadFile(path)
    if (config) {
      console.log(`[PluginConfig] Loaded user config: ${path}`)
      cachedConfig = config
      cachedConfigPath = path
      return config
    }
  }

  console.log('[PluginConfig] No config file found, using defaults')
  cachedConfig = {}
  cachedConfigPath = null
  return {}
}

export function getPluginConfig(): CortexPluginConfig {
  return cachedConfig || loadPluginConfig()
}

export function getConfigPath(): string | null {
  return cachedConfigPath
}

export function reloadPluginConfig(projectDir?: string): CortexPluginConfig {
  cachedConfig = null
  cachedConfigPath = null
  return loadPluginConfig(projectDir)
}

export function getAgentOverride(agentName: string): AgentOverride | undefined {
  const config = getPluginConfig()
  return config.agents?.[agentName]
}

export function getCategoryOverride(category: string): CategoryOverride | undefined {
  const config = getPluginConfig()
  return config.categories?.[category]
}

export function isHookDisabled(hookName: string): boolean {
  const config = getPluginConfig()
  return config.disabled_hooks?.includes(hookName) ?? false
}
