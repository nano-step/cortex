import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { initCacheSchema, getCachedResponse, cacheResponse, getCacheStats } from './semantic-cache'

export function createSemanticCacheSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }
  let cacheInitialized = false
  let similarityThreshold = 0.92
  let cacheHits = 0
  let cacheMisses = 0

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'semantic-cache',
    version: '4.0.0',
    category: 'efficiency',
    priority: 'p0',
    description: 'Semantic cache: intercepts queries and returns cached responses for semantically similar questions, saving tokens and latency',
    dependencies: [],

    async initialize(config: SkillConfig): Promise<void> {
      try {
        initCacheSchema()
        cacheInitialized = true
        if (typeof config.similarityThreshold === 'number') {
          similarityThreshold = config.similarityThreshold
        }
        console.log('[SemanticCacheSkill] Initialized with threshold:', similarityThreshold)
      } catch (err) {
        console.error('[SemanticCacheSkill] Init failed:', err)
        cacheInitialized = false
      }
    },

    canHandle(input: SkillInput): boolean {
      if (!cacheInitialized) return false
      const lower = input.query.toLowerCase()
      if (lower.length < 10) return false
      if (/\b(clear cache|invalidate|cache stats|cache status)\b/.test(lower)) return true
      return lower.length >= 15
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const lower = input.query.toLowerCase()

        if (/\b(cache stats|cache status)\b/.test(lower)) {
          const stats = getCacheStats()
          const hitRate = (cacheHits + cacheMisses) > 0
            ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1)
            : '0'

          updateMetrics(Date.now() - start, true)
          return {
            content: `## Semantic Cache Statistics\n\n` +
              `| Metric | Value |\n|---|---|\n` +
              `| Total cached entries | ${stats.totalEntries} |\n` +
              `| Total cache hits | ${stats.totalHits} |\n` +
              `| Total tokens saved | ${stats.totalTokensSaved.toLocaleString()} |\n` +
              `| Session hit rate | ${hitRate}% |\n` +
              `| Session hits / misses | ${cacheHits} / ${cacheMisses} |\n` +
              `| Similarity threshold | ${similarityThreshold} |`,
            metadata: { ...stats, sessionHits: cacheHits, sessionMisses: cacheMisses, hitRate }
          }
        }

        const cached = await getCachedResponse(input.query, similarityThreshold)

        if (cached) {
          cacheHits++
          updateMetrics(Date.now() - start, true)
          return {
            content: cached.response,
            metadata: {
              source: 'semantic-cache',
              cacheHit: true,
              tokensSaved: cached.tokensSaved,
              latencyMs: Date.now() - start,
              totalSessionHits: cacheHits
            }
          }
        }

        cacheMisses++
        updateMetrics(Date.now() - start, true)
        return {
          content: '',
          metadata: {
            source: 'semantic-cache',
            cacheHit: false,
            action: 'pass-through',
            hint: 'No cached response found. Route to appropriate skill and cache the result.'
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {
      console.log(`[SemanticCacheSkill] Shutting down. Session stats: ${cacheHits} hits, ${cacheMisses} misses`)
    },

    async healthCheck(): Promise<HealthStatus> {
      if (!cacheInitialized) {
        return { healthy: false, message: 'Cache schema not initialized', lastCheck: Date.now() }
      }
      try {
        const stats = getCacheStats()
        return {
          healthy: true,
          message: `${stats.totalEntries} entries, ${stats.totalHits} hits, ${stats.totalTokensSaved} tokens saved`,
          lastCheck: Date.now()
        }
      } catch {
        return { healthy: false, message: 'Failed to read cache stats', lastCheck: Date.now() }
      }
    },

    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}

export async function cacheSkillResponse(
  query: string,
  response: string,
  model: string,
  estimatedTokens: number
): Promise<void> {
  try {
    await cacheResponse(query, response, model, estimatedTokens)
  } catch (err) {
    console.error('[SemanticCacheSkill] Failed to cache response:', err)
  }
}
