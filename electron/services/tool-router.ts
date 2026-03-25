import { getProxyUrl, getProxyKey } from './settings-service'

function sanitizeTemperature(model: string, temperature: number | undefined): number | undefined {
  return /gpt-5/i.test(model) ? undefined : temperature
}
import type { MCPToolDefinition } from './skills/mcp/mcp-manager'

type ToolDefinition = MCPToolDefinition

interface ToolCategory {
  id: string
  pattern: RegExp
  tools: ToolDefinition[]
}

const FAST_MODEL = 'gemini-2.5-flash-lite'
const ROUTER_TIMEOUT = 8000
const MAX_TOOLS = 50

export async function routeTools(
  query: string,
  coreTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<ToolDefinition[]> {
  if (mcpTools.length === 0) return coreTools

  const categories = groupByCategory(mcpTools)
  if (categories.length === 0) return coreTools

  const categoryNames = categories.map(c => c.id)
  const selected = await selectCategories(query, categoryNames, conversationHistory)

  if (selected.length === 0) {
    console.log(`[ToolRouter] No MCP categories selected, using core tools only (${coreTools.length})`)
    return coreTools
  }

  const selectedTools: ToolDefinition[] = [...coreTools]
  const selectedSet = new Set(coreTools.map(t => t.function.name))

  for (const catId of selected) {
    const cat = categories.find(c => c.id === catId)
    if (!cat) continue
    for (const tool of cat.tools) {
      if (!selectedSet.has(tool.function.name) && selectedTools.length < MAX_TOOLS) {
        selectedTools.push(tool)
        selectedSet.add(tool.function.name)
      }
    }
  }

  console.log(`[ToolRouter] Selected ${selected.length} categories: [${selected.join(', ')}] → ${selectedTools.length} tools (from ${coreTools.length + mcpTools.length} total)`)
  return selectedTools
}

function groupByCategory(tools: ToolDefinition[]): ToolCategory[] {
  const prefixMap = new Map<string, ToolDefinition[]>()

  for (const tool of tools) {
    const name = tool.function.name
    const prefix = name.includes('_') ? name.split('_').slice(0, -1).join('_') : name
    const group = prefixMap.get(prefix) || []
    group.push(tool)
    prefixMap.set(prefix, group)
  }

  const merged = new Map<string, ToolDefinition[]>()
  for (const [prefix, groupTools] of prefixMap) {
    const catId = deriveCategoryId(prefix)
    const existing = merged.get(catId) || []
    existing.push(...groupTools)
    merged.set(catId, existing)
  }

  return Array.from(merged.entries()).map(([id, tools]) => ({
    id,
    pattern: new RegExp(id, 'i'),
    tools
  }))
}

function deriveCategoryId(prefix: string): string {
  const p = prefix.toLowerCase()
  if (p.includes('github')) return 'github'
  if (p.includes('playwright') || p.includes('browser')) return 'browser'
  if (p.includes('slack')) return 'slack'
  if (p.includes('figma')) return 'figma'
  if (p.includes('memory')) return 'memory'
  if (p.includes('filesystem')) return 'filesystem'
  if (p.includes('jina') || p.includes('reader')) return 'research'
  if (p.includes('sequential')) return 'reasoning'
  return prefix
}

async function selectCategories(
  query: string,
  categories: string[],
  history?: Array<{ role: string; content: string }>
): Promise<string[]> {
  const contextMessages = history?.slice(-4).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join('\n') || ''

  const prompt = `Given this user query and available tool categories, return ONLY the category names that are relevant. Return as JSON array of strings.

Available categories: ${JSON.stringify(categories)}

${contextMessages ? `Recent conversation:\n${contextMessages}\n` : ''}User query: "${query.slice(0, 500)}"

Rules:
- Return [] if no external tools needed (simple Q&A, code explanation)
- Only include categories directly relevant to the query
- "github" for PRs, issues, repos, commits
- "browser" for web pages, screenshots, clicking, automation
- "slack" for messaging, channels, conversations, team discussions
- "figma" for design files
- "memory" for remembering, entities, knowledge graph
- "filesystem" for reading/writing files on disk
- "research" for web search, arxiv, papers, URL reading
- "reasoning" for complex multi-step analysis
- When user mentions a tool/service name explicitly, ALWAYS include that category

Return ONLY a JSON array, no explanation. Example: ["github", "research"]`

  const temperature = sanitizeTemperature(FAST_MODEL, 0)

  const body: Record<string, unknown> = {
    model: FAST_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    max_tokens: 100
  }
  if (temperature !== undefined) {
    body.temperature = temperature
  }

  try {
    const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getProxyKey()}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT)
    })

    if (!response.ok) {
      console.warn(`[ToolRouter] LLM call failed (${response.status}), including ALL MCP tools as fallback`)
      return categories
    }

    const rawText = await response.text()
    let content = '[]'
    try {
      const data = JSON.parse(rawText) as { choices?: Array<{ message?: { content?: string } }> }
      content = data.choices?.[0]?.message?.content?.trim() || '[]'
    } catch {
      const lastDataLine = rawText.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]')).pop()
      if (lastDataLine) {
        try {
          const sseData = JSON.parse(lastDataLine.slice(6))
          content = sseData.choices?.[0]?.message?.content?.trim()
            || sseData.choices?.[0]?.delta?.content?.trim()
            || '[]'
        } catch {}
      }
    }

    const match = content.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []

    return parsed.filter((c: unknown): c is string => typeof c === 'string' && categories.includes(c))
  } catch (err) {
    console.warn(`[ToolRouter] Selection failed: ${err instanceof Error ? err.message : String(err)}, including ALL MCP tools as fallback`)
    return categories
  }
}
