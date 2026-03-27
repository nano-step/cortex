import { BrowserWindow } from 'electron'
import type { IpcMain, App } from 'electron'
import {
  getProxyConfig, setProxyConfig, getProxyUrl, getProxyKey,
  getLLMConfig, setLLMConfig,
  getGitConfig, setGitConfig, testProxyConnection,
  getSetting, setSetting,
  getAtlassianConfig,
  getQdrantConfig, setQdrantConfig, getJinaApiKey, setJinaApiKey,
  getVoyageApiKey, setVoyageApiKey, getEmbeddingProvider,
  getGitHubModelsEmbeddingEnabled, setGitHubModelsEmbeddingEnabled
} from '../services/settings-service'
import { clearAuthFailedModels, fetchAvailableModels, getActiveModel, getAvailableModels, setActiveModel, getAutoRotation, setAutoRotation, refreshModelsWithCheck } from '../services/llm-client'
import { embedQuery, getEmbedderStatus, getThrottleStatus, EMBEDDING_DIMENSIONS, VOYAGE_MODELS, getSelectedVoyageModel, setSelectedVoyageModel } from '../services/embedder'
import { resetQdrantClient } from '../services/qdrant-store'
import { getComfyUIUrl, setComfyUIUrl, getComfyUIApiKey, setComfyUIApiKey, testComfyUIConnection } from '../services/comfyui-client'
import { getHuggingFaceToken, setHuggingFaceToken } from '../services/skills/builtin/artist-tools'
import { getOpenRouterApiKey, setOpenRouterApiKey, getOpenRouterEnabled, setOpenRouterEnabled, getFreeModels, testOpenRouterConnection } from '../services/skills/efficiency/openrouter-fallback'
import { getPerplexitySession, isPerplexityLoggedIn, executePerplexityTool } from '../services/skills/builtin/perplexity-tools'
import { getGitHubPAT, setGitHubPAT } from '../services/settings-service'

