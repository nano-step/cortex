export type ResponseMode = 'pm' | 'engineering'

export type ModelStatus = 'ready' | 'quota_exhausted' | 'unavailable'

export type ImportSourceType = 'local' | 'github'

export type BrainStatus = 'idle' | 'indexing' | 'ready' | 'error'

export interface Project {
  id: string
  name: string
  brainName: string // AI-generated 1-word name representing the project
  sourceType: ImportSourceType
  sourcePath: string // local path or github URL
  brainStatus: BrainStatus
  lastSyncAt: number | null
  createdAt: number
}

export interface ChatAttachment {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
  isImage: boolean
  base64?: string
  textContent?: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  mode: ResponseMode
  createdAt: number
  isStreaming?: boolean
  attachments?: ChatAttachment[]
}

export interface Conversation {
  id: string
  projectId: string
  title: string
  mode: ResponseMode
  branch: string
  pinned: boolean
  messages: Message[]
  createdAt: number
}

export interface IndexingProgress {
  repoId: string
  phase: 'scanning' | 'parsing' | 'chunking' | 'embedding' | 'done' | 'error'
  totalFiles: number
  processedFiles: number
  totalChunks: number
  currentFile?: string
  error?: string
}
export interface SyncProgress {
  repoId: string
  message: string
}

export interface SyncResult {
  success: boolean
  repoId?: string
  filesAdded?: number
  filesModified?: number
  filesDeleted?: number
  chunksAdded?: number
  chunksRemoved?: number
  error?: string
}

export type FeedbackSignalType = 'thumbs_up' | 'thumbs_down' | 'copy' | 'follow_up_quick' | 'follow_up_slow' | 'no_follow_up'

export type ThinkingStepId = 'sanitize' | 'memory' | 'rag' | 'external_context' | 'web_search' | 'build_prompt' | 'cache' | 'tool_call' | 'agent_init' | 'agent_mode' | 'orchestrate' | 'streaming' | 'routing'

export type ThinkingStepStatus = 'running' | 'done' | 'skipped' | 'error'

export interface ThinkingStep {
  conversationId: string
  step: ThinkingStepId
  status: ThinkingStepStatus
  label: string
  detail?: string
  durationMs?: number
}

export interface LearningStats {
  totalFeedback: number
  totalTrainingPairs: number
  totalLearnedWeights: number
  positiveRatio: number
  lastTrainedAt: number | null
  compressionSavings: { tokensOriginal: number; tokensCompressed: number; savingsPercent: number }
}

export interface ContextCompressionStats {
  originalTokens: number
  compressedTokens: number
  savingsPercent: number
  chunksSummary: Array<{ chunkType: string; original: number; compressed: number }>
}

// =====================
// V3: Hook System Types
// =====================
export type HookTrigger =
  | 'before:chat'
  | 'after:chat'
  | 'on:error'
  | 'on:stream'
  | 'before:delegation'
  | 'after:delegation'
  | 'on:model:switch'
  | 'on:context:overflow'
  | 'on:tool:call'
  | 'on:session:start'
  | 'on:session:end'

export type HookPriority = 'critical' | 'high' | 'normal' | 'low'

export interface HookInfo {
  id: string
  name: string
  description: string
  trigger: HookTrigger | HookTrigger[]
  priority: HookPriority
  enabled: boolean
  stats: {
    totalExecutions: number
    successCount: number
    errorCount: number
    avgLatencyMs: number
    lastExecutedAt: number | null
  }
}

export interface HookRunResult {
  modified: boolean
  aborted: boolean
  results: Array<{
    hookId: string
    success: boolean
    modified?: boolean
    abort?: boolean
    error?: string
    durationMs: number
  }>
}

// =====================
// V3: Category Routing Types
// =====================
export type TaskCategory =
  | 'deep'
  | 'visual-engineering'
  | 'ultrabrain'
  | 'artistry'
  | 'quick'
  | 'unspecified-low'
  | 'unspecified-high'
  | 'writing'

export interface RoutingDecision {
  category: TaskCategory
  model: string
  config: {
    category: TaskCategory
    description: string
    defaultModel: string
    fallbackChain: string[]
    temperature: number
    maxTokens: number
    thinkingBudget?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
    toolWhitelist?: string[]
    promptAppend?: string
  }
  confidence: number
  reason: string
}

// =====================
// V3: Background Task Types
// =====================
export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale'

export interface BackgroundTask {
  id: string
  description: string
  status: BackgroundTaskStatus
  category?: string
  agentType?: string
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  result?: unknown
  error?: string
  progress?: number
  metadata?: Record<string, unknown>
}

