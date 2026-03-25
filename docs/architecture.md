# CORTEX v2.0 — TECHNICAL ARCHITECTURE
## Kien Truc Ky Thuat Chi Tiet

**Ngay tao:** 03/03/2026

---

## 1. High-Level Architecture

```
+===================================================================+
|                     ELECTRON RENDERER (React)                      |
|                                                                    |
|  +---------------+  +--------------+  +------------------------+  |
|  | Chat UI       |  | Skill Mgr    |  | Memory Dashboard       |  |
|  | - ChatArea    |  | - SkillList  |  | - Core/Archival/Recall |  |
|  | - ChatInput   |  | - SkillCfg   |  | - Search + Edit        |  |
|  | - MessageList |  | - Status     |  | - Stats                |  |
|  +---------------+  +--------------+  +------------------------+  |
|  +---------------+  +--------------+  +------------------------+  |
|  | Brain Dash    |  | Cost Tracker |  | Learning Dashboard     |  |
|  | - Stats       |  | - Per query  |  | - Events               |  |
|  | - Architecture|  | - Daily/Mo   |  | - Improvements         |  |
|  | - Import      |  | - Budget     |  | - DSPy metrics         |  |
|  +---------------+  +--------------+  +------------------------+  |
|  +---------------+  +--------------+                              |
|  | Agent Panel   |  | Settings     |                              |
|  | - Plan view   |  | - LLM config |                              |
|  | - Steps       |  | - Skills     |                              |
|  | - Terminal    |  | - Security   |                              |
|  +---------------+  +--------------+                              |
|                                                                    |
|  Zustand Stores: chatStore, projectStore, skillStore, costStore,   |
|                  memoryStore, learningStore, syncStore, uiStore    |
+======================== IPC Bridge ===============================+
|                     ELECTRON MAIN PROCESS                          |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                    SKILL ROUTER (Core)                        | |
|  |  1. Receive query via IPC                                    | |
|  |  2. Load memory context (Core + Archival + Recall)           | |
|  |  3. Classify intent (code Q? action? memory? tool?)          | |
|  |  4. Select skill(s) via Skill Registry                      | |
|  |  5. Execute skill pipeline                                   | |
|  |  6. Apply Efficiency Engine (compress, cache, route model)   | |
|  |  7. Stream response back via IPC                             | |
|  |  8. Capture behavioral event (async)                         | |
|  +--------------------------------------------------------------+ |
|                              |                                     |
|  +--------------------------------------------------------------+ |
|  |                    SKILL REGISTRY                              | |
|  |  +--------+  +--------+  +--------+  +--------+  +--------+ | |
|  |  | RAG    |  | Memory |  | Agent  |  | Code   |  | Learn  | | |
|  |  | Skills |  | Skills |  | Skills |  | Skills |  | Skills | | |
|  |  +--------+  +--------+  +--------+  +--------+  +--------+ | |
|  |  +--------+  +--------+  +--------+                         | |
|  |  | Effic. |  | Reason |  | MCP    |                         | |
|  |  | Skills |  | Skills |  | Tools  |                         | |
|  |  +--------+  +--------+  +--------+                         | |
|  +--------------------------------------------------------------+ |
|                              |                                     |
|  +--------------------------------------------------------------+ |
|  |                    EFFICIENCY ENGINE                           | |
|  |  [Semantic Cache] -> [LLMLingua Compress] -> [Model Router]  | |
|  |  [Cost Tracker] <- [Token Counter] <- [Budget Manager]       | |
|  +--------------------------------------------------------------+ |
|                              |                                     |
|  +--------------------------------------------------------------+ |
|  |                    BRAIN ENGINE (Data Layer)                   | |
|  |  +----------+  +----------+  +----------+  +-----------+    | |
|  |  | Embedder |  | ChromaDB |  | Graph DB |  | SQLite    |    | |
|  |  | (Voyage/ |  | (vectors)|  | (entities|  | (metadata |    | |
|  |  |  custom) |  |          |  |  + edges)|  |  + memory) |    | |
|  |  +----------+  +----------+  +----------+  +-----------+    | |
|  +--------------------------------------------------------------+ |
|                              |                                     |
|  +--------------------------------------------------------------+ |
|  |                    MCP LAYER (External Tools)                  | |
|  |  [GitHub] [Jira] [Confluence] [Slack] [Playwright] [CodeExec] | |
|  +--------------------------------------------------------------+ |
+===================================================================+
```

