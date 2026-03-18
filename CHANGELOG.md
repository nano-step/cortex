# Changelog

Tất cả thay đổi đáng chú ý của dự án Cortex sẽ được ghi lại tại đây.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/lang/vi/).

## [3.2.0] - 2026-03-18

### Thêm mới

#### OmO Pipeline Architecture (inspired by oh-my-openagent)
- **Chat Pipeline Engine** (`chat-pipeline.ts`) — Thay thế monolithic chat:send handler bằng pipeline có stages rõ ràng:
  - Stage 0: Sanitize (via `stageSanitize`)
  - Stage 1: Memory load (via `stageMemory`)
  - Stage 2: Smart Intent Classification (via `stageIntentClassification`)
  - Stage 3: Path Determination — tự động chọn execution path dựa trên intent:
    - `orchestrate` → Multi-agent team dispatch cho complex queries
    - `skill_chain` → ReAct agent cho reasoning queries
    - `slash_command` → Direct skill execution
    - `perplexity` → Forced web search
    - `standard` → RAG → LLM (backward compatible)
- **Plugin Config System** (`plugin-config.ts`) — OmO-compatible JSONC config:
  - Config locations: `.cortex/cortex-config.jsonc` (project) → `~/.config/cortex/config.jsonc` (user)
  - Override agents: model, variant, temperature, maxTokens per agent
  - Override categories: model routing per task category
  - Disable hooks: `disabled_hooks` array
  - Background config: concurrency limits per provider/model
- **Background Agent Dispatch** — `dispatchBackgroundAgents()` sử dụng existing background-manager để fire explore + web search agents song song với main query processing

### Cải tiến
- **Agent Orchestrator giờ là DEFAULT path** — Queries phức tạp (code + tools + external) tự động route qua `orchestrate()` thay vì chỉ khi dùng `/multi-agent`
- **Pipeline Path Router** — `determinePipelinePath()` phân tích intent + query để chọn execution strategy tối ưu
- **Infrastructure Finally Wired** — hooks/, agents/, background/, routing/ directories đã có code từ v2/v3 nhưng bị bypass bởi main.ts. Giờ thực sự được gọi qua chat-pipeline
- **DRY Persistence** — `persistAssistantResponse()` helper thay thế 4 lần copy-paste cùng 1 SQL pattern

### Sửa lỗi
- **main.ts Bypass** — Vấn đề cốt lõi: main.ts đi thẳng RAG → LLM, bypass toàn bộ agent/hook/background infrastructure. Giờ pipeline stages xử lý đúng thứ tự
- **Orchestrator chỉ cho /multi-agent** — Trước đây `orchestrate()` chỉ chạy khi user gõ `/multi-agent`. Giờ tự động trigger cho complex intent

## [3.1.0] - 2026-03-18

### Thêm mới

#### Superpowers Methodology Integration (inspired by obra/superpowers)
- **SUPERPOWERS_CORE** — 3 methodologies inject vào tất cả agent modes + default path:
  - `[systematic-resolution]` — Quy trình 4 pha: Investigate → Compare → Hypothesize → Verify. Cortex sẽ dùng tools trước khi trả lời "không biết"
  - `[response-verification]` — 5-point quality gate trước mỗi response: answer đúng câu hỏi? dựa trên evidence? liệt kê tools đã thử?
  - `[query-clarification]` — Đề xuất 2-3 approaches thay vì hỏi 5+ câu hỏi mở. Try tools trước, clarify sau
- **Smart Intent Classifier** — LLM-based intent classification thay thế keyword matching:
  - Dùng `gemini-2.5-flash-lite` qua proxy (~300ms, $0 cost)
  - Phân loại: rag | memory | code | agent | reasoning | tool | learning | efficiency
  - Detect: needsToolUse, needsExternalInfo, hasUrl, isAboutCode
  - Fallback về keyword matching khi LLM fail
- **Project Tools** — 5 builtin tools mới giải quyết các câu hỏi RAG không trả lời được:
  - `cortex_git_contributors` — Danh sách contributors, commit counts, timeframe filter
  - `cortex_git_log_search` — Tìm kiếm git history theo message, author, date range
  - `cortex_grep_search` — Text search chính xác across toàn bộ project files
  - `cortex_project_stats` — Thống kê project: files, languages, contributors, activity
  - `cortex_search_config` — Tìm config values, env vars, settings across config files
- **Skill-Chain Routing** — Khi intent = `reasoning` + confidence ≥ 0.7, tự động route tới ReAct agent trước khi fall through về RAG
- **OpenRouter Fallback** — Cấu hình free models từ OpenRouter làm backup khi proxy models fail:
  - Settings: API key, enable/disable, test connectivity
  - Free models: Step 3.5 Flash, Qwen3 Coder, Nemotron 3 Super, GPT-OSS-120B, Gemma 3

