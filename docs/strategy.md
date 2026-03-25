# CORTEX v2.0 — STRATEGIC VISION
## Bo Nao Ca Nhan Hoa Cho Ky Su Phan Mem

**Ngay tao:** 03/03/2026
**Phien ban:** v2.0 Strategic Reset
**Tac gia:** Cortex Team

---

## 1. Tam Nhin (Vision)

Cortex v2.0 KHONG phai SaaS. KHONG phai tool cho nguoi khac.

Day la **VU KHI CA NHAN** — mot AI engineering platform:
- **Tu hoc** tu hanh vi cua ban, khong phai du doan
- **Tu cai thien** prompts, retrieval, ranking theo thoi gian
- **Pluggable Skills** — kien truc module, de them/bot capabilities
- **Thay the hoan toan** Cursor/Windsurf/Codex bang he thong do BAN so huu, BAN kiem soat
- **Cortex hieu BAN** — khong chi hieu code, ma hieu CACH ban code, ban THICH gi, ban CAN gi

### Tai sao khong SaaS?
- Ban can QUYEN KIEM SOAT tuyet doi ve data va privacy
- Code cua ban KHONG BAO GIO roi khoi may cua ban
- Moi dollar chi cho LLM duoc toi uu hoa boi chinh ban
- Khong phu thuoc vendor — ban OWN moi thu

### Muc tieu cuoi cung
Mot AI assistant ma:
1. Biet moi thu ve moi du an cua ban (code, architecture, patterns, decisions)
2. Hoc tu cach ban lam viec (accept/reject/edit patterns, coding style, preferences)
3. Tu cai thien qua moi phien lam viec (DSPy prompt optimization, learned reranking)
4. Co moi ky nang ban can (browser automation, code execution, Jira, GitHub, Slack)
5. Tiet kiem token toi da (model routing, caching, compression)
6. Hoat dong offline khi can (local models via Ollama/MLX)

---

## 2. Nguyen Tac Kien Truc (Architecture Principles)

| # | Nguyen Tac | Mo Ta |
|---|-----------|-------|
| 1 | **Behavior-First** | Moi quyet dinh dua tren hanh vi thuc te cua user, KHONG dua tren heuristics hay gia dinh |
| 2 | **Skill-Based** | Moi capability la 1 skill doc lap, co the load/unload, co interface chung |
| 3 | **Self-Improving** | He thong tu toi uu prompts (DSPy), retrieval (learned reranker), ranking theo thoi gian |
| 4 | **Memory-Native** | Bo nho da tang Letta/MemGPT: Core (luon trong context) + Archival (long-term) + Recall (conversations) |
| 5 | **Cost-Conscious** | Model routing (re cho de, dat cho kho), semantic caching, LLMLingua compression |
| 6 | **Privacy-First** | Moi data o local. Raw code KHONG BAO GIO gui len cloud. Chi gui compressed context toi LLM proxy |
| 7 | **Composable** | Skills co the goi nhau. RAG skill goi Memory skill goi Embedding skill |
| 8 | **Observable** | Moi action duoc log. Cost tracking per query. Behavioral metrics dashboard |

---

## 3. Ban Do Ky Nang AI (AI Skill Map)

### 3.1 Advanced RAG Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **GraphRAG** | Knowledge graph + vector search, multi-hop reasoning qua code | Microsoft GraphRAG (github.com/microsoft/graphrag) | P0 |
| **Self-RAG** | Tu danh gia chat luong retrieval, tu sua neu kem | Paper: Self-RAG (arxiv 2310.11511) | P1 |
| **Corrective RAG** | Phat hien retrieval kem -> tu search lai voi query moi | Paper: CRAG (arxiv 2401.15884) | P1 |
| **Adaptive RAG** | Tu chon strategy: no-retrieval / single-hop / multi-hop | Paper: Adaptive RAG (arxiv 2403.14403) | P1 |
| **RAG Fusion** | Tao 3-5 query variants -> search rieng -> merge bang Reciprocal Rank Fusion | LangChain RAG Fusion | P0 |
| **HyDE** | Tao hypothetical document tu query -> dung no de search (tot hon query goc) | Paper: HyDE (arxiv 2212.10496) | P1 |
| **Contextual Retrieval** | Them context (file path, function name, module) vao moi chunk truoc khi embed | Anthropic blog (Nov 2024) | P0 |
| **Parent-Child Chunking** | Search chunk nho (chi tiet) nhung tra ve chunk cha (nhieu context hon) | LlamaIndex | P1 |

