/**
 * Artist Tools — Multi-tier AI Image Generation
 *
 * Provider chain: Proxy → HuggingFace (FREE) → OpenRouter
 * Supports: text-to-image, image editing, resolution control, negative prompts,
 * reference images, 12 style presets, 8 aspect ratios.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { MCPToolDefinition } from '../mcp/mcp-manager'
import { getProxyUrl, getProxyKey, getSetting, setSetting } from '../../settings-service'
import {
  getOpenRouterBaseUrl, getOpenRouterHeaders, isOpenRouterConfigured
} from '../efficiency/openrouter-fallback'

type ImageProvider = 'proxy' | 'huggingface' | 'openrouter'

interface ImageModel {
  id: string
  name: string
  provider: ImageProvider
  tier: 'free' | 'cheap' | 'medium' | 'premium'
  supportsEdit: boolean
  supportsReference: boolean
  maxResolution: string
}

const IMAGE_MODELS: ImageModel[] = [
  // HuggingFace Inference — FREE
  { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell (FREE)', provider: 'huggingface', tier: 'free', supportsEdit: false, supportsReference: false, maxResolution: '1024x1024' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base (FREE)', provider: 'huggingface', tier: 'free', supportsEdit: false, supportsReference: false, maxResolution: '1024x1024' },
  { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1 Dev (FREE)', provider: 'huggingface', tier: 'free', supportsEdit: false, supportsReference: false, maxResolution: '1024x1024' },
  { id: 'stabilityai/stable-diffusion-3.5-medium', name: 'SD 3.5 Medium (FREE)', provider: 'huggingface', tier: 'free', supportsEdit: false, supportsReference: false, maxResolution: '1024x1024' },
  // OpenRouter — Paid
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Nano Banana 2 (Flash)', provider: 'openrouter', tier: 'cheap', supportsEdit: true, supportsReference: true, maxResolution: '4096x4096' },
  { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', provider: 'openrouter', tier: 'cheap', supportsEdit: true, supportsReference: true, maxResolution: '2048x2048' },
  { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro', provider: 'openrouter', tier: 'medium', supportsEdit: true, supportsReference: true, maxResolution: '4096x4096' },
  { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini', provider: 'openrouter', tier: 'medium', supportsEdit: true, supportsReference: false, maxResolution: '2048x2048' },
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image', provider: 'openrouter', tier: 'premium', supportsEdit: true, supportsReference: true, maxResolution: '4096x4096' },
]

const STYLE_PRESETS: Record<string, string> = {
  realistic: 'Photorealistic with natural lighting, accurate proportions, and lifelike details.',
  watercolor: 'Watercolor painting with soft edges, blended colors, visible brush strokes on textured paper.',
  'pixel-art': 'Retro pixel art with limited color palette, clear pixel grid, 8-bit/16-bit aesthetic.',
  anime: 'Japanese anime with bold outlines, vibrant colors, expressive features, dynamic composition.',
  sketch: 'Pencil sketch with fine line work, cross-hatching for shading, hand-drawn feel on white paper.',
  minimalist: 'Minimalist with clean lines, limited colors, geometric shapes, plenty of negative space.',
  'oil-painting': 'Oil painting with rich textured brushstrokes, deep color saturation, classical composition.',
  cyberpunk: 'Cyberpunk with neon colors, futuristic technology, rain-slicked streets, dark dystopian atmosphere.',
  '3d-clay': '3D clay art with soft rounded shapes, pastel colors, cute minimalist aesthetic, soft studio lighting.',
  'flat-design': 'Flat design illustration with bold colors, no gradients, clean vectors, modern UI/UX style.',
  cinematic: 'Cinematic shot with dramatic lighting, shallow depth of field, film grain, anamorphic lens flare.',
  'comic-book': 'Comic book with halftone dots, bold outlines, speech bubbles, dynamic action poses.',
}

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1344, h: 768 },
  '9:16': { w: 768, h: 1344 },
  '4:3': { w: 1152, h: 896 },
  '3:4': { w: 896, h: 1152 },
  '3:2': { w: 1216, h: 832 },
  '2:3': { w: 832, h: 1216 },
  '21:9': { w: 1536, h: 640 },
}

export function getHuggingFaceToken(): string {
  return getSetting('huggingface_token') || ''
}

export function setHuggingFaceToken(token: string): void {
  setSetting('huggingface_token', token, true)
}

function getAvailableModels(): ImageModel[] {
  const hasProxy = !!(getProxyUrl() && getProxyKey())
  const hasHF = !!getHuggingFaceToken()
  const hasOR = isOpenRouterConfigured()

  return IMAGE_MODELS.filter(m => {
    if (m.provider === 'proxy') return hasProxy
    if (m.provider === 'huggingface') return hasHF || hasProxy
    if (m.provider === 'openrouter') return hasOR
    return false
  })
}

function getDefaultModel(): string {
  if (getHuggingFaceToken()) return 'black-forest-labs/FLUX.1-schnell'
  if (isOpenRouterConfigured()) return 'google/gemini-3.1-flash-image-preview'
  return 'black-forest-labs/FLUX.1-schnell'
}

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_generate_image',
      description: 'Generate an image from text. Supports 12 styles (realistic, anime, watercolor, pixel-art, sketch, minimalist, oil-painting, cyberpunk, 3d-clay, flat-design, cinematic, comic-book), 8 aspect ratios, negative prompts, and multiple AI models (FREE: FLUX.1, SDXL | PAID: Nano Banana, GPT-5 Image).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed image description. Be specific about subject, composition, lighting, colors, mood.' },
          negative_prompt: { type: 'string', description: 'What to exclude from the image (e.g., "blurry, low quality, text, watermark")' },
          style: { type: 'string', enum: Object.keys(STYLE_PRESETS), description: 'Visual style preset. Default: realistic' },
          aspect_ratio: { type: 'string', enum: Object.keys(ASPECT_RATIOS), description: 'Image aspect ratio. Default: 1:1' },
          model: { type: 'string', description: 'Model ID. Default: auto (best available). Options: FLUX.1-schnell (free), gemini-3.1-flash-image-preview (cheap), gemini-3-pro-image-preview (best)' },
          save_path: { type: 'string', description: 'File path to save generated image' },
          reference_image: { type: 'string', description: 'Base64 or URL of reference image for style guidance (paid models only)' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_edit_image',
      description: 'Edit an existing image with AI. Send the image + instruction. Examples: "Remove background", "Add sunset sky", "Change to blue", "Make it anime style". Supports paid models only (Nano Banana, GPT-5).',
      parameters: {
        type: 'object',
        properties: {
          image_data: { type: 'string', description: 'Base64-encoded image or URL' },
          instruction: { type: 'string', description: 'Edit instruction' },
          model: { type: 'string', description: 'Model ID (must support editing)' },
          save_path: { type: 'string', description: 'File path to save edited image' }
        },
        required: ['image_data', 'instruction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_list_image_models',
      description: 'List all available image generation models with their capabilities, cost tier, and supported features.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
]

export function getArtistToolDefinitions(): MCPToolDefinition[] {
  const hasAny = getHuggingFaceToken() || isOpenRouterConfigured() || (getProxyUrl() && getProxyKey())
  if (!hasAny) return []
  return TOOL_DEFINITIONS
}

function buildPrompt(prompt: string, style?: string, negativePrompt?: string): string {
  const parts: string[] = []
  if (style && STYLE_PRESETS[style]) parts.push(STYLE_PRESETS[style])
  parts.push(prompt)
  if (negativePrompt) parts.push(`Avoid: ${negativePrompt}`)
  return parts.join('\n\n')
}

// Provider-specific image generation
async function generateViaHuggingFace(prompt: string, modelId: string, width: number, height: number): Promise<{ imageBase64: string; text: string }> {
  const token = getHuggingFaceToken()
  const proxyUrl = getProxyUrl()
  const proxyKey = getProxyKey()

  // Route through proxy if available, otherwise direct HF
  let url: string
  let headers: Record<string, string>

  if (proxyUrl && proxyKey) {
    url = `${proxyUrl}/hf/models/${modelId}`
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${proxyKey}` }
  } else {
    url = `https://api-inference.huggingface.co/models/${modelId}`
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: prompt,
      parameters: { width, height }
    }),
    signal: AbortSignal.timeout(120000)
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`HuggingFace error (${response.status}): ${err.slice(0, 200)}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return { imageBase64: buffer.toString('base64'), text: '' }
  }

  const data = await response.json() as { error?: string }
  throw new Error(data.error || 'HuggingFace returned unexpected response')
}

async function generateViaOpenRouter(
  prompt: string, modelId: string,
  referenceImage?: string
): Promise<{ imageBase64: string | null; text: string }> {
  const content: unknown[] = [{ type: 'text', text: `Generate an image: ${prompt}` }]
  if (referenceImage) {
    const isUrl = referenceImage.startsWith('http')
    content.push({
      type: 'image_url',
      image_url: { url: isUrl ? referenceImage : `data:image/png;base64,${referenceImage}` }
    })
  }

  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content }],
      max_tokens: 4096,
      temperature: 0.8,
      stream: false,
      ...(modelId.includes('image') ? { modalities: ['text', 'image'] } : {})
    }),
    signal: AbortSignal.timeout(120000)
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`OpenRouter error (${response.status}): ${err.slice(0, 200)}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
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
        if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
          const url = (p.image_url as Record<string, unknown>).url as string
          if (url?.startsWith('data:image/')) imageBase64 = url.split(',')[1] || null
        }
      }
    }
  }

  return { imageBase64, text }
}

async function editViaOpenRouter(
  imageData: string, instruction: string, modelId: string
): Promise<{ imageBase64: string | null; text: string }> {
  const isUrl = imageData.startsWith('http://') || imageData.startsWith('https://')
  const imageUrl = isUrl ? imageData : `data:image/png;base64,${imageData}`

  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: modelId,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Edit this image: ${instruction}` },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      max_tokens: 4096,
      temperature: 0.8,
      stream: false,
      ...(modelId.includes('image') ? { modalities: ['text', 'image'] } : {})
    }),
    signal: AbortSignal.timeout(120000)
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`OpenRouter edit error (${response.status}): ${err.slice(0, 200)}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
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
        if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
          const url = (p.image_url as Record<string, unknown>).url as string
          if (url?.startsWith('data:image/')) imageBase64 = url.split(',')[1] || null
        }
      }
    }
  }

  return { imageBase64, text }
}

function saveImage(base64: string, savePath: string): string {
  const dir = dirname(savePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(savePath, Buffer.from(base64, 'base64'))
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
        if (!prompt) return { content: 'Error: prompt is required', isError: true }

        const style = String(args.style || 'realistic')
        const negativePrompt = args.negative_prompt ? String(args.negative_prompt) : undefined
        const aspectRatio = String(args.aspect_ratio || '1:1')
        const modelId = String(args.model || getDefaultModel())
        const savePath = args.save_path ? String(args.save_path) : null
        const referenceImage = args.reference_image ? String(args.reference_image) : undefined

        const fullPrompt = buildPrompt(prompt, style, negativePrompt)
        const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1']

        const model = IMAGE_MODELS.find(m => m.id === modelId) || IMAGE_MODELS.find(m => m.id === getDefaultModel())!

        let result: { imageBase64: string | null; text: string }

        if (model.provider === 'huggingface' || (model.provider === 'huggingface' && getProxyUrl())) {
          const hfResult = await generateViaHuggingFace(fullPrompt, modelId, dims.w, dims.h)
          result = { imageBase64: hfResult.imageBase64, text: hfResult.text }
        } else {
          result = await generateViaOpenRouter(fullPrompt, modelId, referenceImage)
        }

        const parts: string[] = []
        if (result.text) parts.push(result.text)

        if (result.imageBase64) {
          if (savePath) {
            const saved = saveImage(result.imageBase64, savePath)
            parts.push(`Image saved to: ${saved}`)
          }
          const sizeKB = Math.round(result.imageBase64.length * 0.75 / 1024)
          parts.push(`![Generated Image](data:image/png;base64,${result.imageBase64})`)
          parts.push(`*${model.name} | ${aspectRatio} (${dims.w}x${dims.h}) | ${style} | ${sizeKB}KB*`)
        } else {
          parts.push('Model returned text but no image. Try a different model or adjust the prompt.')
        }

        return { content: parts.join('\n\n'), isError: false }
      }

      case 'cortex_edit_image': {
        const imageData = String(args.image_data || '')
        const instruction = String(args.instruction || '')
        if (!imageData || !instruction) return { content: 'Error: image_data and instruction required', isError: true }

        const modelId = String(args.model || 'google/gemini-3.1-flash-image-preview')
        const savePath = args.save_path ? String(args.save_path) : null

        const model = IMAGE_MODELS.find(m => m.id === modelId)
        if (model && !model.supportsEdit) {
          return { content: `Error: ${model.name} does not support image editing. Use Nano Banana 2 or GPT-5 Image.`, isError: true }
        }

        const result = await editViaOpenRouter(imageData, instruction, modelId)

        const parts: string[] = []
        if (result.text) parts.push(result.text)
        if (result.imageBase64) {
          if (savePath) saveImage(result.imageBase64, savePath)
          parts.push(`![Edited Image](data:image/png;base64,${result.imageBase64})`)
        }

        return { content: parts.join('\n\n'), isError: false }
      }

      case 'cortex_list_image_models': {
        const models = getAvailableModels()
        if (models.length === 0) {
          return { content: 'No image models available. Configure HuggingFace token or OpenRouter API key in Settings.', isError: false }
        }

        const lines = ['## Available Image Generation Models\n']
        const tiers = ['free', 'cheap', 'medium', 'premium'] as const
        for (const tier of tiers) {
          const tierModels = models.filter(m => m.tier === tier)
          if (tierModels.length === 0) continue
          lines.push(`### ${tier.toUpperCase()}`)
          for (const m of tierModels) {
            const features = [
              m.supportsEdit ? 'edit' : null,
              m.supportsReference ? 'reference' : null,
              `max ${m.maxResolution}`
            ].filter(Boolean).join(', ')
            lines.push(`- **${m.name}** (\`${m.id}\`) — ${features}`)
          }
          lines.push('')
        }
        return { content: lines.join('\n'), isError: false }
      }

      default:
        return { content: `Unknown artist tool: ${toolName}`, isError: true }
    }
  } catch (err) {
    return { content: `Image generation failed: ${(err as Error).message}`, isError: true }
  }
}
