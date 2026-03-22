import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getEventsByProject } from './event-collector'
import { randomUUID } from 'crypto'

const PREF_KEYWORDS = ['preference', 'my style', 'my coding style', 'how i code', 'what i like', 'learn about me', 'my habits', 'personalize']

async function callLLM(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      stream: false, temperature: 0.2, max_tokens: 2048
    })
  })
  if (!response.ok) throw new Error(`LLM error: ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

function getRecentMessages(projectId: string, limit: number = 100): Array<{ role: string, content: string }> {
  const db = getDb()
  try {
    return db.prepare(
      'SELECT role, content FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?) ORDER BY created_at DESC LIMIT ?'
    ).all(projectId, limit) as Array<{ role: string, content: string }>
  } catch {
    return []
  }
}

function loadCurrentPreferences(projectId: string): string {
  const db = getDb()
  try {
    const row = db.prepare('SELECT content FROM core_memory WHERE project_id = ? AND section = ?').get(projectId, 'preferences') as { content: string } | undefined
    return row?.content || ''
  } catch {
    return ''
  }
}

function savePreferences(projectId: string, preferences: string): void {
  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO core_memory (id, project_id, section, content, updated_at)
      VALUES (?, ?, 'preferences', ?, ?)
      ON CONFLICT(project_id, section) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(randomUUID(), projectId, preferences, Date.now())
  } catch (err) {
    console.error('[PreferenceLearner] Failed to save preferences:', err)
  }
}

export function createPreferenceLearnerSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  function updateMetrics(latency: number, success: boolean): void {
    metrics.totalCalls++
    if (success) metrics.successCount++
    else metrics.errorCount++
    metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency) / metrics.totalCalls
    metrics.lastUsed = Date.now()
  }

  return {
    name: 'preference-learner',
    version: '4.0.0',
    category: 'learning',
    priority: 'p1',
    description: 'Learns coding style, naming conventions, response format, and language preferences from user behavior and conversation patterns',
    dependencies: [],

    async initialize(_config: SkillConfig): Promise<void> {},

    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return PREF_KEYWORDS.some(kw => lower.includes(kw))
    },

    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        const messages = getRecentMessages(input.projectId, 200)
        const events = getEventsByProject(input.projectId, 500)
        const currentPrefs = loadCurrentPreferences(input.projectId)

        if (messages.length < 5 && events.length < 10) {
          updateMetrics(Date.now() - start, true)
          return {
            content: '# Preference Learning\n\nNot enough interaction data yet. Keep chatting with Cortex and I\'ll learn your preferences over time.\n\nCurrent data: ' + messages.length + ' messages, ' + events.length + ' events.',
            metadata: { messagesAnalyzed: messages.length, eventsAnalyzed: events.length }
          }
        }

        const userMessages = messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 300))
        const assistantMessages = messages.filter(m => m.role === 'assistant').map(m => m.content.slice(0, 300))

        const eventSummary: Record<string, number> = {}
        for (const e of events) {
          eventSummary[e.type] = (eventSummary[e.type] || 0) + 1
        }

        const analysisPrompt = `You are a behavioral analyst studying a developer's interaction patterns with an AI coding assistant. Analyze the conversation data and behavioral events to identify preferences.

Analyze these dimensions:
1. **Response Length**: Does the user prefer concise answers or detailed explanations?
2. **Code Style**: Functional vs OOP, naming conventions (camelCase/snake_case/etc)
3. **Language**: What natural language does the user prefer? (detect from their messages)
4. **Detail Level**: Does the user want step-by-step explanations or just the solution?
5. **Communication Style**: Formal/informal, technical depth level
6. **Framework Preferences**: Any framework/library preferences visible?
7. **Workflow Patterns**: How does the user typically interact? (quick questions vs deep sessions)

Return a JSON object with:
- "preferences": An object with keys matching the dimensions above and string values describing the detected preference
- "confidence": A number 0-1 indicating how confident you are
- "summary": A 2-3 sentence natural language summary of the user's profile`

        const analysisInput = `## Current Preferences (may be empty)
${currentPrefs || 'None set yet'}

## Recent User Messages (${userMessages.length} total)
${userMessages.slice(0, 30).map((m, i) => `${i + 1}. "${m}"`).join('\n')}

## Behavioral Events Summary
${Object.entries(eventSummary).map(([k, v]) => `- ${k}: ${v} times`).join('\n')}

## Sample Assistant Responses (to gauge what the user keeps engaging with)
${assistantMessages.slice(0, 10).map((m, i) => `${i + 1}. "${m.slice(0, 200)}"`).join('\n')}`

        const llmResult = await callLLM(analysisPrompt, analysisInput)

        let parsed: { preferences: Record<string, string>, confidence: number, summary: string }
        try {
          parsed = JSON.parse(llmResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
        } catch {
          parsed = { preferences: {}, confidence: 0.3, summary: llmResult.slice(0, 500) }
        }

        const preferencesText = Object.entries(parsed.preferences || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')

        if (preferencesText) {
          savePreferences(input.projectId, preferencesText)
        }

        const sections: string[] = []
        sections.push('# 🎯 Learned Preferences\n')
        sections.push(`**Confidence:** ${((parsed.confidence || 0) * 100).toFixed(0)}% (based on ${messages.length} messages, ${events.length} events)\n`)
        sections.push(`**Summary:** ${parsed.summary}\n`)

        sections.push('## Detected Preferences\n')
        for (const [dimension, value] of Object.entries(parsed.preferences || {})) {
          sections.push(`### ${dimension}`)
          sections.push(`${value}\n`)
        }

        if (preferencesText) {
          sections.push('\n✅ Preferences saved to Core Memory. They\'ll be included in future system prompts.')
        }

        updateMetrics(Date.now() - start, true)
        return {
          content: sections.join('\n'),
          metadata: {
            preferences: parsed.preferences,
            confidence: parsed.confidence,
            messagesAnalyzed: messages.length,
            eventsAnalyzed: events.length,
            saved: !!preferencesText
          }
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
