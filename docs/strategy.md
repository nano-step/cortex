# CORTEX v2.0 — STRATEGIC VISION
## Personalized AI Brain for Software Engineers

**Created:** 03/03/2026
**Version:** v2.0 Strategic Reset
**Author:** Cortex Team

---

## 1. Vision

Cortex v2.0 is NOT a SaaS product. NOT a tool built for someone else.

This is a **personal weapon** — an AI engineering platform that:
- **Learns** from your behavior, not from generic assumptions
- **Self-improves** prompts, retrieval, and ranking over time
- **Pluggable Skills** — modular architecture, easy to add/remove capabilities
- **Fully replaces** Cursor/Windsurf/Codex with a system YOU own and control
- **Understands YOU** — not just your code, but HOW you code, what you LIKE, what you NEED

### Why not SaaS?
- You need absolute control over data and privacy
- Your code NEVER leaves your machine
- Every dollar spent on LLM is optimized by you
- No vendor lock-in — you OWN everything

### Ultimate Goal
An AI assistant that:
1. Knows everything about every one of your projects (code, architecture, patterns, decisions)
2. Learns from how you work (accept/reject/edit patterns, coding style, preferences)
3. Self-improves every session (DSPy prompt optimization, learned reranking)
4. Has every skill you need (browser automation, code execution, Jira, GitHub, Slack)
5. Minimizes token usage (model routing, caching, compression)
6. Works offline when needed (local models via Ollama/MLX)

---

## 2. Architecture Principles

| # | Principle | Description |
|---|-----------|-------------|
| 1 | **Behavior-First** | Every decision is based on actual user behavior, NOT on heuristics or assumptions |
| 2 | **Skill-Based** | Every capability is an independent skill that can be loaded/unloaded with a common interface |
| 3 | **Self-Improving** | System auto-optimizes prompts (DSPy), retrieval (learned reranker), and ranking over time |
| 4 | **Memory-Native** | Multi-tier Letta/MemGPT memory: Core (always in context) + Archival (long-term) + Recall (conversations) |
| 5 | **Cost-Conscious** | Model routing (cheap for easy, expensive for hard), semantic caching, LLMLingua compression |
| 6 | **Privacy-First** | All data stays local. Raw code NEVER sent to the cloud. Only compressed context is sent to the LLM proxy |
| 7 | **Composable** | Skills can call each other. RAG skill calls Memory skill calls Embedding skill |
| 8 | **Observable** | Every action is logged. Cost tracking per query. Behavioral metrics dashboard |

---

## 3. AI Skill Map

### 3.1 Advanced RAG Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **GraphRAG** | Knowledge graph + vector search, multi-hop reasoning over code | Microsoft GraphRAG (github.com/microsoft/graphrag) | P0 |
| **Self-RAG** | Self-evaluates retrieval quality and self-corrects when poor | Paper: Self-RAG (arxiv 2310.11511) | P1 |
| **Corrective RAG** | Detects poor retrieval → re-searches with a refined query | Paper: CRAG (arxiv 2401.15884) | P1 |
| **Adaptive RAG** | Auto-selects strategy: no-retrieval / single-hop / multi-hop | Paper: Adaptive RAG (arxiv 2403.14403) | P1 |
| **RAG Fusion** | Generates 3–5 query variants → searches separately → merges via Reciprocal Rank Fusion | LangChain RAG Fusion | P0 |
| **HyDE** | Generates a hypothetical document from the query → uses it for search (better than raw query) | Paper: HyDE (arxiv 2212.10496) | P1 |
| **Contextual Retrieval** | Adds context (file path, function name, module) to each chunk before embedding | Anthropic blog (Nov 2024) | P0 |
| **Parent-Child Chunking** | Searches small child chunks (precise) but returns parent chunks (more context) | LlamaIndex | P1 |

### 3.2 Self-Learning Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **DSPy Optimization** | Auto-optimizes prompts based on metrics (accuracy, user satisfaction) | DSPy (dspy.ai) - Stanford | P0 |
| **Behavioral Analytics** | Collects implicit feedback: accept/reject/edit/time-to-action | Custom implementation | P0 |
| **Learned Reranking** | Improves search ranking based on actual user interactions | Cross-encoder + feedback data | P1 |
| **Preference Learning** | Learns coding style, naming conventions, architecture preferences | Custom behavioral embeddings | P1 |
| **Active Learning** | Asks the right questions to improve faster (without over-asking) | Custom | P2 |
| **RLAIF** | Reinforcement Learning from AI Feedback — AI critiques itself | Paper: RLAIF (Google 2023) | P2 |

### 3.3 Memory Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **Tiered Memory** | Core + Archival + Recall (Letta/MemGPT inspired) | Letta (github.com/letta-ai/letta) | P0 |
| **Nano-Brain** | Persistent memory across sessions (integrated, needs upgrade) | nano-brain | P0 |
| **Cross-Session Learning** | Agent remembers and improves across sessions, never starting from scratch | Custom + Letta patterns | P0 |
| **Memory Compaction** | Auto-summarizes and compacts old memory when too large | Custom summary chains | P1 |
| **Memory Decay** | Automatically forgets outdated information (TTL + relevance scoring) | Custom | P2 |

