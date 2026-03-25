# Changelog

All notable changes to Cortex are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [4.1.0] - 2026-03-25

### Added

#### Filesystem Tools — Full Overhaul (4 → 9 tools)
- **`cortex_read_files`** — Batch read up to 10 files simultaneously via `Promise.all` (true parallel I/O)
- **`cortex_grep_search`** — Regex/text search across the entire project, returns `file:line: match`, auto-skips `node_modules`/`dist`/binary files
- **`cortex_edit_files`** — Batch apply multiple edits across multiple files in one call, reports `N/M succeeded`
- **`cortex_move_file`** — Safe file rename/move, auto-creates parent directories, prevents accidental overwrites
- **`cortex_delete_file`** — Delete file/empty directory, sandbox-safe

#### Filesystem Tools — Upgrades to Existing Tools
- **`cortex_read_file`**: Size limit raised from 1MB → **10MB**; added `offset`+`limit` for chunk reading large files
- **`cortex_list_directory`**: Added `recursive`, `depth` (1–10), and `extensions` filter
- **Progressive fallback for `cortex_edit_file`**: When `old_string` does not match exactly:
  - Attempt 1: Exact match
  - Attempt 2: Whitespace-normalized match (trim each line)
  - Attempt 3: Nearest line hint + guidance to use `offset+limit` for precise inspection

#### Unrestricted Mode
- New setting: `filesystem_unrestricted_mode` (default: `false`)
- When enabled: AI can read/write any file on the machine, including absolute paths
- Still protected: `/System`, `/etc`, `/bin`, `/sbin`, `/var`, `node_modules`
- Inspired by Cline/Roo Code: warn on out-of-workspace paths instead of blocking

#### Agent Pool — 429 Rate Limit Resilience
- **Dynamic model resolution**: Instead of hardcoded model names, pool queries `getAvailableModels()` to use models actually available on the proxy
- **Tier-based selection**: `fast` → tier 1–5, `balanced` → tier 5–7, `premium` → tier 8–10; automatically picks the best available in range
- **Model refresh**: Pool auto-refreshes model list before execution if no models are ready
- **Auto-discover fallback**: If no model is available in the tier range → use any ready model (best tier first)

### Improved

#### Agent Pool — Retry & Fallback
- **Exponential backoff with jitter**: `429`/`5xx` → retry after 1s/2s/4s (±30% jitter)
- **Retry-After header**: When server returns `Retry-After: 30` → wait exactly 30s (capped at 16s)
- **Model tier fallback**: `RESOURCE_EXHAUSTED` in body → automatically cascade `fast → balanced → premium`
- **Error preservation**: All retry errors are stored in `AgentOutput.metadata.errors[]`

### Fixed
- **Planning skill truncation**: `/plan` response was cut off at 2,000 chars → raised to 8,000 chars
- **Agent Pool `0/2 succeeded`**: Agents failed immediately on 429 instead of retrying with backoff
- **Explore/Librarian 429**: Agents used hardcoded model names that did not exist on the proxy

## [3.2.0] - 2026-03-18

### Added

#### OmO Pipeline Architecture (inspired by oh-my-openagent)
- **Chat Pipeline Engine** (`chat-pipeline.ts`) — Replaced the monolithic `chat:send` handler with a clearly staged pipeline:
  - Stage 0: Sanitize (via `stageSanitize`)
  - Stage 1: Memory load (via `stageMemory`)
  - Stage 2: Smart Intent Classification (via `stageIntentClassification`)
  - Stage 3: Path Determination — automatically selects execution path based on intent:
    - `orchestrate` → Multi-agent team dispatch for complex queries
    - `skill_chain` → ReAct agent for reasoning queries
    - `slash_command` → Direct skill execution
    - `perplexity` → Forced web search
    - `standard` → RAG → LLM (backward compatible)
