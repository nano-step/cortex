# CORTEX v2.0 — SPRINT PLAN
## 6 Sprints | 12 Weeks | Reset from Sprint 13

**Created:** 03/03/2026
**Per sprint:** 2 weeks
**Total duration:** 12 weeks (03/03 – 26/05/2026)

---

## Timeline Overview

```
Week 1-2    Week 3-4    Week 5-6    Week 7-8    Week 9-10   Week 11-12
+--------+  +--------+  +--------+  +--------+  +--------+  +--------+
|Sprint13|  |Sprint14|  |Sprint15|  |Sprint16|  |Sprint17|  |Sprint18|
|Memory  |->|Skills  |->|RAG v2  |  |Self-   |  |Efficien|  |Agent   |
|Archit. |  |+MCP    |  |GraphRAG|  |Learning|  |cy Eng. |  |Mode    |
+--------+  +--------+  +--------+  +--------+  +--------+  +--------+
                |           |           |           |           |
                +-----------+-----------+-----------+-----------+
                    All depend on Sprint 14 (Skill Registry)
```

---

## Sprint 13: Memory Architecture (Weeks 1–2)

### Goal
Build the multi-tier memory system (Letta/MemGPT inspired) to replace the current nano-brain.
This is the FOUNDATION for everything else — agents need memory to learn, remember, and improve.

### Task Breakdown

| # | Task | File(s) | Effort | Status |
|---|------|---------|--------|--------|
| 13.1 | Design Memory interfaces and types | `electron/services/memory/types.ts` | 2h | - |
| 13.2 | Core Memory service (system prompt, user prefs, project ctx) | `electron/services/memory/core-memory.ts` | 1d | - |
| 13.3 | Archival Memory service (long-term, vector-searchable) | `electron/services/memory/archival-memory.ts` | 2d | - |
| 13.4 | Recall Memory service (conversation history + search) | `electron/services/memory/recall-memory.ts` | 1d | - |
| 13.5 | Memory Manager (orchestrate 3 tiers, load/save context) | `electron/services/memory/memory-manager.ts` | 2d | - |
| 13.6 | SQLite schema for memory tables | `electron/services/memory/memory-db.ts` | 4h | - |
| 13.7 | Migrate existing nano-brain data to new schema | `electron/services/memory/migration.ts` | 1d | - |
| 13.8 | Memory Dashboard UI (display 3 tiers, search, stats) | `src/components/memory/MemoryDashboard.tsx` | 1d | - |
| 13.9 | Memory Editor UI (manually edit core memory) | `src/components/memory/MemoryEditor.tsx` | 4h | - |
| 13.10 | IPC handlers for memory operations | `electron/main.ts` (add handlers) | 4h | - |
| 13.11 | Unit tests for memory services | `tests/unit/memory/*.test.ts` | 1d | - |
| 13.12 | Integration test: full memory lifecycle | `tests/unit/memory-integration.test.ts` | 4h | - |

### SQLite Schema

```sql
-- Core Memory (always in context, ~2000 tokens)
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
- [ ] Core memory saves and loads user preferences, project context
- [ ] Archival memory supports vector search (similarity > 0.8)
- [ ] Recall memory indexes conversation history with semantic search
- [ ] Memory Manager correctly routes read/write to the right tier
- [ ] UI displays 3 tiers with search
- [ ] Nano-brain data migrated successfully (0 data loss)
- [ ] All tests passing (unit + integration)
- [ ] Memory read latency < 50ms, search latency < 200ms

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite migration breaks existing data | High | Backup before migration, rollback script |
| Vector search slow with large archival | Medium | Batch embedding, HNSW index |
| Core memory > 2000 tokens | Low | Auto-compaction when threshold exceeded |

---

## Sprint 14: Skill Registry + MCP Integration (Weeks 3–4)

### Goal
Build the Skill Registry — a plugin system that allows loading/unloading AI skills.
Integrate the MCP protocol for connecting to external tools.
Wrap existing services (agentic-rag, brain-engine, etc.) as skills.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 14.1 | Skill interface + types | `electron/services/skills/types.ts` | 2h |
| 14.2 | Skill Registry (register, load, activate, deactivate, list) | `electron/services/skills/skill-registry.ts` | 2d |
| 14.3 | Skill Loader (dynamic import from directory) | `electron/services/skills/skill-loader.ts` | 1d |
| 14.4 | Skill Router (classify intent, route to best skill) | `electron/services/skills/skill-router.ts` | 2d |
| 14.5 | MCP Client implementation | `electron/services/skills/mcp/mcp-client.ts` | 2d |
| 14.6 | MCP Skill Adapter (wrap MCP server as CortexSkill) | `electron/services/skills/mcp/mcp-adapter.ts` | 1d |
| 14.7 | Builtin: RAG Skill (wrap agentic-rag.ts) | `electron/services/skills/builtin/rag-skill.ts` | 4h |
| 14.8 | Builtin: Code Analysis Skill | `electron/services/skills/builtin/code-analysis-skill.ts` | 4h |
| 14.9 | Builtin: Chat Skill (core conversation) | `electron/services/skills/builtin/chat-skill.ts` | 4h |
| 14.10 | Builtin: Memory Skill (wrap memory manager) | `electron/services/skills/builtin/memory-skill.ts` | 4h |
| 14.11 | Skill Manager UI | `src/components/skills/SkillManager.tsx` | 1d |
| 14.12 | Skill Config UI (per-skill settings) | `src/components/skills/SkillConfig.tsx` | 4h |
| 14.13 | skillStore.ts (Zustand) | `src/stores/skillStore.ts` | 4h |
| 14.14 | IPC handlers for skill operations | `electron/main.ts` (extend) | 4h |
| 14.15 | Tests | `tests/unit/skills/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] >= 4 built-in skills loaded and working
- [ ] Skill Router correctly routes queries to the right skill
- [ ] MCP client connects to at least 1 external MCP server
- [ ] UI displays skill list with status (active/inactive/error)
- [ ] Skills can call each other (composition)
- [ ] Hot-reload: add skill without restarting the app
- [ ] All tests passing

