import { randomUUID } from 'crypto'
import { getProxyUrl, getProxyKey } from '../../settings-service'
import { getTrainingModel } from '../../training/training-model'
import { getDb, trainingPairQueries } from '../../db'
import { addArchivalMemory } from '../../memory/archival-memory'
import { getCrystalsByProject } from '../../knowledge/crystal-store'

function vnt(): string {
 return new Date().toLocaleString('vi-VN', {
 timeZone: 'Asia/Ho_Chi_Minh',
 hour12: false,
 year: 'numeric', month: '2-digit', day: '2-digit',
 hour: '2-digit', minute: '2-digit', second: '2-digit'
 })
}

function truncate(s: string, max = 120): string {
 return s.length <= max ? s : s.slice(0, max) + '...'
}

function logScan(msg: string): void {
 console.log(`[AutoScan][${vnt()}] ${msg}`)
}

function logTrain(msg: string): void {
 console.log(`[AutoTraining][${vnt()}] ${msg}`)
}

function logLearn(msg: string): void {
 console.log(`[Learning][${vnt()}] ${msg}`)
}

export interface AutoScanConfig {
 batchSize: number
 judgeThreshold: number
 maxQuestionsPerChunk: number
 enableEvolInstruct: boolean
 pauseDuringChat: boolean
 enabled: boolean
 requestDelayMs: number
 maxRetries: number
}

export interface AutoScanActivity {
 filePath: string
 question: string
 answer: string
 score: number
 status: 'generating' | 'answering' | 'judging' | 'accepted' | 'rejected'
 timestamp: number
}

export interface AutoScanProgress {
 phase: 'chunks' | 'crystals' | 'idle'
 currentBatch: number
 totalBatches: number
 chunksScanned: number
 pairsGenerated: number
 pairsAccepted: number
 pairsRejected: number
 lastRunAt: number | null
 isRunning: boolean
 currentProjectId: string | null
 currentActivity: AutoScanActivity | null
 recentActivities: AutoScanActivity[]
 circuitStatus?: {
  state: 'closed' | 'open' | 'half-open'
  dailyCostUsd: number
  dailyBudgetUsd: number
 }
}

export interface AutoScanBatchResult {
 chunksScanned: number
 pairsGenerated: number
 pairsAccepted: number
 pairsRejected: number
 durationMs: number
}

interface ChunkRow {
 id: string
 content: string
 file_path: string
 language: string
}


const DEFAULT_CONFIG: AutoScanConfig = {
 batchSize: 20,
 judgeThreshold: 4.0,
 maxQuestionsPerChunk: 3,
 enableEvolInstruct: true,
 pauseDuringChat: true,
 enabled: false,
 requestDelayMs: 500,
 maxRetries: 3
}

let config: AutoScanConfig = { ...DEFAULT_CONFIG }

let progress: AutoScanProgress = {
 phase: 'idle',
 currentBatch: 0,
 totalBatches: 0,
 chunksScanned: 0,
 pairsGenerated: 0,
 pairsAccepted: 0,
 pairsRejected: 0,
 lastRunAt: null,
 isRunning: false,
 currentProjectId: null,
 currentActivity: null,
 recentActivities: []
}

export function getAutoScanConfig(): AutoScanConfig {
 return { ...config }
}

export function setAutoScanConfig(partial: Partial<AutoScanConfig>): void {
 config = { ...config, ...partial }
 console.log('[AutoScan] Config updated:', config)
}

export function getAutoScanProgress(): AutoScanProgress {
 const cs = getCircuitStatus()
 return {
  ...progress,
  circuitStatus: {
   state: cs.state,
   dailyCostUsd: cs.dailyCostUsd,
   dailyBudgetUsd: cs.dailyBudgetUsd,
  }
 }
}

export function setAutoScanProgress(partial: Partial<AutoScanProgress>): void {
 progress = { ...progress, ...partial }
}

const MAX_RECENT_ACTIVITIES = 20

type ActivityListener = (activity: AutoScanActivity | null) => void
let activityListener: ActivityListener | null = null

export function onActivityUpdate(listener: ActivityListener): void {
 activityListener = listener
}

function setActivity(activity: AutoScanActivity): void {
 const updated = [activity, ...progress.recentActivities].slice(0, MAX_RECENT_ACTIVITIES)
 progress = { ...progress, currentActivity: activity, recentActivities: updated }
 activityListener?.(activity)
}

export function clearActivity(): void {
 progress = { ...progress, currentActivity: null }
 activityListener?.(null)
}

// =====================
// Circuit Breaker — timed open state + daily budget guard
// =====================