### 3.4 Efficiency Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **LLMLingua** | Compresses context 3–6x before sending to LLM, preserving meaning | LLMLingua-2 (github.com/microsoft/LLMLingua) | P0 |
| **Semantic Caching** | Caches similar queries to avoid redundant LLM calls | GPTCache or custom (embedding similarity) | P0 |
| **Model Routing** | Easy query → cheap model (GPT-4o-mini), hard query → expensive model (Claude Opus) | Custom complexity classifier | P0 |
| **Prompt Caching** | Reuses cached prefix (system prompt + project context) | Proxy-level implementation | P1 |
| **Adaptive Token Budget** | Allocates more tokens to complex queries, fewer to simple ones | Custom | P1 |
| **ChunkKV** | Compresses KV cache by semantic chunks, reducing memory by 70% | Paper: ChunkKV (NeurIPS 2025) | P2 |

### 3.5 Agent/Tool Skills (MCP-Based)

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **MCP Protocol Core** | Universal standard for connecting AI to external tools | Anthropic MCP (modelcontextprotocol.io) | P0 |
| **Playwright** | Browser automation: test, scrape, verify, screenshot | Playwright MCP server | P1 |
| **GitHub** | Repo operations, PR review, issue management, code search | GitHub MCP server | P0 |
| **Jira** | Ticket management, auto-estimation, sprint tracking | Jira MCP (started) | P1 |
| **Confluence** | Documentation sync, auto-generate docs | Confluence MCP (started) | P1 |
| **Slack** | Team communication, notifications, Q&A bot | Slack MCP | P2 |
| **Code Execution** | Safe sandboxed code execution (Docker/E2B) | E2B (e2b.dev) or custom Docker | P1 |
| **Sequential Thinking** | Structured multi-step reasoning with backtracking | Custom MCP tool | P0 |
| **File System** | Advanced file operations, search, watch | Built-in | P0 |

### 3.6 Reasoning Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **ReAct** | Reasoning + Acting loop: think → act → observe → repeat | LangChain/LangGraph ReAct | P0 |
| **Plan-and-Execute** | Creates a plan first → executes step by step → validates | LangGraph | P1 |
| **Reflexion** | After executing, self-reviews and corrects errors if needed | Paper: Reflexion (arxiv 2303.11366) | P1 |
| **LATS** | Language Agent Tree Search: explores multiple paths, picks the best | Paper: LATS (arxiv 2310.04406) | P2 |
| **Chain of Thought** | Thinks step by step before answering | Built-in prompting | P0 |
| **Tree of Thoughts** | Branching reasoning for complex problems | Paper: ToT (arxiv 2305.10601) | P2 |

### 3.7 Code Intelligence Skills

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **Tree-sitter AST** | Parses AST for 40+ languages, extracts functions/classes/imports | web-tree-sitter (integrated) | P0 |
| **AST-grep** | Pattern matching across the entire codebase via AST | ast-grep (ast-grep.github.io) | P0 |
| **LSP Integration** | Go-to-definition, find references, diagnostics, rename | Language Server Protocol | P1 |
| **Dependency Graph** | Maps dependencies, detects circular deps, identifies hub files | Custom + Tree-sitter | P1 |
| **Architecture Inference** | Auto-detects patterns (MVC, CQRS, Microservices...) | Custom (architecture-analyzer.ts exists) | P0 |
| **Tech Debt Scoring** | Quantifies technical debt per file/module/project | Custom metrics | P2 |

### 3.8 Fine-tuning & Local AI

| Skill | Description | Library | Priority |
|-------|-------------|---------|----------|
| **Embedding Fine-tuning** | Trains custom embeddings on your codebase | sentence-transformers + custom data | P1 |
| **LoRA Personalization** | Lightweight fine-tuning of a local model to your coding style | Unsloth (github.com/unslothai/unsloth) | P2 |
| **Synthetic Data Gen** | Generates Q&A pairs from the codebase for training/evaluation | Custom pipeline | P1 |
| **DPO** | Direct Preference Optimization — simpler than RLHF | TRL library (Hugging Face) | P2 |
| **Local Model Serving** | Runs models offline via Ollama/llama.cpp/MLX | Ollama (ollama.ai) | P1 |

---

## 4. Competitive Analysis

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

**Core differentiators of Cortex v2:**
1. **Self-learning** — No other tool auto-improves prompts based on user behavior
2. **Memory persistence** — No other tool remembers and learns across multiple sessions (except the new Letta Code)
3. **Behavior-first** — No other tool analyzes behavior for personalization
4. **Full ownership** — You OWN everything, no subscription dependency
5. **Cost transparency** — You know exactly how much each query costs

---

## 5. High-Level Architecture

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

### Data Flow: User Query → Response

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
       |-- Query Analyzer --> select strategy
       |-- Execute strategy (GraphRAG/Fusion/Self-RAG/...)
       |-- Rerank results (learned reranker)
       |
       v