---

## Sprint 15: Advanced RAG Pipeline (Weeks 5–6)

### Goal
Upgrade RAG from simple hybrid search to a multi-strategy pipeline.
GraphRAG + RAG Fusion + Contextual Retrieval (3 P0 skills) are the priority.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 15.1 | Knowledge Graph Builder (entity extraction from code) | `electron/services/skills/rag/graph-builder.ts` | 3d |
| 15.2 | Graph storage (SQLite graph tables + indexes) | `electron/services/skills/rag/graph-db.ts` | 1d |
| 15.3 | GraphRAG query engine (vector + graph traversal) | `electron/services/skills/rag/graphrag-skill.ts` | 3d |
| 15.4 | RAG Fusion (multi-query generation + RRF merge) | `electron/services/skills/rag/rag-fusion-skill.ts` | 2d |
| 15.5 | Contextual Chunking (add context to chunks before embed) | `electron/services/skills/rag/contextual-chunk.ts` | 2d |
| 15.6 | RAG Strategy Router (classify query → select strategy) | `electron/services/skills/rag/rag-router.ts` | 1d |
| 15.7 | Re-embed existing brains with contextual chunking | `electron/services/skills/rag/re-embed.ts` | 1d |
| 15.8 | Upgrade agentic-rag.ts to compose all strategies | `electron/services/agentic-rag.ts` (refactor) | 1d |
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
- [ ] Knowledge graph built for at least 1 real project
- [ ] GraphRAG answers multi-hop questions (e.g., 'what does function A call and who calls it?')
- [ ] RAG Fusion improves relevance > 15% compared to single query
- [ ] Contextual chunks have file path + function context in the embedding
- [ ] RAG Router automatically selects the right strategy for the query type
- [ ] Re-embed does not lose existing data

---

## Sprint 16: Self-Learning Pipeline (Weeks 7–8)