interface CircuitBreakerState {
 failures: number           // consecutive failures
 state: 'closed' | 'open' | 'half-open'
 openedAt: number           // timestamp when circuit opened
 dailyCostUsd: number       // accumulated cost today
 dailyResetAt: number       // next midnight reset timestamp
}

const CIRCUIT_CONFIG = {
 maxFailures: 3,
 openDurationMs: 30 * 60 * 1000,   // stay open 30 min then half-open
 defaultDailyBudgetUsd: 0.50,       // $0.50/day default
 costPerPair: 0.002,                // ~$0.002 per accepted pair estimate
}

function getMidnight(): number {
 const d = new Date()
 d.setHours(24, 0, 0, 0)
 return d.getTime()
}

const circuitBreaker: CircuitBreakerState = {
 failures: 0,
 state: 'closed',
 openedAt: 0,
 dailyCostUsd: 0,
 dailyResetAt: getMidnight(),
}

function checkDailyReset(): void {
 if (Date.now() >= circuitBreaker.dailyResetAt) {
  circuitBreaker.dailyCostUsd = 0
  circuitBreaker.dailyResetAt = getMidnight()
  logScan(`[Budget] Daily reset — new budget: $${CIRCUIT_CONFIG.defaultDailyBudgetUsd.toFixed(2)}`)
 }
}

function isCircuitOpen(): boolean {
 checkDailyReset()

 // Budget exceeded → open circuit until midnight
 if (circuitBreaker.dailyCostUsd >= CIRCUIT_CONFIG.defaultDailyBudgetUsd) {
  if (circuitBreaker.state !== 'open') {
   circuitBreaker.state = 'open'
   circuitBreaker.openedAt = Date.now()
   logScan(`[Circuit] OPEN — daily budget $${circuitBreaker.dailyCostUsd.toFixed(3)} exceeded $${CIRCUIT_CONFIG.defaultDailyBudgetUsd}`)
  }
  return true
 }

 if (circuitBreaker.state === 'closed') return false

 if (circuitBreaker.state === 'open') {
  const elapsed = Date.now() - circuitBreaker.openedAt
  if (elapsed >= CIRCUIT_CONFIG.openDurationMs) {
   circuitBreaker.state = 'half-open'
   logScan(`[Circuit] HALF-OPEN — sending probe request`)
   return false  // allow one probe
  }
  return true
 }

 // half-open: allow through
 return false
}

function recordCircuitSuccess(): void {
 if (circuitBreaker.state === 'half-open') {
  logScan(`[Circuit] CLOSED — probe succeeded`)
 }
 circuitBreaker.failures = 0
 circuitBreaker.state = 'closed'
}

function recordCircuitFailure(): void {
 circuitBreaker.failures++
 if (circuitBreaker.state === 'half-open') {
  // Probe failed → re-open
  circuitBreaker.state = 'open'
  circuitBreaker.openedAt = Date.now()
  logScan(`[Circuit] OPEN again — probe failed (failures=${circuitBreaker.failures})`)
 } else if (circuitBreaker.failures >= CIRCUIT_CONFIG.maxFailures && circuitBreaker.state === 'closed') {
  circuitBreaker.state = 'open'
  circuitBreaker.openedAt = Date.now()
  logScan(`[Circuit] OPEN — ${circuitBreaker.failures} consecutive failures`)
 }
}

export function recordCircuitCost(usd: number): void {
 checkDailyReset()
 circuitBreaker.dailyCostUsd += usd
}

export function getCircuitStatus(): {
 state: CircuitBreakerState['state']
 failures: number
 dailyCostUsd: number
 dailyBudgetUsd: number
 dailyResetAt: number
} {
 return {
  state: circuitBreaker.state,
  failures: circuitBreaker.failures,
  dailyCostUsd: circuitBreaker.dailyCostUsd,
  dailyBudgetUsd: CIRCUIT_CONFIG.defaultDailyBudgetUsd,
  dailyResetAt: circuitBreaker.dailyResetAt,
 }
}

// Keep backward compat
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 3

function sleep(ms: number): Promise<void> {
 return new Promise(resolve => setTimeout(resolve, ms))
}

