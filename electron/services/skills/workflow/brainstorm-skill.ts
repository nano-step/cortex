import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { callWorkflowLLM } from './llm-helper'

interface BrainstormState {
  phase: 'exploring' | 'questioning' | 'proposing' | 'designing' | 'writing_spec' | 'reviewing_spec' | 'done'
  questionsAsked: number
  design: string
  specPath: string | null
  conversationHistory: Array<{ role: string; content: string }>
  reviewIteration: number
}

const activeSessions = new Map<string, BrainstormState>()

function getSpecDir(projectId: string): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'projects', projectId, 'specs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getPlanDir(projectId: string): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'projects', projectId, 'plans')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getSpecDirPath(projectId: string): string {
  return getSpecDir(projectId)
}

export function getPlanDirPath(projectId: string): string {
  return getPlanDir(projectId)
}

async function callLLM(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2048
): Promise<string> {
  return callWorkflowLLM(messages, { maxTokens, temperature: 0.7 })
}

const BRAINSTORM_SYSTEM = `You are a Socratic design partner helping turn ideas into well-formed technical specs.

Your process:
1. EXPLORE: Understand the current codebase context and project state
2. CLARIFY: Ask one focused question at a time to understand purpose, constraints, success criteria
3. PROPOSE: Present 2-3 concrete approaches with trade-offs and your recommendation
4. DESIGN: Present the design in sections (architecture, components, data flow, error handling, testing), get approval after each
5. SPEC: Write a comprehensive spec document

Critical rules:
- ONE question per message — never bundle multiple questions
- Prefer multiple-choice questions when possible
- NEVER start implementing until design is approved
- YAGNI: ruthlessly remove unnecessary complexity
- Always propose alternatives before committing to an approach
- For existing codebases, explore structure before proposing changes

When presenting a design section, end with: "Does this look right so far?"
When ready to write spec, say: "Let me write up the spec now."
When spec is complete, include a section starting with: "SPEC_COMPLETE:"
`

const SPEC_REVIEWER_SYSTEM = `You are a spec document reviewer. Your job is to evaluate whether a spec is:
1. Clear and unambiguous
2. Complete (covers all edge cases)
3. Testable (each requirement can be verified)
4. Focused (YAGNI — no unnecessary features)
5. Implementable (no contradictions)

Return your review as:
STATUS: APPROVED or STATUS: ISSUES_FOUND
ISSUES: (list specific issues if any)
SUGGESTIONS: (concrete improvements)
`

export function createBrainstormSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'brainstorm',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p0',
    description: 'Socratic design refinement: explore idea → clarify requirements → propose approaches → design → write spec → review. Must run before any implementation.',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const q = input.query.toLowerCase()
      const session = input.conversationId ? activeSessions.get(input.conversationId) : undefined
      if (session) return true
      return /\b(brainstorm|design|plan|think|want to build|help me (build|create|make|design)|i want to|let'?s build|let'?s create|new feature|new functionality)\b/i.test(q)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const sessionKey = input.conversationId || input.projectId
        let state = activeSessions.get(sessionKey)

        if (!state) {
          state = {
            phase: 'exploring',
            questionsAsked: 0,
            design: '',
            specPath: null,
            conversationHistory: [],
            reviewIteration: 0
          }
          activeSessions.set(sessionKey, state)
        }

        const history = state.conversationHistory
        history.push({ role: 'user', content: input.query })

        if (history.length === 1) {
          const systemMsg = { role: 'system', content: BRAINSTORM_SYSTEM }
          const contextMsg = {
            role: 'user',
            content: `I'm using the brainstorming workflow to design something. Here's my idea:\n\n${input.query}\n\nPlease start by exploring the project context and asking your first clarifying question.`
          }
          const response = await callLLM([systemMsg, contextMsg])
          history[history.length - 1] = { role: 'user', content: input.query }
          history.push({ role: 'assistant', content: response })

          state.phase = 'questioning'
          updateMetrics(Date.now() - start, true)
          return {
            content: response,
            metadata: { phase: state.phase, skill: 'brainstorm' },
            suggestedFollowups: []
          }
        }

        const messages = [
          { role: 'system', content: BRAINSTORM_SYSTEM },
          ...history.slice(0, -1)
        ]
        const response = await callLLM(messages)
        history.push({ role: 'assistant', content: response })

        if (response.includes('SPEC_COMPLETE:')) {
          const specContent = response.split('SPEC_COMPLETE:')[1].trim()
          const date = new Date().toISOString().split('T')[0]
          const slug = input.query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
          const filename = `${date}-${slug}-spec.md`
          const specDir = getSpecDir(input.projectId)
          const specPath = join(specDir, filename)

          const fullSpec = `# Spec: ${input.query.slice(0, 60)}\n\nDate: ${date}\n\n---\n\n${specContent}`
          writeFileSync(specPath, fullSpec, 'utf-8')
          state.specPath = specPath
          state.phase = 'reviewing_spec'

          const reviewResponse = await callLLM([
            { role: 'system', content: SPEC_REVIEWER_SYSTEM },
            { role: 'user', content: `Review this spec:\n\n${fullSpec}` }
          ])

          state.reviewIteration++

          if (reviewResponse.includes('STATUS: APPROVED')) {
            state.phase = 'done'
            updateMetrics(Date.now() - start, true)
            return {
              content: `${response}\n\n---\n\n✅ **Spec saved to:** \`${specPath}\`\n\n**Spec Review:** APPROVED ✅\n\nSpec is ready. Next step: use \`/plan\` to create an implementation plan, or say "write the plan now".`,
              metadata: { phase: 'done', specPath, skill: 'brainstorm' },
              artifacts: [{
                type: 'file',
                name: filename,
                content: fullSpec
              }],
              suggestedFollowups: ['/plan — Create implementation plan from this spec', 'Show me the spec', 'Let\'s start implementing']
            }
          } else {
            const issues = reviewResponse.match(/ISSUES:([\s\S]*?)(?=SUGGESTIONS:|$)/)?.[1]?.trim() || ''
            updateMetrics(Date.now() - start, true)
            return {
              content: `${response}\n\n---\n\n⚠️ **Spec Review found issues:**\n${issues}\n\nLet me refine the spec...`,
              metadata: { phase: 'reviewing_spec', specPath, reviewIssues: issues, skill: 'brainstorm' },
              suggestedFollowups: ['Continue refining', 'Accept as-is and move to planning']
            }
          }
        }

        if (response.toLowerCase().includes('i have enough') || response.toLowerCase().includes('let me propose')) {
          state.phase = 'proposing'
        } else if (response.toLowerCase().includes('does this look right')) {
          state.phase = 'designing'
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: response,
          metadata: { phase: state.phase, questionsAsked: state.questionsAsked, skill: 'brainstorm' },
          suggestedFollowups: []
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
