/**
 * ComfyUI Cloud Client — Connects to Comfy Cloud API (cloud.comfy.org)
 *
 * No Docker/GPU needed. Uses cloud GPU infrastructure.
 * API: POST /api/prompt, GET /api/job/{id}/status, GET /api/view
 * Auth: X-API-Key header from platform.comfy.org
 */

import { getSetting, setSetting } from './settings-service'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const CLOUD_BASE_URL = 'https://cloud.comfy.org'

export function getComfyUIApiKey(): string {
  return getSetting('comfyui_api_key') || ''
}

export function setComfyUIApiKey(key: string): void {
  setSetting('comfyui_api_key', key, true)
}

export function getComfyUIUrl(): string {
  return getSetting('comfyui_url') || CLOUD_BASE_URL
}

export function setComfyUIUrl(url: string): void {
  setSetting('comfyui_url', url, false)
}

export function isComfyUIConfigured(): boolean {
  return getComfyUIApiKey().length > 0
}

function getHeaders(): Record<string, string> {
  return {
    'X-API-Key': getComfyUIApiKey(),
    'Content-Type': 'application/json'
  }
}

export async function testComfyUIConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!isComfyUIConfigured()) return { ok: false, error: 'ComfyUI API key not configured' }

  try {
    const response = await fetch(`${getComfyUIUrl()}/api/user`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000)
    })
    if (response.status === 401) return { ok: false, error: 'Invalid API key' }
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    return { ok: true }
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
  if (!isComfyUIConfigured()) return { error: 'ComfyUI API key not configured' }

  const baseUrl = getComfyUIUrl()
  const { width = 1024, height = 1024, steps = 20 } = options
  const workflow = buildTextToImageWorkflow(prompt, width, height, steps)

  console.log(`[ComfyUI Cloud] Submitting: "${prompt.slice(0, 60)}..." (${width}x${height}, ${steps} steps)`)

  try {
    const submitResponse = await fetch(`${baseUrl}/api/prompt`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(15000)
    })

    if (submitResponse.status === 401) return { error: 'Invalid ComfyUI API key' }
    if (submitResponse.status === 402) return { error: 'Insufficient ComfyUI credits' }
    if (!submitResponse.ok) {
      const errBody = await submitResponse.text().catch(() => '')
      return { error: `ComfyUI submit failed (${submitResponse.status}): ${errBody.slice(0, 200)}` }
    }

    const result = await submitResponse.json() as { prompt_id?: string }
    if (!result.prompt_id) return { error: 'No prompt_id returned' }

    console.log(`[ComfyUI Cloud] Job: ${result.prompt_id}`)

    const imagePath = await pollForImage(baseUrl, result.prompt_id, options.savePath)
    if (!imagePath) return { error: 'ComfyUI did not produce an image (timeout)' }

    const stats = require('fs').statSync(imagePath)
    const sizeKB = Math.round(stats.size / 1024)
    console.log(`[ComfyUI Cloud] Done: ${imagePath} (${sizeKB}KB)`)

    return { imagePath, sizeKB }
  } catch (err) {
    return { error: `ComfyUI Cloud error: ${(err as Error).message}` }
  }
}

async function pollForImage(
  baseUrl: string,
  promptId: string,
  savePath?: string,
  timeoutMs: number = 120000
): Promise<string | null> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const statusResponse = await fetch(`${baseUrl}/api/job/${promptId}/status`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(5000)
      })

      if (!statusResponse.ok) {
        await sleep(2000)
        continue
      }

      const job = await statusResponse.json() as { status?: string; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }

      if (job.status === 'failed') return null

      if (job.status === 'completed' && job.outputs) {
        for (const nodeOutput of Object.values(job.outputs)) {
          if (nodeOutput.images && nodeOutput.images.length > 0) {
            const img = nodeOutput.images[0]
            const viewUrl = `${baseUrl}/api/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`

            const imgResponse = await fetch(viewUrl, {
              headers: getHeaders(),
              redirect: 'follow',
              signal: AbortSignal.timeout(30000)
            })
            if (!imgResponse.ok) continue

            const buffer = Buffer.from(await imgResponse.arrayBuffer())
            const finalPath = savePath || join(tmpdir(), `cortex-comfy-${Date.now()}.png`)
            const dir = dirname(finalPath)
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            writeFileSync(finalPath, buffer)

            return finalPath
          }
        }
      }

      await sleep(2000)
    } catch {
      await sleep(3000)
    }
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
