# CORTEX v2.0 — SKILL CATALOG
## Danh Muc Ky Nang AI Toan Dien

**Ngay tao:** 03/03/2026
**Tong so skills:** 51 skills / 8 categories

---

## Skill Interface Contract (Base)

Moi skill trong Cortex PHAI implement interface sau:

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
**Effort:** 2 tuan
**File:** `electron/services/skills/rag/graphrag-skill.ts`

**Mo ta:** Ket hop knowledge graph voi vector search de tra loi cau hoi multi-hop. Thay vi chi search vector (tim chunks giong nhau), GraphRAG xay dung do thi quan he giua cac entities trong code (files, functions, classes, modules) va traverse do thi de tim cau tra loi.

**Cach hoat dong:**
1. **Entity Extraction:** Dung LLM + Tree-sitter de extract entities tu code (functions, classes, imports, exports)
2. **Relationship Mapping:** Xay dung edges: imports, calls, inherits, implements, uses
3. **Graph Storage:** Luu graph trong SQLite voi tables: graph_nodes, graph_edges
4. **Embedding:** Embed moi node voi context (file path + code + relationships)
5. **Query:** Khi user hoi, tim start nodes bang vector search, roi traverse graph de expand context
6. **Fusion:** Ket hop graph results + vector results bang Reciprocal Rank Fusion

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
- Agentic GraphRAG: Kiet hop voi multi-agent (2025 trend)

---

### 1.2 Self-RAG — Tu Danh Gia Chat Luong Retrieval

**Priority:** P1
**Effort:** 1 tuan
**File:** `electron/services/skills/rag/self-rag-skill.ts`

**Mo ta:** Thay vi luon trust ket qua retrieval, Self-RAG tu danh gia: (1) Co can retrieve khong? (2) Retrieved chunks co relevant khong? (3) Response co supported boi evidence khong? (4) Response co useful khong?

**Cach hoat dong:**
1. **Retrieval Decision:** LLM quyet dinh co can search khong (simple questions co the tra loi truc tiep)
2. **Relevance Check:** Sau khi retrieve, LLM danh gia tung chunk: relevant / partially relevant / irrelevant
3. **Filter:** Loai bo irrelevant chunks, giu relevant ones
4. **Generate:** Tao response tu relevant chunks
5. **Support Check:** LLM tu kiem tra response co duoc support boi evidence khong
6. **Iterate:** Neu support thap, quay lai buoc 1 voi refined query

**Dependencies:** llm-client, vector-search
**References:** Paper: Self-RAG (arxiv 2310.11511)

---

### 1.3 Corrective RAG (CRAG) — Tu Sua Retrieval Kem

**Priority:** P1
**Effort:** 1 tuan
**File:** `electron/services/skills/rag/crag-skill.ts`

**Mo ta:** Khi retrieval quality thap (confidence < threshold), CRAG tu dong: (1) Refine query, (2) Search lai voi strategy khac, (3) Fallback sang web search neu can.

**Cach hoat dong:**
1. **Retrieve:** Thuc hien vector search binh thuong
2. **Evaluate:** Dung cross-encoder danh gia relevance score
3. **Decision:**
   - Score > 0.7: CORRECT -> su dung truc tiep
   - Score 0.3-0.7: AMBIGUOUS -> refine query va search lai
   - Score < 0.3: INCORRECT -> rewrite query hoan toan, try khac strategy
4. **Correction:** Transform retrieved docs (loai bo irrelevant parts, highlight key info)

**Dependencies:** llm-client, vector-search, cross-encoder model
**References:** Paper: CRAG (arxiv 2401.15884)

---

### 1.4 Adaptive RAG — Tu Chon Strategy

**Priority:** P1
**Effort:** 1 tuan
**File:** `electron/services/skills/rag/adaptive-rag-skill.ts`

**Mo ta:** Phan tich query complexity de chon strategy phu hop:
- **No retrieval:** Cau hoi don gian, LLM tra loi truc tiep (tiet kiem tokens)
- **Single-hop:** Cau hoi cu the ve 1 file/function -> vector search don gian
- **Multi-hop:** Cau hoi phuc tap can ket noi nhieu pieces -> GraphRAG hoac iterative retrieval

**Cach hoat dong:**
1. **Classify:** LLM + heuristics phan loai query complexity (low/medium/high)
2. **Route:** Chon RAG strategy tuong ung
3. **Execute:** Chay strategy da chon
4. **Learn:** Luu lai classification results de cai thien classifier qua thoi gian (feedback loop)

