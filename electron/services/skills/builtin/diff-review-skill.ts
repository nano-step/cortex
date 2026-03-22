import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDiff, getStatus } from '../agent/git-actions'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getDb } from '../../db'

const REVIEW_KEYWORDS = ['review diff', 'review pr', 'pull request', 'code review', 'review changes', 'pr review', 'review code', 'diff review']

interface ReviewAnalysis {
  perspective: string
  content: string
  status: 'fulfilled' | 'rejected'
}

const PERSPECTIVES = [
  {
    name: 'security',
    prompt: `You are a security reviewer. Analyze this diff for:
- OWASP Top 10 vulnerabilities
- Input validation gaps
- Authentication/authorization issues
- Injection risks (SQL, XSS, command)
- Sensitive data exposure
- Insecure dependencies

Rate each finding: CRITICAL / WARNING / INFO
Include file path and line context for each finding.`
  },
  {
    name: 'quality',
    prompt: `You are a code quality reviewer. Analyze this diff for:
- SOLID principle violations
- Naming conventions and readability
- Error handling completeness
- Type safety (no implicit any, proper null checks)
- Code duplication (DRY)
- Function complexity (cyclomatic)
- Missing or incorrect types

Rate each finding: CRITICAL / WARNING / SUGGESTION`
  },
  {
    name: 'performance',
    prompt: `You are a performance reviewer. Analyze this diff for:
- N+1 query patterns
- Unnecessary re-renders (React)
- Memory leaks (event listeners, timers, subscriptions)
- Expensive operations in hot paths
- Missing memoization or caching
- Bundle size impact (large imports)
- Synchronous I/O in async contexts

Rate each finding: CRITICAL / WARNING / SUGGESTION`
  },
  {
    name: 'testing',
    prompt: `You are a test coverage reviewer. Analyze this diff for:
- New code paths without test coverage
- Edge cases that should be tested
- Modified behavior that may break existing tests
- Integration points that need contract tests
- Error paths that need negative tests

For each untested path, suggest a specific test case.`
  }
]

async function callLLM(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false,
      temperature: 0.1,
      max_tokens: 2048
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

function getRepoPath(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT source_path FROM repositories WHERE project_id = ? AND source_type = ? LIMIT 1'
  ).get(projectId, 'local') as { source_path: string } | undefined
  return row?.source_path || null
}

export function createDiffReviewSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'diff-review',
    version: '4.0.0',
    category: 'code',
    priority: 'p0',
    description: 'Reviews git diffs with multi-perspective parallel analysis (security, quality, performance, testing)',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return REVIEW_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const repoPath = getRepoPath(input.projectId)
        if (!repoPath) {
          return { content: 'No local repository found for this project. Diff review requires a local repo.' }
        }

        let diff = await getDiff(repoPath, false).catch(() => '')
        if (!diff.trim()) {
          diff = await getDiff(repoPath, true).catch(() => '')
        }
        if (!diff.trim()) {
          return { content: 'No changes detected. Both working tree and staging area are clean.' }
        }

        const status = await getStatus(repoPath).catch(() => '')

        const functionNames = diff.match(/(?:function|def|func|fn)\s+(\w+)/g)?.slice(0, 5) || []
        const searchQuery = functionNames.join(' ') || 'changed functions'
        const relatedCode = await hybridSearch(input.projectId, searchQuery, 8).catch(() => [])

        const codeContext = relatedCode
          .map(c => `${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}): ${c.content.slice(0, 500)}`)
          .join('\n\n')

        const userContent = `=== GIT STATUS ===\n${status}\n\n=== DIFF ===\n${diff.slice(0, 12000)}\n\n=== RELATED CODE CONTEXT ===\n${codeContext.slice(0, 4000)}`

        const results = await Promise.allSettled(
          PERSPECTIVES.map(p => callLLM(p.prompt, userContent))
        )

        const analyses: ReviewAnalysis[] = results.map((r, i) => ({
          perspective: PERSPECTIVES[i].name,
          content: r.status === 'fulfilled' ? r.value : `Analysis failed: ${(r as PromiseRejectedResult).reason}`,
          status: r.status
        }))

        let criticalCount = 0
        let warningCount = 0
        const report: string[] = ['# Diff Review Report\n']

        report.push(`| Metric | Value |`)
        report.push(`|--------|-------|`)
        report.push(`| Files Changed | ${status.split('\n').filter(Boolean).length} |`)
        report.push(`| Perspectives | ${analyses.filter(a => a.status === 'fulfilled').length}/${PERSPECTIVES.length} |`)
        report.push(`| Duration | ${Date.now() - start}ms |\n`)

        for (const analysis of analyses) {
          report.push(`## ${analysis.perspective.charAt(0).toUpperCase() + analysis.perspective.slice(1)} Analysis\n`)
          report.push(analysis.content)
          report.push('')

          const upperContent = analysis.content.toUpperCase()
          criticalCount += (upperContent.match(/CRITICAL/g) || []).length
          warningCount += (upperContent.match(/WARNING/g) || []).length
        }

        report.push(`\n---\n## Summary: ${criticalCount} critical, ${warningCount} warnings`)

        updateMetrics(Date.now() - start, true)
        return {
          content: report.join('\n'),
          metadata: {
            filesChanged: status.split('\n').filter(Boolean).length,
            criticalIssues: criticalCount,
            warnings: warningCount,
            perspectives: analyses.map(a => a.perspective)
          }
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
