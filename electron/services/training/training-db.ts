import Database from 'better-sqlite3'
import { getDb } from '../db'
import { randomUUID } from 'crypto'
import type { PipelineName, PipelineResult, JobStatus } from './types'

let schemaInitialized = false

export function initTrainingSchema(): void {
  if (schemaInitialized) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_runs (
      id TEXT PRIMARY KEY,
      pipeline TEXT NOT NULL,
      project_id TEXT,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metrics TEXT DEFAULT '{}',
      duration_ms INTEGER DEFAULT 0,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_training_runs_pipeline ON training_runs(pipeline);
    CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);
    CREATE INDEX IF NOT EXISTS idx_training_runs_created ON training_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_metrics (
      id TEXT PRIMARY KEY,
      pipeline TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      project_id TEXT,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_lookup ON pipeline_metrics(pipeline, metric_name);

    CREATE TABLE IF NOT EXISTS agent_scores (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      total_calls INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      avg_satisfaction REAL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(agent_name, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_scores_agent ON agent_scores(agent_name);

    CREATE TABLE IF NOT EXISTS cross_project_knowledge (
      id TEXT PRIMARY KEY,
      source_project_id TEXT NOT NULL,
      knowledge_type TEXT NOT NULL,
      domain TEXT,
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      usage_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cross_knowledge_type ON cross_project_knowledge(knowledge_type, domain);
  `)
  schemaInitialized = true
  console.log('[TrainingDB] Schema initialized')
}

export const runQueries = {
  insert: (db: Database.Database) =>
    db.prepare('INSERT INTO training_runs (id, pipeline, project_id, trigger_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  updateStatus: (db: Database.Database) =>
    db.prepare('UPDATE training_runs SET status = ?, started_at = ? WHERE id = ?'),
  complete: (db: Database.Database) =>
    db.prepare('UPDATE training_runs SET status = ?, metrics = ?, duration_ms = ?, error = ?, completed_at = ? WHERE id = ?'),
  getLastRun: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_runs WHERE pipeline = ? AND status = ? ORDER BY completed_at DESC LIMIT 1'),
  getHistory: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_runs ORDER BY created_at DESC LIMIT ?'),
  getByPipeline: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_runs WHERE pipeline = ? ORDER BY created_at DESC LIMIT ?'),
  countByStatus: (db: Database.Database) =>
    db.prepare('SELECT pipeline, COUNT(*) as count FROM training_runs WHERE status = ? GROUP BY pipeline')
}

export const metricQueries = {
  insert: (db: Database.Database) =>
    db.prepare('INSERT INTO pipeline_metrics (id, pipeline, metric_name, metric_value, project_id) VALUES (?, ?, ?, ?, ?)'),
  getRecent: (db: Database.Database) =>
    db.prepare('SELECT * FROM pipeline_metrics WHERE pipeline = ? AND metric_name = ? ORDER BY recorded_at DESC LIMIT ?'),
  getAvg: (db: Database.Database) =>
    db.prepare('SELECT AVG(metric_value) as avg_value FROM pipeline_metrics WHERE pipeline = ? AND metric_name = ? AND recorded_at > ?')
}

export const agentScoreQueries = {
  upsert: (db: Database.Database) =>
    db.prepare(`INSERT INTO agent_scores (id, agent_name, project_id, total_calls, success_count, avg_latency_ms, avg_satisfaction, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_name, project_id) DO UPDATE SET
        total_calls = total_calls + excluded.total_calls,
        success_count = success_count + excluded.success_count,
        avg_latency_ms = (avg_latency_ms * total_calls + excluded.avg_latency_ms * excluded.total_calls) / (total_calls + excluded.total_calls),
        avg_satisfaction = (avg_satisfaction * total_calls + excluded.avg_satisfaction * excluded.total_calls) / (total_calls + excluded.total_calls),
        updated_at = excluded.updated_at`),
  getByAgent: (db: Database.Database) =>
    db.prepare('SELECT * FROM agent_scores WHERE agent_name = ? ORDER BY avg_satisfaction DESC'),
  getAll: (db: Database.Database) =>
    db.prepare('SELECT * FROM agent_scores ORDER BY avg_satisfaction DESC LIMIT ?'),
  getTopAgents: (db: Database.Database) =>
    db.prepare('SELECT agent_name, AVG(avg_satisfaction) as score, SUM(total_calls) as calls FROM agent_scores GROUP BY agent_name ORDER BY score DESC')
}

export const crossKnowledgeQueries = {
  insert: (db: Database.Database) =>
    db.prepare('INSERT OR IGNORE INTO cross_project_knowledge (id, source_project_id, knowledge_type, domain, content, confidence) VALUES (?, ?, ?, ?, ?, ?)'),
  search: (db: Database.Database) =>
    db.prepare('SELECT * FROM cross_project_knowledge WHERE knowledge_type = ? AND (domain = ? OR domain IS NULL) AND confidence > 0.3 ORDER BY confidence DESC, usage_count DESC LIMIT ?'),
  incrementUsage: (db: Database.Database) =>
    db.prepare('UPDATE cross_project_knowledge SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?'),
  prune: (db: Database.Database) =>
    db.prepare('DELETE FROM cross_project_knowledge WHERE confidence < 0.2 AND usage_count = 0 AND created_at < ?')
}

export function insertRun(pipeline: PipelineName, triggerType: string, projectId?: string): string {
  const db = getDb()
  const id = randomUUID()
  runQueries.insert(db).run(id, pipeline, projectId || null, triggerType, 'pending', Date.now())
  return id
}

export function startRun(runId: string): void {
  const db = getDb()
  runQueries.updateStatus(db).run('running', Date.now(), runId)
}

export function completeRun(runId: string, result: PipelineResult): void {
  const db = getDb()
  runQueries.complete(db).run(
    result.success ? 'completed' : 'failed',
    JSON.stringify(result.metrics),
    result.durationMs,
    result.error || null,
    Date.now(),
    runId
  )
}

export function getLastRunTime(pipeline: PipelineName): number | null {
  const db = getDb()
  const row = runQueries.getLastRun(db).get(pipeline, 'completed') as { completed_at: number } | undefined
  return row?.completed_at || null
}

export function recordMetric(pipeline: PipelineName, name: string, value: number, projectId?: string): void {
  const db = getDb()
  metricQueries.insert(db).run(randomUUID(), pipeline, name, value, projectId || null)
}

export function getRunHistory(limit: number = 50): Array<Record<string, unknown>> {
  const db = getDb()
  return runQueries.getHistory(db).all(limit) as Array<Record<string, unknown>>
}

export function getRunCountByPipeline(pipeline: PipelineName): { total: number; successes: number } {
  const db = getDb()
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM training_runs WHERE pipeline = ? GROUP BY status').all(pipeline) as Array<{ status: string; count: number }>
  let total = 0
  let successes = 0
  for (const row of rows) {
    total += row.count
    if (row.status === 'completed') successes += row.count
  }
  return { total, successes }
}
