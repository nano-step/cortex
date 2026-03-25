import { BrowserWindow } from 'electron'

import { evolveAllClusters, getEvolutionStatus, clusterInstincts } from './instinct-evolver'
import { exportInstincts, exportInstinctsToFile, importInstinctsFromFile } from './instinct-io'
import { saveCheckpoint, verifyAgainstCheckpoint, getCheckpoints, deleteCheckpoint } from './verification-engine'
import { recordAttempt, getQualityMetrics, evaluateQualityGate } from './quality-gate'
import { loadPreviousSessionSummary, evaluateCompactNeed, getRecentSessions } from './session-persistence'
import { setContextMode, getContextMode, getModeConfig, getAllModes, type ContextMode } from './context-modes'
import { assemblePrompt, formatAssembledPrompt, getPromptBudgetStatus } from './prompt-assembler'
import { iterativeRetrieve } from './iterative-retrieval'
import { createPipeline, advancePhase, getPipeline, getActivePipelines, formatPipelineStatus } from './phase-orchestrator'
import { setHookProfile, getActiveProfile, getProfileInfo, getAllProfiles, type HookProfile } from './hook-profiles'
import { scanText, scanFiles, formatFindings } from './secret-scanner'
import { getRulesForLanguages, formatRulesAsContext, detectProjectLanguages } from './language-rules'
import { generateCodemap, formatCodemapAsContext } from './codemap-generator'
import { createSkillFromInstincts, createSkillFromPatterns, saveSkillTemplate, listCustomSkills } from './skill-creator'
import { shouldEnforceSearchFirst, formatSearchFirstReminder, buildResearchPlan } from './search-first'
import { runSecurityAudit, formatAuditResult } from './security-audit'

export function initECCSystem(): void {
  console.log('[ECC] Everything-Claude-Code adaptation system initialized')
  console.log('[ECC] Modules: instinct-evolver, verification, session-persistence, context-modes, prompt-assembler, iterative-retrieval, phase-orchestrator, hook-profiles, secret-scanner, language-rules, codemap, skill-creator, search-first')
}

export {
  evolveAllClusters, getEvolutionStatus, clusterInstincts,
  exportInstincts, exportInstinctsToFile, importInstinctsFromFile,
  saveCheckpoint, verifyAgainstCheckpoint, getCheckpoints, deleteCheckpoint,
  recordAttempt, getQualityMetrics, evaluateQualityGate,
  loadPreviousSessionSummary, evaluateCompactNeed, getRecentSessions,
  setContextMode, getContextMode, getModeConfig, getAllModes,
  assemblePrompt, formatAssembledPrompt, getPromptBudgetStatus,
  iterativeRetrieve,
  createPipeline, advancePhase, getPipeline, getActivePipelines, formatPipelineStatus,
  setHookProfile, getActiveProfile, getProfileInfo, getAllProfiles,
  scanText, scanFiles, formatFindings,
  getRulesForLanguages, formatRulesAsContext, detectProjectLanguages,
  generateCodemap, formatCodemapAsContext,
  createSkillFromInstincts, createSkillFromPatterns, saveSkillTemplate, listCustomSkills,
  shouldEnforceSearchFirst, formatSearchFirstReminder, buildResearchPlan,
  runSecurityAudit, formatAuditResult
}

export type { ContextMode, HookProfile }
