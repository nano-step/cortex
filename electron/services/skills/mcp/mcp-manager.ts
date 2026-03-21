import { getDb } from '../../db'
import { createMCPClient, type MCPClient, type MCPClientConfig, type MCPTool, type MCPResource } from './mcp-client'
import { createMCPSkillsFromServer } from './mcp-adapter'
import { registerSkill, unregisterSkill } from '../skill-registry'
import { MCP_PRESETS, type MCPPreset } from './mcp-presets'
import { setServiceConfig, getServiceConfig } from '../../settings-service'

export interface MCPServerConfig {
  id: string
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string
  serverUrl?: string
  env?: string
  enabled: boolean
  createdAt: number
}

export interface MCPServerStatus {
  id: string
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string
  serverUrl?: string
  enabled: boolean
  connected: boolean
  toolCount: number
  resourceCount: number
  lastError?: string
  lastChecked: number
}

const clients = new Map<string, MCPClient>()
const serverStatus = new Map<string, { connected: boolean, toolCount: number, resourceCount: number, lastError?: string, lastChecked: number }>()
const serverSkillNames = new Map<string, string[]>()

function initMcpSchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport_type TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT,
      server_url TEXT,
      env TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `)
}

let schemaInitialized = false
function ensureSchema(): void {
  if (schemaInitialized) return
  initMcpSchema()
  schemaInitialized = true
}

interface MCPServerRow {
  id: string
  name: string
  transport_type: string
  command: string | null
  args: string | null
  server_url: string | null
  env: string | null
  enabled: number
  created_at: number
}

function mapRow(row: MCPServerRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    transportType: (row.transport_type || 'stdio') as 'stdio' | 'sse',
    command: row.command || undefined,
    args: row.args || undefined,
    serverUrl: row.server_url || undefined,
    env: row.env || undefined,
    enabled: !!row.enabled,
    createdAt: row.created_at
  }
}

export function listMCPServers(): MCPServerStatus[] {
  ensureSchema()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all() as MCPServerRow[]

  return rows.map(row => {
    const config = mapRow(row)
    const status = serverStatus.get(config.id)
    return {
      id: config.id,
      name: config.name,
      transportType: config.transportType,
      command: config.command,
      args: config.args,
      serverUrl: config.serverUrl,
      enabled: config.enabled,
      connected: status?.connected ?? false,
      toolCount: status?.toolCount ?? 0,
      resourceCount: status?.resourceCount ?? 0,
      lastError: status?.lastError,
      lastChecked: status?.lastChecked ?? 0
    }
  })
}

export function addMCPServer(config: {
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string
  serverUrl?: string
  env?: string
}): MCPServerStatus {
  ensureSchema()
  const db = getDb()
  const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()

  db.prepare('INSERT INTO mcp_servers (id, name, transport_type, command, args, server_url, env, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)').run(
    id, config.name, config.transportType, config.command || null, config.args || null, config.serverUrl || null, config.env || null, now
  )

  return {
    id,
    name: config.name,
    transportType: config.transportType,
    command: config.command,
    args: config.args,
    serverUrl: config.serverUrl,
    enabled: true,
    connected: false,
    toolCount: 0,
    resourceCount: 0,
    lastChecked: 0
  }
}

export function removeMCPServer(serverId: string): boolean {
  ensureSchema()
  const client = clients.get(serverId)
  if (client) {
    client.disconnect().catch(() => {})
    clients.delete(serverId)
  }
  serverStatus.delete(serverId)

  const db = getDb()
  const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId)
  return result.changes > 0
}

export async function connectMCPServer(serverId: string): Promise<{ success: boolean, error?: string }> {
  ensureSchema()
  const db = getDb()
  const raw = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(serverId) as MCPServerRow | undefined
  if (!raw) return { success: false, error: 'Server not found' }
  const row = mapRow(raw)

  const existing = clients.get(serverId)
  if (existing?.isConnected()) {
    return { success: true }
  }

  try {
    if (existing) {
      await existing.disconnect().catch(() => {})
      clients.delete(serverId)
    }

    const clientConfig: MCPClientConfig = {
      transportType: row.transportType,
      command: row.command || undefined,
      args: row.args ? row.args.split(' ').filter(Boolean) : undefined,
      serverUrl: row.serverUrl || undefined,
      env: row.env ? JSON.parse(row.env) : undefined
    }

    const client = createMCPClient(clientConfig)
    await client.connect()
    clients.set(serverId, client)

    let toolCount = 0
    let resourceCount = 0
    try {
      const tools = await client.listTools()
      toolCount = tools.length
    } catch { /* some servers don't support tools/list */ }
    try {
      const resources = await client.listResources()
      resourceCount = resources.length
    } catch { /* some servers don't support resources/list */ }

    serverStatus.set(serverId, { connected: true, toolCount, resourceCount, lastChecked: Date.now() })

    try {
      const skills = await createMCPSkillsFromServer(client)
      const names: string[] = []
      for (const skill of skills) {
        const ok = await registerSkill(skill)
        if (ok) names.push(skill.name)
      }
      serverSkillNames.set(serverId, names)
      console.log(`[MCPManager] Registered ${names.length} skills from ${row.name}`)
    } catch (skillErr) {
      console.warn(`[MCPManager] Failed to register skills from ${row.name}:`, skillErr)
    }

    return { success: true }
  } catch (err) {
    const errorMsg = String(err instanceof Error ? err.message : err)
    serverStatus.set(serverId, { connected: false, toolCount: 0, resourceCount: 0, lastError: errorMsg, lastChecked: Date.now() })
    return { success: false, error: errorMsg }
  }
}

export async function disconnectMCPServer(serverId: string): Promise<boolean> {
  const client = clients.get(serverId)
  if (!client) return false

  const skillNames = serverSkillNames.get(serverId) || []
  for (const name of skillNames) {
    await unregisterSkill(name).catch(() => {})
  }
  serverSkillNames.delete(serverId)

  try {
    await client.disconnect()
  } catch { /* ignore disconnect errors */ }

  clients.delete(serverId)
  const existing = serverStatus.get(serverId)
  serverStatus.set(serverId, {
    connected: false,
    toolCount: existing?.toolCount ?? 0,
    resourceCount: existing?.resourceCount ?? 0,
    lastChecked: Date.now()
  })
  return true
}

export async function checkMCPServerHealth(serverId: string): Promise<{ connected: boolean, toolCount: number, resourceCount: number, error?: string }> {
  const client = clients.get(serverId)
  if (!client || !client.isConnected()) {
    return { connected: false, toolCount: 0, resourceCount: 0, error: 'Not connected' }
  }

  try {
    let toolCount = 0
    let resourceCount = 0
    try { toolCount = (await client.listTools()).length } catch {}
    try { resourceCount = (await client.listResources()).length } catch {}

    serverStatus.set(serverId, { connected: true, toolCount, resourceCount, lastChecked: Date.now() })
    return { connected: true, toolCount, resourceCount }
  } catch (err) {
    const errorMsg = String(err instanceof Error ? err.message : err)
    serverStatus.set(serverId, { connected: false, toolCount: 0, resourceCount: 0, lastError: errorMsg, lastChecked: Date.now() })
    return { connected: false, toolCount: 0, resourceCount: 0, error: errorMsg }
  }
}

export function getMCPClient(serverId: string): MCPClient | undefined {
  return clients.get(serverId)
}

export async function getServerTools(serverId: string): Promise<MCPTool[]> {
  const client = clients.get(serverId)
  if (!client?.isConnected()) return []
  try { return await client.listTools() } catch { return [] }
}

export async function getServerResources(serverId: string): Promise<MCPResource[]> {
  const client = clients.get(serverId)
  if (!client?.isConnected()) return []
  try { return await client.listResources() } catch { return [] }
}

export async function callToolByServerName(
  serverNamePattern: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown | null> {
  ensureSchema()
  const db = getDb()
  const rows = db.prepare(
    'SELECT id FROM mcp_servers WHERE LOWER(name) LIKE ? AND enabled = 1'
  ).all(`%${serverNamePattern.toLowerCase()}%`) as Array<{ id: string }>

  for (const row of rows) {
    const client = clients.get(row.id)
    if (!client?.isConnected()) continue
    try {
      return await client.callTool(toolName, args)
    } catch (err) {
      console.warn(`[MCPManager] callTool ${toolName} failed on ${row.id}:`, err)
    }
  }
  return null
}

interface CoreMCPServer {
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string
  serverUrl?: string
}

const CORE_MCP_SERVERS: CoreMCPServer[] = [
  {
    name: 'Jina AI Reader',
    transportType: 'sse',
    serverUrl: 'https://mcp.jina.ai/v1',
  },
]

export function ensureCoreMCPServers(): void {
  ensureSchema()
  const db = getDb()

  for (const core of CORE_MCP_SERVERS) {
    const existing = db.prepare(
      'SELECT id FROM mcp_servers WHERE LOWER(name) = ?'
    ).get(core.name.toLowerCase()) as { id: string } | undefined

    if (existing) continue

    const id = `mcp_core_${core.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    const now = Date.now()
    db.prepare(
      'INSERT INTO mcp_servers (id, name, transport_type, command, args, server_url, env, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(id, core.name, core.transportType, core.command || null, core.args || null, core.serverUrl || null, null, now)

    console.log(`[MCPManager] Registered core MCP server: ${core.name}`)
  }
}

