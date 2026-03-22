/**
 * MCP Adapter — Wraps MCP server tools as CortexSkill instances
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import type { MCPClient, MCPTool } from './mcp-client'

export function createMCPSkill(client: MCPClient, tool: MCPTool): CortexSkill {
  let metrics: SkillMetrics = {
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    lastUsed: null
  }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  // Extract keywords from tool description for canHandle
  const descWords = (tool.description || '').toLowerCase().split(/\W+/).filter(w => w.length > 3)

  return {
    name: `mcp-${tool.name}`,
    version: '4.0.0',
    category: 'tool',
    priority: 'p1',
    description: tool.description || `MCP tool: ${tool.name}`,
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {
      if (!client.isConnected()) {
        await client.connect()
      }
    },

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      // Match if query contains keywords from tool description
      return descWords.some(w => lower.includes(w)) || lower.includes(tool.name)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const args = extractArgs(input.query, tool.inputSchema)
        const result = await client.callTool(tool.name, args)

        const content = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2)

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: { tool: tool.name, args }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},

    async healthCheck(): Promise<HealthStatus> {
      return {
        healthy: client.isConnected(),
        message: client.isConnected() ? 'Connected' : 'Disconnected',
        lastCheck: Date.now()
      }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}

export async function createMCPSkillsFromServer(client: MCPClient): Promise<CortexSkill[]> {
  try {
    const tools = await client.listTools()
    return tools.map(tool => createMCPSkill(client, tool))
  } catch (err) {
    console.error('[MCPAdapter] Failed to create skills from server:', err)
    return []
  }
}

function extractArgs(
  query: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  // Simple arg extraction based on schema properties
  const args: Record<string, unknown> = {}
  const properties = (schema as { properties?: Record<string, { type: string }> }).properties || {}

  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'string') {
      // Pass the full query as the first string param
      if (Object.keys(args).length === 0) {
        args[key] = query
      }
    }
  }

  return args
}