### 3.2 Self-Learning Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **DSPy Optimization** | Tu toi uu prompts dua tren metrics (accuracy, user satisfaction) | DSPy (dspy.ai) - Stanford | P0 |
| **Behavioral Analytics** | Thu thap implicit feedback: accept/reject/edit/time-to-action | Custom implementation | P0 |
| **Learned Reranking** | Cai thien search ranking dua tren user interactions thuc te | Cross-encoder + feedback data | P1 |
| **Preference Learning** | Hoc coding style, naming conventions, architecture preferences | Custom behavioral embeddings | P1 |
| **Active Learning** | Hoi dung cau hoi de cai thien nhanh hon (khong hoi nhieu) | Custom | P2 |
| **RLAIF** | Reinforcement Learning from AI Feedback - AI tu critique chinh minh | Paper: RLAIF (Google 2023) | P2 |

### 3.3 Memory Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **Tiered Memory** | Core + Archival + Recall (Letta/MemGPT inspired) | Letta (github.com/letta-ai/letta) | P0 |
| **Nano-Brain** | Persistent memory across sessions (da tich hop, can nang cap) | nano-brain | P0 |
| **Cross-Session Learning** | Agent nho va cai thien qua moi session, khong bat dau tu dau | Custom + Letta patterns | P0 |
| **Memory Compaction** | Tu tom tat va nen memory cu khi qua lon | Custom summary chains | P1 |
| **Memory Decay** | Tu quen thong tin outdated (TTL + relevance scoring) | Custom | P2 |

### 3.4 Efficiency Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **LLMLingua** | Nen context 3-6x truoc khi gui toi LLM, giu nguyen y nghia | LLMLingua-2 (github.com/microsoft/LLMLingua) | P0 |
| **Semantic Caching** | Cache similar queries, tranh goi LLM trung lap | GPTCache hoac custom (embedding similarity) | P0 |
| **Model Routing** | Query de -> model re (GPT-4o-mini), query kho -> model dat (Claude Opus) | Custom complexity classifier | P0 |
| **Prompt Caching** | Tai su dung cached prefix (system prompt + project context) | Proxy-level implementation | P1 |
| **Adaptive Token Budget** | Phan bo nhieu tokens cho complex queries, it cho simple | Custom | P1 |
| **ChunkKV** | Nen KV cache theo semantic chunks, giam memory 70% | Paper: ChunkKV (NeurIPS 2025) | P2 |

### 3.5 Agent/Tool Skills (MCP-Based)

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **MCP Protocol Core** | Universal standard de ket noi AI voi external tools | Anthropic MCP (modelcontextprotocol.io) | P0 |
| **Playwright** | Browser automation: test, scrape, verify, screenshot | Playwright MCP server | P1 |
| **GitHub** | Repo operations, PR review, issue management, code search | GitHub MCP server | P0 |
| **Jira** | Ticket management, auto-estimation, sprint tracking | Jira MCP (da bat dau) | P1 |
| **Confluence** | Documentation sync, auto-generate docs | Confluence MCP (da bat dau) | P1 |
| **Slack** | Team communication, notifications, Q&A bot | Slack MCP | P2 |
| **Code Execution** | Sandbox chay code an toan (Docker/E2B) | E2B (e2b.dev) hoac custom Docker | P1 |
| **Sequential Thinking** | Structured multi-step reasoning voi backtracking | Custom MCP tool | P0 |
| **File System** | Advanced file operations, search, watch | Built-in | P0 |

### 3.6 Reasoning Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **ReAct** | Reasoning + Acting loop: suy nghi -> hanh dong -> quan sat -> lap lai | LangChain/LangGraph ReAct | P0 |
| **Plan-and-Execute** | Tao plan truoc -> execute tung buoc -> validate | LangGraph | P1 |
| **Reflexion** | Sau khi thuc hien, tu review va sua loi neu can | Paper: Reflexion (arxiv 2303.11366) | P1 |
| **LATS** | Language Agent Tree Search: kham pha nhieu paths, chon tot nhat | Paper: LATS (arxiv 2310.04406) | P2 |
| **Chain of Thought** | Suy nghi tung buoc truoc khi tra loi | Built-in prompting | P0 |
| **Tree of Thoughts** | Branching reasoning cho van de phuc tap | Paper: ToT (arxiv 2305.10601) | P2 |

