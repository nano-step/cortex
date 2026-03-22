/**
 * GraphRAG Skill — Graph-enhanced retrieval
 */
import type { CortexSkill, SkillInput, SkillOutput, SkillConfig, HealthStatus, SkillMetrics } from '../types'
import { getDb } from '../../db'
import { embedQuery } from '../../embedder'
import { graphNodeQueries, getNodeNeighbors } from './graph-db'
import { buildKnowledgeGraph } from './graph-builder'

const GRAPH_KEYWORDS = ['calls', 'imports', 'depends', 'uses', 'inherits', 'connected', 'relationship', 'graph', 'who uses', 'what imports']

export function createGraphRAGSkill(): CortexSkill {
  let metrics: SkillMetrics = { totalCalls: 0, successCount: 0, errorCount: 0, avgLatencyMs: 0, lastUsed: null }

  return {
    name: 'graphrag',
    version: '4.0.0',
    category: 'rag',
    priority: 'p0',
    description: 'Graph-enhanced retrieval for relationship and dependency queries',
    dependencies: [],
    async initialize(_config: SkillConfig) { /* graph built lazily on first execute */ },
    canHandle(input: SkillInput): boolean {
      const lower = input.query.toLowerCase()
      return GRAPH_KEYWORDS.some(kw => lower.includes(kw))
    },
    async execute(input: SkillInput): Promise<SkillOutput> {
      const start = Date.now()
      try {
        // Lazy-build knowledge graph if no nodes exist yet
        const db = getDb()
        const nodeCount = (db.prepare('SELECT COUNT(*) as count FROM graph_nodes WHERE project_id = ?').get(input.projectId) as { count: number } | undefined)?.count ?? 0
        if (nodeCount === 0) {
          console.log(`[GraphRAG] Building knowledge graph for project ${input.projectId}...`)
          const graphResult = buildKnowledgeGraph(input.projectId)
          console.log(`[GraphRAG] Graph built: ${graphResult.nodes} nodes, ${graphResult.edges} edges`)
        }

        const results = await graphSearch(input.projectId, input.query, 10)
        metrics.totalCalls++
        metrics.successCount++
        metrics.avgLatencyMs = (metrics.avgLatencyMs * (metrics.totalCalls - 1) + (Date.now() - start)) / metrics.totalCalls
        metrics.lastUsed = Date.now()
        return { content: results || 'No graph results found.', metadata: { type: 'graphrag' } }
      } catch (err) {
        metrics.totalCalls++
        metrics.errorCount++
        throw err
      }
    },
    async shutdown() {},
    async healthCheck(): Promise<HealthStatus> { return { healthy: true, lastCheck: Date.now() } },
    getMetrics() { return { ...metrics } }
  }
}

export async function graphSearch(projectId: string, query: string, limit: number = 10): Promise<string> {
  const db = getDb()

  // Search nodes by name
  const nodes = graphNodeQueries.getByName(db).all(`%${query}%`, projectId, limit) as Array<{
    id: string, name: string, type: string, file_path: string, start_line: number, end_line: number
  }>

  if (nodes.length === 0) return ''

  const parts: string[] = ['## Graph Results\n']

  for (const node of nodes.slice(0, 5)) {
    parts.push(`### ${node.type}: ${node.name}`)
    parts.push(`File: ${node.file_path} (L${node.start_line}-${node.end_line})`)

    // Get neighbors
    const neighborIds = getNodeNeighbors(node.id, 1)
    if (neighborIds.length > 0) {
      const neighbors = neighborIds.slice(0, 10).map(nid => {
        const n = graphNodeQueries.getById(db).get(nid) as { name: string, type: string } | undefined
        return n ? `  - ${n.type}: ${n.name}` : null
      }).filter(Boolean)
      if (neighbors.length > 0) {
        parts.push('Connected to:')
        parts.push(...neighbors as string[])
      }
    }
    parts.push('')
  }

  return parts.join('\n')
}