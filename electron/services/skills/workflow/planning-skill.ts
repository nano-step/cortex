import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { callWorkflowLLM } from './llm-helper'

function getPlanDir(projectId: string): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'projects', projectId, 'plans')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const PLANNING_SYSTEM = `You are an expert implementation planner creating detailed plans for autonomous AI agents.

Your plans must assume the implementer (an AI agent) has:
- Zero context about the codebase
- Excellent coding skills but no project knowledge  
- A tendency to over-engineer (so be explicit about YAGNI)
- Poor test design intuition (so be explicit about TDD)

Plan format:
\`\`\`markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** [One sentence]
**Architecture:** [2-3 sentences about approach]
**Tech Stack:** [Key technologies]

---

### Task 1: [Component Name]

**Files:**
- Create: \`exact/path/to/file.ts\`
- Modify: \`exact/path/to/existing.ts\`
- Test: \`exact/path/to/test.ts\`

- [ ] **Step 1: Write the failing test**
\`\`\`typescript
describe('Feature', () => {
  it('should do X', () => {
    // exact test code
  })
})
\`\`\`
- [ ] **Step 2: Run test to verify it fails**
Run: \`npm test -- --testPathPattern=path/to/test\`
Expected: FAIL with "X not defined"

- [ ] **Step 3: Write minimal implementation**
\`\`\`typescript
// exact implementation code
\`\`\`
- [ ] **Step 4: Run test to verify it passes**
Run: \`npm test -- --testPathPattern=path/to/test\`
Expected: PASS

- [ ] **Step 5: Commit**
\`\`\`bash
git add path/to/files && git commit -m "feat: add X"
\`\`\`
\`\`\`

Rules:
- Exact file paths always
- Complete working code in plan (not "add validation" — write the actual code)
- Exact commands with expected output
- Each task 2-5 minutes of work
- RED-GREEN-REFACTOR TDD for every feature
- DRY, YAGNI, frequent commits
- Include PLAN_COMPLETE: marker at end
`

const PLAN_REVIEWER_SYSTEM = `You are a plan document reviewer. Evaluate whether the plan is:
1. Atomic enough (each task is 2-5 minutes)
2. Has exact file paths (not vague like "add to the relevant file")
3. Has complete code (not placeholders like "implement here")
4. Has exact test commands
5. Follows TDD (failing test before implementation)
6. Has commit steps

Return:
STATUS: APPROVED or STATUS: ISSUES_FOUND
ISSUES: (list specific issues if any, be very concrete)
`

export function createPlanningSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'write-plan',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p0',
    description: 'Creates detailed TDD implementation plans from specs. Each task has exact file paths, complete code, exact test commands. Saves plan to disk for subagent execution.',
    dependencies: ['brainstorm'],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      return /\b(write (a |the )?plan|create (a |the )?plan|implementation plan|plan (for|this|the)|\/plan)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        let specContent = ''

        const specPathMatch = input.query.match(/spec[:\s]+([^\s]+\.md)/i)
        if (specPathMatch && existsSync(specPathMatch[1])) {
          specContent = readFileSync(specPathMatch[1], 'utf-8')
        }

        const featureDescription = input.query.replace(/^\/plan\s*/i, '').trim() || 'feature from spec'

        const contextHint = input.context?.codebaseContext as string || ''

        const prompt = specContent
          ? `Create a detailed implementation plan for this spec:\n\n${specContent}\n\n${contextHint ? `\nCodebase context:\n${contextHint}` : ''}`
          : `Create a detailed implementation plan for: ${featureDescription}\n\n${contextHint ? `Codebase context:\n${contextHint}` : ''}\n\nInfer what you need from the description and create a complete plan.`

        const planContent = await callWorkflowLLM([
          { role: 'system', content: PLANNING_SYSTEM },
          { role: 'user', content: prompt }
        ], { maxTokens: 4096 })

        const reviewResponse = await callWorkflowLLM([
          { role: 'system', content: PLAN_REVIEWER_SYSTEM },
          { role: 'user', content: `Review this plan:\n\n${planContent}` }
        ])

        const date = new Date().toISOString().split('T')[0]
        const slug = featureDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        const filename = `${date}-${slug}-plan.md`
        const planDir = getPlanDir(input.projectId)
        const planPath = join(planDir, filename)

        const taskCount = (planContent.match(/^### Task \d+/gm) || []).length
        const approved = reviewResponse.includes('STATUS: APPROVED')
        const issues = reviewResponse.match(/ISSUES:([\s\S]*?)(?=STATUS:|$)/)?.[1]?.trim() || ''

        let finalPlanContent = planContent
        if (!approved && issues) {
          const refinedPlan = await callWorkflowLLM([
            { role: 'system', content: PLANNING_SYSTEM },
            { role: 'user', content: prompt },
            { role: 'assistant', content: planContent },
            { role: 'user', content: `Fix these issues:\n${issues}` }
          ], { maxTokens: 4096 })
          finalPlanContent = refinedPlan
        }

        writeFileSync(planPath, finalPlanContent, 'utf-8')

        updateMetrics(Date.now() - start, true)
        return {
          content: `## Implementation Plan Created ✅\n\n**Saved to:** \`${planPath}\`\n**Tasks:** ${taskCount}\n**Review:** ${approved ? '✅ APPROVED' : '⚠️ Auto-refined after review'}\n\n---\n\n${finalPlanContent.slice(0, 8000)}${finalPlanContent.length > 8000 ? '\n\n*[Plan truncated — full plan saved to file]*' : ''}`,
          metadata: {
            planPath,
            taskCount,
            approved,
            skill: 'write-plan'
          },
          artifacts: [{
            type: 'file',
            name: filename,
            content: finalPlanContent
          }],
          suggestedFollowups: [
            `/execute ${planPath} — Start subagent-driven execution`,
            'Execute this plan now',
            `Show me task 1 in detail`
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
