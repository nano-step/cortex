import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const AUDIT_KEYWORDS = ['dependency', 'dependencies', 'audit', 'outdated', 'vulnerability', 'cve', 'license', 'npm audit', 'security audit', 'supply chain', 'package audit']

const DEP_FILE_PATTERNS = [
  '%package.json', '%requirements.txt', '%Cargo.toml', '%go.mod',
  '%Gemfile', '%pom.xml', '%build.gradle', '%pyproject.toml',
  '%composer.json', '%Pipfile'
]

interface DepFileRow {
  content: string
  relative_path: string
  repo_id: string
}

interface RepoRow {
  id: string
  source_path: string
  source_type: string
}

function findDependencyFiles(projectId: string): DepFileRow[] {
  const db = getDb()
  const conditions = DEP_FILE_PATTERNS.map(() => 'relative_path LIKE ?').join(' OR ')
  return db.prepare(
    `SELECT content, relative_path, repo_id FROM chunks
     WHERE project_id = ? AND (${conditions}) AND chunk_type = 'module'
     LIMIT 15`
  ).all(projectId, ...DEP_FILE_PATTERNS) as DepFileRow[]
}

function getRepos(projectId: string): RepoRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT id, source_path, source_type FROM repositories WHERE project_id = ?'
  ).all(projectId) as RepoRow[]
}

export function createDependencyAuditSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'dependency-audit',
    version: '4.0.0',
    category: 'code',
    priority: 'p1',
    description: 'Audits project dependencies for outdated packages, known vulnerabilities, and license issues',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return AUDIT_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const repos = getRepos(input.projectId)
        const depFiles = findDependencyFiles(input.projectId)

        if (depFiles.length === 0) {
          return { content: 'No dependency files found (package.json, requirements.txt, Cargo.toml, etc.).' }
        }

        const repoPathMap = new Map<string, string>()
        for (const repo of repos) {
          repoPathMap.set(repo.id, repo.source_path.split('/').pop() || repo.id)
        }

        const depContext = depFiles.map(f => {
          const repoName = repoPathMap.get(f.repo_id) || 'unknown'
          return `=== ${repoName} / ${f.relative_path} ===\n${f.content.slice(0, 3000)}`
        }).join('\n\n')

        const messages = [
          {
            role: 'system',
            content: `You are a dependency security auditor. Analyze dependency files and provide a structured audit report.

For each dependency file, assess:
1. **Outdated packages**: Identify packages likely to have newer major versions
2. **Security concerns**: Flag packages with known vulnerability patterns (eval, prototype pollution, etc.)
3. **License risks**: Identify GPL, AGPL, or other copyleft licenses that may conflict with commercial use
4. **Maintenance status**: Flag packages that appear unmaintained (very old, no recent activity patterns)
5. **Redundancy**: Identify packages that overlap in functionality

OUTPUT FORMAT:
# Dependency Audit Report

## Summary
- Total packages analyzed: X
- High risk: X
- Medium risk: X
- Low risk: X

## Findings by Repository
### [repo name] — [file]
| Package | Version | Risk | Issue | Recommendation |
|---------|---------|------|-------|----------------|

## Action Items (Priority Order)
1. [CRITICAL] ...
2. [HIGH] ...
3. [MEDIUM] ...`
          },
          { role: 'user', content: `Audit these dependencies:\n\n${depContext}` }
        ]

        const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
          body: JSON.stringify({ model: 'gemini-2.5-flash', messages, stream: false, temperature: 0.1, max_tokens: 4096 })
        })

        if (!response.ok) throw new Error(`LLM error: ${response.status}`)

        const data = await response.json() as { choices: Array<{ message: { content: string } }> }
        const content = data.choices?.[0]?.message?.content || 'Audit failed.'

        const upperContent = content.toUpperCase()
        const criticalCount = (upperContent.match(/CRITICAL/g) || []).length
        const highCount = (upperContent.match(/\bHIGH\b/g) || []).length

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: {
            reposAudited: repos.length,
            depFilesFound: depFiles.length,
            criticalIssues: criticalCount,
            highIssues: highCount
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
