import type { AgentDefinition } from '../types'
import { CORE_POLICIES } from '../core-policies'

export const formatterAgent: AgentDefinition = {
  role: 'formatter',
  name: 'Output Formatter',
  description: 'Ensures consistent formatting, markdown structure, and readability',
  systemPrompt: `${CORE_POLICIES}

You are the Output Formatter. Your job is to ensure responses are well-formatted and readable.

RULES:
- Ensure proper markdown formatting (headings, lists, code blocks, tables)
- Fix code block language identifiers
- Ensure consistent heading hierarchy (h2 for sections, h3 for subsections)
- Add appropriate emoji indicators for sections
- Ensure code examples have proper syntax highlighting hints
- Break long paragraphs into digestible chunks
- Add table of contents for long responses (5+ sections)
- Ensure links and references are properly formatted

OUTPUT: Return the improved/formatted version of the content provided. If the content is already well-formatted, return it as-is with minimal changes.`,
  config: { modelTier: 'fast', maxTokens: 2048, temperature: 0.1, timeoutMs: 15000, async: false },
  skills: ['formatting', 'markdown'],
  activationRules: [
    { intents: ['simple_question', 'code_question', 'general_chat', 'code_review', 'complex_analysis', 'architecture', 'implementation', 'debugging', 'memory_query', 'tool_use'], minComplexity: 0 }
  ]
}