**Dependencies:** llm-client, graphrag-skill, vector-search
**References:** Paper: Adaptive RAG (arxiv 2403.14403)

---

### 1.5 RAG Fusion — Multi-Query + Reciprocal Rank Fusion

**Priority:** P0
**Effort:** 3 ngay
**File:** `electron/services/skills/rag/rag-fusion-skill.ts`

**Mo ta:** Thay vi search bang 1 query goc, tao 3-5 query variants tu goc nhieu perspectives, search rieng, roi merge ket qua bang Reciprocal Rank Fusion (RRF).

**Cach hoat dong:**
1. **Query Generation:** LLM tao 3-5 variants cua query goc
   - Vi du: 'How does auth work?' -> 
     - 'authentication middleware implementation'
     - 'login signup handler code'
     - 'JWT token validation flow'
     - 'user session management'
2. **Parallel Search:** Search moi variant doc lap
3. **RRF Merge:** score(doc) = sum(1 / (k + rank_i)) for each query i
4. **Deduplicate:** Loai bo duplicate chunks
5. **Return:** Top-K merged results

**Dependencies:** vector-search, llm-client
**References:** LangChain RAG Fusion, Paper: Reciprocal Rank Fusion

---

### 1.6 HyDE — Hypothetical Document Embedding

**Priority:** P1
**Effort:** 2 ngay
**File:** `electron/services/skills/rag/hyde-skill.ts`

**Mo ta:** Thay vi embed query truc tiep (query ngan, khong du context), LLM tao 1 'hypothetical document' that SE tra loi query, roi dung document nay de search. Document giong code thuc hon, nen vector search chinh xac hon.

**Cach hoat dong:**
1. **Generate:** LLM tao hypothetical code/document se tra loi query
2. **Embed:** Embed hypothetical document (khong phai query)
3. **Search:** Tim chunks giong hypothetical document
4. **Answer:** Dung real chunks (khong phai hypothetical) de tra loi

**Dependencies:** llm-client, embedder, vector-search
**References:** Paper: HyDE (arxiv 2212.10496)

---

### 1.7 Contextual Retrieval — Anthropic Approach

**Priority:** P0
**Effort:** 3 ngay
**File:** `electron/services/skills/rag/contextual-retrieval-skill.ts`

**Mo ta:** Van de cua chunking truyen thong: moi chunk mat context (file nao? function nao? module nao?). Contextual Retrieval them context vao moi chunk TRUOC khi embed.

**Cach hoat dong:**
1. **Chunk:** Cat code thanh chunks (su dung Tree-sitter cho code-aware chunking)
2. **Add Context:** Voi moi chunk, prepend:
   - File path va language
   - Parent function/class name
   - Module description (tu doc string hoac architecture info)
   - Import/export relationships
3. **Embed:** Embed chunk DA CO context (embedding chinh xac hon)
4. **Store:** Luu contextual chunk vao vector DB

**Vi du:**
```
// TRUOC (chunk thong thuong):
function validateToken(token: string) { ... }

// SAU (contextual chunk):
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
**Effort:** 2 ngay
**File:** `electron/services/skills/rag/parent-child-chunk-skill.ts`

**Mo ta:** Tao 2 tang chunks: child chunks nho (de search chinh xac) va parent chunks lon (de co du context). Khi search, match child chunk nhung tra ve parent chunk.

**Cach hoat dong:**
1. **Parent Chunking:** Cat code thanh chunks lon (ca file hoac section lon)
2. **Child Chunking:** Cat moi parent thanh children nho (1 function, 1 class)
3. **Link:** Moi child giu reference den parent
4. **Search:** Search tren child chunks (nho, chinh xac)
5. **Return:** Tra ve parent chunk (lon, nhieu context)

**Dependencies:** code-chunker, vector-search
**References:** LlamaIndex Parent-Child Retriever

---

## Category 2: Self-Learning (6 skills)

### 2.1 DSPy Prompt Optimization
**Priority:** P0 | **Effort:** 2 tuan | **File:** `electron/services/skills/learning/dspy-skill.ts`

**Mo ta:** DSPy (Stanford) cho phep dinh nghia AI pipeline bang code (khong phai prompts). Sau do optimizer TU DONG tim prompts tot nhat dua tren metrics. Cortex dung DSPy de tu cai thien chat quality qua thoi gian.

**Cach hoat dong:**
1. **Define Signatures:** Dinh nghia input/output cho moi buoc (retrieve, reason, answer)
2. **Define Metrics:** Tao metric function (relevance score, user satisfaction proxy)
3. **Collect Examples:** Thu thap 50-100+ query-response pairs voi feedback
4. **Optimize:** Chay DSPy optimizer (MIPROv2 hoac BootstrapFewShot) de tim best prompts
5. **Deploy:** Cap nhat prompts trong Cortex, luu version cu de rollback
6. **Monitor:** Track metrics sau optimization, so sanh voi baseline

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

**Dependencies:** llm-client (Python DSPy co the goi qua child_process hoac re-implement core logic in TS)
**References:** dspy.ai, Paper: DSPy (Stanford 2023), MIPROv2 optimizer

---

### 2.2 Behavioral Analytics Engine
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/learning/behavioral-analytics.ts`

