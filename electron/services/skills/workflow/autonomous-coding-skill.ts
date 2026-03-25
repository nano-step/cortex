import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { callWorkflowLLM } from './llm-helper'
import { app } from 'electron'

type DevPhase = 'spec_writing' | 'architecture' | 'task_breakdown' | 'coding' | 'reviewing' | 'testing' | 'debugging' | 'complete'

interface DevTask {
  id: string
  title: string
  description: string
  files: string[]
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  attempts: number
  result: string
}

interface DevSession {
  phase: DevPhase
  appDescription: string
  techStack: string
  architecture: string
  tasks: DevTask[]
  currentTaskIndex: number
  iterationsInPhase: number
  projectPath: string
  log: string[]
}

const activeSessions = new Map<string, DevSession>()

function getProjectPath(projectId: string): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'projects', projectId, 'dev-sessions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

async function callAgent(
  role: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  console.log(`[AutonomousCoding] ${role} agent processing...`)
  return callWorkflowLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { maxTokens, temperature: 0.2, timeoutMs: 90000 })
}

const SPEC_WRITER_SYSTEM = `You are the Specification Writer agent. Your job is to take a rough app description and write a comprehensive technical specification.

Output format:
## App Name
## Description
## Core Features (numbered list)
## User Stories (As a user, I want to...)
## Technical Requirements
## Out of Scope
## Success Criteria

Be specific and testable. Each feature should be implementable independently.`

const ARCHITECT_SYSTEM = `You are the Architect agent. Given a specification, design the technical architecture.

Output format:
## Tech Stack
(List all technologies with versions)

## Architecture Overview
(2-3 sentences)

## File Structure
\`\`\`
project/
  src/
    ...
\`\`\`

## Key Components
(Each component: name, responsibility, interfaces)

## Data Models
(Key data structures)

## API Design
(If applicable: endpoints, request/response shapes)

Be concrete. Use exact file paths.`

const TECH_LEAD_SYSTEM = `You are the Tech Lead agent. Given a spec and architecture, break down the work into developer tasks.

Rules:
- Each task should take 30-60 minutes of coding
- Tasks should be mostly independent
- Each task should produce testable output
- Order tasks from foundation to features

Output format as JSON:
[
  {
    "id": "task_1",
    "title": "Short title",
    "description": "Detailed description of what to implement",
    "files": ["exact/file/paths.ts"],
    "dependencies": [],
    "testCriteria": "How to verify this is done correctly"
  }
]`

const DEVELOPER_SYSTEM = `You are the Developer agent. Your job is to implement the specific task given.
Write complete, working TypeScript/JavaScript code. Follow TDD: write failing tests first.
Include exact file paths for all changes.`

const CODE_MONKEY_SYSTEM = `You are the Code Monkey agent. You implement exactly what the Developer specifies.
Write the actual code. No explanations unless asked. Follow the exact file paths and implementation provided.`

const REVIEWER_SYSTEM = `You are the Reviewer agent. Review code for:
1. Correctness (does it do what the spec says?)
2. Tests (are there tests? do they pass?)
3. Code quality (readability, DRY, YAGNI)

Output:
APPROVED: true/false
ISSUES: (list issues)
SEVERITY: critical/important/minor for each issue`

const DEBUGGER_SYSTEM = `You are the Debugger agent. Given failing code and error messages, diagnose and fix the issue.
Provide the exact fix with file paths and line numbers.`

