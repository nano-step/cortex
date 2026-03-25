import { getDb } from '../db'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export interface Checkpoint {
  id: string
  projectId: string
  name: string
  fileHashes: Record<string, string>
  testResults: TestSnapshot | null
  metrics: Record<string, number>
  createdAt: number
}

export interface TestSnapshot {
  totalTests: number
  passed: number
  failed: number
  skipped: number
  coverage: number | null
  failedTests: string[]
}

export interface VerificationResult {
  passed: boolean
  filesChanged: string[]
  filesAdded: string[]
  filesDeleted: string[]
  regressions: string[]
  testDelta: { newFailures: string[]; newPasses: string[]; coverageDelta: number | null } | null
  summary: string
}

let schemaInitialized = false

function initCheckpointSchema(): void {
  if (schemaInitialized) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_hashes TEXT NOT NULL DEFAULT '{}',
      test_results TEXT,
      metrics TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id);
  `)
  schemaInitialized = true
}

function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath)
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  } catch {
    return 'error'
  }
}

function scanProjectFiles(projectPath: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']): Record<string, string> {
  const hashes: Record<string, string> = {}
  const maxFiles = 500

  function walk(dir: string, depth: number = 0): void {
    if (depth > 8 || Object.keys(hashes).length >= maxFiles) return
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') continue
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1)
        } else if (extensions.some(ext => entry.endsWith(ext))) {
          const relativePath = fullPath.replace(projectPath, '').replace(/^\//, '')
          hashes[relativePath] = hashFile(fullPath)
        }
      }
    } catch { return }
  }

  walk(projectPath)
  return hashes
}

export function saveCheckpoint(projectId: string, name: string, projectPath: string, testResults?: TestSnapshot): Checkpoint {
  initCheckpointSchema()
  const db = getDb()
  const id = randomUUID()
  const fileHashes = scanProjectFiles(projectPath)
  const now = Date.now()

  db.prepare(
    'INSERT INTO checkpoints (id, project_id, name, file_hashes, test_results, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, name, JSON.stringify(fileHashes), testResults ? JSON.stringify(testResults) : null, now)

  const checkpoint: Checkpoint = { id, projectId, name, fileHashes, testResults: testResults || null, metrics: {}, createdAt: now }
  console.log(`[Verification] Checkpoint saved: "${name}" (${Object.keys(fileHashes).length} files)`)
  return checkpoint
}

export function verifyAgainstCheckpoint(checkpointId: string, projectPath: string, currentTests?: TestSnapshot): VerificationResult {
  initCheckpointSchema()
  const db = getDb()
  const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as {
    file_hashes: string; test_results: string | null; name: string
  } | undefined

  if (!row) {
    return { passed: false, filesChanged: [], filesAdded: [], filesDeleted: [], regressions: [], testDelta: null, summary: 'Checkpoint not found' }
  }

  const savedHashes = JSON.parse(row.file_hashes) as Record<string, string>
  const currentHashes = scanProjectFiles(projectPath)

  const filesChanged: string[] = []
  const filesAdded: string[] = []
  const filesDeleted: string[] = []

  for (const [file, hash] of Object.entries(currentHashes)) {
    if (!(file in savedHashes)) filesAdded.push(file)
    else if (savedHashes[file] !== hash) filesChanged.push(file)
  }
  for (const file of Object.keys(savedHashes)) {
    if (!(file in currentHashes)) filesDeleted.push(file)
  }

  let testDelta: VerificationResult['testDelta'] = null
  const regressions: string[] = []

  if (currentTests && row.test_results) {
    const savedTests = JSON.parse(row.test_results) as TestSnapshot
    const newFailures = currentTests.failedTests.filter(t => !savedTests.failedTests.includes(t))
    const newPasses = savedTests.failedTests.filter(t => !currentTests.failedTests.includes(t))
    const coverageDelta = (currentTests.coverage !== null && savedTests.coverage !== null)
      ? currentTests.coverage - savedTests.coverage
      : null

    testDelta = { newFailures, newPasses, coverageDelta }
    if (newFailures.length > 0) regressions.push(...newFailures.map(t => `Test regression: ${t}`))
    if (coverageDelta !== null && coverageDelta < -5) regressions.push(`Coverage dropped by ${Math.abs(coverageDelta).toFixed(1)}%`)
  }

  const passed = regressions.length === 0
  const summary = passed
    ? `✅ Verification passed. ${filesChanged.length} files changed, ${filesAdded.length} added, ${filesDeleted.length} deleted.`
    : `❌ ${regressions.length} regressions detected: ${regressions.join('; ')}`

  return { passed, filesChanged, filesAdded, filesDeleted, regressions, testDelta, summary }
}

export function getCheckpoints(projectId: string, limit: number = 20): Checkpoint[] {
  initCheckpointSchema()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit) as Array<{ id: string; project_id: string; name: string; file_hashes: string; test_results: string | null; metrics: string; created_at: number }>

  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    fileHashes: JSON.parse(r.file_hashes),
    testResults: r.test_results ? JSON.parse(r.test_results) : null,
    metrics: JSON.parse(r.metrics || '{}'),
    createdAt: r.created_at
  }))
}

export function deleteCheckpoint(checkpointId: string): boolean {
  initCheckpointSchema()
  const db = getDb()
  const result = db.prepare('DELETE FROM checkpoints WHERE id = ?').run(checkpointId)
  return result.changes > 0
}
