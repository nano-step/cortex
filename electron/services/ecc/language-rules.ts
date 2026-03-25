export type Language = 'typescript' | 'python' | 'golang' | 'rust' | 'java' | 'common'

export interface LanguageRule {
  id: string
  language: Language
  category: string
  rule: string
  priority: 'must' | 'should' | 'may'
}

const COMMON_RULES: LanguageRule[] = [
  { id: 'common-immutability', language: 'common', category: 'style', rule: 'Prefer immutable data structures. Use const/readonly by default.', priority: 'must' },
  { id: 'common-small-files', language: 'common', category: 'structure', rule: 'Keep files under 300 lines. Split when exceeding.', priority: 'should' },
  { id: 'common-no-console', language: 'common', category: 'quality', rule: 'Remove console.log before commit. Use structured logging in production.', priority: 'must' },
  { id: 'common-error-handling', language: 'common', category: 'quality', rule: 'Never swallow errors silently. Log or propagate every caught exception.', priority: 'must' },
  { id: 'common-naming', language: 'common', category: 'style', rule: 'Use descriptive names. No single-letter variables except loop counters.', priority: 'should' },
  { id: 'common-testing', language: 'common', category: 'testing', rule: 'Write tests first (TDD). Maintain >= 80% coverage.', priority: 'should' },
  { id: 'common-git', language: 'common', category: 'git', rule: 'Use conventional commits: feat/fix/refactor/docs/test/chore.', priority: 'must' },
  { id: 'common-security', language: 'common', category: 'security', rule: 'Validate all external inputs. Never trust user data.', priority: 'must' }
]

const TYPESCRIPT_RULES: LanguageRule[] = [
  { id: 'ts-strict', language: 'typescript', category: 'config', rule: 'Enable strict mode in tsconfig. No any types.', priority: 'must' },
  { id: 'ts-interfaces', language: 'typescript', category: 'style', rule: 'Prefer interfaces over type aliases for object shapes.', priority: 'should' },
  { id: 'ts-enums', language: 'typescript', category: 'style', rule: 'Prefer union types over enums unless numeric values needed.', priority: 'may' },
  { id: 'ts-async', language: 'typescript', category: 'quality', rule: 'Always handle Promise rejections. Use try/catch with async/await.', priority: 'must' },
  { id: 'ts-barrel', language: 'typescript', category: 'structure', rule: 'Use index.ts barrel exports for public module APIs.', priority: 'should' }
]

const PYTHON_RULES: LanguageRule[] = [
  { id: 'py-typing', language: 'python', category: 'config', rule: 'Use type hints for all function signatures.', priority: 'must' },
  { id: 'py-dataclass', language: 'python', category: 'style', rule: 'Use dataclasses or pydantic models for data containers.', priority: 'should' },
  { id: 'py-virtualenv', language: 'python', category: 'setup', rule: 'Always use virtual environments. Pin dependencies in requirements.txt.', priority: 'must' },
  { id: 'py-pytest', language: 'python', category: 'testing', rule: 'Use pytest over unittest. Fixtures over setup/teardown.', priority: 'should' }
]

const GOLANG_RULES: LanguageRule[] = [
  { id: 'go-errors', language: 'golang', category: 'quality', rule: 'Always check and handle errors. Never _ = err.', priority: 'must' },
  { id: 'go-interfaces', language: 'golang', category: 'style', rule: 'Accept interfaces, return structs. Keep interfaces small.', priority: 'should' },
  { id: 'go-goroutines', language: 'golang', category: 'concurrency', rule: 'Always manage goroutine lifecycle. Use context for cancellation.', priority: 'must' },
  { id: 'go-testing', language: 'golang', category: 'testing', rule: 'Use table-driven tests. Use testify for assertions.', priority: 'should' }
]

const ALL_RULES: Record<Language, LanguageRule[]> = {
  common: COMMON_RULES,
  typescript: TYPESCRIPT_RULES,
  python: PYTHON_RULES,
  golang: GOLANG_RULES,
  rust: [],
  java: []
}

export function getRulesForLanguages(languages: Language[]): LanguageRule[] {
  const rules: LanguageRule[] = [...COMMON_RULES]
  for (const lang of languages) {
    if (lang !== 'common' && ALL_RULES[lang]) {
      rules.push(...ALL_RULES[lang])
    }
  }
  return rules
}

export function formatRulesAsContext(rules: LanguageRule[]): string {
  if (rules.length === 0) return ''

  const grouped = new Map<string, LanguageRule[]>()
  for (const rule of rules) {
    const key = rule.category
    const group = grouped.get(key) || []
    group.push(rule)
    grouped.set(key, group)
  }

  const lines = ['## Active Rules']
  for (const [category, categoryRules] of grouped) {
    lines.push(`### ${category}`)
    for (const r of categoryRules) {
      const icon = r.priority === 'must' ? '🔴' : r.priority === 'should' ? '🟡' : '🟢'
      lines.push(`${icon} ${r.rule}`)
    }
  }

  return lines.join('\n')
}

export function detectProjectLanguages(projectId: string): Language[] {
  return ['common', 'typescript']
}