- **Plugin Config System** (`plugin-config.ts`) — OmO-compatible JSONC config:
  - Config locations: `.cortex/cortex-config.jsonc` (project) → `~/.config/cortex/config.jsonc` (user)
  - Override agents: model, variant, temperature, maxTokens per agent
  - Override categories: model routing per task category
  - Disable hooks: `disabled_hooks` array
  - Background config: concurrency limits per provider/model
- **Background Agent Dispatch** — `dispatchBackgroundAgents()` uses the existing background-manager to fire explore + web search agents in parallel with main query processing

### Improved
- **Agent Orchestrator is now the DEFAULT path** — Complex queries (code + tools + external) automatically route through `orchestrate()` instead of only when using `/multi-agent`
- **Pipeline Path Router** — `determinePipelinePath()` analyzes intent + query to select the optimal execution strategy
- **Infrastructure Finally Wired** — `hooks/`, `agents/`, `background/`, `routing/` directories had code from v2/v3 but were bypassed by `main.ts`. Now properly called through the chat pipeline
- **DRY Persistence** — `persistAssistantResponse()` helper replaces 4 copy-pasted instances of the same SQL pattern

### Fixed
- **main.ts Bypass** — Core issue: `main.ts` was going directly RAG → LLM, bypassing all agent/hook/background infrastructure. Pipeline stages now execute in the correct order
- **Orchestrator only for /multi-agent** — Previously `orchestrate()` only ran when the user typed `/multi-agent`. Now automatically triggered for complex intent

## [3.1.0] - 2026-03-18

### Added

#### Superpowers Methodology Integration (inspired by obra/superpowers)
- **SUPERPOWERS_CORE** — 3 methodologies injected into all agent modes + default path:
  - `[systematic-resolution]` — 4-phase workflow: Investigate → Compare → Hypothesize → Verify. Cortex uses tools before saying "I don't know"
  - `[response-verification]` — 5-point quality gate before each response: does the answer address the question? is it evidence-based? are the tools tried listed?
  - `[query-clarification]` — Proposes 2–3 approaches instead of asking 5+ open questions. Try tools first, clarify after
- **Smart Intent Classifier** — LLM-based intent classification replacing keyword matching:
  - Uses `gemini-2.5-flash-lite` via proxy (~300ms, $0 cost)
  - Categories: rag | memory | code | agent | reasoning | tool | learning | efficiency
  - Detects: needsToolUse, needsExternalInfo, hasUrl, isAboutCode
  - Falls back to keyword matching when LLM fails
- **Project Tools** — 5 new built-in tools that answer questions RAG cannot:
  - `cortex_git_contributors` — List contributors, commit counts, timeframe filter
  - `cortex_git_log_search` — Search git history by message, author, date range
  - `cortex_grep_search` — Precise text search across all project files
  - `cortex_project_stats` — Project stats: files, languages, contributors, activity
  - `cortex_search_config` — Find config values, env vars, settings across config files
- **Skill-Chain Routing** — When intent = `reasoning` + confidence ≥ 0.7, automatically routes to the ReAct agent before falling through to RAG
- **OpenRouter Fallback** — Configure free models from OpenRouter as backup when proxy models fail:
  - Settings: API key, enable/disable, test connectivity
  - Free models: Step 3.5 Flash, Qwen3 Coder, Nemotron 3 Super, GPT-OSS-120B, Gemma 3

### Improved
- **Parallel Tool Execution** — LLM tool calls now run in parallel via `Promise.all` instead of sequentially (2–3x faster for multi-tool queries)
- **Web Search Intent Trigger** — Web search now triggers when smart intent detects `needsExternalInfo`, not only when RAG is empty or returns an error pattern
- **Intent Hints in Prompt** — Smart intent analysis injects hints into the system prompt so the LLM knows which tools to use
- **Agent Mode Enhancements** — Each agent mode now has superpowers-specific directives:
  - Hephaestus: systematic-debugging 4-phase (Root Cause → Pattern → Hypothesis → Implementation)
  - Prometheus: brainstorming flow (5-step) + writing-plans methodology
  - Atlas: dispatching-parallel-agents + subagent-driven-development 2-stage review
