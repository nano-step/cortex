import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { hybridSearch } from '../../vector-search'
import { getProxyUrl, getProxyKey } from '../../settings-service'

const TEST_KEYWORDS = ['test', 'unit test', 'generate test', 'write test', 'test coverage', 'spec', 'jest', 'vitest', 'pytest', 'testing']

const SYSTEM_PROMPT = `You are a test generator for software projects. Given source code, generate comprehensive unit tests.

RULES:
- Detect the testing framework from project context (Jest, Vitest, Pytest, Go test, etc.)
- If no framework is detected, default to the language's standard testing approach
- Include: happy path, edge cases, error paths, boundary conditions
- Use descriptive test names that explain what is being tested
- Mock external dependencies (DB, API, file system)
- Group related tests with describe/context blocks
- Include setup/teardown when needed
- Generate TypeScript tests for TypeScript code, Python tests for Python code, etc.

OUTPUT FORMAT:
- Start with the import statements and test setup
- Group tests logically
- End with a summary comment listing what was tested`

function extractTarget(query: string): string {
  const fileMatch = query.match(/[\w./\-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php)/)
  if (fileMatch) return fileMatch[0]

  const funcMatch = query.match(/(?:function|method|class|component)\s+[`"']?(\w+)[`"']?/i)
  if (funcMatch) return funcMatch[1]

  return query.replace(/^(generate|write|create)\s+(unit\s+)?tests?\s+(for\s+)?/i, '').trim()
}

export function createTestGeneratorSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'test-generator',
    version: '4.0.0',
    category: 'code',
    priority: 'p0',
    description: 'Generates unit tests from code context using LLM analysis',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return TEST_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const target = extractTarget(input.query)
        const searchQuery = target || input.query

        const codeResults = await hybridSearch(input.projectId, searchQuery, 10)

        const testResults = await hybridSearch(input.projectId, `test spec ${searchQuery}`, 5)

        const codeContext = codeResults
          .map(c => `// ${c.relativePath} (${c.chunkType}${c.name ? ': ' + c.name : ''}) L${c.lineStart}-${c.lineEnd}\n${c.content}`)
          .join('\n\n')

        const existingTests = testResults
          .filter(t => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(t.relativePath) || t.relativePath.includes('__tests__'))
          .map(t => `// ${t.relativePath}\n${t.content}`)
          .join('\n\n')

        let detectedFramework = 'unknown'
        const allContent = [...codeResults, ...testResults].map(r => r.content).join(' ')
        if (allContent.includes('vitest') || allContent.includes('from \'vitest\'')) detectedFramework = 'vitest'
        else if (allContent.includes('jest') || allContent.includes('@jest')) detectedFramework = 'jest'
        else if (allContent.includes('pytest') || allContent.includes('def test_')) detectedFramework = 'pytest'
        else if (allContent.includes('testing.T')) detectedFramework = 'go-test'

        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Generate tests for: ${input.query}\n\nDetected framework: ${detectedFramework}\n\n=== SOURCE CODE ===\n${codeContext}\n\n${existingTests ? `=== EXISTING TESTS (match style) ===\n${existingTests}` : ''}`
          }
        ]

        const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
          body: JSON.stringify({ model: 'gemini-2.5-flash', messages, stream: false, temperature: 0.2, max_tokens: 4096 })
        })

        if (!response.ok) throw new Error(`LLM error: ${response.status}`)

        const data = await response.json() as { choices: Array<{ message: { content: string } }> }
        const content = data.choices?.[0]?.message?.content || 'Failed to generate tests.'

        updateMetrics(Date.now() - start, true)
        return {
          content,
          metadata: { framework: detectedFramework, filesAnalyzed: codeResults.length, target },
          suggestedFollowups: ['Run the generated tests', 'Add edge case tests', 'Generate integration tests']
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
