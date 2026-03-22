import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDiff, getStatus } from '../agent/git-actions'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey, getServiceConfig } from '../../settings-service'
import { getDb } from '../../db'

const PR_KEYWORDS = ['pr review', 'pull request', 'code review', 'review pr', 'review my code', 'review this', 'review changes', 'review commit']
const GITHUB_PR_REGEX = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i
const GITHUB_API = 'https://api.github.com'

const REVIEW_PHASES = [
  {
    name: 'security',
    system: `You are a senior security engineer performing a code review. Analyze for:
- OWASP Top 10 vulnerabilities (injection, XSS, CSRF, auth bypass)
- Input validation and sanitization gaps
- Sensitive data exposure (secrets, PII, tokens in code)
- Authentication/authorization flaws
- Insecure dependencies or patterns
- Race conditions and TOCTOU issues

For each finding, provide: severity (CRITICAL/WARNING/INFO), file path, line context, description, and fix suggestion.
If no issues found, say "No security issues detected."
Be thorough but avoid false positives.`
  },
  {
    name: 'quality',
    system: `You are a principal software engineer reviewing code quality. Analyze for:
- SOLID principle violations
- Type safety issues (implicit any, missing null checks, unsafe casts)
- Error handling gaps (empty catches, unhandled promises, missing error boundaries)
- Code duplication and DRY violations
- Naming clarity (ambiguous names, inconsistent conventions)
- Function complexity (>20 lines, deep nesting, too many params)
- Dead code or unreachable branches

Rate each finding: CRITICAL / WARNING / SUGGESTION.
Include specific line references and concrete fix examples.`
  },
  {
    name: 'performance',
    system: `You are a performance engineer reviewing code changes. Analyze for:
- N+1 query patterns or redundant DB calls
- Memory leaks (event listeners, timers, subscriptions not cleaned up)
- Expensive operations in hot paths (loops, renders, handlers)
- Missing memoization where beneficial (React useMemo/useCallback, caching)
- Large bundle imports (could use tree-shaking or dynamic import)
- Synchronous I/O blocking the event loop
- Unnecessary re-renders in React components

Rate each finding: CRITICAL / WARNING / SUGGESTION.
Focus on measurable impact, not micro-optimizations.`
  },
  {
    name: 'testing',
    system: `You are a QA architect reviewing test coverage. Analyze for:
- New code paths without test coverage
- Edge cases and boundary conditions that should be tested
- Modified behavior that could break existing tests
- Integration points needing contract tests
- Error paths needing negative tests
- Missing mock/stub for external dependencies

For each gap, provide a concrete test case suggestion with the test name and assertion.
If test files are included in the diff, also review test quality (assertions, isolation, naming).`
  }
]

async function callLLM(systemPrompt: string, userContent: string, maxTokens: number = 3072): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false,
      temperature: 0.1,
      max_tokens: maxTokens
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

async function generateFileSummary(diff: string): Promise<string> {
  return callLLM(
    `You are a code change summarizer. For each file in the diff, produce a one-line summary of what changed and why it matters. Format as a markdown table: | File | Change Type | Summary |. Change types: LOGIC, STYLE, REFACTOR, NEW, DELETE, CONFIG.`,
    `Summarize these changes:\n\n${diff.slice(0, 15000)}`,
    2048
  )
}

function parseGitHubPRUrl(query: string): { owner: string; repo: string; number: string; url: string } | null {
  const match = query.match(GITHUB_PR_REGEX)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: match[3], url: match[0] }
}

function resolveGitHubToken(): string | undefined {
  const settingsToken = getServiceConfig('github')?.token
  if (settingsToken) return settingsToken

  try {
    const db = getDb()
    const rows = db.prepare(
      "SELECT env FROM mcp_servers WHERE LOWER(name) LIKE '%github%' AND env IS NOT NULL"
    ).all() as Array<{ env: string }>
    for (const row of rows) {
      try {
        const env = JSON.parse(row.env) as Record<string, string>
        const pat = env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN
        if (pat) return pat
      } catch {}
    }
  } catch {}

  return undefined
}

interface GitHubPRFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

async function fetchPRFromGitHub(
  owner: string,
  repo: string,
  number: string,
  token?: string
): Promise<{ diff: string; status: string; changedFileCount: number; prTitle: string; prUrl: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Cortex-Desktop'
  }
  if (token) headers.Authorization = `token ${token}`

  const prResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  })
  if (!prResponse.ok) {
    if (prResponse.status === 404) throw new Error(`PR #${number} not found in ${owner}/${repo}. For private repos, configure GitHub token in Settings.`)
    if (prResponse.status === 403) throw new Error(`GitHub API forbidden. Configure GitHub token in Settings for higher rate limits.`)
    throw new Error(`GitHub API error: ${prResponse.status}`)
  }
  const prData = await prResponse.json() as { title: string; html_url: string }

  const filesResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(15000)
  })
  if (!filesResponse.ok) throw new Error(`Failed to fetch PR files: ${filesResponse.status}`)
  const files = await filesResponse.json() as GitHubPRFile[]

  const diffParts: string[] = []
  const statusLines: string[] = []

  for (const file of files) {
    const statusChar = file.status === 'added' ? 'A' : file.status === 'removed' ? 'D' : 'M'
    statusLines.push(`${statusChar}  ${file.filename}`)

    if (file.patch) {
      diffParts.push(`diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}`)
    }
  }

  return {
    diff: diffParts.join('\n\n'),
    status: statusLines.join('\n'),
    changedFileCount: files.length,
    prTitle: prData.title,
    prUrl: prData.html_url
  }
}