async function callLLM(
 systemPrompt: string,
 userContent: string,
 temperature: number = 0.3,
 maxTokens: number = 2048,
 label?: string
): Promise<string> {
 if (isCircuitOpen()) {
  logTrain(`[Circuit OPEN] Skipping LLM call | ${label ?? '?'} | cost=$${circuitBreaker.dailyCostUsd.toFixed(3)}`)
  consecutiveErrors = MAX_CONSECUTIVE_ERRORS
  return ''
 }

 // Legacy guard (backward compat, kept for in-loop checks)
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  logTrain(`[Circuit breaker OPEN] Skipping LLM call | ${label ?? '?'}`)
  return ''
 }

 const maxRetries = config.maxRetries ?? 3
 let attempt = 0

 while (attempt <= maxRetries) {
  const t0 = Date.now()
  try {
   const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
     Authorization: `Bearer ${getProxyKey()}`
    },
    body: JSON.stringify({
     model: getTrainingModel(),
     messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
     ],
     stream: false,
     temperature,
     max_tokens: maxTokens
    })
   })

   const elapsed = Date.now() - t0

    if (response.status === 429 || response.status === 503) {
     consecutiveErrors++
     recordCircuitFailure()
     const retryAfterHeader = response.headers.get('retry-after')
    const backoffMs = retryAfterHeader
     ? parseInt(retryAfterHeader, 10) * 1000
     : Math.min(1000 * Math.pow(2, attempt), 30_000)
    logTrain(`LLM ${response.status} (attempt ${attempt + 1}/${maxRetries + 1}) | backoff ${backoffMs}ms | ${label ?? '?'}`)
    if (attempt >= maxRetries) return ''
    await sleep(backoffMs)
    attempt++
    continue
   }

   if (!response.ok) {
     consecutiveErrors++
     recordCircuitFailure()
     logTrain(`LLM ${response.status} (${elapsed}ms) | ${label ?? '?'} | prompt="${truncate(userContent, 80)}"`)
     return ''
    }

    consecutiveErrors = 0
    recordCircuitSuccess()
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    logTrain(`LLM ok ${elapsed}ms | ${label ?? '?'} | prompt="${truncate(userContent, 80)}"`)
    return data.choices?.[0]?.message?.content || ''
   } catch (err) {
    consecutiveErrors++
    recordCircuitFailure()
    const elapsed = Date.now() - t0
    logTrain(`LLM failed (${elapsed}ms) | ${label ?? '?'} | ${(err as Error).message}`)
    if (attempt >= maxRetries) return ''
    await sleep(1000 * Math.pow(2, attempt))
    attempt++
   }
 }

 return ''
}

export function resetCircuitBreaker(): void {
 consecutiveErrors = 0
}

const QUESTION_GEN_SYSTEM = `You are a code knowledge extractor. Given code chunks from a software project, generate diverse questions that developers would realistically ask.

For each chunk, generate exactly 3 questions:
1. FACTUAL: "What does X do?" / "What is the purpose of Y?" 
2. CONCEPTUAL: "Why is Z implemented this way?" / "What pattern does this follow?"
3. RELATIONAL: "How does this relate to other parts?" / "When would you use this?"

Return a JSON array:
[
 {"chunkId": "...", "questions": [
 {"type": "factual", "question": "..."},
 {"type": "conceptual", "question": "..."},
 {"type": "relational", "question": "..."}
 ]}
]

Rules:
- Questions must be specific to the actual code content
- Never generic ("What is this file?")
- Reference actual function names, variables, patterns`

const QUESTION_SUB_BATCH = 10

