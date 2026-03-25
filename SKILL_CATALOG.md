# CORTEX v2.0 — SKILL CATALOG
## Comprehensive AI Skill Catalog

**Created:** 03/03/2026
**Total skills:** 51 skills / 8 categories

---

## Skill Interface Contract (Base)

Every skill in Cortex MUST implement the following interface:

```typescript
type SkillCategory = 'rag' | 'memory' | 'agent' | 'code' | 'learning' | 'efficiency' | 'reasoning' | 'tool';
type Priority = 'P0' | 'P1' | 'P2';

interface SkillConfig {
  projectId: string;
  settings: Record<string, unknown>;
  llmClient: LLMClient;
  memoryManager: MemoryManager;
  brainEngine: BrainEngine;
}

interface SkillInput {
  query: string;
  projectId: string;
  conversationId: string;
  context: {
    coreMemory: string;
    retrievedChunks: CodeChunk[];
    conversationHistory: Message[];
    userPreferences: UserPreferences;
  };
  config: Record<string, unknown>;
}

interface SkillOutput {
  response: string;
  citations: Citation[];
  confidence: number; // 0-1
  tokensUsed: { input: number; output: number; cached: number };
  skillChain: string[]; // which skills were invoked
  metadata: Record<string, unknown>;
}

interface SkillMetrics {
  totalCalls: number;
  avgLatencyMs: number;
  successRate: number;
  avgTokensPerCall: number;
  cacheHitRate: number;
  lastUsed: Date;
}

interface HealthStatus {
  healthy: boolean;
  message: string;
  lastCheck: Date;
  dependencies: { name: string; healthy: boolean }[];
}

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
```

---

## Category 1: Advanced RAG (8 skills)

### 1.1 GraphRAG — Knowledge Graph + Vector Search

**Priority:** P0
**Effort:** 2 weeks
**File:** `electron/services/skills/rag/graphrag-skill.ts`

**Description:** Combines a knowledge graph with vector search to answer multi-hop questions. Instead of only searching vectors (finding similar chunks), GraphRAG builds a relationship graph between code entities (files, functions, classes, modules) and traverses it to find answers.

**How it works:**
1. **Entity Extraction:** Uses LLM + Tree-sitter to extract entities from code (functions, classes, imports, exports)
2. **Relationship Mapping:** Builds edges: imports, calls, inherits, implements, uses
3. **Graph Storage:** Stores graph in SQLite with tables: graph_nodes, graph_edges
4. **Embedding:** Embeds each node with context (file path + code + relationships)
5. **Query:** When user asks, finds start nodes via vector search, then traverses the graph to expand context
6. **Fusion:** Combines graph results + vector results via Reciprocal Rank Fusion

**Integration:**
```typescript
class GraphRAGSkill implements CortexSkill {
  name = 'graphrag';
  category = 'rag' as const;
  priority = 'P0' as const;

  async buildGraph(projectId: string): Promise<void> {
    // 1. Scan all files with Tree-sitter
    // 2. Extract entities (functions, classes, imports)
    // 3. Build edges (calls, imports, inherits)
    // 4. Store in SQLite graph tables
    // 5. Embed nodes with context
  }

  async execute(input: SkillInput): Promise<SkillOutput> {
    // 1. Vector search for relevant nodes
    // 2. Graph traversal (BFS 2-3 hops)
    // 3. Collect context from traversed nodes
    // 4. Merge with vector search results
    // 5. Send to LLM with graph context
  }
}
```

**Dependencies:** better-sqlite3, web-tree-sitter, embedder
**References:**
- Microsoft GraphRAG: github.com/microsoft/graphrag
- Paper: From Local to Global (Microsoft Research 2024)
- Agentic GraphRAG: Combined with multi-agent (2025 trend)

---

### 1.2 Self-RAG — Self-Evaluating Retrieval Quality

**Priority:** P1
**Effort:** 1 week
**File:** `electron/services/skills/rag/self-rag-skill.ts`

**Description:** Instead of always trusting retrieval results, Self-RAG self-evaluates: (1) Is retrieval needed? (2) Are retrieved chunks relevant? (3) Is the response supported by evidence? (4) Is the response useful?