export interface ConcurrencyConfig {
  maxGlobal: number
  maxPerProvider: Record<string, number>
  maxPerCategory: Record<string, number>
  queueTimeout: number
  taskTimeout: number
}

export interface BackgroundTaskEvent {
  type: string
  task: BackgroundTask
  progress?: number
}

// =====================
// V3: Loop Engine Types
// =====================
export type LoopType = 'ralph' | 'ultrawork' | 'boulder'

export type LoopStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type LoopStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface LoopStep {
  id: string
  description: string
  status: LoopStepStatus
  result?: string
  error?: string
  startedAt: number | null
  completedAt: number | null
  iteration: number
}

export interface LoopState {
  id: string
  type: LoopType
  status: LoopStatus
  currentIteration: number
  steps: LoopStep[]
  startedAt: number | null
  completedAt: number | null
  lastActivityAt: number
  metadata: Record<string, unknown>
}

export interface LoopEvent {
  type: string
  state: LoopState
  iteration?: number
  step?: LoopStep
  error?: string
}

// =====================
// V3: Boulder State Types
// =====================
export interface BoulderState {
  loopId: string
  projectId: string
  sessionId: string
  checkpoint: Record<string, unknown>
  todoSnapshot: Array<{ content: string; status: string; priority: string }>
  filesModified: string[]
  createdAt: number
  updatedAt: number
}

// =====================
// V3: Agent Capability Types
// =====================
export type AgentRole =
  | 'orchestrator'
  | 'performance'
  | 'security'
  | 'review'
  | 'writer'
  | 'formatter'
  | 'feedback'
  | 'implementation'
  | 'knowledge-crystallizer'
  | 'sisyphus'
  | 'hephaestus'
  | 'prometheus'
  | 'atlas'
  | 'oracle'
  | 'explore'
  | 'librarian'

export interface AgentCapability {
  role: AgentRole
  toolWhitelist?: string[]
  canDelegate: boolean
  delegateTo?: AgentRole[]
  maxConcurrentDelegations?: number
  readOnly: boolean
  backgroundCapable: boolean
}

export type DelegationStatus = 'pending' | 'accepted' | 'running' | 'completed' | 'failed' | 'rejected'

export interface DelegationResult {
  requestId: string
  status: DelegationStatus
  fromAgent: AgentRole
  toAgent: AgentRole
  result?: string
  error?: string
  durationMs: number
}