export function registerSettingsIPC(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('settings:getProxyConfig', () => getProxyConfig())
  ipcMain.handle('settings:setProxyConfig', (_event, url: string, key: string) => {
    const prev = getProxyConfig()
    const changed = prev.url !== url || prev.key !== key
    setProxyConfig(url, key)
    if (changed) clearAuthFailedModels()
    return true
  })
  ipcMain.handle('settings:getLLMConfig', () => getLLMConfig())
  ipcMain.handle('settings:setLLMConfig', (_event, maxTokens: number, contextMessages: number) => { setLLMConfig(maxTokens, contextMessages); return true })

  ipcMain.handle('settings:getEmbeddingConfig', () => {
    const status = getEmbedderStatus()
    return {
      mode: 'cloud', provider: status.provider, model: status.model,
      dimensions: EMBEDDING_DIMENSIONS, batchSize: status.batchSize,
      tokenLimit: status.tokenLimit, tokensUsed: status.tokensUsed,
      hasVoyageKey: !!getVoyageApiKey(), hasJinaKey: !!getJinaApiKey()
    }
  })

  ipcMain.handle('settings:getQdrantConfig', () => getQdrantConfig() || { url: '', apiKey: '' })
  ipcMain.handle('settings:setQdrantConfig', (_event, url: string, apiKey: string) => { setQdrantConfig(url, apiKey); resetQdrantClient(); return true })
  ipcMain.handle('settings:getJinaApiKey', () => getJinaApiKey() || '')
  ipcMain.handle('settings:setJinaApiKey', (_event, key: string) => { setJinaApiKey(key); return true })

  ipcMain.handle('comfyui:getUrl', () => getComfyUIUrl())
  ipcMain.handle('comfyui:setUrl', (_event, url: string) => { setComfyUIUrl(url); return true })
  ipcMain.handle('comfyui:getApiKey', () => getComfyUIApiKey() || '')
  ipcMain.handle('comfyui:setApiKey', (_event, key: string) => { setComfyUIApiKey(key); return true })
  ipcMain.handle('comfyui:test', async () => testComfyUIConnection())

  ipcMain.handle('settings:getHuggingFaceToken', () => getHuggingFaceToken() || '')
  ipcMain.handle('settings:setHuggingFaceToken', (_event, token: string) => { setHuggingFaceToken(token); return true })

  ipcMain.handle('settings:getVoyageApiKey', () => getVoyageApiKey() || '')
  ipcMain.handle('settings:setVoyageApiKey', (_event, key: string) => { setVoyageApiKey(key); return true })
  ipcMain.handle('settings:getEmbeddingProvider', () => getEmbeddingProvider())
  ipcMain.handle('settings:getGitHubModelsEmbeddingEnabled', () => getGitHubModelsEmbeddingEnabled())
  ipcMain.handle('settings:setGitHubModelsEmbeddingEnabled', (_event, enabled: boolean) => { setGitHubModelsEmbeddingEnabled(enabled); return true })
  ipcMain.handle('settings:getVoyageModels', () => VOYAGE_MODELS)
  ipcMain.handle('settings:getSelectedVoyageModel', () => getSelectedVoyageModel())
  ipcMain.handle('settings:setSelectedVoyageModel', (_event, modelId: string) => { setSelectedVoyageModel(modelId); return true })

  ipcMain.handle('settings:getPerplexityCookies', () => getSetting('perplexity_cookies') || '')
  ipcMain.handle('settings:setPerplexityCookies', (_event, cookies: string) => { setSetting('perplexity_cookies', cookies, true); return true })
  ipcMain.handle('settings:loginPerplexity', async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const mainWindow = getMainWindow()
      const pplxSession = getPerplexitySession()
      const authWin = new BrowserWindow({
        width: 900, height: 700, title: 'Đăng nhập Perplexity',
        parent: mainWindow || undefined, modal: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:perplexity' }
      })
      authWin.loadURL('https://www.perplexity.ai/')
      let resolved = false
      const finish = (result: { success: boolean; error?: string }) => {
        if (resolved) return
        resolved = true
        resolve(result)
      }
      const cookieCheckInterval = setInterval(async () => {
        try {
          const cookies = await pplxSession.cookies.get({ domain: 'perplexity.ai' })
          const hasSession = cookies.some(c => c.name === '__Secure-next-auth.session-token')
          if (!hasSession) return
          setSetting('perplexity_logged_in', 'true', false)
          clearInterval(cookieCheckInterval)
          if (!authWin.isDestroyed()) authWin.close()
          finish({ success: true })
        } catch { }
      }, 2000)
      authWin.on('closed', () => { clearInterval(cookieCheckInterval); finish({ success: false, error: 'Cửa sổ đăng nhập đã đóng' }) })
    })
  })

  ipcMain.handle('settings:testPerplexity', async () => {
    try {
      const loggedIn = await isPerplexityLoggedIn()
      if (!loggedIn) return { success: false, error: 'Chưa đăng nhập Perplexity. Bấm "Đăng nhập Perplexity" trước.' }
      const start = Date.now()
      const result = await executePerplexityTool('cortex_perplexity_search', JSON.stringify({ query: 'ping test: respond with "OK"' }))
      if (result.isError) return { success: false, error: result.content }
      return { success: true, latencyMs: Date.now() - start, preview: result.content.slice(0, 150) }
    } catch (err) { return { success: false, error: String(err instanceof Error ? err.message : err) } }
  })

  ipcMain.handle('settings:testEmbeddingConnection', async () => {
    try {
      const start = Date.now()
      const embedding = await embedQuery('test embedding')
      return { success: true, dimensions: embedding.length, latencyMs: Date.now() - start }
    } catch (err) { return { success: false, error: String(err instanceof Error ? err.message : err) } }
  })

  ipcMain.handle('settings:getGitConfig', () => getGitConfig())
  ipcMain.handle('settings:setGitConfig', (_event, cloneDepth: number) => { setGitConfig(cloneDepth); return true })
  ipcMain.handle('settings:testProxyConnection', async (_event, url: string, key: string) => testProxyConnection(url, key))

  ipcMain.handle('settings:healthCheck', async () => {
    const results: Record<string, { status: 'ok' | 'missing' | 'error'; detail?: string; latencyMs?: number }> = {}
    try {
      const proxyResult = await testProxyConnection(getProxyUrl(), getProxyKey())
      results.proxy = proxyResult.success ? { status: 'ok', detail: getProxyUrl(), latencyMs: proxyResult.latencyMs } : { status: 'error', detail: proxyResult.error }
    } catch (e) { results.proxy = { status: 'error', detail: String(e) } }
    const embeddingProvider = getEmbeddingProvider()
    if (embeddingProvider !== 'proxy') {
      try {
        const start = Date.now()
        const emb = await embedQuery('health check')
        results.embedding = { status: 'ok', detail: `${embeddingProvider} (${emb.length} dims)`, latencyMs: Date.now() - start }
      } catch (e) { results.embedding = { status: 'error', detail: String(e) } }
    } else {
      results.embedding = { status: 'missing', detail: 'Set Voyage, Jina API key, or enable GitHub Models Embedding' }
    }
    const qdrantCfg = getQdrantConfig()
    if (qdrantCfg?.url) {
      try {
        const start = Date.now()
        const resp = await fetch(`${qdrantCfg.url}/collections`, { headers: qdrantCfg.apiKey ? { 'api-key': qdrantCfg.apiKey } : {}, signal: AbortSignal.timeout(5000) })
        results.qdrant = resp.ok ? { status: 'ok', detail: qdrantCfg.url, latencyMs: Date.now() - start } : { status: 'error', detail: `HTTP ${resp.status}` }
      } catch (e) { results.qdrant = { status: 'error', detail: String(e) } }
    } else {
      results.qdrant = { status: 'missing', detail: 'Optional — set Qdrant URL in Settings' }
    }
    results.openrouter = getSetting('openrouter_api_key') ? { status: 'ok', detail: 'Key configured' } : { status: 'missing', detail: 'Optional — for vision + image gen' }
    const atlCfg = getAtlassianConfig()
    results.atlassian = atlCfg ? { status: 'ok', detail: atlCfg.siteUrl } : { status: 'missing', detail: 'Optional — for Jira + Confluence' }
    results.github = getGitHubPAT() ? { status: 'ok', detail: 'PAT configured' } : { status: 'missing', detail: 'Optional — for PR review + code context' }
    results.perplexity = getSetting('perplexity_cookies') ? { status: 'ok', detail: 'Cookies configured' } : { status: 'missing', detail: 'Optional — for web search' }
    return results
  })

  ipcMain.handle('settings:completeOnboarding', () => { setSetting('onboarding_completed', 'true'); return true })
  ipcMain.handle('settings:isOnboardingCompleted', () => getSetting('onboarding_completed') === 'true')

  ipcMain.handle('llm:getActiveModel', async () => {
    const active = getActiveModel()
    if (active === 'loading...') { await fetchAvailableModels(); return getActiveModel() }
    return active
  })
  ipcMain.handle('llm:getAvailableModels', async () => {
    let models = getAvailableModels()
    if (models.length === 0) { await fetchAvailableModels(); models = getAvailableModels() }
    return models
  })
  ipcMain.handle('llm:refreshModels', async () => {
    const models = await fetchAvailableModels()
    return models.map(m => ({ id: m.id, tier: m.tier }))
  })
  ipcMain.handle('llm:refreshModelsWithCheck', async () => refreshModelsWithCheck())
  ipcMain.handle('llm:setModel', (_event, modelId: string) => setActiveModel(modelId))
  ipcMain.handle('llm:getAutoRotation', () => getAutoRotation())
  ipcMain.handle('llm:setAutoRotation', (_event, enabled: boolean) => { setAutoRotation(enabled); if (enabled) clearAuthFailedModels(); return true })

  ipcMain.handle('openrouter:getConfig', () => ({ apiKey: getOpenRouterApiKey() || '', enabled: getOpenRouterEnabled(), freeModels: getFreeModels() }))
  ipcMain.handle('openrouter:setApiKey', (_event, key: string) => { setOpenRouterApiKey(key); return true })
  ipcMain.handle('openrouter:setEnabled', (_event, enabled: boolean) => { setOpenRouterEnabled(enabled); return true })
  ipcMain.handle('openrouter:test', async () => testOpenRouterConnection())
}
