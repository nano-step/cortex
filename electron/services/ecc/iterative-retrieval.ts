import { getProxyUrl, getProxyKey } from '../settings-service'
import { getTrainingModel } from '../training/training-model'

export interface RetrievalResult {
  content: string
  sufficient: boolean
  followUpQuestions: string[]
  cycles: number
}

export interface RetrievalContext {
  objective: string
  query: string
  previousResults: string[]
}

const MAX_CYCLES = 3

export async function iterativeRetrieve(
  objective: string,
  initialQuery: string,
  retriever: (query: string) => Promise<string>,
  maxCycles: number = MAX_CYCLES
): Promise<RetrievalResult> {
  const previousResults: string[] = []
  let currentQuery = initialQuery
  let cycles = 0

  while (cycles < maxCycles) {
    cycles++

    const result = await retriever(currentQuery)
    previousResults.push(result)

    const evaluation = await evaluateResult(objective, currentQuery, result, previousResults)

    if (evaluation.sufficient) {
      return {
        content: previousResults.join('\n\n---\n\n'),
        sufficient: true,
        followUpQuestions: [],
        cycles
      }
    }

    if (evaluation.followUpQuestions.length === 0) break

    currentQuery = evaluation.followUpQuestions[0]
  }

  return {
    content: previousResults.join('\n\n---\n\n'),
    sufficient: previousResults.length > 0,
    followUpQuestions: [],
    cycles
  }
}

async function evaluateResult(
  objective: string,
  query: string,
  result: string,
  allResults: string[]
): Promise<{ sufficient: boolean; followUpQuestions: string[] }> {
  try {
    const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
      body: JSON.stringify({
        model: getTrainingModel(),
        messages: [
          {
            role: 'system',
            content: `You evaluate whether retrieved information is sufficient to fulfill an objective.
Return JSON: {"sufficient": true/false, "followUpQuestions": ["question1", "question2"]}
- If the result fully answers the objective, set sufficient=true and empty followUpQuestions
- If more info is needed, set sufficient=false and list 1-2 specific follow-up questions
- Follow-up questions should target GAPS in the current results, not repeat what's known`
          },
          {
            role: 'user',
            content: `Objective: ${objective}\nQuery: ${query}\nResult (${result.length} chars): ${result.slice(0, 2000)}\nPrevious results: ${allResults.length - 1} cycles\n\nIs this sufficient?`
          }
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 512
      }),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) return { sufficient: true, followUpQuestions: [] }
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content || ''

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { sufficient: true, followUpQuestions: [] }

    const parsed = JSON.parse(jsonMatch[0]) as { sufficient: boolean; followUpQuestions: string[] }
    return {
      sufficient: !!parsed.sufficient,
      followUpQuestions: Array.isArray(parsed.followUpQuestions) ? parsed.followUpQuestions.slice(0, 2) : []
    }
  } catch {
    return { sufficient: true, followUpQuestions: [] }
  }
}
