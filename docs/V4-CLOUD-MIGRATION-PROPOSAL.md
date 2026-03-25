# V4 Cloud Migration Proposal — Full Cloud RAG Stack

## Executive Summary

Migrate the entire RAG pipeline from local (ONNX + LanceDB + SQLite brute-force) to cloud (Cloud Embedding API + Qdrant Cloud + Cloud Reranker). Zero breaking changes for 30+ consumer files by keeping public API interfaces unchanged.

**Expected outcomes:**
- Code search quality up ~14% (voyage-code-3 vs bge-m3 general-purpose)
- Eliminate 3.2GB model download, eliminate ONNX Runtime crash risk
- Eliminate LanceDB native panics, eliminate worker thread complexity
- Cost: ~$0.50 first month, ~$0.16/month thereafter (200 queries/day)

---

## Architecture

```
V3 (current):
  query → local bge-m3 (ONNX, 3.2GB) → LanceDB/SQLite → local bge-reranker → LLM

V4 (proposed):
  query → Cloud Embed API → Qdrant Cloud → Cloud Reranker → LLM
```

### Layer Architecture (Migration Safety Model)

```
LAYER 3 — CONSUMERS (30+ files)              ← NO CHANGES
  agentic-rag.ts, brain-engine.ts, main.ts,
  15+ skills, memory services
  │
  │  import { hybridSearch } from './vector-search'
  │  import { embedQuery } from './embedder'
  ▼
LAYER 2 — SEARCH GATEWAY                     ← INTERNAL CHANGES, API PRESERVED
  vector-search.ts
  │
  ▼
LAYER 1 — PROVIDERS                          ← FULLY REPLACED
  V3: embedder.ts (ONNX) + lance-store.ts + cross-encoder-reranker.ts
  V4: embedder.ts (Cloud API) + qdrant-store.ts + cloud-reranker.ts
```

**Key insight:** 30+ consumer files import from Layer 2. Layer 2 keeps its API unchanged. Only Layer 1 is replaced. → Zero breaking changes.

---

## Tech Stack V4

| Component | Service | Model/Tier | Cost |
|-----------|---------|-----------|------|
| Embedding | OpenRouter `/v1/embeddings` | `voyage-code-3` (1024d, 32K context) | $0.06/MTok |
| Vector DB | Qdrant Cloud | Free tier (1GB, ~500K vectors) | $0 |
| Reranker | Jina AI Reranker API | `jina-reranker-v2` | ~$0.02/1K searches |
| LLM | OpenRouter (existing) | Existing routing system | Existing |

### Why each choice?

**voyage-code-3**: SOTA code retrieval (+13.8% vs OpenAI, +16.8% vs CodeSage on 32 benchmarks). 32K context window — embeds entire files instead of small chunks. Via OpenRouter = same API key as LLM.

**Qdrant Cloud free tier**: 1GB = sufficient for 500K vectors at 1024d. Managed, auto-healing, hybrid search built-in (vector + BM25). No native crashes like LanceDB.

**Jina Reranker**: 100x cheaper than Cohere ($0.02 vs $2.00 per 1K searches). Quality sufficient for code reranking.

---

## Dependency Impact Map

### Files that NEED changes (Layer 1 + Layer 2):

| File | Change | Risk |
|------|--------|------|
| `electron/services/embedder.ts` | Swap ONNX → Cloud API call | Medium — core service |
| `electron/services/vector-search.ts` | Swap LanceDB/SQLite → Qdrant client | Medium — search gateway |
| `electron/services/cross-encoder-reranker.ts` | Swap local ONNX → Jina API | Low |
| `electron/services/brain-engine.ts` | Update indexing flow: embed → upsert Qdrant | Medium |
| `electron/services/sync-engine.ts` | Update re-index flow | Low |
| `electron/services/settings-service.ts` | Add Qdrant URL/key settings | Low |
| `electron/main.ts` | Remove preloadEmbeddingModel, add Qdrant init | Low |
| `electron.vite.config.ts` | Remove inference-worker entry | Low |
| `electron-builder.yml` | Remove @lancedb asarUnpack | Low |
| `package.json` | Add @qdrant/js-client-rest, remove @lancedb/lancedb | Low |
| Settings UI (React) | Add Qdrant + embedding provider config | Low |

