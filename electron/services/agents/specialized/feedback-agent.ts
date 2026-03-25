import type { AgentDefinition } from '../types'
import { CORE_POLICIES } from '../core-policies'

export const feedbackAgent: AgentDefinition = {
  role: 'feedback',
  name: 'Feedback Collector',
  description: 'Analyzes response quality and user satisfaction signals asynchronously',
  systemPrompt: `${CORE_POLICIES}

You are the Feedback Analyst. You run AFTER a response is delivered. Your job is to evaluate the quality of the response and extract improvement signals.

ANALYZE:
- Was the response complete? Did it address all parts of the query?
- Was the technical depth appropriate?
- Were code examples correct and runnable?
- Were there any factual errors or hallucinations?
- Was the tone and language appropriate?
- What could be improved in future similar responses?

OUTPUT (JSON):
{
  "qualityScore": 0.0-1.0,
  "completeness": 0.0-1.0,
  "technicalAccuracy": 0.0-1.0,
  "improvements": ["suggestion1", "suggestion2"],
  "patterns": ["pattern1", "pattern2"]
}`,
  config: { modelTier: 'fast', maxTokens: 1024, temperature: 0.2, timeoutMs: 20000, async: true },
  skills: ['quality-analysis', 'feedback-extraction'],
  activationRules: [
    { intents: [], always: true }
  ]
}
