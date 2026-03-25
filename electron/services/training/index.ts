import { BrowserWindow } from 'electron'
import {
  initTrainingEngine, shutdownTrainingEngine, registerPipeline,
  getEngineStatus, notifyChatCompleted, notifyBehavioralEvent,
  pauseTraining, resumeTraining, triggerManualTraining
} from './training-engine'
import { createRerankerPipeline } from './pipelines/pipeline-reranker'
import { createPromptPipeline } from './pipelines/pipeline-prompt'
import { createInstinctPipeline } from './pipelines/pipeline-instinct'
import { createAgentPipeline } from './pipelines/pipeline-agent'
import { createCrystalPipeline } from './pipelines/pipeline-crystal'
import { createMemoryPipeline } from './pipelines/pipeline-memory'
import { createEmbeddingPipeline } from './pipelines/pipeline-embedding'

export function startTrainingSystem(window: BrowserWindow | null): void {
  registerPipeline(createRerankerPipeline())
  registerPipeline(createPromptPipeline())
  registerPipeline(createInstinctPipeline())
  registerPipeline(createAgentPipeline())
  registerPipeline(createCrystalPipeline())
  registerPipeline(createMemoryPipeline())
  registerPipeline(createEmbeddingPipeline())

  initTrainingEngine(window)
  console.log('[Training] All 7 pipelines registered and engine started')
}

export function stopTrainingSystem(): void {
  shutdownTrainingEngine()
}

export {
  getEngineStatus,
  notifyChatCompleted,
  notifyBehavioralEvent,
  pauseTraining,
  resumeTraining,
  triggerManualTraining
}
