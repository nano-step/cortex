/**
 * Settings Service — Manages app configuration with secure storage
 *
 * Uses SQLite for general settings and Electron safeStorage for secrets.
 * Replaces hardcoded proxy credentials with user-configurable values.
 */

import { safeStorage } from 'electron'
import { getDb } from './db'

const DEFAULT_PROXY_URL = 'http://localhost:3456'
const DEFAULT_PROXY_KEY = 'hoainho'

export function initSettingsTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `)
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db
    .prepare('SELECT value, encrypted FROM settings WHERE key = ?')
    .get(key) as { value: string; encrypted: number } | undefined
  if (!row) return null

  if (row.encrypted) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
      } catch (err) {
        console.warn(`[Settings] Failed to decrypt '${key}', safeStorage key may have changed:`, (err as Error).message)
        return null
      }
    }
    console.warn(`[Settings] safeStorage not available, cannot decrypt '${key}'`)
    return null
  }
  return row.value
}

export function setSetting(key: string, value: string, encrypted: boolean = false): void {
  const db = getDb()
  let storedValue = value
  let actuallyEncrypted = false

  if (encrypted && safeStorage.isEncryptionAvailable()) {
    storedValue = safeStorage.encryptString(value).toString('base64')
    actuallyEncrypted = true
  }

  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)'
  ).run(key, storedValue, actuallyEncrypted ? 1 : 0, Date.now())
}

export function getProxyUrl(): string {
  return getSetting('proxy_url') || DEFAULT_PROXY_URL
}

export function getProxyKey(): string {
  return getSetting('proxy_key') || DEFAULT_PROXY_KEY
}

export function setProxyConfig(url: string, key: string): void {
  setSetting('proxy_url', url, false)
  setSetting('proxy_key', key, true)
}

export function getProxyConfig(): { url: string; key: string } {
  return {
    url: getProxyUrl(),
    key: getProxyKey()
  }
}

export function getLLMConfig(): { maxTokens: number; contextMessages: number } {
  return {
    maxTokens: Number(getSetting('llm_max_tokens')) || 8192,
    contextMessages: Number(getSetting('llm_context_messages')) || 20
  }
}

export function setLLMConfig(maxTokens: number, contextMessages: number): void {
  setSetting('llm_max_tokens', String(maxTokens), false)
  setSetting('llm_context_messages', String(contextMessages), false)
}

export function getGitConfig(): { cloneDepth: number } {
  return {
    cloneDepth: Number(getSetting('git_clone_depth')) || 1
  }
}

export function setGitConfig(cloneDepth: number): void {
  setSetting('git_clone_depth', String(cloneDepth), false)
}

export function getAllSettings(): Record<string, string> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value, encrypted FROM settings').all() as Array<{
    key: string
    value: string
    encrypted: number
  }>
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        result[row.key] = safeStorage.decryptString(Buffer.from(row.value, 'base64'))
      } catch {
        result[row.key] = '***'
      }
    } else {
      result[row.key] = row.value
    }
  }
  return result
}

export async function testProxyConnection(url: string, key: string): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
  const start = Date.now()
  try {
    const response = await fetch(`${url}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(10000)
    })
    const latencyMs = Date.now() - start
    if (response.ok) {
      return { success: true, latencyMs }
    }
    return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, latencyMs }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Lỗi kết nối' }
  }
}

// ============================
// Atlassian Configuration
// ============================

export interface AtlassianConfig {
  siteUrl: string
  email: string
  apiToken: string
}

export function getAtlassianConfig(): AtlassianConfig | null {
  const siteUrl = getSetting('atlassian_site_url')
  const email = getSetting('atlassian_email')
  const apiToken = getSetting('atlassian_api_token')

  if (!siteUrl || !email || !apiToken) return null

  return { siteUrl, email, apiToken }
}

export function setAtlassianConfig(siteUrl: string, email: string, apiToken: string): void {
  setSetting('atlassian_site_url', siteUrl, false)
  setSetting('atlassian_email', email, false)
  setSetting('atlassian_api_token', apiToken, true) // encrypt the token
}

export function clearAtlassianConfig(): void {
  const db = getDb()
  db.prepare("DELETE FROM settings WHERE key IN ('atlassian_site_url', 'atlassian_email', 'atlassian_api_token')").run()
}

// ============================
// Generic Service Credentials Store
// ============================

export function getServiceConfig(service: string): Record<string, string> | null {
  const prefix = `svc:${service}:`
  const db = getDb()
  const rows = db.prepare('SELECT key, value, encrypted FROM settings WHERE key LIKE ?').all(`${prefix}%`) as Array<{
    key: string; value: string; encrypted: number
  }>
  if (rows.length === 0) return null

  const config: Record<string, string> = {}
  for (const row of rows) {
    const field = row.key.slice(prefix.length)
    if (row.encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        config[field] = safeStorage.decryptString(Buffer.from(row.value, 'base64'))
      } catch {
        config[field] = ''
      }
    } else {
      config[field] = row.value
    }
  }
  return config
}

export function setServiceConfig(service: string, config: Record<string, string>, encryptKeys?: string[]): void {
  const prefix = `svc:${service}:`
  for (const [field, value] of Object.entries(config)) {
    const shouldEncrypt = encryptKeys?.includes(field) ?? false
    setSetting(`${prefix}${field}`, value, shouldEncrypt)
  }
}

export function clearServiceConfig(service: string): void {
  const db = getDb()
  db.prepare('DELETE FROM settings WHERE key LIKE ?').run(`svc:${service}:%`)
}

// ============================
// GitHub Configuration
// ============================

export function getGitHubPAT(): string | null {
  return getServiceConfig('github')?.token || null
}

export function setGitHubPAT(token: string): void {
  setServiceConfig('github', { token }, ['token'])
}

// ============================
// Web Search Configuration
// ============================

export function getWebSearchConfig(): { enabled: boolean } {
  return {
    enabled: getSetting('websearch_enabled') !== 'false'
  }
}

export interface QdrantConfig {
  url: string
  apiKey: string
}

export function getQdrantConfig(): QdrantConfig | null {
  const url = getSetting('qdrant_url')
  if (!url) return null
  return { url, apiKey: getSetting('qdrant_api_key') || '' }
}

export function setQdrantConfig(url: string, apiKey: string): void {
  setSetting('qdrant_url', url, false)
  setSetting('qdrant_api_key', apiKey, true)
}

export function getJinaApiKey(): string | null {
  return getSetting('jina_api_key')
}

export function setJinaApiKey(key: string): void {
  setSetting('jina_api_key', key, true)
}

export function getVoyageApiKey(): string | null {
  return getSetting('voyage_api_key')
}

export function setVoyageApiKey(key: string): void {
  setSetting('voyage_api_key', key, true)
}

export function getEmbeddingProvider(): 'voyage' | 'jina' | 'proxy' {
  if (getVoyageApiKey()) return 'voyage'
  if (getJinaApiKey()) return 'jina'
  return 'proxy'
}

