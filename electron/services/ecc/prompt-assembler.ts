import { buildMemoryPrompt } from '../memory/memory-manager'
import { getRelevantInstincts, formatInstinctsAsContext } from '../skills/learning/instinct-system'
import { getRelevantCrystalsForQuery, formatCrystalsAsContext } from '../training/pipelines/pipeline-crystal'
import { getModePromptAddition, getContextMode } from './context-modes'
import { loadPreviousSessionSummary } from './session-persistence'
import { estimateTokens } from '../context-compressor'

export interface AssembledPrompt {
  sections: PromptSection[]
  totalTokens: number
  tokensPerSection: Record<string, number>
}

export interface PromptSection {
  name: string
  content: string
  priority: number
  tokens: number
}

const MAX_CONTEXT_TOKENS = 8000

export function assemblePrompt(
  projectId: string,
  query: string,
  conversationId?: string,
  tokenBudget: number = MAX_CONTEXT_TOKENS
): AssembledPrompt {
  const sections: PromptSection[] = []

  const modePrompt = getModePromptAddition()
  if (modePrompt) {
    sections.push({ name: 'mode', content: modePrompt, priority: 0, tokens: estimateTokens(modePrompt) })
  }

  const memoryPrompt = buildMemoryPrompt(projectId)
  if (memoryPrompt) {
    sections.push({ name: 'memory', content: memoryPrompt, priority: 1, tokens: estimateTokens(memoryPrompt) })
  }

  const instincts = getRelevantInstincts(query, 5)
  const instinctContext = formatInstinctsAsContext(instincts)
  if (instinctContext) {
    sections.push({ name: 'instincts', content: instinctContext, priority: 2, tokens: estimateTokens(instinctContext) })
  }

  const crystals = getRelevantCrystalsForQuery(projectId, query, 3)
  const crystalContext = formatCrystalsAsContext(crystals)
  if (crystalContext) {
    sections.push({ name: 'crystals', content: crystalContext, priority: 3, tokens: estimateTokens(crystalContext) })
  }

  const prevSession = loadPreviousSessionSummary(projectId)
  if (prevSession.formattedContext) {
    sections.push({ name: 'previous_session', content: prevSession.formattedContext, priority: 4, tokens: estimateTokens(prevSession.formattedContext) })
  }

  sections.sort((a, b) => a.priority - b.priority)

  const included: PromptSection[] = []
  let totalTokens = 0
  for (const section of sections) {
    if (totalTokens + section.tokens <= tokenBudget) {
      included.push(section)
      totalTokens += section.tokens
    }
  }

  const tokensPerSection: Record<string, number> = {}
  for (const s of included) tokensPerSection[s.name] = s.tokens

  return { sections: included, totalTokens, tokensPerSection }
}

export function formatAssembledPrompt(assembled: AssembledPrompt): string {
  return assembled.sections.map(s => s.content).join('\n\n')
}

export function getPromptBudgetStatus(assembled: AssembledPrompt, limit: number = MAX_CONTEXT_TOKENS): {
  used: number
  limit: number
  usagePercent: number
  sectionsIncluded: string[]
  sectionsDropped: string[]
} {
  return {
    used: assembled.totalTokens,
    limit,
    usagePercent: Math.round((assembled.totalTokens / limit) * 100),
    sectionsIncluded: assembled.sections.map(s => s.name),
    sectionsDropped: []
  }
}
