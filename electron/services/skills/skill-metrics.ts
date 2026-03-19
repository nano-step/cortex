/**
 * Skill Metrics — Persistent usage tracking in SQLite
 *
 * Solves: skills showing 0 totalCalls because metrics were in-memory only.
 * Now persists to DB + loads on startup + updates in-memory for fast reads.
 */

import { getDb } from '../db'

export interface SkillMetricsData {
  totalCalls: number
  successCount: number
  errorCount: number
  avgLatencyMs: number
  lastUsed: number | null
}

export function initSkillMetricsTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_metrics (
      skill_name TEXT PRIMARY KEY,
      total_calls INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      last_used INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `)
}

const metricsCache = new Map<string, SkillMetricsData>()

export function loadSkillMetrics(skillName: string): SkillMetricsData {
  if (metricsCache.has(skillName)) return metricsCache.get(skillName)!

  const db = getDb()
  const row = db.prepare(
    'SELECT total_calls, success_count, error_count, avg_latency_ms, last_used FROM skill_metrics WHERE skill_name = ?'
  ).get(skillName) as { total_calls: number; success_count: number; error_count: number; avg_latency_ms: number; last_used: number | null } | undefined

  const data: SkillMetricsData = row
    ? { totalCalls: row.total_calls, successCount: row.success_count, errorCount: row.error_count, avgLatencyMs: row.avg_latency_ms, lastUsed: row.last_used }
    : { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  metricsCache.set(skillName, data)
  return data
}

export function recordSkillCall(skillName: string, success: boolean, latencyMs: number): SkillMetricsData {
  const data = loadSkillMetrics(skillName)

  data.totalCalls++
  if (success) data.successCount++
  else data.errorCount++
  data.avgLatencyMs = (data.avgLatencyMs * (data.totalCalls - 1) + latencyMs) / data.totalCalls
  data.lastUsed = Date.now()

  metricsCache.set(skillName, data)

  const db = getDb()
  db.prepare(`
    INSERT INTO skill_metrics (skill_name, total_calls, success_count, error_count, avg_latency_ms, last_used, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_name) DO UPDATE SET
      total_calls = excluded.total_calls,
      success_count = excluded.success_count,
      error_count = excluded.error_count,
      avg_latency_ms = excluded.avg_latency_ms,
      last_used = excluded.last_used,
      updated_at = excluded.updated_at
  `).run(skillName, data.totalCalls, data.successCount, data.errorCount, data.avgLatencyMs, data.lastUsed, Date.now())

  return data
}

export function getAllSkillMetrics(): Record<string, SkillMetricsData> {
  const db = getDb()
  const rows = db.prepare('SELECT skill_name, total_calls, success_count, error_count, avg_latency_ms, last_used FROM skill_metrics').all() as Array<{
    skill_name: string; total_calls: number; success_count: number; error_count: number; avg_latency_ms: number; last_used: number | null
  }>

  const result: Record<string, SkillMetricsData> = {}
  for (const row of rows) {
    result[row.skill_name] = {
      totalCalls: row.total_calls,
      successCount: row.success_count,
      errorCount: row.error_count,
      avgLatencyMs: row.avg_latency_ms,
      lastUsed: row.last_used
    }
  }
  return result
}

export function resetSkillMetrics(skillName: string): void {
  metricsCache.delete(skillName)
  const db = getDb()
  db.prepare('DELETE FROM skill_metrics WHERE skill_name = ?').run(skillName)
}