export async function autoConnectMCPServers(): Promise<number> {
  ensureSchema()
  const db = getDb()
  const rows = db.prepare('SELECT id, name FROM mcp_servers WHERE enabled = 1').all() as Array<{ id: string, name: string }>
  let connected = 0

  for (const row of rows) {
    try {
      const result = await connectMCPServer(row.id)
      if (result.success) {
        connected++
        console.log(`[MCPManager] Auto-connected: ${row.name}`)
      } else {
        console.warn(`[MCPManager] Auto-connect failed for ${row.name}: ${result.error}`)
      }
    } catch (err) {
      console.warn(`[MCPManager] Auto-connect error for ${row.name}:`, err)
    }
  }

  console.log(`[MCPManager] Auto-connected ${connected}/${rows.length} servers`)
  return connected
}

export interface MCPToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

/** Returns OpenAI-compatible tool definitions from all connected MCP servers. Names are prefixed: `{serverName}_{toolName}` */
export async function getToolDefinitions(): Promise<MCPToolDefinition[]> {
  ensureSchema()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as MCPServerRow[]
  const definitions: MCPToolDefinition[] = []

  for (const raw of rows) {
    const config = mapRow(raw)
    const client = clients.get(config.id)
    if (!client?.isConnected()) continue

    try {
      const tools = await client.listTools()
      const serverPrefix = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

      for (const tool of tools) {
        const inputSchema = (tool.inputSchema || {}) as {
          properties?: Record<string, unknown>
          required?: string[]
        }

        definitions.push({
          type: 'function',
          function: {
            name: `${serverPrefix}_${tool.name}`,
            description: tool.description || `MCP tool: ${tool.name}`,
            parameters: {
              type: 'object',
              properties: inputSchema.properties || {},
              required: inputSchema.required || []
            }
          }
        })
      }
    } catch (err) {
      console.warn(`[MCPManager] Failed to list tools from ${config.name}:`, err)
    }
  }

  return definitions
}