---

## 2. Skill System Architecture

### 2.1 Skill Interface

```typescript
// electron/services/skills/types.ts

interface CortexSkill {
  readonly name: string;
  readonly version: string;
  readonly category: SkillCategory;
  readonly priority: Priority;
  readonly dependencies: string[];
  readonly description: string;

  initialize(config: SkillConfig): Promise<void>;
  canHandle(input: SkillInput): boolean | Promise<boolean>;
  execute(input: SkillInput): Promise<SkillOutput>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  getMetrics(): SkillMetrics;
}

// Skill co the goi skill khac qua SkillContext
interface SkillContext {
  invokeSkill(skillName: string, input: SkillInput): Promise<SkillOutput>;
  getMemory(): MemoryManager;
  getBrain(): BrainEngine;
  getLLM(): LLMClient;
  getConfig(): AppConfig;
}
```

### 2.2 Skill Registry

```typescript
// electron/services/skills/skill-registry.ts

class SkillRegistry {
  private skills: Map<string, CortexSkill> = new Map();
  private activeSkills: Set<string> = new Set();

  // Lifecycle
  register(skill: CortexSkill): void;
  unregister(skillName: string): void;
  activate(skillName: string): Promise<void>;
  deactivate(skillName: string): Promise<void>;

  // Discovery
  getSkill(name: string): CortexSkill | undefined;
  listSkills(filter?: { category?: SkillCategory; active?: boolean }): CortexSkill[];
  findSkillsForQuery(query: string): CortexSkill[];

  // Health
  healthCheckAll(): Promise<Map<string, HealthStatus>>;
}
```

### 2.3 Skill Router Flow

```
User Query
    |
    v
[Intent Classifier] -- Uses LLM to classify:
    |                    - code_question: 'How does auth work?'
    |                    - action_request: 'Fix the bug in auth.ts'
    |                    - memory_query: 'What did we decide about caching?'
    |                    - tool_use: 'Create a Jira ticket for this'
    |                    - general_chat: 'Explain REST vs GraphQL'
    |
    v
[Skill Selection]
    |-- code_question --> [RAG Skill] + [Memory Skill]
    |-- action_request --> [Agent Skill (ReAct)] + [Code Exec]
    |-- memory_query --> [Memory Skill] (direct archival search)
    |-- tool_use --> [MCP Skill] (route to specific tool)
    |-- general_chat --> [Chat Skill] (direct LLM, no RAG)
    |
    v
[Skill Pipeline] -- Skills execute in order:
    |  1. Memory Skill loads context
    |  2. Primary skill executes
    |  3. Sub-skills called as needed
    |
    v
[Efficiency Engine] -- Before LLM call:
    |  1. Check semantic cache
    |  2. Compress context (LLMLingua)
    |  3. Select model (Model Router)
    |  4. Track cost
    |
    v
[LLM Response] --> [Post-process] --> [Stream to UI]
```

---

## 3. Memory Architecture

### 3.1 Three-Tier Memory Model

```
+============================+
|     CORE MEMORY            |  <-- Luon trong system prompt (~2000 tokens)
|  +----------------------+  |
|  | user_profile:        |  |  - Coding style, language, preferences
|  |   'Senior TS dev,    |  |  - Updated by agent khi hoc duoc gi moi
|  |    prefers functional |  |
|  |    style, Vietnamese' |  |
|  +----------------------+  |
|  | project_context:     |  |  - Project tech stack, architecture
|  |   'Electron + React, |  |  - Key decisions, conventions
|  |    ChromaDB, SQLite'  |  |
|  +----------------------+  |
|  | preferences:         |  |  - Response format, detail level
|  |   'Detailed code     |  |  - Auto-updated from behavior
|  |    examples, Vi lang' |  |
|  +----------------------+  |
+============================+
            |
            v
+============================+
|     ARCHIVAL MEMORY        |  <-- Long-term, vector-searchable, unlimited
|  +----------------------+  |
|  | Past decisions       |  |  - 'We chose ChromaDB because...'
|  | Code patterns found  |  |  - 'Auth uses middleware pattern...'
|  | Debugging insights   |  |  - 'Race condition fix: use mutex...'
|  | Session summaries    |  |  - Auto-generated at session end
|  +----------------------+  |
|  Search: vector similarity  |
|  Size: unlimited            |
+============================+
            |
            v
+============================+
|     RECALL MEMORY          |  <-- Conversation history, searchable
|  +----------------------+  |
|  | Recent messages      |  |  - Last N messages in context
|  | Older messages       |  |  - Searchable but not in context
|  | Session metadata     |  |  - Duration, topics, satisfaction
|  +----------------------+  |
|  Auto-compaction: old       |
|  messages summarized        |
+============================+
```