### Goal
Self-learning system: DSPy prompt optimization + behavioral analytics + feedback loops.
Cortex starts TRULY learning from the user.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 16.1 | Behavioral Event Collector | `electron/services/skills/learning/event-collector.ts` | 1d |
| 16.2 | Event storage schema + SQLite tables | `electron/services/skills/learning/learning-db.ts` | 4h |
| 16.3 | Implicit feedback detection (accept/reject/edit) | `electron/services/skills/learning/feedback-detector.ts` | 2d |
| 16.4 | DSPy integration (Python bridge or TS port) | `electron/services/skills/learning/dspy-bridge.ts` | 3d |
| 16.5 | Prompt optimizer service | `electron/services/skills/learning/prompt-optimizer.ts` | 2d |
| 16.6 | Feedback-driven reranker update | `electron/services/learned-reranker.ts` (upgrade) | 1d |
| 16.7 | Self-Learning Dashboard UI | `src/components/learning/LearningDashboard.tsx` | 1d |
| 16.8 | learningStore.ts (Zustand) | `src/stores/learningStore.ts` | 4h |
| 16.9 | Tests + evaluation metrics | `tests/unit/learning/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] Behavioral events captured: >= 20 events per session
- [ ] DSPy optimization runs successfully (at least 1 prompt improved)
- [ ] Dashboard displays learning progress (events, improvements)
- [ ] Feedback detector accuracy > 80% (manual validation)
- [ ] Reranker updates from feedback data

---

## Sprint 17: Efficiency Engine (Weeks 9–10)

### Goal
Optimize token usage: LLMLingua + Semantic Cache + Model Routing + Cost Tracking.
Target: reduce token cost by 40% compared to v1.0.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 17.1 | LLMLingua integration (Python child_process) | `electron/services/skills/efficiency/llmlingua.ts` | 2d |
| 17.2 | Semantic Cache service | `electron/services/skills/efficiency/semantic-cache.ts` | 2d |
| 17.3 | Cache key generation (embedding similarity) | `electron/services/skills/efficiency/cache-key.ts` | 1d |
| 17.4 | Model Router (complexity classifier + model selection) | `electron/services/skills/efficiency/model-router.ts` | 2d |
| 17.5 | Model Registry (define models with cost/quality scores) | `electron/services/skills/efficiency/model-registry.ts` | 4h |
| 17.6 | Cost Tracker service | `electron/services/skills/efficiency/cost-tracker.ts` | 1d |
| 17.7 | Cost Dashboard UI | `src/components/efficiency/CostDashboard.tsx` | 1d |
| 17.8 | costStore.ts (Zustand) | `src/stores/costStore.ts` | 4h |
| 17.9 | Integrate efficiency pipeline into main query flow | `electron/services/skills/skill-router.ts` (update) | 1d |
| 17.10 | Tests + benchmarks | `tests/unit/efficiency/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] LLMLingua compresses context >= 40% while maintaining quality
- [ ] Semantic cache hit rate >= 20% after 1 week of use
- [ ] Model router correctly classifies complexity (manual eval > 80%)
- [ ] Cost tracker is accurate (error < 5% vs. actual API cost)
- [ ] Dashboard displays: cost/query, total cost, cache hit rate, compression ratio

---

## Sprint 18: Agent Mode (Weeks 11–12)

### Goal
Turn Cortex into a coding agent: code execution, browser automation, multi-step tasks.
Cortex doesn't just answer — Cortex ACTS.

### Task Breakdown

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 18.1 | Code Execution Sandbox (Docker or safe eval) | `electron/services/skills/agent/code-executor.ts` | 2d |
| 18.2 | Playwright MCP integration | `electron/services/skills/mcp/playwright-adapter.ts` | 1d |
| 18.3 | ReAct loop implementation | `electron/services/skills/reasoning/react-skill.ts` | 2d |
| 18.4 | Plan-and-Execute pattern | `electron/services/skills/reasoning/plan-execute-skill.ts` | 2d |
| 18.5 | Reflexion module (self-correction) | `electron/services/skills/reasoning/reflexion-skill.ts` | 1d |
| 18.6 | Agent UI (show plan, steps, results) | `src/components/agent/AgentPanel.tsx` | 2d |
| 18.7 | Terminal integration (run commands safely) | `electron/services/skills/agent/terminal.ts` | 1d |
| 18.8 | Git operations as agent actions | `electron/services/skills/agent/git-actions.ts` | 1d |
| 18.9 | Tests | `tests/unit/agent/*.test.ts` | 1d |

### Acceptance Criteria
- [ ] Code execution sandbox runs code safely (no file system access outside sandbox)
- [ ] Playwright can navigate, click, and scrape web pages
- [ ] ReAct loop completes multi-step tasks (e.g., 'find the bug in file X and fix it')
- [ ] Agent UI displays plan + execution steps + results
- [ ] Git operations: commit, branch, diff work through the agent

---

## Summary

| Sprint | Effort (days) | P0 Skills | Key Deliverables |
|--------|---------------|-----------|-----------------|
| 13 | 10 days | Memory tiers | Memory Manager + Dashboard + Migration |
| 14 | 12 days | Skill Registry, MCP | Skill system + 4 built-in skills + MCP client |
| 15 | 10 days | GraphRAG, Fusion, Contextual | Advanced RAG pipeline + Knowledge graph |
| 16 | 10 days | DSPy, Behavioral | Self-learning pipeline + Dashboard |
| 17 | 10 days | LLMLingua, Cache, Router | Efficiency engine + Cost dashboard |
| 18 | 10 days | ReAct, Code Exec | Agent mode + Terminal + Git actions |
| **TOTAL** | **62 days** | **19 P0 skills** | **Cortex v2.0** |

### Definition of Done for v2.0
- [ ] 19 P0 skills working and passing tests
- [ ] Multi-tier memory system working (3 tiers)
- [ ] Self-learning running (DSPy + behavioral analytics)
- [ ] Token cost reduced >= 30% compared to v1.0
- [ ] Agent mode completing multi-step tasks
- [ ] 0 type errors, all tests passing
- [ ] Documentation updated