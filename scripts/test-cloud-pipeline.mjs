#!/usr/bin/env node
/**
 * E2E Test: Voyage AI Embedding → Qdrant Storage → Jina Reranker
 *
 * Usage:
 *   VOYAGE_KEY=pa-xxx QDRANT_URL=https://xxx.qdrant.io:6333 QDRANT_KEY=xxx JINA_KEY=jina_xxx node scripts/test-cloud-pipeline.mjs
 */

const VOYAGE_KEY = process.env.VOYAGE_KEY
const QDRANT_URL = process.env.QDRANT_URL
const QDRANT_KEY = process.env.QDRANT_KEY
const JINA_KEY = process.env.JINA_KEY

const EMBEDDING_MODEL = 'voyage-code-3'
const COLLECTION = 'cortex_e2e_test'
const DIMS = 1024

const results = { voyage: null, qdrant: null, jina: null }

// ─── Helpers ──────────────────────────────────────────────
function ok(label) { console.log(`  ✅ ${label}`) }
function fail(label, err) { console.log(`  ❌ ${label}: ${err}`) }

// ─── Step 1: Voyage AI Embedding ──────────────────────────
async function testVoyageEmbedding() {
  console.log('\n🔹 Step 1: Voyage AI Embedding')
  if (!VOYAGE_KEY) { fail('Skipped', 'VOYAGE_KEY not set'); return null }

  const codeSnippets = [
    'export async function fetchUserById(id: string) {\n  const user = await db.query("SELECT * FROM users WHERE id = ?", [id])\n  return user\n}',
    'function calculateTax(amount: number, rate: number): number {\n  return Math.round(amount * rate * 100) / 100\n}',
    'import { Router } from "express"\nconst router = Router()\nrouter.get("/health", (req, res) => res.json({ status: "ok" }))',
    'class EventEmitter {\n  private listeners = new Map<string, Function[]>()\n  on(event: string, fn: Function) { this.listeners.get(event)?.push(fn) ?? this.listeners.set(event, [fn]) }\n}',
    'const cache = new Map<string, { data: any, expiresAt: number }>()\nfunction getCached(key: string) {\n  const entry = cache.get(key)\n  if (!entry || Date.now() > entry.expiresAt) return null\n  return entry.data\n}'
  ]

  const start = Date.now()
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VOYAGE_KEY}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: codeSnippets, input_type: 'document' })
  })
  const latency = Date.now() - start

  if (!res.ok) {
    const body = await res.text()
    fail('API call', `${res.status} ${body.slice(0, 200)}`)
    return null
  }

  const data = await res.json()
  const embeddings = data.data.map(d => d.embedding)

  ok(`Embedded ${embeddings.length} code snippets in ${latency}ms`)
  ok(`Dimensions: ${embeddings[0].length}`)
  ok(`Model: ${EMBEDDING_MODEL}`)

  if (embeddings[0].length !== DIMS) {
    fail('Dimension check', `expected ${DIMS}, got ${embeddings[0].length}`)
  }

  results.voyage = { embeddings, codeSnippets, latency }
  return { embeddings, codeSnippets }
}