**How it works:**
1. **Retrieval Decision:** LLM decides whether a search is needed (simple questions can be answered directly)
2. **Relevance Check:** After retrieval, LLM rates each chunk: relevant / partially relevant / irrelevant
3. **Filter:** Removes irrelevant chunks, keeps relevant ones
4. **Generate:** Creates response from relevant chunks
5. **Support Check:** LLM self-checks whether the response is supported by evidence
6. **Iterate:** If support is low, goes back to step 1 with a refined query

**Dependencies:** llm-client, vector-search
**References:** Paper: Self-RAG (arxiv 2310.11511)

---

### 1.3 Corrective RAG (CRAG) — Auto-Correcting Poor Retrieval

**Priority:** P1
**Effort:** 1 week
**File:** `electron/services/skills/rag/crag-skill.ts`

**Description:** When retrieval quality is low (confidence < threshold), CRAG automatically: (1) refines query, (2) re-searches with a different strategy, (3) falls back to web search if needed.

**How it works:**
1. **Retrieve:** Performs normal vector search
2. **Evaluate:** Uses cross-encoder to score relevance
3. **Decision:**
   - Score > 0.7: CORRECT → use directly
   - Score 0.3–0.7: AMBIGUOUS → refine query and re-search
   - Score < 0.3: INCORRECT → completely rewrite query, try different strategy
4. **Correction:** Transforms retrieved docs (removes irrelevant parts, highlights key info)

**Dependencies:** llm-client, vector-search, cross-encoder model
**References:** Paper: CRAG (arxiv 2401.15884)

---

### 1.4 Adaptive RAG — Auto-Selecting Strategy

**Priority:** P1
**Effort:** 1 week
**File:** `electron/services/skills/rag/adaptive-rag-skill.ts`

**Description:** Analyzes query complexity to select the right strategy:
- **No retrieval:** Simple questions, LLM answers directly (saves tokens)
- **Single-hop:** Specific question about 1 file/function → simple vector search
- **Multi-hop:** Complex question requiring connecting multiple pieces → GraphRAG or iterative retrieval

**How it works:**
1. **Classify:** LLM + heuristics classify query complexity (low/medium/high)
2. **Route:** Selects corresponding RAG strategy
3. **Execute:** Runs the selected strategy
4. **Learn:** Saves classification results to improve the classifier over time (feedback loop)

**Dependencies:** llm-client, graphrag-skill, vector-search
**References:** Paper: Adaptive RAG (arxiv 2403.14403)

---

### 1.5 RAG Fusion — Multi-Query + Reciprocal Rank Fusion

**Priority:** P0
**Effort:** 3 days
**File:** `electron/services/skills/rag/rag-fusion-skill.ts`

**Description:** Instead of searching with 1 original query, generates 3–5 query variants from multiple perspectives, searches separately, then merges results via Reciprocal Rank Fusion (RRF).

**How it works:**
1. **Query Generation:** LLM generates 3–5 variants of the original query
   - Example: 'How does auth work?' →
     - 'authentication middleware implementation'
     - 'login signup handler code'
     - 'JWT token validation flow'
     - 'user session management'
2. **Parallel Search:** Searches each variant independently
3. **RRF Merge:** score(doc) = sum(1 / (k + rank_i)) for each query i
4. **Deduplicate:** Removes duplicate chunks
5. **Return:** Top-K merged results

**Dependencies:** vector-search, llm-client
**References:** LangChain RAG Fusion, Paper: Reciprocal Rank Fusion

---

### 1.6 HyDE — Hypothetical Document Embedding

**Priority:** P1
**Effort:** 2 days
**File:** `electron/services/skills/rag/hyde-skill.ts`

**Description:** Instead of embedding the query directly (short query, insufficient context), LLM generates a 'hypothetical document' that WOULD answer the query, then uses that document for search. The document resembles real code, making vector search more accurate.

**How it works:**
1. **Generate:** LLM creates a hypothetical code/document that would answer the query
2. **Embed:** Embeds the hypothetical document (not the query)
3. **Search:** Finds chunks similar to the hypothetical document
4. **Answer:** Uses real chunks (not the hypothetical) to generate the response

**Dependencies:** llm-client, embedder, vector-search
**References:** Paper: HyDE (arxiv 2212.10496)

---

### 1.7 Contextual Retrieval — Anthropic Approach

**Priority:** P0
**Effort:** 3 days
**File:** `electron/services/skills/rag/contextual-retrieval-skill.ts`

**Description:** Problem with traditional chunking: each chunk loses context (which file? which function? which module?). Contextual Retrieval adds context to each chunk BEFORE embedding.

