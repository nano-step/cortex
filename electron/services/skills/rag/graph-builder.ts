/**
 * Graph Builder — Extracts knowledge graph from code chunks
 */
import { getDb } from '../../db'
import { randomUUID } from 'crypto'
import { initGraphSchema, graphNodeQueries, graphEdgeQueries } from './graph-db'

interface Entity {
  name: string
  type: 'file' | 'function' | 'class' | 'module' | 'variable'
  filePath: string
  startLine: number
  endLine: number
  content: string
}

interface Relationship {
  sourceName: string
  targetName: string
  type: 'imports' | 'calls' | 'inherits' | 'implements' | 'uses'
}

export function buildKnowledgeGraph(projectId: string): { nodes: number, edges: number } {
  initGraphSchema()
  const db = getDb()

  // Clear existing graph
  graphNodeQueries.delete(db).run(projectId)
  graphEdgeQueries.delete(db).run(projectId)

  // Get all chunks
  const chunks = db.prepare('SELECT * FROM chunks WHERE project_id = ?').all(projectId) as Array<{
    id: string, relative_path: string, chunk_type: string, name: string | null,
    content: string, line_start: number, line_end: number, language: string
  }>

  const entities: Entity[] = []
  const relationships: Relationship[] = []

  for (const chunk of chunks) {
    // Extract entities from chunk
    const extracted = extractEntities(chunk)
    entities.push(...extracted)

    // Extract relationships
    const rels = extractRelationships(chunk.content, chunk.relative_path)
    relationships.push(...rels)
  }

  // Insert nodes
  const insertNode = graphNodeQueries.insert(db)
  const nodeMap = new Map<string, string>()

  const nodeTransaction = db.transaction(() => {
    for (const entity of entities) {
      const id = randomUUID()
      const key = `${entity.filePath}:${entity.name}:${entity.type}`
      if (nodeMap.has(key)) continue
      nodeMap.set(key, id)
      insertNode.run(id, projectId, entity.type, entity.name, entity.filePath, entity.startLine, entity.endLine, null, null, '{}')
    }
  })
  nodeTransaction()

  // Insert edges
  const insertEdge = graphEdgeQueries.insert(db)
  let edgeCount = 0

  const edgeTransaction = db.transaction(() => {
    for (const rel of relationships) {
      const sourceId = findNodeId(nodeMap, rel.sourceName)
      const targetId = findNodeId(nodeMap, rel.targetName)
      if (sourceId && targetId && sourceId !== targetId) {
        insertEdge.run(randomUUID(), projectId, sourceId, targetId, rel.type, 1.0, '{}')
        edgeCount++
      }
    }
  })
  edgeTransaction()

  console.log(`[GraphBuilder] Built graph: ${nodeMap.size} nodes, ${edgeCount} edges`)
  return { nodes: nodeMap.size, edges: edgeCount }
}

function extractEntities(chunk: { relative_path: string, chunk_type: string, name: string | null, content: string, line_start: number, line_end: number }): Entity[] {
  const entities: Entity[] = []

  // Add file entity
  entities.push({ name: chunk.relative_path, type: 'file', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end, content: '' })

  // Extract functions
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g
  let match
  while ((match = funcRegex.exec(chunk.content)) !== null) {
    entities.push({ name: match[1], type: 'function', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end, content: '' })
  }

  // Extract classes
  const classRegex = /(?:export\s+)?class\s+(\w+)/g
  while ((match = classRegex.exec(chunk.content)) !== null) {
    entities.push({ name: match[1], type: 'class', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end, content: '' })
  }

  // Extract arrow functions
  const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g
  while ((match = arrowRegex.exec(chunk.content)) !== null) {
    entities.push({ name: match[1], type: 'function', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end, content: '' })
  }

  return entities
}

function extractRelationships(content: string, filePath: string): Relationship[] {
  const rels: Relationship[] = []

  // Import relationships
  const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = importRegex.exec(content)) !== null) {
    rels.push({ sourceName: filePath, targetName: match[1], type: 'imports' })
  }

  // Extends/inherits
  const extendsRegex = /class\s+\w+\s+extends\s+(\w+)/g
  while ((match = extendsRegex.exec(content)) !== null) {
    rels.push({ sourceName: filePath, targetName: match[1], type: 'inherits' })
  }

  // Implements
  const implRegex = /class\s+\w+\s+implements\s+(\w+)/g
  while ((match = implRegex.exec(content)) !== null) {
    rels.push({ sourceName: filePath, targetName: match[1], type: 'implements' })
  }

  return rels
}

