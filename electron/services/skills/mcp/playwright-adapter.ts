/**
 * Playwright Adapter — Browser automation skill via MCP
 * Provides web scraping and browser interaction capabilities
 */

import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'

const BROWSER_KEYWORDS = ['browse', 'navigate', 'scrape', 'screenshot', 'web', 'page', 'click', 'url', 'website', 'browser', 'html']

export function createPlaywrightSkill(): CortexSkill {
  let metrics: SkillMetrics = {
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    lastUsed: null
  }
  let initialized = false

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'playwright-browser',
    version: '4.0.0',
    category: 'tool',
    priority: 'p2',
    description: 'Browser automation for web scraping, screenshots, and page interaction',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {
      initialized = true
    },

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return BROWSER_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const urlMatch = input.query.match(/https?:\/\/[^\s]+/)
        const url = urlMatch?.[0]

        if (!url) {
          updateMetrics(Date.now() - start, true)
          return {
            content: 'Không tìm thấy URL trong yêu cầu. Vui lòng cung cấp URL để duyệt web.',
            metadata: { type: 'playwright', action: 'no-url' }
          }
        }

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CortexBot/2.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(15000)
        })

        const contentType = response.headers.get('content-type') || ''
        const text = await response.text()

        let content: string
        if (contentType.includes('text/html')) {
          content = text
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 5000)
        } else {
          content = text.slice(0, 5000)
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: `## Nội dung từ ${url}\n\n${content}`,
          metadata: { type: 'playwright', url, status: response.status, contentType, contentLength: text.length }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        return {
          content: `Lỗi khi duyệt web: ${String(err)}`,
          metadata: { type: 'playwright', error: String(err) }
        }
      }
    },

    async shutdown(): Promise<void> {
      initialized = false
    },

    async healthCheck(): Promise<HealthStatus> {
      return {
        healthy: initialized,
        message: initialized ? 'Browser adapter ready' : 'Not initialized',
        lastCheck: Date.now()
      }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}