import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { estimateTokens } from '../context-compressor'

export interface SessionSummary {
  conversationId: string
  projectId: string
  duration: number
  messageCount: number
  instinctsExtracted: number
  endedAt: number
}

export interface PreviousSessionContext {
  summary: SessionSummary | null
  unfinishedTasks: string[]
  keyDecisions: string[]
  formattedContext: string
}

function getSessionDir(): string {
  return join(app.getPath('userData'), 'cortex-data', 'session-summaries')
}

export function loadPreviousSessionSummary(projectId: string): PreviousSessionContext {
  const dir = getSessionDir()
  if (!existsSync(dir)) return { summary: null, unfinishedTasks: [], keyDecisions: [], formattedContext: '' }

  const files = readdirSync(dir)
    .filter(f => f.endsWith('-summary.json'))
    .sort()
    .reverse()

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8')
      const summary = JSON.parse(raw) as SessionSummary
      if (summary.projectId === projectId) {
        const formattedContext = formatPreviousSession(summary)
        return { summary, unfinishedTasks: [], keyDecisions: [], formattedContext }
      }
    } catch {
      continue
    }
  }

  return { summary: null, unfinishedTasks: [], keyDecisions: [], formattedContext: '' }
}

function formatPreviousSession(summary: SessionSummary): string {
  const duration = Math.round(summary.duration / 60)
  const lines = [
    '<previous_session>',
    `Last session: ${new Date(summary.endedAt).toLocaleString()}`,
    `Duration: ${duration} minutes, ${summary.messageCount} messages`,
    `Instincts learned: ${summary.instinctsExtracted}`,
    '</previous_session>'
  ]
  return lines.join('\n')
}

export interface CompactSuggestion {
  shouldCompact: boolean
  reason: string
  currentTokens: number
  limit: number
  usagePercent: number
}

export function evaluateCompactNeed(
  currentTokens: number,
  contextLimit: number = 128000,
  warningThreshold: number = 0.75,
  criticalThreshold: number = 0.9
): CompactSuggestion {
  const usagePercent = currentTokens / contextLimit

  if (usagePercent >= criticalThreshold) {
    return {
      shouldCompact: true,
      reason: `Context at ${Math.round(usagePercent * 100)}% — CRITICAL. Compact immediately to prevent quality degradation.`,
      currentTokens,
      limit: contextLimit,
      usagePercent
    }
  }

  if (usagePercent >= warningThreshold) {
    return {
      shouldCompact: true,
      reason: `Context at ${Math.round(usagePercent * 100)}% — Consider compacting. Save important state first.`,
      currentTokens,
      limit: contextLimit,
      usagePercent
    }
  }

  return {
    shouldCompact: false,
    reason: `Context at ${Math.round(usagePercent * 100)}% — healthy.`,
    currentTokens,
    limit: contextLimit,
    usagePercent
  }
}

export function getRecentSessions(projectId: string, limit: number = 10): SessionSummary[] {
  const dir = getSessionDir()
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter(f => f.endsWith('-summary.json'))
    .sort()
    .reverse()

  const sessions: SessionSummary[] = []
  for (const file of files) {
    if (sessions.length >= limit) break
    try {
      const raw = readFileSync(join(dir, file), 'utf-8')
      const summary = JSON.parse(raw) as SessionSummary
      if (!projectId || summary.projectId === projectId) {
        sessions.push(summary)
      }
    } catch {
      continue
    }
  }

  return sessions
}