**Mo ta:** Thu thap IMPLICIT feedback tu user actions: accept/reject suggestion, edit after suggestion, time-to-accept, follow-up questions, copy-paste patterns.

**Events tracked:**
- `response_accepted`: User khong sua, tiep tuc conversation
- `response_edited`: User copy response nhung sua truoc khi dung
- `response_rejected`: User hoi lai cung topic (implicit rejection)
- `code_applied`: User copy code tu response va paste vao editor
- `follow_up_asked`: User hoi follow-up (response chua du)
- `time_to_action`: Thoi gian tu response den user action tiep theo
- `session_length`: Tong thoi gian session (engagement metric)

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

**Storage:** SQLite table `behavioral_events` voi indexes tren type, timestamp, skillUsed
**References:** GitHub Copilot personalization (workspace indexing), Letta skill learning

---

### 2.3 Learned Reranking
**Priority:** P1 | **Effort:** 1 tuan | **File:** `electron/services/skills/learning/learned-reranker.ts`

**Mo ta:** Cai thien search ranking dua tren user interactions. Khi user chap nhan response, cac chunks duoc used se duoc boost. Khi reject, chunks bi demote.

**Cach hoat dong:**
1. **Collect Signals:** Tu behavioral events, map response quality -> retrieved chunks
2. **Feature Extraction:** Cho moi chunk: vector similarity, BM25 score, graph distance, past usefulness
3. **Train Ranker:** Lightweight cross-encoder fine-tuned tren feedback data
4. **Apply:** Rerank search results truoc khi gui toi LLM
5. **Update:** Retrain periodically (moi 100 new events)

**Dependencies:** behavioral-analytics, vector-search, cross-encoder model
**References:** Learning to Rank (LTR), da co learned-reranker.ts can nang cap

---

### 2.4 Preference Learning
**Priority:** P1 | **Effort:** 1 tuan | **File:** `electron/services/skills/learning/preference-learning.ts`

**Mo ta:** Hoc coding style va preferences cua user: naming conventions, architecture patterns, response format, level of detail.

**Thu thap signals:**
- Cac edits user lam tren suggestions (style corrections)
- Code patterns trong repos cua user (naming, structure)
- Response format preferences (chi tiet vs tom tat)
- Language preferences (tieng Viet vs English)

**Storage:** Core Memory (luon trong system prompt) + Archival Memory (chi tiet)

---

### 2.5 Active Learning
**Priority:** P2 | **Effort:** 3 ngay | **File:** `electron/services/skills/learning/active-learning.ts`

**Mo ta:** Khi Cortex khong chac chan, HOI user thay vi doan. Nhung chi hoi khi cau tra loi se giup cai thien dang ke (khong hoi nhieu qua).

**Cach hoat dong:**
1. **Uncertainty Detection:** Khi confidence < 0.6, xem xet hoi user
2. **Value Estimation:** Cau tra loi cua user co gia tri bao nhieu cho training?
3. **Ask Strategy:** Hoi concise, specific, de tra loi (Yes/No hoac chon A/B)
4. **Learn:** Cap nhat memory va preferences tu cau tra loi

---

### 2.6 RLAIF (RL from AI Feedback)
**Priority:** P2 | **Effort:** 2 tuan | **File:** `electron/services/skills/learning/rlaif-skill.ts`

**Mo ta:** AI tu critique chinh minh. Sau khi generate response, 1 'critic' LLM danh gia va cho diem. Diem nay duoc dung de cai thien prompt/retrieval.

