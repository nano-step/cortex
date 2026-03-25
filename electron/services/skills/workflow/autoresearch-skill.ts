import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { callWorkflowLLM } from './llm-helper'
import { app } from 'electron'

interface Experiment {
  id: string
  iteration: number
  hypothesis: string
  change: string
  result: string
  metric: number
  improvement: boolean
  kept: boolean
  timestamp: number
}

interface ResearchSession {
  objective: string
  currentCode: string
  baselineMetric: number
  bestMetric: number
  bestCode: string
  experiments: Experiment[]
  iteration: number
  maxIterations: number
  status: 'running' | 'paused' | 'complete' | 'stopped'
  log: string[]
}

const activeSessions = new Map<string, ResearchSession>()

function getResearchDir(projectId: string): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'projects', projectId, 'research')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

async function callLLM(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2048
): Promise<string> {
  return callWorkflowLLM(messages, { maxTokens, temperature: 0.4 })
}

const RESEARCHER_SYSTEM = `You are an autonomous research agent. You run experiments to improve code/systems.

For each experiment:
1. Generate a hypothesis about what change might improve the objective metric
2. Implement the minimal change to test the hypothesis
3. Evaluate the result
4. Keep the change if it improves the metric, discard otherwise
5. Document learnings even from failed experiments

Output format for each experiment:
HYPOTHESIS: [what you think will work]
CHANGE: [exact code change or approach]
EXPECTED_IMPROVEMENT: [why you think this helps]
EVALUATION_CRITERIA: [how to measure success]
`

const EVALUATOR_SYSTEM = `You are an evaluator agent. Given an experiment result, provide a numeric score (0-100) and analysis.

Output:
SCORE: [0-100]
REASONING: [why this score]
LEARNINGS: [what we learned]
NEXT_HYPOTHESIS: [what to try next based on learnings]
`