**How it works:**
1. **Chunk:** Splits code into chunks (using Tree-sitter for code-aware chunking)
2. **Add Context:** For each chunk, prepend:
   - File path and language
   - Parent function/class name
   - Module description (from docstring or architecture info)
   - Import/export relationships
3. **Embed:** Embeds the chunk WITH context (more accurate embedding)
4. **Store:** Saves contextual chunk to vector DB

**Example:**
```
// BEFORE (regular chunk):
function validateToken(token: string) { ... }

// AFTER (contextual chunk):
// File: src/auth/middleware.ts
// Module: Authentication
// Parent: AuthMiddleware class
// Imports: jsonwebtoken, config
// Description: Validates JWT token from request header
function validateToken(token: string) { ... }
```

**Dependencies:** code-chunker, embedder, tree-sitter
**References:** Anthropic Blog (Nov 2024): Contextual Retrieval

---

### 1.8 Parent-Child Chunking

**Priority:** P1
**Effort:** 2 days
**File:** `electron/services/skills/rag/parent-child-chunk-skill.ts`

**Description:** Creates 2 tiers of chunks: small child chunks (for precise search) and large parent chunks (for sufficient context). When searching, matches child chunks but returns parent chunks.

**How it works:**
1. **Parent Chunking:** Splits code into large chunks (entire file or large section)
2. **Child Chunking:** Splits each parent into small children (1 function, 1 class)
3. **Link:** Each child keeps a reference to its parent
4. **Search:** Searches on child chunks (small, precise)
5. **Return:** Returns parent chunk (large, more context)

**Dependencies:** code-chunker, vector-search
**References:** LlamaIndex Parent-Child Retriever

---

## Category 2: Self-Learning (6 skills)

### 2.1 DSPy Prompt Optimization
**Priority:** P0 | **Effort:** 2 weeks | **File:** `electron/services/skills/learning/dspy-skill.ts`

**Description:** DSPy (Stanford) lets you define AI pipelines in code (not prompts). The optimizer then AUTOMATICALLY finds the best prompts based on metrics. Cortex uses DSPy to self-improve response quality over time.

**How it works:**
1. **Define Signatures:** Defines input/output for each step (retrieve, reason, answer)
2. **Define Metrics:** Creates a metric function (relevance score, user satisfaction proxy)
3. **Collect Examples:** Collects 50–100+ query-response pairs with feedback
4. **Optimize:** Runs DSPy optimizer (MIPROv2 or BootstrapFewShot) to find the best prompts
5. **Deploy:** Updates prompts in Cortex, saves old version for rollback
6. **Monitor:** Tracks metrics after optimization, compares to baseline

```typescript
// DSPy-inspired TypeScript implementation
interface DSPySignature {
  name: string;
  inputs: { name: string; type: string; description: string }[];
  outputs: { name: string; type: string; description: string }[];
}

class DSPySkill implements CortexSkill {
  name = 'dspy-optimizer';
  
  async optimize(
    signature: DSPySignature,
    examples: TrainingExample[],
    metric: (pred: any, expected: any) => number
  ): Promise<OptimizedPrompt> {
    // 1. Generate prompt candidates
    // 2. Evaluate each on examples using metric
    // 3. Select best performing prompt
    // 4. Store in prompt registry
  }
}
```

**Dependencies:** llm-client (Python DSPy can be called via child_process or core logic re-implemented in TS)
**References:** dspy.ai, Paper: DSPy (Stanford 2023), MIPROv2 optimizer

---