**Cach hoat dong:**
1. **Generate:** Tao response binh thuong
2. **Critique:** LLM khac (hoac cung model voi different prompt) danh gia:
   - Accuracy: Response co dung voi code khong?
   - Completeness: Co thieu gi quan trong khong?
   - Relevance: Co tra loi dung cau hoi khong?
3. **Score:** Tong hop diem tu 3 criteria
4. **Learn:** Dung scores de update DSPy optimization targets

**Dependencies:** llm-client, dspy-skill
**References:** Paper: RLAIF (Google 2023)

---

## Category 3: Memory System (5 skills)

### 3.1 Tiered Memory (Letta/MemGPT Inspired)
**Priority:** P0 | **Effort:** 2 tuan | **Files:** `electron/services/memory/`

**Mo ta:** Bo nho 3 tang giong OS:
- **Core Memory (~2000 tokens):** Luon trong system prompt. Chua user profile, project context, preferences. Agent co the TU EDIT.
- **Archival Memory (unlimited):** Long-term storage, vector-searchable. Chua past decisions, patterns, lessons learned.
- **Recall Memory (conversation):** Lich su hoi thoai, searchable theo content va time.

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
**Priority:** P0 | **Effort:** 3 ngay | **File:** `electron/services/memory/nano-brain-bridge.ts`

**Mo ta:** Da co nano-brain. Nang cap de lam backend cho Archival Memory tier. Giu compatibility voi existing data.

---

### 3.3 Cross-Session Learning
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/memory/cross-session.ts`

**Mo ta:** Agent nho va cai thien qua moi session. Khi bat dau session moi, load relevant memories tu archival. Khi ket thuc, tu dong summarize va archive key insights.

**Cach hoat dong:**
1. **Session Start:** Query archival memory voi current project context
2. **During Session:** Track important decisions, patterns discovered
3. **Session End:** Summarize session -> store in archival memory
4. **Next Session:** Previous insights available automatically

---

### 3.4 Memory Compaction
**Priority:** P1 | **Effort:** 3 ngay | **File:** `electron/services/memory/compaction.ts`

**Mo ta:** Khi archival memory qua lon, tu dong summarize va compact. Giu thong tin quan trong, loai bo chi tiet khong can thiet.

---

### 3.5 Memory Decay
**Priority:** P2 | **Effort:** 2 ngay | **File:** `electron/services/memory/decay.ts`

**Mo ta:** Thong tin cu va khong duoc truy cap se giam relevance score theo thoi gian. Thong tin outdated (code da thay doi) se duoc danh dau de cleanup.

---

## Category 4: Efficiency Engine (6 skills)

### 4.1 LLMLingua Context Compression
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/efficiency/llmlingua-skill.ts`

**Mo ta:** Nen context 3-6x truoc khi gui toi LLM. LLMLingua-2 loai bo tokens khong can thiet ma giu nguyen y nghia. Giam chi phi 60-80%.

**Cach hoat dong:**
1. **Input:** Retrieved chunks + conversation history + system prompt
2. **Compress:** LLMLingua-2 loai bo redundant tokens
3. **Validate:** Kiem tra compressed context van giu du thong tin
4. **Send:** Gui compressed context toi LLM (it tokens hon = re hon)

**Integration:** Goi qua Python child_process (LLMLingua la Python library) hoac port core logic sang TS
**References:** github.com/microsoft/LLMLingua, Integrated in LangChain + LlamaIndex

---

### 4.2 Semantic Caching
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/efficiency/semantic-cache.ts`

**Mo ta:** Cache responses dua tren SEMANTIC similarity (khong phai exact match). Neu user hoi tuong tu query truoc do, tra ve cached response thay vi goi LLM lai.

**Cach hoat dong:**
1. **Query Embedding:** Embed user query
2. **Cache Search:** Tim cached queries co similarity > 0.92
3. **Hit:** Tra ve cached response (0 tokens, instant)
4. **Miss:** Goi LLM binh thuong, cache response
5. **Invalidation:** Clear cache khi brain duoc re-sync

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
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/efficiency/model-router.ts`