// ─── Step 2: Qdrant Vector Storage ────────────────────────
async function testQdrantStorage(embData) {
  console.log('\n🔹 Step 2: Qdrant Cloud Storage')
  if (!QDRANT_URL || !QDRANT_KEY) { fail('Skipped', 'QDRANT_URL or QDRANT_KEY not set'); return }
  if (!embData) { fail('Skipped', 'No embeddings from Step 1'); return }

  const headers = { 'Content-Type': 'application/json', 'api-key': QDRANT_KEY }
  const baseUrl = QDRANT_URL.replace(/\/$/, '')

  // Delete old test collection if exists
  await fetch(`${baseUrl}/collections/${COLLECTION}`, { method: 'DELETE', headers }).catch(() => {})

  // Create collection
  let res = await fetch(`${baseUrl}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ vectors: { size: DIMS, distance: 'Cosine' } })
  })
  if (!res.ok) { fail('Create collection', `${res.status} ${await res.text()}`); return }
  ok('Collection created')

  // Upsert vectors
  const points = embData.embeddings.map((vec, i) => ({
    id: i + 1,
    vector: vec,
    payload: { content: embData.codeSnippets[i], index: i }
  }))

  res = await fetch(`${baseUrl}/collections/${COLLECTION}/points`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ points })
  })
  if (!res.ok) { fail('Upsert', `${res.status} ${await res.text()}`); return }
  ok(`Upserted ${points.length} vectors`)

  // Wait for indexing
  await new Promise(r => setTimeout(r, 1000))

  // Search: embed a query and search
  const queryRes = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VOYAGE_KEY}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: ['how to query database for user'], input_type: 'query' })
  })
  const queryData = await queryRes.json()
  const queryVec = queryData.data[0].embedding

  const searchStart = Date.now()
  res = await fetch(`${baseUrl}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ vector: queryVec, limit: 3, with_payload: true })
  })
  const searchLatency = Date.now() - searchStart

  if (!res.ok) { fail('Search', `${res.status} ${await res.text()}`); return }

  const searchResults = await res.json()
  ok(`Search returned ${searchResults.result.length} results in ${searchLatency}ms`)

  for (const r of searchResults.result) {
    const snippet = r.payload.content.split('\n')[0]
    console.log(`    [score=${r.score.toFixed(4)}] ${snippet}`)
  }

  // Verify: "fetchUserById" should be top result for "query database for user"
  const topContent = searchResults.result[0]?.payload?.content || ''
  if (topContent.includes('fetchUserById')) {
    ok('Semantic relevance: ✅ Top result is fetchUserById (correct!)')
  } else {
    console.log(`    ⚠️  Top result is not fetchUserById — got: ${topContent.slice(0, 60)}`)
  }

  results.qdrant = { searchResults: searchResults.result, searchLatency }

  // Cleanup
  await fetch(`${baseUrl}/collections/${COLLECTION}`, { method: 'DELETE', headers }).catch(() => {})
  ok('Test collection cleaned up')

  return searchResults.result.map(r => ({
    content: r.payload.content,
    score: r.score,
    id: String(r.id)
  }))
}

// ─── Step 3: Jina Reranker ────────────────────────────────
async function testJinaReranker(searchResults) {
  console.log('\n🔹 Step 3: Jina Reranker')
  if (!JINA_KEY) { fail('Skipped', 'JINA_KEY not set'); return }
  if (!searchResults?.length) { fail('Skipped', 'No search results from Step 2'); return }

  const query = 'how to query database for user'
  const start = Date.now()
  const res = await fetch('https://api.jina.ai/v1/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JINA_KEY}` },
    body: JSON.stringify({
      model: 'jina-reranker-v2-base-multilingual',
      query,
      documents: searchResults.map(r => r.content.slice(0, 1024)),
      top_n: 3
    })
  })
  const latency = Date.now() - start

  if (!res.ok) {
    const body = await res.text()
    fail('Rerank API', `${res.status} ${body.slice(0, 200)}`)
    return
  }

  const data = await res.json()
  ok(`Reranked ${data.results.length} results in ${latency}ms`)

  for (const r of data.results) {
    const snippet = searchResults[r.index].content.split('\n')[0]
    console.log(`    [relevance=${r.relevance_score.toFixed(4)}] ${snippet}`)
  }

  results.jina = { results: data.results, latency }
}

// ─── Run ──────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Cortex Cloud Pipeline E2E Test')
  console.log('═══════════════════════════════════════════')
  console.log(`  Voyage Key: ${VOYAGE_KEY ? '✅ set' : '❌ missing'}`)
  console.log(`  Qdrant URL: ${QDRANT_URL ? '✅ set' : '❌ missing'}`)
  console.log(`  Qdrant Key: ${QDRANT_KEY ? '✅ set' : '❌ missing'}`)
  console.log(`  Jina Key:   ${JINA_KEY ? '✅ set' : '❌ missing'}`)

  const embData = await testVoyageEmbedding()
  const searchResults = await testQdrantStorage(embData)
  await testJinaReranker(searchResults)

  console.log('\n═══════════════════════════════════════════')
  console.log('  Summary')
  console.log('═══════════════════════════════════════════')
  console.log(`  Voyage Embedding: ${results.voyage ? `✅ ${results.voyage.latency}ms` : '❌ failed'}`)
  console.log(`  Qdrant Storage:   ${results.qdrant ? `✅ search ${results.qdrant.searchLatency}ms` : '❌ failed'}`)
  console.log(`  Jina Reranker:    ${results.jina ? `✅ ${results.jina.latency}ms` : '❌ failed'}`)
  console.log('═══════════════════════════════════════════\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