### Cải tiến
- **Parallel Tool Execution** — Tool calls từ LLM giờ chạy song song via `Promise.all` thay vì tuần tự (2-3x faster cho multi-tool queries)
- **Web Search Intent Trigger** — Web search giờ trigger khi smart intent detect `needsExternalInfo`, không chỉ khi RAG trống hoặc có error pattern
- **Intent Hints in Prompt** — Smart intent analysis inject hints vào system prompt để LLM biết dùng tools nào
- **Agent Mode Enhancements** — Mỗi agent mode giờ có superpowers-specific directives:
  - Hephaestus: systematic-debugging 4-phase (Root Cause → Pattern → Hypothesis → Implementation)
  - Prometheus: brainstorming flow (5-step) + writing-plans methodology
  - Atlas: dispatching-parallel-agents + subagent-driven-development 2-stage review
- **Skill Router v2** — Rewritten để dùng smart classifier, hỗ trợ secondary categories + confidence propagation

### Sửa lỗi
- **Skill Router Dead Code** — `executeRouted()` giờ thực sự được gọi trong chat flow (trước đây là dead code)
- **RAG Confidence False Positive** — Không còn skip web search khi RAG "thành công" nhưng context không relevant

## [3.0.0] - 2026-03-11

### Thêm mới

#### Agent Mode Overhaul
- **Agent Mode Separation** — Agent system prompt không còn hiển thị trong chat UI, chỉ hiện nội dung user nhập
- **OpenCode-style Mode Directives** — Mỗi agent có mode directives riêng: `[analyze-mode]`, `[search-mode]`, `[todo-continuation]`, `[deep-research-mode]`, `[planning-mode]`, `[parallel-execution-mode]`
- **Backend Agent Injection** — `AGENT_MODE_CONFIGS` định nghĩa system prompt + mode directives trong backend, inject vào LLM context thay vì concatenate vào user message
- **Agent Mode IPC** — `agentModeId` truyền riêng qua IPC pipeline (ChatInput → ChatArea → preload → main)

#### Model Routing & GitLab Priority
- **GitLab-first Model Priority** — Tất cả `gitlab-*` models ở T10 (highest), `duo-chat` T10
- **Model Cache Invalidation** — `clearAuthFailedModels()` reset model cache khi đổi proxy URL
- **Expanded Model Registry** — Thêm `gemini-2.5-pro`, `gemini-3-pro-preview` vào T9

#### Hook System (V3 Engine)
- **Before/After Chat Hooks** — cost-guard, cache-check, context-window-monitor
- **Category Routing** — tự động chọn model dựa trên query complexity
- **Background Tasks** — concurrent task execution với priority queue
- **Loop Engine** — Ralph loop, Ultrawork loop, Boulder state persistence
- **Agent Capabilities** — delegation system với tool whitelist per agent role

### Cải tiến
- **Settings Save Feedback** — hiển thị ✓ "Đã lưu thành công" / thông báo lỗi khi save settings
- **safeStorage Fix** — `encrypted` flag chỉ set khi encryption thực sự thành công
- **Landing Page V3** — hiển thị version + 4 feature highlights (Agent Modes, Smart Routing, Agentic RAG, Hook System)
- **macOS Dock Name** — script `patch-electron-name.js` fix dock tooltip hiện "Cortex" thay vì "Electron" trong dev mode
- **Favicon Update** — regenerate favicon.png từ redesigned icon.svg
- **ThinkingStep** — thêm `agent_mode` và `routing` step IDs

### Bảo mật
- Agent system prompts inject vào LLM memory context, không expose trong chat history
- Proxy key encryption guard — tránh mismatch encrypted flag khi safeStorage không khả dụng

## [2.0.0] - 2026-03-03

### Thêm mới

#### Sprint 13 — Memory Architecture (Letta/MemGPT)
- **3-tier Memory System** — Core Memory (user profile, preferences, coding style), Archival Memory (semantic search, long-term knowledge), Recall Memory (conversation history)
- Memory Database — SQLite schema với migration support, embedding-based search
- Memory Manager — orchestration layer kết nối 3 tiers
- Memory Dashboard UI — sliding panel hiển thị/chỉnh sửa core memory, duyệt archival, recall timeline
- Memory Editor component — inline editing cho core memory sections
- Memory Store (Zustand) — state management cho toàn bộ memory system
- Memory IPC bridge — 15 IPC handlers cho CRUD + search + stats + migrate

