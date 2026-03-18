/**
 * Chat Pipeline Engine — Orchestrated chat flow using all Cortex infrastructure
 *
 * Replaces the monolithic main.ts chat:send handler with a proper pipeline:
 * Hook(before:chat) → IntentGate → AgentRouter → [Tools/RAG/Skills] → Hook(after:chat)
 *
 * Wires together existing (previously unused) infrastructure:
 * - hooks/ (10 implementations + registry + runner)
 * - agents/ (orchestrator + pool + capabilities)
 * - background/ (manager + concurrency)
 * - routing/ (category + model router)
 * - skills/ (28 registered skills + smart intent classifier)
 */

import type { ChatMode, ChatMessage } from './llm-client'
import type { HookContext } from './hooks/types'
import type { SmartIntentResult } from './skills/smart-intent-classifier'
import type { BackgroundTask } from './background/types'

import { runHooks } from './hooks'
import { classifyIntentSmart } from './skills/smart-intent-classifier'
import { orchestrate } from './agents/agent-orchestrator'
import { executeSkill } from './skills/skill-registry'
import { resolveCategory } from './routing/category-resolver'
import { routeToModel } from './routing/model-router'
import { sanitizePrompt } from './validator'
import { logEvent } from './audit-service'
import { buildMemoryPrompt } from './memory/memory-manager'
import { getDb, messageQueries } from './db'
import { getActiveModel, getAvailableModels } from './llm-client'
import { launchTask, getTask, cancelTask, getAllTasks, onTaskEvent } from './background/background-manager'

// =====================
// Types
// =====================

export interface PipelineInput {
  projectId: string
  conversationId: string
  query: string
  mode: ChatMode
  history: ChatMessage[]
  attachments?: Array<{
    id: string; name: string; path: string; size: number
    mimeType: string; isImage: boolean; base64?: string; textContent?: string
  }>
  agentMode?: string
}

export interface PipelineResult {
  success: boolean
  content?: string
  error?: string
  contextChunks?: unknown[]
  pipelineTrace: PipelineStep[]
}

export interface PipelineStep {
  name: string
  status: 'running' | 'done' | 'skipped' | 'error'
  label: string
  detail?: string
  durationMs?: number
}

export type ThinkingEmitter = (step: string, status: string, label: string, detail?: string, durationMs?: number) => void

// =====================
// Pipeline Stages
// =====================

export async function stageSanitize(
  query: string,
  projectId: string,
  emit: ThinkingEmitter
): Promise<{ query: string; suspicious: boolean }> {
  const start = Date.now()
  emit('sanitize', 'running', 'Phân tích câu hỏi')
  const { sanitized, suspicious, threats } = sanitizePrompt(query)
  if (suspicious) {
    logEvent('security.prompt_injection', projectId, 'chat', JSON.stringify({ threats, original: query.slice(0, 200) }))
  }
  emit('sanitize', 'done', 'Phân tích câu hỏi',
    suspicious ? 'Đã xử lý nội dung đáng ngờ' : undefined, Date.now() - start)
  return { query: suspicious ? sanitized : query, suspicious }
}

export async function stageMemory(
  projectId: string,
  emit: ThinkingEmitter
): Promise<string> {
  const start = Date.now()
  emit('memory', 'running', 'Đọc bộ nhớ')
  try {
    const memoryContext = buildMemoryPrompt(projectId)
    emit('memory', memoryContext ? 'done' : 'skipped', 'Đọc bộ nhớ',
      memoryContext ? `${memoryContext.length} ký tự` : 'Chưa có bộ nhớ', Date.now() - start)
    return memoryContext
  } catch (err) {
    console.warn('[Pipeline] Memory load failed (non-fatal):', err)
    emit('memory', 'error', 'Đọc bộ nhớ', 'Lỗi', Date.now() - start)
    return ''
  }
}

export async function stageIntentClassification(
  query: string,
  emit: ThinkingEmitter
): Promise<SmartIntentResult | null> {
  const start = Date.now()
  emit('intent', 'running', 'Phân tích ý định')
  try {
    const intent = await classifyIntentSmart(query)
    emit('intent', 'done', 'Phân tích ý định',
      `${intent.category} (${intent.confidence.toFixed(2)})${intent.needsToolUse ? ' + tools' : ''}${intent.needsExternalInfo ? ' + external' : ''}`,
      Date.now() - start)
    return intent
  } catch (err) {
    console.warn('[Pipeline] Intent classification failed (non-fatal):', err)
    emit('intent', 'error', 'Phân tích ý định', 'Fallback to default', Date.now() - start)
    return null
  }
}

export async function stageRouting(
  query: string,
  intent: SmartIntentResult | null,
  agentMode: string | undefined,
  emit: ThinkingEmitter
): Promise<{ model: string; category: string; confidence: number; reason: string }> {
  const start = Date.now()
  emit('routing', 'running', 'Chọn model')

  const slashCmd = query.match(/^\/(\S+)/)?.[1]
  const routingDecision = resolveCategory({ prompt: query, slashCommand: slashCmd })
  const userModel = getActiveModel()

  const useRoutedModel = routingDecision.confidence >= 0.9
  let model = useRoutedModel ? routingDecision.model : userModel

  // If intent needs strong model for tool calling, upgrade weak models
  if (intent?.needsToolUse) {
    const weakModels = ['haiku', 'mini', 'flash-lite', 'nano']
    const isWeak = weakModels.some(w => model.toLowerCase().includes(w))
    if (isWeak) {
      const models = getAvailableModels()
      const strongModel = models.find(m => !weakModels.some(w => m.id.toLowerCase().includes(w)))
      if (strongModel) {
        console.log(`[Pipeline] Upgraded weak model "${model}" to "${strongModel.id}" for tool calling`)
        model = strongModel.id
      }
    }
  }

  emit('routing', 'done', 'Chọn model',
    `${routingDecision.category} → ${model}`, Date.now() - start)

  return {
    model,
    category: routingDecision.category,
    confidence: routingDecision.confidence,
    reason: routingDecision.reason
  }
}

