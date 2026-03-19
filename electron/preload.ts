import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // System dialogs
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFiles'),
  openFilesFromPaths: (paths: string[]) => ipcRenderer.invoke('dialog:openFilesFromPaths', paths),

  // Project CRUD
  createProject: (name: string, brainName: string) =>
    ipcRenderer.invoke('project:create', name, brainName),
  getAllProjects: () => ipcRenderer.invoke('project:getAll'),
  deleteProject: (projectId: string) =>
    ipcRenderer.invoke('project:delete', projectId),
  renameProject: (projectId: string, newName: string) =>
    ipcRenderer.invoke('project:rename', projectId, newName),
  getProjectStats: (projectId: string) =>
    ipcRenderer.invoke('project:stats', projectId),

  // Repository import
  importLocalRepo: (projectId: string, localPath: string) =>
    ipcRenderer.invoke('repo:importLocal', projectId, localPath),
  getReposByProject: (projectId: string) =>
    ipcRenderer.invoke('repo:getByProject', projectId),
  importGithubRepo: (projectId: string, repoUrl: string, token?: string, branch?: string) =>
    ipcRenderer.invoke('repo:importGithub', projectId, repoUrl, token, branch),
  checkGithubAccess: (repoUrl: string, token?: string) =>
    ipcRenderer.invoke('github:checkAccess', repoUrl, token),
  deleteRepo: (repoId: string) =>
    ipcRenderer.invoke('repo:delete', repoId),

  // Brain search
  searchBrain: (projectId: string, query: string, limit?: number) =>
    ipcRenderer.invoke('brain:search', projectId, query, limit),

  // Conversation CRUD
  createConversation: (projectId: string, title: string, mode: string, branch?: string) =>
    ipcRenderer.invoke('conversation:create', projectId, title, mode, branch),
  getConversationsByProject: (projectId: string) =>
    ipcRenderer.invoke('conversation:getByProject', projectId),
  updateConversationTitle: (conversationId: string, title: string) =>
    ipcRenderer.invoke('conversation:updateTitle', conversationId, title),
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('conversation:delete', conversationId),
  pinConversation: (conversationId: string) =>
    ipcRenderer.invoke('conversation:pin', conversationId),

  // Message CRUD
  createMessage: (conversationId: string, role: string, content: string, mode: string, contextChunks?: string) =>
    ipcRenderer.invoke('message:create', conversationId, role, content, mode, contextChunks),
  getMessagesByConversation: (conversationId: string) =>
    ipcRenderer.invoke('message:getByConversation', conversationId),
  updateMessageContent: (messageId: string, content: string) =>
    ipcRenderer.invoke('message:updateContent', messageId, content),

  // Chat with LLM
  sendChatMessage: (
    projectId: string,
    conversationId: string,
    query: string,
    mode: string,
    history: Array<{ role: string; content: string }>,
    attachments?: Array<{ id: string; name: string; path: string; size: number; mimeType: string; isImage: boolean; base64?: string; textContent?: string }>,
    agentMode?: string
  ) => ipcRenderer.invoke('chat:send', projectId, conversationId, query, mode, history, attachments, agentMode),
  abortChat: (conversationId: string) =>
    ipcRenderer.invoke('chat:abort', conversationId),

  // Events from main process
  onIndexingProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('indexing:progress', handler)
    return () => ipcRenderer.removeListener('indexing:progress', handler)
  },

  onChatStream: (callback: (data: { conversationId: string; content: string; done: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:stream', handler)
    return () => ipcRenderer.removeListener('chat:stream', handler)
  },

  onChatThinking: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:thinking', handler)
    return () => ipcRenderer.removeListener('chat:thinking', handler)
  },

  // Sync
  syncRepo: (projectId: string, repoId: string) =>
    ipcRenderer.invoke('sync:repo', projectId, repoId),
  startWatcher: (repoId: string, localPath: string) =>
    ipcRenderer.invoke('sync:startWatcher', repoId, localPath),
  stopWatcher: (repoId: string) =>
    ipcRenderer.invoke('sync:stopWatcher', repoId),

  onSyncProgress: (callback: (data: { repoId: string; message: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('sync:progress', handler)
    return () => ipcRenderer.removeListener('sync:progress', handler)
  },

  onFileChanged: (callback: (data: { repoId: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('sync:fileChanged', handler)
    return () => ipcRenderer.removeListener('sync:fileChanged', handler)
  },

  // Branch management
  listBranches: (repoId: string) =>
    ipcRenderer.invoke('branch:list', repoId),
  switchBranch: (projectId: string, repoId: string, branch: string) =>
    ipcRenderer.invoke('branch:switch', projectId, repoId, branch),
  getCurrentBranch: (repoId: string) =>
    ipcRenderer.invoke('branch:getCurrent', repoId),


  // LLM Models
  getActiveModel: () => ipcRenderer.invoke('llm:getActiveModel'),
  getAvailableModels: () => ipcRenderer.invoke('llm:getAvailableModels'),
  refreshModels: () => ipcRenderer.invoke('llm:refreshModels'),
  refreshModelsWithCheck: () => ipcRenderer.invoke('llm:refreshModelsWithCheck'),
  setModel: (modelId: string) => ipcRenderer.invoke('llm:setModel', modelId),
  getAutoRotation: () => ipcRenderer.invoke('llm:getAutoRotation'),
  setAutoRotation: (enabled: boolean) => ipcRenderer.invoke('llm:setAutoRotation', enabled),

  onModelRotated: (callback: (data: { fromModel: string; reason: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('llm:modelRotated', handler)
    return () => ipcRenderer.removeListener('llm:modelRotated', handler)
  },

  // Architecture Analysis
  analyzeArchitecture: (projectId: string) => ipcRenderer.invoke('architecture:analyze', projectId),

  // Impact & Estimate
  analyzeImpact: (projectId: string, changedFiles: string[]) =>
    ipcRenderer.invoke('impact:analyze', projectId, changedFiles),
  estimateFeature: (projectId: string, description: string) =>
    ipcRenderer.invoke('estimate:feature', projectId, description),

  // Brain Export/Import
  exportBrain: (projectId: string) => ipcRenderer.invoke('brain:export', projectId),
  importBrain: () => ipcRenderer.invoke('brain:import'),

  // Settings
  getProxyConfig: () => ipcRenderer.invoke('settings:getProxyConfig'),
  setProxyConfig: (url: string, key: string) => ipcRenderer.invoke('settings:setProxyConfig', url, key),
  getLLMConfig: () => ipcRenderer.invoke('settings:getLLMConfig'),
  setLLMConfig: (maxTokens: number, contextMessages: number) =>
    ipcRenderer.invoke('settings:setLLMConfig', maxTokens, contextMessages),
  getEmbeddingConfig: () => ipcRenderer.invoke('settings:getEmbeddingConfig'),
  testEmbeddingConnection: () => ipcRenderer.invoke('settings:testEmbeddingConnection'),
  getQdrantConfig: () => ipcRenderer.invoke('settings:getQdrantConfig'),
  setQdrantConfig: (url: string, apiKey: string) => ipcRenderer.invoke('settings:setQdrantConfig', url, apiKey),
  getJinaApiKey: () => ipcRenderer.invoke('settings:getJinaApiKey'),
  setJinaApiKey: (key: string) => ipcRenderer.invoke('settings:setJinaApiKey', key),
  getVoyageApiKey: () => ipcRenderer.invoke('settings:getVoyageApiKey'),
  setVoyageApiKey: (key: string) => ipcRenderer.invoke('settings:setVoyageApiKey', key),
  getVoyageModels: () => ipcRenderer.invoke('settings:getVoyageModels'),
  getSelectedVoyageModel: () => ipcRenderer.invoke('settings:getSelectedVoyageModel'),
  setSelectedVoyageModel: (modelId: string) => ipcRenderer.invoke('settings:setSelectedVoyageModel', modelId),
  getOpenRouterConfig: () => ipcRenderer.invoke('openrouter:getConfig'),
  setOpenRouterApiKey: (key: string) => ipcRenderer.invoke('openrouter:setApiKey', key),
  getPerplexityCookies: () => ipcRenderer.invoke('settings:getPerplexityCookies'),
  setPerplexityCookies: (cookies: string) => ipcRenderer.invoke('settings:setPerplexityCookies', cookies),
  loginPerplexity: () => ipcRenderer.invoke('settings:loginPerplexity'),
  testPerplexity: () => ipcRenderer.invoke('settings:testPerplexity'),
  getGitConfig: () => ipcRenderer.invoke('settings:getGitConfig'),
  setGitConfig: (cloneDepth: number) => ipcRenderer.invoke('settings:setGitConfig', cloneDepth),
  testProxyConnection: (url: string, key: string) =>
    ipcRenderer.invoke('settings:testProxyConnection', url, key),
  // Per-project Atlassian config
  getProjectAtlassianConfig: (projectId: string) => ipcRenderer.invoke('atlassian:getConfig', projectId),
  setProjectAtlassianConfig: (projectId: string, siteUrl: string, email: string, apiToken: string) =>
    ipcRenderer.invoke('atlassian:setConfig', projectId, siteUrl, email, apiToken),
  clearProjectAtlassianConfig: (projectId: string) => ipcRenderer.invoke('atlassian:clearConfig', projectId),
  testProjectAtlassianConnection: (projectId: string) => ipcRenderer.invoke('atlassian:testConnection', projectId),
  completeOnboarding: () => ipcRenderer.invoke('settings:completeOnboarding'),
  isOnboardingCompleted: () => ipcRenderer.invoke('settings:isOnboardingCompleted'),

  // Jira (per-project)
  testJiraConnection: (projectId: string) => ipcRenderer.invoke('jira:testConnection', projectId),
  getJiraProjects: (projectId: string) => ipcRenderer.invoke('jira:getProjects', projectId),
  importJiraProject: (projectId: string, jiraProjectKey: string) =>
    ipcRenderer.invoke('jira:importProject', projectId, jiraProjectKey),

  // Confluence (per-project)
  getConfluenceSpaces: (projectId: string) => ipcRenderer.invoke('confluence:getSpaces', projectId),
  importConfluenceSpace: (projectId: string, spaceId: string, spaceKey: string) =>
    ipcRenderer.invoke('confluence:importSpace', projectId, spaceId, spaceKey),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),

  // Audit
  getAuditLog: (projectId?: string, limit?: number) =>
    ipcRenderer.invoke('audit:getLog', projectId, limit),

  // Atlassian Connections (BrainDashboard)
  getAtlassianConnections: (projectId: string) =>
    ipcRenderer.invoke('atlassian:getConnections', projectId),
  syncAtlassianConnection: (projectId: string, connectionId: string) =>
    ipcRenderer.invoke('atlassian:syncConnection', projectId, connectionId),
  deleteAtlassianConnection: (connectionId: string) =>
    ipcRenderer.invoke('atlassian:deleteConnection', connectionId),

  // Self-Learning Engine
  sendFeedback: (messageId: string, conversationId: string, projectId: string, signalType: string, query: string, chunkIds: string[]) =>
    ipcRenderer.invoke('learning:sendFeedback', messageId, conversationId, projectId, signalType, query, chunkIds),
  getLearningStats: (projectId: string) =>
    ipcRenderer.invoke('learning:getStats', projectId),
  triggerLearning: (projectId: string) =>
    ipcRenderer.invoke('learning:train', projectId),
  exportTrainingData: (projectId: string) =>
    ipcRenderer.invoke('learning:exportData', projectId),

  // GitHub
  getGitHubPAT: () => ipcRenderer.invoke('github:getPAT'),
  setGitHubPAT: (token: string) => ipcRenderer.invoke('github:setPAT', token),

  // Nano-Brain
  getNanoBrainStatus: () => ipcRenderer.invoke('nanobrain:status'),
  queryNanoBrain: (query: string, options?: { limit?: number; collection?: string }) =>
    ipcRenderer.invoke('nanobrain:query', query, options),
  getNanoBrainCollections: () => ipcRenderer.invoke('nanobrain:collections'),
  triggerNanoBrainEmbed: () => ipcRenderer.invoke('nanobrain:embed'),

  // =====================
  // V2: Memory System
  // =====================
  memoryCoreGet: (projectId: string) =>
    ipcRenderer.invoke('memory:core:get', projectId),
  memoryCoreUpdate: (projectId: string, section: string, content: string) =>
    ipcRenderer.invoke('memory:core:update', projectId, section, content),
  memoryCoreDelete: (projectId: string, section: string) =>
    ipcRenderer.invoke('memory:core:delete', projectId, section),
  memoryCorePrompt: (projectId: string) =>
    ipcRenderer.invoke('memory:core:prompt', projectId),
  memoryArchivalSearch: (projectId: string, query: string, limit?: number) =>
    ipcRenderer.invoke('memory:archival:search', projectId, query, limit),
  memoryArchivalAdd: (projectId: string, content: string, metadata?: Record<string, unknown>) =>
    ipcRenderer.invoke('memory:archival:add', projectId, content, metadata),
  memoryArchivalList: (projectId: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke('memory:archival:list', projectId, limit, offset),
  memoryArchivalDelete: (id: string) =>
    ipcRenderer.invoke('memory:archival:delete', id),
  memoryRecallSearch: (projectId: string, query: string, limit?: number) =>
    ipcRenderer.invoke('memory:recall:search', projectId, query, limit),
  memoryRecallConversation: (projectId: string, conversationId: string, limit?: number) =>
    ipcRenderer.invoke('memory:recall:conversation', projectId, conversationId, limit),
  memoryRecallRecent: (projectId: string, limit?: number) =>
    ipcRenderer.invoke('memory:recall:recent', projectId, limit),
  memorySearch: (projectId: string, query: string, limit?: number) =>
    ipcRenderer.invoke('memory:search', projectId, query, limit),
  memoryStats: (projectId: string) =>
    ipcRenderer.invoke('memory:stats', projectId),
  memoryMigrate: (projectId: string) =>
    ipcRenderer.invoke('memory:migrate', projectId),
  memoryBuildPrompt: (projectId: string) =>
    ipcRenderer.invoke('memory:buildPrompt', projectId),

  // =====================
  // V2: Skill System
  // =====================
  skillList: (filter?: { category?: string, status?: string }) =>
    ipcRenderer.invoke('skill:list', filter),
  skillActivate: (name: string) =>
    ipcRenderer.invoke('skill:activate', name),
  skillDeactivate: (name: string) =>
    ipcRenderer.invoke('skill:deactivate', name),
  skillExecute: (name: string, input: { query: string, projectId: string, conversationId?: string, mode?: string }) =>
    ipcRenderer.invoke('skill:execute', name, input),
  skillRoute: (input: { query: string, projectId: string, mode?: string }) =>
    ipcRenderer.invoke('skill:route', input),
  skillHealth: () =>
    ipcRenderer.invoke('skill:health'),

  // =====================
  // V2: Efficiency / Cost
  // =====================
  costStats: (projectId: string) =>
    ipcRenderer.invoke('cost:stats', projectId),
  costHistory: (projectId: string, days?: number) =>
    ipcRenderer.invoke('cost:history', projectId, days),
  cacheStats: () =>
    ipcRenderer.invoke('cache:stats'),
  cacheInvalidate: () =>
    ipcRenderer.invoke('cache:invalidate'),

  // =====================
  // V2: Agent Mode
  // =====================
  agentExecute: (projectId: string, query: string, strategy?: string) =>
    ipcRenderer.invoke('agent:execute', projectId, query, strategy),
  agentAbort: () =>
    ipcRenderer.invoke('agent:abort'),

  onAgentStep: (callback: (data: { step: string, type: string, content: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('agent:step', handler)
    return () => ipcRenderer.removeListener('agent:step', handler)
  },

  // V2: Slash Commands
  getSlashCommands: () => ipcRenderer.invoke('agents:list'),

  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (config: { name: string; transportType: 'stdio' | 'sse'; command?: string; args?: string; serverUrl?: string; env?: string }) =>
    ipcRenderer.invoke('mcp:add', config),
  mcpRemove: (id: string) => ipcRenderer.invoke('mcp:remove', id),
  mcpConnect: (id: string) => ipcRenderer.invoke('mcp:connect', id),
  mcpDisconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
  mcpHealth: (id: string) => ipcRenderer.invoke('mcp:health', id),
  onModelDownloadProgress: (callback: (data: { model: string; status: string; progress?: number; file?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('model:downloadProgress', handler)
    return () => ipcRenderer.removeListener('model:downloadProgress', handler)
  },

  mcpGetPresets: () => ipcRenderer.invoke('mcp:getPresets'),
  mcpInstallPreset: (presetId: string, envValues: Record<string, string>) =>
    ipcRenderer.invoke('mcp:installPreset', presetId, envValues),

  // V3: Hook System
  hooksList: () => ipcRenderer.invoke('hooks:list'),
  hooksEnable: (hookId: string) => ipcRenderer.invoke('hooks:enable', hookId),
  hooksDisable: (hookId: string) => ipcRenderer.invoke('hooks:disable', hookId),
  hooksRun: (trigger: string, context: Record<string, unknown>) =>
    ipcRenderer.invoke('hooks:run', trigger, context),

  // V3: Category Routing
  routingResolve: (input: { prompt?: string; category?: string; slashCommand?: string }) =>
    ipcRenderer.invoke('routing:resolve', input),
  routingRouteModel: (category: string, availableModels: string[]) =>
    ipcRenderer.invoke('routing:routeModel', category, availableModels),

  // V3: Background Tasks
  backgroundLaunch: (options: { description: string; category?: string; agentType?: string; provider?: string; priority?: number; metadata?: Record<string, unknown> }) =>
    ipcRenderer.invoke('background:launch', options),
  backgroundCancel: (taskId: string) =>
    ipcRenderer.invoke('background:cancel', taskId),
  backgroundGet: (taskId: string) =>
    ipcRenderer.invoke('background:get', taskId),
  backgroundGetAll: () =>
    ipcRenderer.invoke('background:getAll'),
  backgroundGetByStatus: (status: string) =>
    ipcRenderer.invoke('background:getByStatus', status),
  backgroundCleanup: (olderThanMs?: number) =>
    ipcRenderer.invoke('background:cleanup', olderThanMs),
  backgroundDetectStale: () =>
    ipcRenderer.invoke('background:detectStale'),
  backgroundConcurrencyGet: () =>
    ipcRenderer.invoke('background:concurrency:get'),
  backgroundConcurrencySet: (config: Record<string, unknown>) =>
    ipcRenderer.invoke('background:concurrency:set', config),

  onBackgroundTaskEvent: (callback: (data: { type: string; task: Record<string, unknown> }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('background:taskEvent', handler)
    return () => ipcRenderer.removeListener('background:taskEvent', handler)
  },

  // V3: Loop Engine
  loopCreate: (type: 'ralph' | 'ultrawork' | 'boulder', metadata?: Record<string, unknown>) =>
    ipcRenderer.invoke('loop:create', type, metadata),
  loopGet: (loopId: string) =>
    ipcRenderer.invoke('loop:get', loopId),
  loopGetAll: () =>
    ipcRenderer.invoke('loop:getAll'),
  loopGetByStatus: (status: string) =>
    ipcRenderer.invoke('loop:getByStatus', status),
  loopPause: (loopId: string) =>
    ipcRenderer.invoke('loop:pause', loopId),
  loopResume: (loopId: string) =>
    ipcRenderer.invoke('loop:resume', loopId),
  loopCancel: (loopId: string) =>
    ipcRenderer.invoke('loop:cancel', loopId),

  onLoopEvent: (callback: (data: { type: string; state: Record<string, unknown> }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('loop:event', handler)
    return () => ipcRenderer.removeListener('loop:event', handler)
  },

  // V3: Boulder State
  boulderGet: (loopId: string) =>
    ipcRenderer.invoke('boulder:get', loopId),
  boulderGetByProject: (projectId: string) =>
    ipcRenderer.invoke('boulder:getByProject', projectId),
  boulderGetAll: () =>
    ipcRenderer.invoke('boulder:getAll'),
  boulderRestore: (loopId: string) =>
    ipcRenderer.invoke('boulder:restore', loopId),
  boulderDelete: (loopId: string) =>
    ipcRenderer.invoke('boulder:delete', loopId),
  boulderUpdateCheckpoint: (loopId: string, checkpoint: Record<string, unknown>) =>
    ipcRenderer.invoke('boulder:updateCheckpoint', loopId, checkpoint),

  // V3: Agent Capabilities
  capabilitiesGetAll: () =>
    ipcRenderer.invoke('capabilities:getAll'),
  capabilitiesGet: (role: string) =>
    ipcRenderer.invoke('capabilities:get', role),
  capabilitiesCanDelegate: (from: string, to: string) =>
    ipcRenderer.invoke('capabilities:canDelegate', from, to),
  capabilitiesDelegationHistory: (fromAgent?: string) =>
    ipcRenderer.invoke('capabilities:delegationHistory', fromAgent),
})
