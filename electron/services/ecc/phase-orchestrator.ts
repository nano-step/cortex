export type PhaseName = 'research' | 'plan' | 'implement' | 'verify'
export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface Phase {
  name: PhaseName
  status: PhaseStatus
  input: string
  output: string
  durationMs: number
  startedAt: number | null
  completedAt: number | null
}

export interface PhaseOrchestratorConfig {
  enableResearch: boolean
  enablePlan: boolean
  enableVerify: boolean
  maxPhaseTimeMs: number
}

export interface PhasePipeline {
  id: string
  projectId: string
  query: string
  phases: Phase[]
  currentPhase: PhaseName | null
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
}

const DEFAULT_CONFIG: PhaseOrchestratorConfig = {
  enableResearch: true,
  enablePlan: true,
  enableVerify: true,
  maxPhaseTimeMs: 60000
}

const activePipelines: Map<string, PhasePipeline> = new Map()

export function createPipeline(
  projectId: string,
  query: string,
  config: Partial<PhaseOrchestratorConfig> = {}
): PhasePipeline {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const id = `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  const phases: Phase[] = []
  const phaseTemplate = (name: PhaseName): Phase => ({
    name, status: 'pending', input: '', output: '', durationMs: 0, startedAt: null, completedAt: null
  })

  if (cfg.enableResearch) phases.push(phaseTemplate('research'))
  if (cfg.enablePlan) phases.push(phaseTemplate('plan'))
  phases.push(phaseTemplate('implement'))
  if (cfg.enableVerify) phases.push(phaseTemplate('verify'))

  const pipeline: PhasePipeline = {
    id, projectId, query, phases, currentPhase: null, status: 'running', startedAt: Date.now(), completedAt: null
  }

  activePipelines.set(id, pipeline)
  return pipeline
}

export function advancePhase(
  pipelineId: string,
  phaseOutput: string
): { nextPhase: PhaseName | null; pipeline: PhasePipeline } | null {
  const pipeline = activePipelines.get(pipelineId)
  if (!pipeline) return null

  const currentIdx = pipeline.currentPhase
    ? pipeline.phases.findIndex(p => p.name === pipeline.currentPhase)
    : -1

  if (currentIdx >= 0) {
    const current = pipeline.phases[currentIdx]
    current.status = 'completed'
    current.output = phaseOutput
    current.completedAt = Date.now()
    current.durationMs = current.startedAt ? Date.now() - current.startedAt : 0
  }

  const nextIdx = currentIdx + 1
  if (nextIdx >= pipeline.phases.length) {
    pipeline.status = 'completed'
    pipeline.completedAt = Date.now()
    pipeline.currentPhase = null
    return { nextPhase: null, pipeline }
  }

  const next = pipeline.phases[nextIdx]
  next.status = 'running'
  next.startedAt = Date.now()
  next.input = currentIdx >= 0 ? pipeline.phases[currentIdx].output : pipeline.query
  pipeline.currentPhase = next.name

  return { nextPhase: next.name, pipeline }
}

export function failPhase(pipelineId: string, error: string): void {
  const pipeline = activePipelines.get(pipelineId)
  if (!pipeline || !pipeline.currentPhase) return

  const current = pipeline.phases.find(p => p.name === pipeline.currentPhase)
  if (current) {
    current.status = 'failed'
    current.output = error
    current.completedAt = Date.now()
  }
  pipeline.status = 'failed'
  pipeline.completedAt = Date.now()
}

export function getPipeline(pipelineId: string): PhasePipeline | null {
  return activePipelines.get(pipelineId) || null
}

export function getActivePipelines(): PhasePipeline[] {
  return Array.from(activePipelines.values()).filter(p => p.status === 'running')
}

export function cleanupOldPipelines(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs
  let cleaned = 0
  for (const [id, pipeline] of activePipelines) {
    if (pipeline.startedAt < cutoff) {
      activePipelines.delete(id)
      cleaned++
    }
  }
  return cleaned
}

export function formatPipelineStatus(pipeline: PhasePipeline): string {
  const lines = [`Pipeline: ${pipeline.id} (${pipeline.status})`]
  for (const phase of pipeline.phases) {
    const icon = phase.status === 'completed' ? '✅' : phase.status === 'running' ? '⏳' : phase.status === 'failed' ? '❌' : '⬜'
    const duration = phase.durationMs > 0 ? ` (${Math.round(phase.durationMs / 1000)}s)` : ''
    lines.push(`  ${icon} ${phase.name}${duration}`)
  }
  return lines.join('\n')
}