### 3.2 Memory trong Query Pipeline

```
Query arrives
    |
    v
[1] Load Core Memory --> inject vao system prompt
    |
    v
[2] Search Archival Memory --> query relevant past decisions
    |   (top 3-5 relevant memories)
    |
    v
[3] Load Recall Memory --> recent conversation (last 10 messages)
    |   + search older relevant messages
    |
    v
[4] Compose Context = Core + Archival results + Recall + Retrieved code
    |
    v
[5] LLM call voi full context
    |
    v
[6] Post-response:
    |   - Save to Recall Memory
    |   - Agent co the update Core Memory (self-edit)
    |   - Agent co the archive important info
```

---

## 4. RAG Pipeline Architecture

### 4.1 Multi-Strategy Composition

```
User Query
    |
    v
[Query Analyzer]
    |-- Classify: simple | code-specific | multi-hop | uncertain | complex
    |
    +-- simple ---------> [Vector Search] ---------> answer
    |                      (existing hybrid search)
    |
    +-- code-specific --> [Contextual RAG] ---------> answer
    |                      (contextual chunks + vector)
    |
    +-- multi-hop ------> [GraphRAG] -----------------> answer
    |                      (graph traversal + vector)
    |
    +-- uncertain ------> [Self-RAG] -----------------> answer
    |                      (retrieve -> assess -> re-retrieve)
    |
    +-- complex --------> [RAG Fusion] ---------------> answer
                           (multi-query + RRF merge)
```

### 4.2 Knowledge Graph cho Code

```
Nodes:                        Edges:
+--------+                    +------------------+
| File   |----imports-------->| File             |
+--------+                    +------------------+
    |                              |
    | contains                     | contains
    v                              v
+--------+                    +------------------+
|Function|----calls---------->| Function         |
+--------+                    +------------------+
    |                              |
    | uses                         | inherits
    v                              v
+--------+                    +------------------+
|Variable|                    | Class            |
+--------+                    +------------------+
```

**Entity extraction dung Tree-sitter:**
- File nodes: moi file la 1 node
- Function nodes: extract functions/methods tu AST
- Class nodes: extract classes/interfaces
- Edge detection: import statements, function calls, class inheritance

---

## 5. Self-Learning Architecture

### 5.1 Behavioral Event Flow

```
User interaction
    |
    v
[Event Detector]
    |-- User continues without editing --> EVENT: accept
    |-- User edits response before using --> EVENT: edit (+ editDistance)
    |-- User asks same question again --> EVENT: reject
    |-- User copies code from response --> EVENT: code_applied
    |-- User asks follow-up --> EVENT: follow_up
    |-- Time between response and action --> EVENT: time_to_action
    |
    v
[Event Store] (SQLite: behavioral_events table)
    |
    v
[Analytics Engine] (runs periodically, or after N events)
    |
    +-- [DSPy Optimizer]
    |   Input: query-response pairs + accept/reject labels
    |   Output: optimized prompts
    |   Schedule: every 100 new events hoac weekly
    |
    +-- [Reranker Updater]
    |   Input: query + chunks used + accept/reject
    |   Output: updated reranking weights
    |   Schedule: every 50 new events
    |
    +-- [Preference Learner]
        Input: edit patterns, style corrections
        Output: updated Core Memory preferences
        Schedule: real-time (small updates)
```

### 5.2 DSPy Pipeline

