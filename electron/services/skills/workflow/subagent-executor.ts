import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getActiveModel } from '../../llm-client'
import { readFileSync, existsSync } from 'fs'

interface SubagentTask {
  id: string
  title: string
  content: string
  status: 'pending' | 'in_progress' | 'done' | 'needs_context' | 'blocked' | 'done_with_concerns'
  specReviewStatus: 'pending' | 'approved' | 'issues_found'
  qualityReviewStatus: 'pending' | 'approved' | 'issues_found'
  result: string
  concerns: string
}

interface ExecutionSession {
  planPath: string
  tasks: SubagentTask[]
  currentTaskIndex: number
  status: 'running' | 'paused' | 'complete' | 'blocked'
}

const activeSessions = new Map<string, ExecutionSession>()

const activeSubagents = new Map<string, AbortController>()

const RETRYABLE = new Set([429, 500, 502, 503])

async function callSubagent(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  maxTokens = 4096,
  subagentId?: string
): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  if (subagentId) activeSubagents.set(subagentId, controller)

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
        body: JSON.stringify({
          model: model || getActiveModel(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
          stream: false
        }),
        signal: controller.signal
      })
      if (RETRYABLE.has(response.status) && attempt < 2) {
        console.warn(`[Subagent] Attempt ${attempt + 1}/3: HTTP ${response.status}, retrying...`)
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      if (!response.ok) throw new Error(`Subagent LLM error: ${response.status}`)
      const data = await response.json() as { choices: Array<{ message: { content: string } }> }
      return data.choices?.[0]?.message?.content || ''
    }
    throw new Error('Subagent: all retry attempts failed')
  } finally {
    clearTimeout(timeoutId)
    if (subagentId) activeSubagents.delete(subagentId)
  }
}

const IMPLEMENTER_SYSTEM = `You are a focused implementation subagent. You have ZERO context about the broader conversation or codebase history. Your ONLY job is to implement the specific task given to you.

Rules:
1. Follow TDD strictly: write failing test FIRST, then implement, then verify passes
2. Write complete working code — no placeholders
3. Follow the exact file paths specified
4. Keep changes minimal — YAGNI
5. After implementation, self-review your work
6. End your response with one of these status markers:
   - STATUS: DONE
   - STATUS: DONE_WITH_CONCERNS (followed by your concerns)
   - STATUS: NEEDS_CONTEXT (followed by what you need)
   - STATUS: BLOCKED (followed by the blocker description)

You are working on a fresh context. Only implement what the task spec says.`

const SPEC_REVIEWER_SYSTEM = `You are a spec compliance reviewer. Your job is to check if the implementation matches the spec EXACTLY.

Check:
1. All requirements from the spec are implemented (nothing missing)
2. No extra features were added (nothing extra)
3. Tests cover the specified behavior
4. File paths match the spec

Return:
STATUS: APPROVED - all requirements met, nothing extra
STATUS: ISSUES_FOUND
MISSING: (list requirements not implemented)
EXTRA: (list features added beyond spec)
`

const CODE_QUALITY_REVIEWER_SYSTEM = `You are a code quality reviewer. Assume spec compliance is already confirmed. Review:
1. Test quality (are tests meaningful, not just checking implementation?)
2. Code clarity (can another developer understand this easily?)
3. Error handling (are edge cases handled?)
4. DRY (is there unnecessary duplication?)
5. Performance (any obvious issues?)

Return:
STATUS: APPROVED - code is production quality
STATUS: ISSUES_FOUND
CRITICAL: (blocking issues)
IMPORTANT: (should fix)
MINOR: (nice to have)
`

function parseTasks(planContent: string): SubagentTask[] {
  const taskRegex = /^### Task (\d+):\s*(.+)$([\s\S]*?)(?=^### Task \d+:|$)/gm
  const tasks: SubagentTask[] = []
  let match

  while ((match = taskRegex.exec(planContent)) !== null) {
    tasks.push({
      id: `task_${match[1]}`,
      title: match[2].trim(),
      content: match[3].trim(),
      status: 'pending',
      specReviewStatus: 'pending',
      qualityReviewStatus: 'pending',
      result: '',
      concerns: ''
    })
  }

  return tasks
}