### 3.7 Code Intelligence Skills

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **Tree-sitter AST** | Parse AST cho 40+ ngon ngu, extract functions/classes/imports | web-tree-sitter (da tich hop) | P0 |
| **AST-grep** | Pattern matching tren toan bo codebase theo AST | ast-grep (ast-grep.github.io) | P0 |
| **LSP Integration** | Go-to-definition, find references, diagnostics, rename | Language Server Protocol | P1 |
| **Dependency Graph** | Map dependencies, detect circular deps, identify hub files | Custom + Tree-sitter | P1 |
| **Architecture Inference** | Tu dong nhan dien patterns (MVC, CQRS, Microservices...) | Custom (da co architecture-analyzer.ts) | P0 |
| **Tech Debt Scoring** | Luong hoa technical debt theo file/module/project | Custom metrics | P2 |

### 3.8 Fine-tuning & Local AI

| Skill | Mo Ta | Thu Vien | Priority |
|-------|-------|---------|----------|
| **Embedding Fine-tuning** | Train custom embeddings tren codebase cua ban | sentence-transformers + custom data | P1 |
| **LoRA Personalization** | Lightweight fine-tune local model theo style cua ban | Unsloth (github.com/unslothai/unsloth) | P2 |
| **Synthetic Data Gen** | Tao Q&A pairs tu codebase de train/evaluate | Custom pipeline | P1 |
| **DPO** | Direct Preference Optimization - don gian hon RLHF | TRL library (Hugging Face) | P2 |
| **Local Model Serving** | Chay model offline qua Ollama/llama.cpp/MLX | Ollama (ollama.ai) | P1 |

---

## 4. So Sanh Voi Doi Thu (Competitive Analysis)

| Feature | Cortex v2 | Cursor | Windsurf | Codex (OpenAI) | Cody (Sourcegraph) | Continue.dev |
|---------|-----------|--------|----------|----------------|---------------------|--------------|
| **Self-learning (DSPy)** | YES | No | No | No | No | No |
| **Behavior analysis** | YES | No | Partial | No | No | No |
| **Memory persistence (Letta)** | YES | No | No | No | No | No |
| **GraphRAG** | YES | No | No | No | Partial (code graph) | No |
| **Token efficiency (LLMLingua)** | YES | Unknown | Unknown | No | No | No |
| **Model routing** | YES | Partial | Partial | No (GPT only) | Partial | Yes |
| **MCP skills** | YES | Yes | Yes | No | No | Yes |
| **Privacy (local-first)** | YES | Cloud | Cloud | Cloud | Cloud | Yes |
| **Cost control** | YES | $20/mo fixed | $15/mo | Pay-per-use | $9/mo | Free |
| **Offline mode** | YES (Ollama) | No | No | No | No | Yes (partial) |
| **Custom skills/plugins** | YES | Partial | No | No | No | Yes |
| **Code execution sandbox** | YES | Yes | Yes | Yes | No | No |
| **Prompt self-optimization** | YES | No | No | No | No | No |

**Diem khac biet cot loi cua Cortex v2:**
1. **Self-learning** - KHONG tool nao tu cai thien prompts dua tren hanh vi user
2. **Memory persistence** - KHONG tool nao nho va hoc qua nhieu sessions (tru Letta Code moi)
3. **Behavior-first** - KHONG tool nao phan tich hanh vi de personalize
4. **Full ownership** - Ban OWN moi thu, khong phu thuoc subscription
5. **Cost transparency** - Ban biet chinh xac moi query ton bao nhieu

---

## 5. Kien Truc Tong Quan (High-Level Architecture)