**Mo ta:** Khong phai moi query can model dat nhat. Model routing phan loai query complexity va route:
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
  // Learn from feedback: if cheap model fails, escalate
}
```

---

### 4.4 Prompt Caching
**Priority:** P1 | **Effort:** 3 ngay | **File:** `electron/services/skills/efficiency/prompt-cache.ts`

**Mo ta:** System prompt + project context thuong giong nhau giua cac queries. Cache prefix nay de khong gui lai moi lan.

---

### 4.5 Adaptive Token Budget
**Priority:** P1 | **Effort:** 2 ngay | **File:** `electron/services/skills/efficiency/token-budget.ts`

**Mo ta:** Phan bo token budget dua tren query complexity. Simple query: 500 output tokens. Complex: 4000 output tokens. Tranh lang phi.

---

### 4.6 ChunkKV (KV Cache Compression)
**Priority:** P2 | **Effort:** 2 tuan | **File:** `electron/services/skills/efficiency/chunkkv-skill.ts`

**Mo ta:** Nen KV cache cua LLM theo semantic chunks thay vi individual tokens. Giam memory 70% cho long-context inference.
**References:** Paper: ChunkKV (NeurIPS 2025)

---

## Category 5: Agent/Tool Skills - MCP Based (9 skills)

### 5.1 MCP Protocol Core
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/mcp/mcp-client.ts`

**Mo ta:** Implementation cua MCP client de ket noi voi bat ky MCP server nao. La foundation cho tat ca tool integrations.

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

### 5.2-5.9: Playwright, GitHub, Jira, Confluence, Slack, Code Execution, Sequential Thinking, File System
Moi tool la 1 MCP server adapter wrap thanh CortexSkill. Chi tiet implementation giong nhau:
1. Connect to MCP server
2. Wrap available tools thanh skill methods
3. Handle errors va timeouts
4. Log usage cho cost tracking

---

## Category 6: Reasoning Skills (6 skills)

### 6.1 ReAct (Reasoning + Acting)
**Priority:** P0 | **Effort:** 1 tuan | **File:** `electron/services/skills/reasoning/react-skill.ts`

**Mo ta:** Loop: Thought -> Action -> Observation -> repeat cho den khi co answer.

```
Loop:
  1. THOUGHT: Suy nghi ve cach giai quyet
  2. ACTION: Thuc hien hanh dong (search, read file, run code)
  3. OBSERVATION: Quan sat ket qua
  4. Neu du thong tin -> ANSWER
  5. Neu chua -> quay lai buoc 1
```

### 6.2-6.6: Plan-and-Execute, Reflexion, LATS, Chain of Thought, Tree of Thoughts
Chi tiet tuong tu. Moi skill implement 1 reasoning pattern cu the.

---

## Category 7: Code Intelligence (6 skills)

### 7.1-7.6: Tree-sitter AST, AST-grep, LSP, Dependency Graph, Architecture Inference, Tech Debt
Da co architecture-analyzer.ts va code-chunker.ts. Nang cap thanh CortexSkill interface.
Them AST-grep cho pattern matching va LSP cho go-to-definition/references.

---

## Category 8: Fine-tuning & Local AI (5 skills)

### 8.1 Custom Embedding Fine-tuning
**Priority:** P1 | **Effort:** 2 tuan | **File:** `electron/services/skills/finetune/embedding-finetune.ts`

**Mo ta:** Train custom embedding model tren codebase cua ban. Embeddings se hieu code cua ban tot hon generic model.

**Cach hoat dong:**
1. **Generate Pairs:** Tao positive pairs (related code chunks) va negative pairs (unrelated)
2. **Fine-tune:** Dung sentence-transformers de fine-tune tren pairs
3. **Evaluate:** So sanh retrieval quality truoc/sau fine-tune
4. **Deploy:** Replace generic embedder voi custom model

### 8.2-8.5: LoRA, Synthetic Data, DPO, Local Model Serving
Advanced skills cho phase sau. LoRA can GPU, DPO can nhieu data.
Local Model Serving (Ollama) la P1 - cho phep offline mode.

---

## Tong Ket

| Category | So Skills | P0 | P1 | P2 |
|----------|-----------|----|----|-----|
| Advanced RAG | 8 | 3 | 5 | 0 |
| Self-Learning | 6 | 2 | 2 | 2 |
| Memory System | 5 | 3 | 1 | 1 |
| Efficiency Engine | 6 | 3 | 2 | 1 |
| Agent/Tool (MCP) | 9 | 3 | 4 | 2 |
| Reasoning | 6 | 2 | 2 | 2 |
| Code Intelligence | 6 | 3 | 2 | 1 |
| Fine-tuning | 5 | 0 | 3 | 2 |
| **TONG** | **51** | **19** | **21** | **11** |

**Sprint 13-18 se focus vao 19 P0 skills truoc, sau do P1, cuoi cung P2.**