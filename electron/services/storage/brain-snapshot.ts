import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'fs'
import { app } from 'electron'

const MAX_SNAPSHOTS = 3

function getSnapshotBase(projectId: string): string {
  return join(app.getPath('userData'), 'cortex-data', 'snapshots', projectId)
}

function getDbPath(): string {
  return join(app.getPath('userData'), 'cortex-data', 'cortex.db')
}

export interface SnapshotInfo {
  id: string
  projectId: string
  createdAt: number
  path: string
}

export function createSnapshot(projectId: string): SnapshotInfo | null {
  try {
    const snapshotDir = getSnapshotBase(projectId)
    mkdirSync(snapshotDir, { recursive: true })

    const id = `${Date.now()}`
    const snapshotPath = join(snapshotDir, `${id}.db`)
    const dbPath = getDbPath()

    if (!existsSync(dbPath)) return null

    copyFileSync(dbPath, snapshotPath)

    pruneOldSnapshots(projectId)

    console.log(`[BrainSnapshot] Created snapshot ${id} for project ${projectId}`)
    return { id, projectId, createdAt: parseInt(id), path: snapshotPath }
  } catch (err) {
    console.error('[BrainSnapshot] Failed to create snapshot:', err)
    return null
  }
}

export function listSnapshots(projectId: string): SnapshotInfo[] {
  try {
    const snapshotDir = getSnapshotBase(projectId)
    if (!existsSync(snapshotDir)) return []

    return readdirSync(snapshotDir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const id = f.replace('.db', '')
        return { id, projectId, createdAt: parseInt(id), path: join(snapshotDir, f) }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function restoreSnapshot(projectId: string, snapshotId: string): boolean {
  try {
    const snapshotPath = join(getSnapshotBase(projectId), `${snapshotId}.db`)
    if (!existsSync(snapshotPath)) {
      console.error(`[BrainSnapshot] Snapshot ${snapshotId} not found`)
      return false
    }

    const dbPath = getDbPath()
    const backupPath = `${dbPath}.pre-restore`
    if (existsSync(dbPath)) copyFileSync(dbPath, backupPath)

    copyFileSync(snapshotPath, dbPath)
    console.log(`[BrainSnapshot] Restored snapshot ${snapshotId} for project ${projectId}`)
    return true
  } catch (err) {
    console.error('[BrainSnapshot] Restore failed:', err)
    return false
  }
}

function pruneOldSnapshots(projectId: string): void {
  const snapshots = listSnapshots(projectId)
  if (snapshots.length > MAX_SNAPSHOTS) {
    const toDelete = snapshots.slice(MAX_SNAPSHOTS)
    for (const snap of toDelete) {
      try {
        rmSync(snap.path)
      } catch { }
    }
  }
}
