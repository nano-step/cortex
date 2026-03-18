/**
 * Skill Router — Intent classification and skill routing
 *
 * V2: Uses smart LLM-based classifier with keyword fallback.
 * Now actually connected to the chat flow (was dead code before).
 */

import type { SkillInput, SkillOutput, SkillRouteResult, SkillCategory } from './types'
import { getActiveSkills, executeSkill } from './skill-registry'
import { classifyIntentSmart, classifyIntentKeywordFallback, type SmartIntentResult } from './smart-intent-classifier'

export async function classifyIntent(query: string): Promise<SmartIntentResult> {
  return classifyIntentSmart(query)
}

export function classifyIntentSync(query: string): SmartIntentResult {
  return classifyIntentKeywordFallback(query)
}

export async function routeQuery(input: SkillInput): Promise<SkillRouteResult[]> {
  const intent = await classifyIntent(input.query)
  const activeSkills = getActiveSkills()
  const results: SkillRouteResult[] = []

  const categoriesToCheck: SkillCategory[] = [intent.category, ...intent.secondaryCategories]

  for (const category of categoriesToCheck) {
    const matchingSkills = activeSkills.filter(s => s.category === category)

    for (const skill of matchingSkills) {
      try {
        const canHandle = await skill.canHandle(input)
        if (canHandle) {
          const isSecondary = category !== intent.category
          results.push({
            skill,
            confidence: isSecondary ? intent.confidence * 0.7 : intent.confidence,
            reason: `Smart intent: ${category} (${intent.reasoning})`
          })
        }
      } catch (err) {
        console.warn(`[SkillRouter] canHandle check failed for ${skill.name}:`, err)
      }
    }
  }

  const chatSkill = activeSkills.find(s => s.name === 'chat' || s.name === 'cortex-chat')
  if (chatSkill) {
    const alreadyIncluded = results.some(r => r.skill.name === chatSkill.name)
    if (!alreadyIncluded) {
      results.push({
        skill: chatSkill,
        confidence: 0.1,
        reason: 'Fallback: chat skill'
      })
    }
  }

  results.sort((a, b) => b.confidence - a.confidence)
  return results
}

export async function selectBestSkill(input: SkillInput): Promise<SkillRouteResult | null> {
  const routes = await routeQuery(input)
  return routes[0] || null
}

export async function executeRouted(input: SkillInput): Promise<SkillOutput> {
  const route = await selectBestSkill(input)

  if (!route) {
    return {
      content: 'No skill available to handle this query.',
      metadata: { error: 'no_matching_skill' }
    }
  }

  console.log(`[SkillRouter] Routing to '${route.skill.name}' (confidence: ${route.confidence.toFixed(2)}, reason: ${route.reason})`)

  try {
    return await executeSkill(route.skill.name, input)
  } catch (err) {
    console.error(`[SkillRouter] Execution failed for ${route.skill.name}:`, err)

    const routes = await routeQuery(input)
    const fallback = routes.find(r => r.skill.name !== route.skill.name)
    if (fallback) {
      console.log(`[SkillRouter] Falling back to '${fallback.skill.name}'`)
      return await executeSkill(fallback.skill.name, input)
    }

    return {
      content: `Skill execution failed: ${String(err)}`,
      metadata: { error: 'execution_failed', skill: route.skill.name }
    }
  }
}
