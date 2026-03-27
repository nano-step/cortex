const locks = new Map<string, string>()

export function acquireLock(resourceId: string, agentId: string): boolean {
  if (locks.has(resourceId)) return false
  locks.set(resourceId, agentId)
  return true
}

export function releaseLock(resourceId: string, agentId: string): void {
  if (locks.get(resourceId) === agentId) locks.delete(resourceId)
}

export function isLocked(resourceId: string): boolean {
  return locks.has(resourceId)
}

export function releaseAllLocksForAgent(agentId: string): void {
  for (const [resourceId, owner] of locks) {
    if (owner === agentId) locks.delete(resourceId)
  }
}

export function getLockStatus(): Record<string, string> {
  return Object.fromEntries(locks)
}

export interface OrchestrationBudget {
  maxAgents: number
  maxTokensTotal: number
  maxLLMCallsPerAgent: number
  timeoutMs: number
}

export const DEFAULT_ORCHESTRATION_BUDGET: OrchestrationBudget = {
  maxAgents: 5,
  maxTokensTotal: 50_000,
  maxLLMCallsPerAgent: 10,
  timeoutMs: 60_000,
}

export class BudgetExceededError extends Error {
  constructor(reason: string) {
    super(`Orchestration budget exceeded: ${reason}`)
    this.name = 'BudgetExceededError'
  }
}

export function createBudgetTracker(budget: OrchestrationBudget = DEFAULT_ORCHESTRATION_BUDGET) {
  let agentCount = 0
  let totalTokens = 0
  const agentCallCounts = new Map<string, number>()
  const startTime = Date.now()

  return {
    registerAgent(agentId: string): void {
      agentCount++
      if (agentCount > budget.maxAgents) {
        throw new BudgetExceededError(`maxAgents (${budget.maxAgents}) reached`)
      }
      agentCallCounts.set(agentId, 0)
    },

    recordTokens(count: number): void {
      totalTokens += count
      if (totalTokens > budget.maxTokensTotal) {
        throw new BudgetExceededError(`maxTokensTotal (${budget.maxTokensTotal}) exceeded`)
      }
    },

    recordLLMCall(agentId: string): void {
      const calls = (agentCallCounts.get(agentId) || 0) + 1
      agentCallCounts.set(agentId, calls)
      if (calls > budget.maxLLMCallsPerAgent) {
        throw new BudgetExceededError(`agent ${agentId} exceeded maxLLMCallsPerAgent (${budget.maxLLMCallsPerAgent})`)
      }
      if (Date.now() - startTime > budget.timeoutMs) {
        throw new BudgetExceededError(`orchestration timeout (${budget.timeoutMs}ms)`)
      }
    },

    getStats() {
      return {
        agentCount,
        totalTokens,
        elapsedMs: Date.now() - startTime,
        agentCalls: Object.fromEntries(agentCallCounts)
      }
    }
  }
}
