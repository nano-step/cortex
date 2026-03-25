import { loadInstincts, saveInstinct, type Instinct } from '../skills/learning/instinct-system'
import { readFileSync, writeFileSync } from 'fs'

export interface InstinctExport {
  version: 1
  exportedAt: number
  instincts: Instinct[]
  metadata: { totalCount: number; avgConfidence: number }
}

export function exportInstincts(minConfidence: number = 0): InstinctExport {
  const all = loadInstincts()
  const filtered = minConfidence > 0 ? all.filter(i => i.confidence >= minConfidence) : all
  const avgConfidence = filtered.length > 0
    ? filtered.reduce((sum, i) => sum + i.confidence, 0) / filtered.length
    : 0

  return {
    version: 1,
    exportedAt: Date.now(),
    instincts: filtered,
    metadata: { totalCount: filtered.length, avgConfidence }
  }
}

export function exportInstinctsToFile(filePath: string, minConfidence: number = 0): number {
  const data = exportInstincts(minConfidence)
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return data.instincts.length
}

export function importInstinctsFromFile(filePath: string): { imported: number; skipped: number; errors: number } {
  const raw = readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw) as InstinctExport

  if (data.version !== 1 || !Array.isArray(data.instincts)) {
    throw new Error('Invalid instinct export format')
  }

  return importInstincts(data.instincts)
}

export function importInstincts(instincts: Instinct[]): { imported: number; skipped: number; errors: number } {
  const existing = loadInstincts()
  const existingPatterns = new Set(existing.map(i => i.pattern.toLowerCase().trim()))

  let imported = 0
  let skipped = 0
  let errors = 0

  for (const instinct of instincts) {
    try {
      if (existingPatterns.has(instinct.pattern.toLowerCase().trim())) {
        skipped++
        continue
      }

      const importedInstinct: Instinct = {
        ...instinct,
        id: `imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        useCount: 0,
        lastUsed: null,
        confidence: Math.min(instinct.confidence, 0.6)
      }

      saveInstinct(importedInstinct)
      existingPatterns.add(instinct.pattern.toLowerCase().trim())
      imported++
    } catch {
      errors++
    }
  }

  console.log(`[InstinctIO] Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`)
  return { imported, skipped, errors }
}