```
+------------------------------------------------------------------+
|                        ELECTRON RENDERER                          |
|  +------------------+  +---------------+  +-------------------+  |
|  | Chat Interface   |  | Skill Manager |  | Memory Dashboard  |  |
|  | (React + Zustand) |  | (React)       |  | (React)           |  |
|  +------------------+  +---------------+  +-------------------+  |
|  +------------------+  +---------------+  +-------------------+  |
|  | Brain Dashboard   |  | Cost Tracker  |  | Settings Panel    |  |
|  +------------------+  +---------------+  +-------------------+  |
+----------------------------IPC Bridge-----------------------------+
|                        ELECTRON MAIN                              |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |                     SKILL ROUTER                            |  |
|  |  Classify intent -> Route to best skill(s) -> Orchestrate  |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |                     SKILL REGISTRY                          |  |
|  | +----------+ +----------+ +--------+ +--------+ +--------+ |  |
|  | |RAG Skills| |Memory    | |Agent   | |Code    | |Learning| |  |
|  | |GraphRAG  | |Core Mem  | |ReAct   | |TreeSit | |DSPy    | |  |
|  | |Self-RAG  | |Archival  | |PlanExec| |AST-grep| |Behavior| |  |
|  | |CRAG      | |Recall    | |Reflex  | |LSP     | |Rerank  | |  |
|  | |Fusion    | |Compact   | |LATS    | |DepGraph| |Prefs   | |  |
|  | +----------+ +----------+ +--------+ +--------+ +--------+ |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |                  EFFICIENCY ENGINE                          |  |
|  | +----------+ +----------+ +----------+ +----------+        |  |
|  | |LLMLingua | |Semantic  | |Model     | |Cost      |        |  |
|  | |Compress  | |Cache     | |Router    | |Tracker   |        |  |
|  | +----------+ +----------+ +----------+ +----------+        |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |                     BRAIN ENGINE                            |  |
|  | +----------+ +----------+ +----------+ +----------+        |  |
|  | |Embedder  | |ChromaDB  | |Graph DB  | |SQLite    |        |  |
|  | |(voyage/  | |(vectors) | |(entities)| |(metadata)|        |  |
|  | | custom)  | |          | |          | |          |        |  |
|  | +----------+ +----------+ +----------+ +----------+        |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |                     MCP LAYER (External Tools)              |  |
|  | +------+ +------+ +------+ +------+ +------+ +----------+ |  |
|  | |GitHub| |Jira  | |Confl | |Slack | |Play  | |Code Exec | |  |
|  | |      | |      | |uence | |      | |wright| |Sandbox   | |  |
|  | +------+ +------+ +------+ +------+ +------+ +----------+ |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### Data Flow: User Query -> Response

```
User types question
       |
       v
[1. IPC: chat:send] --> Electron Main Process
       |
       v
[2. Efficiency: Check Semantic Cache]
       |-- Cache HIT --> Return cached response
       |-- Cache MISS --> Continue
       |
       v
[3. Skill Router: Classify Intent]
       |-- Code question --> RAG Skills
       |-- Action request --> Agent Skills (ReAct)
       |-- Memory query --> Memory Skills
       |-- Tool use --> MCP Skills
       |
       v
[4. Memory: Load relevant context]
       |-- Core Memory (always loaded, ~2000 tokens)
       |-- Archival Memory (search relevant memories)
       |-- Recall Memory (recent conversation)
       |
       v
[5. RAG Pipeline: Retrieve relevant code]
       |-- Query Analyzer --> chon strategy
       |-- Execute strategy (GraphRAG/Fusion/Self-RAG/...)
       |-- Rerank results (learned reranker)
       |
       v
[6. Efficiency: Compress Context]
       |-- LLMLingua compress retrieved chunks
       |-- Model Router: chon model phu hop
       |-- Adaptive Token Budget: phan bo tokens
       |
       v
[7. LLM Call via Proxy]
       |-- Stream response back to renderer
       |
       v
[8. Post-processing]
       |-- Parse citations, confidence score
       |-- Update Recall Memory
       |-- Log behavioral event (cho self-learning)
       |-- Update cost tracker
       |
       v
[9. Self-Learning (async, background)]
       |-- Collect implicit feedback sau 30s
       |-- Update behavioral analytics
       |-- Periodically run DSPy optimization
```

---

## 6. Lo Trinh (Roadmap Overview)

| Sprint | Ten | Thoi Gian | Muc Tieu Chinh | Dependencies |
|--------|-----|-----------|----------------|--------------|
| **13** | Memory Architecture | Tuan 1-2 | He thong bo nho da tang Letta-inspired thay the nano-brain | None |
| **14** | Skill Registry + MCP | Tuan 3-4 | Skill system pluggable + MCP integration + wrap existing services | Sprint 13 |
| **15** | Advanced RAG Pipeline | Tuan 5-6 | GraphRAG + Self-RAG + CRAG + RAG Fusion + Contextual Retrieval | Sprint 14 |
| **16** | Self-Learning Pipeline | Tuan 7-8 | DSPy optimization + Behavioral Analytics + Feedback loops | Sprint 14, 15 |
| **17** | Efficiency Engine | Tuan 9-10 | LLMLingua + Semantic Cache + Model Routing + Cost Tracking | Sprint 14 |
| **18** | Agent Mode | Tuan 11-12 | Code execution + Playwright + ReAct + Plan-and-Execute | Sprint 14, 15 |

### Sprint Dependency Graph
```
Sprint 13 (Memory)
    |
    v
Sprint 14 (Skills + MCP)
    |
    +--------+--------+--------+
    |        |        |        |
    v        v        v        v
