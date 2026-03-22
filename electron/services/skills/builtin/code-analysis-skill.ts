/**
 * Code Analysis Skill — Wraps architecture analyzer and impact analyzer
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { analyzeArchitecture } from '../../architecture-analyzer'
import { analyzeImpact } from '../../impact-analyzer'

const ANALYSIS_KEYWORDS = ['architecture', 'impact', 'dependency', 'structure', 'analyze', 'diagram', 'module', 'entry point', 'hub']

export function createCodeAnalysisSkill(): CortexSkill {
  let metrics: SkillMetrics = {
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    lastUsed: null
  }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'code-analysis',
    version: '4.0.0',
    category: 'code',
    priority: 'p0',
    description: 'Analyzes code architecture, dependencies, impact, and structure',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return ANALYSIS_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const lower = input.query.toLowerCase()
        let content: string

        if (lower.includes('impact') || lower.includes('change')) {
          // Impact analysis
          const filePath = extractFilePath(input.query)
          if (filePath) {
            const impact = analyzeImpact(input.projectId, filePath)
            content = formatImpactAnalysis(impact)
          } else {
            content = 'Please specify a file path for impact analysis.'
          }
        } else {
          // Architecture analysis
          const analysis = analyzeArchitecture(input.projectId)
          content = formatArchitectureAnalysis(analysis)
        }

        updateMetrics(Date.now() - start, true)
        return { content }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},

    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}

function extractFilePath(query: string): string | null {
  // Simple extraction: look for file-like paths
  const match = query.match(/[\w./\-]+\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|rb|php)/)
  return match ? match[0] : null
}

function formatArchitectureAnalysis(analysis: { entryPoints: string[], hubFiles: { path: string, importedBy: number }[], layers: { name: string, files: string[] }[], stats: { totalFiles: number, totalFunctions: number, totalClasses: number, totalInterfaces: number } }): string {
  const parts: string[] = ['## Architecture Analysis\n']

  parts.push(`### Stats`)
  parts.push(`- Files: ${analysis.stats.totalFiles}`)
  parts.push(`- Functions: ${analysis.stats.totalFunctions}`)
  parts.push(`- Classes: ${analysis.stats.totalClasses}`)
  parts.push(`- Interfaces: ${analysis.stats.totalInterfaces}\n`)

  if (analysis.entryPoints.length > 0) {
    parts.push('### Entry Points')
    analysis.entryPoints.forEach(ep => parts.push(`- ${ep}`))
    parts.push('')
  }

  if (analysis.hubFiles.length > 0) {
    parts.push('### Hub Files (most imported)')
    analysis.hubFiles.slice(0, 10).forEach(h => parts.push(`- ${h.path} (imported by ${h.importedBy} files)`))
    parts.push('')
  }

  if (analysis.layers.length > 0) {
    parts.push('### Layers')
    analysis.layers.forEach(l => parts.push(`- **${l.name}**: ${l.files.length} files`))
  }

  return parts.join('\n')
}

function formatImpactAnalysis(impact: { directDependents: string[], transitiveDependents: string[], riskScore: number }): string {
  const parts: string[] = ['## Impact Analysis\n']

  parts.push(`### Risk Score: ${(impact.riskScore * 100).toFixed(0)}%\n`)

  parts.push('### Direct Dependents')
  if (impact.directDependents.length > 0) {
    impact.directDependents.forEach(d => parts.push(`- ${d}`))
  } else {
    parts.push('- None')
  }
  parts.push('')

  parts.push('### Transitive Dependents')
  if (impact.transitiveDependents.length > 0) {
    impact.transitiveDependents.slice(0, 20).forEach(d => parts.push(`- ${d}`))
  } else {
    parts.push('- None')
  }

  return parts.join('\n')
}