function findNodeId(nodeMap: Map<string, string>, name: string): string | undefined {
  for (const [key, id] of nodeMap) {
    if (key.includes(`:${name}:`) || key.startsWith(`${name}:`)) return id
  }
  return undefined
}

export function rebuildGraphForFiles(projectId: string, filePaths: string[]): { nodes: number; edges: number } {
  if (filePaths.length === 0) return { nodes: 0, edges: 0 }

  initGraphSchema()
  const db = getDb()

  let totalNodesDeleted = 0
  let totalEdgesDeleted = 0

  db.transaction(() => {
    for (const filePath of filePaths) {
      const orphanedNodeIds = (graphNodeQueries.getIdsByFilePath(db).all(projectId, filePath) as Array<{ id: string }>).map(r => r.id)
      if (orphanedNodeIds.length > 0) {
        graphEdgeQueries.deleteByNodeIds(db, orphanedNodeIds)
        totalEdgesDeleted += orphanedNodeIds.length
      }
      const delResult = graphNodeQueries.deleteByFilePath(db).run(projectId, filePath)
      totalNodesDeleted += delResult.changes
    }
  })()

  const chunks = db.prepare(
    `SELECT id, relative_path, chunk_type, name, content, line_start, line_end, language
     FROM chunks WHERE project_id = ? AND relative_path IN (${filePaths.map(() => '?').join(',')})`
  ).all(projectId, ...filePaths) as Array<{
    id: string; relative_path: string; chunk_type: string; name: string | null;
    content: string; line_start: number; line_end: number; language: string
  }>

  if (chunks.length === 0) {
    console.log(`[GraphBuilder] Incremental: removed ${totalNodesDeleted} nodes for ${filePaths.length} deleted files`)
    return { nodes: 0, edges: 0 }
  }

  const entities: Array<{ name: string; type: 'file' | 'function' | 'class' | 'module' | 'variable'; filePath: string; startLine: number; endLine: number }> = []
  const relationships: Array<{ sourceName: string; targetName: string; type: 'imports' | 'calls' | 'inherits' | 'implements' | 'uses' }> = []

  for (const chunk of chunks) {
    entities.push({ name: chunk.relative_path, type: 'file', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end })
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g
    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g
    let m
    while ((m = funcRegex.exec(chunk.content)) !== null) entities.push({ name: m[1], type: 'function', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end })
    while ((m = classRegex.exec(chunk.content)) !== null) entities.push({ name: m[1], type: 'class', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end })
    while ((m = arrowRegex.exec(chunk.content)) !== null) entities.push({ name: m[1], type: 'function', filePath: chunk.relative_path, startLine: chunk.line_start, endLine: chunk.line_end })

    const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g
    const extendsRegex = /class\s+\w+\s+extends\s+(\w+)/g
    const implRegex = /class\s+\w+\s+implements\s+(\w+)/g
    while ((m = importRegex.exec(chunk.content)) !== null) relationships.push({ sourceName: chunk.relative_path, targetName: m[1], type: 'imports' })
    while ((m = extendsRegex.exec(chunk.content)) !== null) relationships.push({ sourceName: chunk.relative_path, targetName: m[1], type: 'inherits' })
    while ((m = implRegex.exec(chunk.content)) !== null) relationships.push({ sourceName: chunk.relative_path, targetName: m[1], type: 'implements' })
  }

  const insertNode = graphNodeQueries.insert(db)
  const nodeMap = new Map<string, string>()

  db.transaction(() => {
    for (const entity of entities) {
      const key = `${entity.filePath}:${entity.name}:${entity.type}`
      if (nodeMap.has(key)) continue
      const id = randomUUID()
      nodeMap.set(key, id)
      insertNode.run(id, projectId, entity.type, entity.name, entity.filePath, entity.startLine, entity.endLine, null, null, '{}')
    }
  })()

  const insertEdge = graphEdgeQueries.insert(db)
  let edgeCount = 0
  db.transaction(() => {
    for (const rel of relationships) {
      const sourceId = findNodeId(nodeMap, rel.sourceName)
      const targetId = findNodeId(nodeMap, rel.targetName)
      if (sourceId && targetId && sourceId !== targetId) {
        insertEdge.run(randomUUID(), projectId, sourceId, targetId, rel.type, 1.0, '{}')
        edgeCount++
      }
    }
  })()

  console.log(`[GraphBuilder] Incremental rebuild: +${nodeMap.size} nodes, +${edgeCount} edges for ${filePaths.length} files`)
  return { nodes: nodeMap.size, edges: edgeCount }
}