/** Execute MCP tool by prefixed name (e.g. `github_get_issue`). argsJson is the raw JSON string from LLM tool_calls. */
export async function executeMCPTool(
  prefixedToolName: string,
  argsJson: string
): Promise<{ content: string; isError: boolean }> {
  ensureSchema()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as MCPServerRow[]

  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: `Error parsing tool arguments: invalid JSON`, isError: true }
  }

  for (const raw of rows) {
    const config = mapRow(raw)
    const client = clients.get(config.id)
    if (!client?.isConnected()) continue

    const serverPrefix = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const expectedPrefix = `${serverPrefix}_`

    if (!prefixedToolName.startsWith(expectedPrefix)) continue

    const originalToolName = prefixedToolName.slice(expectedPrefix.length)

    try {
      console.log(`[MCPManager] Executing tool: ${originalToolName} on server ${config.name}`)
      const result = await client.callTool(originalToolName, args)

      const content = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2)

      return { content, isError: false }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[MCPManager] Tool execution failed: ${originalToolName} on ${config.name}:`, errorMsg)
      return { content: `Tool execution failed: ${errorMsg}`, isError: true }
    }
  }

  return { content: `Tool not found: ${prefixedToolName}`, isError: true }
}

export function isPresetInstalled(presetId: string): boolean {
  ensureSchema()
  const db = getDb()
  const preset = MCP_PRESETS.find(p => p.id === presetId)
  if (!preset) return false
  const row = db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(preset.name)
  return !!row
}

export function getPresetStatuses(): Array<MCPPreset & { installed: boolean; configured: boolean; connected: boolean }> {
  ensureSchema()
  const db = getDb()
  const servers = db.prepare('SELECT * FROM mcp_servers').all() as MCPServerRow[]
  const serversByName = new Map(servers.map(s => [s.name, mapRow(s)]))

  return MCP_PRESETS.map(preset => {
    const server = serversByName.get(preset.name)
    const installed = !!server
    const status = server ? serverStatus.get(server.id) : undefined
    const hasRequiredEnv = preset.envVars.filter(v => v.required).every(v => {
      const config = getServiceConfig(`mcp:${preset.id}`)
      return config && config[v.name]
    })
    return {
      ...preset,
      installed,
      configured: installed && (preset.envVars.length === 0 || hasRequiredEnv),
      connected: !!(status?.connected)
    }
  })
}

export async function installPreset(
  presetId: string,
  envValues: Record<string, string>
): Promise<MCPServerStatus> {
  const preset = MCP_PRESETS.find(p => p.id === presetId)
  if (!preset) throw new Error(`Preset not found: ${presetId}`)

  const encryptKeys = preset.envVars.filter(v => v.encrypted).map(v => v.name)
  if (Object.keys(envValues).length > 0) {
    setServiceConfig(`mcp:${preset.id}`, envValues, encryptKeys)
  }

  const envObj: Record<string, string> = {}
  const storedConfig = getServiceConfig(`mcp:${preset.id}`)
  if (storedConfig) {
    for (const [key, value] of Object.entries(storedConfig)) {
      envObj[key] = value
    }
  }

  let args = [...preset.args]
  if (preset.id === 'filesystem' && envValues['ALLOWED_PATHS']) {
    args = [...args, ...envValues['ALLOWED_PATHS'].split(',').map(p => p.trim())]
  }

  const server = addMCPServer({
    name: preset.name,
    transportType: preset.transport,
    command: preset.transport === 'stdio' ? preset.command : undefined,
    args: preset.transport === 'stdio' ? args.join(' ') : undefined,
    serverUrl: preset.serverUrl || undefined,
    env: Object.keys(envObj).length > 0 ? JSON.stringify(envObj) : undefined
  })

  try {
    await connectMCPServer(server.id)
  } catch (err) {
    console.warn(`[MCPManager] Auto-connect failed for preset ${preset.name}:`, err)
  }

  const statuses = listMCPServers()
  return statuses.find(s => s.id === server.id) || server
}

export async function shutdownAllMCP(): Promise<void> {
  const entries = Array.from(clients.entries())
  for (const [id, client] of entries) {
    const skillNames = serverSkillNames.get(id) || []
    for (const name of skillNames) {
      await unregisterSkill(name).catch(() => {})
    }
    try { await client.disconnect() } catch {}
    clients.delete(id)
  }
  serverSkillNames.clear()
  serverStatus.clear()
}
