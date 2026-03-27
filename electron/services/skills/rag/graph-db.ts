/**
 * Graph Database — Knowledge graph storage for GraphRAG
 */
import Database from 'better-sqlite3'
import { getDb } from '../../db'

export function initGraphSchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      content_hash TEXT,
      embedding BLOB,
      metadata TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_project ON graph_nodes(project_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(project_id, type);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(name);

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_project ON graph_edges(project_id);
  `)
}

export const graphNodeQueries = {
  insert: (db: Database.Database) =>
    db.prepare('INSERT OR REPLACE INTO graph_nodes (id, project_id, type, name, file_path, start_line, end_line, content_hash, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_nodes WHERE project_id = ?'),
  getByType: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_nodes WHERE project_id = ? AND type = ?'),
  getByName: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_nodes WHERE name LIKE ? AND project_id = ? LIMIT ?'),
  getById: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_nodes WHERE id = ?'),
  delete: (db: Database.Database) =>
    db.prepare('DELETE FROM graph_nodes WHERE project_id = ?'),
  deleteByFilePath: (db: Database.Database) =>
    db.prepare('DELETE FROM graph_nodes WHERE project_id = ? AND file_path = ?'),
  getIdsByFilePath: (db: Database.Database) =>
    db.prepare('SELECT id FROM graph_nodes WHERE project_id = ? AND file_path = ?'),
  updateEmbedding: (db: Database.Database) =>
    db.prepare('UPDATE graph_nodes SET embedding = ? WHERE id = ?'),
  count: (db: Database.Database) =>
    db.prepare('SELECT COUNT(*) as count FROM graph_nodes WHERE project_id = ?')
}

export const graphEdgeQueries = {
  insert: (db: Database.Database) =>
    db.prepare('INSERT OR REPLACE INTO graph_edges (id, project_id, source_id, target_id, type, weight, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  getBySource: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_edges WHERE source_id = ?'),
  getByTarget: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_edges WHERE target_id = ?'),
  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM graph_edges WHERE project_id = ?'),
  delete: (db: Database.Database) =>
    db.prepare('DELETE FROM graph_edges WHERE project_id = ?'),
  deleteByNodeIds: (db: Database.Database, nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    const ph = nodeIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM graph_edges WHERE source_id IN (${ph}) OR target_id IN (${ph})`).run(...nodeIds, ...nodeIds)
  }
}

export function getNodeNeighbors(nodeId: string, depth: number = 2): string[] {
  const db = getDb()
  const visited = new Set<string>()
  const queue: Array<{ id: string, level: number }> = [{ id: nodeId, level: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.id) || current.level > depth) continue
    visited.add(current.id)

    if (current.level < depth) {
      const outEdges = graphEdgeQueries.getBySource(db).all(current.id) as Array<{ target_id: string }>
      const inEdges = graphEdgeQueries.getByTarget(db).all(current.id) as Array<{ source_id: string }>

      for (const edge of outEdges) {
        if (!visited.has(edge.target_id)) {
          queue.push({ id: edge.target_id, level: current.level + 1 })
        }
      }
      for (const edge of inEdges) {
        if (!visited.has(edge.source_id)) {
          queue.push({ id: edge.source_id, level: current.level + 1 })
        }
      }
    }
  }

  visited.delete(nodeId)
  return Array.from(visited)
}