```typescript
// Conceptual DSPy integration
interface DSPyPipeline {
  // Define signature
  signature: {
    input: ['query', 'code_context', 'memory_context'];
    output: ['answer', 'citations', 'confidence'];
  };

  // Collect training data from behavioral events
  collectExamples(): TrainingExample[];

  // Run optimization (calls DSPy Python via child_process)
  optimize(examples: TrainingExample[]): OptimizedPrompt;

  // Deploy optimized prompt
  deploy(prompt: OptimizedPrompt): void;

  // Track performance post-deploy
  evaluate(): { before: number; after: number; improvement: number };
}
```

---

## 6. Efficiency Architecture

### 6.1 Query Cost Pipeline

```
Query arrives
    |
    v
[1. Semantic Cache Check]
    |-- HIT (similarity > 0.92) --> return cached (cost: $0.00)
    |-- MISS --> continue
    |
    v
[2. Context Assembly]
    |-- Memory context (~2000 tokens)
    |-- Retrieved chunks (~3000 tokens)
    |-- Conversation history (~1000 tokens)
    |-- Total: ~6000 tokens
    |
    v
[3. LLMLingua Compression]
    |-- Compress retrieved chunks: 3000 -> 1200 tokens (-60%)
    |-- Compress history: 1000 -> 400 tokens (-60%)
    |-- Total after: ~3600 tokens (40% reduction)
    |
    v
[4. Model Routing]
    |-- Simple query --> GPT-4o-mini: $0.15/1M * 3600 = $0.0005
    |-- Medium query --> GPT-4o: $2.50/1M * 3600 = $0.009
    |-- Complex query --> Claude Opus: $15/1M * 3600 = $0.054
    |
    v
[5. LLM Call]
    |
    v
[6. Cache Response] --> store for future similar queries
[7. Track Cost] --> update daily/monthly totals
```

### 6.2 Model Registry

```typescript
const MODEL_REGISTRY: ModelRoute[] = [
  {
    id: 'fast-cheap',
    model: 'gpt-4o-mini',
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    qualityScore: 65,
    maxTokens: 16384,
    useFor: ['simple_chat', 'clarification', 'formatting']
  },
  {
    id: 'balanced',
    model: 'gpt-4o',
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
    qualityScore: 85,
    maxTokens: 128000,
    useFor: ['code_explanation', 'single_file_analysis', 'debugging']
  },
  {
    id: 'premium',
    model: 'claude-opus-4',
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    qualityScore: 98,
    maxTokens: 200000,
    useFor: ['architecture_analysis', 'multi_file', 'complex_reasoning']
  }
];
```

---

## 7. Database Schema (Complete)

```sql
-- ============ EXISTING (giu nguyen) ============
-- projects, repositories, conversations, messages, chunks, settings

-- ============ NEW: Memory System ============
CREATE TABLE core_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, section)
);

CREATE TABLE archival_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  relevance_score REAL DEFAULT 1.0
);

CREATE TABLE recall_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  timestamp INTEGER NOT NULL
);

-- ============ NEW: Knowledge Graph ============
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  content_hash TEXT,
  embedding BLOB,
  metadata TEXT
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT REFERENCES graph_nodes(id),
  target_id TEXT REFERENCES graph_nodes(id),
  type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  metadata TEXT
);

-- ============ NEW: Self-Learning ============
CREATE TABLE behavioral_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  query_id TEXT,
  response_id TEXT,
  skill_used TEXT,
  timestamp INTEGER NOT NULL,
  time_to_action INTEGER,
  edit_distance INTEGER,
  metadata TEXT
);

CREATE TABLE optimized_prompts (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  version INTEGER NOT NULL,
  metrics TEXT,
  created_at INTEGER NOT NULL,
  active BOOLEAN DEFAULT 0
);

-- ============ NEW: Efficiency ============
CREATE TABLE semantic_cache (
  id TEXT PRIMARY KEY,
  query_embedding BLOB NOT NULL,
  query_text TEXT NOT NULL,
  response TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ttl INTEGER,
  hit_count INTEGER DEFAULT 0
);

CREATE TABLE cost_tracking (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER DEFAULT 0,
  cost_usd REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  skill_used TEXT
);

-- ============ NEW: Skill Registry ============
CREATE TABLE skill_configs (
  skill_name TEXT PRIMARY KEY,
  active BOOLEAN DEFAULT 1,
  config TEXT,
  last_health_check INTEGER,
  health_status TEXT
);
```

