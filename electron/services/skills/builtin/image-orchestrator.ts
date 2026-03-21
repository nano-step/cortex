/**
 * Image Orchestrator — Routes image requests to the best generator by category
 *
 * Categories:
 * - diagram: Architecture, flowchart, workflow, ERD → Mermaid.js code (SVG)
 * - photo: Realistic photos, scenes, portraits → FLUX.1 Schnell
 * - art: Illustrations, paintings, anime, fantasy → FLUX.1 Dev (higher quality)
 * - marketing: Blog headers, social media, ads → FLUX.1 Dev + marketing prompt
 * - ui: UI mockups, wireframes, app screens → SDXL (flat design)
 */

import { getProxyUrl, getProxyKey } from '../../settings-service'
import { isOpenRouterConfigured } from '../efficiency/openrouter-fallback'

export type ImageCategory = 'diagram' | 'photo' | 'art' | 'marketing' | 'ui' | 'general'

export interface OrchestratorResult {
  category: ImageCategory
  model: string
  enhancedPrompt: string
  useMermaid: boolean
  mermaidCode?: string
  promptSuffix: string
}

const CATEGORY_PATTERNS: Array<{ category: ImageCategory; patterns: RegExp }> = [
  {
    category: 'diagram',
    patterns: /(architecture|flowchart|workflow|sequence diagram|ERD|entity relationship|class diagram|system design|data flow|component diagram|UML|mind map|org chart|state machine|sơ đồ|luồng|kiến trúc|quy trình)/i
  },
  {
    category: 'marketing',
    patterns: /(blog|article|banner|thumbnail|social media|quảng cáo|marketing|content|hero image|cover image|poster|flyer|bài viết|tiêu đề|header image|og image|featured image)/i
  },
  {
    category: 'ui',
    patterns: /(UI|UX|wireframe|mockup|app screen|dashboard|landing page|interface|giao diện|thiết kế web|mobile app)/i
  },
  {
    category: 'art',
    patterns: /(anime|manga|watercolor|oil painting|sketch|pixel art|cyberpunk|fantasy|chibi|illustration|concept art|digital art|comic|nghệ thuật|tranh)/i
  },
  {
    category: 'photo',
    patterns: /(photo|realistic|portrait|landscape|nature|street|product photo|food|ảnh|chân dung|phong cảnh|sản phẩm)/i
  }
]

function getModelForCategory(category: ImageCategory): string {
  if (category === 'diagram') return 'mermaid'
  if (isOpenRouterConfigured()) {
    const paid: Partial<Record<ImageCategory, string>> = {
      art: 'google/gemini-3.1-flash-image-preview',
      marketing: 'google/gemini-3.1-flash-image-preview',
      ui: 'google/gemini-3.1-flash-image-preview'
    }
    return paid[category] || 'black-forest-labs/FLUX.1-schnell'
  }
  return 'black-forest-labs/FLUX.1-schnell'
}

const PROMPT_SUFFIX: Record<ImageCategory, string> = {
  diagram: '',
  photo: ', photorealistic, natural lighting, high resolution, sharp focus, professional photography',
  art: ', highly detailed, vibrant colors, professional digital art, trending on artstation, masterpiece',
  marketing: ', clean modern design, professional, eye-catching, suitable for blog/article header, 16:9 aspect ratio, minimal text area, high contrast',
  ui: ', flat design, clean UI, modern interface, minimal, precise layout, grid-aligned, professional UX design',
  general: ', high quality, detailed, 4K'
}

export function detectImageCategory(query: string): ImageCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.test(query)) return category
  }
  return 'general'
}

export async function orchestrateImageGen(
  query: string,
  rawPrompt: string
): Promise<OrchestratorResult> {
  const category = detectImageCategory(query)
  const model = getModelForCategory(category)
  const promptSuffix = PROMPT_SUFFIX[category]

  console.log(`[ImageOrchestrator] Category: ${category} → model: ${model}`)

  if (category === 'diagram') {
    const mermaidCode = await generateMermaidCode(rawPrompt)
    return {
      category,
      model: 'mermaid',
      enhancedPrompt: rawPrompt,
      useMermaid: true,
      mermaidCode,
      promptSuffix: ''
    }
  }

  return {
    category,
    model,
    enhancedPrompt: rawPrompt,
    useMermaid: false,
    promptSuffix
  }
}

async function generateMermaidCode(description: string): Promise<string> {
  const proxyUrl = getProxyUrl()
  const proxyKey = getProxyKey()
  if (!proxyUrl || !proxyKey) return fallbackMermaid(description)

  try {
    const response = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proxyKey}` },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-lite',
        messages: [{
          role: 'user',
          content: `Generate a Mermaid.js diagram for this description. Return ONLY the Mermaid code, no explanation, no markdown fences.

Description: ${description}

Rules:
- Use appropriate diagram type (graph TD for flowcharts, sequenceDiagram for sequences, erDiagram for ERD, classDiagram for classes, stateDiagram-v2 for state machines, mindmap for mind maps)
- Use clear, concise labels
- Add meaningful connections and descriptions on arrows
- Use subgraph for grouping related components
- Keep it clean and readable`
        }],
        max_tokens: 1000,
        temperature: 0.3,
        stream: false
      }),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) return fallbackMermaid(description)

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    let code = data.choices?.[0]?.message?.content?.trim() || ''
    code = code.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/, '').trim()

    if (code.length < 10) return fallbackMermaid(description)

    console.log(`[ImageOrchestrator] Generated Mermaid code (${code.length} chars)`)
    return code
  } catch {
    return fallbackMermaid(description)
  }
}

function fallbackMermaid(description: string): string {
  return `graph TD
    A[Start] --> B[${description.slice(0, 40)}]
    B --> C[Process]
    C --> D[End]`
}