- **Skill Router v2** — Rewritten to use the smart classifier, supports secondary categories + confidence propagation

### Fixed
- **Skill Router Dead Code** — `executeRouted()` is now actually called in the chat flow (was dead code before)
- **RAG Confidence False Positive** — No longer skips web search when RAG "succeeds" but the context is not relevant

## [3.0.0] - 2026-03-11

### Added

#### Agent Mode Overhaul
- **Agent Mode Separation** — Agent system prompt no longer shown in the chat UI; only the user-typed content is displayed
- **OpenCode-style Mode Directives** — Each agent has its own mode directives: `[analyze-mode]`, `[search-mode]`, `[todo-continuation]`, `[deep-research-mode]`, `[planning-mode]`, `[parallel-execution-mode]`
- **Backend Agent Injection** — `AGENT_MODE_CONFIGS` defines system prompt + mode directives in the backend, injected into LLM context instead of concatenated into the user message
- **Agent Mode IPC** — `agentModeId` passed separately through the IPC pipeline (ChatInput → ChatArea → preload → main)

#### Model Routing & GitLab Priority
- **GitLab-first Model Priority** — All `gitlab-*` models at T10 (highest), `duo-chat` at T10
- **Model Cache Invalidation** — `clearAuthFailedModels()` resets the model cache when the proxy URL changes
- **Expanded Model Registry** — Added `gemini-2.5-pro`, `gemini-3-pro-preview` at T9

#### Hook System (V3 Engine)
- **Before/After Chat Hooks** — cost-guard, cache-check, context-window-monitor
- **Category Routing** — automatically selects model based on query complexity
- **Background Tasks** — concurrent task execution with priority queue
- **Loop Engine** — Ralph loop, Ultrawork loop, Boulder state persistence
- **Agent Capabilities** — delegation system with tool whitelist per agent role

### Improved
- **Settings Save Feedback** — displays ✓ "Saved successfully" / error message when saving settings
- **safeStorage Fix** — `encrypted` flag is only set when encryption actually succeeds
- **Landing Page V3** — shows version + 4 feature highlights (Agent Modes, Smart Routing, Agentic RAG, Hook System)
- **macOS Dock Name** — `patch-electron-name.js` script fixes dock tooltip to show "Cortex" instead of "Electron" in dev mode
- **Favicon Update** — regenerated `favicon.png` from redesigned `icon.svg`
- **ThinkingStep** — added `agent_mode` and `routing` step IDs

### Security
- Agent system prompts injected into LLM memory context, not exposed in chat history
- Proxy key encryption guard — prevents encrypted flag mismatch when safeStorage is unavailable

## [2.0.0] - 2026-03-03

### Added

#### Sprint 13 — Memory Architecture (Letta/MemGPT)
- **3-tier Memory System** — Core Memory (user profile, preferences, coding style), Archival Memory (semantic search, long-term knowledge), Recall Memory (conversation history)
- Memory Database — SQLite schema with migration support, embedding-based search
- Memory Manager — orchestration layer connecting all 3 tiers
- Memory Dashboard UI — sliding panel to view/edit core memory, browse archival, recall timeline
- Memory Editor component — inline editing for core memory sections
- Memory Store (Zustand) — state management for the entire memory system
- Memory IPC bridge — 15 IPC handlers for CRUD + search + stats + migrate

#### Sprint 14 — Skill Registry & MCP
- **Skill System** — Plugin architecture with CortexSkill interface (name, version, category, priority, canHandle, execute, healthCheck, getMetrics)
- Skill Registry — register, activate, and deactivate skills dynamically
- Skill Router — automatically routes queries to the most relevant skill based on confidence scoring
- Skill Loader — auto-discovery and initialization of skills
- MCP Client — Model Context Protocol client for external tool integration
- MCP Adapter — converts MCP server tools into CortexSkill instances
- Playwright Adapter — browser automation skill for web scraping
- Built-in Skills — cortex-chat (fallback), code-analysis, rag-search, memory-skill
- Skill Manager UI — sliding panel to manage skills by category, toggle active/inactive
- Skill Config modal — shows metrics, status, and dependencies per skill
- Skill Store (Zustand) — state management for the skill system
- Skill IPC bridge — 6 IPC handlers for list/activate/deactivate/execute/route/health