---

## 8. File Structure (Proposed v2.0)

```
electron/
  main.ts                          <-- IPC handlers (extend)
  preload.ts
  services/
    memory/                        <-- NEW: Memory System
      types.ts
      core-memory.ts
      archival-memory.ts
      recall-memory.ts
      memory-manager.ts
      memory-db.ts
      migration.ts
      compaction.ts
      decay.ts
    skills/                        <-- NEW: Skill System
      types.ts
      skill-registry.ts
      skill-loader.ts
      skill-router.ts
      builtin/
        rag-skill.ts
        code-analysis-skill.ts
        chat-skill.ts
        memory-skill.ts
      rag/                         <-- NEW: Advanced RAG
        graphrag-skill.ts
        graph-builder.ts
        graph-db.ts
        rag-fusion-skill.ts
        self-rag-skill.ts
        crag-skill.ts
        adaptive-rag-skill.ts
        hyde-skill.ts
        contextual-chunk.ts
        parent-child-chunk.ts
        rag-router.ts
      learning/                    <-- NEW: Self-Learning
        event-collector.ts
        learning-db.ts
        feedback-detector.ts
        dspy-bridge.ts
        prompt-optimizer.ts
        preference-learning.ts
        active-learning.ts
      efficiency/                  <-- NEW: Efficiency
        llmlingua.ts
        semantic-cache.ts
        cache-key.ts
        model-router.ts
        model-registry.ts
        cost-tracker.ts
        token-budget.ts
      reasoning/                   <-- NEW: Reasoning
        react-skill.ts
        plan-execute-skill.ts
        reflexion-skill.ts
      agent/                       <-- NEW: Agent Mode
        code-executor.ts
        terminal.ts
        git-actions.ts
      mcp/                         <-- NEW: MCP Integration
        mcp-client.ts
        mcp-adapter.ts
        playwright-adapter.ts
    (existing services remain):
    agentic-rag.ts                 <-- Refactor to use new RAG skills
    architecture-analyzer.ts
    brain-engine.ts
    code-chunker.ts
    context-compressor.ts
    db.ts
    embedder.ts
    llm-client.ts
    vector-search.ts
    ...

src/
  components/
    memory/                        <-- NEW
      MemoryDashboard.tsx
      MemoryEditor.tsx
    skills/                        <-- NEW
      SkillManager.tsx
      SkillConfig.tsx
    efficiency/                    <-- NEW
      CostDashboard.tsx
    learning/                      <-- NEW
      LearningDashboard.tsx
    agent/                         <-- NEW
      AgentPanel.tsx
    (existing: chat/, layout/, onboarding/, project/, settings/, ui/)
  stores/
    memoryStore.ts                 <-- NEW
    skillStore.ts                  <-- NEW
    costStore.ts                   <-- NEW
    learningStore.ts               <-- NEW
    (existing: chatStore, projectStore, syncStore, uiStore)

tests/
  unit/
    memory/                        <-- NEW
    skills/                        <-- NEW
    rag/                           <-- NEW
    learning/                      <-- NEW
    efficiency/                    <-- NEW
    agent/                         <-- NEW
  ui/
    memory/                        <-- NEW
    skills/                        <-- NEW
```

---

## 9. Security Architecture

### Existing (giu nguyen va nang cap)
- contextIsolation: true, nodeIntegration: false
- Electron safeStorage cho API keys
- Prompt injection detection (15+ regex patterns)
- Audit trail cho moi action
- Memory isolation per project

### New Security cho v2.0
- **Skill Sandboxing:** Moi skill chay trong sandbox, khong truc tiep access file system
- **MCP Token Validation:** Validate tokens truoc khi connect MCP servers
- **Memory Sanitization:** Clean input truoc khi luu vao memory
- **Code Execution Sandbox:** Docker container voi no-network, limited CPU/RAM
- **Cost Budget Enforcement:** Hard cap per query va per day de chong runaway costs
- **Behavioral Data Privacy:** Events chi chua metadata, khong chua raw code

---

*Xem them: CORTEX_V2_STRATEGY.md, CORTEX_V2_SKILL_CATALOG.md, CORTEX_V2_SPRINT_PLAN.md*