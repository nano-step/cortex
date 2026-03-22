import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { routeToModel, classifyComplexity } from './model-router'
import { listModels, type ModelDefinition } from './model-registry'

interface RoutingHistory {
  query: string
  complexity: string
  modelId: string | null
  timestamp: number
}

export function createModelRouterSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }
  const routingHistory: RoutingHistory[] = []
  const MAX_HISTORY = 200

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  function recordRouting(query: string, complexity: string, modelId: string | null): void {
    routingHistory.push({ query: query.slice(0, 100), complexity, modelId, timestamp: Date.now() })
    if (routingHistory.length > MAX_HISTORY) {
      routingHistory.splice(0, routingHistory.length - MAX_HISTORY)
    }
  }

  function getRoutingStats(): Record<string, number> {
    const stats: Record<string, number> = { simple: 0, moderate: 0, complex: 0, expert: 0 }
    for (const entry of routingHistory) {
      stats[entry.complexity] = (stats[entry.complexity] || 0) + 1
    }
    return stats
  }

  function estimateCostSavings(): { totalRouted: number, estimatedSavings: string } {
    let cheapRoutes = 0
    for (const entry of routingHistory) {
      if (entry.complexity === 'simple' || entry.complexity === 'moderate') {
        cheapRoutes++
      }
    }
    const savingsPercent = routingHistory.length > 0
      ? ((cheapRoutes / routingHistory.length) * 60).toFixed(1)
      : '0'
    return {
      totalRouted: routingHistory.length,
      estimatedSavings: `~${savingsPercent}% cost reduction from intelligent routing`
    }
  }

  return {
    name: 'model-router',
    version: '4.0.0',
    category: 'efficiency',
    priority: 'p0',
    description: 'Model router: classifies query complexity and recommends optimal model for cost/quality balance',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {
      console.log('[ModelRouterSkill] Initialized. Available models:', listModels().length)
    },

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      if (/\b(which model|recommend model|model for|routing stats|cost savings|model status)\b/.test(lower)) return true
      if (input.mode === 'route' || input.context?.needsRouting === true) return true
      return false
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const lower = input.query.toLowerCase()

        if (/\b(routing stats|cost savings|model status)\b/.test(lower)) {
          const stats = getRoutingStats()
          const savings = estimateCostSavings()
          const allModels = listModels()

          const modelsTable = allModels.map((m: ModelDefinition) =>
            `| ${m.name} | ${m.provider} | ${m.tier} | $${m.costPer1kTokens}/1k | ${(m.qualityScore * 100).toFixed(0)}% |`
          ).join('\n')

          updateMetrics(Date.now() - start, true)
          return {
            content: `## Model Router Statistics\n\n` +
              `### Routing Distribution\n` +
              `| Complexity | Count |\n|---|---|\n` +
              Object.entries(stats).map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n' +
              `### Cost Analysis\n` +
              `- Total queries routed: ${savings.totalRouted}\n` +
              `- ${savings.estimatedSavings}\n\n` +
              `### Available Models\n` +
              `| Model | Provider | Tier | Cost | Quality |\n|---|---|---|---|---|\n` +
              modelsTable,
            metadata: { stats, savings, modelCount: allModels.length }
          }
        }

        const context = typeof input.context?.codeContext === 'string' ? input.context.codeContext : undefined
        const { model, complexity } = routeToModel(input.query, context)

        recordRouting(input.query, complexity, model?.id || null)

        if (!model) {
          updateMetrics(Date.now() - start, true)
          return {
            content: `Query classified as **${complexity}** complexity, but no suitable model found in registry.`,
            metadata: { complexity, model: null, routed: false }
          }
        }

        const recommendation = `**Complexity**: ${complexity}\n**Recommended model**: ${model.name} (${model.provider})\n**Cost**: $${model.costPer1kTokens}/1k tokens\n**Quality score**: ${(model.qualityScore * 100).toFixed(0)}%\n**Max tokens**: ${model.maxTokens.toLocaleString()}`

        updateMetrics(Date.now() - start, true)
        return {
          content: recommendation,
          metadata: {
            complexity,
            recommendedModel: model.id,
            modelName: model.name,
            provider: model.provider,
            costPer1kTokens: model.costPer1kTokens,
            qualityScore: model.qualityScore,
            maxTokens: model.maxTokens,
            routed: true
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {
      const stats = getRoutingStats()
      console.log('[ModelRouterSkill] Shutdown. Routing history:', stats)
    },

    async healthCheck(): Promise<HealthStatus> {
      const modelCount = listModels().length
      return {
        healthy: modelCount > 0,
        message: modelCount > 0 ? `${modelCount} models registered` : 'No models in registry',
        lastCheck: Date.now()
      }
    },

    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}
