import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { executeCode, type ExecutionResult } from './code-executor'

const PERF_KEYWORDS = [
  'performance', 'benchmark', 'profil', 'slow', 'optimize',
  'bottleneck', 'latency', 'memory', 'cpu', 'n+1',
  'time complexity', 'speed', 'faster'
]

interface PerfAnalysis {
  perspective: string
  content: string
}

async function callLLM(systemPrompt: string, userContent: string, temperature: number = 0.1): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false,
      temperature,
      max_tokens: 3072
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

function extractCodeBlock(text: string): string | null {
  const match = text.match(/```(?:javascript|typescript|js|ts)?\n([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

export function createPerformanceProfilerSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'performance-profiler',
    version: '4.0.0',
    category: 'agent',
    priority: 'p1',
    description: 'Analyzes code for performance issues, optionally runs benchmarks, and suggests optimizations',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return PERF_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const codeResults = await hybridSearch(input.projectId, input.query, 12)

        const codeContext = codeResults
          .map(c => `${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}) L${c.lineStart}-${c.lineEnd}:\n${c.content}`)
          .join('\n\n---\n\n')

        const analysisResults = await Promise.allSettled([
          callLLM(
            `You are a performance analysis expert. Identify performance issues in code.

CHECK FOR:
- Time complexity issues (O(n²), nested loops over large datasets)
- N+1 query patterns (DB queries in loops)
- Memory leaks (event listeners, timers, subscriptions not cleaned up)
- Unnecessary allocations in hot paths
- Synchronous I/O blocking async contexts
- Missing memoization/caching for expensive computations
- Large bundle imports (importing entire library for one function)
- React: unnecessary re-renders, missing useMemo/useCallback
- Missing database indexes for frequent queries
- Unbounded list operations (no pagination/limit)

For each issue: specify file, line range, severity (CRITICAL/HIGH/MEDIUM/LOW), and explanation.`,
            `Analyze performance:\n${input.query}\n\n=== CODE ===\n${codeContext}`
          ),
          callLLM(
            `You are a performance optimization expert. Given code and identified issues, suggest specific optimizations.

For each optimization:
1. Show the BEFORE code snippet
2. Show the AFTER code snippet
3. Explain the expected improvement (with estimated complexity change if applicable)
4. Note any tradeoffs (memory vs speed, readability, etc.)`,
            `Suggest optimizations for:\n${input.query}\n\n=== CODE ===\n${codeContext}`,
            0.3
          )
        ])

        const analyses: PerfAnalysis[] = [
          {
            perspective: 'Static Analysis',
            content: analysisResults[0].status === 'fulfilled' ? analysisResults[0].value : 'Analysis failed'
          },
          {
            perspective: 'Optimization Suggestions',
            content: analysisResults[1].status === 'fulfilled' ? analysisResults[1].value : 'Suggestions failed'
          }
        ]

        let benchmarkResult: ExecutionResult | null = null
        const wantsBenchmark = /benchmark|measure|profile|time/.test(input.query.toLowerCase())

        if (wantsBenchmark) {
          const codeBlock = extractCodeBlock(input.query)
          if (codeBlock) {
            const benchmarkWrapper = `
const start = performance.now();
for (let i = 0; i < 1000; i++) {
${codeBlock}
}
const elapsed = performance.now() - start;
console.log(JSON.stringify({ iterations: 1000, totalMs: elapsed.toFixed(2), avgMs: (elapsed / 1000).toFixed(4) }));
`
            try {
              benchmarkResult = await executeCode(benchmarkWrapper, 'javascript', { timeout: 10000 })
            } catch {
              benchmarkResult = null
            }
          }
        }

        const report: string[] = ['# Performance Analysis Report\n']

        for (const analysis of analyses) {
          report.push(`## ${analysis.perspective}\n`)
          report.push(analysis.content)
          report.push('')
        }

        if (benchmarkResult) {
          report.push('## Benchmark Results\n')
          if (benchmarkResult.exitCode === 0) {
            report.push(`\`\`\`\n${benchmarkResult.stdout}\n\`\`\``)
          } else {
            report.push(`Benchmark failed:\n\`\`\`\n${benchmarkResult.stderr}\n\`\`\``)
          }
        }

        const fullReport = report.join('\n')
        const issueCount = (fullReport.match(/CRITICAL|HIGH|MEDIUM/g) || []).length

        updateMetrics(Date.now() - start, true)
        return {
          content: fullReport,
          metadata: {
            issuesFound: issueCount,
            filesAnalyzed: codeResults.length,
            benchmarkRun: benchmarkResult !== null,
            benchmarkSuccess: benchmarkResult?.exitCode === 0
          },
          suggestedFollowups: [
            'Run a benchmark on the suggested optimization',
            'Generate performance tests',
            'Analyze memory usage patterns'
          ]
        }
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
