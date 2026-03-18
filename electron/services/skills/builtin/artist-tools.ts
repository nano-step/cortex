/**
 * Artist Tools — AI Image Generation via OpenRouter
 *
 * Powerful image generation skill: text-to-image, image editing, style presets.
 * Uses OpenRouter's image generation models (paid — cheapest is gemini-2.5-flash-image).
 * API: /v1/chat/completions with modalities: ["text", "image"]
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import type { MCPToolDefinition } from '../mcp/mcp-manager'
import {
  getOpenRouterBaseUrl, getOpenRouterHeaders, isOpenRouterConfigured
} from '../efficiency/openrouter-fallback'

const IMAGE_GEN_MODELS = [
  { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', cost: 'cheapest' },
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image', cost: 'cheap' },
  { id: 'google/gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image', cost: 'medium' },
  { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini', cost: 'medium' },
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image', cost: 'premium' },
]

const STYLE_PRESETS: Record<string, string> = {
  realistic: 'Create a photorealistic image with natural lighting, accurate proportions, and lifelike details.',
  watercolor: 'Create an image in watercolor painting style with soft edges, blended colors, and visible brush strokes on textured paper.',
  'pixel-art': 'Create an image in retro pixel art style with a limited color palette, clear pixel grid, and nostalgic 8-bit/16-bit aesthetic.',
  anime: 'Create an image in Japanese anime style with bold outlines, vibrant colors, expressive features, and dynamic composition.',
  sketch: 'Create an image in pencil sketch style with fine line work, cross-hatching for shading, and a hand-drawn feel on white paper.',
  minimalist: 'Create a minimalist image with clean lines, limited color palette, simple geometric shapes, and plenty of negative space.',
  'oil-painting': 'Create an image in oil painting style with rich, textured brushstrokes, deep color saturation, and classical composition.',
  cyberpunk: 'Create an image in cyberpunk style with neon colors, futuristic technology, rain-slicked streets, and a dark dystopian atmosphere.',
}

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_generate_image',
      description: 'Generate an image from a text description using AI. Supports style presets (realistic, watercolor, pixel-art, anime, sketch, minimalist, oil-painting, cyberpunk). Returns the image as base64 and optionally saves to a file.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate. Be specific about subject, composition, lighting, colors.'
          },
          style: {
            type: 'string',
            enum: Object.keys(STYLE_PRESETS),
            description: 'Visual style preset. Default: realistic'
          },
          model: {
            type: 'string',
            enum: IMAGE_GEN_MODELS.map(m => m.id),
            description: 'Which model to use. Default: gemini-2.5-flash-image (cheapest)'
          },
          save_path: {
            type: 'string',
            description: 'Optional file path to save the generated image (e.g., "./output/my-image.png")'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_edit_image',
      description: 'Edit an existing image based on instructions. Send the original image and describe the changes you want. Examples: "Remove the background", "Add a sunset sky", "Change the color to blue".',
      parameters: {
        type: 'object',
        properties: {
          image_data: {
            type: 'string',
            description: 'Base64-encoded original image or URL'
          },
          instruction: {
            type: 'string',
            description: 'What changes to make to the image'
          },
          model: {
            type: 'string',
            enum: IMAGE_GEN_MODELS.map(m => m.id),
            description: 'Which model to use. Default: gemini-2.5-flash-image'
          },
          save_path: {
            type: 'string',
            description: 'Optional file path to save the edited image'
          }
        },
        required: ['image_data', 'instruction']
      }
    }
  }
]

export function getArtistToolDefinitions(): MCPToolDefinition[] {
  if (!isOpenRouterConfigured()) return []
  return TOOL_DEFINITIONS
}

function extractBase64Image(content: unknown): string | null {
  if (!content || !Array.isArray(content)) return null
  for (const part of content) {
    if (part && typeof part === 'object') {
      const p = part as Record<string, unknown>
      if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
        const url = (p.image_url as Record<string, unknown>).url as string
        if (url?.startsWith('data:image/')) {
          return url.split(',')[1] || null
        }
      }
    }
  }
  return null
}

async function callImageGenModel(
  messages: Array<{ role: string; content: unknown }>,
  modelId: string
): Promise<{ text: string; imageBase64: string | null }> {
  if (!isOpenRouterConfigured()) {
    return { text: 'Error: OpenRouter API key not configured.', imageBase64: null }
  }

  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: 4096,
      temperature: 0.8,
      stream: false,
      // modalities for image output
      ...(modelId.includes('image') ? { modalities: ['text', 'image'] } : {})
    }),
    signal: AbortSignal.timeout(120000)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Image gen error (${response.status}): ${errorText.slice(0, 300)}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>
  }

  const msgContent = data.choices?.[0]?.message?.content
  let text = ''
  let imageBase64: string | null = null

  if (typeof msgContent === 'string') {
    text = msgContent
  } else if (Array.isArray(msgContent)) {
    for (const part of msgContent) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>
        if (p.type === 'text') text += String(p.text || '')
        if (p.type === 'image_url') {
          imageBase64 = extractBase64Image([part])
        }
      }
    }
  }

  return { text, imageBase64 }
}

function saveImage(base64: string, savePath: string): string {
  const dir = dirname(savePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const buffer = Buffer.from(base64, 'base64')
  writeFileSync(savePath, buffer)
  return savePath
}

export async function executeArtistTool(
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
      case 'cortex_generate_image': {
        const prompt = String(args.prompt || '')
        const style = String(args.style || 'realistic')
        const modelId = String(args.model || IMAGE_GEN_MODELS[0].id)
        const savePath = args.save_path ? String(args.save_path) : null

        if (!prompt) return { content: 'Error: prompt is required', isError: true }

        const stylePrompt = STYLE_PRESETS[style] || ''
        const fullPrompt = stylePrompt ? `${stylePrompt}\n\n${prompt}` : prompt

        const result = await callImageGenModel([
          { role: 'user', content: `Generate an image: ${fullPrompt}` }
        ], modelId)

        const parts: string[] = []
        if (result.text) parts.push(result.text)

        if (result.imageBase64) {
          if (savePath) {
            const saved = saveImage(result.imageBase64, savePath)
            parts.push(`Image saved to: ${saved}`)
          }
          parts.push(`[Image generated successfully — ${Math.round(result.imageBase64.length * 0.75 / 1024)}KB]`)
          parts.push(`data:image/png;base64,${result.imageBase64.slice(0, 100)}...`)
        } else {
          parts.push('Note: Model returned text response but no image data. The model may not support image output, or the prompt may need adjustment.')
        }

        return { content: parts.join('\n\n'), isError: false }
      }

      case 'cortex_edit_image': {
        const imageData = String(args.image_data || '')
        const instruction = String(args.instruction || '')
        const modelId = String(args.model || IMAGE_GEN_MODELS[0].id)
        const savePath = args.save_path ? String(args.save_path) : null

        if (!imageData || !instruction) {
          return { content: 'Error: image_data and instruction are required', isError: true }
        }

        const isUrl = imageData.startsWith('http://') || imageData.startsWith('https://')
        const imageUrl = isUrl ? imageData : `data:image/png;base64,${imageData}`

        const result = await callImageGenModel([
          {
            role: 'user',
            content: [
              { type: 'text', text: `Edit this image: ${instruction}` },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ], modelId)

        const parts: string[] = []
        if (result.text) parts.push(result.text)

        if (result.imageBase64) {
          if (savePath) {
            const saved = saveImage(result.imageBase64, savePath)
            parts.push(`Edited image saved to: ${saved}`)
          }
          parts.push(`[Image edited successfully — ${Math.round(result.imageBase64.length * 0.75 / 1024)}KB]`)
        }

        return { content: parts.join('\n\n'), isError: false }
      }

      default:
        return { content: `Unknown artist tool: ${toolName}`, isError: true }
    }
  } catch (err) {
    return { content: `Image generation failed: ${(err as Error).message}`, isError: true }
  }
}