declare global {
  interface Window {
    electronAPI: {
      platform: string

      // Dialogs
      openFolderDialog: () => Promise<string | null>
      openFileDialog: () => Promise<ChatAttachment[]>
      openFilesFromPaths: (paths: string[]) => Promise<ChatAttachment[]>

      // Project CRUD
      createProject: (name: string, brainName: string) => Promise<any>
      getAllProjects: () => Promise<any[]>
      deleteProject: (projectId: string) => Promise<boolean>
      renameProject: (projectId: string, newName: string) => Promise<boolean>
      getProjectStats: (projectId: string) => Promise<any>

      // Repository import
      importLocalRepo: (projectId: string, localPath: string) => Promise<{ repoId: string; status: string }>
      getReposByProject: (projectId: string) => Promise<any[]>
      importGithubRepo: (projectId: string, repoUrl: string, token?: string, branch?: string) => Promise<{ success: boolean; repoId?: string; error?: string; needsToken?: boolean }>
      checkGithubAccess: (repoUrl: string, token?: string) => Promise<{ accessible: boolean; isPrivate?: boolean; error?: string }>
      deleteRepo: (repoId: string) => Promise<{ success: boolean; error?: string }>

      // Brain search
      searchBrain: (projectId: string, query: string, limit?: number) => Promise<any[]>

      // Conversation CRUD
      createConversation: (projectId: string, title: string, mode: string, branch?: string) => Promise<any>
      getConversationsByProject: (projectId: string) => Promise<any[]>
      updateConversationTitle: (conversationId: string, title: string) => Promise<boolean>
      deleteConversation: (conversationId: string) => Promise<boolean>
      pinConversation: (conversationId: string) => Promise<boolean>

      // Message CRUD
      createMessage: (conversationId: string, role: string, content: string, mode: string, contextChunks?: string) => Promise<any>
      getMessagesByConversation: (conversationId: string) => Promise<any[]>
      updateMessageContent: (messageId: string, content: string) => Promise<boolean>

      // Chat with LLM
      sendChatMessage: (
        projectId: string,
        conversationId: string,
        query: string,
        mode: string,
        history: Array<{ role: string; content: string }>,
        attachments?: ChatAttachment[],
        agentMode?: string
      ) => Promise<{ success: boolean; content?: string; error?: string; contextChunks?: any[] }>
      abortChat: (conversationId: string) => Promise<boolean>

      // Sync
      syncRepo: (projectId: string, repoId: string) => Promise<SyncResult>
      startWatcher: (repoId: string, localPath: string) => Promise<boolean>
      stopWatcher: (repoId: string) => Promise<boolean>

      // Branch management
      listBranches: (repoId: string) => Promise<string[]>
      switchBranch: (projectId: string, repoId: string, branch: string) => Promise<{ success: boolean; error?: string }>
      getCurrentBranch: (repoId: string) => Promise<string>

      // LLM Models
      getActiveModel: () => Promise<string>
      getAvailableModels: () => Promise<Array<{ id: string; tier: number; active: boolean; status: ModelStatus }>>
      refreshModels: () => Promise<Array<{ id: string; tier: number }>>
      refreshModelsWithCheck: () => Promise<Array<{ id: string; tier: number; active: boolean; status: ModelStatus }>>
      setModel: (modelId: string) => Promise<{ success: boolean; model?: string; error?: string }>
      getAutoRotation: () => Promise<boolean>
      setAutoRotation: (enabled: boolean) => Promise<boolean>

      // Architecture Analysis
      analyzeArchitecture: (projectId: string) => Promise<{
        entryPoints: string[]
        hubFiles: { path: string; importedBy: number }[]
        layers: { name: string; files: string[] }[]
        dependencyGraph: { source: string; target: string }[]
        techStack: { name: string; version?: string }[]
        stats: { totalFiles: number; totalFunctions: number; totalClasses: number; totalInterfaces: number }
      }>

      // Impact & Estimate
      analyzeImpact: (projectId: string, changedFiles: string[]) => Promise<{
        affectedFiles: string[]
        affectedFunctions: string[]
        blastRadius: number
        riskLevel: 'low' | 'medium' | 'high'
      }>
      estimateFeature: (projectId: string, description: string) => Promise<{
        estimatedHours: number
        complexity: 'low' | 'medium' | 'high'
        affectedModules: string[]
        confidence: number
      }>

      // Brain Export/Import
      exportBrain: (projectId: string) => Promise<{ chunks: number; conversations: number } | null>
      importBrain: () => Promise<{ projectId: string; chunks: number } | null>

      // Settings
      getProxyConfig: () => Promise<{ url: string; key: string }>
      setProxyConfig: (url: string, key: string) => Promise<boolean>
      getLLMConfig: () => Promise<{ maxTokens: number; contextMessages: number }>
      setLLMConfig: (maxTokens: number, contextMessages: number) => Promise<boolean>
      getEmbeddingConfig: () => Promise<{ mode: string; model: string; dimensions: number; url: string; hasApiKey: boolean }>
      testEmbeddingConnection: () => Promise<{ success: boolean; dimensions?: number; latencyMs?: number; error?: string }>
      getQdrantConfig: () => Promise<{ url: string; apiKey: string }>
      setQdrantConfig: (url: string, apiKey: string) => Promise<boolean>
      getJinaApiKey: () => Promise<string>
      setJinaApiKey: (key: string) => Promise<boolean>
      readFileAsBase64: (path: string) => Promise<string>
      onGeneratedImage: (cb: (...args: unknown[]) => void) => void
      offGeneratedImage: (cb: (...args: unknown[]) => void) => void
      getHuggingFaceToken: () => Promise<string>
      setHuggingFaceToken: (token: string) => Promise<boolean>
      getVoyageApiKey: () => Promise<string>
      setVoyageApiKey: (key: string) => Promise<boolean>
      getVoyageModels: () => Promise<Array<{ id: string; name: string; dims: number; description: string }>>
      getSelectedVoyageModel: () => Promise<string>
      setSelectedVoyageModel: (modelId: string) => Promise<boolean>
      getOpenRouterConfig: () => Promise<{ apiKey: string; enabled: boolean; freeModels: unknown[] }>
      setOpenRouterApiKey: (key: string) => Promise<boolean>
      getPerplexityCookies: () => Promise<string>
      setPerplexityCookies: (cookies: string) => Promise<boolean>
      loginPerplexity: () => Promise<{ success: boolean; error?: string }>
      testPerplexity: () => Promise<{ success: boolean; latencyMs?: number; preview?: string; error?: string }>
      getGitConfig: () => Promise<{ cloneDepth: number }>
      setGitConfig: (cloneDepth: number) => Promise<boolean>
      testProxyConnection: (url: string, key: string) => Promise<{ success: boolean; error?: string; latencyMs?: number }>
      // Per-project Atlassian config
      getProjectAtlassianConfig: (projectId: string) => Promise<{ siteUrl: string; email: string; hasToken: boolean } | null>
      setProjectAtlassianConfig: (projectId: string, siteUrl: string, email: string, apiToken: string) => Promise<boolean>
      clearProjectAtlassianConfig: (projectId: string) => Promise<boolean>
      testProjectAtlassianConnection: (projectId: string) => Promise<{ success: boolean; serverInfo?: any; error?: string }>
      completeOnboarding: () => Promise<boolean>
      isOnboardingCompleted: () => Promise<boolean>

      // GitHub
      getGitHubPAT: () => Promise<boolean>
      setGitHubPAT: (token: string) => Promise<boolean>

      // Jira (per-project)
      testJiraConnection: (projectId: string) => Promise<{ success: boolean; serverInfo?: any; error?: string }>
      getJiraProjects: (projectId: string) => Promise<Array<{ id: string; key: string; name: string }>>
      importJiraProject: (projectId: string, jiraProjectKey: string) => Promise<{ success: boolean; issuesImported?: number; error?: string }>

      // Confluence (per-project)
      getConfluenceSpaces: (projectId: string) => Promise<Array<{ id: string; key: string; name: string }>>
      importConfluenceSpace: (projectId: string, spaceId: string, spaceKey: string) => Promise<{ success: boolean; pagesImported?: number; error?: string }>

      // Updater
      checkForUpdates: () => Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion?: string; releaseUrl?: string }>

      // Audit
      getAuditLog: (projectId?: string, limit?: number) => Promise<Array<{ id: number; event_type: string; project_id?: string; user_action?: string; details?: string; created_at: number }>>

      // Atlassian Connections
      getAtlassianConnections: (projectId: string) => Promise<any[]>
      syncAtlassianConnection: (projectId: string, connectionId: string) => Promise<{ success: boolean }>
      deleteAtlassianConnection: (connectionId: string) => Promise<boolean>

      // Nano-Brain
      getNanoBrainStatus: () => Promise<{ initialized: boolean; collections: string[]; totalChunks: number; embeddingStatus: string }>
      queryNanoBrain: (query: string, options?: { limit?: number; collection?: string }) => Promise<Array<{ content: string; filePath: string; score: number; collection: string }>>
      getNanoBrainCollections: () => Promise<string[]>
      triggerNanoBrainEmbed: () => Promise<boolean>

      // Self-Learning Engine
      sendFeedback: (messageId: string, conversationId: string, projectId: string, signalType: FeedbackSignalType, query: string, chunkIds: string[]) => Promise<boolean>
      getLearningStats: (projectId: string) => Promise<LearningStats>
      triggerLearning: (projectId: string) => Promise<{ trained: number; weights: number }>
      exportTrainingData: (projectId: string) => Promise<{ pairs: number; path: string } | null>

      // Agent Mode
      agentExecute?: (projectId: string, query: string, strategy?: string) => Promise<{ content: string }>
      agentAbort?: () => Promise<boolean>
      getSlashCommands?: () => Promise<Array<{ command: string; label: string; description: string; icon: string; skillName?: string; agentRole?: string }>>

      // Skill System
      skillList: (filter?: { category?: string; status?: string }) => Promise<Array<{
        name: string; version: string; category: string; priority: string
        status: string; description: string; dependencies: string[]
        metrics: { totalCalls: number; successCount: number; errorCount: number; avgLatencyMs: number; lastUsed: number | null }
        lastError?: string
      }>>
      skillActivate: (name: string) => Promise<boolean>
      skillDeactivate: (name: string) => Promise<boolean>
      skillExecute: (name: string, input: { query: string; projectId: string; conversationId?: string; mode?: string }) => Promise<{ content: string; metadata?: Record<string, unknown> } | null>
      skillRoute: (input: { query: string; projectId: string; mode?: string }) => Promise<{ content: string; metadata?: Record<string, unknown> } | null>
      skillHealth: () => Promise<Array<{ name: string; healthy: boolean; message?: string }>>

      // MCP Servers
      mcpList: () => Promise<Array<{
        id: string; name: string; transportType: 'stdio' | 'sse'
        command?: string; args?: string; serverUrl?: string
        enabled: boolean; connected: boolean; toolCount: number; resourceCount: number
        lastError?: string; lastChecked: number
      }>>
      mcpAdd: (config: {
        name: string; transportType: 'stdio' | 'sse'
        command?: string; args?: string; serverUrl?: string; env?: string
      }) => Promise<{
        id: string; name: string; transportType: 'stdio' | 'sse'
        command?: string; args?: string; serverUrl?: string
        enabled: boolean; connected: boolean; toolCount: number; resourceCount: number
        lastError?: string; lastChecked: number
      } | null>
      mcpRemove: (id: string) => Promise<boolean>
      mcpConnect: (id: string) => Promise<{ success: boolean; error?: string }>
      mcpDisconnect: (id: string) => Promise<boolean>
      mcpHealth: (id: string) => Promise<{ connected: boolean; toolCount: number; resourceCount: number; error?: string }>
      onModelDownloadProgress: (callback: (data: { model: string; status: string; progress?: number; file?: string }) => void) => () => void

      mcpGetPresets: () => Promise<Array<{
        id: string; name: string; description: string; category: string; iconName: string
        envVars: Array<{ name: string; label: string; placeholder: string; encrypted: boolean; required: boolean }>
        installed: boolean; configured: boolean; connected: boolean
      }>>
      mcpInstallPreset: (presetId: string, envValues: Record<string, string>) => Promise<any>

      // Events
      onIndexingProgress: (callback: (data: IndexingProgress) => void) => () => void
      onChatStream: (callback: (data: { conversationId: string; content: string; done: boolean }) => void) => () => void
      onChatThinking: (callback: (data: ThinkingStep) => void) => () => void
      onSyncProgress: (callback: (data: SyncProgress) => void) => () => void
      onFileChanged: (callback: (data: { repoId: string }) => void) => () => void
      onModelRotated: (callback: (data: { fromModel: string; reason: string; type: string }) => void) => () => void
      onAgentStep?: (callback: (data: { step: string; type: string; content: string }) => void) => () => void

      // V3: Hook System
      hooksList: () => Promise<HookInfo[]>
      hooksEnable: (hookId: string) => Promise<boolean>
      hooksDisable: (hookId: string) => Promise<boolean>
      hooksRun: (trigger: string, context: Record<string, unknown>) => Promise<HookRunResult>

      // V3: Category Routing
      routingResolve: (input: { prompt?: string; category?: string; slashCommand?: string }) => Promise<RoutingDecision>
      routingRouteModel: (category: string, availableModels: string[]) => Promise<string>

      // V3: Background Tasks
      backgroundLaunch: (options: {
        description: string; category?: string; agentType?: string
        provider?: string; priority?: number; metadata?: Record<string, unknown>
      }) => Promise<string>
      backgroundCancel: (taskId: string) => Promise<boolean>
      backgroundGet: (taskId: string) => Promise<BackgroundTask | null>
      backgroundGetAll: () => Promise<BackgroundTask[]>
      backgroundGetByStatus: (status: string) => Promise<BackgroundTask[]>
      backgroundCleanup: (olderThanMs?: number) => Promise<number>
      backgroundDetectStale: () => Promise<BackgroundTask[]>
      backgroundConcurrencyGet: () => Promise<ConcurrencyConfig>
      backgroundConcurrencySet: (config: Record<string, unknown>) => Promise<ConcurrencyConfig>

      onBackgroundTaskEvent: (callback: (data: BackgroundTaskEvent) => void) => () => void

      // V3: Loop Engine
      loopCreate: (type: LoopType, metadata?: Record<string, unknown>) => Promise<LoopState>
      loopGet: (loopId: string) => Promise<LoopState | null>
      loopGetAll: () => Promise<LoopState[]>
      loopGetByStatus: (status: string) => Promise<LoopState[]>
      loopPause: (loopId: string) => Promise<LoopState>
      loopResume: (loopId: string) => Promise<LoopState>
      loopCancel: (loopId: string) => Promise<LoopState>

      onLoopEvent: (callback: (data: LoopEvent) => void) => () => void

      // V3: Boulder State
      boulderGet: (loopId: string) => Promise<BoulderState | null>
      boulderGetByProject: (projectId: string) => Promise<BoulderState[]>
      boulderGetAll: () => Promise<BoulderState[]>
      boulderRestore: (loopId: string) => Promise<BoulderState | null>
      boulderDelete: (loopId: string) => Promise<boolean>
      boulderUpdateCheckpoint: (loopId: string, checkpoint: Record<string, unknown>) => Promise<BoulderState>

      // V3: Agent Capabilities
      capabilitiesGetAll: () => Promise<Record<string, AgentCapability>>
      capabilitiesGet: (role: string) => Promise<AgentCapability | null>
      capabilitiesCanDelegate: (from: string, to: string) => Promise<boolean>
      capabilitiesDelegationHistory: (fromAgent?: string) => Promise<DelegationResult[]>
    }
  }
}