#### Sprint 14 — Skill Registry & MCP
- **Skill System** — Plugin architecture với CortexSkill interface (name, version, category, priority, canHandle, execute, healthCheck, getMetrics)
- Skill Registry — đăng ký, kích hoạt, vô hiệu hóa skills dynamically
- Skill Router — tự động route queries tới skill phù hợp nhất dựa trên confidence scoring
- Skill Loader — auto-discovery và khởi tạo skills
- MCP Client — Model Context Protocol client cho external tool integration
- MCP Adapter — chuyển đổi MCP server tools thành CortexSkill instances
- Playwright Adapter — browser automation skill cho web scraping
- Built-in Skills — cortex-chat (fallback), code-analysis, rag-search, memory-skill
- Skill Manager UI — sliding panel quản lý skills theo category, toggle active/inactive
- Skill Config modal — hiển thị metrics, status, dependencies cho từng skill
- Skill Store (Zustand) — state management cho skill system
- Skill IPC bridge — 6 IPC handlers cho list/activate/deactivate/execute/route/health

#### Sprint 15 — Advanced RAG
- **RAG Router** — tự động chọn chiến lược RAG (hybrid, graphrag, fusion, contextual) dựa trên query analysis
- **GraphRAG Skill** — graph-enhanced retrieval sử dụng code dependency graph, node neighbors
- **RAG Fusion Skill** — multi-query với Reciprocal Rank Fusion, query variant generation
- **Contextual Chunking** — enriches chunks với file-level context (imports, exports) trước embedding
- **Re-embed Engine** — re-embed existing chunks với contextual enrichment, batch processing
- Graph Database — code dependency graph (nodes, edges, neighbors)
- Graph Builder — xây dựng code graph từ AST analysis

#### Sprint 16 — Self-Learning
- **Event Collector** — thu thập behavioral events (message_sent, code_accepted, code_rejected, follow_up patterns)
- **Feedback Detector** — phát hiện implicit feedback từ user behavior
- **Learning Database** — lưu trữ training pairs, learned weights
- **DSPy Bridge** — kết nối tới DSPy framework cho prompt optimization
- **Prompt Optimizer** — tối ưu hóa prompts dựa trên feedback data
- Learning Dashboard UI — hiển thị training stats, feedback ratio, compression savings, trigger manual training
- Learning Store (Zustand) — state management cho learning system

#### Sprint 17 — Efficiency Engine
- **Semantic Cache** — embedding-based response cache với exact hash + cosine similarity matching (92% threshold)
- Cache Key generation — hash-based + embedding-based dual lookup
- **Model Router** — chọn model tối ưu dựa trên query complexity
- **Model Registry** — quản lý available models với metadata
- **Cost Tracker** — theo dõi token usage, cost per query, daily costs, cache savings
- Cost Dashboard UI — hiển thị tổng chi phí, token breakdown, daily chart, semantic cache stats
- Cost Store (Zustand) — state management cho cost/cache system
- Cost IPC bridge — 4 IPC handlers cho stats/history/cache

#### Sprint 18 — Agent Mode
- **ReAct Agent Skill** — reasoning + acting loop cho multi-step tasks (max 10 iterations)
- **Plan & Execute Skill** — two-phase reasoning: plan 2-6 steps → execute sequentially with code context
- **Reflexion Skill** — self-evaluating reasoning với iterative improvement (max 3 reflections, score ≥8/10 early stop)
- **Code Executor** — sandboxed code execution (JavaScript, TypeScript, Python, Bash) via child_process
- **Terminal** — safe command execution với allowlist (30+ commands), blocked dangerous patterns
- **Git Actions** — git operations as agent actions (branch, commit, diff, status, log)
- Agent Panel UI — sliding panel với strategy selector (ReAct/Plan & Execute/Reflexion), live step visualization, abort support
- Agent IPC bridge — execute + abort handlers với real-time step streaming via IPC events

### Cải tiến
- Navigation mới — 5 nút V2 (Memory, Skills, Learning, Cost, Agent) trong ChatArea toolbar
- Version bump lên v2.0.0
- Kiến trúc tài liệu — CORTEX_V2_ARCHITECTURE.md, CORTEX_V2_STRATEGY.md, CORTEX_V2_SKILL_CATALOG.md, CORTEX_V2_SPRINT_PLAN.md

### Bảo mật
- Terminal command allowlist — chỉ cho phép 24 safe commands, block patterns nguy hiểm (rm -rf /, sudo, chmod 777, fork bomb)
- Code execution sandbox — isolated temp directories, auto-cleanup
- Agent abort mechanism — AbortController cho graceful cancellation

## [1.0.0] - 2026-03-01

### Thêm mới

