import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

async function callLLM(systemPrompt: string, userContent: string, maxTokens: number = 4096): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false, temperature: 0.1, max_tokens: maxTokens
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

interface QualityDimension {
  name: string
  score: number
  grade: Grade
  issues: string[]
  suggestions: string[]
}

interface QualityReport {
  overallGrade: Grade
  overallScore: number
  dimensions: QualityDimension[]
  techDebtItems: string[]
  criticalIssues: string[]
  summary: string
}

function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

async function analyzeCodeQuality(code: string, filePath: string): Promise<QualityReport> {
  const result = await callLLM(
    `You are an expert code quality analyzer. Analyze the given code and return a JSON object with this exact structure:
{
  "dimensions": [
    {
      "name": "Complexity",
      "score": 0-100,
      "issues": ["issue1", ...],
      "suggestions": ["suggestion1", ...]
    },
    {
      "name": "SOLID Principles",
      "score": 0-100,
      "issues": ["specific violation description", ...],
      "suggestions": ["specific fix", ...]
    },
    {
      "name": "Error Handling",
      "score": 0-100,
      "issues": [...],
      "suggestions": [...]
    },
    {
      "name": "Naming & Readability",
      "score": 0-100,
      "issues": [...],
      "suggestions": [...]
    },
    {
      "name": "Type Safety",
      "score": 0-100,
      "issues": [...],
      "suggestions": [...]
    },
    {
      "name": "Performance",
      "score": 0-100,
      "issues": [...],
      "suggestions": [...]
    }
  ],
  "techDebtItems": ["debt item 1", ...],
  "criticalIssues": ["critical issue 1 that needs immediate attention", ...],
  "summary": "2-3 sentence overall assessment"
}

Be specific. Reference line numbers or function names when possible.
Return ONLY the JSON, no markdown wrapping.`,
    `File: ${filePath}\n\n${code}`
  )

  try {
    const parsed = JSON.parse(result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    const dimensions: QualityDimension[] = (parsed.dimensions || []).map((d: { name: string, score: number, issues: string[], suggestions: string[] }) => ({
      name: d.name,
      score: typeof d.score === 'number' ? Math.max(0, Math.min(100, d.score)) : 50,
      grade: scoreToGrade(typeof d.score === 'number' ? d.score : 50),
      issues: Array.isArray(d.issues) ? d.issues : [],
      suggestions: Array.isArray(d.suggestions) ? d.suggestions : []
    }))

    const overallScore = dimensions.length > 0
      ? Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length)
      : 50

    return {
      overallGrade: scoreToGrade(overallScore),
      overallScore,
      dimensions,
      techDebtItems: Array.isArray(parsed.techDebtItems) ? parsed.techDebtItems : [],
      criticalIssues: Array.isArray(parsed.criticalIssues) ? parsed.criticalIssues : [],
      summary: parsed.summary || 'Analysis complete.'
    }
  } catch {
    return {
      overallGrade: 'C',
      overallScore: 50,
      dimensions: [],
      techDebtItems: [],
      criticalIssues: ['Failed to parse analysis results'],
      summary: 'Code quality analysis encountered a parsing error.'
    }
  }
}

function formatReport(report: QualityReport, filePath: string): string {
  let output = `## Code Quality Report: ${filePath}\n\n`
  output += `### Overall: **${report.overallGrade}** (${report.overallScore}/100)\n\n`
  output += `${report.summary}\n\n`

  if (report.criticalIssues.length > 0) {
    output += `### 🚨 Critical Issues\n`
    for (const issue of report.criticalIssues) {
      output += `- ${issue}\n`
    }
    output += '\n'
  }

  output += `### Dimension Breakdown\n\n`
  output += `| Dimension | Grade | Score | Issues |\n|---|---|---|---|\n`
  for (const dim of report.dimensions) {
    output += `| ${dim.name} | ${dim.grade} | ${dim.score}/100 | ${dim.issues.length} |\n`
  }
  output += '\n'

  for (const dim of report.dimensions) {
    if (dim.issues.length === 0 && dim.suggestions.length === 0) continue
    output += `#### ${dim.name} (${dim.grade})\n`
    if (dim.issues.length > 0) {
      output += `**Issues:**\n`
      for (const issue of dim.issues) output += `- ❌ ${issue}\n`
    }
    if (dim.suggestions.length > 0) {
      output += `**Suggestions:**\n`
      for (const suggestion of dim.suggestions) output += `- 💡 ${suggestion}\n`
    }
    output += '\n'
  }

  if (report.techDebtItems.length > 0) {
    output += `### Tech Debt\n`
    for (const item of report.techDebtItems) {
      output += `- 📋 ${item}\n`
    }
  }

  return output
}

export function createCodeQualitySkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'code-quality',
    version: '4.0.0',
    category: 'code',
    priority: 'p1',
    description: 'Code quality analysis with complexity scoring, SOLID violation detection, tech debt identification, and A-F grading',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return /\b(code quality|code review|analyze quality|tech debt|solid|complexity|code smell|refactor suggestion|code health|quality report)\b/.test(lower)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const codeBlockMatch = input.query.match(/```[\w]*\n([\s\S]+?)```/)
        let codeToAnalyze: string
        let targetPath: string

        if (codeBlockMatch) {
          codeToAnalyze = codeBlockMatch[1]
          targetPath = 'inline-code'
        } else {
          const filePathMatch = input.query.match(/(?:file|path|analyze)\s*:?\s*([^\s,]+\.\w+)/i)
          const searchQuery = filePathMatch ? filePathMatch[1] : input.query.replace(/\b(code quality|analyze|review|check)\b/gi, '').trim()

          const results = await hybridSearch(input.projectId, searchQuery, 5)
          if (results.length === 0) {
            updateMetrics(Date.now() - start, true)
            return {
              content: 'No matching code found. Provide a file path or paste code in a code block (\\`\\`\\`code\\`\\`\\`).',
              metadata: { error: 'no_code_found' }
            }
          }

          codeToAnalyze = results.map(r =>
            `// --- ${r.relativePath} (lines ${r.lineStart}-${r.lineEnd}) ---\n${r.content}`
          ).join('\n\n')
          targetPath = results[0].relativePath
        }

        const report = await analyzeCodeQuality(codeToAnalyze, targetPath)
        const formattedReport = formatReport(report, targetPath)

        updateMetrics(Date.now() - start, true)
        return {
          content: formattedReport,
          metadata: {
            overallGrade: report.overallGrade,
            overallScore: report.overallScore,
            dimensionCount: report.dimensions.length,
            criticalIssueCount: report.criticalIssues.length,
            techDebtCount: report.techDebtItems.length,
            dimensions: report.dimensions.map(d => ({ name: d.name, grade: d.grade, score: d.score }))
          }
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics(): SkillMetrics { return { ...metrics } }
  }
}
