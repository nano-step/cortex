import type { HookDefinition, HookContext, HookResult } from '../types'
import { getRelevantInstincts, formatInstinctsAsContext, extractInstinctsFromSession, saveInstinct, loadInstincts } from '../../skills/learning/instinct-system'
import { buildMemoryPrompt } from '../../memory/memory-manager'
import { loadPreviousSessionSummary } from '../../ecc/session-persistence'
import { getRelevantCrystalsForQuery, formatCrystalsAsContext } from '../../training/pipelines/pipeline-crystal'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const sessionContextCache = new Map<string, {
  instinctContext: string
  memoryContext: string
  startedAt: number
  messageCount: number
  queries: string[]
  responses: string[]
}>()

function getSessionDir(): string {
  const userDataPath = app.getPath('userData')
  const dir = join(userDataPath, 'cortex-data', 'session-summaries')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export const sessionStartHook: HookDefinition = {
  id: 'session-lifecycle:start',
  name: 'Session Start',
  description: 'ECC-style SessionStart: preloads relevant instincts and memory context for the conversation',
  trigger: 'on:session:start',
  priority: 'high',
  enabled: true,
  async handler(context: HookContext): Promise<HookResult> {
    const { projectId, conversationId } = context
    if (!conversationId) return {}

    const instincts = getRelevantInstincts(context.query || '', 5)
    const instinctContext = formatInstinctsAsContext(instincts)
    const memoryContext = projectId ? buildMemoryPrompt(projectId) : ''

    const prevSession = projectId ? loadPreviousSessionSummary(projectId) : null
    const prevSessionContext = prevSession?.formattedContext || ''

    const crystals = projectId ? getRelevantCrystalsForQuery(projectId, context.query || '', 3) : []
    const crystalContext = formatCrystalsAsContext(crystals)

    sessionContextCache.set(conversationId, {
      instinctContext,
      memoryContext,
      startedAt: Date.now(),
      messageCount: 0,
      queries: [],
      responses: []
    })

    console.log(`[SessionHook:Start] conv=${conversationId} instincts=${instincts.length} crystals=${crystals.length} prevSession=${!!prevSession?.summary} memoryChars=${memoryContext.length}`)

    return {
      modified: true,
      data: {
        metadata: {
          ...context.metadata,
          sessionInstincts: instinctContext,
          sessionMemory: memoryContext,
          sessionCrystals: crystalContext,
          sessionPreviousContext: prevSessionContext,
          sessionStartedAt: Date.now()
        }
      }
    }
  }
}

export const sessionEndHook: HookDefinition = {
  id: 'session-lifecycle:end',
  name: 'Session End',
  description: 'ECC-style SessionEnd: extracts new instincts from session, saves session summary',
  trigger: 'on:session:end',
  priority: 'low',
  enabled: true,
  async handler(context: HookContext): Promise<HookResult> {
    const { conversationId, projectId } = context
    if (!conversationId) return {}

    const sessionCtx = sessionContextCache.get(conversationId)
    if (!sessionCtx || sessionCtx.queries.length < 3) {
      sessionContextCache.delete(conversationId)
      return {}
    }

    const history = sessionCtx.queries.flatMap((q, i) => [
      { role: 'user', content: q },
      { role: 'assistant', content: sessionCtx.responses[i] || '' }
    ])

    try {
      const newInstincts = await extractInstinctsFromSession(history)
      if (newInstincts.length > 0) {
        newInstincts.forEach(i => saveInstinct(i))
        console.log(`[SessionHook:End] Extracted ${newInstincts.length} instincts from session`)
      }

      const duration = Math.round((Date.now() - sessionCtx.startedAt) / 1000)
      const summary = {
        conversationId,
        projectId,
        duration,
        messageCount: sessionCtx.messageCount,
        instinctsExtracted: newInstincts.length,
        totalInstincts: loadInstincts().length,
        endedAt: Date.now()
      }

      const summaryPath = join(getSessionDir(), `${conversationId}-summary.json`)
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[SessionHook:End] Failed to extract instincts:', err)
    }

    sessionContextCache.delete(conversationId)
    return {}
  }
}

export const sessionTrackingHook: HookDefinition = {
  id: 'session-lifecycle:track',
  name: 'Session Tracker',
  description: 'Tracks messages within a session for instinct extraction at session end',
  trigger: 'after:chat',
  priority: 'low',
  enabled: true,
  handler(context: HookContext): HookResult {
    const { conversationId, query, response } = context
    if (!conversationId || !query || !response) return {}

    const sessionCtx = sessionContextCache.get(conversationId)
    if (!sessionCtx) return {}

    sessionCtx.messageCount++
    sessionCtx.queries.push(query.slice(0, 500))
    sessionCtx.responses.push(response.slice(0, 1000))

    return {}
  }
}

export function getSessionContext(conversationId: string) {
  return sessionContextCache.get(conversationId)
}
