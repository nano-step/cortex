<div align="center">

# Cortex

**The AI Brain That Knows Your Codebase**

[![Version](https://img.shields.io/badge/version-3.2.0-orange.svg)](https://github.com/hoainho/cortex/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/hoainho/cortex/releases)
[![Built With](https://img.shields.io/badge/built%20with-Electron%20%2B%20React%20%2B%20TypeScript-61DAFB.svg)](#tech-stack)

A desktop AI assistant that deeply understands your entire codebase — not a ChatGPT wrapper, but a full engineering intelligence platform with persistent memory, multi-agent orchestration, and self-learning.

[Download for Mac](https://github.com/hoainho/cortex/releases) · [Setup Guide](docs/SETUP_GUIDE.md) · [Changelog](CHANGELOG.md)

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

**The difference shows in practice:**

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

### Layer 3: Tools (25+ Built-in)

Cortex doesn't just answer from knowledge — it **acts**:

| Tool Category | Tools | What They Do |
|---|---|---|
| **Code Advisor** | `code_advisor`, `find_similar_code`, `suggest_fix`, `explain_code_pattern` | TabNine-inspired: search codebase patterns → detect conventions → style-matched suggestions |
| **Project Analysis** | `git_contributors`, `git_log_search`, `grep_search`, `project_stats`, `search_config` | Answer questions RAG can't: team size, git history, exact config values |
| **Vision** | `analyze_image`, `compare_images` | FREE image analysis via OpenRouter (healer-alpha, hunter-alpha) |
| **Artist** | `generate_image`, `edit_image` | AI image generation with 8 style presets (anime, watercolor, pixel-art...) |
| **Web** | `perplexity_search`, `perplexity_read_url` | Real-time web search and URL reading |
| **File System** | `read_file`, `list_directory`, `search_files` | Read and navigate project files |

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

Cortex supports 7 configurable services. Each user gets their own encrypted data store.

> **📖 Full setup guide with exact URLs for every API key: [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)**

| Service | Required? | Free? | Purpose |
|---------|:---------:|:-----:|---------|
| **LLM Proxy** | ✅ | Team key | Chat, analysis, code suggestions |
| **Voyage AI** | ✅ Recommended | 200M tokens/month | Embedding for RAG search |
| **Qdrant** | Optional | Docker local | Faster vector search |
| **OpenRouter** | Optional | Vision free | Image analysis + generation |
| **Atlassian** | Optional | API token | Jira issues + Confluence docs |
| **GitHub** | Optional | Free PAT | PR review + code context |
| **Perplexity** | Optional | Pro account | Web search + URL reading |

Use `settings:healthCheck` to verify all services at once.

---

## Quick Start

### 1. Download & Install

Download the `.dmg` from [Releases](https://github.com/hoainho/cortex/releases), drag to `/Applications`.

### 2. Configure

Follow the [Setup Guide](docs/SETUP_GUIDE.md) to configure your API keys.

### 3. Create a Project

Import from local folder or GitHub URL. Cortex indexes the entire codebase.

### 4. Start Using

Ask questions, use `/` slash commands, upload images, drag-drop files. Cortex understands your code.

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

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 33 |
| Frontend | React 18, TypeScript 5.7, Tailwind CSS 3.4, Zustand 5 |
| Database | SQLite (better-sqlite3) + Qdrant (Docker) |
| Embeddings | Voyage AI `voyage-3-large` (1024 dims) |
| Code Parsing | Tree-sitter (web-tree-sitter) |
| LLM | OpenAI-compatible API via proxy (multi-model routing) |
| Tools | MCP Protocol, Playwright, Git CLI |
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