### 2.2 Behavioral Analytics Engine
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/learning/behavioral-analytics.ts`

**Description:** Collects IMPLICIT feedback from user actions: accept/reject suggestion, edit after suggestion, time-to-accept, follow-up questions, copy-paste patterns.

**Events tracked:**
- `response_accepted`: User does not edit, continues conversation
- `response_edited`: User copies response but modifies before using
- `response_rejected`: User asks the same topic again (implicit rejection)
- `code_applied`: User copies code from response and pastes into editor
- `follow_up_asked`: User asks a follow-up (response was insufficient)
- `time_to_action`: Time from response to next user action
- `session_length`: Total session duration (engagement metric)

```typescript
interface BehavioralEvent {
  id: string;
  type: 'accept' | 'reject' | 'edit' | 'ignore' | 'follow_up' | 'code_applied';
  queryId: string;
  responseId: string;
  skillUsed: string;
  timestamp: number;
  timeToAction: number;
  editDistance?: number;
  metadata: Record<string, unknown>;
}
```

**Storage:** SQLite table `behavioral_events` with indexes on type, timestamp, skillUsed
**References:** GitHub Copilot personalization (workspace indexing), Letta skill learning

---

### 2.3 Learned Reranking
**Priority:** P1 | **Effort:** 1 week | **File:** `electron/services/skills/learning/learned-reranker.ts`

**Description:** Improves search ranking based on user interactions. When a user accepts a response, the chunks used are boosted. When rejected, chunks are demoted.

**How it works:**
1. **Collect Signals:** From behavioral events, maps response quality → retrieved chunks
2. **Feature Extraction:** For each chunk: vector similarity, BM25 score, graph distance, past usefulness
3. **Train Ranker:** Lightweight cross-encoder fine-tuned on feedback data
4. **Apply:** Reranks search results before sending to LLM
5. **Update:** Retrains periodically (every 100 new events)

**Dependencies:** behavioral-analytics, vector-search, cross-encoder model
**References:** Learning to Rank (LTR), existing learned-reranker.ts needs upgrade

---

### 2.4 Preference Learning
**Priority:** P1 | **Effort:** 1 week | **File:** `electron/services/skills/learning/preference-learning.ts`

**Description:** Learns the user's coding style and preferences: naming conventions, architecture patterns, response format, level of detail.

**Signals collected:**
- Edits the user makes on suggestions (style corrections)
- Code patterns in the user's repos (naming, structure)
- Response format preferences (detailed vs. summary)
- Language preferences (English vs. other)

**Storage:** Core Memory (always in system prompt) + Archival Memory (details)

---

### 2.5 Active Learning
**Priority:** P2 | **Effort:** 3 days | **File:** `electron/services/skills/learning/active-learning.ts`

**Description:** When Cortex is uncertain, ASK the user instead of guessing. But only asks when the answer would significantly improve learning (not over-asking).

**How it works:**
1. **Uncertainty Detection:** When confidence < 0.6, considers asking the user
2. **Value Estimation:** How much is the user's answer worth for training?
3. **Ask Strategy:** Asks concisely, specifically, easy to answer (Yes/No or choose A/B)
4. **Learn:** Updates memory and preferences from the answer

---

### 2.6 RLAIF (RL from AI Feedback)
**Priority:** P2 | **Effort:** 2 weeks | **File:** `electron/services/skills/learning/rlaif-skill.ts`

**Description:** AI critiques itself. After generating a response, a 'critic' LLM evaluates and scores it. The score is used to improve prompt/retrieval.

**How it works:**
1. **Generate:** Creates a normal response
2. **Critique:** A different LLM (or same model with different prompt) evaluates:
   - Accuracy: Is the response correct with respect to the code?
   - Completeness: Is anything important missing?
   - Relevance: Does it answer the actual question?
3. **Score:** Aggregates score from all 3 criteria
4. **Learn:** Uses scores to update DSPy optimization targets

**Dependencies:** llm-client, dspy-skill
**References:** Paper: RLAIF (Google 2023)

---

## Category 3: Memory System (5 skills)

### 3.1 Tiered Memory (Letta/MemGPT Inspired)
**Priority:** P0 | **Effort:** 2 weeks | **Files:** `electron/services/memory/`

**Description:** 3-tier memory like an OS:
- **Core Memory (~2000 tokens):** Always in the system prompt. Contains user profile, project context, preferences. Agent can SELF-EDIT.
- **Archival Memory (unlimited):** Long-term storage, vector-searchable. Contains past decisions, patterns, lessons learned.
- **Recall Memory (conversation):** Conversation history, searchable by content and time.

```typescript
interface MemoryManager {
  core: CoreMemory;      // Always in context
  archival: ArchivalMemory; // Long-term, searchable
  recall: RecallMemory;    // Conversation history
  
  loadContext(projectId: string): Promise<MemoryContext>;
  updateCore(key: string, value: string): Promise<void>;
  archiveMemory(content: string, metadata: any): Promise<void>;
  searchArchival(query: string, limit?: number): Promise<Memory[]>;
  searchRecall(query: string, limit?: number): Promise<Message[]>;
}
```

**References:** Letta (github.com/letta-ai/letta), MemGPT paper (UC Berkeley)

---

### 3.2 Nano-Brain Integration (Upgrade)
**Priority:** P0 | **Effort:** 3 days | **File:** `electron/services/memory/nano-brain-bridge.ts`

**Description:** nano-brain already exists. Upgrade it to serve as the backend for the Archival Memory tier. Maintain compatibility with existing data.

---

### 3.3 Cross-Session Learning
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/memory/cross-session.ts`