#### Sprint 15 — Advanced RAG
- **RAG Router** — automatically selects RAG strategy (hybrid, graphrag, fusion, contextual) based on query analysis
- **GraphRAG Skill** — graph-enhanced retrieval using code dependency graph and node neighbors
- **RAG Fusion Skill** — multi-query with Reciprocal Rank Fusion, query variant generation
- **Contextual Chunking** — enriches chunks with file-level context (imports, exports) before embedding
- **Re-embed Engine** — re-embeds existing chunks with contextual enrichment, batch processing
- Graph Database — code dependency graph (nodes, edges, neighbors)
- Graph Builder — builds code graph from AST analysis

#### Sprint 16 — Self-Learning
- **Event Collector** — collects behavioral events (message_sent, code_accepted, code_rejected, follow_up patterns)
- **Feedback Detector** — detects implicit feedback from user behavior
- **Learning Database** — stores training pairs and learned weights
- **DSPy Bridge** — connects to the DSPy framework for prompt optimization
- **Prompt Optimizer** — optimizes prompts based on feedback data
- Learning Dashboard UI — shows training stats, feedback ratio, compression savings, triggers manual training
- Learning Store (Zustand) — state management for the learning system

#### Sprint 17 — Efficiency Engine
- **Semantic Cache** — embedding-based response cache with exact hash + cosine similarity matching (92% threshold)
- Cache Key generation — hash-based + embedding-based dual lookup
- **Model Router** — selects the optimal model based on query complexity
- **Model Registry** — manages available models with metadata
- **Cost Tracker** — tracks token usage, cost per query, daily costs, and cache savings
- Cost Dashboard UI — shows total cost, token breakdown, daily chart, semantic cache stats
- Cost Store (Zustand) — state management for the cost/cache system
- Cost IPC bridge — 4 IPC handlers for stats/history/cache

#### Sprint 18 — Agent Mode
- **ReAct Agent Skill** — reasoning + acting loop for multi-step tasks (max 10 iterations)
- **Plan & Execute Skill** — two-phase reasoning: plan 2–6 steps → execute sequentially with code context
- **Reflexion Skill** — self-evaluating reasoning with iterative improvement (max 3 reflections, score ≥8/10 early stop)
- **Code Executor** — sandboxed code execution (JavaScript, TypeScript, Python, Bash) via child_process
- **Terminal** — safe command execution with an allowlist (30+ commands), blocked dangerous patterns
- **Git Actions** — git operations as agent actions (branch, commit, diff, status, log)
- Agent Panel UI — sliding panel with strategy selector (ReAct/Plan & Execute/Reflexion), live step visualization, abort support
- Agent IPC bridge — execute + abort handlers with real-time step streaming via IPC events

### Improved
- New navigation — 5 V2 buttons (Memory, Skills, Learning, Cost, Agent) in the ChatArea toolbar
- Version bumped to v2.0.0
- Architecture documentation — `ARCHITECTURE.md`, `STRATEGY.md`, `SKILL_CATALOG.md`, `SPRINT_PLAN.md`

### Security
- Terminal command allowlist — allows only 24 safe commands, blocks dangerous patterns (rm -rf /, sudo, chmod 777, fork bomb)
- Code execution sandbox — isolated temp directories, auto-cleanup
- Agent abort mechanism — AbortController for graceful cancellation

## [1.0.0] - 2026-03-01

### Added

