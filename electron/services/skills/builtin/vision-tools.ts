/**
 * Vision Tools — Image analysis via FREE OpenRouter models
 *
 * Supports: image upload → analysis, OCR, UI review, diagram understanding
 * Uses free vision models: healer-alpha (best), hunter-alpha, gemma-3-27b
 * No API key cost — completely free tier on OpenRouter.
 */

import type { MCPToolDefinition } from '../mcp/mcp-manager'
import {
  getOpenRouterApiKey, getOpenRouterBaseUrl, getOpenRouterHeaders, isOpenRouterConfigured
} from '../efficiency/openrouter-fallback'

const VISION_MODELS = [
  { id: 'openrouter/healer-alpha', name: 'Healer Alpha', ctx: 262144, priority: 1 },
  { id: 'openrouter/hunter-alpha', name: 'Hunter Alpha', ctx: 1048576, priority: 2 },
  { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', ctx: 131072, priority: 3 },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron VL', ctx: 128000, priority: 4 },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1', ctx: 128000, priority: 5 },
]

function getBestVisionModel(): typeof VISION_MODELS[0] {
  return VISION_MODELS[0]
}

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_analyze_image',
      description: 'Analyze an image using AI vision. Supports: describing content, OCR (text extraction), UI/UX review, diagram understanding, code screenshot analysis, chart interpretation. Send base64 image data or a URL.',
      parameters: {
        type: 'object',
        properties: {
          image_data: {
            type: 'string',
            description: 'Base64-encoded image data (without data: prefix) OR a URL to an image'
          },
          instruction: {
            type: 'string',
            description: 'What to analyze about the image. Examples: "Describe this UI", "Extract all text (OCR)", "Review this design", "Explain this diagram", "What errors are in this screenshot?"'
          },
          detail: {
            type: 'string',
            enum: ['auto', 'low', 'high'],
            description: 'Image detail level. "high" for detailed analysis, "low" for quick overview. Default: auto'
          }
        },
        required: ['image_data', 'instruction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_compare_images',
      description: 'Compare two images side by side. Useful for: before/after comparisons, design review, finding differences, A/B testing UI screenshots.',
      parameters: {
        type: 'object',
        properties: {
          image1: { type: 'string', description: 'Base64 or URL of first image' },
          image2: { type: 'string', description: 'Base64 or URL of second image' },
          instruction: {
            type: 'string',
            description: 'What to compare. Examples: "Find differences", "Which design is better?", "Compare layouts"'
          }
        },
        required: ['image1', 'image2', 'instruction']
      }
    }
  }
]

export function getVisionToolDefinitions(): MCPToolDefinition[] {
  if (!isOpenRouterConfigured()) return []
  return TOOL_DEFINITIONS
}

function buildImageContent(imageData: string, detail: string = 'auto'): { type: string; image_url: { url: string; detail: string } } {
  const isUrl = imageData.startsWith('http://') || imageData.startsWith('https://')
  const url = isUrl ? imageData : `data:image/png;base64,${imageData}`
  return { type: 'image_url', image_url: { url, detail } }
}

async function callVisionModel(
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number = 2000
): Promise<string> {
  if (!isOpenRouterConfigured()) {
    return 'Error: OpenRouter API key not configured. Go to Settings → OpenRouter to set up.'
  }

  const model = getBestVisionModel()

  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: model.id,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false
    }),
    signal: AbortSignal.timeout(60000)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Vision model error (${response.status}): ${errorText.slice(0, 300)}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content || 'No response from vision model'
}

export async function executeVisionTool(
  toolName: string,
  argsJson: string
): Promise<{ content: string; isError: boolean }> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: 'Error: Invalid JSON arguments', isError: true }
  }

  try {
    switch (toolName) {
      case 'cortex_analyze_image': {
        const imageData = String(args.image_data || '')
        const instruction = String(args.instruction || 'Describe this image')
        const detail = String(args.detail || 'auto')

        if (!imageData) return { content: 'Error: image_data is required', isError: true }

        const result = await callVisionModel([
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              buildImageContent(imageData, detail)
            ]
          }
        ])
        return { content: result, isError: false }
      }

      case 'cortex_compare_images': {
        const image1 = String(args.image1 || '')
        const image2 = String(args.image2 || '')
        const instruction = String(args.instruction || 'Compare these two images')

        if (!image1 || !image2) return { content: 'Error: Both image1 and image2 are required', isError: true }

        const result = await callVisionModel([
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              buildImageContent(image1, 'high'),
              buildImageContent(image2, 'high')
            ]
          }
        ], 3000)
        return { content: result, isError: false }
      }

      default:
        return { content: `Unknown vision tool: ${toolName}`, isError: true }
    }
  } catch (err) {
    return { content: `Vision analysis failed: ${(err as Error).message}`, isError: true }
  }
}
