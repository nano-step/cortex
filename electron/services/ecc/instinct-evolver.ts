import { loadInstincts, saveInstinct, type Instinct } from '../skills/learning/instinct-system'
import { registerSkill } from '../skills/skill-registry'
import { getProxyUrl, getProxyKey } from '../settings-service'
import { getTrainingModel } from '../training/training-model'
import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../skills/types'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

interface InstinctCluster {
  name: string
  instincts: Instinct[]
  commonPattern: string
  suggestedSkillName: string
  confidence: number
}

function getEvolvedSkillsDir(): string {
  const dir = join(app.getPath('userData'), 'cortex-data', 'evolved-skills')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function extractWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
  )
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const word of a) { if (b.has(word)) overlap++ }
  return overlap / Math.max(a.size, b.size)
}

export function clusterInstincts(minClusterSize: number = 3, similarityThreshold: number = 0.4): InstinctCluster[] {
  const instincts = loadInstincts().filter(i => i.confidence >= 0.5)
  if (instincts.length < minClusterSize) return []

  const wordSets = instincts.map(i => extractWords(`${i.pattern} ${i.action}`))
  const assigned = new Set<number>()
  const clusters: InstinctCluster[] = []

  for (let i = 0; i < instincts.length; i++) {
    if (assigned.has(i)) continue

    const cluster: number[] = [i]
    assigned.add(i)

    for (let j = i + 1; j < instincts.length; j++) {
      if (assigned.has(j)) continue
      const similarity = wordOverlap(wordSets[i], wordSets[j])
      if (similarity >= similarityThreshold) {
        cluster.push(j)
        assigned.add(j)
      }
    }

    if (cluster.length >= minClusterSize) {
      const clusterInstincts = cluster.map(idx => instincts[idx])
      const allWords = new Map<string, number>()
      for (const idx of cluster) {
        for (const word of wordSets[idx]) {
          allWords.set(word, (allWords.get(word) || 0) + 1)
        }
      }
      const commonWords = Array.from(allWords.entries())
        .filter(([, count]) => count >= Math.ceil(cluster.length * 0.5))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word)

      const avgConfidence = clusterInstincts.reduce((sum, i) => sum + i.confidence, 0) / clusterInstincts.length

      clusters.push({
        name: commonWords.slice(0, 3).join('-') || 'unnamed-cluster',
        instincts: clusterInstincts,
        commonPattern: commonWords.join(', '),
        suggestedSkillName: `evolved-${commonWords.slice(0, 2).join('-')}`,
        confidence: avgConfidence
      })
    }
  }

  return clusters.sort((a, b) => b.instincts.length - a.instincts.length)
}

export async function evolveClusterToSkill(cluster: InstinctCluster): Promise<{ skillName: string; content: string } | null> {
  try {
    const instinctDescriptions = cluster.instincts
      .map(i => `- Pattern: ${i.pattern}\n  Action: ${i.action}\n  Confidence: ${i.confidence.toFixed(2)}`)
      .join('\n')

    const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
      body: JSON.stringify({
        model: getTrainingModel(),
        messages: [
          {
            role: 'system',
            content: `You synthesize learned behavioral patterns into a reusable skill definition.
Given a cluster of related instincts (pattern-action pairs), create a concise skill document that:
1. Names the skill clearly
2. Describes when to apply it
3. Lists the step-by-step workflow
4. Includes key rules and constraints
Return ONLY the skill content as markdown, starting with # Skill Name.`
          },
          {
            role: 'user',
            content: `Cluster: "${cluster.name}" (${cluster.instincts.length} instincts, avg confidence ${cluster.confidence.toFixed(2)})\nCommon themes: ${cluster.commonPattern}\n\nInstincts:\n${instinctDescriptions}`
          }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 2048
      }),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) return null
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content || ''
    if (!content || content.length < 50) return null

    const skillName = cluster.suggestedSkillName
    const skillPath = join(getEvolvedSkillsDir(), `${skillName}.md`)
    writeFileSync(skillPath, content, 'utf-8')

    console.log(`[InstinctEvolver] Evolved "${cluster.name}" → skill "${skillName}" (${cluster.instincts.length} instincts)`)
    return { skillName, content }
  } catch (err) {
    console.error('[InstinctEvolver] Evolution failed:', err)
    return null
  }
}

export async function evolveAllClusters(): Promise<Array<{ skillName: string; instinctCount: number }>> {
  const clusters = clusterInstincts()
  const results: Array<{ skillName: string; instinctCount: number }> = []

  for (const cluster of clusters) {
    const result = await evolveClusterToSkill(cluster)
    if (result) {
      results.push({ skillName: result.skillName, instinctCount: cluster.instincts.length })
    }
  }

  return results
}

export function getEvolutionStatus(): {
  totalInstincts: number
  eligibleForClustering: number
  clusters: Array<{ name: string; size: number; confidence: number }>
} {
  const all = loadInstincts()
  const eligible = all.filter(i => i.confidence >= 0.5)
  const clusters = clusterInstincts()

  return {
    totalInstincts: all.length,
    eligibleForClustering: eligible.length,
    clusters: clusters.map(c => ({ name: c.name, size: c.instincts.length, confidence: c.confidence }))
  }
}
