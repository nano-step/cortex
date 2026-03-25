import { hybridSearch } from '../../vector-search'
import { callWorkflowLLM } from './llm-helper'

export type NodeType =
  | 'start'
  | 'end'
  | 'llm'
  | 'tool'
  | 'rag'
  | 'condition'
  | 'loop'
  | 'subagent'
  | 'code'
  | 'template'

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface WorkflowVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: unknown
}

export interface WorkflowNode {
  id: string
  type: NodeType
  title: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  config: Record<string, unknown>
  nextNodes: string[]
  status: NodeStatus
  startedAt: number | null
  completedAt: number | null
  error: string | null
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  version: string
  nodes: WorkflowNode[]
  variables: WorkflowVariable[]
  startNodeId: string
}

export interface WorkflowExecutionContext {
  workflowId: string
  projectId: string
  conversationId: string
  variables: Map<string, unknown>
  nodeResults: Map<string, unknown>
  executionLog: Array<{ nodeId: string; status: NodeStatus; output: unknown; durationMs: number }>
  abortSignal?: AbortSignal
}

export interface WorkflowExecutionResult {
  success: boolean
  output: unknown
  executionLog: WorkflowExecutionContext['executionLog']
  durationMs: number
  nodesExecuted: number
  error?: string
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.3,
  maxTokens = 2048
): Promise<string> {
  return callWorkflowLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { maxTokens, temperature })
}

function resolveTemplate(template: string, variables: Map<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = variables.get(key)
    return val !== undefined ? String(val) : `{{${key}}}`
  })
}

