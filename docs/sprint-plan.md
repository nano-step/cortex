# CORTEX v2.0 — SPRINT PLAN
## 6 Sprints | 12 Tuan | Reset Tu Sprint 13

**Ngay tao:** 03/03/2026
**Moi sprint:** 2 tuan
**Tong thoi gian:** 12 tuan (03/03 - 26/05/2026)

---

## Timeline Overview

```
Tuan 1-2    Tuan 3-4    Tuan 5-6    Tuan 7-8    Tuan 9-10   Tuan 11-12
+--------+  +--------+  +--------+  +--------+  +--------+  +--------+
|Sprint13|  |Sprint14|  |Sprint15|  |Sprint16|  |Sprint17|  |Sprint18|
|Memory  |->|Skills  |->|RAG v2  |  |Self-   |  |Efficien|  |Agent   |
|Archit. |  |+MCP    |  |GraphRAG|  |Learning|  |cy Eng. |  |Mode    |
+--------+  +--------+  +--------+  +--------+  +--------+  +--------+
                |           |           |           |           |
                +-----------+-----------+-----------+-----------+
                    Tat ca depend vao Sprint 14 (Skill Registry)
```

---

## Sprint 13: Memory Architecture (Tuan 1-2)

### Muc Tieu
Xay dung he thong bo nho da tang (Letta/MemGPT inspired) thay the nano-brain hien tai.
Day la FOUNDATION cho moi thu khac - agent can memory de hoc, de nho, de cai thien.

### Task Breakdown

| # | Task | File(s) | Effort | Status |
|---|------|---------|--------|--------|
| 13.1 | Design Memory interfaces va types | `electron/services/memory/types.ts` | 2h | - |
| 13.2 | Core Memory service (system prompt, user prefs, project ctx) | `electron/services/memory/core-memory.ts` | 1d | - |
| 13.3 | Archival Memory service (long-term, vector-searchable) | `electron/services/memory/archival-memory.ts` | 2d | - |
| 13.4 | Recall Memory service (conversation history + search) | `electron/services/memory/recall-memory.ts` | 1d | - |
| 13.5 | Memory Manager (orchestrate 3 tiers, load/save context) | `electron/services/memory/memory-manager.ts` | 2d | - |
| 13.6 | SQLite schema cho memory tables | `electron/services/memory/memory-db.ts` | 4h | - |
| 13.7 | Migrate existing nano-brain data sang new schema | `electron/services/memory/migration.ts` | 1d | - |
| 13.8 | Memory Dashboard UI (hien thi 3 tiers, search, stats) | `src/components/memory/MemoryDashboard.tsx` | 1d | - |
| 13.9 | Memory Editor UI (edit core memory manually) | `src/components/memory/MemoryEditor.tsx` | 4h | - |
| 13.10 | IPC handlers cho memory operations | `electron/main.ts` (add handlers) | 4h | - |
| 13.11 | Unit tests cho memory services | `tests/unit/memory/*.test.ts` | 1d | - |
| 13.12 | Integration test: full memory lifecycle | `tests/unit/memory-integration.test.ts` | 4h | - |

### SQLite Schema

```sql
-- Core Memory (luon trong context, ~2000 tokens)
CREATE TABLE core_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  section TEXT NOT NULL, -- 'user_profile' | 'project_context' | 'preferences'
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, section)
);

-- Archival Memory (long-term, unlimited)
CREATE TABLE archival_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB, -- vector embedding for search
  metadata TEXT, -- JSON: source, type, tags
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  relevance_score REAL DEFAULT 1.0 -- decays over time
);
CREATE INDEX idx_archival_project ON archival_memory(project_id);

-- Recall Memory (conversation history)
CREATE TABLE recall_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  embedding BLOB,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_recall_project ON recall_memory(project_id);
CREATE INDEX idx_recall_conv ON recall_memory(conversation_id);
```

