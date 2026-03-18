/**
 * Smart Intent Classifier — LLM-based intent classification using existing proxy
 *
 * Replaces keyword-based classification with a fast LLM call that understands
 * nuanced user queries. Falls back to keyword matching on failure.
 *
 * Key improvements over keyword matching:
 * - "Dự án có bao nhiêu người?" → tool (needs git contributor analysis)
 * - "Tên AVA config trong GeoLocation?" → rag + tool (needs deep code search)
 * - "Phân tích architecture repo X" → code + tool (needs URL fetch + analysis)
 */

import type { SkillCategory } from './types'
import { getProxyUrl, getProxyKey } from '../settings-service'

// =====================
// Types
// =====================

export interface SmartIntentResult {
  category: SkillCategory
  secondaryCategories: SkillCategory[]
  confidence: number
  reasoning: string
  suggestedSkills: string[]
  isAboutCode: boolean
  needsExternalInfo: boolean
  needsToolUse: boolean
  hasUrl: boolean
}

// =====================
// LLM-based Classifier
// =====================

const CLASSIFIER_SYSTEM = `You are an intent classifier for a code AI assistant called Cortex.
Cortex has indexed a codebase and can search it (RAG), but also has tools for git, file system, web search, and code analysis.

Classify the user's query into ONE primary category:
- "rag": Questions about code content, architecture, how something works in the codebase
- "memory": Questions about past conversations, preferences, what was discussed before
- "code": Requests for code analysis, architecture diagrams, dependency analysis, refactoring
- "agent": Requests to DO something: fix bugs, implement features, create files, run code
- "reasoning": Complex multi-step problems needing structured thinking or planning
- "tool": Queries needing external tools: git history, team info, web search, URL reading, project stats
- "learning": Questions about improving Cortex itself, feedback, preferences
- "efficiency": Questions about cost, tokens, caching, model selection

CRITICAL RULES:
1. If the query asks about PEOPLE, TEAM, CONTRIBUTORS, or PROJECT METADATA → "tool" (needs git data)
2. If the query contains a URL → "tool" (needs URL fetching) AND set hasUrl=true
3. If the query asks about a SPECIFIC CONFIG VALUE or ENV VAR → "rag" + needsToolUse=true (RAG may miss, grep helps)
4. If RAG alone likely CANNOT answer (team size, deployment status, external info) → "tool"
5. If the query is in Vietnamese, classify it the same way as English
6. "Phân tích architecture" or "analyze" → "code" (not just rag)

Respond with ONLY valid JSON, no markdown fences.`

const CLASSIFIER_PROMPT = `Classify this query. Return JSON:
{"category":"...","secondaryCategories":["..."],"confidence":0.9,"reasoning":"...","suggestedSkills":["..."],"isAboutCode":true/false,"needsExternalInfo":true/false,"needsToolUse":true/false,"hasUrl":true/false}

Query: `

/** Fast model for classification — cheap and quick */
const CLASSIFIER_MODEL = 'gemini-2.5-flash-lite'
const CLASSIFIER_TIMEOUT = 5000

