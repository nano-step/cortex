import { getDb } from '../db'
import { randomUUID } from 'crypto'

export interface QualityMetrics {
  passAtK: number
  passExpK: number
  totalAttempts: number
  successCount: number
  avgDurationMs: number
}

export interface QualityThreshold {
  minPassRate: number
  minCoverage: number
  maxRegressions: number
  maxDurationMs: number
}

export interface GateResult {
  passed: boolean
  metrics: QualityMetrics
  violations: string[]
}

const DEFAULT_THRESHOLD: QualityThreshold = {
  minPassRate: 0.7,
  minCoverage: 80,
  maxRegressions: 0,
  maxDurationMs: 300000
}

let schemaInit = false

function initQualitySchema(): void {
  if (schemaInit) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_attempts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      success INTEGER NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_quality_project ON quality_attempts(project_id, task_name);
  `)
  schemaInit = true
}

export function recordAttempt(projectId: string, taskName: string, success: boolean, durationMs: number, metadata?: Record<string, unknown>): void {
  initQualitySchema()
  const db = getDb()
  db.prepare('INSERT INTO quality_attempts (id, project_id, task_name, success, duration_ms, metadata) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), projectId, taskName, success ? 1 : 0, durationMs, JSON.stringify(metadata || {}))
}

export function computePassAtK(projectId: string, taskName: string, k: number = 3): number {
  initQualitySchema()
  const db = getDb()
  const rows = db.prepare(
    'SELECT success FROM quality_attempts WHERE project_id = ? AND task_name = ? ORDER BY created_at DESC LIMIT ?'
  ).all(projectId, taskName, k * 10) as Array<{ success: number }>

  if (rows.length === 0) return 0

  let windows = 0
  let passedWindows = 0
  for (let i = 0; i <= rows.length - k; i++) {
    windows++
    const window = rows.slice(i, i + k)
    if (window.some(r => r.success === 1)) passedWindows++
  }

  return windows > 0 ? passedWindows / windows : 0
}

export function computePassExpK(projectId: string, taskName: string, k: number = 3): number {
  initQualitySchema()
  const db = getDb()
  const rows = db.prepare(
    'SELECT success FROM quality_attempts WHERE project_id = ? AND task_name = ? ORDER BY created_at DESC LIMIT ?'
  ).all(projectId, taskName, k * 10) as Array<{ success: number }>

  if (rows.length === 0) return 0

  let windows = 0
  let allPassedWindows = 0
  for (let i = 0; i <= rows.length - k; i++) {
    windows++
    const window = rows.slice(i, i + k)
    if (window.every(r => r.success === 1)) allPassedWindows++
  }

  return windows > 0 ? allPassedWindows / windows : 0
}

export function getQualityMetrics(projectId: string, taskName: string): QualityMetrics {
  initQualitySchema()
  const db = getDb()
  const stats = db.prepare(
    'SELECT COUNT(*) as total, SUM(success) as successes, AVG(duration_ms) as avg_dur FROM quality_attempts WHERE project_id = ? AND task_name = ?'
  ).get(projectId, taskName) as { total: number; successes: number; avg_dur: number }

  return {
    passAtK: computePassAtK(projectId, taskName, 3),
    passExpK: computePassExpK(projectId, taskName, 3),
    totalAttempts: stats.total,
    successCount: stats.successes || 0,
    avgDurationMs: stats.avg_dur || 0
  }
}

export function evaluateQualityGate(
  projectId: string,
  taskName: string,
  currentSuccess: boolean,
  regressionCount: number = 0,
  coverage: number = 0,
  threshold: QualityThreshold = DEFAULT_THRESHOLD
): GateResult {
  const metrics = getQualityMetrics(projectId, taskName)
  const violations: string[] = []

  const passRate = metrics.totalAttempts > 0 ? metrics.successCount / metrics.totalAttempts : (currentSuccess ? 1 : 0)
  if (passRate < threshold.minPassRate) {
    violations.push(`Pass rate ${(passRate * 100).toFixed(0)}% < ${(threshold.minPassRate * 100).toFixed(0)}% threshold`)
  }

  if (coverage > 0 && coverage < threshold.minCoverage) {
    violations.push(`Coverage ${coverage.toFixed(0)}% < ${threshold.minCoverage}% threshold`)
  }

  if (regressionCount > threshold.maxRegressions) {
    violations.push(`${regressionCount} regressions > ${threshold.maxRegressions} max allowed`)
  }

  return { passed: violations.length === 0, metrics, violations }
}
