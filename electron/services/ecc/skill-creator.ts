import { loadInstincts, type Instinct } from '../skills/learning/instinct-system'
import { getDb } from '../db'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface SkillTemplate {
  name: string
  description: string
  category: string
  workflow: string[]
  constraints: string[]
  source: 'instinct' | 'pattern' | 'manual'
  confidence: number
}

function getSkillsDir(): string {
  const dir = join(app.getPath('userData'), 'cortex-data', 'custom-skills')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function createSkillFromInstincts(instincts: Instinct[], skillName: string): SkillTemplate {
  const patterns = instincts.map(i => i.pattern)
  const actions = instincts.map(i => i.action)
  const avgConfidence = instincts.reduce((sum, i) => sum + i.confidence, 0) / instincts.length

  return {
    name: skillName,
    description: `Auto-generated skill from ${instincts.length} learned instincts`,
    category: 'evolved',
    workflow: actions,
    constraints: patterns,
    source: 'instinct',
    confidence: avgConfidence
  }
}

export function createSkillFromPatterns(projectId: string, category: string): SkillTemplate | null {
  const db = getDb()
  const crystals = db.prepare(`
    SELECT content, crystal_type, confidence FROM knowledge_crystals
    WHERE project_id = ? AND crystal_type IN ('pattern', 'decision', 'code_pattern')
    AND confidence >= 0.6
    ORDER BY confidence DESC, reinforcement_count DESC
    LIMIT 10
  `).all(projectId) as Array<{ content: string; crystal_type: string; confidence: number }>

  if (crystals.length < 3) return null

  const workflow = crystals.map(c => c.content.slice(0, 200))
  const avgConfidence = crystals.reduce((sum, c) => sum + c.confidence, 0) / crystals.length

  return {
    name: `${category}-patterns`,
    description: `Patterns extracted from project knowledge crystals`,
    category,
    workflow,
    constraints: [],
    source: 'pattern',
    confidence: avgConfidence
  }
}

export function saveSkillTemplate(template: SkillTemplate): string {
  const dir = getSkillsDir()
  const fileName = `${template.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md`
  const filePath = join(dir, fileName)

  const content = [
    `# ${template.name}`,
    '',
    `> ${template.description}`,
    `> Source: ${template.source} | Confidence: ${(template.confidence * 100).toFixed(0)}%`,
    '',
    '## Workflow',
    ...template.workflow.map((step, i) => `${i + 1}. ${step}`),
    '',
    ...(template.constraints.length > 0 ? [
      '## When to Apply',
      ...template.constraints.map(c => `- ${c}`),
      ''
    ] : [])
  ].join('\n')

  writeFileSync(filePath, content, 'utf-8')
  console.log(`[SkillCreator] Saved skill template: ${filePath}`)
  return filePath
}

export function listCustomSkills(): Array<{ name: string; path: string }> {
  const dir = getSkillsDir()
  if (!existsSync(dir)) return []
  const { readdirSync } = require('fs')
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'))
  return files.map((f: string) => ({ name: f.replace('.md', ''), path: join(dir, f) }))
}
