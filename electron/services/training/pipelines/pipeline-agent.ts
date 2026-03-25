import type { TrainingPipeline, PipelineContext, PipelineResult } from '../types'
import { getDb } from '../../db'
import { randomUUID } from 'crypto'
import { agentScoreQueries, recordMetric } from '../training-db'

async function execute(context: PipelineContext): Promise<PipelineResult> {
  const start = Date.now()

  try {
    const db = getDb()

    const recentMessages = db.prepare(`
      SELECT m.conversation_id, m.role, m.content, m.model, m.created_at,
             c.project_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.created_at > ? AND m.role = 'assistant' AND m.model IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 200
    `).all(Date.now() - 24 * 60 * 60 * 1000) as Array<{
      conversation_id: string; role: string; content: string;
      model: string; created_at: number; project_id: string
    }>

    const modelStats = new Map<string, {
      projectId: string; calls: number; successSignals: number;
      negativeSignals: number; totalLatency: number
    }>()

    for (const msg of recentMessages) {
      const key = `${msg.model}:${msg.project_id}`
      const stat = modelStats.get(key) || {
        projectId: msg.project_id, calls: 0, successSignals: 0, negativeSignals: 0, totalLatency: 0
      }
      stat.calls++
      modelStats.set(key, stat)
    }

    const feedbackRows = db.prepare(`
      SELECT fs.signal_type, fs.query, fs.project_id
      FROM feedback_signals fs
      WHERE fs.created_at > ?
    `).all(Date.now() - 24 * 60 * 60 * 1000) as Array<{
      signal_type: string; query: string; project_id: string
    }>

    const projectFeedback = new Map<string, { positive: number; negative: number }>()
    for (const fb of feedbackRows) {
      const stat = projectFeedback.get(fb.project_id) || { positive: 0, negative: 0 }
      if (['thumbs_up', 'copy', 'no_follow_up'].includes(fb.signal_type)) {
        stat.positive++
      } else if (['thumbs_down', 'follow_up_quick'].includes(fb.signal_type)) {
        stat.negative++
      }
      projectFeedback.set(fb.project_id, stat)
    }

    let scoresUpdated = 0
    for (const [key, stat] of modelStats) {
      const [agentName, projectId] = key.split(':')
      const feedback = projectFeedback.get(projectId) || { positive: 0, negative: 0 }
      const total = feedback.positive + feedback.negative
      const satisfaction = total > 0 ? (feedback.positive - feedback.negative) / total : 0

      try {
        agentScoreQueries.upsert(db).run(
          randomUUID(), agentName, projectId,
          stat.calls, feedback.positive, 0, satisfaction, Date.now()
        )
        scoresUpdated++
      } catch (err) {
        console.error(`[Pipeline:Agent] Score upsert failed for ${agentName}:`, err)
      }
    }

    const topAgents = agentScoreQueries.getTopAgents(db).all() as Array<{
      agent_name: string; score: number; calls: number
    }>

    if (topAgents.length > 0) {
      console.log('[Pipeline:Agent] Top agents:', topAgents.slice(0, 5).map(a => `${a.agent_name}: ${(a.score * 100).toFixed(0)}%`).join(', '))
    }

    const metrics = {
      messagesAnalyzed: recentMessages.length,
      feedbackSignals: feedbackRows.length,
      scoresUpdated,
      uniqueModels: modelStats.size
    }

    console.log(`[Pipeline:Agent] Completed — ${scoresUpdated} scores updated from ${recentMessages.length} messages`)
    return { pipeline: 'agent', success: true, metrics, durationMs: Date.now() - start }
  } catch (err) {
    return { pipeline: 'agent', success: false, metrics: {}, durationMs: Date.now() - start, error: (err as Error).message }
  }
}

export function createAgentPipeline(): TrainingPipeline {
  return {
    name: 'agent',
    priority: 1,
    triggers: ['interval', 'idle'],
    enabled: true,
    execute
  }
}