export function createPrReviewSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'pr-code-reviewer',
    version: '4.0.0',
    category: 'code',
    priority: 'p0',
    description: 'Deep PR/code review with 4 parallel perspectives (security, quality, performance, testing) and structured report generation',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      if (GITHUB_PR_REGEX.test(input.query)) return true
      return PR_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        let diff = ''
        let status = ''
        let changedFileCount = 0
        let reviewSource = 'local'
        let prTitle = ''
        let prUrl = ''

        const ghPR = parseGitHubPRUrl(input.query)

        if (ghPR) {
          reviewSource = 'github'
          const token = resolveGitHubToken()
          const prData = await fetchPRFromGitHub(ghPR.owner, ghPR.repo, ghPR.number, token)
          diff = prData.diff
          status = prData.status
          changedFileCount = prData.changedFileCount
          prTitle = prData.prTitle
          prUrl = prData.prUrl

          if (!diff.trim()) {
            return { content: `PR ${ghPR.owner}/${ghPR.repo}#${ghPR.number} has no file patches available from GitHub API.` }
          }
        } else {
          const repoPath = getRepoPath(input.projectId)
          if (!repoPath) {
            return { content: 'No local repository found and no GitHub PR URL provided. Provide a PR URL or open a project with a local repo.' }
          }

          diff = await getDiff(repoPath, false).catch(() => '')
          if (!diff.trim()) diff = await getDiff(repoPath, true).catch(() => '')
          if (!diff.trim()) {
            return { content: 'No changes detected. Both working tree and staging area are clean.\n\nTip: Provide a GitHub PR URL to review remote changes (e.g. `/review https://github.com/owner/repo/pull/123`).' }
          }

          status = await getStatus(repoPath).catch(() => '')
          changedFileCount = status.split('\n').filter(Boolean).length
        }

        const functionNames = diff.match(/(?:function|def|func|fn|class|interface)\s+(\w+)/g)?.slice(0, 8) || []
        const searchQuery = functionNames.join(' ') || 'changed functions'
        const relatedCode = await hybridSearch(input.projectId, searchQuery, 10).catch(() => [])
        const codeContext = relatedCode
          .map(c => `${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}): ${c.content.slice(0, 600)}`)
          .join('\n\n')

        const fileSummaryPromise = generateFileSummary(diff)

        const userContent = `=== GIT STATUS ===\n${status}\n\n=== DIFF ===\n${diff.slice(0, 15000)}\n\n=== RELATED CODE ===\n${codeContext.slice(0, 5000)}`

        const phaseResults = await Promise.allSettled(
          REVIEW_PHASES.map(phase => callLLM(phase.system, userContent))
        )

        const fileSummary = await fileSummaryPromise.catch(() => 'File summary generation failed.')

        let criticalCount = 0
        let warningCount = 0
        let suggestionCount = 0

        const report: string[] = []
        report.push('# PR Code Review Report\n')

        if (reviewSource === 'github' && prTitle) {
          report.push(`**PR:** [${prTitle}](${prUrl})\n`)
        }

        report.push('| Metric | Value |')
        report.push('|--------|-------|')
        report.push(`| Source | ${reviewSource === 'github' ? `GitHub PR` : 'Local diff'} |`)
        report.push(`| Files Changed | ${changedFileCount} |`)
        report.push(`| Review Phases | ${phaseResults.filter(r => r.status === 'fulfilled').length}/${REVIEW_PHASES.length} |`)
        report.push(`| Duration | ${Date.now() - start}ms |`)
        report.push('')

        report.push('## File-by-File Summary\n')
        report.push(fileSummary)
        report.push('')

        for (let i = 0; i < REVIEW_PHASES.length; i++) {
          const phase = REVIEW_PHASES[i]
          const result = phaseResults[i]
          const content = result.status === 'fulfilled' ? result.value : `Analysis failed: ${(result as PromiseRejectedResult).reason}`

          report.push(`## ${phase.name.charAt(0).toUpperCase() + phase.name.slice(1)} Analysis\n`)
          report.push(content)
          report.push('')

          const upper = content.toUpperCase()
          criticalCount += (upper.match(/CRITICAL/g) || []).length
          warningCount += (upper.match(/WARNING/g) || []).length
          suggestionCount += (upper.match(/SUGGESTION/g) || []).length
        }

        report.push('---')
        report.push(`## Summary: ${criticalCount} critical, ${warningCount} warnings, ${suggestionCount} suggestions\n`)

        if (criticalCount > 0) {
          report.push('**Recommendation:** ❌ REQUEST CHANGES — Critical issues must be addressed before merge.')
        } else if (warningCount > 3) {
          report.push('**Recommendation:** ⚠️ COMMENT — Several warnings should be reviewed.')
        } else {
          report.push('**Recommendation:** ✅ APPROVE — No blocking issues found.')
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: report.join('\n'),
          metadata: {
            source: reviewSource,
            filesChanged: changedFileCount,
            criticalIssues: criticalCount,
            warnings: warningCount,
            suggestions: suggestionCount,
            phases: REVIEW_PHASES.map(p => p.name),
            recommendation: criticalCount > 0 ? 'REQUEST_CHANGES' : warningCount > 3 ? 'COMMENT' : 'APPROVE'
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