#### Sprint 9 — Brain Analysis
- Architecture Analyzer UI — shows module graph, hub files, layers, tech stack
- Impact Analyzer IPC — analyzes blast radius from changed files
- Feature Estimator IPC — estimates effort based on codebase context
- Embedder retry logic — exponential backoff (3 retries, 1s/2s/4s)
- Smart directory tree update — auto-regenerates tree on sync

#### Sprint 10 — Chat Enhancement & Hardening
- Slash Commands — `/impact`, `/estimate`, `/architecture`, `/sync`, `/stats` in chat input
- Slash command autocomplete UI with popup menu
- Prompt injection detection — `sanitizePrompt()` integrated into the chat:send handler
- Security audit logging for prompt injection attempts
- Sync lock — prevents concurrent sync of the same repository
- GitHub token validation — checks whether the token is still valid

#### Sprint 11 — Release Features
- Auto-updater IPC — checks for new versions via GitHub Releases
- Brain Export/Import IPC — backup/restore brain as `.cbx` (JSON + gzip)
- Onboarding wizard — 3-step guide for first-time users
- Brain Dashboard — brain stats (files, chunks, conversations, last sync)
- Version bumped to v1.0.0

#### Sprint 12 — Agentic RAG & Nano-Brain
- Agentic RAG pipeline — decompose query → iterative hybrid search → relevance boosting → gap detection → confidence scoring
- Nano-brain integration — automatically initializes nano-brain when importing a repository (local + GitHub)
- Nano-brain IPC handlers — status, query, collections, embed via IPC bridge
- OpenCode/OMO model support — added `opencode-*`, `omo-*`, `duo-chat` to `MODEL_RANKING`
- Dynamic proxy credentials — `llm-client.ts` and `embedder.ts` use dynamic config from settings instead of hardcoded values

### Security
- Prompt injection detection with 15+ regex patterns
- Auto-sanitizes injection wrappers (` ```system``` `, [SYSTEM], <<SYS>>)
- Security audit trail for all prompt injection attempts
- Sync lock prevents race conditions during concurrent syncs
- GitHub token expiry validation
- Nano-brain memory isolation — each project uses a separate collection, preventing data leakage between brains

## [0.8.0] - 2026-03-01

### Added

#### Core
- Electron desktop app with React + TypeScript + Tailwind CSS
- Project management (create, rename, delete projects with separate brain names)
- Import repository from GitHub (public + private with authentication token)
- Import repository from local file system
- Code analysis pipeline with Tree-sitter (web-tree-sitter)

#### Brain Engine
- Vector search using ChromaDB embeddings
- Hybrid search (vector + keyword fallback)
- Code chunking with language-aware splitting
- Directory tree generation per project
- Architecture Analyzer service (module deps, hub files, layers)
- Impact Analyzer service (blast radius analysis)
- Feature Estimate service (effort estimation)
- Brain Export/Import service (JSON + gzip)

#### Chat AI
- Chat AI in two modes: PM mode + Engineering mode
- Streaming responses via LLM proxy (OpenAI-compatible)
- Citation Engine — parses `[N: file:lines]` from LLM responses, displays badges
- Confidence Score — analyzes 🟢🟡🔴 confidence level from responses
- Conversation persistence (SQLite + Zustand)

#### Settings & Config
- Settings panel (proxy URL/key, connection test, max tokens, context messages, clone depth)
- Context window + max tokens configuration for LLM
- Clone depth configuration for Git

#### Infrastructure
- Audit logging system (tracks all user actions)
- Repository sync engine (GitHub + local, file watcher)
- Crash recovery handlers (uncaughtException, unhandledRejection)
- Auto-updater foundation (checks GitHub releases)
- IPC bridge with contextIsolation + sandbox
- App version displayed in settings footer

### Security
- `contextIsolation: true`, `nodeIntegration: false`
- Encrypted secret storage via Electron safeStorage (API keys)
- Audit trail for all important actions
- Prompt injection prevention in system prompts
- Memory isolation between project brains
- Rate limiting for API calls