export function createSubagentExecutorSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'execute-plan',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p0',
    description: 'Subagent-driven plan execution: dispatches fresh subagent per task, runs spec compliance review then code quality review. Two-stage review loop per task.',
    dependencies: ['write-plan'],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      return /\b(execute (the |this |my )?plan|\/execute|run (the |this |my )?plan|start (the |this )?plan|implement (the |this |my )?plan)\b/i.test(input.query)
      || (input.context?.planPath !== undefined)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const sessionKey = input.conversationId || input.projectId
        let session = activeSessions.get(sessionKey)

        let planContent = ''
        let planPath = ''

        if (session) {
          planPath = session.planPath
          planContent = existsSync(planPath) ? readFileSync(planPath, 'utf-8') : ''
        } else {
          const pathMatch = input.query.match(/\/execute\s+(.+\.md)/i) ||
                           input.query.match(/plan[:\s]+([^\s]+\.md)/i)
          planPath = pathMatch?.[1] || (input.context?.planPath as string) || ''

          if (planPath && existsSync(planPath)) {
            planContent = readFileSync(planPath, 'utf-8')
          } else {
            planContent = input.context?.planContent as string || input.query
          }

          const tasks = parseTasks(planContent)
          session = {
            planPath,
            tasks,
            currentTaskIndex: 0,
            status: 'running'
          }
          activeSessions.set(sessionKey, session)
        }

        if (session.currentTaskIndex >= session.tasks.length) {
          session.status = 'complete'
          const completedCount = session.tasks.filter(t => t.status === 'done').length
          updateMetrics(Date.now() - start, true)
          return {
            content: `## ✅ All Tasks Complete!\n\n**${completedCount}/${session.tasks.length} tasks completed successfully.**\n\n${session.tasks.map((t, i) => `${i + 1}. ${t.status === 'done' ? '✅' : '⚠️'} ${t.title}`).join('\n')}\n\nRun \`/review\` for final code review or merge your branch.`,
            metadata: { phase: 'complete', tasksCompleted: completedCount, skill: 'execute-plan' }
          }
        }

        const task = session.tasks[session.currentTaskIndex]
        task.status = 'in_progress'

        const taskOutput: string[] = []
        taskOutput.push(`## 🔧 Executing Task ${session.currentTaskIndex + 1}/${session.tasks.length}: ${task.title}\n`)

        const implementerPrompt = `You are implementing Task ${session.currentTaskIndex + 1} of ${session.tasks.length} in an implementation plan.

**Task specification:**
${task.content}

**Context:** This is task ${session.currentTaskIndex + 1} in a larger implementation plan. Your ONLY job is to implement exactly what this task specifies.

Follow TDD strictly. Write the failing test first, verify it fails, then implement, verify it passes, then commit.

Important: End your response with STATUS: DONE, STATUS: DONE_WITH_CONCERNS, STATUS: NEEDS_CONTEXT, or STATUS: BLOCKED.`

        const implementerId = `impl_${task.id}_${Date.now()}`
        const implementerResult = await callSubagent(IMPLEMENTER_SYSTEM, implementerPrompt, undefined, 4096, implementerId)
        task.result = implementerResult
        taskOutput.push(`### 🤖 Implementer [${implementerId.slice(0, 12)}]:\n${implementerResult.slice(0, 1500)}\n`)

        const implementerStatus = implementerResult.match(/STATUS:\s*(DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)/i)?.[1] || 'DONE'

        if (implementerStatus === 'NEEDS_CONTEXT' || implementerStatus === 'BLOCKED') {
          task.status = implementerStatus === 'NEEDS_CONTEXT' ? 'needs_context' : 'blocked'
          const statusMsg = implementerStatus === 'NEEDS_CONTEXT'
            ? '⚠️ **Implementer needs more context** — please provide the missing information and say "continue"'
            : '🚫 **Implementer is blocked** — review the blocker and provide guidance'

          updateMetrics(Date.now() - start, false)
          return {
            content: taskOutput.join('\n') + `\n\n${statusMsg}`,
            metadata: { phase: 'blocked', task: task.title, skill: 'execute-plan' }
          }
        }

        const specReviewPrompt = `Review this implementation for spec compliance.

**Task spec:**
${task.content}

**Implementation:**
${implementerResult}`

        const specReviewerId = `spec_reviewer_${task.id}_${Date.now()}`
        const specReview = await callSubagent(SPEC_REVIEWER_SYSTEM, specReviewPrompt, undefined, 1024, specReviewerId)
        taskOutput.push(`### 📋 Spec Reviewer [${specReviewerId.slice(0, 15)}]:\n${specReview}\n`)

        const specApproved = specReview.includes('STATUS: APPROVED')

        if (!specApproved) {
          const fixPrompt = `Fix these spec compliance issues:

**Original task spec:**
${task.content}

**Your implementation:**
${implementerResult}

**Spec review issues:**
${specReview}

Fix all MISSING items and remove all EXTRA items. End with STATUS: DONE.`

          const fixerId = `impl_fix_${task.id}_${Date.now()}`
          const fixResult = await callSubagent(IMPLEMENTER_SYSTEM, fixPrompt, undefined, 4096, fixerId)
          task.result = fixResult
          taskOutput.push(`### 🔧 Fix [${fixerId.slice(0, 12)}]:\n${fixResult.slice(0, 800)}\n`)

          const reReviewerId = `spec_rereview_${task.id}_${Date.now()}`
          const reReview = await callSubagent(SPEC_REVIEWER_SYSTEM, `Review this fixed implementation:\n\nTask spec:\n${task.content}\n\nFixed implementation:\n${fixResult}`, undefined, 1024, reReviewerId)
          taskOutput.push(`### 📋 Re-Review [${reReviewerId.slice(0, 18)}]:\n${reReview}\n`)
        }

        task.specReviewStatus = 'approved'

        const qualityReviewPrompt = `Review code quality:

**Task:**
${task.content}

**Implementation:**
${task.result}`

        const qualityReview = await callSubagent(CODE_QUALITY_REVIEWER_SYSTEM, qualityReviewPrompt, undefined, 1024)
        taskOutput.push(`### 🎯 Quality Review:\n${qualityReview}\n`)

        const qualityApproved = qualityReview.includes('STATUS: APPROVED')
        const criticalIssues = qualityReview.match(/CRITICAL:([\s\S]*?)(?=IMPORTANT:|MINOR:|STATUS:|$)/)?.[1]?.trim() || ''

        if (!qualityApproved && criticalIssues) {
          const qualityFixPrompt = `Fix these critical code quality issues:

**Implementation:**
${task.result}

**Critical issues:**
${criticalIssues}

Fix only the critical issues. End with STATUS: DONE.`

          const qualityFixResult = await callSubagent(IMPLEMENTER_SYSTEM, qualityFixPrompt)
          task.result = qualityFixResult
          taskOutput.push(`### 🔧 Quality Fixed:\n${qualityFixResult.slice(0, 400)}\n`)
        }

        task.qualityReviewStatus = 'approved'
        task.status = 'done'
        session.currentTaskIndex++

        const nextTask = session.tasks[session.currentTaskIndex]
        const progressBar = session.tasks.map((t, i) =>
          i < session.currentTaskIndex ? '✅' : i === session.currentTaskIndex ? '⏳' : '⬜'
        ).join(' ')

        taskOutput.push(`\n---\n\n## ✅ Task ${session.currentTaskIndex}/${session.tasks.length} Complete!\n\n**Progress:** ${progressBar}\n`)

        if (nextTask) {
          taskOutput.push(`**Next task:** ${nextTask.title}\n\nSay "continue" to execute the next task.`)
        } else {
          taskOutput.push(`**All tasks complete!** 🎉`)
          session.status = 'complete'
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: taskOutput.join('\n'),
          metadata: {
            tasksCompleted: session.currentTaskIndex,
            totalTasks: session.tasks.length,
            currentTask: task.title,
            skill: 'execute-plan'
          },
          suggestedFollowups: nextTask
            ? ['continue', `Skip to task ${session.currentTaskIndex + 2}`, 'Pause execution']
            : ['Run /review for final review', 'Show all completed tasks', 'Create PR']
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {
      activeSessions.clear()
    },

    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}