[6. Efficiency: Compress Context]
       |-- LLMLingua compress retrieved chunks
       |-- Model Router: select appropriate model
       |-- Adaptive Token Budget: allocate tokens
       |
       v
[7. LLM Call via Proxy]
       |-- Stream response back to renderer
       |
       v
[8. Post-processing]
       |-- Parse citations, confidence score
       |-- Update Recall Memory
       |-- Log behavioral event (for self-learning)
       |-- Update cost tracker
       |
       v
[9. Self-Learning (async, background)]
       |-- Collect implicit feedback after 30s
       |-- Update behavioral analytics
       |-- Periodically run DSPy optimization
```

---

## 6. Roadmap Overview

| Sprint | Name | Timeline | Primary Goal | Dependencies |
|--------|------|----------|--------------|--------------|
| **13** | Memory Architecture | Week 1–2 | Letta-inspired multi-tier memory system replacing nano-brain | None |
| **14** | Skill Registry + MCP | Week 3–4 | Pluggable skill system + MCP integration + wrap existing services | Sprint 13 |
| **15** | Advanced RAG Pipeline | Week 5–6 | GraphRAG + Self-RAG + CRAG + RAG Fusion + Contextual Retrieval | Sprint 14 |
| **16** | Self-Learning Pipeline | Week 7–8 | DSPy optimization + Behavioral Analytics + Feedback loops | Sprint 14, 15 |
| **17** | Efficiency Engine | Week 9–10 | LLMLingua + Semantic Cache + Model Routing + Cost Tracking | Sprint 14 |
| **18** | Agent Mode | Week 11–12 | Code execution + Playwright + ReAct + Plan-and-Execute | Sprint 14, 15 |

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

## 7. Risks & Mitigations

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| 1 | **Performance degradation** when loading many skills simultaneously | High | Medium | Lazy loading, skill priority queue, parallel execution limit |
| 2 | **ChromaDB won't scale** when brain is very large (>100K chunks) | High | Medium | Migration plan to Qdrant/Milvus or sharding strategy |
| 3 | **Token cost explosion** when using GraphRAG + multi-step agent | High | High | Model routing (P0), LLMLingua (P0), budget cap per query |
| 4 | **Complexity too high** for a solo developer | High | High | Strict sprint scope, P0 first, P2 deferred. Each sprint is independent |
| 5 | **DSPy optimization ineffective** with too little data | Medium | Medium | Collect 100+ data points before running the optimizer |
| 6 | **Graph DB performance** when knowledge graph is large | Medium | Low | SQLite graph tables with indexes, lazy graph building |
| 7 | **MCP server instability** from third-party providers | Medium | Medium | Timeout + fallback, health check per server, graceful degradation |
| 8 | **Prompt injection** via memory system | High | Low | Memory sanitization, input validation, audit trail (already in place) |

---

## 8. Success Metrics

### KPIs for Cortex v2.0

| Category | Metric | How to Measure | Target |
|----------|--------|----------------|--------|
| **Quality** | Response relevance | DSPy evaluation metric + manual spot-check | > 80% |
| **Quality** | Citation accuracy | % citations pointing to correct file/line | > 90% |
| **Efficiency** | Tokens saved per query | (original - compressed) / original | > 40% |
| **Efficiency** | Cache hit rate | Semantic cache hits / total queries | > 25% |
| **Efficiency** | Cost per query (avg) | Total LLM cost / total queries | < $0.02 |
| **Learning** | DSPy improvement rate | % improvement per optimization cycle | > 10% per cycle |
| **Learning** | Behavioral events/session | Events captured per chat session | > 20 |
| **Learning** | Accept rate trend | % suggestions accepted, trending upward | +5% per month |
| **Memory** | Memory recall accuracy | % relevant memories retrieved | > 85% |
| **Memory** | Cross-session context preservation | User reports context maintained | Qualitative |
| **Speed** | Query latency (P50) | Time from send to first token | < 2s |
| **Speed** | Query latency (P95) | Time from send to first token | < 5s |
| **Reliability** | Skill health check pass rate | % skills passing health check | > 95% |
| **Reliability** | Crash rate | Crashes per 100 sessions | < 1 |

---

## 9. Conclusion

Cortex v2.0 is the turning point from a code-aware chatbot into a **personalized AI engineering platform**.

**Not competing on Cursor/Copilot's turf** — they already do code completion well.
Cortex does what NO ONE else does:

1. **Learns from behavior** — DSPy + behavioral analytics = genuine personalization
2. **Remembers everything** — Letta-inspired memory = agent that gets smarter over time
3. **Pluggable skills** — MCP + custom skills = any capability you need
4. **Cost transparency** — you know exactly how much each query costs
5. **Full ownership** — you OWN everything, dependent on no one

**Starting from Sprint 13. Each sprint is 2 weeks. 12 weeks to Cortex v2.0.**

---

*This document will be updated as strategy evolves.*
*See details at: SKILL_CATALOG.md, SPRINT_PLAN.md, ARCHITECTURE.md*
