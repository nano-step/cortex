<div align="center">

# Cortex

**The AI Brain That Knows Your Codebase**

[![Version](https://img.shields.io/badge/version-4.4.0%20Thalamus-orange.svg)](https://github.com/hoainho/cortex/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/hoainho/cortex/releases)
[![Built With](https://img.shields.io/badge/built%20with-Electron%20%2B%20React%20%2B%20TypeScript-61DAFB.svg)](#tech-stack)

A desktop AI assistant that deeply understands your entire codebase — not a ChatGPT wrapper, but a full engineering intelligence platform with persistent memory, multi-agent orchestration, and self-learning.

[⬇️ Download for Mac](https://github.com/hoainho/cortex/releases) · [📖 Setup Guide](docs/SETUP_GUIDE.md) · [📋 Changelog](CHANGELOG.md) · [🏗️ Architecture](ARCHITECTURE.md) · [📦 Skill Catalog](SKILL_CATALOG.md)

**What's new in v4.4.0 "Thalamus":**
Full-Stack Activation — 80% → >60% queries now use multi-agent orchestration · Smart category-based pipeline routing · Loop auto-activation (Ralph/Ultrawork) · Proactive background agents · Training feedback loop closed · OMO infrastructure fully wired

</div>

---

## Cortex Is NOT a ChatGPT Wrapper

Most "AI coding tools" are thin wrappers: paste code → send to API → show response. Cortex is fundamentally different:

| What wrappers do | What Cortex does |
|---|---|
| Send your question to an LLM | **Classify intent** → route to specialized agents → orchestrate tools → verify response |
| Give generic code suggestions | **Search YOUR codebase** for patterns → detect YOUR conventions → generate code that matches YOUR style |
| Forget everything between sessions | **Remember** your preferences, past decisions, and coding style across sessions |
| One model, one response | **12 agents** with different strategies, multiple models, parallel execution |
| No context beyond pasted code | **Index your entire repo** — AST parsing, dependency graphs, vector embeddings, git history |

**The difference shows in practice** (v4.3.0 Synapse — Document Intelligence + Core Policies):

```
// ChatGPT wrapper response to "How to add pagination?":
→ Generic Express.js pagination tutorial code

// Cortex response (same question):
→ Found existing pagination in src/controllers/ProductController.ts (L45-82)
→ Your project uses camelCase, TypeScript strict, ESLint configured
→ Here's code matching YOUR patterns, referencing YOUR files:
   [code that follows your project's exact conventions]
```

---

## The Cortex Brain — What Makes It Smart

### Layer 1: Understanding (Brain Engine)

When you add a project, Cortex doesn't just store files — it **understands** them:

```
Your Code → AST Parser → Code Chunks (functions, classes, types)
                ↓
         Voyage AI Embeddings (1024-dim vectors)
                ↓
         SQLite FTS + Qdrant Vector DB
                ↓
         Agentic RAG: decompose → search → boost → verify → confidence score
```

- **Voyage AI embeddings** — `voyage-3-large` with 1024 dimensions, token-throttled at 80K/min
- **Hybrid search** — Vector similarity (70%) + keyword FTS (30%) + cloud reranking
- **Agentic RAG** — Multi-step retrieval: decompose query → iterative search → relevance boost → gap detection
- **Qdrant** — Optional vector DB via Docker for faster search at scale

### Layer 2: Thinking (Pipeline Engine)

Every query goes through an **orchestrated pipeline**, not just "send to LLM":

```
User Query
    ↓
[Hook: before:chat] — sanitize, cost check, cache lookup
    ↓
[Smart Intent Classifier] — LLM-based, not keyword matching
    ↓                        Detects: needsToolUse, needsExternalInfo, hasUrl
[Pipeline Path Router]
    ├── orchestrate  → Multi-agent team (complex analysis)
    ├── skill_chain  → ReAct reasoning agent (step-by-step problems)
    ├── slash_command → Direct skill execution (/review, /security...)
    ├── perplexity   → Web search with real-time data
    └── standard     → RAG + LLM with tool calling
    ↓
[Tool Execution] — 25+ tools, parallel via Promise.all
    ↓
[Hook: after:chat] — validate response, save memory, audit log
```

### Layer 3: Tools (30+ Built-in)

Cortex doesn't just answer from knowledge — it **acts**:

| Tool Category | Tools | What They Do |
|---|---|---|
| **Code Advisor** | `code_advisor`, `find_similar_code`, `suggest_fix`, `explain_code_pattern` | TabNine-inspired: search codebase patterns → detect conventions → style-matched suggestions |
| **Project Analysis** | `git_contributors`, `git_log_search`, `grep_search`, `project_stats`, `search_config` | Answer questions RAG can't: team size, git history, exact config values |
| **Document Intelligence** | `read_document` | Read PDF, DOCX, XLSX, CSV, HTML at query time — 10MB limit, section-aware chunking |
| **Vision** | `analyze_image`, `compare_images` | FREE image analysis via OpenRouter (healer-alpha, hunter-alpha) |
| **Artist** | `generate_image`, `edit_image` | AI image generation with 8 style presets (anime, watercolor, pixel-art...) |
| **Web** | `perplexity_search`, `perplexity_read_url` | Real-time web search and URL reading |
| **File System** | `read_file`, `write_file`, `edit_file`, `read_files` (batch), `grep_search`, `edit_files` (batch), `list_directory`, `move_file`, `delete_file` | Full read/write/search — chunk reading (10MB), batch parallel I/O, progressive edit fallback, unrestricted mode |

### Layer 4: Memory (3-Tier Persistent)

Cortex **remembers** across sessions:

| Tier | What It Stores | How It's Used |
|---|---|---|
| **Core Memory** | Your preferences, coding style, project conventions | Always in context — shapes every response |
| **Archival Memory** | Past decisions, resolved bugs, architecture notes | Semantic search when relevant topics arise |
| **Recall Memory** | Conversation history with timestamps | Timeline navigation, follow-up context |

### Layer 5: Agents (12 Specialized)

Not one LLM call — a **team** of specialized agents:

| Agent | Role | When Activated |
|---|---|---|
| **Sisyphus** | Ultraworker — atomic task execution | Default for implementation tasks |
| **Hephaestus** | Deep Agent — root cause analysis with 4-phase debugging | Complex bugs, architecture issues |
| **Prometheus** | Strategic Planner — architecture proposals | Planning, design review |
| **Atlas** | Heavy Lifter — parallel multi-file operations | Large refactors, migrations |
| **Oracle** | Consultant — high-quality reasoning | Architecture decisions, hard problems |
| **Explore** | Contextual grep — codebase pattern finder | Background research |
| **Librarian** | Reference grep — external docs/examples | Documentation lookup |
| + 5 more | Security, Performance, Review, Writer, Formatter | Specialist analysis |

**Agent Pool resilience** — All agents run with exponential backoff (1s/2s/4s), Retry-After header support, dynamic model selection from proxy's live model list, and automatic tier fallback (`fast → balanced → premium`) when quota is exhausted.

### Layer 6: Self-Learning

Cortex gets **smarter the more you use it**:

```
Your interactions → Event Collector → Behavioral Analysis
    ↓
Feedback Detector (accepts, rejects, follow-ups, copy patterns)
    ↓
Learned Reranker → Adjusts search result weights
    ↓
Over time: results align with what YOU find useful
```

### Layer 7: Auto-Training — Dendrite Engine

Cortex now trains itself **24/7 without user interaction**:

```
App idle (2+ min)
    ↓
[Circuit Breaker Check] — 3 failures? Open 30 min. Budget exceeded? Pause until midnight.
    ↓
[AutoScan] Read codebase chunks in batches (20/batch)
    ↓
[AutoTraining] Generate Q&A pairs via LLM (Self-Instruct style)
    ├── 3 question types: factual / conceptual / relational
    ├── Evol-Instruct: 30% chance mutate to harder questions
    └── LLM-as-Judge (independent model): 4 criteria (1-5), accept if avg ≥ 4.0
    ↓
[AutoScan] Scan Jira issues → sprint/bug/team Q&A pairs
[AutoScan] Scan Confluence pages → technical/architecture Q&A pairs
[AutoScan] Scan Knowledge Crystals → insight Q&A pairs
    ↓
[Bias Prevention] ROUGE-1 diversity check (reject if >70% similar to existing)
    ↓
[Learning] Save accepted pairs → training_pairs + archival_memory
    ↓
5-second cooldown → restart loop (continuous 24/7)
```

**What it learns about your project:**
- Code patterns, architecture decisions, function relationships
- Sprint history, bug patterns, team workload (from Jira)
- Technical documentation, design decisions (from Confluence)
- Accumulated knowledge crystals from past conversations

**Circuit Breaker** — protects against runaway costs:
- 3 consecutive LLM failures → pause 30 min (half-open probe → resume if ok)
- Daily budget exceeded ($0.50 default) → pause until midnight reset
- Live status visible in AutoScan dashboard: state / daily cost / budget

**Bias Prevention** — keeps training data healthy:
- ROUGE-1 similarity check: rejects pairs too similar to existing (>70%)
- Independent judge model: generation model ≠ judge model
- Confidence decay: 10%/month for unconfirmed pairs
- Low-confidence pairs (< 0.3) archived automatically

**Logging** — all training activity visible in CLI console:
```
[AutoScan][25/03/2026 23:14:07]   [Code] Batch offset=8700 | 100 chunks
[AutoTraining][25/03/2026 23:14:09] LLM ok 2341ms | q-gen 10chunks
[AutoTraining][25/03/2026 23:14:11] [Code/factual] services/llm-client.ts | Q: "What does..."
[Learning][25/03/2026 23:14:14]   Luu pair | score=4.3 | "What does sanitizeTemperature do..."
[AutoScan][25/03/2026 23:14:35]   [Jira] 18 issues | bat dau phan tich sprint/bug/team...
[Circuit] OPEN — daily budget $0.51 exceeded $0.50
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Cortex Desktop                              │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    React Frontend (Renderer)                   │    │
│  │  Chat UI · Agent Panel · Memory Dashboard · Skill Manager     │    │
│  │  Cost Dashboard · Settings · Drag-Drop Upload                 │    │
│  └──────────────────────────┬───────────────────────────────────┘    │
│                             │ IPC Bridge                              │
│  ┌──────────────────────────┴───────────────────────────────────┐    │
│  │                   Chat Pipeline Engine                         │    │
│  │                                                                │    │
│  │  ┌─────────┐  ┌────────┐  ┌───────┐  ┌──────┐  ┌─────────┐  │    │
│  │  │Sanitize │→│ Memory │→│Intent │→│Route │→│ Execute │  │    │
│  │  │         │  │  Load  │  │Classify│  │ Path │  │         │  │    │
│  │  └─────────┘  └────────┘  └───────┘  └──────┘  └─────────┘  │    │
│  │                                         │                      │    │
│  │         ┌───────────────────────────────┼──────────┐           │    │
│  │         │              │                │          │           │    │
│  │    orchestrate    skill_chain      standard    perplexity     │    │
│  │    (multi-agent)  (ReAct loop)   (RAG→LLM)   (web search)    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐      │
│  │  Brain   │  │  Agent   │  │ Message  │  │   Hook System  │      │
│  │  Engine  │  │  System  │  │  Queue   │  │                │      │
│  │          │  │          │  │          │  │  10 hooks       │      │
│  │ Voyage   │  │ 12 agents│  │ Per-conv │  │  before:chat   │      │
│  │ Qdrant   │  │ 3 strats │  │ FIFO     │  │  after:chat    │      │
│  │ SQLite   │  │ parallel │  │ throttle │  │  on:error      │      │
│  │ Hybrid   │  │ dispatch │  │          │  │  on:tool:call  │      │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘      │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐      │
│  │ Memory   │  │  Skills  │  │Efficiency│  │   Security     │      │
│  │ 3-tier   │  │  30+     │  │          │  │                │      │
│  │ Core     │  │  MCP     │  │ Cache    │  │ Injection det. │      │
│  │ Archival │  │  Vision  │  │ Cost     │  │ Sandboxed exec │      │
│  │ Recall   │  │  Artist  │  │ Routing  │  │ Audit logging  │      │
│  │          │  │  CodeAdv │  │ OpenRtr  │  │ safeStorage    │      │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  SQLite (FTS + settings) · Qdrant (vectors) · Keychain (keys) │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

Cortex supports 9 configurable services. Each user gets their own encrypted data store (`~/Library/Application Support/Cortex/`).

> **📖 Full setup guide with exact URLs: [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)**

| Service | Required? | Free? | Purpose |
|---------|:---------:|:-----:|---------|
| **LLM Proxy** | ✅ | Team key | Chat, analysis, all AI responses |
| **Voyage AI** | ✅ Recommended | 200M tokens/month | Bulk embedding for indexing |
| **GitHub Models** | ✅ Recommended | Free (Copilot) | Query-time embedding (search) |
| **Qdrant** | Optional | Docker local | Faster vector search for large repos |
| **OpenRouter** | Optional | Vision free | Image analysis + image generation |
| **Atlassian** | Optional | API token | Jira issues + Confluence docs |
| **GitHub PAT** | Optional | Free | PR review, org import, code context |
| **Perplexity** | Optional | Pro account | Real-time web search + URL reading |
| **Ollama** | Optional | Free (local) | Offline embedding fallback |

**Embedding strategy** — Cortex uses a hybrid approach:
- **Indexing**: Voyage AI (3M TPM, fast bulk) → falls back to Ollama → LLM proxy
- **Search/Query**: GitHub Models (free, 14 RPM) → falls back to Voyage AI

Use **Settings → Health Check** to verify all services at once with latency measurements.

### Quick Setup (5 minutes)

```bash
# 1. Configure LLM proxy (required)
Settings → Proxy → URL + Key → Test Connection

# 2. Voyage AI embedding (recommended, free 200M tokens/month)
dash.voyageai.com → API Keys → copy pa-xxxxx
Settings → Voyage AI → paste key

# 3. GitHub Models embedding (free with Copilot)
github.com/settings/tokens → Fine-grained PAT → models:read permission
Settings → GitHub → paste token → enable "GitHub Models Embedding"

# 4. Optional: Qdrant for faster search on large repos
docker run -d --name qdrant -p 6333:6333 -v ~/qdrant-data:/qdrant/storage qdrant/qdrant
Settings → Qdrant → http://localhost:6333

# 5. Optional: Ollama for offline embedding fallback
ollama pull nomic-embed-text
Settings → Ollama → http://localhost:11434
```

---

## Quick Start

### 1. Download & Install

Download the `.dmg` from [Releases](https://github.com/hoainho/cortex/releases), drag to `/Applications`.

### 2. Configure (see [Setup Guide](docs/SETUP_GUIDE.md))

Minimum required: LLM Proxy URL + Key (Settings → Proxy).
Recommended: add Voyage AI key + GitHub PAT for full embedding support.

### 3. Import a Project

| Source | How |
|--------|-----|
| Local folder | New Project → Import Local → select folder |
| GitHub repo | New Project → Import GitHub → paste URL (+ PAT for private) |
| GitHub org | New Project → Import Organization → paste org URL + PAT |
| Jira project | Settings → Atlassian → configure → Import Jira |
| Confluence space | Settings → Atlassian → configure → Import Confluence |

Cortex indexes the full codebase: AST parsing → chunking → embedding → vector search.

### 4. Start Using

**Ask anything about your code:**
```
How does authentication work?
Where is rate limiting implemented?
What's the database schema for users?
```

**Use slash commands for specialized workflows:**
```
/review      — 4-perspective PR review (security, quality, performance, testing)
/security    — vulnerability analysis
/implement   — implement a feature matching your codebase conventions
/refactor    — intelligent refactoring with LSP verification
/perplexity  — real-time web search
/multi-agent — full team of 8 agents in parallel
```

**Upload images or drag-drop files** — Cortex analyzes images (free) and reads documents (PDF, DOCX, XLSX, CSV).

**Use agent modes** (toolbar or `/agents` command):
- **Sisyphus** — relentless executor, works until complete
- **Hephaestus** — deep root-cause analysis, systematic debugging
- **Prometheus** — strategic planner, requires approval before implementing
- **Atlas** — parallel heavy lifter for multi-file operations

### 5. Enable AutoScan (Optional)

Project Settings → Enable AutoScan → Cortex starts training itself from your codebase 24/7.
Check progress: Learning Dashboard → AutoScan tab (shows pairs generated, budget used, circuit state).

---

## What's New in v4.4.0 "Thalamus"

> **Thalamus** — the brain's relay station, routing signals to exactly the right region for processing. This release does the same for Cortex: every query is now routed to the right infrastructure layer automatically.

### Full-Stack Activation — All 5 Phases

**Phase 1 — Smart Pipeline Routing**

`determinePipelinePath()` now uses routing category as primary signal, not just intent confidence:

| Category | Old path | New path |
|----------|----------|----------|
| `deep` / `ultrabrain` | `standard` (if confidence < 0.8) | `orchestrate` (always) |
| `visual-engineering` | `standard` | `skill_chain` + playwright directives |
| `unspecified-high` | `standard` | `orchestrate` |
| `quick` / `unspecified-low` | `standard` | `standard` (unchanged, no overhead) |

Confidence thresholds lowered: `skill_chain` 0.7→0.5, `orchestrate` 0.8→0.6.

**Phase 2 — Category → Skill Auto-Activation**

Each routing category automatically injects task-specific skill directives into system prompt — no slash command needed:
- `deep` → code-analysis + react-agent (trace call chain, root cause first)
- `ultrabrain` → plan-execute + react-agent (plan before implement)
- `visual-engineering` → playwright-browser (browser automation when needed)
- `writing` → react-agent (structure, audience, prose quality)

**Phase 3 — Proactive Background Agents**

Background agents now fire based on routing category, not just intent signals:
- `deep` / `ultrabrain` → explore + librarian fire in parallel
- `visual-engineering` / `unspecified-high` → explore fires
- Results merge into context if ready within 2s, discarded if not

**Phase 4 — Loop Auto-Activation**

Ralph and Ultrawork loops now activate automatically:
- Query contains `"liên tục"`, `"không dừng"`, `"until done"`, `"autonomous"` → Ralph loop
- Category `ultrabrain` + query > 300 chars → Ultrawork loop
- Completion detection: regex on response (`"hoàn thành"`, `"done"`, `"complete"`)
- Integrated into orchestrate path — standard path unaffected

**Phase 5 — Training Feedback Loop Closed**

Every interaction now feeds the training pipeline:
- `notifyChatStarted()` at pipeline entry
- `notifyPostChat(projectId)` + `notifyChatEnded()` after every successful response
- Works across orchestrate, skill_chain, and standard paths
- AutoScan scheduler receives signal to trigger training runs

### Model Routing Fixes

- `routeToModel()` now cross-references live `getAvailableModels()` status — never routes to a `quota_exhausted` model
- `getActiveModel()` returns `''` instead of hardcoded `gpt-4o-mini` when cache empty — triggers `fetchAvailableModels()` instead
- `model-fallback` hook now uses dynamic ready models sorted by tier instead of hardcoded chain
- Agent pool logs warning when falling back to hardcoded tier fallback (was silent)

### OMO Infrastructure Integration

- Hook system fully wired: `on:session:start`, `on:tool:call`, `on:session:end` now active
- Session lifecycle hooks: preload instincts + memory crystals at session start, extract instincts at session end
- Plugin config (`cortex-config.jsonc`): per-agent model override, category model override, hook disable list
- Background concurrency config applied from plugin config at startup
- 60s stale task detection + cleanup interval

### Impact

| Metric | Before | After |
|--------|--------|-------|
| Queries using multi-agent orchestration | ~20% | >60% |
| Background agents (deep/ultrabrain queries) | ~30% | 100% |
| Loop activation | Manual slash command only | Auto-detect from keywords |
| Training signal per interaction | 0 | 100% |
| Latency for `quick` queries | baseline | unchanged |

---

## What's New in v4.3.0 "Synapse"

### Document Intelligence
- `cortex_read_document` tool: read PDF, DOCX, XLSX/XLS, CSV, HTML at query time
- Priority-based converter registry with graceful degradation
- `chunkDocument()` — section-aware chunking by H1–H3 headers
- Brain engine Phase 1.5: documents converted to markdown before embedding
- `DocumentMetadataHeader` UI: file icon, filename, page/sheet/row count badges

### Agent Brain Upgrade — 10 Core Policies
Distilled from Claude Code, Cursor v1–v2, Devin AI, Windsurf Cascade:
- `[autonomous-loop]` — Work until COMPLETE, no premature stopping
- `[tool-first-policy]` — NEVER guess file contents; use tools
- `[parallel-execution]` — All independent tool calls fired simultaneously
- `[anti-hallucination]` — Never invent file names, APIs, or dependencies
- `[verbosity-calibration]` — No preamble, no filler
- All 15 agents upgraded with `CORE_POLICIES`

### Filesystem Tools Overhaul (4 → 9 tools)
- `cortex_read_files` — batch read up to 10 files via `Promise.all`
- `cortex_grep_search` — regex search across entire project, auto-skips `node_modules`
- `cortex_edit_files` — batch apply multiple edits across multiple files
- `cortex_move_file` — safe rename/move with auto-mkdir
- `cortex_delete_file` — sandbox-safe deletion
- Upgraded `cortex_read_file`: 10MB limit, `offset`+`limit` chunk reading
- Upgraded `cortex_list_directory`: `recursive`, `depth`, `extensions` filter
- Progressive edit fallback: exact → whitespace-normalized → nearest-line hint

### Unrestricted Mode
New setting: `filesystem_unrestricted_mode` — AI can read/write any file on the machine.

### 429 Rate Limit Resilience
- Dynamic model resolution: queries `getAvailableModels()` instead of hardcoded names
- Tier-based selection: `fast` → tier 1–5, `balanced` → tier 5–7, `premium` → tier 8–10
- Auto-discover fallback: if no model in tier range → use any ready model
- Exponential backoff with jitter for all agent pool calls

### Architecture Improvements (from hardening roadmap)
- **IPC Modules**: `main.ts` split into 9 domain modules (`electron/ipc/`)
- **HybridVectorStore**: unified interface, auto-selects Qdrant → SQLite with large-project warning
- **Circuit Breaker**: timed open/half-open/close states + daily budget guard
- **Graph Incremental Rebuild**: `rebuildGraphForFiles()` on every sync (no more stale graph)
- **Cache Invalidation**: semantic cache auto-invalidated per-project after sync
- **Bias Prevention**: ROUGE-1 diversity, independent judge model, confidence decay
- **Brain Snapshot**: auto-snapshot before re-index, restore to previous state (3 kept)
- **Ollama Embedding**: local fallback provider via `nomic-embed-text`
- **Resource Lock**: multi-agent file write protection + `OrchestrationBudget` guard
- **IPC Validation**: lightweight schema validation on all critical IPC handlers

---

## Development

```bash
git clone https://github.com/hoainho/cortex.git
cd cortex
npm install
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Production build |
| `npm run dist:mac` | Build macOS `.dmg` |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |

### Project Structure

```
electron/
  ipc/                  # IPC domain modules (brain, memory, chat, skills, settings...)
  services/
    agents/             # 12 agents + resource-lock.ts
    memory/             # 3-tier memory (core, archival, recall)
    skills/             # 30+ skills, MCP, efficiency, learning, RAG
    storage/            # VectorStore interface + HybridVectorStore + BrainSnapshot
  main.ts               # App lifecycle + chat:send pipeline

src/
  components/           # React UI: chat, agent, memory, skills, efficiency, settings
  stores/               # Zustand: chat, project, skill, cost, memory, learning
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Embedding rate limited (429)" | Settings → Voyage AI → paste key. Or enable GitHub Models Embedding. |
| "No agents produced results" | Settings → Proxy → Test Connection. Check proxy URL + key. |
| "Qdrant connection refused" | `docker start qdrant` — Qdrant container not running. |
| AutoScan not running | Circuit breaker may be open. Check Learning Dashboard → AutoScan tab → circuit state. |
| Slow search on large repo | Enable Qdrant (Docker). HybridVectorStore warns when >50K chunks without Qdrant. |
| Brain data wrong after sync | Brain Snapshot: use Settings → Brain → Restore Snapshot to roll back. |
| Knowledge graph stale | Graph now auto-rebuilds incrementally on every sync (since v4.3.0). |
| Image analysis not working | Settings → OpenRouter → add key. Vision is free (healer-alpha model). |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 33 |
| Frontend | React 18, TypeScript 5.7, Tailwind CSS 3.4, Zustand 5 |
| Database | SQLite (better-sqlite3) + Qdrant (optional, Docker) |
| Embeddings | Voyage AI (bulk, 1024-dim) + GitHub Models (query, free) + Ollama (local fallback) |
| Vector Storage | HybridVectorStore: Qdrant → SQLite BLOB with cosine similarity |
| Code Parsing | Tree-sitter (web-tree-sitter), 20+ languages |
| Document Parsing | pdf-parse, mammoth (DOCX), xlsx, turndown (HTML) |
| LLM | OpenAI-compatible proxy (multi-model routing, tier-based selection) |
| External Tools | MCP Protocol, Playwright, Git CLI, Atlassian REST API |
| Build | electron-vite, electron-builder |

---

## License

MIT License — Copyright (c) 2026 Hoài Nhớ

Cortex is an independent project. All intellectual property rights, including architecture design, agent system, and brand identity, are exclusively owned by the author.

---

<div align="center">

**Built with ❤️ by [Hoài Nhớ](mailto:nhoxtvt@gmail.com)**

[GitHub](https://github.com/hoainho/cortex) · [Releases](https://github.com/hoainho/cortex/releases) · [Setup Guide](docs/SETUP_GUIDE.md)

</div>
