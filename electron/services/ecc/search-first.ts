export interface SearchFirstResult {
  researchComplete: boolean
  sources: Array<{ type: string; query: string; resultCount: number }>
  recommendation: string
  readyToImplement: boolean
}

export function shouldEnforceSearchFirst(query: string): boolean {
  const implementPatterns = /\b(implement|create|build|add|write|generate|make|develop|refactor)\b/i
  const complexitySignals = /\b(and|also|plus|with|including|across|multiple)\b/gi
  const matches = query.match(complexitySignals) || []
  return implementPatterns.test(query) && matches.length >= 2
}

export function formatSearchFirstReminder(): string {
  return `<search_first>
Before implementing, research first:
1. Search existing codebase for similar patterns
2. Check documentation for libraries involved
3. Review related files for conventions to follow
4. Only then begin implementation

This prevents wasted effort from wrong assumptions.
</search_first>`
}

export function buildResearchPlan(query: string): string[] {
  const steps: string[] = []

  steps.push('Search codebase for existing implementations of similar features')
  steps.push('Identify files that will be affected by this change')
  steps.push('Check for relevant tests and conventions')

  if (/\b(api|endpoint|route|handler)\b/i.test(query)) {
    steps.push('Review existing API patterns and middleware chain')
  }
  if (/\b(database|schema|migration|model)\b/i.test(query)) {
    steps.push('Check current database schema and migration history')
  }
  if (/\b(component|ui|frontend|page)\b/i.test(query)) {
    steps.push('Review component library and design system conventions')
  }
  if (/\b(test|spec|coverage)\b/i.test(query)) {
    steps.push('Check test infrastructure and coverage requirements')
  }

  return steps
}