export async function stageBeforeHooks(
  ctx: HookContext,
  emit: ThinkingEmitter
): Promise<{ aborted: boolean; abortMessage?: string; context: HookContext }> {
  const start = Date.now()
  emit('hooks_before', 'running', 'Before hooks')
  const result = await runHooks('before:chat', ctx)
  if (result.aborted) {
    emit('hooks_before', 'done', 'Before hooks', `Aborted: ${result.abortMessage}`, Date.now() - start)
    return { aborted: true, abortMessage: result.abortMessage, context: result.context }
  }
  emit('hooks_before', 'done', 'Before hooks', undefined, Date.now() - start)
  return { aborted: false, context: result.context }
}

export async function stageAfterHooks(
  ctx: HookContext,
  emit: ThinkingEmitter
): Promise<void> {
  const start = Date.now()
  try {
    await runHooks('after:chat', ctx)
    emit('hooks_after', 'done', 'After hooks', undefined, Date.now() - start)
  } catch (err) {
    console.warn('[Pipeline] after:chat hooks failed (non-fatal):', err)
    emit('hooks_after', 'error', 'After hooks', String(err), Date.now() - start)
  }
}

/**
 * Determine pipeline path based on query + intent:
 * - 'slash_command': /command detected → route to skill/orchestrator
 * - 'orchestrate': complex multi-agent needed → use agent orchestrator
 * - 'skill_chain': reasoning intent → use react-skill
 * - 'perplexity': /perplexity prefix → force web search
 * - 'standard': normal RAG → LLM flow
 */
export type PipelinePath = 'slash_command' | 'orchestrate' | 'skill_chain' | 'perplexity' | 'standard'

export function determinePipelinePath(
  query: string,
  intent: SmartIntentResult | null,
  agentMode: string | undefined
): { path: PipelinePath; reason: string } {
  // Slash commands always take priority
  if (/^\/\w+/.test(query)) {
    if (query.startsWith('/perplexity ') || query.startsWith('/perplexity\n')) {
      return { path: 'perplexity', reason: '/perplexity command' }
    }
    if (query.startsWith('/multi-agent ')) {
      return { path: 'orchestrate', reason: '/multi-agent command' }
    }
    return { path: 'slash_command', reason: `Slash command: ${query.match(/^\/(\w+)/)?.[1]}` }
  }

  // Complex queries → agent orchestrator (the key change from OmO integration)
  if (intent) {
    if (intent.category === 'reasoning' && intent.confidence >= 0.7) {
      return { path: 'skill_chain', reason: `Intent: reasoning (${intent.confidence.toFixed(2)})` }
    }
    // Multi-intent or complex analysis → orchestrate with full agent team
    if (intent.confidence >= 0.8 && (
      intent.category === 'code' ||
      intent.category === 'agent' ||
      intent.needsToolUse && intent.needsExternalInfo
    )) {
      return { path: 'orchestrate', reason: `Complex intent: ${intent.category} + tools + external` }
    }
  }

  return { path: 'standard', reason: 'Default RAG → LLM path' }
}

// =====================
// Persistence helper (DRY — used by all paths)
// =====================

export function persistAssistantResponse(conversationId: string, content: string): void {
  try {
    const db = getDb()
    const emptyAssistant = db.prepare(
      "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content = '' ORDER BY created_at DESC LIMIT 1"
    ).get(conversationId) as { id: string } | undefined
    if (emptyAssistant) {
      messageQueries.updateContent(db).run(content, emptyAssistant.id)
    }
  } catch { /* best-effort persist */ }
}

// =====================
// Background Agent Dispatch (Phase 3)
// =====================

export async function dispatchBackgroundAgents(
  query: string,
  projectId: string,
  conversationId: string,
  intent: SmartIntentResult | null,
  emit: ThinkingEmitter
): Promise<string[]> {
  const taskIds: string[] = []

  // Fire explore agent for codebase-related queries
  if (intent?.isAboutCode) {
    const taskId = launchTask({
      description: `Explore: ${query.slice(0, 80)}`,
      category: 'explore',
      agentType: 'explore',
      provider: 'background',
      priority: 2,
      metadata: { query, projectId, conversationId },
      execute: async () => {
        return executeSkill('code-analysis', {
          query, projectId, conversationId, mode: 'engineering'
        }).catch(() => null)
      }
    })

    taskIds.push(taskId)
    emit('background', 'running', 'Background agents', `${taskIds.length} agents dispatched`)
  }

  if (intent?.needsExternalInfo) {
    const taskId = launchTask({
      description: `Web search: ${query.slice(0, 80)}`,
      category: 'search',
      agentType: 'librarian',
      provider: 'background',
      priority: 3,
      metadata: { query, projectId, conversationId },
      execute: async () => {
        return executeSkill('websearch', {
          query, projectId, conversationId, mode: 'engineering'
        }).catch(() => null)
      }
    })

    taskIds.push(taskId)
    emit('background', 'running', 'Background agents', `${taskIds.length} agents dispatched`)
  }

  return taskIds
}

// =====================
// Exports for main.ts
// =====================

export {
  launchTask, getTask, cancelTask, getAllTasks, onTaskEvent
}