### Files that DO NOT change (Layer 3 — 30+ files):

All consumer files remain unchanged because they import from `embedder.ts` and `vector-search.ts` — the public API is preserved:

```typescript
// BEFORE and AFTER migration — consumer code IDENTICAL
import { embedQuery } from './embedder'           // API unchanged
import { hybridSearch } from './vector-search'     // API unchanged
```

### Files to DELETE:

| File | Reason |
|------|--------|
| `electron/services/inference-worker.ts` | ONNX Runtime no longer needed |
| `electron/services/lance-store.ts` | Replaced by Qdrant |

---

## Migration Plan — 6 Phases

### Phase 0: Preparation (before coding)
- [ ] Create Qdrant Cloud account, get API key + cluster URL
- [ ] Test OpenRouter embedding endpoint with voyage-code-3 (verify it works)
- [ ] Test Jina Reranker API (verify it works)
- [ ] Create branch `feature/v4-cloud-migration`
- [ ] Backup current working state

### Phase 1: New Cloud Providers (additive only — nothing breaks)
- [ ] `npm install @qdrant/js-client-rest`
- [ ] Create `electron/services/qdrant-store.ts` — Qdrant Cloud client wrapper
  - `upsertVectors(projectId, vectors[])`
  - `searchSimilar(projectId, queryVector, topK, filters?)`
  - `deleteProjectVectors(projectId)`
  - Collection per project (or multi-tenant single collection)
- [ ] Create `electron/services/cloud-reranker.ts` — Jina Reranker API wrapper
  - `cloudRerank(query, candidates[], topK)`
- [ ] Add settings: `qdrant_url`, `qdrant_api_key`, `jina_api_key`
- [ ] Test each provider in ISOLATION before integrating

### Phase 2: Swap Embedder (highest risk — test thoroughly)
- [ ] Update `embedder.ts` internals:
  - `embedTexts()` → calls OpenRouter `/v1/embeddings` with model `voyage-code-3`
  - Uses existing `getProxyUrl()` + `getProxyKey()` (same proxy!)
  - Keep `embedQuery()`, `embedProjectChunks()`, `EMBEDDING_DIMENSIONS` exports unchanged
  - Set `EMBEDDING_DIMENSIONS = 1024` (voyage-code-3 default)
- [ ] Remove `inference-worker.ts`, remove Worker spawning code
- [ ] Remove `@huggingface/transformers` usage
- [ ] Test: `embedQuery("function hello() {}") → number[1024]` ✓

### Phase 3: Swap Vector Search (medium risk)
- [ ] Update `vector-search.ts`:
  - `vectorSearch()` → calls `qdrant-store.searchSimilar()` instead of local
  - Remove `bruteForceVectorSearch()` (SQLite brute-force)
  - Remove `lanceVectorSearch()`
  - Keep `hybridSearch()` API unchanged
  - `keywordSearch()` — keep as-is (still uses SQLite for keyword/BM25)
- [ ] Update `cross-encoder-reranker.ts` → calls Jina API instead of local ONNX
- [ ] Test: `hybridSearch(projectId, "auth middleware", 10) → SearchResult[]` ✓

### Phase 4: Swap Indexing Flow (medium risk)
- [ ] Update `brain-engine.ts`:
  - `indexLocalRepository()`: after chunking code → embed via cloud API → upsert Qdrant
  - Remove `initLanceStore()`, `syncFromSQLite()`, `buildIndex()` calls
  - Keep embedding storage in SQLite as metadata backup
- [ ] Update `sync-engine.ts`: delta re-index → cloud embed + Qdrant upsert
- [ ] Update `main.ts`:
  - Remove `preloadEmbeddingModel()` (no local model to preload)
  - Add Qdrant connection init
- [ ] Test: full re-index of a project → vectors in Qdrant Cloud ✓