export async function classifyIntentSmart(query: string): Promise<SmartIntentResult> {
  try {
    const proxyUrl = getProxyUrl()
    const proxyKey = getProxyKey()

    const response = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${proxyKey}`
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user', content: CLASSIFIER_PROMPT + query.slice(0, 500) }
        ],
        max_tokens: 300,
        temperature: 0,
        stream: false
      }),
      signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT)
    })

    if (!response.ok) {
      console.warn(`[SmartClassifier] LLM call failed (${response.status}), falling back to keywords`)
      return classifyIntentKeywordFallback(query)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      return classifyIntentKeywordFallback(query)
    }

    const parsed = parseClassifierResponse(content)
    if (parsed) {
      console.log(`[SmartClassifier] ${parsed.category} (${parsed.confidence.toFixed(2)}) — ${parsed.reasoning}`)
      return parsed
    }

    console.warn('[SmartClassifier] Failed to parse LLM response, falling back to keywords')
    return classifyIntentKeywordFallback(query)
  } catch (err) {
    console.warn('[SmartClassifier] Classification failed, falling back to keywords:', (err as Error).message)
    return classifyIntentKeywordFallback(query)
  }
}

function parseClassifierResponse(raw: string): SmartIntentResult | null {
  // Strip markdown fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // Try direct parse
  try {
    const obj = JSON.parse(stripped)
    return validateAndNormalize(obj)
  } catch { /* not clean JSON */ }

  // Extract JSON object from surrounding text
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0])
      return validateAndNormalize(obj)
    } catch { /* malformed */ }
  }

  return null
}

const VALID_CATEGORIES: SkillCategory[] = ['rag', 'memory', 'code', 'agent', 'reasoning', 'learning', 'efficiency', 'tool']

function validateAndNormalize(obj: Record<string, unknown>): SmartIntentResult | null {
  const category = String(obj.category || '')
  if (!VALID_CATEGORIES.includes(category as SkillCategory)) return null

  return {
    category: category as SkillCategory,
    secondaryCategories: Array.isArray(obj.secondaryCategories)
      ? (obj.secondaryCategories as string[]).filter(c => VALID_CATEGORIES.includes(c as SkillCategory)) as SkillCategory[]
      : [],
    confidence: typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : 0.7,
    reasoning: String(obj.reasoning || ''),
    suggestedSkills: Array.isArray(obj.suggestedSkills) ? (obj.suggestedSkills as string[]) : [],
    isAboutCode: Boolean(obj.isAboutCode),
    needsExternalInfo: Boolean(obj.needsExternalInfo),
    needsToolUse: Boolean(obj.needsToolUse),
    hasUrl: Boolean(obj.hasUrl)
  }
}

// =====================
// Keyword Fallback (preserved from original skill-router.ts)
// =====================

const INTENT_KEYWORDS: Record<SkillCategory, string[]> = {
  rag: ['search', 'find', 'where', 'locate', 'look up', 'lookup', 'which file', 'what file', 'show me', 'how does', 'how is'],
  memory: ['remember', 'recall', 'memory', 'prefer', 'history', 'past', 'previously', 'forgot', 'my style', 'my preference'],
  code: ['analyze', 'architecture', 'impact', 'dependency', 'structure', 'diagram', 'refactor', 'code review'],
  agent: ['fix', 'implement', 'create', 'build', 'run', 'execute', 'debug', 'deploy', 'automate'],
  reasoning: ['plan', 'think', 'step by step', 'figure out', 'work through', 'solve', 'complex'],
  learning: ['learn', 'improve', 'optimize', 'feedback', 'train', 'adapt'],
  efficiency: ['cost', 'token', 'cache', 'compress', 'cheaper', 'faster', 'optimize cost'],
  tool: ['browse', 'navigate', 'screenshot', 'terminal', 'git', 'commit', 'branch', 'contributor', 'team', 'people', 'member', 'who', 'how many']
}

/** Additional patterns that detect tool-needing queries missed by keywords */
const TOOL_NEED_PATTERNS = [
  /https?:\/\//i,                                          // URL present
  /bao nhiêu.*(người|thành viên|member|dev)/i,             // Vietnamese team size
  /how many.*(people|members|devs|contributors)/i,         // English team size
  /\b(config|env|setting|variable)\b.*\b(name|value|key)\b/i, // Config search
  /\b(git|commit|branch|merge|deploy|release)\b/i,         // Git operations
]

export function classifyIntentKeywordFallback(query: string): SmartIntentResult {
  const lower = query.toLowerCase()

  // Check tool-need patterns first (high priority overrides)
  const needsToolUse = TOOL_NEED_PATTERNS.some(p => p.test(query))
  const hasUrl = /https?:\/\//i.test(query)

  if (needsToolUse) {
    return {
      category: 'tool',
      secondaryCategories: ['rag'],
      confidence: 0.7,
      reasoning: 'Query matches tool-needing pattern (URL, git, team info, or config search)',
      suggestedSkills: hasUrl ? ['perplexity', 'websearch'] : ['git-analysis', 'code-search'],
      isAboutCode: false,
      needsExternalInfo: true,
      needsToolUse: true,
      hasUrl
    }
  }

  // Standard keyword matching
  const scores: Array<{ category: SkillCategory; score: number; keywords: string[] }> = []

  for (const [category, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const matched = keywords.filter(kw => lower.includes(kw))
    if (matched.length > 0) {
      const score = Math.min(0.8, 0.3 + matched.length * 0.15)
      scores.push({ category: category as SkillCategory, score, keywords: matched })
    }
  }

  scores.sort((a, b) => b.score - a.score)

  if (scores.length > 0) {
    const best = scores[0]
    return {
      category: best.category,
      secondaryCategories: scores.slice(1, 3).map(s => s.category),
      confidence: best.score,
      reasoning: `Keyword match: ${best.keywords.join(', ')}`,
      suggestedSkills: [],
      isAboutCode: ['rag', 'code', 'agent'].includes(best.category),
      needsExternalInfo: false,
      needsToolUse: ['agent', 'tool'].includes(best.category),
      hasUrl: false
    }
  }

  // Question pattern → default to RAG
  if (/^(how|what|why|when|where|who|which|can|does|is|are)\b/i.test(query) ||
      /^(làm sao|thế nào|tại sao|khi nào|ở đâu|ai|cái gì|bao nhiêu)\b/i.test(query)) {
    return {
      category: 'rag',
      secondaryCategories: [],
      confidence: 0.4,
      reasoning: 'Question pattern detected, defaulting to RAG',
      suggestedSkills: [],
      isAboutCode: true,
      needsExternalInfo: false,
      needsToolUse: false,
      hasUrl: false
    }
  }

  // Ultimate fallback
  return {
    category: 'rag',
    secondaryCategories: [],
    confidence: 0.2,
    reasoning: 'No pattern matched, defaulting to RAG',
    suggestedSkills: [],
    isAboutCode: true,
    needsExternalInfo: false,
    needsToolUse: false,
    hasUrl: false
  }
}