export function createAutonomousCodingSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'autonomous-coding',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p0',
    description: 'GPT-Pilot-style autonomous coding: SpecWriter → Architect → TechLead → Developer → CodeMonkey → Reviewer → Debugger. Full development pipeline with phase state machine.',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      return /\b(\/code|build (me |this |an? |the )?app|create (me |this |an? |the )?app|autonomous(ly)? (build|create|code|develop|implement)|develop this|full app)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const sessionKey = input.conversationId || input.projectId
        let session = activeSessions.get(sessionKey)

        if (!session) {
          session = {
            phase: 'spec_writing',
            appDescription: input.query.replace(/^\/code\s*/i, '').trim(),
            techStack: '',
            architecture: '',
            tasks: [],
            currentTaskIndex: 0,
            iterationsInPhase: 0,
            projectPath: getProjectPath(input.projectId),
            log: []
          }
          activeSessions.set(sessionKey, session)
        }

        const output: string[] = []
        output.push(`## 🤖 Autonomous Coding Pipeline\n**Phase:** ${session.phase.replace('_', ' ').toUpperCase()}\n`)

        if (session.phase === 'spec_writing') {
          output.push('### 📝 Spec Writer Agent\n')
          const spec = await callAgent('SpecWriter', SPEC_WRITER_SYSTEM, `Write a spec for: ${session.appDescription}`)
          session.log.push(`[SpecWriter] ${spec.slice(0, 200)}...`)

          const specPath = join(session.projectPath, `spec-${Date.now()}.md`)
          writeFileSync(specPath, spec, 'utf-8')
          output.push(spec)
          output.push(`\n✅ Spec written to: \`${specPath}\``)

          session.phase = 'architecture'
          session.iterationsInPhase = 0

          const archResult = await callAgent('Architect', ARCHITECT_SYSTEM, `Design architecture for:\n\n${spec}`)
          session.architecture = archResult
          session.log.push(`[Architect] ${archResult.slice(0, 200)}...`)

          output.push('\n\n### 🏗️ Architect Agent\n')
          output.push(archResult)

          const archPath = join(session.projectPath, `architecture-${Date.now()}.md`)
          writeFileSync(archPath, archResult, 'utf-8')

          session.phase = 'task_breakdown'

          const tasksJson = await callAgent('TechLead', TECH_LEAD_SYSTEM,
            `Break this into developer tasks:\n\nSpec:\n${spec}\n\nArchitecture:\n${archResult}`,
            2048
          )

          try {
            const jsonMatch = tasksJson.match(/\[[\s\S]*\]/)
            if (jsonMatch) {
              const parsedTasks = JSON.parse(jsonMatch[0]) as Array<{
                id: string; title: string; description: string; files: string[]
              }>
              session.tasks = parsedTasks.map(t => ({
                ...t,
                status: 'pending' as const,
                attempts: 0,
                result: ''
              }))
            }
          } catch {
            session.tasks = [{
              id: 'task_1', title: 'Full Implementation',
              description: tasksJson, files: [], status: 'pending', attempts: 0, result: ''
            }]
          }

          output.push('\n\n### 📋 Tech Lead Agent\n')
          output.push(`**${session.tasks.length} tasks created:**\n`)
          session.tasks.forEach((t, i) => {
            output.push(`${i + 1}. ${t.title}`)
          })

          session.phase = 'coding'
          output.push('\n\n---\nPhases 1-3 complete. Starting coding phase...\nSay "continue" to execute the first task.')

          updateMetrics(Date.now() - start, true)
          return {
            content: output.join('\n'),
            metadata: { phase: 'coding', tasksReady: session.tasks.length, skill: 'autonomous-coding' },
            suggestedFollowups: ['continue', 'Show task list', 'Adjust architecture before coding']
          }
        }

        if (session.phase === 'coding' && session.currentTaskIndex < session.tasks.length) {
          const task = session.tasks[session.currentTaskIndex]
          task.status = 'in_progress'
          task.attempts++

          output.push(`### 💻 Developer Agent — Task ${session.currentTaskIndex + 1}/${session.tasks.length}\n`)
          output.push(`**${task.title}**\n`)

          const devPlan = await callAgent('Developer', DEVELOPER_SYSTEM,
            `Implement this task:\n\nArchitecture context:\n${session.architecture.slice(0, 500)}\n\nTask:\n${task.description}\n\nFiles to create/modify:\n${task.files.join('\n')}`
          )

          output.push(devPlan.slice(0, 1000))

          const codeResult = await callAgent('CodeMonkey', CODE_MONKEY_SYSTEM,
            `Implement based on this plan:\n${devPlan}`, 3000
          )

          task.result = codeResult
          output.push('\n\n### 🐒 Code Monkey Agent\n')
          output.push(codeResult.slice(0, 800))

          const reviewResult = await callAgent('Reviewer', REVIEWER_SYSTEM,
            `Review:\nTask: ${task.description}\nImplementation: ${codeResult}`, 1024
          )

          const approved = reviewResult.includes('APPROVED: true')
          const criticalIssues = !approved && reviewResult.match(/SEVERITY:\s*critical/i)

          output.push('\n\n### 🔍 Reviewer Agent\n')
          output.push(reviewResult)

          if (!approved && criticalIssues && task.attempts < 3) {
            const debugResult = await callAgent('Debugger', DEBUGGER_SYSTEM,
              `Fix these issues in the implementation:\nIssues: ${reviewResult}\nCode: ${codeResult}`, 2048
            )
            task.result = debugResult
            output.push('\n\n### 🐛 Debugger Agent\n')
            output.push(debugResult.slice(0, 500))
          }

          task.status = 'done'
          session.currentTaskIndex++

          const progressBar = session.tasks.map((t, i) =>
            i < session.currentTaskIndex ? '✅' : i === session.currentTaskIndex ? '⏳' : '⬜'
          ).join(' ')

          output.push(`\n\n---\n✅ **Task ${session.currentTaskIndex}/${session.tasks.length} complete!**\n${progressBar}`)

          if (session.currentTaskIndex >= session.tasks.length) {
            session.phase = 'complete'
            output.push('\n\n## 🎉 Development Complete!\nAll tasks implemented. Run your tests to verify.')
          } else {
            output.push(`\nNext: **${session.tasks[session.currentTaskIndex].title}**\nSay "continue" for next task.`)
          }

          const sessionLog = join(session.projectPath, 'dev-log.md')
          writeFileSync(sessionLog, session.log.join('\n\n'), 'utf-8')

          updateMetrics(Date.now() - start, true)
          return {
            content: output.join('\n'),
            metadata: {
              phase: session.phase,
              tasksCompleted: session.currentTaskIndex,
              totalTasks: session.tasks.length,
              skill: 'autonomous-coding'
            },
            suggestedFollowups: session.phase === 'complete'
              ? ['Run tests', 'Create PR', 'Show all implemented files']
              : ['continue', `Skip task ${session.currentTaskIndex + 1}`, 'Show task list']
          }
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: `Session status: ${session.phase}. ${session.currentTaskIndex}/${session.tasks.length} tasks complete.\n\nSay "continue" to proceed or "status" for details.`,
          metadata: { skill: 'autonomous-coding' }
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