**Description:** Agent remembers and improves across every session. At the start of a new session, loads relevant memories from archival. At the end, automatically summarizes and archives key insights.

**How it works:**
1. **Session Start:** Queries archival memory with current project context
2. **During Session:** Tracks important decisions, patterns discovered
3. **Session End:** Summarizes session → stores in archival memory
4. **Next Session:** Previous insights available automatically

---

### 3.4 Memory Compaction
**Priority:** P1 | **Effort:** 3 days | **File:** `electron/services/memory/compaction.ts`

**Description:** When archival memory grows too large, automatically summarizes and compacts it. Keeps important information, discards unnecessary details.

---

### 3.5 Memory Decay
**Priority:** P2 | **Effort:** 2 days | **File:** `electron/services/memory/decay.ts`

**Description:** Old and rarely-accessed information has its relevance score reduced over time. Outdated information (code that has since changed) is flagged for cleanup.

---

## Category 4: Efficiency Engine (6 skills)

### 4.1 LLMLingua Context Compression
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/efficiency/llmlingua-skill.ts`

**Description:** Compresses context 3–6x before sending to LLM. LLMLingua-2 removes unnecessary tokens while preserving meaning. Reduces cost by 60–80%.

**How it works:**
1. **Input:** Retrieved chunks + conversation history + system prompt
2. **Compress:** LLMLingua-2 removes redundant tokens
3. **Validate:** Checks that compressed context still contains sufficient information
4. **Send:** Sends compressed context to LLM (fewer tokens = cheaper)

**Integration:** Called via Python child_process (LLMLingua is a Python library) or core logic ported to TS
**References:** github.com/microsoft/LLMLingua, Integrated in LangChain + LlamaIndex

---

### 4.2 Semantic Caching
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/efficiency/semantic-cache.ts`

**Description:** Caches responses based on SEMANTIC similarity (not exact match). If the user asks a similar query to a previous one, returns the cached response instead of calling the LLM again.

**How it works:**
1. **Query Embedding:** Embeds the user query
2. **Cache Search:** Finds cached queries with similarity > 0.92
3. **Hit:** Returns cached response (0 tokens, instant)
4. **Miss:** Calls LLM normally, caches the response
5. **Invalidation:** Clears cache when the brain is re-synced

```typescript
interface SemanticCache {
  get(queryEmbedding: number[], threshold?: number): Promise<CachedResponse | null>;
  set(queryEmbedding: number[], query: string, response: string, ttl?: number): Promise<void>;
  invalidate(projectId: string): Promise<void>;
  getStats(): { hits: number; misses: number; hitRate: number };
}
```

**References:** GPTCache (github.com/zilliztech/GPTCache)

---

### 4.3 Model Routing
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/efficiency/model-router.ts`

**Description:** Not every query needs the most expensive model. Model routing classifies query complexity and routes accordingly:
- **Simple** (greeting, clarification): GPT-4o-mini ($0.15/1M tokens)
- **Medium** (code explanation, single-file): GPT-4o ($2.50/1M tokens)
- **Complex** (architecture, multi-file, debugging): Claude Opus / o1 ($15/1M tokens)

```typescript
interface ModelRoute {
  model: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  qualityScore: number;
  avgLatencyMs: number;
}

class ModelRouter {
  classifyComplexity(query: string, context: SkillContext): 'low' | 'medium' | 'high';
  selectModel(complexity: string): ModelRoute;
    // Learns from feedback: if cheap model fails, escalates
}
```

---

### 4.4 Prompt Caching
**Priority:** P1 | **Effort:** 3 days | **File:** `electron/services/skills/efficiency/prompt-cache.ts`

**Description:** System prompt + project context are usually the same across queries. Caches this prefix so it is not re-sent every time.

---

### 4.5 Adaptive Token Budget
**Priority:** P1 | **Effort:** 2 days | **File:** `electron/services/skills/efficiency/token-budget.ts`

**Description:** Allocates token budget based on query complexity. Simple query: 500 output tokens. Complex: 4000 output tokens. Prevents waste.

---

### 4.6 ChunkKV (KV Cache Compression)
**Priority:** P2 | **Effort:** 2 weeks | **File:** `electron/services/skills/efficiency/chunkkv-skill.ts`

**Description:** Compresses the LLM's KV cache by semantic chunks instead of individual tokens. Reduces memory by 70% for long-context inference.
**References:** Paper: ChunkKV (NeurIPS 2025)

---

## Category 5: Agent/Tool Skills - MCP Based (9 skills)

### 5.1 MCP Protocol Core
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/mcp/mcp-client.ts`

