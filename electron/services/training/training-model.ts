import { getAvailableModels } from '../llm-client'

const CLAUDE_PATTERNS = ['claude-sonnet', 'claude-opus', 'claude-haiku']
const FALLBACK_CLAUDE = 'claude-sonnet-4-6'

export function getTrainingModel(): string {
  const models = getAvailableModels()
  const readyModels = models.filter(m => m.status === 'ready')

  for (const pattern of CLAUDE_PATTERNS) {
    const match = readyModels.find(m => m.id.includes(pattern))
    if (match) return match.id
  }

  const anyClaudeModel = readyModels.find(m => m.id.toLowerCase().includes('claude'))
  if (anyClaudeModel) return anyClaudeModel.id

  return FALLBACK_CLAUDE
}

export function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('claude')
}