export function createAutoResearchSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'autoresearch',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p1',
    description: 'karpathy/autoresearch-style autonomous experiment loop: generates hypotheses, implements changes, evaluates results, keeps improvements, discards regressions. Runs until stopped.',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      return /\b(\/research|automat(ic|ically) (improve|optimize|research|experiment)|run experiments?|autonomous(ly)? (improve|research|iterate)|research loop)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const sessionKey = input.conversationId || input.projectId
        let session = activeSessions.get(sessionKey)

        if (input.query.toLowerCase().includes('stop') || input.query.toLowerCase().includes('pause')) {
          if (session) {
            session.status = input.query.toLowerCase().includes('stop') ? 'stopped' : 'paused'
            return {
              content: `Research ${session.status}.\n\n**Progress:** ${session.iteration}/${session.maxIterations} iterations\n**Best metric:** ${session.bestMetric.toFixed(2)}\n**Improvements found:** ${session.experiments.filter(e => e.improvement).length}`,
              metadata: { skill: 'autoresearch', status: session.status }
            }
          }
        }

        if (!session) {
          const queryClean = input.query.replace(/^\/research\s*/i, '').trim()
          const maxIterMatch = queryClean.match(/(\d+)\s*iterations?/i)
          const maxIter = maxIterMatch ? parseInt(maxIterMatch[1]) : 10

          const codeFileMatch = queryClean.match(/(?:file|code):\s*([^\s,]+)/i)
          let initialCode = ''
          if (codeFileMatch && existsSync(codeFileMatch[1])) {
            initialCode = readFileSync(codeFileMatch[1], 'utf-8')
          } else {
            initialCode = queryClean.replace(/\d+\s*iterations?/i, '').trim()
          }

          session = {
            objective: queryClean,
            currentCode: initialCode,
            baselineMetric: 50,
            bestMetric: 50,
            bestCode: initialCode,
            experiments: [],
            iteration: 0,
            maxIterations: maxIter,
            status: 'running',
            log: []
          }
          activeSessions.set(sessionKey, session)
        }

        if (session.status === 'paused') {
          session.status = 'running'
        }

        if (session.status !== 'running') {
          return {
            content: `Research session is ${session.status}. Start a new session or say "continue research".`,
            metadata: { skill: 'autoresearch' }
          }
        }

        const iterationsToRun = Math.min(3, session.maxIterations - session.iteration)
        const output: string[] = []
        output.push(`## 🔬 AutoResearch — Iteration ${session.iteration + 1}-${session.iteration + iterationsToRun}/${session.maxIterations}\n`)
        output.push(`**Objective:** ${session.objective.slice(0, 100)}\n`)
        output.push(`**Current best metric:** ${session.bestMetric.toFixed(1)}/100\n\n`)

        for (let i = 0; i < iterationsToRun && session.status === 'running'; i++) {
          session.iteration++
          output.push(`### Experiment ${session.iteration}\n`)

          const prevExperimentsContext = session.experiments.slice(-3).map(e =>
            `Iter ${e.iteration}: ${e.hypothesis} → ${e.improvement ? '✅ Kept' : '❌ Discarded'} (score: ${e.metric.toFixed(1)})`
          ).join('\n')

          const researchPrompt = `Objective: ${session.objective}

Current code/state:
${session.currentCode.slice(0, 800)}

Previous experiments:
${prevExperimentsContext || 'None yet — this is the first experiment.'}

Current best metric: ${session.bestMetric.toFixed(1)}/100

Generate the next experiment hypothesis and change.`

          const experimentPlan = await callLLM([
            { role: 'system', content: RESEARCHER_SYSTEM },
            { role: 'user', content: researchPrompt }
          ])

          const hypothesis = experimentPlan.match(/HYPOTHESIS:\s*([^\n]+)/)?.[1] || 'Explore improvement'
          const change = experimentPlan.match(/CHANGE:\s*([\s\S]*?)(?=EXPECTED_IMPROVEMENT:|EVALUATION_CRITERIA:|$)/)?.[1]?.trim() || experimentPlan

          output.push(`**Hypothesis:** ${hypothesis}\n`)

          const evalPrompt = `Evaluate this experiment:

Objective: ${session.objective}
Iteration: ${session.iteration}
Hypothesis: ${hypothesis}
Proposed change: ${change.slice(0, 500)}
Current baseline: ${session.bestMetric.toFixed(1)}/100

Provide score and analysis.`

          const evaluation = await callLLM([
            { role: 'system', content: EVALUATOR_SYSTEM },
            { role: 'user', content: evalPrompt }
          ])

          const scoreMatch = evaluation.match(/SCORE:\s*(\d+(?:\.\d+)?)/i)
          const newMetric = scoreMatch ? Math.min(100, Math.max(0, parseFloat(scoreMatch[1]))) : session.bestMetric

          const improved = newMetric > session.bestMetric
          const kept = improved

          if (kept) {
            session.currentCode = change
            session.bestMetric = newMetric
            session.bestCode = change
            output.push(`✅ **KEPT** — Score improved: ${session.bestMetric.toFixed(1)} → ${newMetric.toFixed(1)}\n`)
          } else {
            output.push(`❌ **DISCARDED** — Score: ${newMetric.toFixed(1)} (no improvement over ${session.bestMetric.toFixed(1)})\n`)
          }

          const learnings = evaluation.match(/LEARNINGS:\s*([^\n]+)/)?.[1] || ''
          if (learnings) output.push(`*Learnings: ${learnings}*\n`)

          const experiment: Experiment = {
            id: `exp_${session.iteration}`,
            iteration: session.iteration,
            hypothesis,
            change,
            result: evaluation,
            metric: newMetric,
            improvement: improved,
            kept,
            timestamp: Date.now()
          }
          session.experiments.push(experiment)
          session.log.push(JSON.stringify(experiment))

          if (session.iteration >= session.maxIterations) {
            session.status = 'complete'
          }
        }

        const researchDir = getResearchDir(input.projectId)
        const logPath = join(researchDir, `research-${Date.now()}.json`)
        writeFileSync(logPath, JSON.stringify({
          objective: session.objective,
          iterations: session.iteration,
          bestMetric: session.bestMetric,
          improvements: session.experiments.filter(e => e.improvement).length,
          experiments: session.experiments
        }, null, 2), 'utf-8')

        if (session.bestCode && session.bestCode !== session.objective) {
          const bestCodePath = join(researchDir, `best-result-${Date.now()}.txt`)
          writeFileSync(bestCodePath, session.bestCode, 'utf-8')
        }

        output.push(`\n---\n`)
        output.push(`**Progress:** ${session.iteration}/${session.maxIterations} iterations\n`)
        output.push(`**Best metric:** ${session.bestMetric.toFixed(1)}/100\n`)
        output.push(`**Improvements:** ${session.experiments.filter(e => e.improvement).length}/${session.iteration}\n`)
        output.push(`**Log saved:** \`${logPath}\`\n`)

        if (session.status === 'complete') {
          output.push(`\n## 🏁 Research Complete!\n\n**Final best metric: ${session.bestMetric.toFixed(1)}/100**\n\nTop improvements:\n`)
          session.experiments.filter(e => e.improvement).slice(-3).forEach(e => {
            output.push(`- Iter ${e.iteration}: ${e.hypothesis} (${e.metric.toFixed(1)})`)
          })
        } else {
          output.push(`\nSay "continue research" for the next batch of experiments.`)
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: output.join('\n'),
          metadata: {
            iterations: session.iteration,
            bestMetric: session.bestMetric,
            improvements: session.experiments.filter(e => e.improvement).length,
            status: session.status,
            skill: 'autoresearch'
          },
          suggestedFollowups: session.status === 'complete'
            ? ['Show best result', 'Export research log', 'Apply best result to codebase']
            : ['continue research', 'stop research', 'Show experiment history']
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