**Description:** Implementation of the MCP client for connecting to any MCP server. This is the foundation for all tool integrations.

```typescript
interface MCPClient {
  connect(serverConfig: MCPServerConfig): Promise<MCPConnection>;
  listTools(connection: MCPConnection): Promise<MCPTool[]>;
  callTool(connection: MCPConnection, tool: string, args: any): Promise<MCPResult>;
  listResources(connection: MCPConnection): Promise<MCPResource[]>;
  readResource(connection: MCPConnection, uri: string): Promise<any>;
}
```

**References:** modelcontextprotocol.io, 5800+ MCP servers (2025)

### 5.2–5.9: Playwright, GitHub, Jira, Confluence, Slack, Code Execution, Sequential Thinking, File System
Each tool is an MCP server adapter wrapped as a CortexSkill. Implementation details are the same for all:
1. Connect to MCP server
2. Wrap available tools as skill methods
3. Handle errors and timeouts
4. Log usage for cost tracking

---

## Category 6: Reasoning Skills (6 skills)

### 6.1 ReAct (Reasoning + Acting)
**Priority:** P0 | **Effort:** 1 week | **File:** `electron/services/skills/reasoning/react-skill.ts`

**Description:** Loop: Thought → Action → Observation → repeat until answer is found.

```
Loop:
  1. THOUGHT: Think about how to solve the problem
  2. ACTION: Perform an action (search, read file, run code)
  3. OBSERVATION: Observe the result
  4. If enough information → ANSWER
  5. If not → go back to step 1
```

### 6.2–6.6: Plan-and-Execute, Reflexion, LATS, Chain of Thought, Tree of Thoughts
Details are similar. Each skill implements one specific reasoning pattern.

---

## Category 7: Code Intelligence (6 skills)

### 7.1–7.6: Tree-sitter AST, AST-grep, LSP, Dependency Graph, Architecture Inference, Tech Debt
Existing `architecture-analyzer.ts` and `code-chunker.ts`. Upgrade to the CortexSkill interface.
Add AST-grep for pattern matching and LSP for go-to-definition/references.

---

## Category 8: Fine-tuning & Local AI (5 skills)

### 8.1 Custom Embedding Fine-tuning
**Priority:** P1 | **Effort:** 2 weeks | **File:** `electron/services/skills/finetune/embedding-finetune.ts`

**Description:** Trains a custom embedding model on your codebase. The embeddings will understand your code better than a generic model.

**How it works:**
1. **Generate Pairs:** Creates positive pairs (related code chunks) and negative pairs (unrelated)
2. **Fine-tune:** Uses sentence-transformers to fine-tune on the pairs
3. **Evaluate:** Compares retrieval quality before/after fine-tuning
4. **Deploy:** Replaces the generic embedder with the custom model

### 8.2–8.5: LoRA, Synthetic Data, DPO, Local Model Serving
Advanced skills for a later phase. LoRA requires GPU, DPO requires more data.
Local Model Serving (Ollama) is P1 — enables offline mode.

---

## Summary

| Category | Skills | P0 | P1 | P2 |
|----------|--------|----|----|-----|
| Advanced RAG | 8 | 3 | 5 | 0 |
| Self-Learning | 6 | 2 | 2 | 2 |
| Memory System | 5 | 3 | 1 | 1 |
| Efficiency Engine | 6 | 3 | 2 | 1 |
| Agent/Tool (MCP) | 9 | 3 | 4 | 2 |
| Reasoning | 6 | 2 | 2 | 2 |
| Code Intelligence | 6 | 3 | 2 | 1 |
| Fine-tuning | 5 | 0 | 3 | 2 |
| **TOTAL** | **51** | **19** | **21** | **11** |

**Sprints 13–18 focus on the 19 P0 skills first, then P1, then P2.**