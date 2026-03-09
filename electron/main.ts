import { app, BrowserWindow, shell, ipcMain, dialog, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDb, closeDb, projectQueries, repoQueries, repoTreeQueries, conversationQueries, messageQueries } from './services/db'
import { indexLocalRepository, searchChunks, searchChunksHybrid, getProjectStats } from './services/brain-engine'
import { agenticRetrieve } from './services/agentic-rag'
import { loadAndRegisterAllAgents } from './services/agents/agent-loader'
import { orchestrate } from './services/agents/agent-orchestrator'
import { initNanoBrain, getNanoBrainStatus, queryNanoBrain, listCollections, triggerEmbedding } from './services/nano-brain-service'
import { randomUUID } from 'crypto'
import { buildPrompt, streamChatCompletion, fetchAvailableModels, getActiveModel, getAvailableModels, setActiveModel, setMainWindow, getAutoRotation, setAutoRotation, clearAuthFailedModels, type ChatMode, type ChatMessage, type ProjectContext } from './services/llm-client'
import { cloneRepository, checkRepoAccess, storeGitHubToken, getGitHubToken, listBranches, getCurrentBranch } from './services/git-service'
import { syncGithubRepo, syncLocalRepo, startFileWatcher, stopFileWatcher, stopAllWatchers, indexBranch } from './services/sync-engine'
import { analyzeArchitecture } from './services/architecture-analyzer'
import { analyzeImpact } from './services/impact-analyzer'
import { estimateFeature } from './services/estimate-service'
import { exportBrain, importBrain } from './services/brain-export'
import { checkForUpdates } from './services/updater-service'
import { logEvent, getAuditLog } from './services/audit-service'
import { sanitizePrompt } from './services/validator'
import { existsSync, rmSync, readFileSync, statSync } from 'fs'
import {
  initSettingsTable, getProxyConfig, setProxyConfig, getLLMConfig, setLLMConfig,
  getGitConfig, setGitConfig, testProxyConnection, getSetting, setSetting,
  getGitHubPAT, setGitHubPAT
} from './services/settings-service'
import { testJiraConnection, fetchJiraProjects } from './services/jira-service'
import { fetchSpaces } from './services/confluence-service'
import {
  getProjectAtlassianConfig, setProjectAtlassianConfig,
  clearProjectAtlassianConfig, hasProjectAtlassianConfig
} from './services/atlassian-config-service'
import { recordFeedbackSignal, convertSignalsToTrainingPairs, getFeedbackStats } from './services/feedback-collector'
import { trainFromPairs, getLearnedWeightCount } from './services/learned-reranker'
import { initDefaultVariant } from './services/query-optimizer'
import { estimateTokens } from './services/context-compressor'
import { registerContextSource, extractAndFetchAllContext } from './services/context-registry'
import { JiraContextSource } from './services/jira-context-source'
import { ConfluenceContextSource } from './services/confluence-context-source'
import { GitHubContextSource } from './services/github-context-source'
import { WebSearchContextSource } from './services/websearch-context-source'

// V2: Memory System
import {
  initMemory, buildMemoryPrompt, searchMemory, getMemoryStats,
  saveInteraction, loadMemoryContext, compactMemory,
  updateCoreMemory, getCoreMemory, addArchivalMemory, deleteArchivalMemory,
  addRecallMemory, deleteConversationRecall
} from './services/memory/memory-manager'
import { getCoreMemoryForPrompt, getCoreMemorySection } from './services/memory/core-memory'
import { searchArchivalMemory, getArchivalMemories } from './services/memory/archival-memory'
import { searchRecallMemory, getConversationRecall, getRecentRecall } from './services/memory/recall-memory'
import { runMigration, getMigrationStatus } from './services/memory/migration'

// V2: Skill System
import { registerSkill, listSkills, activateSkill, deactivateSkill, executeSkill, getHealthReport, shutdownAll } from './services/skills/skill-registry'
import { executeRouted } from './services/skills/skill-router'
import { loadAndRegisterAll } from './services/skills/skill-loader'
import { detectWebSearchTrigger, searchWeb, webResultsToChunkContent } from './services/websearch-service'

// V2: MCP Manager
import { listMCPServers, addMCPServer, removeMCPServer, connectMCPServer, disconnectMCPServer, checkMCPServerHealth, shutdownAllMCP, autoConnectMCPServers, getToolDefinitions, executeMCPTool } from './services/skills/mcp/mcp-manager'

// V2: Efficiency Engine
import { initCostSchema, recordUsage, estimateCost } from './services/skills/efficiency/cost-tracker'
import { initCacheSchema, getCachedResponse, cacheResponse, invalidateCacheForQuery } from './services/skills/efficiency/semantic-cache'

