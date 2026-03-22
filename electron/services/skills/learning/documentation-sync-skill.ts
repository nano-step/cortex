import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const DOC_KEYWORDS = [
  'documentation', 'docs', 'readme', 'stale docs', 'update docs',
  'sync docs', 'document', 'jsdoc', 'typedoc', 'out of date',
  'outdated docs', 'missing docs'
]

interface DocChunk {
  content: string
  relative_path: string
  chunk_type: string
  name: string | null
}

function findDocFiles(projectId: string): DocChunk[] {
  const db = getDb()
  return db.prepare(
    `SELECT content, relative_path, chunk_type, name FROM chunks
     WHERE project_id = ? AND (
       relative_path LIKE '%.md'
       OR relative_path LIKE '%README%'
       OR chunk_type = 'comment'
     )
     ORDER BY relative_path LIMIT 20`
  ).all(projectId) as DocChunk[]
}

function findRecentCode(projectId: string): DocChunk[] {
  const db = getDb()
  return db.prepare(
    `SELECT content, relative_path, chunk_type, name FROM chunks
     WHERE project_id = ? AND chunk_type IN ('function', 'class', 'interface', 'method', 'export')
     ORDER BY created_at DESC LIMIT 30`
  ).all(projectId) as DocChunk[]
}

export function createDocumentationSyncSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'documentation-sync',
    version: '4.0.0',
    category: 'learning',
    priority: 'p1',
    description: 'Detects stale documentation by comparing code with existing docs and generates update suggestions',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return DOC_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const [docFiles, recentCode, searchResults] = await Promise.all([
          Promise.resolve(findDocFiles(input.projectId)),
          Promise.resolve(findRecentCode(input.projectId)),
          hybridSearch(input.projectId, input.query, 10).catch(() => [])
        ])

        if (docFiles.length === 0 && recentCode.length === 0) {
          return { content: 'No documentation or code files found to analyze.' }
        }

        const docsContext = docFiles
          .map(d => `=== ${d.relative_path} ===\n${d.content.slice(0, 2000)}`)
          .join('\n\n')

        const codeContext = recentCode
          .map(c => `${c.relative_path} (${c.chunk_type}${c.name ? ': ' + c.name : ''}):\n${c.content.slice(0, 500)}`)
          .join('\n\n')

        const additionalContext = searchResults
          .map(r => `${r.relativePath}: ${r.content.slice(0, 300)}`)
          .join('\n\n')

        const messages = [
          {
            role: 'system',
            content: `You are a documentation auditor. Compare code with its documentation and identify gaps.

ANALYSIS:
1. **Undocumented code**: Functions/classes/interfaces with no JSDoc, docstring, or README mention
2. **Stale documentation**: Docs that don't match current code signatures, parameters, or behavior
3. **Missing README sections**: New features or modules not mentioned in README
4. **Incomplete API docs**: Public APIs without parameter/return type documentation

OUTPUT FORMAT:
# Documentation Sync Report

## Summary
- Documentation files analyzed: X
- Code symbols analyzed: X
- Issues found: X

## 🔴 Missing Documentation
| Symbol | File | Type | Suggested Doc |
|--------|------|------|---------------|

## 🟡 Stale Documentation
| Doc File | Issue | Current Code | Suggested Fix |
|----------|-------|--------------|---------------|

## 🟢 Well-Documented
- List of symbols with good documentation

## Suggested Updates
### [file.md]
\`\`\`markdown
[specific content to add/change]
\`\`\``
          },
          {
            role: 'user',
            content: `${input.query}\n\n=== DOCUMENTATION ===\n${docsContext}\n\n=== RECENT CODE ===\n${codeContext}\n\n=== ADDITIONAL CONTEXT ===\n${additionalContext}`
          }
        ]

        const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
          body: JSON.stringify({ model: 'gemini-2.5-flash', messages, stream: false, temperature: 0.2, max_tokens: 4096 })
        })

        if (!response.ok) throw new Error(`LLM error: ${response.status}`)

        const data = await response.json() as { choices: Array<{ message: { content: string } }> }
        const content = data.choices?.[0]?.message?.content || 'Analysis failed.'

        const missingCount = (content.match(/🔴|Missing Documentation/g) || []).length
        const staleCount = (content.match(/🟡|Stale Documentation/g) || []).length

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: {
            docsAnalyzed: docFiles.length,
            codeSymbolsAnalyzed: recentCode.length,
            missingDocs: missingCount,
            staleDocs: staleCount
          },
          suggestedFollowups: [
            'Generate JSDoc for undocumented functions',
            'Update README with new features',
            'Create API documentation'
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
