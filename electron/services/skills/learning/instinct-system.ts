import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getTrainingModel } from '../../training/training-model'

export interface Instinct {
  id: string
  name: string
  pattern: string
  action: string
  evidence: string
  confidence: number
  useCount: number
  createdAt: number
  lastUsed: number | null
}

function getInstinctDir(): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'instincts')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function loadInstincts(): Instinct[] {
  const dir = getInstinctDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  return files.flatMap(f => {
    try {
      return [JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Instinct]
    } catch {
      return []
    }
  }).sort((a, b) => b.confidence - a.confidence)
}

export function saveInstinct(instinct: Instinct): void {
  const dir = getInstinctDir()
  writeFileSync(join(dir, `${instinct.id}.json`), JSON.stringify(instinct, null, 2), 'utf-8')
}

export function updateInstinctUsage(id: string): void {
  const dir = getInstinctDir()
  const path = join(dir, `${id}.json`)
  if (!existsSync(path)) return
  const instinct = JSON.parse(readFileSync(path, 'utf-8')) as Instinct
  instinct.useCount++
  instinct.lastUsed = Date.now()
  instinct.confidence = Math.min(1, instinct.confidence + 0.02)
  writeFileSync(path, JSON.stringify(instinct, null, 2), 'utf-8')
}

export function deleteInstinct(id: string): boolean {
  const dir = getInstinctDir()
  const path = join(dir, `${id}.json`)
  if (!existsSync(path)) return false
  const { unlinkSync } = require('fs')
  unlinkSync(path)
  return true
}

export async function extractInstinctsFromSession(
  conversationHistory: Array<{ role: string; content: string }>
): Promise<Instinct[]> {
  if (conversationHistory.length < 4) return []

  try {
    const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
      body: JSON.stringify({
        model: getTrainingModel(),
        messages: [
          {
            role: 'system',
            content: `You extract reusable patterns ("instincts") from AI assistant conversations. 
An instinct is a situation-action pattern that proved useful: "When X happens, do Y".

Extract 0-5 instincts from this conversation. Only extract patterns that are:
1. Generalizable (not one-off)
2. High-value (saved significant effort or prevented errors)
3. Non-obvious (not common knowledge)

Return JSON array:
[
  {
    "name": "Short descriptive name",
    "pattern": "When [situation]...",
    "action": "Do [action]...",
    "evidence": "Quote from conversation showing this worked",
    "confidence": 0.6
  }
]

Return [] if no strong patterns found.`
          },
          {
            role: 'user',
            content: `Extract instincts from this conversation:\n\n${
              conversationHistory.slice(-20).map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n\n')
            }`
          }
        ],
        max_tokens: 1024,
        temperature: 0.1,
        stream: false
      }),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) return []
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content || '[]'

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      name: string; pattern: string; action: string; evidence: string; confidence: number
    }>

    return parsed.map(p => ({
      id: `instinct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: p.name,
      pattern: p.pattern,
      action: p.action,
      evidence: p.evidence,
      confidence: Math.min(1, Math.max(0, p.confidence || 0.5)),
      useCount: 0,
      createdAt: Date.now(),
      lastUsed: null
    }))
  } catch {
    return []
  }
}

export function getRelevantInstincts(query: string, maxResults = 5): Instinct[] {
  const instincts = loadInstincts()
  if (instincts.length === 0) return []

  const queryLower = query.toLowerCase()
  const scored = instincts.map(inst => {
    const patternWords = inst.pattern.toLowerCase().split(/\s+/)
    const actionWords = inst.action.toLowerCase().split(/\s+/)
    const allWords = [...patternWords, ...actionWords]
    const matchCount = allWords.filter(w => w.length > 3 && queryLower.includes(w)).length
    const score = inst.confidence * (0.5 + matchCount * 0.1)
    return { instinct: inst, score }
  })

  return scored
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.instinct)
}

export function formatInstinctsAsContext(instincts: Instinct[]): string {
  if (instincts.length === 0) return ''
  return `\n\n## Relevant Learned Patterns (Instincts)\n${
    instincts.map(i => `- **${i.name}**: ${i.pattern} → ${i.action}`).join('\n')
  }\n`
}
