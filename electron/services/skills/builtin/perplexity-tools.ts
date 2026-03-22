import { randomUUID } from 'node:crypto'
import { session as electronSession } from 'electron'
import type { MCPToolDefinition } from '../mcp/mcp-manager'
import { getSetting } from '../../settings-service'

const PERPLEXITY_URL = 'https://www.perplexity.ai/rest/sse/perplexity_ask'
const PERPLEXITY_SESSION_PARTITION = 'persist:perplexity'

const SUPPORTED_BLOCK_USE_CASES = [
  'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
  'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
  'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
  'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
  'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
  'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
  'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
  'pending_followups', 'inline_claims', 'unified_assets'
]

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_perplexity_search',
      description: 'Search the web using Perplexity AI Pro. Returns comprehensive, cited answers with real-time web data. Use for research, fact-checking, current events, and any question requiring up-to-date information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query or research question'
          },
          focus: {
            type: 'string',
            enum: ['internet', 'academic', 'writing', 'youtube', 'reddit', 'wikipedia'],
            description: 'Search focus area. Default: internet'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_perplexity_read_url',
      description: 'Read and summarize a URL using Perplexity AI Pro. Perplexity will fetch the page content and provide a summary. Works with any public URL including articles, docs, GitHub repos, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to read and summarize'
          },
          instruction: {
            type: 'string',
            description: 'Optional instruction for what to focus on (e.g., "summarize the key features", "extract the API usage")'
          }
        },
        required: ['url']
      }
    }
  }
]

function buildRequestBody(query: string, focus: string = 'internet'): string {
  return JSON.stringify({
    params: {
      attachments: [],
      language: 'en-US',
      timezone: 'Asia/Saigon',
      search_focus: focus,
      sources: ['web'],
      frontend_uuid: randomUUID(),
      mode: 'copilot',
      model_preference: 'pplx_pro',
      is_related_query: false,
      is_sponsored: false,
      frontend_context_uuid: randomUUID(),
      prompt_source: 'user',
      query_source: 'home',
      is_incognito: false,
      use_schematized_api: true,
      send_back_text_in_streaming_api: false,
      supported_block_use_cases: SUPPORTED_BLOCK_USE_CASES,
      client_coordinates: null,
      mentions: [],
      dsl_query: query,
      skip_search_enabled: true,
      is_nav_suggestions_disabled: false,
      source: 'default',
      always_search_override: false,
      override_no_search: false,
      should_ask_for_mcp_tool_confirmation: true,
      browser_agent_allow_once_from_toggle: false,
      force_enable_browser_agent: false,
      supported_features: ['browser_agent_permission_banner_v1.1'],
      version: '4.0.0'
    },
    query_str: query
  })
}

function extractAnswerFromSSE(rawBody: string): string {
  const events = rawBody.split('\n\n')
  let lastAnswer = ''

  for (const event of events) {
    const lines = event.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice(5).trim()
      if (!jsonStr || jsonStr === '[DONE]') continue

      try {
        const data = JSON.parse(jsonStr)
        if (data.text) lastAnswer = data.text
        else if (data.answer) lastAnswer = data.answer
        else if (data.output) lastAnswer = data.output
      } catch {
        // non-JSON SSE data, skip
      }
    }
  }

  return lastAnswer
}

export function getPerplexitySession() {
  return electronSession.fromPartition(PERPLEXITY_SESSION_PARTITION)
}

async function callPerplexity(query: string, focus: string = 'internet'): Promise<{ content: string; isError: boolean }> {
  const ses = getPerplexitySession()
  const cookies = await ses.cookies.get({ domain: 'perplexity.ai' })
  const sessionToken = cookies.find(c => c.name === '__Secure-next-auth.session-token')

  if (!sessionToken) {
    return {
      content: 'Perplexity chưa đăng nhập. Vào Settings → Perplexity Pro → bấm "Đăng nhập Perplexity".',
      isError: true
    }
  }

  try {
    const response = await ses.fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        'accept': 'text/event-stream',
        'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
        'content-type': 'application/json',
        'origin': 'https://www.perplexity.ai',
        'referer': 'https://www.perplexity.ai/',
      },
      body: buildRequestBody(query, focus),
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { content: `Perplexity auth expired (${response.status}). Vào Settings → bấm "Đăng nhập lại".`, isError: true }
      }
      return { content: `Perplexity HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`, isError: true }
    }

    const rawBody = await response.text()
    const answer = extractAnswerFromSSE(rawBody)

    if (!answer) {
      return { content: `Perplexity returned no answer. Raw (500 chars): ${rawBody.slice(0, 500)}`, isError: true }
    }

    return { content: answer, isError: false }
  } catch (err) {
    return { content: `Perplexity request error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

export async function isPerplexityLoggedIn(): Promise<boolean> {
  try {
    const ses = getPerplexitySession()
    const cookies = await ses.cookies.get({ domain: 'perplexity.ai' })
    return cookies.some(c => c.name === '__Secure-next-auth.session-token')
  } catch {
    return false
  }
}

export function getPerplexityToolDefinitions(): MCPToolDefinition[] {
  const hasCookieSetting = getSetting('perplexity_logged_in')
  if (!hasCookieSetting) return []
  return TOOL_DEFINITIONS
}

export async function executePerplexityTool(
  toolName: string,
  argsJson: string
): Promise<{ content: string; isError: boolean }> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: 'Error parsing tool arguments: invalid JSON', isError: true }
  }

  switch (toolName) {
    case 'cortex_perplexity_search': {
      const query = args.query as string
      const focus = (args.focus as string) || 'internet'
      if (!query?.trim()) return { content: 'Error: query is required', isError: true }
      console.log(`[PerplexityTools] Search: "${query.slice(0, 80)}..." (focus: ${focus})`)
      return callPerplexity(query, focus)
    }

    case 'cortex_perplexity_read_url': {
      const url = args.url as string
      const instruction = args.instruction as string | undefined
      if (!url?.trim()) return { content: 'Error: url is required', isError: true }
      const query = instruction
        ? `${instruction}: ${url}`
        : `Read and summarize the content of this URL: ${url}`
      console.log(`[PerplexityTools] Read URL: ${url}`)
      return callPerplexity(query)
    }

    default:
      return { content: `Unknown perplexity tool: ${toolName}`, isError: true }
  }
}