### Phase 5: Cleanup (low risk)
- [ ] Delete `electron/services/inference-worker.ts`
- [ ] Delete `electron/services/lance-store.ts`
- [ ] Remove from `electron.vite.config.ts`: inference-worker entry
- [ ] Remove from `electron-builder.yml`: `@lancedb/**` asarUnpack
- [ ] `npm uninstall @lancedb/lancedb` (if not used elsewhere)
- [ ] Remove `onnxruntime-node` from external in vite config (if no other usage)
- [ ] Verify build: `npx electron-vite build` ✓
- [ ] Verify no imports reference deleted files

### Phase 6: Settings UI + Polish
- [ ] Settings page: Qdrant Cloud URL + API key fields
- [ ] Settings page: Embedding provider display (show "voyage-code-3 via OpenRouter")
- [ ] Settings page: Jina API key field
- [ ] First-run wizard: guide user to set up Qdrant (or auto-create free cluster?)
- [ ] Error handling UI: show clear message when cloud APIs are unreachable
- [ ] Model download progress UI: remove (no local models to download)
- [ ] Update README: document V4 cloud requirements

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OpenRouter embedding endpoint down | Retry 3x with exponential backoff. Cache recent embeddings in SQLite. |
| Qdrant Cloud free tier limit reached | Monitor via Qdrant dashboard. Alert user when approaching limit. Consider paid tier or prune old projects. |
| Jina Reranker API down | Skip reranking, return results in vector similarity order (graceful degradation). |
| Network offline | Show clear "Cloud services unavailable" message. Queue operations for retry. |
| Embedding dimension mismatch | voyage-code-3 = 1024d = same as current bge-m3. If user has existing old vectors, re-index is required (different dimensions → incorrect results). |
| Migration rollback | Git branch — rollback = switch branch. SQLite data is untouched. |
| API costs spike | Cost-guard hook already in place. Add embedding token counter. Alert when > $5/month. |

---

## Re-indexing Strategy

When migrating, old vectors (from bge-m3) are incompatible with new vectors (from voyage-code-3) — different model = different embedding space.

**Required**: Re-index ALL existing projects after migration.

**Flow**:
1. Clear old embeddings in SQLite (`UPDATE chunks SET embedding = NULL`)
2. Batch re-embed all chunks via cloud API
3. Upsert into Qdrant Cloud
4. Show progress UI to user

**Cost estimate for re-index**: 10K chunks × ~500 tokens/chunk = 5M tokens = $0.30 per project.

---

## Cost Summary

| Item | First month (with re-index) | Subsequent months |
|------|----------------------------|-------------------|
| Embedding (voyage-code-3) | $0.30 (index) + $0.04 (queries) | $0.04 |
| Qdrant Cloud | $0 (free tier) | $0 |
| Jina Reranker | $0.12 | $0.12 |
| **Total** | **~$0.50** | **~$0.16** |

Assumption: 1 project, 10K chunks, 200 queries/day.

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 0: Prep | 1 hour | Qdrant account, API keys |
| Phase 1: New providers | 4-6 hours | npm package, API docs |
| Phase 2: Swap embedder | 2-3 hours | Phase 1 done |
| Phase 3: Swap vector search | 3-4 hours | Phase 2 done |
| Phase 4: Swap indexing | 2-3 hours | Phase 3 done |
| Phase 5: Cleanup | 1-2 hours | Phase 4 done |
| Phase 6: Settings UI | 3-4 hours | Phase 5 done |
| **Total** | **~16-22 hours** | Sequential |

---

## Definition of Done

- [ ] `npm run dev` → app starts without ONNX/LanceDB
- [ ] New project import → chunks embedded via cloud → stored in Qdrant
- [ ] Chat query → cloud embed → Qdrant search → cloud rerank → LLM response
- [ ] No 3.2GB model download on first run
- [ ] No `onnxruntime`, `@lancedb/lancedb`, `inference-worker` in build output
- [ ] Settings UI shows Qdrant + embedding provider config
- [ ] `npx electron-vite build` succeeds
- [ ] App size reduced (no bundled native modules for ONNX/LanceDB)
- [ ] Existing tests pass (or updated for new providers)
