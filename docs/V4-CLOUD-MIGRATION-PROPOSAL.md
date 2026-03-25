# V4 Cloud Migration Proposal — Full Cloud RAG Stack

## Executive Summary

Chuyển toàn bộ RAG pipeline từ local (ONNX + LanceDB + SQLite brute-force) sang cloud (Cloud Embedding API + Qdrant Cloud + Cloud Reranker). Zero breaking changes cho 30+ consumer files nhờ giữ nguyên public API interfaces.

**Kết quả dự kiến:**
- Code search quality tăng ~14% (voyage-code-3 vs bge-m3 general-purpose)
- Loại bỏ 3.2GB model download, loại bỏ ONNX Runtime crash risk
- Loại bỏ LanceDB native panics, loại bỏ worker thread complexity
- Chi phí: ~$0.50 tháng đầu, ~$0.16/tháng sau đó (200 queries/ngày)

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
LAYER 3 — CONSUMERS (30+ files)              ← KHÔNG THAY ĐỔI
  agentic-rag.ts, brain-engine.ts, main.ts,
  15+ skills, memory services
  │
  │  import { hybridSearch } from './vector-search'
  │  import { embedQuery } from './embedder'
  ▼
LAYER 2 — SEARCH GATEWAY                     ← THAY ĐỔI NỘI BỘ, GIỮ API
  vector-search.ts
  │
  ▼
LAYER 1 — PROVIDERS                          ← THAY THẾ HOÀN TOÀN
  V3: embedder.ts (ONNX) + lance-store.ts + cross-encoder-reranker.ts
  V4: embedder.ts (Cloud API) + qdrant-store.ts + cloud-reranker.ts
