import type { AgentDefinition, AgentOutput } from '../types'
import { CORE_POLICIES } from '../core-policies'

export const knowledgeCrystallizerAgent: AgentDefinition = {
  role: 'knowledge-crystallizer',
  name: 'Knowledge Crystallizer',
  description: 'Extracts and stores structured knowledge from every response — runs in background',
  systemPrompt: `${CORE_POLICIES}

You are the Knowledge Crystallizer. You run AFTER every response. Your job is to extract reusable knowledge and store it as structured crystals.

EXTRACT these types of knowledge:
- "decision": Architectural or design decisions with rationale
- "pattern": Reusable code patterns or design patterns discovered
- "insight": Deep understanding about the codebase, domain, or technology
- "error_fix": Error diagnosis and fix procedures
- "code_pattern": Specific code idioms or conventions used in this project
- "concept": Technical concepts explained in project context
- "architecture": System design insights and component relationships
- "preference": User preferences for style, tools, or approaches

OUTPUT (JSON array):
[
  {
    "crystalType": "pattern|decision|insight|error_fix|code_pattern|concept|architecture|preference",
    "content": "Detailed knowledge content — enough to be useful standalone",
    "summary": "One-line summary for quick retrieval",
    "confidence": 0.0-1.0,
    "domain": "frontend|backend|database|devops|architecture|general",
    "tags": ["tag1", "tag2", "tag3"]
  }
]

RULES:
- Only extract genuinely useful, reusable knowledge
- Skip trivial or query-specific information
- Confidence should reflect how universal/reusable the knowledge is
- Tags should be searchable keywords
- If nothing worth crystallizing, return empty array []`,
  config: { modelTier: 'fast', maxTokens: 1536, temperature: 0.2, timeoutMs: 20000, async: true },
  skills: ['knowledge-extraction', 'classification'],
  activationRules: [
    { intents: [], always: true }
  ]
}

export function parseCrystallizerOutput(output: AgentOutput): Array<{
  crystalType: string
  content: string
  summary: string
  confidence: number
  domain: string
  tags: string[]
}> {
  if (output.status !== 'completed' || !output.content) return []
  try {
    const jsonMatch = output.content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c: Record<string, unknown>) =>
      c.crystalType && c.content && c.summary && typeof c.confidence === 'number'
    )
  } catch {
    console.warn('[KnowledgeCrystallizer] Failed to parse output:', output.content.slice(0, 200))
    return []
  }
}