async function generateQuestionsForSubBatch(
 subChunks: ChunkRow[]
): Promise<Map<string, Array<{ type: string; question: string }>>> {
 const result = new Map<string, Array<{ type: string; question: string }>>()
 const chunksContext = subChunks.map(c =>
 `[ChunkID: ${c.id}]\nFile: ${c.file_path} (${c.language})\n${c.content.slice(0, 600)}`
 ).join('\n\n---\n\n')

 try {
 const raw = await callLLM(
 QUESTION_GEN_SYSTEM,
 `Generate questions for these ${subChunks.length} chunks:\n\n${chunksContext}`,
 0.8,
 8192,
 `q-gen ${subChunks.length}chunks`
 )

 const jsonMatch = raw.match(/\[[\s\S]*?\](?=\s*$|\s*\n\s*\[|\s*```)/s) || raw.match(/\[[\s\S]*\]/)
 if (!jsonMatch) return result

 const parsed = JSON.parse(jsonMatch[0]) as Array<{
 chunkId: string
 questions: Array<{ type: string; question: string }>
 }>

 for (const item of parsed) {
 if (item.chunkId && Array.isArray(item.questions)) {
 result.set(item.chunkId, item.questions)
 }
 }
 } catch (err) {
 logTrain(`Sinh câu hỏi thất bại (sub-batch ${subChunks.length} chunks): ${(err as Error).message}`)
 }

 return result
}

export async function generateQuestionsForChunks(
 chunks: ChunkRow[]
): Promise<Map<string, Array<{ type: string; question: string }>>> {
 const result = new Map<string, Array<{ type: string; question: string }>>()
 if (chunks.length === 0) return result

 for (let i = 0; i < chunks.length; i += QUESTION_SUB_BATCH) {
 const sub = chunks.slice(i, i + QUESTION_SUB_BATCH)
 const subResult = await generateQuestionsForSubBatch(sub)
 for (const [k, v] of subResult) result.set(k, v)
 if (i + QUESTION_SUB_BATCH < chunks.length) {
  await sleep(config.requestDelayMs)
 }
 }

 return result
}

const ANSWER_SYSTEM = `You are an expert software engineer with deep knowledge of the codebase. Answer questions about code accurately and specifically.

Rules:
- Cite specific file paths, function names, line patterns from the provided code
- Be concise but complete (2-4 sentences ideal)
- If unsure, say so rather than guess
- Match the technical level of the question`

export async function answerQuestion(
 question: string,
 codeContext: string,
 filePath: string
): Promise<string> {
 const userContent = `Context (${filePath}):\n${codeContext.slice(0, 1200)}\n\nQuestion: ${question}`
 return callLLM(ANSWER_SYSTEM, userContent, 0.2, 1024, `answer | ${truncate(question, 60)}`)
}

const JUDGE_SYSTEM = `You are a quality judge for code Q&A training data. Score strictly.

Evaluate on 4 criteria (1-5 each):
1. RELEVANCE: Does the question actually relate to the provided code?
2. SPECIFICITY: Does the answer cite specific code elements (functions, files, patterns)?
3. CORRECTNESS: Is the answer factually accurate based on the code?
4. USEFULNESS: Would this help a developer understand the codebase?

Return JSON only:
{"relevance": N, "specificity": N, "correctness": N, "usefulness": N, "average": N, "reasoning": "..."}`

export async function judgeQAPair(
 question: string,
 answer: string,
 codeContext: string
): Promise<{ score: number; accepted: boolean; reasoning: string }> {
 const userContent = `Code:\n${codeContext.slice(0, 600)}\n\nQ: ${question}\nA: ${answer}`

 try {
 const raw = await callLLM(JUDGE_SYSTEM, userContent, 0.1, 512, `judge | ${truncate(question, 50)}`)
 const jsonMatch = raw.match(/\{[\s\S]*\}/)
 if (!jsonMatch) return { score: 0, accepted: false, reasoning: 'parse_failed' }

 const parsed = JSON.parse(jsonMatch[0]) as {
 relevance: number
 specificity: number
 correctness: number
 usefulness: number
 average: number
 reasoning: string
 }

 const avg = parsed.average ||
 (parsed.relevance + parsed.specificity + parsed.correctness + parsed.usefulness) / 4

 return {
 score: avg,
 accepted: avg >= config.judgeThreshold,
 reasoning: parsed.reasoning || ''
 }
 } catch (err) {
 logTrain(`Judge thất bại: ${(err as Error).message}`)
 return { score: 0, accepted: false, reasoning: 'error' }
 }
}

const EVOL_SYSTEM = `You are an instruction evolution expert. Take a simple code question and make it significantly more complex and insightful.

Evolution strategies:
- Add constraints ("...without using X")
- Request comparison ("...vs Y approach") 
- Add edge case ("...and what happens when Z fails?")
- Require reasoning ("...and explain the tradeoffs")

Return ONLY the evolved question, nothing else.`

export async function evolveQuestion(question: string): Promise<string> {
 try {
 const result = await callLLM(EVOL_SYSTEM, question, 0.9, 256, `evol | ${truncate(question, 50)}`)
 return result.trim() || question
 } catch {
 return question
 }
}

export async function saveAcceptedPair(
 projectId: string,
 question: string,
 answer: string,
 sourceType: 'chunk' | 'crystal',
 sourceId: string,
 judgeScore: number
): Promise<void> {
 try {
  recordCircuitCost(CIRCUIT_CONFIG.costPerPair)
  const db = getDb()
 const pairId = randomUUID()

 // Save to training_pairs (for reranker + DSPy optimization)
 trainingPairQueries.insert(db).run(
 pairId,
 projectId,
 question,
 sourceId,
 judgeScore / 5.0,
 'autoscan',
 1.0
 )

 await addArchivalMemory(
 projectId,
 `Q: ${question}\nA: ${answer}`,
 {
 source: 'autoscan',
 type: 'general',
 tags: [sourceType, 'qa_pair'],
 conversation_id: undefined
 }
 )
 } catch (err) {
 logLearn(`Lưu pair thất bại: ${(err as Error).message}`)
 }
}

export async function runBatch(
 projectId: string,
 offset: number,
 batchSize: number
): Promise<AutoScanBatchResult> {
 const start = Date.now()
 let chunksScanned = 0
 let pairsGenerated = 0
 let pairsAccepted = 0
 let pairsRejected = 0

 try {
 const db = getDb()
 const chunks = db.prepare(
 'SELECT id, content, file_path, language FROM chunks WHERE project_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
 ).all(projectId, batchSize, offset) as ChunkRow[]

 if (chunks.length === 0) {
 return { chunksScanned: 0, pairsGenerated: 0, pairsAccepted: 0, pairsRejected: 0, durationMs: Date.now() - start }
 }

 if (isCircuitOpen()) {
  logScan(`[Code] Circuit breaker OPEN — bỏ qua batch offset=${offset}`)
  return { chunksScanned: 0, pairsGenerated: 0, pairsAccepted: 0, pairsRejected: 0, durationMs: Date.now() - start }
 }

 logScan(`[Code] Batch offset=${offset} | ${chunks.length} chunks | bắt đầu sinh câu hỏi...`)

 const t1 = Date.now()
 const questionMap = await generateQuestionsForChunks(chunks)
 logScan(`[Code] Batch offset=${offset} | sinh xong câu hỏi | ${Date.now() - t1}ms`)
 chunksScanned = chunks.length

 for (const chunk of chunks) {
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  logScan(`[Code] Circuit breaker OPEN — dừng batch sớm`)
  break
 }

 const questions = questionMap.get(chunk.id) || []
 const topic = chunk.file_path.split('/').slice(-2).join('/')

 for (const qItem of questions) {
  let question = qItem.question
  pairsGenerated++

  if (config.enableEvolInstruct && Math.random() < 0.3) {
  logTrain(`[Evol-Instruct] Chủ đề: ${topic} | Câu gốc: "${truncate(question, 60)}"`)
  setActivity({ filePath: chunk.file_path, question, answer: '', score: 0, status: 'generating', timestamp: Date.now() })
  question = await evolveQuestion(question)
  await sleep(config.requestDelayMs)
  }

  logTrain(`[Code/${qItem.type}] ${topic} | Q: "${truncate(question, 80)}"`)
  setActivity({ filePath: chunk.file_path, question, answer: '', score: 0, status: 'answering', timestamp: Date.now() })
  const answer = await answerQuestion(question, chunk.content, chunk.file_path)
  await sleep(config.requestDelayMs)
  if (!answer) { pairsRejected++; continue }

  setActivity({ filePath: chunk.file_path, question, answer, score: 0, status: 'judging', timestamp: Date.now() })
  const judgment = await judgeQAPair(question, answer, chunk.content)
  await sleep(config.requestDelayMs)

  if (judgment.accepted) {
  setActivity({ filePath: chunk.file_path, question, answer, score: judgment.score, status: 'accepted', timestamp: Date.now() })
  await saveAcceptedPair(projectId, question, answer, 'chunk', chunk.id, judgment.score)
  pairsAccepted++
  logLearn(`[Code] Lưu pair | score=${judgment.score.toFixed(1)} | ${topic} | "${truncate(question, 60)}"`)
  } else {
  setActivity({ filePath: chunk.file_path, question, answer, score: judgment.score, status: 'rejected', timestamp: Date.now() })
  logLearn(`[Code] Bỏ pair | score=${judgment.score.toFixed(1)} | "${truncate(question, 60)}"`)
  pairsRejected++
  }
 }
 }

 const elapsed = Date.now() - start
 const rate = elapsed > 0 ? Math.round(chunksScanned / (elapsed / 1000)) : 0
 logScan(`[Code] Batch offset=${offset} xong | ${elapsed}ms | chunks=${chunksScanned} gen=${pairsGenerated} acc=${pairsAccepted} rej=${pairsRejected} | ${rate}chunks/s`)
 } catch (err) {
 logScan(`[Code] Batch offset=${offset} thất bại (${Date.now() - start}ms): ${(err as Error).message}`)
 }

 return {
 chunksScanned,
 pairsGenerated,
 pairsAccepted,
 pairsRejected,
 durationMs: Date.now() - start
 }
}

export async function runCrystalBatch(projectId: string): Promise<AutoScanBatchResult> {
 const start = Date.now()
 let pairsGenerated = 0
 let pairsAccepted = 0
 let pairsRejected = 0

 try {
 const crystals = getCrystalsByProject(projectId, 50)
 if (crystals.length === 0) {
 return { chunksScanned: 0, pairsGenerated: 0, pairsAccepted: 0, pairsRejected: 0, durationMs: 0 }
 }

 logScan(`[Crystal] ${crystals.length} crystals | bắt đầu...`)

 for (const crystal of crystals) {
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  logScan(`[Crystal] Circuit breaker OPEN — dừng crystal batch sớm`)
  break
 }

 if (!crystal.content || crystal.content.length < 50) continue

 const topic = `${crystal.crystalType}/${crystal.domain || 'general'}`
 const questionPrompt = `Given this knowledge crystal (type: ${crystal.crystalType}, domain: ${crystal.domain || 'general'}):\n${crystal.content.slice(0, 600)}\n\nGenerate one insightful question a developer would ask about this. Return only the question.`

 logTrain(`[Crystal] Chủ đề: ${topic} | prompt="${truncate(questionPrompt, 80)}"`)
 setActivity({ filePath: `crystal:${topic}`, question: questionPrompt, answer: '', score: 0, status: 'generating', timestamp: Date.now() })
 const question = await callLLM(
 'You generate precise developer questions from knowledge insights.',
 questionPrompt,
 0.7, 256, `crystal-q | ${topic}`
 )
 await sleep(config.requestDelayMs)

 if (!question.trim()) continue
 pairsGenerated++

 setActivity({ filePath: `crystal:${topic}`, question, answer: '', score: 0, status: 'answering', timestamp: Date.now() })
 const answer = await answerQuestion(question, crystal.content, crystal.domain || 'general')
 await sleep(config.requestDelayMs)
 if (!answer) { pairsRejected++; continue }

 setActivity({ filePath: `crystal:${topic}`, question, answer, score: 0, status: 'judging', timestamp: Date.now() })
 const judgment = await judgeQAPair(question, answer, crystal.content)
 await sleep(config.requestDelayMs)

 if (judgment.accepted) {
 setActivity({ filePath: `crystal:${topic}`, question, answer, score: judgment.score, status: 'accepted', timestamp: Date.now() })
 await saveAcceptedPair(projectId, question, answer, 'crystal', crystal.id, judgment.score)
 pairsAccepted++
 logLearn(`[Crystal] Lưu pair | score=${judgment.score.toFixed(1)} | ${topic} | "${truncate(question, 60)}"`)
 } else {
 setActivity({ filePath: `crystal:${topic}`, question, answer, score: judgment.score, status: 'rejected', timestamp: Date.now() })
 logLearn(`[Crystal] Bỏ pair | score=${judgment.score.toFixed(1)} | "${truncate(question, 60)}"`)
 pairsRejected++
 }
 }
 } catch (err) {
 logScan(`[Crystal] Batch thất bại: ${(err as Error).message}`)
 }

 return {
 chunksScanned: 0,
 pairsGenerated,
 pairsAccepted,
 pairsRejected,
 durationMs: Date.now() - start
 }
}

export function getTotalChunkCount(projectId: string): number {
 try {
 const db = getDb()
 const row = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE project_id = ?').get(projectId) as { count: number }
 return row?.count || 0
 } catch {
 return 0
 }
}

export function getAllProjectIds(): string[] {
 try {
 const db = getDb()
 return (db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>).map(r => r.id)
 } catch {
 return []
 }
}

const JIRA_QUESTION_SYSTEM = `You are a project analyst. Given Jira issue data, generate insightful questions that a project manager or developer would ask to understand the project deeply.

Focus on:
- Sprint progress and velocity
- Bug patterns and recurring issues
- Team member workload and assignments
- Unresolved blockers and long-standing issues
- Issue relationships and dependencies

Return a JSON array (max 3 questions per issue):
[{"chunkId":"...","questions":[{"type":"bug_analysis","question":"..."},{"type":"sprint_insight","question":"..."},{"type":"team_insight","question":"..."}]}]

Rules: Questions must be specific to actual data. Reference real issue keys, assignees, sprints.`

const JIRA_ANSWER_SYSTEM = `You are an expert project analyst with deep knowledge of this Jira project. Answer questions about issues, sprints, team members, and project health based on the provided data.
- Reference specific issue keys (e.g., PS-123), sprint names, team member names
- Be concise and actionable (3-5 sentences)
- If data is insufficient, state what's missing`

export async function runJiraBatch(projectId: string): Promise<AutoScanBatchResult> {
 const start = Date.now()
 let chunksScanned = 0
 let pairsGenerated = 0
 let pairsAccepted = 0
 let pairsRejected = 0

 try {
 const db = getDb()
 const jiraChunks = db.prepare(
 `SELECT id, content, file_path, name FROM chunks WHERE project_id = ? AND language = 'jira' ORDER BY created_at DESC LIMIT 200`
 ).all(projectId) as Array<{ id: string; content: string; file_path: string; name: string }>

 if (jiraChunks.length === 0) {
 return { chunksScanned: 0, pairsGenerated: 0, pairsAccepted: 0, pairsRejected: 0, durationMs: 0 }
 }

 logScan(`[Jira] ${jiraChunks.length} issues | bắt đầu phân tích sprint/bug/team...`)
 chunksScanned = jiraChunks.length

 for (let i = 0; i < jiraChunks.length; i += QUESTION_SUB_BATCH) {
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  logScan(`[Jira] Circuit breaker OPEN — dừng Jira batch sớm`)
  break
 }

 const sub = jiraChunks.slice(i, i + QUESTION_SUB_BATCH)
 const issueKeys = sub.map(c => c.name).join(', ')
 const subContext = sub.map(c => `[ChunkID: ${c.id}]\n${c.content.slice(0, 600)}`).join('\n\n---\n\n')

 logScan(`[Jira] Batch ${i}–${i + sub.length} | Issues: ${truncate(issueKeys, 60)}`)
 try {
 const raw = await callLLM(
  JIRA_QUESTION_SYSTEM,
  `Generate questions for these ${sub.length} Jira issues:\n\n${subContext}`,
  0.8, 8192,
  `jira-q batch=${i} issues=${issueKeys.slice(0, 40)}`
 )
 await sleep(config.requestDelayMs)
 const jsonMatch = raw.match(/\[[\s\S]*?\](?=\s*$|\s*\n\s*\[)/s) || raw.match(/\[[\s\S]*\]/)
 if (!jsonMatch) { logScan(`[Jira] Batch ${i}: không parse được JSON`); continue }

 const parsed = JSON.parse(jsonMatch[0]) as Array<{
  chunkId: string
  questions: Array<{ type: string; question: string }>
 }>

 for (const item of parsed) {
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break

  const chunk = sub.find(c => c.id === item.chunkId)
  if (!chunk || !Array.isArray(item.questions)) continue

  for (const qItem of item.questions) {
  pairsGenerated++
  logTrain(`[Jira/${qItem.type}] ${chunk.name} | Q: "${truncate(qItem.question, 80)}"`)
  const answer = await callLLM(
   JIRA_ANSWER_SYSTEM,
   `Jira data:\n${chunk.content.slice(0, 1200)}\n\nQuestion: ${qItem.question}`,
   0.2, 1024,
   `jira-ans | ${chunk.name} | ${truncate(qItem.question, 40)}`
  )
  await sleep(config.requestDelayMs)
  if (!answer) { pairsRejected++; continue }

  const judgment = await judgeQAPair(qItem.question, answer, chunk.content)
  await sleep(config.requestDelayMs)
  if (judgment.accepted) {
   await saveAcceptedPair(projectId, qItem.question, answer, 'chunk', chunk.id, judgment.score)
   pairsAccepted++
   logLearn(`[Jira] Lưu pair | score=${judgment.score.toFixed(1)} | ${chunk.name} | "${truncate(qItem.question, 60)}"`)
  } else {
   logLearn(`[Jira] Bỏ pair | score=${judgment.score.toFixed(1)} | "${truncate(qItem.question, 60)}"`)
   pairsRejected++
  }
  }
 }
 } catch (err) {
 logScan(`[Jira] Sub-batch ${i} thất bại: ${(err as Error).message}`)
 }
 }
 } catch (err) {
 logScan(`[Jira] Batch thất bại: ${(err as Error).message}`)
 }

 return { chunksScanned, pairsGenerated, pairsAccepted, pairsRejected, durationMs: Date.now() - start }
}

const CONFLUENCE_QUESTION_SYSTEM = `You are a technical documentation analyst. Given Confluence page content, generate insightful questions about the technical information, architecture decisions, and potential conflicts or gaps.

Focus on:
- Technical architecture and design decisions
- Potential conflicts or contradictions with other docs
- Incomplete or ambiguous specifications
- Dependencies and integration points
- Historical context and rationale

Return a JSON array (max 3 questions per page):
[{"chunkId":"...","questions":[{"type":"technical","question":"..."},{"type":"conflict_check","question":"..."},{"type":"architecture","question":"..."}]}]

Rules: Questions must be specific to actual page content. Reference real section names, technologies, components.`

const CONFLUENCE_ANSWER_SYSTEM = `You are a technical documentation expert with deep knowledge of this project's Confluence documentation. Answer questions about architecture, technical decisions, and documentation gaps.
- Reference specific page titles, section names, and documented decisions
- Flag potential conflicts or gaps if identified
- Be precise and actionable (3-5 sentences)`

export async function runConfluenceBatch(projectId: string): Promise<AutoScanBatchResult> {
 const start = Date.now()
 let chunksScanned = 0
 let pairsGenerated = 0
 let pairsAccepted = 0
 let pairsRejected = 0

 try {
 const db = getDb()
 const confChunks = db.prepare(
 `SELECT id, content, file_path, name FROM chunks WHERE project_id = ? AND language = 'confluence' ORDER BY created_at DESC LIMIT 100`
 ).all(projectId) as Array<{ id: string; content: string; file_path: string; name: string }>

 if (confChunks.length === 0) {
 return { chunksScanned: 0, pairsGenerated: 0, pairsAccepted: 0, pairsRejected: 0, durationMs: 0 }
 }

 logScan(`[Confluence] ${confChunks.length} pages | bắt đầu phân tích tài liệu kỹ thuật...`)
 chunksScanned = confChunks.length

 for (let i = 0; i < confChunks.length; i += QUESTION_SUB_BATCH) {
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  logScan(`[Confluence] Circuit breaker OPEN — dừng Confluence batch sớm`)
  break
 }

 const sub = confChunks.slice(i, i + QUESTION_SUB_BATCH)
 const pageNames = sub.map(c => c.name).join(', ')
 const subContext = sub.map(c => `[ChunkID: ${c.id}]\n${c.content.slice(0, 800)}`).join('\n\n---\n\n')

 logScan(`[Confluence] Batch ${i}–${i + sub.length} | Pages: ${truncate(pageNames, 60)}`)
 try {
 const raw = await callLLM(
  CONFLUENCE_QUESTION_SYSTEM,
  `Generate questions for these ${sub.length} Confluence pages:\n\n${subContext}`,
  0.8, 8192,
  `conf-q batch=${i} pages=${pageNames.slice(0, 40)}`
 )
 await sleep(config.requestDelayMs)
 const jsonMatch = raw.match(/\[[\s\S]*?\](?=\s*$|\s*\n\s*\[)/s) || raw.match(/\[[\s\S]*\]/)
 if (!jsonMatch) { logScan(`[Confluence] Batch ${i}: không parse được JSON`); continue }

 const parsed = JSON.parse(jsonMatch[0]) as Array<{
  chunkId: string
  questions: Array<{ type: string; question: string }>
 }>

 for (const item of parsed) {
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break

  const chunk = sub.find(c => c.id === item.chunkId)
  if (!chunk || !Array.isArray(item.questions)) continue

  for (const qItem of item.questions) {
  pairsGenerated++
  logTrain(`[Confluence/${qItem.type}] "${truncate(chunk.name, 30)}" | Q: "${truncate(qItem.question, 80)}"`)
  const answer = await callLLM(
   CONFLUENCE_ANSWER_SYSTEM,
   `Confluence page:\n${chunk.content.slice(0, 1500)}\n\nQuestion: ${qItem.question}`,
   0.2, 1024,
   `conf-ans | ${truncate(chunk.name, 30)} | ${truncate(qItem.question, 40)}`
  )
  await sleep(config.requestDelayMs)
  if (!answer) { pairsRejected++; continue }

  const judgment = await judgeQAPair(qItem.question, answer, chunk.content)
  await sleep(config.requestDelayMs)
  if (judgment.accepted) {
   await saveAcceptedPair(projectId, qItem.question, answer, 'chunk', chunk.id, judgment.score)
   pairsAccepted++
   logLearn(`[Confluence] Lưu pair | score=${judgment.score.toFixed(1)} | "${truncate(chunk.name, 30)}" | "${truncate(qItem.question, 60)}"`)
  } else {
   logLearn(`[Confluence] Bỏ pair | score=${judgment.score.toFixed(1)} | "${truncate(qItem.question, 60)}"`)
   pairsRejected++
  }
  }
 }
 } catch (err) {
 logScan(`[Confluence] Sub-batch ${i} thất bại: ${(err as Error).message}`)
 }
 }
 } catch (err) {
 logScan(`[Confluence] Batch thất bại: ${(err as Error).message}`)
 }

 return { chunksScanned, pairsGenerated, pairsAccepted, pairsRejected, durationMs: Date.now() - start }
}