```

**Key insight:** 30+ consumer files import từ Layer 2. Layer 2 giữ nguyên API. Chỉ Layer 1 thay đổi. → Zero breaking changes.

---

## Tech Stack V4

| Component | Service | Model/Tier | Giá |
|-----------|---------|-----------|-----|
| Embedding | OpenRouter `/v1/embeddings` | `voyage-code-3` (1024d, 32K context) | $0.06/MTok |
| Vector DB | Qdrant Cloud | Free tier (1GB, ~500K vectors) | $0 |
| Reranker | Jina AI Reranker API | `jina-reranker-v2` | ~$0.02/1K searches |
| LLM | OpenRouter (existing) | Existing routing system | Existing |

### Tại sao từng lựa chọn?

**voyage-code-3**: SOTA code retrieval (+13.8% vs OpenAI, +16.8% vs CodeSage trên 32 benchmarks). 32K context window — embed cả file thay vì chunk nhỏ. Qua OpenRouter = cùng API key với LLM.

**Qdrant Cloud free tier**: 1GB = đủ cho 500K vectors 1024d. Managed, auto-healing, hybrid search built-in (vector + BM25). Không native crash như LanceDB.

**Jina Reranker**: Rẻ hơn 100x so với Cohere ($0.02 vs $2.00 per 1K searches). Quality đủ tốt cho code reranking.

---

## Dependency Impact Map

### Files CẦN thay đổi (Layer 1 + Layer 2):

| File | Thay đổi | Risk |
|------|---------|------|
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

### Files KHÔNG thay đổi (Layer 3 — 30+ files):

Tất cả consumer files giữ nguyên vì import từ `embedder.ts` và `vector-search.ts` — public API không đổi:

```typescript
// Trước và SAU migration — consumer code IDENTICAL
import { embedQuery } from './embedder'           // API giữ nguyên
import { hybridSearch } from './vector-search'     // API giữ nguyên
```

### Files bị XÓA:

| File | Lý do |
|------|-------|
| `electron/services/inference-worker.ts` | Không còn ONNX Runtime |
| `electron/services/lance-store.ts` | Thay bằng Qdrant |

---

## Migration Plan — 6 Phases

### Phase 0: Preparation (trước khi code)
- [ ] Tạo Qdrant Cloud account, lấy API key + cluster URL
- [ ] Test OpenRouter embedding endpoint với voyage-code-3 (verify hoạt động)
- [ ] Test Jina Reranker API (verify hoạt động)
- [ ] Tạo branch `feature/v4-cloud-migration`
- [ ] Backup current working state

### Phase 1: New Cloud Providers (additive only — không break gì)
- [ ] `npm install @qdrant/js-client-rest`
- [ ] Tạo `electron/services/qdrant-store.ts` — Qdrant Cloud client wrapper
  - `upsertVectors(projectId, vectors[])` 
  - `searchSimilar(projectId, queryVector, topK, filters?)`
  - `deleteProjectVectors(projectId)`
  - Collection per project (hoặc multi-tenant single collection)
- [ ] Tạo `electron/services/cloud-reranker.ts` — Jina Reranker API wrapper
  - `cloudRerank(query, candidates[], topK)`
- [ ] Add settings: `qdrant_url`, `qdrant_api_key`, `jina_api_key`
- [ ] Test mỗi provider ISOLATED trước khi tích hợp

### Phase 2: Swap Embedder (highest risk — test kỹ)
- [ ] Update `embedder.ts` internals:
  - `embedTexts()` → gọi OpenRouter `/v1/embeddings` với model `voyage-code-3`
  - Sử dụng existing `getProxyUrl()` + `getProxyKey()` (cùng proxy!)
  - Keep `embedQuery()`, `embedProjectChunks()`, `EMBEDDING_DIMENSIONS` exports unchanged
  - Set `EMBEDDING_DIMENSIONS = 1024` (voyage-code-3 default)
- [ ] Remove `inference-worker.ts`, remove Worker spawning code
- [ ] Remove `@huggingface/transformers` usage
- [ ] Test: `embedQuery("function hello() {}") → number[1024]` ✓

### Phase 3: Swap Vector Search (medium risk)
- [ ] Update `vector-search.ts`:
  - `vectorSearch()` → gọi `qdrant-store.searchSimilar()` thay vì local
  - Remove `bruteForceVectorSearch()` (SQLite brute-force)
  - Remove `lanceVectorSearch()` 
  - Keep `hybridSearch()` API unchanged
  - `keywordSearch()` — giữ nguyên (vẫn dùng SQLite cho keyword/BM25)
- [ ] Update `cross-encoder-reranker.ts` → gọi Jina API thay vì local ONNX
- [ ] Test: `hybridSearch(projectId, "auth middleware", 10) → SearchResult[]` ✓

### Phase 4: Swap Indexing Flow (medium risk)
- [ ] Update `brain-engine.ts`:
  - `indexLocalRepository()`: sau khi chunk code → embed via cloud API → upsert Qdrant
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
- [ ] `npm uninstall @lancedb/lancedb` (nếu không dùng elsewhere)
- [ ] Remove `onnxruntime-node` from external in vite config (if no other usage)
- [ ] Verify build: `npx electron-vite build` ✓
- [ ] Verify no imports reference deleted files

### Phase 6: Settings UI + Polish
- [ ] Settings page: Qdrant Cloud URL + API key fields
- [ ] Settings page: Embedding provider display (show "voyage-code-3 via OpenRouter")
- [ ] Settings page: Jina API key field
- [ ] First-run wizard: guide user to set up Qdrant (or auto-create free cluster?)
- [ ] Error handling UI: show clear message when cloud APIs unreachable
- [ ] Model download progress UI: remove (no local models to download)
- [ ] Update README: document V4 cloud requirements

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OpenRouter embedding endpoint down | Retry 3x with exponential backoff. Cache recent embeddings in SQLite. |
| Qdrant Cloud free tier limit reached | Monitor via Qdrant dashboard. Alert user khi gần limit. Consider paid tier hoặc prune old projects. |
| Jina Reranker API down | Skip reranking, return results in vector similarity order (graceful degradation). |
| Network offline | Show clear "Cloud services unavailable" message. Queue operations for retry. |
| Embedding dimension mismatch | voyage-code-3 = 1024d = same as current bge-m3. Nếu user đã có vectors cũ, cần re-index (dimensions khác → results sai). |
| Migration rollback | Git branch — rollback = switch branch. Không touch SQLite data. |
| API costs spike | Cost-guard hook đã có. Add embedding token counter. Alert khi > $5/tháng. |

---

## Re-indexing Strategy

Khi migrate, vectors cũ (từ bge-m3) không tương thích với vectors mới (từ voyage-code-3) — different model = different embedding space.

**Required**: Re-index ALL existing projects sau migration.

**Flow**:
1. Clear old embeddings trong SQLite (`UPDATE chunks SET embedding = NULL`)
2. Batch embed lại tất cả chunks via cloud API
3. Upsert vào Qdrant Cloud
4. Show progress UI cho user

**Cost estimate cho re-index**: 10K chunks × ~500 tokens/chunk = 5M tokens = $0.30 per project.

---

## Cost Summary

| Item | Tháng đầu (với re-index) | Tháng sau |
|------|--------------------------|-----------|
| Embedding (voyage-code-3) | $0.30 (index) + $0.04 (queries) | $0.04 |
| Qdrant Cloud | $0 (free tier) | $0 |
| Jina Reranker | $0.12 | $0.12 |
| **Total** | **~$0.50** | **~$0.16** |

Giả định: 1 project, 10K chunks, 200 queries/ngày.

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