async function executeNode(
  node: WorkflowNode,
  ctx: WorkflowExecutionContext
): Promise<unknown> {
  const nodeStart = Date.now()
  node.status = 'running'
  node.startedAt = nodeStart

  try {
    let output: unknown = null

    switch (node.type) {
      case 'start': {
        output = ctx.variables.get('input') || node.inputs['defaultInput'] || ''
        break
      }

      case 'end': {
        const outputKey = node.config['outputKey'] as string || 'result'
        output = ctx.nodeResults.get(outputKey) || ctx.variables.get(outputKey) || ''
        break
      }

      case 'llm': {
        const systemPrompt = resolveTemplate(
          String(node.config['systemPrompt'] || 'You are a helpful assistant.'),
          ctx.variables
        )
        const userPrompt = resolveTemplate(
          String(node.inputs['prompt'] || ctx.variables.get('input') || ''),
          ctx.variables
        )
        const temperature = Number(node.config['temperature'] || 0.3)
        const maxTokens = Number(node.config['maxTokens'] || 2048)
        output = await callLLM(systemPrompt, userPrompt, temperature, maxTokens)
        ctx.variables.set(node.id + ':output', output)
        break
      }

      case 'rag': {
        const query = resolveTemplate(
          String(node.inputs['query'] || ctx.variables.get('input') || ''),
          ctx.variables
        )
        const topK = Number(node.config['topK'] || 5)
        const results = await hybridSearch(ctx.projectId, query, topK)
        output = results.map(r => `${r.relativePath}:\n${r.content.slice(0, 300)}`).join('\n\n')
        ctx.variables.set(node.id + ':output', output)
        break
      }

      case 'template': {
        const template = String(node.config['template'] || '')
        output = resolveTemplate(template, ctx.variables)
        ctx.variables.set(node.id + ':output', output)
        break
      }

      case 'condition': {
        const conditionVar = String(node.config['variable'] || '')
        const conditionValue = ctx.variables.get(conditionVar)
        const operator = String(node.config['operator'] || 'truthy')
        const compareValue = node.config['value']

        let conditionMet = false
        switch (operator) {
          case 'truthy': conditionMet = !!conditionValue; break
          case 'equals': conditionMet = conditionValue === compareValue; break
          case 'contains': conditionMet = String(conditionValue).includes(String(compareValue)); break
          case 'gt': conditionMet = Number(conditionValue) > Number(compareValue); break
          case 'lt': conditionMet = Number(conditionValue) < Number(compareValue); break
          default: conditionMet = !!conditionValue
        }

        output = conditionMet ? 'true_branch' : 'false_branch'
        ctx.variables.set(node.id + ':condition', conditionMet)
        break
      }

      case 'subagent': {
        const agentRole = String(node.config['role'] || 'assistant')
        const agentSystemPrompt = String(node.config['systemPrompt'] || `You are a specialized ${agentRole} agent.`)
        const taskInput = resolveTemplate(
          String(node.inputs['task'] || ctx.variables.get('input') || ''),
          ctx.variables
        )
        output = await callLLM(agentSystemPrompt, taskInput, 0.2, 3000)
        ctx.variables.set(node.id + ':output', output)
        break
      }

      case 'loop': {
        const items = ctx.variables.get(String(node.config['itemsVar'] || 'items'))
        if (!Array.isArray(items)) {
          output = []
          break
        }
        const maxIterations = Math.min(items.length, Number(node.config['maxIterations'] || 10))
        const results: unknown[] = []
        for (let i = 0; i < maxIterations; i++) {
          ctx.variables.set('loop:index', i)
          ctx.variables.set('loop:item', items[i])
          const loopTask = resolveTemplate(
            String(node.config['taskTemplate'] || '{{loop:item}}'),
            ctx.variables
          )
          const loopResult = await callLLM(
            String(node.config['systemPrompt'] || 'Process this item.'),
            loopTask
          )
          results.push(loopResult)
        }
        output = results
        ctx.variables.set(node.id + ':output', output)
        break
      }

      case 'tool': {
        const toolName = String(node.config['tool'] || '')
        const toolInput = resolveTemplate(
          String(node.inputs['input'] || ''),
          ctx.variables
        )
        output = `[Tool ${toolName} called with: ${toolInput.slice(0, 100)}]`
        ctx.variables.set(node.id + ':output', output)
        break
      }

      default: {
        output = null
      }
    }

    node.status = 'success'
    node.outputs['result'] = output
    node.completedAt = Date.now()

    ctx.executionLog.push({
      nodeId: node.id,
      status: 'success',
      output,
      durationMs: Date.now() - nodeStart
    })

    return output
  } catch (err) {
    node.status = 'failed'
    node.error = err instanceof Error ? err.message : String(err)
    node.completedAt = Date.now()

    ctx.executionLog.push({
      nodeId: node.id,
      status: 'failed',
      output: null,
      durationMs: Date.now() - nodeStart
    })

    throw err
  }
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  input: unknown,
  ctx: Pick<WorkflowExecutionContext, 'projectId' | 'conversationId' | 'abortSignal'>
): Promise<WorkflowExecutionResult> {
  const startTime = Date.now()
  const nodeMap = new Map<string, WorkflowNode>(workflow.nodes.map(n => [n.id, n]))

  const execCtx: WorkflowExecutionContext = {
    workflowId: workflow.id,
    projectId: ctx.projectId,
    conversationId: ctx.conversationId,
    variables: new Map([
      ['input', input],
      ...workflow.variables.map(v => [v.name, v.value] as [string, unknown])
    ]),
    nodeResults: new Map(),
    executionLog: [],
    abortSignal: ctx.abortSignal
  }

  const visited = new Set<string>()
  let currentNodeId = workflow.startNodeId
  let finalOutput: unknown = null
  let nodesExecuted = 0

  while (currentNodeId && !visited.has(currentNodeId)) {
    if (ctx.abortSignal?.aborted) {
      return {
        success: false,
        output: null,
        executionLog: execCtx.executionLog,
        durationMs: Date.now() - startTime,
        nodesExecuted,
        error: 'Workflow aborted'
      }
    }

    const node = nodeMap.get(currentNodeId)
    if (!node) break

    visited.add(currentNodeId)
    nodesExecuted++

    try {
      const output = await executeNode(node, execCtx)
      execCtx.nodeResults.set(currentNodeId, output)
      finalOutput = output

      if (node.type === 'end') break

      if (node.type === 'condition') {
        const conditionMet = execCtx.variables.get(node.id + ':condition')
        const trueBranch = node.config['trueBranchId'] as string
        const falseBranch = node.config['falseBranchId'] as string
        currentNodeId = conditionMet ? (trueBranch || '') : (falseBranch || '')
      } else {
        currentNodeId = node.nextNodes[0] || ''
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        executionLog: execCtx.executionLog,
        durationMs: Date.now() - startTime,
        nodesExecuted,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  return {
    success: true,
    output: finalOutput,
    executionLog: execCtx.executionLog,
    durationMs: Date.now() - startTime,
    nodesExecuted
  }
}

export function createSimpleWorkflow(
  name: string,
  nodes: Array<{
    id: string
    type: NodeType
    title: string
    config?: Record<string, unknown>
    inputs?: Record<string, unknown>
    nextNodeId?: string
  }>
): WorkflowDefinition {
  return {
    id: `workflow_${Date.now()}`,
    name,
    description: '',
    version: '1.0.0',
    variables: [],
    startNodeId: nodes[0]?.id || '',
    nodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      inputs: n.inputs || {},
      outputs: {},
      config: n.config || {},
      nextNodes: n.nextNodeId ? [n.nextNodeId] : (nodes[i + 1] ? [nodes[i + 1].id] : []),
      status: 'pending' as NodeStatus,
      startedAt: null,
      completedAt: null,
      error: null
    }))
  }
}
