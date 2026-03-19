import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Server,
  Brain,
  Zap,
  GitBranch,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Moon,
  Sun,
  Palette
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { APP_VERSION, APP_NAME } from '../../lib/version'
import { useUIStore } from '../../stores/uiStore'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { theme, toggleTheme } = useUIStore()
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyKey, setProxyKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [testLatency, setTestLatency] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  // LLM Config
  const [maxTokens, setMaxTokens] = useState(8192)
  const [contextMessages, setContextMessages] = useState(20)

  // Git Config
  const [cloneDepth, setCloneDepth] = useState(1)

  // Advanced collapsed
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [githubToken, setGithubToken] = useState('')
  const [githubConfigured, setGithubConfigured] = useState(false)
  const [showGithubToken, setShowGithubToken] = useState(false)

  const [autoRotation, setAutoRotationState] = useState(true)

  const [embeddingModelName, setEmbeddingModelName] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState(0)
  const [embeddingTestStatus, setEmbeddingTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [embeddingTestError, setEmbeddingTestError] = useState('')
  const [embeddingTestDims, setEmbeddingTestDims] = useState(0)
  const [embeddingTestLatency, setEmbeddingTestLatency] = useState(0)


  const [voyageApiKey, setVoyageApiKey] = useState('')
  const [showVoyageKey, setShowVoyageKey] = useState(false)
  const [voyageModels, setVoyageModels] = useState<Array<{ id: string; name: string; dims: number; description: string }>>([])
  const [selectedVoyageModel, setSelectedVoyageModelState] = useState('voyage-3-large')
  const [openrouterApiKey, setOpenrouterApiKey] = useState('')
  const [showOpenrouterKey, setShowOpenrouterKey] = useState(false)
  const [qdrantUrl, setQdrantUrl] = useState('')
  const [qdrantApiKey, setQdrantApiKey] = useState('')
  const [showQdrantKey, setShowQdrantKey] = useState(false)
  const [jinaApiKey, setJinaApiKey] = useState('')
  const [showJinaKey, setShowJinaKey] = useState(false)
  const [perplexityConnected, setPerplexityConnected] = useState(false)
  const [pplxTestStatus, setPplxTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [pplxTestError, setPplxTestError] = useState('')
  const [pplxLoginStatus, setPplxLoginStatus] = useState<'idle' | 'logging_in' | 'success' | 'error'>('idle')
  // Load settings
  useEffect(() => {
    if (!open) return
    const load = async () => {
      try {
        const proxy = await window.electronAPI.getProxyConfig()
        setProxyUrl(proxy.url)
        setProxyKey(proxy.key)

        const llm = await window.electronAPI.getLLMConfig()
        setMaxTokens(llm.maxTokens)
        setContextMessages(llm.contextMessages)

        const git = await window.electronAPI.getGitConfig()
        setCloneDepth(git.cloneDepth)

        const embedding = await window.electronAPI.getEmbeddingConfig()
        setEmbeddingModelName(embedding.model)
        setEmbeddingDimensions(embedding.dimensions)
      } catch (err) {
        console.error('Failed to load settings:', err)
      }

      try {
        const hasToken = await window.electronAPI.getGitHubPAT()
        setGithubConfigured(hasToken)
      } catch {}

      try {
        const qc = await window.electronAPI.getQdrantConfig()
        if (qc) { setQdrantUrl(qc.url || ''); setQdrantApiKey(qc.apiKey || '') }
        const jk = await window.electronAPI.getJinaApiKey()
        if (jk) setJinaApiKey(jk)
        const vk = await window.electronAPI?.getVoyageApiKey?.()
        if (vk) setVoyageApiKey(vk)
        const vm = await window.electronAPI?.getVoyageModels?.()
        if (vm) setVoyageModels(vm)
        const svm = await window.electronAPI?.getSelectedVoyageModel?.()
        if (svm) setSelectedVoyageModelState(svm)
        const ork = await window.electronAPI?.getOpenRouterConfig?.()
        if (ork?.apiKey) setOpenrouterApiKey(ork.apiKey)
        const pc = await window.electronAPI?.getPerplexityCookies?.()
        if (pc) setPerplexityConnected(true)
      } catch {}

      try {
        const autoRot = await window.electronAPI.getAutoRotation()
        setAutoRotationState(autoRot)
      } catch {}
    }
    load()
  }, [open])

  const handleTestProxy = useCallback(async () => {
    setTestStatus('testing')
    setTestError('')
    try {
      const result = await window.electronAPI.testProxyConnection(proxyUrl, proxyKey)
      if (result.success) {
        setTestStatus('success')
        setTestLatency(result.latencyMs || 0)
      } else {
        setTestStatus('error')
        setTestError(result.error || 'Kết nối thất bại')
      }
    } catch (err) {
      setTestStatus('error')
      setTestError('Lỗi kết nối')
    }
  }, [proxyUrl, proxyKey])

  const handleTestEmbedding = useCallback(async () => {
    setEmbeddingTestStatus('testing')
    setEmbeddingTestError('')
    try {
      const result = await window.electronAPI.testEmbeddingConnection()
      if (result.success) {
        setEmbeddingTestStatus('success')
        setEmbeddingTestDims(result.dimensions || 0)
        setEmbeddingTestLatency(result.latencyMs || 0)
      } else {
        setEmbeddingTestStatus('error')
        setEmbeddingTestError(result.error || 'Kiểm tra thất bại')
      }
    } catch {
      setEmbeddingTestStatus('error')
      setEmbeddingTestError('Lỗi kiểm tra model')
    }
  }, [])

  const handleLoginPerplexity = useCallback(async () => {
    setPplxLoginStatus('logging_in')
    setPplxTestError('')
    try {
      if (!window.electronAPI?.loginPerplexity) {
        setPplxLoginStatus('error')
        setPplxTestError('Cần rebuild app (npm run build)')
        return
      }
      const result = await window.electronAPI.loginPerplexity()
      if (result.success) {
        setPplxLoginStatus('success')
        setPerplexityConnected(true)
      } else {
        setPplxLoginStatus('error')
        setPplxTestError(result.error || 'Đăng nhập thất bại')
      }
    } catch (err) {
      setPplxLoginStatus('error')
      setPplxTestError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleTestPerplexity = useCallback(async () => {
    setPplxTestStatus('testing')
    setPplxTestError('')
    try {
      if (!window.electronAPI?.testPerplexity) {
        setPplxTestStatus('error')
        setPplxTestError('Cần rebuild app (npm run build)')
        return
      }
      const result = await window.electronAPI.testPerplexity()
      if (result.success) {
        setPplxTestStatus('success')
      } else {
        setPplxTestStatus('error')
        setPplxTestError(result.error || 'Kết nối thất bại')
      }
    } catch (err) {
      setPplxTestStatus('error')
      setPplxTestError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      await window.electronAPI.setProxyConfig(proxyUrl, proxyKey)
      await window.electronAPI.setLLMConfig(maxTokens, contextMessages)
      await window.electronAPI.setGitConfig(cloneDepth)
      await window.electronAPI.setAutoRotation(autoRotation)
      if (githubToken) {
        await window.electronAPI.setGitHubPAT(githubToken)
        setGithubConfigured(true)
        setGithubToken('')
      }
      if (qdrantUrl) {
        await window.electronAPI.setQdrantConfig(qdrantUrl, qdrantApiKey)
      }
      if (jinaApiKey) {
        await window.electronAPI.setJinaApiKey(jinaApiKey)
      }
      if (voyageApiKey) {
        await window.electronAPI.setVoyageApiKey(voyageApiKey)
      }
      if (selectedVoyageModel) {
        await window.electronAPI.setSelectedVoyageModel(selectedVoyageModel)
      }
      if (openrouterApiKey) {
        await window.electronAPI.setOpenRouterApiKey(openrouterApiKey)
      }
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Lưu thất bại')
      setTimeout(() => setSaveStatus('idle'), 5000)
    } finally {
      setSaving(false)
    }
  }, [proxyUrl, proxyKey, maxTokens, contextMessages, cloneDepth, autoRotation, githubToken, qdrantUrl, qdrantApiKey, jinaApiKey, voyageApiKey, selectedVoyageModel, openrouterApiKey])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[400px] z-50',
        'bg-[var(--bg-primary)] border-l border-[var(--border-primary)]',
        'shadow-2xl flex flex-col',
        'animate-in slide-in-from-right duration-200'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Cài đặt</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Appearance */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Giao diện
              </h3>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                {theme === 'light' ? <Sun size={16} className="text-[var(--status-warning-text)]" /> : <Moon size={16} className="text-[var(--status-info-text)]" />}
                <div>
                  <label className="block text-[13px] text-[var(--text-primary)]">
                    {theme === 'light' ? 'Sáng' : 'Tối'}
                  </label>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    Chuyển đổi giao diện sáng/tối
                  </p>
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors duration-200',
                  theme === 'dark' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--border-primary)]'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                  theme === 'dark' && 'translate-x-4'
                )} />
              </button>
            </div>
          </section>

          {/* Proxy Configuration */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Server size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                API Proxy
              </h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-[var(--text-secondary)] mb-1">URL</label>
                <Input
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="https://proxy.example.com"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[var(--text-secondary)] mb-1">API Key</label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={proxyKey}
                    onChange={(e) => setProxyKey(e.target.value)}
                    placeholder="Nhập API key..."
                    className="pr-10"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleTestProxy} disabled={testStatus === 'testing'}>
                  {testStatus === 'testing' ? (
                    <><Loader2 size={14} className="animate-spin" /> Đang kiểm tra...</>
                  ) : (
                    <>Kiểm tra kết nối</>
                  )}
                </Button>

                {testStatus === 'success' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--status-success-text)]">
                    <CheckCircle size={14} /> Kết nối thành công ({testLatency}ms)
                  </span>
                )}
                {testStatus === 'error' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--status-error-text)]">
                    <AlertCircle size={14} /> {testError}
                  </span>
                )}
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Cloud RAG
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                Cloud
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-[var(--text-secondary)]">Embedding</span>
                <span className="text-[12px] text-[var(--text-primary)] font-mono">{embeddingModelName || 'jina-embeddings-v3'} ({embeddingDimensions || 1024}d)</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={handleTestEmbedding} disabled={embeddingTestStatus === 'testing'}>
                  {embeddingTestStatus === 'testing' ? (
                    <><Loader2 size={14} className="animate-spin" /> Đang kiểm tra...</>
                  ) : (
                    <>Test Embedding</>
                  )}
                </Button>
                {embeddingTestStatus === 'success' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--status-success-text)]">
                    <CheckCircle size={14} /> {embeddingTestDims}d, {embeddingTestLatency}ms
                  </span>
                )}
                {embeddingTestStatus === 'error' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--status-error-text)]">
                    <AlertCircle size={14} /> {embeddingTestError}
                  </span>
                )}
              </div>

              <div className="border-t border-[var(--border-primary)] pt-3 mt-2">
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">
                  Voyage AI API Key
                  {voyageApiKey && <span className="ml-2 text-[10px] text-green-500">● Active</span>}
                </label>
                <div className="relative">
                  <Input
                    type={showVoyageKey ? 'text' : 'password'}
                    value={voyageApiKey}
                    onChange={(e) => setVoyageApiKey(e.target.value)}
                    placeholder="pa-xxxxxxxx (from dash.voyageai.com)"
                    className="text-[13px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVoyageKey(!showVoyageKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showVoyageKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                  Embedding cho RAG search — 200M tokens/tháng free. Lấy key tại{' '}
                  <a href="https://dash.voyageai.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">dash.voyageai.com</a>
                </p>
                {voyageApiKey && voyageModels.length > 0 && (
                  <div className="mt-2">
                    <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">Embedding Model</label>
                    <select
                      value={selectedVoyageModel}
                      onChange={(e) => setSelectedVoyageModelState(e.target.value)}
                      className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                    >
                      {voyageModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.dims}d) — {m.description}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--border-primary)] pt-3 mt-2">
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">
                  Qdrant Vector Database
                </label>
                <Input
                  value={qdrantUrl}
                  onChange={(e) => setQdrantUrl(e.target.value)}
                  placeholder="http://localhost:6333"
                  className="text-[13px] mb-2"
                />
                <div className="relative">
                  <Input
                    type={showQdrantKey ? 'text' : 'password'}
                    value={qdrantApiKey}
                    onChange={(e) => setQdrantApiKey(e.target.value)}
                    placeholder="API key (để trống nếu local Docker)"
                    className="text-[13px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowQdrantKey(!showQdrantKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showQdrantKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="mt-2 p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
                  <p className="text-[10px] text-[var(--text-tertiary)] font-mono leading-relaxed">
                    <span className="text-[var(--text-secondary)] font-semibold">Docker setup:</span><br/>
                    docker run -d --name qdrant \<br/>
                    &nbsp;&nbsp;-p 6333:6333 \<br/>
                    &nbsp;&nbsp;-v ~/qdrant-data:/qdrant/storage \<br/>
                    &nbsp;&nbsp;qdrant/qdrant
                  </p>
                  <p className="text-[9px] text-[var(--text-tertiary)] mt-1.5">
                    Tùy chọn — cải thiện tốc độ vector search. Cloud:{' '}
                    <a href="https://cloud.qdrant.io/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">cloud.qdrant.io</a>
                  </p>
                </div>
              </div>

              <div className="border-t border-[var(--border-primary)] pt-3 mt-2">
                <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">
                  OpenRouter API Key
                  {openrouterApiKey && <span className="ml-2 text-[10px] text-green-500">● Active</span>}
                </label>
                <div className="relative">
                  <Input
                    type={showOpenrouterKey ? 'text' : 'password'}
                    value={openrouterApiKey}
                    onChange={(e) => setOpenrouterApiKey(e.target.value)}
                    placeholder="sk-or-v1-xxxxxxxx"
                    className="text-[13px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showOpenrouterKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                  Vision (FREE) + Image Generation. Lấy key tại{' '}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">openrouter.ai/keys</a>
                </p>
              </div>

              <div className="border-t border-[var(--border-primary)] pt-3 mt-2">
                <label className="block text-[12px] text-[var(--text-secondary)] mb-1">Jina Reranker API Key</label>
                <div className="relative">
                  <Input
                    type={showJinaKey ? 'text' : 'password'}
                    value={jinaApiKey}
                    onChange={(e) => setJinaApiKey(e.target.value)}
                    placeholder="Jina AI API key (reranking)"
                    className="text-[13px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowJinaKey(!showJinaKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showJinaKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                  Tùy chọn — nếu không có, kết quả trả về theo thứ tự vector similarity
                </p>
              </div>

              <div className="border-t border-[var(--border-primary)] pt-3 mt-2">
                <label className="block text-[12px] text-[var(--text-secondary)] mb-2">
                  Perplexity Pro
                  {perplexityConnected && <span className="ml-2 text-[10px] text-green-500">● Đã kết nối</span>}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLoginPerplexity}
                    disabled={pplxLoginStatus === 'logging_in'}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
                      'border border-[var(--accent-primary)] bg-[var(--accent-light)] text-[var(--accent-primary)]',
                      'hover:bg-[var(--accent-primary)] hover:text-white cursor-pointer',
                      pplxLoginStatus === 'logging_in' && 'opacity-60 cursor-wait'
                    )}
                  >
                    {pplxLoginStatus === 'logging_in' ? (
                      <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Đang đăng nhập...</span>
                    ) : perplexityConnected ? 'Đăng nhập lại' : 'Đăng nhập Perplexity'}
                  </button>
                  {perplexityConnected && (
                    <button
                      onClick={handleTestPerplexity}
                      disabled={pplxTestStatus === 'testing'}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
                        'border border-[var(--border-primary)]',
                        'hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] cursor-pointer'
                      )}
                    >
                      {pplxTestStatus === 'testing' ? (
                        <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Testing...</span>
                      ) : 'Test'}
                    </button>
                  )}
                  {pplxTestStatus === 'success' && (
                    <span className="flex items-center gap-1 text-[11px] text-green-500">
                      <CheckCircle size={12} /> OK
                    </span>
                  )}
                  {pplxLoginStatus === 'success' && pplxTestStatus !== 'success' && (
                    <span className="flex items-center gap-1 text-[11px] text-green-500">
                      <CheckCircle size={12} /> Cookies đã lưu
                    </span>
                  )}
                </div>

                {(pplxTestStatus === 'error' || pplxLoginStatus === 'error') && (
                  <div
                    className="mt-1.5 px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-[11px] text-[var(--status-error-text)] cursor-pointer break-words"
                    title="Click to copy"
                    onClick={() => navigator.clipboard.writeText(pplxTestError)}
                  >
                    <span className="flex items-start gap-1.5">
                      <AlertCircle size={12} className="shrink-0 mt-0.5" />
                      <span>{pplxTestError}</span>
                    </span>
                  </div>
                )}

                <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
                  Dùng Pro subscription cho search & đọc URL. Bấm Đăng nhập → login trên popup → session tự lưu.
                </p>
              </div>
            </div>
          </section>

          {/* Advanced Settings (collapsed) */}
          <section>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-2 w-full mb-3"
            >
              {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-[var(--accent-primary)]" />
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                  Nâng cao
                </h3>
              </div>
            </button>

            {advancedOpen && (
              <div className="space-y-3 pl-6">
                <div>
                  <label className="block text-[12px] text-[var(--text-secondary)] mb-1">
                    Max Tokens (phản hồi): {maxTokens}
                  </label>
                  <input
                    type="range"
                    min={1024}
                    max={16384}
                    step={1024}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full accent-[var(--accent-primary)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>1024</span>
                    <span>16384</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] text-[var(--text-secondary)] mb-1">
                    Context messages: {contextMessages}
                  </label>
                  <input
                    type="range"
                    min={4}
                    max={50}
                    step={2}
                    value={contextMessages}
                    onChange={(e) => setContextMessages(Number(e.target.value))}
                    className="w-full accent-[var(--accent-primary)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>4</span>
                    <span>50</span>
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <label className="block text-[12px] text-[var(--text-secondary)]">
                      Auto-rotation Model
                    </label>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      Tự động chuyển model khi gặp lỗi 401/403
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const newVal = !autoRotation
                      setAutoRotationState(newVal)
                      await window.electronAPI.setAutoRotation(newVal)
                    }}
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors duration-200',
                      autoRotation ? 'bg-[var(--accent-primary)]' : 'bg-[var(--border-primary)]'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                      autoRotation && 'translate-x-4'
                    )} />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Git Configuration */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Git
              </h3>
            </div>

            <div>
              <label className="block text-[12px] text-[var(--text-secondary)] mb-1">
                Clone depth: {cloneDepth === 0 ? 'Full clone' : cloneDepth}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cloneDepth}
                onChange={(e) => setCloneDepth(Number(e.target.value))}
                className="w-full accent-[var(--accent-primary)]"
              />
              <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
                <span>Full</span>
                <span>100</span>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                GitHub
              </h3>
              {githubConfigured && (
                <span className="flex items-center gap-1 text-[11px] text-[var(--status-success-text)]">
                  <CheckCircle size={12} /> Configured
                </span>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-[var(--text-secondary)] mb-1">
                  Personal Access Token
                </label>
                <p className="text-[11px] text-[var(--text-tertiary)] mb-2">
                  For private repos and higher API rate limits.
                </p>
                <div className="relative">
                  <Input
                    type={showGithubToken ? 'text' : 'password'}
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={githubConfigured ? '••••••••' : 'ghp_...'}
                    className="pr-10"
                  />
                  <button
                    onClick={() => setShowGithubToken(!showGithubToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showGithubToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-primary)] space-y-3">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
            ) : saveStatus === 'success' ? (
              <><CheckCircle size={14} /> Đã lưu thành công</>
            ) : (
              'Lưu cài đặt'
            )}
          </Button>
          {saveStatus === 'error' && (
            <p className="text-[11px] text-[var(--status-error-text)] text-center flex items-center justify-center gap-1">
              <AlertCircle size={12} /> {saveError || 'Lưu cài đặt thất bại'}
            </p>
          )}

          <p className="text-[11px] text-[var(--text-tertiary)] text-center">
            {APP_NAME} v{APP_VERSION}
          </p>
        </div>
      </div>
    </>
  )
}