#### Sprint 9 — Brain Analysis
- Architecture Analyzer UI — hiển thị module graph, hub files, layers, tech stack
- Impact Analyzer IPC — phân tích blast radius từ file thay đổi
- Feature Estimator IPC — ước tính effort dựa trên codebase context
- Embedder retry logic — exponential backoff (3 retries, 1s/2s/4s)
- Smart directory tree update — tự động regenerate tree khi sync

#### Sprint 10 — Chat Enhancement & Hardening
- Slash Commands — `/impact`, `/estimate`, `/architecture`, `/sync`, `/stats` trong chat input
- Slash command autocomplete UI với popup menu
- Prompt injection detection — `sanitizePrompt()` tích hợp vào chat:send handler
- Security audit logging cho prompt injection attempts
- Sync lock — chống concurrent sync cùng repository
- GitHub token validation — kiểm tra token còn hiệu lực

#### Sprint 11 — Release Features
- Auto-updater IPC — kiểm tra phiên bản mới qua GitHub Releases
- Brain Export/Import IPC — backup/restore brain dưới dạng `.cbx` (JSON + gzip)
- Onboarding wizard — hướng dẫn 3 bước cho lần sử dụng đầu tiên
- Brain Dashboard — thống kê brain (files, chunks, conversations, last sync)
- Version bump lên v1.0.0

#### Sprint 12 — Agentic RAG & Nano-Brain
- Agentic RAG pipeline — decompose query → iterative hybrid search → relevance boosting → gap detection → confidence scoring
- Nano-brain integration — tự động init nano-brain khi import repository (local + GitHub)
- Nano-brain IPC handlers — status, query, collections, embed qua IPC bridge
- OpenCode/OMO model support — thêm `opencode-*`, `omo-*`, `duo-chat` vào MODEL_RANKING
- Dynamic proxy credentials — `llm-client.ts` và `embedder.ts` sử dụng dynamic config từ settings thay vì hardcoded

### Bảo mật
- Prompt injection detection với 15+ regex patterns
- Tự động sanitize injection wrappers (```system```, [SYSTEM], <<SYS>>)
- Security audit trail cho mọi prompt injection attempt
- Sync lock chống race condition khi sync đồng thời
- GitHub token expiry validation
- Nano-brain memory isolation — mỗi project sử dụng collection riêng biệt, chống lộ dữ liệu giữa các brain

## [0.8.0] - 2026-03-01

### Thêm mới

#### Core
- Ứng dụng Electron desktop với React + TypeScript + Tailwind CSS
- Quản lý dự án (tạo, đổi tên, xóa dự án với brain name riêng biệt)
- Import repository từ GitHub (public + private với token xác thực)
- Import repository từ hệ thống file cục bộ
- Pipeline phân tích code với Tree-sitter (web-tree-sitter)

#### Brain Engine
- Vector search sử dụng ChromaDB embeddings
- Hybrid search (vector + keyword fallback)
- Code chunking với phân tách theo ngôn ngữ
- Tạo cây thư mục cho mỗi dự án
- Architecture Analyzer service (module deps, hub files, layers)
- Impact Analyzer service (phân tích blast radius)
- Feature Estimate service (ước tính effort)
- Brain Export/Import service (JSON + gzip)

#### Chat AI
- Chat AI hai chế độ: PM mode + Engineering mode
- Streaming phản hồi qua LLM proxy (OpenAI-compatible)
- Citation Engine — phân tích `[N: file:lines]` từ phản hồi LLM, hiển thị badges
- Confidence Score — phân tích 🟢🟡🔴 mức độ tin cậy từ phản hồi
- Lưu trữ cuộc trò chuyện (SQLite + Zustand)

#### Settings & Config
- Panel cài đặt (proxy URL/key, kiểm tra kết nối, max tokens, context messages, clone depth)
- Cấu hình context window + max tokens cho LLM
- Cấu hình clone depth cho Git

#### Infrastructure
- Hệ thống audit logging (theo dõi mọi hành động người dùng)
- Sync engine cho repository (GitHub + local, file watcher)
- Crash recovery handlers (uncaughtException, unhandledRejection)
- Auto-updater foundation (kiểm tra GitHub releases)
- IPC bridge với contextIsolation + sandbox
- Hiển thị phiên bản app trong footer cài đặt

### Bảo mật
- `contextIsolation: true`, `nodeIntegration: false`
- Lưu trữ secret mã hóa qua Electron safeStorage (API keys)
- Audit trail cho mọi hành động quan trọng
- Phòng chống prompt injection trong system prompts
- Cách ly bộ nhớ giữa các brain dự án
- Rate limiting cho API calls