Sprint 15  Sprint 16  Sprint 17  Sprint 18
(RAG)      (Learn)    (Efficiency) (Agent)
```

### Success Metrics Per Sprint

| Sprint | Metric | Target |
|--------|--------|--------|
| 13 | Memory read/write latency | < 50ms |
| 13 | Memory search accuracy | > 85% recall |
| 14 | Skills loaded successfully | >= 10 built-in skills |
| 14 | MCP server connection time | < 2s |
| 15 | RAG answer relevance (manual eval) | > 80% relevant |
| 15 | Multi-hop query success rate | > 60% |
| 16 | Prompt quality improvement via DSPy | > 15% vs baseline |
| 16 | Behavioral events captured per session | > 20 events |
| 17 | Token reduction via LLMLingua | > 40% reduction |
| 17 | Cache hit rate | > 25% |
| 17 | Cost per query reduction | > 30% vs v1.0 |
| 18 | Multi-step task completion rate | > 70% |
| 18 | Code execution success rate | > 80% |

---

## 7. Rui Ro va Giai Phap (Risks & Mitigations)

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| 1 | **Performance suy giam** khi load nhieu skills cung luc | High | Medium | Lazy loading, skill priority queue, parallel execution limit |
| 2 | **ChromaDB khong scale** khi brain qua lon (>100K chunks) | High | Medium | Migration plan sang Qdrant/Milvus, hoac sharding strategy |
| 3 | **Token cost bung no** khi dung GraphRAG + multi-step agent | High | High | Model routing (P0), LLMLingua (P0), budget cap per query |
| 4 | **Complexity qua lon** cho solo developer | High | High | Strict sprint scope, P0 first, P2 defer. Moi sprint la independent |
| 5 | **DSPy optimization khong hieu qua** voi it data | Medium | Medium | Thu thap du 100+ data points truoc khi chay optimizer |
| 6 | **Graph DB performance** khi knowledge graph lon | Medium | Low | SQLite graph tables voi indexes, lazy graph building |
| 7 | **MCP server instability** tu third-party | Medium | Medium | Timeout + fallback, health check per server, graceful degradation |
| 8 | **Prompt injection** qua memory system | High | Low | Memory sanitization, input validation, audit trail (da co) |

---

## 8. Metrics Thanh Cong (Success Metrics)

### KPIs cho Cortex v2.0

| Category | Metric | How to Measure | Target |
|----------|--------|----------------|--------|
| **Quality** | Response relevance | DSPy evaluation metric + manual spot-check | > 80% |
| **Quality** | Citation accuracy | % citations dung file/line | > 90% |
| **Efficiency** | Tokens saved per query | (original - compressed) / original | > 40% |
| **Efficiency** | Cache hit rate | Semantic cache hits / total queries | > 25% |
| **Efficiency** | Cost per query (avg) | Total LLM cost / total queries | < $0.02 |
| **Learning** | DSPy improvement rate | % improvement sau moi optimization cycle | > 10% per cycle |
| **Learning** | Behavioral events/session | Events captured per chat session | > 20 |
| **Learning** | Accept rate trend | % suggestions accepted, trending up | +5% per month |
| **Memory** | Memory recall accuracy | % relevant memories retrieved | > 85% |
| **Memory** | Cross-session context preservation | User reports context maintained | Qualitative |
| **Speed** | Query latency (P50) | Time from send to first token | < 2s |
| **Speed** | Query latency (P95) | Time from send to first token | < 5s |
| **Reliability** | Skill health check pass rate | % skills passing health check | > 95% |
| **Reliability** | Crash rate | Crashes per 100 sessions | < 1 |

---

## 9. Ket Luan

Cortex v2.0 la buoc ngoat tu mot chatbot hieu code thanh mot **AI engineering platform ca nhan hoa**.

**Khong canh tranh tren san cua Cursor/Copilot** - ho lam code completion tot roi.
Cortex lam dieu KHONG AI lam:

1. **Tu hoc tu hanh vi** - DSPy + behavioral analytics = genuine personalization
2. **Nho moi thu** - Letta-inspired memory = agent ngay cang thong minh hon
3. **Pluggable skills** - MCP + custom skills = bat ky capability nao ban can
4. **Cost transparency** - Ban biet chinh xac moi query ton bao nhieu
5. **Full ownership** - Ban OWN moi thu, khong phu thuoc ai

**Bat dau tu Sprint 13. Moi sprint la 2 tuan. 12 tuan se co Cortex v2.0.**

---

*Document nay se duoc cap nhat khi co thay doi chien luoc.*
*Xem chi tiet tai: CORTEX_V2_SKILL_CATALOG.md, CORTEX_V2_SPRINT_PLAN.md, CORTEX_V2_ARCHITECTURE.md*