// V2: Learning Engine
import { recordEvent } from './services/skills/learning/event-collector'
import { optimizePrompt } from './services/skills/learning/prompt-optimizer'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = join(__dirname, '../../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#FAF9F7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize database
  try {
    getDb()
    initSettingsTable()
    registerContextSource(new JiraContextSource())
    registerContextSource(new ConfluenceContextSource())
    registerContextSource(new GitHubContextSource())
    registerContextSource(new WebSearchContextSource())
  } catch (err) {
    console.error('[Main] Database init failed:', err)
  }

  // Pre-fetch available LLM models
  fetchAvailableModels().catch((err) => console.error('[LLM] Initial model fetch failed:', err))

  // =====================
  // IPC: System dialogs
  // =====================
  ipcMain.handle('dialog:openFolder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openFiles', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'log'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'html'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return []

    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
    const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

    return result.filePaths.map(filePath => {
      try {
        const stats = statSync(filePath)
        if (stats.size > MAX_FILE_SIZE) return null

        const name = filePath.split(/[\\/]/).pop() || filePath
        const ext = name.split('.').pop()?.toLowerCase() || ''
        const isImage = IMAGE_EXTS.has(ext)
        const mimeType = isImage
          ? (ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`)
          : ext === 'pdf' ? 'application/pdf'
          : 'text/plain'

        const buffer = readFileSync(filePath)
        const base64 = buffer.toString('base64')

        return {
          id: randomUUID(),
          name,
          path: filePath,
          size: stats.size,
          mimeType,
          isImage,
          base64: isImage || ext === 'pdf' ? base64 : undefined,
          textContent: !isImage && ext !== 'pdf' ? buffer.toString('utf-8') : undefined
        }
      } catch {
        return null
      }
    }).filter(Boolean)
  })

  // =====================
  // IPC: Project CRUD
  // =====================
  ipcMain.handle('project:create', (_event, name: string, brainName: string) => {
    const db = getDb()
    const id = randomUUID()
    projectQueries.create(db).run(id, name, brainName)
    return projectQueries.getById(db).get(id)
  })

  ipcMain.handle('project:getAll', () => {
    const db = getDb()
    return projectQueries.getAll(db).all()
  })

  ipcMain.handle('project:delete', (_event, projectId: string) => {
    const db = getDb()
    projectQueries.delete(db).run(projectId)
    return true
  })

  ipcMain.handle('project:rename', (_event, projectId: string, newName: string) => {
    const db = getDb()
    projectQueries.updateName(db).run(newName, projectId)
    return true
  })

  ipcMain.handle('project:stats', (_event, projectId: string) => {
    return getProjectStats(projectId)
  })

  // =====================
  // IPC: Repository import
  // =====================
  ipcMain.handle(
    'repo:importLocal',
    async (_event, projectId: string, localPath: string) => {
      const db = getDb()
      const repoId = randomUUID()
      const detectedBranch = await getCurrentBranch(localPath).catch(() => 'main')
      repoQueries.create(db).run(repoId, projectId, 'local', localPath, detectedBranch)

      // Start indexing in background, then init nano-brain
      indexLocalRepository(projectId, repoId, localPath, mainWindow, detectedBranch)
        .then(() => {
          const project = projectQueries.getById(getDb()).get(projectId) as any
          if (project) {
            initNanoBrain(project.name, localPath).catch(err =>
              console.warn('[NanoBrain] Post-index init failed:', err)
            )
          }
        })
        .catch((err) => {
          console.error('Indexing failed:', err)
        })

      return { repoId, status: 'indexing' }
    }
  )

  ipcMain.handle('repo:getByProject', (_event, projectId: string) => {
    const db = getDb()
    return repoQueries.getByProject(db).all(projectId)
  })

  ipcMain.handle('repo:delete', async (_event, repoId: string) => {
    const db = getDb()
    try {
      // 1. Stop file watcher if active
      stopFileWatcher(repoId)

      // 2. Delete clone directory if exists
      const cloneDir = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
      if (existsSync(cloneDir)) {
        rmSync(cloneDir, { recursive: true, force: true })
      }

      // 3. Delete from DB (chunks cascade via FK)
      repoQueries.delete(db).run(repoId)

      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  })

  // =====================
  // IPC: GitHub import
  // =====================
  ipcMain.handle(
    'repo:importGithub',
    async (_event, projectId: string, repoUrl: string, token?: string, branch?: string) => {
      const db = getDb()
      const repoId = randomUUID()

      // Store token securely if provided
      if (token) {
        storeGitHubToken(repoId, token)
      }

      // Check access first
      const access = await checkRepoAccess(repoUrl, token)
      if (!access.accessible) {
        return { success: false, error: access.error, needsToken: !token && access.isPrivate }
      }

      // Create repo record
      repoQueries.create(db).run(repoId, projectId, 'github', repoUrl, branch || 'main')
      repoQueries.updateStatus(db).run('indexing', null, repoId)

      // Clone and index in background
      ;(async () => {
        try {
          const cloneResult = await cloneRepository(repoUrl, repoId, token, branch)

          // Index the cloned repo (pass actual branch from clone result)
          await indexLocalRepository(projectId, repoId, cloneResult.localPath, mainWindow, cloneResult.branch)

          // Update active_branch in DB to match actual clone branch (may differ from requested if 'main' fell back to 'master')
          repoQueries.updateActiveBranch(db).run(cloneResult.branch, repoId)

          // Init nano-brain for the cloned repo
          const project = projectQueries.getById(db).get(projectId) as any
          if (project) {
            initNanoBrain(project.name, cloneResult.localPath).catch(err =>
              console.warn('[NanoBrain] Post-clone init failed:', err)
            )
          }

          // Update with SHA
          repoQueries.updateIndexed(db).run(
            cloneResult.latestSha,
            Date.now(),
            'ready',
            0, 0, // Will be updated by indexLocalRepository
            repoId
          )
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          repoQueries.updateStatus(db).run('error', errorMsg, repoId)
          mainWindow?.webContents.send('indexing:progress', {
            repoId,
            phase: 'error',
            totalFiles: 0,
            processedFiles: 0,
            totalChunks: 0,
            error: errorMsg
          })
        }
      })()

      return { success: true, repoId, status: 'indexing' }
    }
  )

  ipcMain.handle(
    'github:checkAccess',
    async (_event, repoUrl: string, token?: string) => {
      return checkRepoAccess(repoUrl, token)
    }
  )

  // =====================
  // IPC: Brain search
  // =====================
  ipcMain.handle(
    'brain:search',
    async (_event, projectId: string, query: string, limit?: number, branch?: string) => {
      // Try hybrid search first (vector + keyword), fallback to keyword-only
      try {
        return await searchChunksHybrid(projectId, query, limit, branch)
      } catch {
        return searchChunks(projectId, query, limit, branch)
      }
    }
  )

  // =====================
  // IPC: Chat with LLM
  // =====================
  const activeAbortControllers = new Map<string, AbortController>()

  ipcMain.handle(
    'chat:send',
    async (
      _event,
      projectId: string,
      conversationId: string,
      query: string,
      mode: ChatMode,
      history: ChatMessage[],
      attachments?: Array<{ id: string; name: string; path: string; size: number; mimeType: string; isImage: boolean; base64?: string; textContent?: string }>
    ) => {
      const emitThinking = (step: string, status: string, label: string, detail?: string, durationMs?: number) => {
        mainWindow?.webContents.send('chat:thinking', { conversationId, step, status, label, detail, durationMs })
      }

      try {
        // 0. Sanitize prompt for injection
        let stepStart = Date.now()
        emitThinking('sanitize', 'running', 'Phân tích câu hỏi')
        const { sanitized, suspicious, threats } = sanitizePrompt(query)
        if (suspicious) {
          logEvent('security.prompt_injection', projectId, 'chat', JSON.stringify({ threats, original: query.slice(0, 200) }))
          query = sanitized
        }
        emitThinking('sanitize', 'done', 'Phân tích câu hỏi', suspicious ? 'Đã xử lý nội dung đáng ngờ' : undefined, Date.now() - stepStart)

        // 0b. Load memory context
        stepStart = Date.now()
        emitThinking('memory', 'running', 'Đọc bộ nhớ')
        let memoryContext = ''
        try {
          memoryContext = buildMemoryPrompt(projectId)
          emitThinking('memory', memoryContext ? 'done' : 'skipped', 'Đọc bộ nhớ',
            memoryContext ? `${memoryContext.length} ký tự` : 'Chưa có bộ nhớ',
            Date.now() - stepStart)
        } catch (memErr) {
          console.warn('[Chat] Memory load failed (non-fatal):', memErr)
          emitThinking('memory', 'error', 'Đọc bộ nhớ', 'Lỗi', Date.now() - stepStart)
        }

        const COMMAND_SKILL_MAP: Record<string, string> = {
          'multi-agent': '__orchestrate__',
          'review': 'pr-code-reviewer',
          'pr-code-reviewer': 'pr-code-reviewer',
          'security': 'react-agent',
          'performance': 'performance-profiler',
          'implement': 'react-agent',
          'architect': 'react-agent',
          'refactor': 'react-agent',
          'playwright': 'playwright-browser',
          'frontend-ui-ux': 'react-agent',
          'git-master': 'react-agent',
          'dev-browser': 'playwright-browser',
          'rtk-setup': 'react-agent',
          'rri-t-testing': 'test-generator',
          'nano-brain-init': 'session-memory',
          'nano-brain-reindex': 'session-memory',
          'nano-brain-status': 'session-memory',
          'blog': 'react-agent',
          'idea': 'react-agent',
          'reddit': 'react-agent',
          'team': 'react-agent',
          'init-deep': 'code-analysis',
          'ralph-loop': 'react-agent',
          'ulw-loop': 'react-agent',
          'cancel-ralph': 'react-agent',
          'start-work': 'plan-execute',
          'stop-continuation': 'react-agent',
          'handoff': 'react-agent',
          'test': 'test-generator',
          'migration': 'migration-planner',
          'code-quality': 'code-quality',
          'dependency-audit': 'dependency-audit',
          'api-contract': 'api-contract',
          'diff-review': 'diff-review',
        }
        const COMMAND_SYSTEM_PREFIXES: Record<string, string> = {
          'multi-agent': '',
          'review': '',
          'pr-code-reviewer': '',
          'security': 'You are a security analyst. Focus on vulnerabilities, threats, and security best practices. ',
          'performance': '',
          'implement': 'You are an implementation specialist. Focus on writing clean, working code to implement the requested feature. ',
          'architect': 'You are a software architect. Focus on system design, architecture patterns, and structural decisions. ',
          'refactor': 'You are a refactoring specialist. Improve code structure, readability, and maintainability without changing behavior. ',
          'playwright': '',
          'frontend-ui-ux': 'You are a UI/UX engineer. Focus on design, styling, animation, and user experience. ',
          'git-master': 'You are a git specialist. Focus on git operations, commits, rebases, history, and branch management. ',
          'dev-browser': '',
          'rtk-setup': 'You are a Redux Toolkit specialist. Focus on RTK setup, slices, and state management. ',
          'rri-t-testing': '',
          'nano-brain-init': 'Initialize nano-brain memory for this project. ',
          'nano-brain-reindex': 'Rescan codebase and refresh all nano-brain indexes. ',
          'nano-brain-status': 'Show nano-brain memory health and statistics. ',
          'blog': 'You are a tech blog writer. Draft SEO-optimized technology blog posts based on the current project or latest changes. ',
          'idea': 'You are a product strategist. Analyze source code and produce a comprehensive monetization strategy with execution blueprint. ',
          'reddit': 'You are a Reddit copywriter. Draft a Reddit post optimized for a specific subreddit\'s rules, tone, and spam filters. ',
          'team': 'You are a tech lead. Analyze a feature/idea with deep analysis, produce a concrete proposal with architecture and plan. ',
          'init-deep': '',
          'ralph-loop': 'Start self-referential development loop until completion. ',
          'ulw-loop': 'Start ultrawork loop — continues until completion with ultrawork mode. ',
          'cancel-ralph': 'Cancel active development loop. ',
          'start-work': 'Start work session from plan. ',
          'stop-continuation': 'Stop all continuation mechanisms for this session. ',
          'handoff': 'Create a detailed context summary for continuing work in a new session. ',
          'test': '',
          'migration': 'Plan and execute a codebase migration. ',
          'code-quality': '',
          'dependency-audit': '',
          'api-contract': '',
          'diff-review': '',
        }
        const SLASH_COMMANDS = Object.keys(COMMAND_SKILL_MAP)
        const slashRegex = new RegExp(`^\\/(${SLASH_COMMANDS.join('|')})(?:\\s+([\\s\\S]+))?`)
        const slashMatch = query.match(slashRegex)
        if (slashMatch) {
          const slashCommand = slashMatch[1]
          const slashQuery = slashMatch[2] || ''
          const skillName = COMMAND_SKILL_MAP[slashCommand] || 'react-agent'
          const systemPrefix = COMMAND_SYSTEM_PREFIXES[slashCommand] || ''
          const augmentedQuery = systemPrefix ? systemPrefix + slashQuery : slashQuery

          emitThinking('agent_init', 'running', 'Agent Mode', `/${slashCommand}: ${slashQuery.slice(0, 80)}`)

          let agentResponse = ''
          try {
            if (skillName === '__orchestrate__') {
              emitThinking('orchestrate', 'running', 'Multi-Agent', 'Phân loại intent và chọn team...')
              const orchResult = await orchestrate({
                query: augmentedQuery || slashQuery,
                projectId,
                conversationId,
                mode: 'engineering'
              })
              const agentList = orchResult.activatedAgents.join(', ')
              emitThinking('orchestrate', 'done', 'Multi-Agent',
                `${orchResult.activatedAgents.length} agents: ${agentList} (${orchResult.totalDurationMs}ms)`)

              const header = `## Multi-Agent Analysis\n**Intent:** ${orchResult.intent.primaryIntent} (confidence: ${(orchResult.intent.confidence * 100).toFixed(0)}%)\n**Team:** ${agentList}\n**Duration:** ${orchResult.totalDurationMs}ms\n\n`
              const conflicts = orchResult.aggregation.conflicts.length > 0
                ? `\n\n### ⚠️ Conflicts Detected\n${orchResult.aggregation.conflicts.map((c) => `- **${c.agents.join(' vs ')}**: ${c.description} (${c.resolution})`).join('\n')}\n`
                : ''
              const cost = orchResult.aggregation.estimatedCost
                ? `\n\n---\n*Estimated cost: $${orchResult.aggregation.estimatedCost.toFixed(4)}*`
                : ''
              agentResponse = header + orchResult.response + conflicts + cost
            } else {
              const agentResult = await executeSkill(skillName, {
                query: augmentedQuery,
                projectId,
                conversationId,
                mode: 'engineering',
                context: { history }
              })
              agentResponse = agentResult?.content || ''
            }

            emitThinking('agent_init', 'done', 'Agent Mode')
          } catch (agentErr) {
            emitThinking('agent_init', 'error', 'Agent Mode', String(agentErr))
            agentResponse = `**Agent Error (${skillName}):**\n\n${String(agentErr)}`
          }

          if (!agentResponse.trim()) {
            agentResponse = `**${skillName}** returned empty. Skill may not have matched the query or encountered a silent failure.\n\nQuery: ${slashQuery.slice(0, 200)}`
          }

          mainWindow?.webContents.send('chat:stream', { conversationId, content: agentResponse, done: true })

          try {
            const agentDb = getDb()
            const emptyAssistant = agentDb.prepare(
              "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content = '' ORDER BY created_at DESC LIMIT 1"
            ).get(conversationId) as { id: string } | undefined
            if (emptyAssistant) {
              messageQueries.updateContent(agentDb).run(agentResponse, emptyAssistant.id)
            }
          } catch { /* best-effort persist */ }

          return { success: true, content: agentResponse, contextChunks: [] }
        }

        // 1. Get project info and search for relevant context (per-repo branch-aware)
        const db = getDb()
        const repos = repoQueries.getByProject(db).all(projectId) as any[]
        let context: any[] = []

        // Agentic RAG: multi-step intelligent retrieval
        stepStart = Date.now()
        emitThinking('rag', 'running', 'Tìm kiếm trong Brain')
        try {
          // Collect active branches from all repos
          const branchSet = new Set<string>()
          for (const repo of repos) {
            branchSet.add(repo.active_branch || 'main')
          }
          const activeBranches = Array.from(branchSet)
          const baseChunks = 10 + repos.length * 3
          const perBranchChunks = Math.max(5, Math.ceil(baseChunks / activeBranches.length))

          // Run agentic RAG per-branch and merge results
          const allRagResults = await Promise.all(activeBranches.map(branch =>
            agenticRetrieve(projectId, query, mode as 'pm' | 'engineering', {
              maxChunks: perBranchChunks,
              branch
            }).catch(() => null)
          ))

          const seen = new Set<string>()
          let totalIterations = 0
          let bestConfidence = 0
          for (const ragResult of allRagResults) {
            if (!ragResult) continue
            totalIterations += ragResult.iterations
            bestConfidence = Math.max(bestConfidence, ragResult.confidence)
            for (const chunk of ragResult.context) {
              const key = chunk.chunkId || chunk.relativePath + ':' + chunk.lineStart
              if (!seen.has(key)) {
                seen.add(key)
                context.push(chunk)
              }
            }
          }
          context = context.slice(0, baseChunks)
          console.log(`[Chat] Agentic RAG: ${context.length} chunks across ${activeBranches.length} branches, confidence ${bestConfidence.toFixed(2)}, ${totalIterations} iterations`)
          emitThinking('rag', 'done', 'Tìm kiếm trong Brain', `${context.length} chunks, ${totalIterations} vòng, confidence ${bestConfidence.toFixed(2)}`, Date.now() - stepStart)
        } catch (ragErr) {
          console.warn('[Chat] Agentic RAG failed, falling back to hybrid search:', ragErr)
          // Fallback to original per-branch hybrid search
          const branchSet = new Set<string>()
          for (const repo of repos) {
            branchSet.add(repo.active_branch || 'main')
          }
          const activeBranches = Array.from(branchSet)
          const seen = new Set<string>()
          const fallbackBaseChunks = 8 + repos.length * 2
          const perBranchLimit = Math.max(4, Math.ceil(fallbackBaseChunks / activeBranches.length))
          for (const branch of activeBranches) {
            let branchResults: any[] = []
            try {
              branchResults = await searchChunksHybrid(projectId, query, perBranchLimit, branch)
            } catch {
              branchResults = searchChunks(projectId, query, perBranchLimit, branch)
            }
            for (const chunk of branchResults) {
              if (!seen.has(chunk.id || chunk.relativePath + ':' + chunk.lineStart)) {
                seen.add(chunk.id || chunk.relativePath + ':' + chunk.lineStart)
                context.push(chunk)
              }
            }
          }
          context = context.slice(0, fallbackBaseChunks)
          emitThinking('rag', 'done', 'Tìm kiếm trong Brain', `${context.length} chunks (fallback)`, Date.now() - stepStart)
        }

        // 1b. Auto-fetch external context (Jira, Confluence, GitHub, etc.)
        let externalContext = ''
        stepStart = Date.now()
        emitThinking('external_context', 'running', 'Lấy context bên ngoài')
        try {
          const externalResults = await extractAndFetchAllContext(query, projectId)
          const successResults = externalResults.filter(r => r.content)
          const failedResults = externalResults.filter(r => r.error)

          if (successResults.length > 0) {
            externalContext = successResults
              .map(r => `[${r.source}]\n${r.content}`)
              .join('\n\n---\n\n')
            console.log(`[Chat] External context: ${successResults.length} items (${externalContext.length} chars)`)
          }

          if (failedResults.length > 0) {
            const errorMsgs = failedResults.map(r => `[${r.source}] ${r.url}: ${r.error}`).join('; ')
            console.warn(`[Chat] External context failures: ${errorMsgs}`)
          }

          const sources = successResults.map(r => r.source).join(', ')
          emitThinking('external_context', successResults.length > 0 ? 'done' : 'skipped', 'Lấy context bên ngoài',
            successResults.length > 0 ? `${successResults.length} nguồn (${sources})` : 'Không có URL nào được phát hiện',
            Date.now() - stepStart)
        } catch (err) {
          console.error('[Chat] External context fetch failed:', err)
          emitThinking('external_context', 'error', 'Lấy context bên ngoài', 'Lỗi kết nối', Date.now() - stepStart)
        }

        // 1c. Web search supplement (low confidence or error pattern)
        let webContext = ''
        stepStart = Date.now()
        try {
          const webTrigger = detectWebSearchTrigger(query)
          const shouldWebSearch = webTrigger.triggered || (context.length === 0 && query.length > 20)
          if (shouldWebSearch) {
            emitThinking('web_search', 'running', 'Tìm kiếm web')
            const webQuery = webTrigger.triggered ? webTrigger.searchQuery : query
            const webResults = await searchWeb(webQuery, { numResults: 5 })
            webContext = webResultsToChunkContent(webResults)
            if (webContext) {
              console.log(`[Chat] Web search: ${webResults.length} results (${webContext.length} chars)`)
            }
            emitThinking('web_search', 'done', 'Tìm kiếm web', `${webResults.length} kết quả`, Date.now() - stepStart)
          } else {
            emitThinking('web_search', 'skipped', 'Tìm kiếm web', 'Không cần thiết')
          }
        } catch (err) {
          console.warn('[Chat] Web search failed (non-fatal):', err)
          emitThinking('web_search', 'error', 'Tìm kiếm web', 'Lỗi tìm kiếm', Date.now() - stepStart)
        }

        // 2. Get project info + stats for Brain self-awareness
        const project = projectQueries.getById(db).get(projectId) as any
        if (!project) throw new Error('Project not found')

        // Build composite directory tree from ALL repos
        let compositeTree = ''
        try {
          const repoTrees = repoTreeQueries.getByProject(db).all(projectId) as Array<{ repo_id: string; project_id: string; tree_text: string; source_path: string }>
          if (repoTrees.length > 0) {
            compositeTree = repoTrees.map(rt => {
              const repoName = rt.source_path.split('/').pop() || rt.source_path
              return `=== ${repoName} ===\n${rt.tree_text}`
            }).join('\n\n')
          } else {
            const oldTree = db
              .prepare('SELECT tree_text FROM project_directory_trees WHERE project_id = ?')
              .get(projectId) as { tree_text: string } | undefined
            compositeTree = oldTree?.tree_text || ''
          }
        } catch (err) {
          console.warn('[Chat] Failed to build composite tree:', err)
        }

        // Build repo name lookup and fill repoName on context chunks
        const repoNameMap = new Map<string, string>()
        for (const repo of repos) {
          const name = (repo.source_path || '').split('/').pop() || repo.source_path || repo.id
          repoNameMap.set(repo.id, name)
        }
        for (const chunk of context) {
          if (chunk.repoId && !chunk.repoName) {
            chunk.repoName = repoNameMap.get(chunk.repoId) || ''
          }
        }

        // Gather project stats for LLM self-awareness
        const rawStats = getProjectStats(projectId)
        const projectStats: ProjectContext = {
          totalFiles: repos.reduce((sum: number, r: any) => sum + (r.total_files || 0), 0),
          totalChunks: rawStats.totalChunks,
          languages: rawStats.languages as any[],
          repositories: repos.map((r: any) => ({
            source_type: r.source_type,
            source_path: r.source_path,
            status: r.status,
            total_files: r.total_files || 0
          }))
        }

        // 3. Build attachment context
        let attachmentContext = ''
        if (attachments && attachments.length > 0) {
          const parts: string[] = []
          for (const att of attachments) {
            if (att.textContent) {
              parts.push(`=== Attached File: ${att.name} (${att.mimeType}) ===\n${att.textContent}`)
            } else if (att.isImage) {
              parts.push(`=== Attached Image: ${att.name} (${att.mimeType}, ${att.size} bytes) ===\n[Image file attached — user shared this image for reference]`)
            } else if (att.mimeType === 'application/pdf') {
              parts.push(`=== Attached PDF: ${att.name} (${att.size} bytes) ===\n[PDF document attached — user shared this document for reference]`)
            }
          }
          if (parts.length > 0) {
            attachmentContext = parts.join('\n\n')
          }
        }

        // 3b. Build prompt
        stepStart = Date.now()
        emitThinking('build_prompt', 'running', 'Xây dựng prompt')
        const { messages, compressionStats } = buildPrompt(
          mode,
          query,
          context,
          project.name,
          project.brain_name,
          compositeTree || null,
          history,
          projectStats,
          [externalContext, webContext, attachmentContext].filter(Boolean).join('\n\n---\n\n') || null,
          memoryContext || null
        )
        if (compressionStats) {
          console.log(`[Chat] Context compression: ${compressionStats.savingsPercent}% token savings`)
        }
        emitThinking('build_prompt', 'done', 'Xây dựng prompt',
          compressionStats ? `Nén ${compressionStats.savingsPercent}% tokens` : `${context.length} chunks context`,
          Date.now() - stepStart)

        // 3b. Check semantic cache before calling LLM (skip for queries with external URLs)
        const hasExternalUrl = /https?:\/\/(github\.com|.*\.atlassian\.net|.*jira.*|.*confluence.*)/i.test(query)
        if (hasExternalUrl) invalidateCacheForQuery(query)
        stepStart = Date.now()
        try {
          const cached = hasExternalUrl ? null : await getCachedResponse(query)
          if (cached) {
            emitThinking('cache', 'done', 'Cache hit', `Tiết kiệm ${cached.tokensSaved} tokens`, Date.now() - stepStart)
            console.log(`[Chat] Semantic cache hit — saved ${cached.tokensSaved} tokens`)

            // Persist cached response
            try {
              const emptyAssistant = db.prepare(
                "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content = '' ORDER BY created_at DESC LIMIT 1"
              ).get(conversationId) as { id: string } | undefined
              if (emptyAssistant) {
                messageQueries.updateContent(db).run(cached.response, emptyAssistant.id)
              } else {
                const msgId = randomUUID()
                messageQueries.create(db).run(msgId, conversationId, 'assistant', cached.response, mode, '[]')
              }
            } catch { /* best-effort */ }

            // Stream cached response to renderer
            mainWindow?.webContents.send('chat:stream', { conversationId, content: cached.response, done: true })

            return {
              success: true,
              content: cached.response,
              contextChunks: context.map((c: any) => ({
                relativePath: c.relativePath,
                name: c.name,
                chunkType: c.chunkType,
                lineStart: c.lineStart,
                lineEnd: c.lineEnd
              }))
            }
          }
        } catch (cacheErr) {
          console.warn('[Chat] Cache check failed (non-fatal):', cacheErr)
        }

        // 4. Collect MCP tools for function calling
        let mcpToolDefs: Awaited<ReturnType<typeof getToolDefinitions>> = []
        try {
          mcpToolDefs = await getToolDefinitions()
          if (mcpToolDefs.length > 0) {
            console.log(`[Chat] MCP tools available: ${mcpToolDefs.length} (${mcpToolDefs.map(t => t.function.name).join(', ')})`)
          }
        } catch (toolErr) {
          console.warn('[Chat] Failed to collect MCP tools (non-fatal):', toolErr)
        }

        // 5. Stream response with tool call loop (OpenCode pattern)
        emitThinking('streaming', 'running', 'Đang trả lời')
        const abortController = new AbortController()
        activeAbortControllers.set(conversationId, abortController)

        const MAX_TOOL_ITERATIONS = 10
        let toolIteration = 0
        let streamResult = await streamChatCompletion(
          messages,
          conversationId,
          mainWindow,
          abortController.signal,
          mcpToolDefs.length > 0 ? mcpToolDefs : undefined
        )

        while (
          streamResult.finishReason === 'tool_calls' &&
          streamResult.toolCalls.length > 0 &&
          toolIteration < MAX_TOOL_ITERATIONS
        ) {
          toolIteration++
          console.log(`[Chat] Tool call loop iteration ${toolIteration}: ${streamResult.toolCalls.map(tc => tc.function.name).join(', ')}`)
          emitThinking('tool_call', 'running', 'Gọi MCP tools', `${streamResult.toolCalls.map(tc => tc.function.name).join(', ')} (lần ${toolIteration})`)

          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: streamResult.content || '',
            tool_calls: streamResult.toolCalls
          }
          messages.push(assistantMsg)

          for (const toolCall of streamResult.toolCalls) {
            const toolResult = await executeMCPTool(toolCall.function.name, toolCall.function.arguments)
            console.log(`[Chat] Tool ${toolCall.function.name}: ${toolResult.isError ? 'ERROR' : 'OK'} (${toolResult.content.length} chars)`)

            messages.push({
              role: 'tool',
              content: toolResult.content,
              tool_call_id: toolCall.id
            })
          }

          emitThinking('tool_call', 'done', 'Gọi MCP tools', `${streamResult.toolCalls.length} tools xong`)

          streamResult = await streamChatCompletion(
            messages,
            conversationId,
            mainWindow,
            abortController.signal,
            mcpToolDefs.length > 0 ? mcpToolDefs : undefined
          )
        }

        const response = streamResult.content

        activeAbortControllers.delete(conversationId)
        emitThinking('streaming', 'done', 'Đang trả lời', toolIteration > 0 ? `${toolIteration} tool calls` : undefined)

        // 5. Persist assistant response to DB (main-process side, not dependent on renderer)
        if (response) {
          try {
            // Find the last assistant message with empty content in this conversation
            const emptyAssistant = db.prepare(
              "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content = '' ORDER BY created_at DESC LIMIT 1"
            ).get(conversationId) as { id: string } | undefined

            if (emptyAssistant) {
              messageQueries.updateContent(db).run(response, emptyAssistant.id)
            } else {
              // No empty placeholder found — insert a new assistant message
              const msgId = randomUUID()
              messageQueries.create(db).run(msgId, conversationId, 'assistant', response, mode, JSON.stringify(
                context.map((c: any) => ({ relativePath: c.relativePath, name: c.name, chunkType: c.chunkType }))
              ))
            }
          } catch (saveErr) {
            console.error('Failed to persist assistant response:', saveErr)
          }
        }

        // 5b. Save interactions to recall memory
        try {
          await saveInteraction(projectId, conversationId, 'user', query)
          if (response) {
            await saveInteraction(projectId, conversationId, 'assistant', response)
          }
        } catch {
          // Non-fatal — memory save is best-effort
        }

        if (response) {
          try {
            const inputTokens = streamResult.usage?.promptTokens ?? Math.ceil(query.length / 4)
            const outputTokens = streamResult.usage?.completionTokens ?? Math.ceil(response.length / 4)
            if (!hasExternalUrl) {
              await cacheResponse(query, response, streamResult.model, outputTokens)
            }
            recordUsage({
              projectId,
              model: streamResult.model,
              inputTokens,
              outputTokens,
              cost: estimateCost(streamResult.model, inputTokens, outputTokens)
            })
          } catch {
            // Non-fatal
          }
        }

        // 5d. Record behavioral event for self-learning
        try {
          recordEvent({ type: 'message_sent', projectId, data: { conversationId, queryLength: query.length, responseLength: response?.length || 0, mode } })
        } catch {
          // Non-fatal
        }

        return {
          success: true,
          content: response,
          contextChunks: context.map((c: any) => ({
            relativePath: c.relativePath,
            name: c.name,
            chunkType: c.chunkType,
            lineStart: c.lineStart,
            lineEnd: c.lineEnd
          }))
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)

        // Persist error to empty assistant placeholder so it shows on reload
        try {
          const db = getDb()
          const emptyAssistant = db.prepare(
            "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content = '' ORDER BY created_at DESC LIMIT 1"
          ).get(conversationId) as { id: string } | undefined
          if (emptyAssistant) {
            const errorContent = `\u26a0\ufe0f L\u1ed7i: ${errorMsg}`
            messageQueries.updateContent(db).run(errorContent, emptyAssistant.id)
          }
        } catch {
          // best-effort
        }

        return { success: false, error: errorMsg }
      }
    }
  )

  ipcMain.handle('chat:abort', (_event, conversationId: string) => {
    const controller = activeAbortControllers.get(conversationId)
    if (controller) {
      controller.abort()
      activeAbortControllers.delete(conversationId)
    }
    return true
  })

  // =====================
  // IPC: LLM Model info
  // =====================
  ipcMain.handle('llm:getActiveModel', async () => {
    // If models haven't been fetched yet, wait for the initial fetch
    const active = getActiveModel()
    if (active === 'loading...') {
      await fetchAvailableModels()
      return getActiveModel()
    }
    return active
  })

  ipcMain.handle('llm:getAvailableModels', async () => {
    // If cache is empty (race condition on startup), fetch first
    const models = getAvailableModels()
    if (models.length === 0) {
      await fetchAvailableModels()
      return getAvailableModels()
    }
    return models
  })

  ipcMain.handle('llm:refreshModels', async () => {
    const models = await fetchAvailableModels()
    return models.map((m) => ({ id: m.id, tier: m.tier }))
  })

  ipcMain.handle('llm:setModel', (_event, modelId: string) => {
    return setActiveModel(modelId)
  })

  ipcMain.handle('llm:getAutoRotation', () => getAutoRotation())
  ipcMain.handle('llm:setAutoRotation', (_event, enabled: boolean) => {
    setAutoRotation(enabled)
    if (enabled) clearAuthFailedModels() // Reset failed list when re-enabling
    return true
  })

  // =====================
  // IPC: Conversation CRUD
  // =====================
  ipcMain.handle('conversation:create', (_event, projectId: string, title: string, mode: string, branch?: string) => {
    const db = getDb()
    const id = randomUUID()
    conversationQueries.create(db).run(id, projectId, title, mode, branch || 'main')
    return conversationQueries.getById(db).get(id)
  })

  ipcMain.handle('conversation:getByProject', (_event, projectId: string) => {
    const db = getDb()
    return conversationQueries.getByProject(db).all(projectId)
  })

  ipcMain.handle('conversation:updateTitle', (_event, conversationId: string, title: string) => {
    const db = getDb()
    conversationQueries.updateTitle(db).run(title, conversationId)
    return true
  })

  ipcMain.handle('conversation:delete', (_event, conversationId: string) => {
    const db = getDb()
    conversationQueries.delete(db).run(conversationId)
    return true
  })

  // =====================
  // IPC: Message CRUD
  // =====================
  ipcMain.handle('message:create', (_event, conversationId: string, role: string, content: string, mode: string, contextChunks?: string) => {
    const db = getDb()
    const id = randomUUID()
    messageQueries.create(db).run(id, conversationId, role, content, mode, contextChunks || '[]')
    // Touch conversation updated_at
    conversationQueries.touch(db).run(conversationId)
    return { id, conversationId, role, content, mode, contextChunks: contextChunks || '[]', created_at: Date.now() }
  })

  ipcMain.handle('message:getByConversation', (_event, conversationId: string) => {
    const db = getDb()
    return messageQueries.getByConversation(db).all(conversationId)
  })

  ipcMain.handle('message:updateContent', (_event, messageId: string, content: string) => {
    const db = getDb()
    messageQueries.updateContent(db).run(content, messageId)
    return true
  })

  // =====================
  // IPC: Sync
  // =====================
  ipcMain.handle(
    'sync:repo',
    async (_event, projectId: string, repoId: string) => {
      const db = getDb()
      const repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as any
      if (!repo) return { success: false, error: 'Repository not found' }

      try {
        let result
        if (repo.source_type === 'github') {
          result = await syncGithubRepo(projectId, repoId, mainWindow)
        } else {
          result = await syncLocalRepo(projectId, repoId, repo.source_path, mainWindow)
        }
        return { success: true, ...result }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  ipcMain.handle(
    'sync:startWatcher',
    (_event, repoId: string, localPath: string) => {
      startFileWatcher(repoId, localPath, () => {
        mainWindow?.webContents.send('sync:fileChanged', { repoId })
      })
      return true
    }
  )

  ipcMain.handle('sync:stopWatcher', (_event, repoId: string) => {
    stopFileWatcher(repoId)
    return true
  })

  // =====================
  // IPC: Branch Management
  // =====================
  ipcMain.handle('branch:list', async (_event, repoId: string) => {
    const localPath = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
    if (!existsSync(localPath)) return []
    // Pass stored token for private repo auth during fetch
    const token = getGitHubToken(repoId) || undefined
    return listBranches(localPath, token)
  })

  ipcMain.handle('branch:switch', async (_event, projectId: string, repoId: string, branch: string) => {
    return indexBranch(projectId, repoId, branch, mainWindow)
  })

  ipcMain.handle('branch:getCurrent', async (_event, repoId: string) => {
    const localPath = join(app.getPath('userData'), 'cortex-data', 'clones', repoId)
    if (!existsSync(localPath)) return 'main'
    return getCurrentBranch(localPath)
  })


  // =====================
  // IPC: Architecture Analysis
  // =====================
  ipcMain.handle('architecture:analyze', (_event, projectId: string) => {
    return analyzeArchitecture(projectId)
  })

  // =====================
  // IPC: Impact & Estimate
  // =====================
  ipcMain.handle('impact:analyze', (_event, projectId: string, changedFiles: string[]) => {
    return analyzeImpact(projectId, changedFiles)
  })

  ipcMain.handle('estimate:feature', async (_event, projectId: string, description: string) => {
    return estimateFeature(projectId, description)
  })

  // =====================
  // IPC: Brain Export/Import
  // =====================
  ipcMain.handle('brain:export', async (_event, projectId: string) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `cortex-brain-${Date.now()}.cbx`,
      filters: [{ name: 'Cortex Brain Export', extensions: ['cbx'] }]
    })
    if (result.canceled || !result.filePath) return null
    return exportBrain(projectId, result.filePath)
  })

  ipcMain.handle('brain:import', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'Cortex Brain Export', extensions: ['cbx'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importBrain(result.filePaths[0])
  })

  // =====================
  // IPC: Settings
  // =====================
  ipcMain.handle('settings:getProxyConfig', () => getProxyConfig())
  ipcMain.handle('settings:setProxyConfig', (_event, url: string, key: string) => {
    setProxyConfig(url, key)
    clearAuthFailedModels() // Reset auth failures when proxy config changes
    return true
  })
  ipcMain.handle('settings:getLLMConfig', () => getLLMConfig())
  ipcMain.handle('settings:setLLMConfig', (_event, maxTokens: number, contextMessages: number) => {
    setLLMConfig(maxTokens, contextMessages)
    return true
  })
  ipcMain.handle('settings:getGitConfig', () => getGitConfig())
  ipcMain.handle('settings:setGitConfig', (_event, cloneDepth: number) => {
    setGitConfig(cloneDepth)
    return true
  })
  ipcMain.handle('settings:testProxyConnection', async (_event, url: string, key: string) => {
    return testProxyConnection(url, key)
  })
  // Per-project Atlassian config
  ipcMain.handle('atlassian:getConfig', (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return null
    return { siteUrl: config.siteUrl, email: config.email, hasToken: true }
  })
  ipcMain.handle('atlassian:setConfig', (_event, projectId: string, siteUrl: string, email: string, apiToken: string) => {
    setProjectAtlassianConfig(projectId, siteUrl, email, apiToken)
    return true
  })
  ipcMain.handle('atlassian:clearConfig', (_event, projectId: string) => {
    clearProjectAtlassianConfig(projectId)
    return true
  })
  ipcMain.handle('atlassian:testConnection', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình cho project này' }
    return testJiraConnection({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })
  ipcMain.handle('settings:completeOnboarding', () => {
    setSetting('onboarding_completed', 'true')
    return true
  })
  ipcMain.handle('settings:isOnboardingCompleted', () => {
    return getSetting('onboarding_completed') === 'true'
  })

  // =====================
  // IPC: Jira Integration
  // =====================
  ipcMain.handle('jira:testConnection', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return { success: false, error: 'Atlassian chưa được cấu hình cho project này' }
    return testJiraConnection({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })

  ipcMain.handle('jira:getProjects', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return []
    return fetchJiraProjects({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })

  ipcMain.handle('jira:importProject', async (_event, projectId: string, jiraProjectKey: string) => {
    // TODO: implement full Jira import pipeline (fetch issues → convert to chunks → index)
    return { success: true, issuesImported: 0 }
  })

  // =====================
  // IPC: GitHub Token
  // =====================
  ipcMain.handle('github:getPAT', () => !!getGitHubPAT())
  ipcMain.handle('github:setPAT', (_event, token: string) => {
    setGitHubPAT(token)
    return true
  })

  // =====================
  // IPC: Confluence Integration
  // =====================
  ipcMain.handle('confluence:getSpaces', async (_event, projectId: string) => {
    const config = getProjectAtlassianConfig(projectId)
    if (!config) return []
    return fetchSpaces({ siteUrl: config.siteUrl, email: config.email, apiToken: config.apiToken })
  })

  ipcMain.handle('confluence:importSpace', async (_event, projectId: string, spaceId: string, spaceKey: string) => {
    // TODO: implement full Confluence import pipeline (fetch pages → convert to chunks → index)
    return { success: true, pagesImported: 0 }
  })

  // =====================
  // IPC: Self-Learning Engine
  // =====================
  ipcMain.handle(
    'learning:sendFeedback',
    (_event, messageId: string, conversationId: string, projectId: string, signalType: string, query: string, chunkIds: string[]) => {
      try {
        recordFeedbackSignal({
          projectId,
          messageId,
          conversationId,
          signalType: signalType as 'thumbs_up' | 'thumbs_down' | 'copy' | 'follow_up_quick' | 'follow_up_slow' | 'no_follow_up',
          query,
          chunkIds
        })
        return true
      } catch (err) {
        console.error('[Learning] Failed to record feedback:', err)
        return false
      }
    }
  )

  ipcMain.handle('learning:getStats', (_event, projectId: string) => {
    try {
      const feedback = getFeedbackStats(projectId)
      const weightCount = getLearnedWeightCount(projectId)
      return {
        totalFeedback: feedback.totalFeedback,
        totalTrainingPairs: feedback.totalTrainingPairs,
        totalLearnedWeights: weightCount,
        positiveRatio: feedback.totalFeedback > 0
          ? feedback.positiveCount / feedback.totalFeedback
          : 0,
        lastTrainedAt: null,
        compressionSavings: { tokensOriginal: 0, tokensCompressed: 0, savingsPercent: 0 }
      }
    } catch (err) {
      console.error('[Learning] Failed to get stats:', err)
      return {
        totalFeedback: 0, totalTrainingPairs: 0, totalLearnedWeights: 0,
        positiveRatio: 0, lastTrainedAt: null,
        compressionSavings: { tokensOriginal: 0, tokensCompressed: 0, savingsPercent: 0 }
      }
    }
  })

  ipcMain.handle('learning:train', async (_event, projectId: string) => {
    try {
      const { converted } = convertSignalsToTrainingPairs(projectId)
      const { trained, weightsUpdated } = trainFromPairs(projectId)
      initDefaultVariant(projectId, '')

      // Run prompt optimization after training if enough data
      let optimized = false
      try {
        const result = await optimizePrompt(projectId, '')
        optimized = result.improvement > 0
        if (optimized) console.log(`[Learning] Prompt optimized: ${(result.improvement * 100).toFixed(1)}% improvement`)
      } catch (optErr) {
        console.error('[Learning] Prompt optimization skipped:', optErr)
      }

      console.log(`[Learning] Training complete: ${converted} signals converted, ${trained} pairs processed, ${weightsUpdated} weights updated`)
      return { trained, weights: weightsUpdated, optimized }
    } catch (err) {
      console.error('[Learning] Training failed:', err)
      return { trained: 0, weights: 0, optimized: false }
    }
  })

  ipcMain.handle('learning:exportData', async (_event, projectId: string) => {
    if (!mainWindow) return null
    const { dialog: electronDialog } = await import('electron')
    const result = await electronDialog.showSaveDialog(mainWindow, {
      defaultPath: `cortex-training-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null

    try {
      const db = getDb()
      const pairs = db.prepare('SELECT * FROM training_pairs WHERE project_id = ?').all(projectId)
      const { writeFileSync } = await import('fs')
      writeFileSync(result.filePath, JSON.stringify(pairs, null, 2))
      return { pairs: pairs.length, path: result.filePath }
    } catch (err) {
      console.error('[Learning] Export failed:', err)
      return null
    }
  })

  // =====================
  // IPC: Updater
  // =====================
  ipcMain.handle('updater:checkForUpdates', async () => {
    return checkForUpdates()
  })

  // =====================
  // IPC: Audit Log
  // =====================
  ipcMain.handle('audit:getLog', (_event, projectId?: string, limit?: number) => {
    return getAuditLog(projectId, limit)
  })

  // =====================
  // IPC: Atlassian Connections (stubs for BrainDashboard)
  // =====================
  ipcMain.handle('atlassian:getConnections', (_event, projectId: string) => {
    const hasConfig = hasProjectAtlassianConfig(projectId)
    if (!hasConfig) return []
    // TODO: return actual Jira/Confluence connections once import pipeline is built
    return []
  })
  ipcMain.handle('atlassian:syncConnection', async (_event, _projectId: string, _connectionId: string) => ({ success: true }))
  ipcMain.handle('atlassian:deleteConnection', async (_event, _connectionId: string) => true)

  // =====================
  // IPC: Nano-Brain
  // =====================
  ipcMain.handle('nanobrain:status', async () => {
    return getNanoBrainStatus()
  })

  ipcMain.handle('nanobrain:query', async (_event, query: string, options?: { limit?: number; collection?: string }) => {
    return queryNanoBrain(query, options)
  })

  ipcMain.handle('nanobrain:collections', async () => {
    return listCollections()
  })

  ipcMain.handle('nanobrain:embed', async () => {
    return triggerEmbedding()
  })

  if (process.platform === 'darwin') {
    const dockIconPath = join(__dirname, '../../build/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(dockIconPath))
    }
  }

  createWindow()

  setMainWindow(mainWindow)

  const AUTO_TRAIN_INTERVAL = 30 * 60 * 1000
  const autoTrainTimer = setInterval(() => {
    try {
      const db = getDb()
      const projects = projectQueries.getAll(db).all() as any[]
      for (const project of projects) {
        const feedbackCount = (db.prepare('SELECT COUNT(*) as count FROM feedback_signals WHERE project_id = ?').get(project.id) as { count: number })?.count || 0
        if (feedbackCount > 0) {
          const { converted } = convertSignalsToTrainingPairs(project.id)
          const { trained, weightsUpdated } = trainFromPairs(project.id)
          if (converted > 0 || trained > 0) {
            console.log(`[AutoTrain] Project ${project.name}: ${converted} signals → ${trained} pairs → ${weightsUpdated} weights`)
          }
        }
      }
    } catch (err) {
      console.error('[AutoTrain] Failed:', err)
    }
  }, AUTO_TRAIN_INTERVAL)

  // =====================
  // V2: Memory System IPC
  // =====================
  try { initMemory() } catch (err) { console.error('[Main] Memory init failed:', err) }
  try { initCostSchema() } catch (err) { console.error('[Main] Cost schema init failed:', err) }
  try { initCacheSchema() } catch (err) { console.error('[Main] Cache schema init failed:', err) }
  loadAndRegisterAllAgents()
  loadAndRegisterAll()
    .then(() => autoConnectMCPServers())
    .catch(err => console.error('[Main] Skill/MCP loading failed:', err))

  ipcMain.handle('memory:core:get', (_event, projectId: string) => {
    return getCoreMemory(projectId)
  })

  ipcMain.handle('memory:core:update', (_event, projectId: string, section: string, content: string) => {
    return updateCoreMemory(projectId, section as any, content)
  })

  ipcMain.handle('memory:core:delete', (_event, projectId: string, section: string) => {
    const { deleteCoreMemory } = require('./services/memory/core-memory')
    return deleteCoreMemory(projectId, section)
  })

  ipcMain.handle('memory:core:prompt', (_event, projectId: string) => {
    return getCoreMemoryForPrompt(projectId)
  })

  ipcMain.handle('memory:archival:search', async (_event, projectId: string, query: string, limit?: number) => {
    return searchArchivalMemory(projectId, query, limit)
  })

  ipcMain.handle('memory:archival:add', async (_event, projectId: string, content: string, metadata?: Record<string, unknown>) => {
    return addArchivalMemory(projectId, content, metadata as any)
  })

  ipcMain.handle('memory:archival:list', (_event, projectId: string, limit?: number, offset?: number) => {
    return getArchivalMemories(projectId, limit, offset)
  })

  ipcMain.handle('memory:archival:delete', (_event, id: string) => {
    return deleteArchivalMemory(id)
  })

  ipcMain.handle('memory:recall:search', async (_event, projectId: string, query: string, limit?: number) => {
    return searchRecallMemory(projectId, query, limit)
  })

  ipcMain.handle('memory:recall:conversation', (_event, projectId: string, conversationId: string, limit?: number) => {
    return getConversationRecall(projectId, conversationId, limit)
  })

  ipcMain.handle('memory:recall:recent', (_event, projectId: string, limit?: number) => {
    return getRecentRecall(projectId, limit)
  })

  ipcMain.handle('memory:search', async (_event, projectId: string, query: string, limit?: number) => {
    return searchMemory(projectId, query, limit)
  })

  ipcMain.handle('memory:stats', (_event, projectId: string) => {
    return getMemoryStats(projectId)
  })

  ipcMain.handle('memory:migrate', (_event, projectId: string) => {
    return runMigration(projectId)
  })

  ipcMain.handle('memory:buildPrompt', (_event, projectId: string) => {
    return buildMemoryPrompt(projectId)
  })

  // =====================
  // V2: Slash Commands / Agent List
  // =====================
  ipcMain.handle('agents:list', () => {
    return [
      { command: '/review', label: 'Code Review', description: 'Deep PR review với 4 perspectives (security, quality, performance, testing)', icon: 'Sparkles', skillName: 'pr-code-reviewer' },
      { command: '/pr-code-reviewer', label: 'PR Code Reviewer', description: 'Deep PR review — hỗ trợ GitHub PR URL', icon: 'Sparkles', skillName: 'pr-code-reviewer' },
      { command: '/security', label: 'Security Audit', description: 'Phân tích bảo mật và phát hiện lỗ hổng', icon: 'Shield', skillName: 'react-agent' },
      { command: '/performance', label: 'Performance', description: 'Profile hiệu suất và đề xuất tối ưu', icon: 'Gauge', skillName: 'performance-profiler' },
      { command: '/implement', label: 'Implement', description: 'Triển khai tính năng hoặc thay đổi code', icon: 'Code', skillName: 'react-agent' },
      { command: '/architect', label: 'Architecture', description: 'Phân tích và đề xuất kiến trúc hệ thống', icon: 'Blocks', skillName: 'react-agent' },
      { command: '/refactor', label: 'Refactor', description: 'Intelligent refactoring với LSP, AST-grep, và TDD verification', icon: 'Wrench', skillName: 'react-agent' },
      { command: '/playwright', label: 'Playwright', description: 'Browser automation — verification, scraping, testing, screenshots', icon: 'Globe', skillName: 'playwright-browser' },
      { command: '/frontend-ui-ux', label: 'Frontend UI/UX', description: 'UI/UX design — crafts stunning interfaces', icon: 'Palette', skillName: 'react-agent' },
      { command: '/git-master', label: 'Git Master', description: 'Git operations — atomic commits, rebase, squash, blame, bisect', icon: 'GitBranch', skillName: 'react-agent' },
      { command: '/dev-browser', label: 'Dev Browser', description: 'Browser automation với persistent page state', icon: 'Globe', skillName: 'playwright-browser' },
      { command: '/test', label: 'Test Generator', description: 'Tạo test cases tự động cho code', icon: 'FlaskConical', skillName: 'test-generator' },
      { command: '/rri-t-testing', label: 'RRI Testing', description: 'Testing framework và patterns', icon: 'FlaskConical', skillName: 'test-generator' },
      { command: '/nano-brain-init', label: 'Nano Brain Init', description: 'Initialize nano-brain persistent memory cho workspace', icon: 'Brain', skillName: 'session-memory' },
      { command: '/nano-brain-reindex', label: 'Nano Brain Reindex', description: 'Rescan codebase và refresh all indexes', icon: 'RefreshCw', skillName: 'session-memory' },
      { command: '/nano-brain-status', label: 'Nano Brain Status', description: 'Show nano-brain memory health và statistics', icon: 'Activity', skillName: 'session-memory' },
      { command: '/blog', label: 'Blog Writer', description: 'Draft SEO-optimized blog posts dựa trên project hiện tại', icon: 'PenLine', skillName: 'react-agent' },
      { command: '/idea', label: 'Idea Analyzer', description: 'Phân tích source code và tạo monetization strategy', icon: 'Lightbulb', skillName: 'react-agent' },
      { command: '/reddit', label: 'Reddit Post', description: 'Draft Reddit post tối ưu cho subreddit cụ thể', icon: 'MessageCircle', skillName: 'react-agent' },
      { command: '/team', label: 'Team Proposal', description: 'Phân tích feature/idea, tạo proposal với architecture và plan', icon: 'Users', skillName: 'react-agent' },
      { command: '/init-deep', label: 'Init Deep', description: 'Initialize hierarchical knowledge base', icon: 'Database', skillName: 'code-analysis' },
      { command: '/ralph-loop', label: 'Ralph Loop', description: 'Start self-referential development loop until completion', icon: 'Repeat', skillName: 'react-agent' },
      { command: '/ulw-loop', label: 'Ultrawork Loop', description: 'Start ultrawork loop — continues until completion', icon: 'Zap', skillName: 'react-agent' },
      { command: '/cancel-ralph', label: 'Cancel Ralph', description: 'Cancel active development loop', icon: 'XCircle', skillName: 'react-agent' },
      { command: '/start-work', label: 'Start Work', description: 'Start work session from plan', icon: 'Play', skillName: 'plan-execute' },
      { command: '/stop-continuation', label: 'Stop Continuation', description: 'Stop all continuation mechanisms', icon: 'Square', skillName: 'react-agent' },
      { command: '/handoff', label: 'Handoff', description: 'Create context summary for continuing in new session', icon: 'ArrowRightLeft', skillName: 'react-agent' },
      { command: '/migration', label: 'Migration Planner', description: 'Plan và execute codebase migration', icon: 'ArrowUpCircle', skillName: 'migration-planner' },
      { command: '/code-quality', label: 'Code Quality', description: 'Phân tích chất lượng code toàn diện', icon: 'CheckCircle', skillName: 'code-quality' },
      { command: '/dependency-audit', label: 'Dependency Audit', description: 'Audit dependencies cho security và updates', icon: 'Package', skillName: 'dependency-audit' },
      { command: '/api-contract', label: 'API Contract', description: 'Validate và generate API contracts', icon: 'FileJson', skillName: 'api-contract' },
      { command: '/diff-review', label: 'Diff Review', description: 'Review git diff với multi-perspective analysis', icon: 'GitCompare', skillName: 'diff-review' },
      { command: '/rtk-setup', label: 'RTK Setup', description: 'Redux Toolkit setup và enforcement', icon: 'Settings', skillName: 'react-agent' },
      { command: '/multi-agent', label: 'Multi-Agent', description: 'Phân tích toàn diện với 8 agents chuyên biệt (review, security, performance...)', icon: 'Users', skillName: '__orchestrate__' },
      { command: '/agents', label: 'Agent Mode', description: 'Chọn agent mode (Sisyphus, Hephaestus, Prometheus, Atlas)', icon: 'Bot' },
    ]
  })

  // =====================
  // V2: Skill System IPC
  // =====================
  ipcMain.handle('skill:list', (_event, filter?: { category?: string, status?: string }) => {
    return listSkills(filter as any)
  })

  ipcMain.handle('skill:activate', (_event, name: string) => {
    return activateSkill(name)
  })

  ipcMain.handle('skill:deactivate', (_event, name: string) => {
    return deactivateSkill(name)
  })

  ipcMain.handle('skill:execute', async (_event, name: string, input: any) => {
    return executeSkill(name, input)
  })

  ipcMain.handle('skill:route', async (_event, input: any) => {
    return executeRouted(input)
  })

  ipcMain.handle('skill:health', async () => {
    const report = await getHealthReport()
    // Transform Record<string, HealthStatus> → Array<{ name, healthy, message }> for frontend
    return Object.entries(report).map(([name, status]) => ({
      name,
      healthy: status.healthy,
      message: status.message
    }))
  })

  // =====================
  // V2: Cost / Cache IPC
  // =====================
  ipcMain.handle('cost:stats', (_event, projectId: string) => {
    try {
      const { getCostByProject } = require('./services/skills/efficiency/cost-tracker')
      return getCostByProject(projectId)
    } catch { return null }
  })

  ipcMain.handle('cost:history', (_event, projectId: string, days?: number) => {
    try {
      const { getDailyCosts } = require('./services/skills/efficiency/cost-tracker')
      return getDailyCosts(projectId, days)
    } catch { return [] }
  })

  ipcMain.handle('cache:stats', () => {
    try {
      const { getCacheStats } = require('./services/skills/efficiency/semantic-cache')
      return getCacheStats()
    } catch { return null }
  })

  ipcMain.handle('cache:invalidate', () => {
    try {
      const { invalidateCache } = require('./services/skills/efficiency/semantic-cache')
      return invalidateCache()
    } catch { return false }
  })

  // =====================
  // V2: Agent Mode IPC
  // =====================
  let activeAgentAbort: AbortController | null = null
  let lastAgentExecTime = 0
  const AGENT_RATE_LIMIT_MS = 2000
  const AGENT_MAX_QUERY_LENGTH = 10000

  ipcMain.handle('agent:execute', async (_event, projectId: string, query: string, strategy?: string) => {
    try {
      if (!query || !query.trim()) {
        throw new Error('Agent query cannot be empty. Please provide a question or task after the command.')
      }
      if (query.length > AGENT_MAX_QUERY_LENGTH) {
        throw new Error(`Agent query too long (${query.length} chars). Maximum is ${AGENT_MAX_QUERY_LENGTH} characters.`)
      }

      const now = Date.now()
      if (now - lastAgentExecTime < AGENT_RATE_LIMIT_MS) {
        throw new Error('Agent is rate limited. Please wait a moment before trying again.')
      }
      lastAgentExecTime = now

      if (activeAgentAbort) {
        activeAgentAbort.abort()
        activeAgentAbort = null
      }

      activeAgentAbort = new AbortController()
      const win = BrowserWindow.getAllWindows()[0]

      const emitStep = (step: string, type: string, content: string) => {
        win?.webContents.send('agent:step', { step, type, content })
      }

      emitStep('init', 'thought', `Starting ${strategy || 'react'} agent for: ${query.slice(0, 100)}`)

      const skillName = strategy === 'plan-execute' ? 'plan-execute'
        : strategy === 'reflexion' ? 'reflexion'
        : 'react-agent'

      emitStep('routing', 'action', `Using skill: ${skillName}`)

      const result = await executeSkill(skillName, {
        query,
        projectId,
        mode: 'engineering',
        signal: activeAgentAbort?.signal
      })

      emitStep('complete', 'observation', result?.content?.slice(0, 200) || 'Done')
      return result
    } catch (err) {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:step', { step: 'error', type: 'error', content: String(err) })
      throw err
    } finally {
      activeAgentAbort = null
    }
  })

  ipcMain.handle('agent:abort', () => {
    if (activeAgentAbort) {
      activeAgentAbort.abort()
      activeAgentAbort = null
    }
    return true
  })

  ipcMain.handle('mcp:list', () => {
    return listMCPServers()
  })

  ipcMain.handle('mcp:add', (_event, config: { name: string; transportType: 'stdio' | 'sse'; command?: string; args?: string; serverUrl?: string; env?: string }) => {
    return addMCPServer(config)
  })

  ipcMain.handle('mcp:remove', (_event, id: string) => {
    return removeMCPServer(id)
  })

  ipcMain.handle('mcp:connect', async (_event, id: string) => {
    return await connectMCPServer(id)
  })

  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    return await disconnectMCPServer(id)
  })

  ipcMain.handle('mcp:health', async (_event, id: string) => {
    return await checkMCPServerHealth(id)
  })


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', async () => {
    clearInterval(autoTrainTimer)
    stopAllWatchers()
    await shutdownAllMCP().catch(err => console.error('[Main] MCP shutdown failed:', err))
    await shutdownAll().catch(err => console.error('[Main] Skill shutdown failed:', err))
    closeDb()
  })
}).catch((err) => console.error('[Main] app.whenReady() failed:', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