### Acceptance Criteria
- [ ] Core memory luu va load user preferences, project context
- [ ] Archival memory ho tro vector search (similarity > 0.8)
- [ ] Recall memory index conversation history voi semantic search
- [ ] Memory Manager dung route read/write den dung tier
- [ ] UI hien thi 3 tiers voi search
- [ ] Nano-brain data migrated thanh cong (0 data loss)
- [ ] All tests passing (unit + integration)
- [ ] Memory read latency < 50ms, search latency < 200ms

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite migration break existing data | High | Backup truoc migration, rollback script |
| Vector search slow voi large archival | Medium | Batch embedding, HNSW index |
| Core memory > 2000 tokens | Low | Auto-compaction khi vuot threshold |

---

## Sprint 14: Skill Registry + MCP Integration (Tuan 3-4)

### Muc Tieu
Xay dung Skill Registry - he thong plugin cho phep load/unload AI skills.
Tich hop MCP protocol de ket noi voi external tools.
Wrap existing services (agentic-rag, brain-engine, etc.) thanh skills.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 14.1 | Skill interface + types | `electron/services/skills/types.ts` | 2h |
| 14.2 | Skill Registry (register, load, activate, deactivate, list) | `electron/services/skills/skill-registry.ts` | 2d |
| 14.3 | Skill Loader (dynamic import tu directory) | `electron/services/skills/skill-loader.ts` | 1d |
| 14.4 | Skill Router (classify intent, route to best skill) | `electron/services/skills/skill-router.ts` | 2d |
| 14.5 | MCP Client implementation | `electron/services/skills/mcp/mcp-client.ts` | 2d |
| 14.6 | MCP Skill Adapter (wrap MCP server thanh CortexSkill) | `electron/services/skills/mcp/mcp-adapter.ts` | 1d |
| 14.7 | Builtin: RAG Skill (wrap agentic-rag.ts) | `electron/services/skills/builtin/rag-skill.ts` | 4h |
| 14.8 | Builtin: Code Analysis Skill | `electron/services/skills/builtin/code-analysis-skill.ts` | 4h |
| 14.9 | Builtin: Chat Skill (core conversation) | `electron/services/skills/builtin/chat-skill.ts` | 4h |
| 14.10 | Builtin: Memory Skill (wrap memory manager) | `electron/services/skills/builtin/memory-skill.ts` | 4h |
| 14.11 | Skill Manager UI | `src/components/skills/SkillManager.tsx` | 1d |
| 14.12 | Skill Config UI (per-skill settings) | `src/components/skills/SkillConfig.tsx` | 4h |
| 14.13 | skillStore.ts (Zustand) | `src/stores/skillStore.ts` | 4h |
| 14.14 | IPC handlers cho skill operations | `electron/main.ts` (extend) | 4h |
| 14.15 | Tests | `tests/unit/skills/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] >= 4 builtin skills loaded va hoat dong
- [ ] Skill Router dung route query den dung skill
- [ ] MCP client connect duoc voi it nhat 1 external MCP server
- [ ] UI hien thi list skills voi status (active/inactive/error)
- [ ] Skills co the goi nhau (composition)
- [ ] Hot-reload: add skill khong can restart app
- [ ] All tests passing

---

## Sprint 15: Advanced RAG Pipeline (Tuan 5-6)

### Muc Tieu
Nang cap RAG tu hybrid search don gian thanh multi-strategy pipeline.
GraphRAG + RAG Fusion + Contextual Retrieval (3 P0 skills) la priority.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 15.1 | Knowledge Graph Builder (entity extraction tu code) | `electron/services/skills/rag/graph-builder.ts` | 3d |
| 15.2 | Graph storage (SQLite graph tables + indexes) | `electron/services/skills/rag/graph-db.ts` | 1d |
| 15.3 | GraphRAG query engine (vector + graph traversal) | `electron/services/skills/rag/graphrag-skill.ts` | 3d |
| 15.4 | RAG Fusion (multi-query generation + RRF merge) | `electron/services/skills/rag/rag-fusion-skill.ts` | 2d |
| 15.5 | Contextual Chunking (add context to chunks before embed) | `electron/services/skills/rag/contextual-chunk.ts` | 2d |
| 15.6 | RAG Strategy Router (classify query -> chon strategy) | `electron/services/skills/rag/rag-router.ts` | 1d |
| 15.7 | Re-embed existing brains voi contextual chunking | `electron/services/skills/rag/re-embed.ts` | 1d |
| 15.8 | Upgrade agentic-rag.ts de compose all strategies | `electron/services/agentic-rag.ts` (refactor) | 1d |
| 15.9 | Tests + evaluation (manual relevance scoring) | `tests/unit/rag/*.test.ts` | 1d |

### Graph SQLite Schema
```sql
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'file' | 'function' | 'class' | 'module' | 'variable'
  name TEXT NOT NULL,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  content_hash TEXT,
  embedding BLOB,
  metadata TEXT -- JSON
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  type TEXT NOT NULL, -- 'imports' | 'calls' | 'inherits' | 'implements' | 'uses'
  weight REAL DEFAULT 1.0,
  metadata TEXT
);
CREATE INDEX idx_edges_source ON graph_edges(source_id);
CREATE INDEX idx_edges_target ON graph_edges(target_id);
```

### Acceptance Criteria
- [ ] Knowledge graph built cho it nhat 1 real project
- [ ] GraphRAG tra loi multi-hop questions (vd: 'function A goi gi va bi goi boi dau?')
- [ ] RAG Fusion cai thien relevance > 15% so voi single query
- [ ] Contextual chunks co file path + function context trong embedding
- [ ] RAG Router tu chon strategy phu hop voi query type
- [ ] Re-embed khong lam mat data cu

---

## Sprint 16: Self-Learning Pipeline (Tuan 7-8)

### Muc Tieu
He thong tu hoc: DSPy prompt optimization + behavioral analytics + feedback loops.
Cortex bat dau THUC SU hoc tu user.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 16.1 | Behavioral Event Collector | `electron/services/skills/learning/event-collector.ts` | 1d |
| 16.2 | Event storage schema + SQLite tables | `electron/services/skills/learning/learning-db.ts` | 4h |
| 16.3 | Implicit feedback detection (accept/reject/edit) | `electron/services/skills/learning/feedback-detector.ts` | 2d |
| 16.4 | DSPy integration (Python bridge hoac TS port) | `electron/services/skills/learning/dspy-bridge.ts` | 3d |
| 16.5 | Prompt optimizer service | `electron/services/skills/learning/prompt-optimizer.ts` | 2d |
| 16.6 | Feedback-driven reranker update | `electron/services/learned-reranker.ts` (upgrade) | 1d |
| 16.7 | Self-Learning Dashboard UI | `src/components/learning/LearningDashboard.tsx` | 1d |
| 16.8 | learningStore.ts (Zustand) | `src/stores/learningStore.ts` | 4h |
| 16.9 | Tests + evaluation metrics | `tests/unit/learning/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] Behavioral events captured: >= 20 events per session
- [ ] DSPy optimization chay duoc (it nhat 1 prompt improved)
- [ ] Dashboard hien thi learning progress (events, improvements)
- [ ] Feedback detector accuracy > 80% (manual validation)
- [ ] Reranker update tu feedback data

---

## Sprint 17: Efficiency Engine (Tuan 9-10)

### Muc Tieu
Toi uu token usage: LLMLingua + Semantic Cache + Model Routing + Cost Tracking.
Target: giam 40% token cost so voi v1.0.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 17.1 | LLMLingua integration (Python child_process) | `electron/services/skills/efficiency/llmlingua.ts` | 2d |
| 17.2 | Semantic Cache service | `electron/services/skills/efficiency/semantic-cache.ts` | 2d |
| 17.3 | Cache key generation (embedding similarity) | `electron/services/skills/efficiency/cache-key.ts` | 1d |
| 17.4 | Model Router (complexity classifier + model selection) | `electron/services/skills/efficiency/model-router.ts` | 2d |
| 17.5 | Model Registry (define models voi cost/quality scores) | `electron/services/skills/efficiency/model-registry.ts` | 4h |
| 17.6 | Cost Tracker service | `electron/services/skills/efficiency/cost-tracker.ts` | 1d |
| 17.7 | Cost Dashboard UI | `src/components/efficiency/CostDashboard.tsx` | 1d |
| 17.8 | costStore.ts (Zustand) | `src/stores/costStore.ts` | 4h |
| 17.9 | Integrate efficiency pipeline vao main query flow | `electron/services/skills/skill-router.ts` (update) | 1d |
| 17.10 | Tests + benchmarks | `tests/unit/efficiency/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] LLMLingua nen context >= 40% ma giu chat luong
- [ ] Semantic cache hit rate >= 20% sau 1 tuan su dung
- [ ] Model router dung classify complexity (manual eval > 80%)
- [ ] Cost tracker chinh xac (sai so < 5% so voi actual API cost)
- [ ] Dashboard hien thi: cost/query, total cost, cache hit rate, compression ratio

---

## Sprint 18: Agent Mode (Tuan 11-12)

### Muc Tieu
Bien Cortex thanh coding agent: code execution, browser automation, multi-step tasks.
Cortex khong chi tra loi - Cortex HANH DONG.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 18.1 | Code Execution Sandbox (Docker hoac safe eval) | `electron/services/skills/agent/code-executor.ts` | 2d |
| 18.2 | Playwright MCP integration | `electron/services/skills/mcp/playwright-adapter.ts` | 1d |
| 18.3 | ReAct loop implementation | `electron/services/skills/reasoning/react-skill.ts` | 2d |
| 18.4 | Plan-and-Execute pattern | `electron/services/skills/reasoning/plan-execute-skill.ts` | 2d |
| 18.5 | Reflexion module (self-correction) | `electron/services/skills/reasoning/reflexion-skill.ts` | 1d |
| 18.6 | Agent UI (show plan, steps, results) | `src/components/agent/AgentPanel.tsx` | 2d |
| 18.7 | Terminal integration (run commands safely) | `electron/services/skills/agent/terminal.ts` | 1d |
| 18.8 | Git operations as agent actions | `electron/services/skills/agent/git-actions.ts` | 1d |
| 18.9 | Tests | `tests/unit/agent/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] Code execution sandbox chay code an toan (no file system access ngoai sandbox)
- [ ] Playwright co the navigate, click, scrape web pages
- [ ] ReAct loop hoan thanh multi-step task (vd: 'tim bug trong file X va fix')
- [ ] Agent UI hien thi plan + execution steps + results
- [ ] Git operations: commit, branch, diff hoat dong qua agent

---

## Tong Ket

| Sprint | Effort (ngay) | P0 Skills | Deliverables Chinh |
|--------|---------------|-----------|-------------------|
| 13 | 10 ngay | Memory tiers | Memory Manager + Dashboard + Migration |
| 14 | 12 ngay | Skill Registry, MCP | Skill system + 4 builtin skills + MCP client |
| 15 | 10 ngay | GraphRAG, Fusion, Contextual | Advanced RAG pipeline + Knowledge graph |
| 16 | 10 ngay | DSPy, Behavioral | Self-learning pipeline + Dashboard |
| 17 | 10 ngay | LLMLingua, Cache, Router | Efficiency engine + Cost dashboard |
| 18 | 10 ngay | ReAct, Code Exec | Agent mode + Terminal + Git actions |
| **TONG** | **62 ngay** | **19 P0 skills** | **Cortex v2.0** |

### Definition of Done cho v2.0
- [ ] 19 P0 skills hoat dong va pass tests
- [ ] Memory system da tang hoat dong (3 tiers)
- [ ] Self-learning chay (DSPy + behavioral analytics)
- [ ] Token cost giam >= 30% so voi v1.0
- [ ] Agent mode hoan thanh multi-step tasks
- [ ] 0 type errors, all tests passing
- [ ] Documentation updated