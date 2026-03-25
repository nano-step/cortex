import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { executeWorkflow, createSimpleWorkflow, type WorkflowDefinition, type NodeType } from './workflow-engine'
import { existsSync, readFileSync } from 'fs'
import { callWorkflowLLM } from './llm-helper'

const savedWorkflows = new Map<string, WorkflowDefinition>()

async function generateWorkflowFromDescription(description: string): Promise<WorkflowDefinition> {
  const content = await callWorkflowLLM([{
    role: 'system',
    content: `You design AI workflows as JSON. Each workflow has typed nodes that pass data between them.

Node types: start, llm, rag, condition, subagent, loop, template, tool, end

Output ONLY valid JSON, no markdown:
{
  "name": "Workflow name",
  "description": "What it does",
  "nodes": [
    {"id": "n1", "type": "start", "title": "Input", "config": {}, "inputs": {}, "nextNodeId": "n2"},
    {"id": "n2", "type": "llm", "title": "Analyze", "config": {"systemPrompt": "You analyze...", "temperature": 0.3}, "inputs": {"prompt": "Analyze: {{input}}"}, "nextNodeId": "n3"},
    {"id": "n3", "type": "end", "title": "Output", "config": {"outputKey": "n2"}, "inputs": {}}
  ]
}`
  }, {
    role: 'user',
    content: `Design a workflow for: ${description}`
  }], { maxTokens: 2000, temperature: 0.2, timeoutMs: 30000 })

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No valid JSON in response')

  const parsed = JSON.parse(jsonMatch[0]) as {
    name: string; description: string
    nodes: Array<{ id: string; type: string; title: string; config: Record<string, unknown>; inputs: Record<string, unknown>; nextNodeId?: string }>
  }

  return createSimpleWorkflow(
    parsed.name || 'Generated Workflow',
    parsed.nodes.map(n => ({
      id: n.id,
      type: n.type as NodeType,
      title: n.title,
      config: n.config || {},
      inputs: n.inputs || {},
      nextNodeId: n.nextNodeId
    }))
  )
}

export function createWorkflowSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'workflow',
    version: '4.0.0',
    category: 'workflow',
    priority: 'p0',
    description: 'Dify-style workflow engine: compose and execute typed node workflows (LLM → RAG → Condition → SubAgent → Loop). Auto-generates workflows from natural language descriptions.',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      return /\b(\/workflow|create workflow|run workflow|design workflow|build workflow|workflow for|workflow that)\b/i.test(input.query)
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const queryClean = input.query.replace(/^\/workflow\s*/i, '').trim()

        const runMatch = queryClean.match(/^run\s+(.+)/i)
        if (runMatch) {
          const workflowIdOrPath = runMatch[1].trim()
          let workflow = savedWorkflows.get(workflowIdOrPath)

          if (!workflow && existsSync(workflowIdOrPath)) {
            workflow = JSON.parse(readFileSync(workflowIdOrPath, 'utf-8')) as WorkflowDefinition
          }

          if (!workflow) {
            return {
              content: `Workflow "${workflowIdOrPath}" not found. Use \`/workflow design [description]\` to create one first.`,
              metadata: { skill: 'workflow' }
            }
          }

          const result = await executeWorkflow(workflow, input.context?.workflowInput || queryClean, {
            projectId: input.projectId,
            conversationId: input.conversationId || '',
          })

          updateMetrics(Date.now() - start, result.success)
          return {
            content: [
              `## Workflow: ${workflow.name}`,
              `**Status:** ${result.success ? '✅ Complete' : '❌ Failed'}`,
              `**Nodes executed:** ${result.nodesExecuted}`,
              `**Duration:** ${result.durationMs}ms`,
              '',
              '### Output',
              String(result.output || result.error || ''),
              '',
              '### Execution Log',
              result.executionLog.map(e =>
                `- ${e.status === 'success' ? '✅' : '❌'} **${e.nodeId}** (${e.durationMs}ms)`
              ).join('\n')
            ].join('\n'),
            metadata: { workflowResult: result, skill: 'workflow' }
          }
        }

        const description = queryClean.replace(/^design\s+/i, '').trim() || queryClean

        const workflow = await generateWorkflowFromDescription(description)
        savedWorkflows.set(workflow.id, workflow)

        const result = await executeWorkflow(workflow, description, {
          projectId: input.projectId,
          conversationId: input.conversationId || '',
        })

        updateMetrics(Date.now() - start, result.success)
        return {
          content: [
            `## 🔄 Workflow: ${workflow.name}`,
            `**Nodes:** ${workflow.nodes.length} (${workflow.nodes.map(n => n.type).join(' → ')})`,
            `**Duration:** ${result.durationMs}ms`,
            '',
            '### Result',
            String(result.output || ''),
            '',
            '### Nodes Executed',
            result.executionLog.map(e =>
              `${e.status === 'success' ? '✅' : '❌'} **${e.nodeId}** — ${e.durationMs}ms`
            ).join('\n'),
            '',
            `*Workflow ID: \`${workflow.id}\` — use \`/workflow run ${workflow.id}\` to re-run*`
          ].join('\n'),
          metadata: { workflowId: workflow.id, workflowResult: result, skill: 'workflow' },
          suggestedFollowups: [
            `Run workflow again with different input`,
            `Show workflow structure`,
            `/workflow run ${workflow.id}`
          ]
        }
      } catch (err) {
        updateMetrics(Date.now() - start, false)
        throw err
      }
    },

    async shutdown(): Promise<void> {
      savedWorkflows.clear()
    },

    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: Date.now() }
    },

    getMetrics(): SkillMetrics {
      return { ...metrics }
    }
  }
}
