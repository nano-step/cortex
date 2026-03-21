/**
 * ComfyUI Client — Connects to ComfyUI Docker instance via REST API
 *
 * ComfyUI runs as Docker container on localhost:8188.
 * API: POST /api/prompt (submit workflow), GET /view (download image)
 * WebSocket ws://host:8188/ws for real-time progress.
 */

import { getSetting, setSetting } from './settings-service'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

export function getComfyUIUrl(): string {
  return getSetting('comfyui_url') || ''
}

export function setComfyUIUrl(url: string): void {
  setSetting('comfyui_url', url, false)
}

export function isComfyUIConfigured(): boolean {
  return getComfyUIUrl().length > 0
}

export async function testComfyUIConnection(): Promise<{ ok: boolean; version?: string; gpu?: string; error?: string }> {
  const url = getComfyUIUrl()
  if (!url) return { ok: false, error: 'ComfyUI URL not configured' }

  try {
    const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }

    const stats = await response.json() as {
      system?: { comfyui_version?: string }
      devices?: Array<{ name?: string; vram_total?: number }>
    }

    return {
      ok: true,
      version: stats.system?.comfyui_version,
      gpu: stats.devices?.[0]?.name
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function buildTextToImageWorkflow(prompt: string, width: number = 1024, height: number = 1024, steps: number = 20): Record<string, unknown> {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg: 7.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'flux1-schnell-fp8.safetensors' }
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 }
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['4', 1] }
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['4', 1] }
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] }
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'cortex', images: ['8', 0] }
    }
  }
}

export async function generateImageViaComfyUI(
  prompt: string,
  options: { width?: number; height?: number; steps?: number; savePath?: string } = {}
): Promise<{ imagePath: string; sizeKB: number } | { error: string }> {
  const url = getComfyUIUrl()
  if (!url) return { error: 'ComfyUI URL not configured' }

  const { width = 1024, height = 1024, steps = 20 } = options
  const clientId = randomUUID()
  const workflow = buildTextToImageWorkflow(prompt, width, height, steps)

  console.log(`[ComfyUI] Submitting workflow: "${prompt.slice(0, 60)}..." (${width}x${height}, ${steps} steps)`)

  try {
    const promptResponse = await fetch(`${url}/api/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(10000)
    })

    if (!promptResponse.ok) {
      const errBody = await promptResponse.text().catch(() => '')
      return { error: `ComfyUI prompt submit failed (${promptResponse.status}): ${errBody.slice(0, 200)}` }
    }

    const promptResult = await promptResponse.json() as { prompt_id?: string; error?: string }
    if (!promptResult.prompt_id) {
      return { error: `ComfyUI returned no prompt_id: ${JSON.stringify(promptResult).slice(0, 200)}` }
    }

    const promptId = promptResult.prompt_id
    console.log(`[ComfyUI] Prompt submitted: ${promptId}`)

    const imagePath = await waitForImage(url, promptId, clientId, options.savePath)
    if (!imagePath) return { error: 'ComfyUI did not produce an image' }

    const stats = require('fs').statSync(imagePath)
    const sizeKB = Math.round(stats.size / 1024)
    console.log(`[ComfyUI] Image generated: ${imagePath} (${sizeKB}KB)`)

    return { imagePath, sizeKB }
  } catch (err) {
    return { error: `ComfyUI error: ${(err as Error).message}` }
  }
}

async function waitForImage(
  baseUrl: string,
  promptId: string,
  clientId: string,
  savePath?: string,
  timeoutMs: number = 120000
): Promise<string | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const historyResponse = await fetch(`${baseUrl}/history/${promptId}`, { signal: AbortSignal.timeout(5000) })
      if (!historyResponse.ok) {
        await new Promise(r => setTimeout(r, 1000))
        continue
      }

      const history = await historyResponse.json() as Record<string, {
        outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>
      }>

      const entry = history[promptId]
      if (!entry?.outputs) {
        await new Promise(r => setTimeout(r, 1000))
        continue
      }

      for (const nodeOutput of Object.values(entry.outputs)) {
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          const img = nodeOutput.images[0]
          const imgUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`

          const imgResponse = await fetch(imgUrl, { signal: AbortSignal.timeout(30000) })
          if (!imgResponse.ok) continue

          const buffer = Buffer.from(await imgResponse.arrayBuffer())
          const finalPath = savePath || join(tmpdir(), `cortex-comfy-${Date.now()}.png`)
          const dir = dirname(finalPath)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          writeFileSync(finalPath, buffer)

          return finalPath
        }
      }

      await new Promise(r => setTimeout(r, 1000))
    } catch {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return null
}
