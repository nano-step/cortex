import { useState, useEffect } from 'react'
import {
  Unplug, ChevronDown, ChevronRight, Plus, Trash2,
  RefreshCw, Loader2, Plug, Terminal, Globe, AlertCircle, Zap
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useMCPStore, type MCPServerInfo } from '../../stores/mcpStore'

interface MCPServerListProps {
  expanded: boolean
  onToggle: () => void
}

interface MCPPreset {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string
  serverUrl?: string
  envHint?: string
  envHints?: Array<{ key: string; label: string; secret?: boolean; required?: boolean }>
  category?: 'research' | 'dev' | 'utility'
  description?: string
}

const MCP_PRESETS: MCPPreset[] = [
  // — Research & Deep Search —
  { name: 'Tavily Search', transport: 'stdio', command: 'npx', args: '-y tavily-mcp', category: 'research', description: 'AI-optimized search + full content',
    envHints: [{ key: 'TAVILY_API_KEY', label: 'Tavily API Key', secret: true, required: true }] },
  { name: 'Firecrawl', transport: 'stdio', command: 'npx', args: '-y firecrawl-mcp', category: 'research', description: 'Web scraping, JS-rendered pages',
    envHints: [{ key: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', secret: true, required: true }] },
  { name: 'Exa Search', transport: 'stdio', command: 'npx', args: '-y exa-mcp-server', category: 'research', description: 'Semantic search + content crawling',
    envHints: [{ key: 'EXA_API_KEY', label: 'Exa API Key', secret: true, required: true }] },
  { name: 'Jina AI Reader', transport: 'sse', serverUrl: 'https://mcp.jina.ai/v1', category: 'research', description: 'Read URLs, web/arXiv search, screenshots — 19 tools',
    envHints: [{ key: 'JINA_API_KEY', label: 'Jina API Key (optional, free tier)', secret: true, required: false }] },
  // — Development —
  { name: 'GitHub', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-github', category: 'dev', envHint: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  { name: 'Slack', transport: 'stdio', command: 'npx', args: '-y slack-mcp-server', category: 'dev', envHints: [
    { key: 'SLACK_MCP_XOXC_TOKEN', label: 'Slack xoxc- token', secret: true },
    { key: 'SLACK_MCP_XOXD_TOKEN', label: 'Slack xoxd- token (cookie d)', secret: true },
  ] },
  // — Utility —
  { name: 'Filesystem', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem .', category: 'utility' },
  { name: 'Sequential Thinking', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-sequential-thinking', category: 'utility' },
  { name: 'Memory', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-memory', category: 'utility' },
]

const PRESET_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'research', label: 'Research & Deep Search' },
  { key: 'dev', label: 'Development' },
  { key: 'utility', label: 'Utility' },
]

export function MCPServerList({ expanded, onToggle }: MCPServerListProps) {
  const { servers, loading, connecting, loadServers, addServer, removeServer, connectServer, disconnectServer, checkHealth } = useMCPStore()
  const [addOpen, setAddOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formTransport, setFormTransport] = useState<'stdio' | 'sse'>('stdio')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formEnv, setFormEnv] = useState('')
  const [adding, setAdding] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [pendingPreset, setPendingPreset] = useState<MCPPreset | null>(null)
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (expanded) loadServers()
  }, [expanded, loadServers])

  const connectedCount = servers.filter(s => s.connected).length

  const resetForm = () => {
    setFormName('')
    setFormCommand('')
    setFormArgs('')
    setFormUrl('')
    setFormEnv('')
    setFormTransport('stdio')
  }

  const handleAdd = async () => {
    if (!formName.trim()) return
    setAdding(true)
    try {
      const server = await addServer({
        name: formName.trim(),
        transportType: formTransport,
        command: formTransport === 'stdio' ? formCommand.trim() || undefined : undefined,
        args: formTransport === 'stdio' ? formArgs.trim() || undefined : undefined,
        serverUrl: formTransport === 'sse' ? formUrl.trim() || undefined : undefined,
        env: formEnv.trim() || undefined,
      })
      resetForm()
      setAddOpen(false)
      if (server) {
        await connectServer(server.id)
      }
    } finally {
      setAdding(false)
    }
  }

  const handlePresetClick = (preset: MCPPreset) => {
    const existingNames = servers.map(s => s.name.toLowerCase())
    if (existingNames.includes(preset.name.toLowerCase())) return

    const needsEnv = preset.envHints?.length || preset.envHint
    if (needsEnv) {
      setPendingPreset(preset)
      setPresetEnvValues({})
      setShowPresets(false)
    } else {
      submitPreset(preset, undefined)
    }
  }

  const submitPreset = async (preset: MCPPreset, env: string | undefined) => {
    setAdding(true)
    try {
      const server = await addServer({
        name: preset.name,
        transportType: preset.transport,
        command: preset.transport === 'stdio' ? preset.command : undefined,
        args: preset.transport === 'stdio' ? preset.args : undefined,
        serverUrl: preset.serverUrl,
        env,
      })
      setPendingPreset(null)
      setPresetEnvValues({})
      setShowPresets(false)
      if (server) {
        await connectServer(server.id)
      }
    } finally {
      setAdding(false)
    }
  }

  const handleToggleConnection = async (server: MCPServerInfo) => {
    if (server.connected) {
      await disconnectServer(server.id)
    } else {
      await connectServer(server.id)
    }
  }

  return (
    <section>
      <button onClick={onToggle} className="flex items-center gap-2 w-full mb-3">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <div className="flex items-center gap-2">
          <Unplug size={16} className="text-[var(--accent-primary)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            MCP Servers
          </h3>
        </div>
        {servers.length > 0 && (
          <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
            {connectedCount}/{servers.length} kết nối
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 pl-2">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-[var(--text-tertiary)]" />
            </div>
          )}

          {!loading && servers.length === 0 && !addOpen && !showPresets && (
            <div className="text-center py-6">
              <Unplug size={24} className="text-[var(--text-tertiary)] mx-auto mb-2 opacity-40" />
              <p className="text-[12px] text-[var(--text-tertiary)] mb-3">Chưa có MCP server nào</p>
              <div className="flex flex-col gap-2 items-center">
                <button
                  onClick={() => setShowPresets(true)}
                  className="flex items-center gap-1.5 text-[12px] text-[var(--accent-primary)] hover:underline font-medium"
                >
                  <Zap size={12} /> Thêm nhanh từ presets
                </button>
                <button
                  onClick={() => setAddOpen(true)}
                  className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  Hoặc thêm thủ công
                </button>
              </div>
            </div>
          )}

          {showPresets && (
            <div className="space-y-3">
              <p className="text-[11px] text-[var(--text-tertiary)] font-medium uppercase tracking-wider">Chọn server để thêm</p>
              {PRESET_CATEGORIES.map(cat => {
                const categoryPresets = MCP_PRESETS.filter(p => p.category === cat.key)
                if (categoryPresets.length === 0) return null
                return (
                  <div key={cat.key}>
                    <p className="text-[10px] text-[var(--accent-primary)] font-semibold uppercase tracking-wider mb-1.5">{cat.label}</p>
                    <div className="space-y-1.5">
                      {categoryPresets.map(preset => {
                        const alreadyAdded = servers.some(s => s.name.toLowerCase() === preset.name.toLowerCase())
                        return (
                          <button
                            key={preset.name}
                            onClick={() => !alreadyAdded && handlePresetClick(preset)}
                            disabled={adding || alreadyAdded}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
                              alreadyAdded
                                ? 'border-[var(--border-primary)] bg-[var(--bg-secondary)] opacity-50 cursor-not-allowed'
                                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] cursor-pointer'
                            )}
                          >
                            {preset.transport === 'sse' ? (
                              <Globe size={14} className="text-[var(--text-tertiary)] shrink-0" />
                            ) : (
                              <Terminal size={14} className="text-[var(--text-tertiary)] shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-[var(--text-primary)]">{preset.name}</p>
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                                {preset.description || (preset.command ? `${preset.command} ${preset.args || ''}` : preset.serverUrl)}
                              </p>
                            </div>
                            {alreadyAdded && <span className="text-[10px] text-[var(--text-tertiary)]">Đã thêm</span>}
                            {(preset.envHint || preset.envHints) && !alreadyAdded && (
                              <span className="text-[10px] text-amber-500 shrink-0">Cần token</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <div className="flex gap-2 mt-2">
                <button onClick={() => setShowPresets(false)} className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  Đóng
                </button>
                <button onClick={() => { setShowPresets(false); setAddOpen(true) }} className="text-[11px] text-[var(--accent-primary)] hover:underline">
                  Thêm thủ công
                </button>
              </div>
            </div>
          )}

          {pendingPreset && (
            <div className="space-y-2 px-3 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--accent-primary)]">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                Cấu hình {pendingPreset.name}
              </p>
              {pendingPreset.envHints?.map(hint => (
                <div key={hint.key}>
                  <label className="text-[11px] text-[var(--text-tertiary)] mb-1 block">{hint.label}</label>
                  <Input
                    type={hint.secret ? 'password' : 'text'}
                    className="!py-1.5 !text-[12px]"
                    placeholder={hint.key}
                    value={presetEnvValues[hint.key] || ''}
                    onChange={e => setPresetEnvValues(prev => ({ ...prev, [hint.key]: e.target.value }))}
                  />
                </div>
              ))}
              {pendingPreset.envHint && !pendingPreset.envHints && (
                <div>
                  <label className="text-[11px] text-[var(--text-tertiary)] mb-1 block">{pendingPreset.envHint}</label>
                  <Input
                    type="password"
                    className="!py-1.5 !text-[12px]"
                    placeholder={pendingPreset.envHint}
                    value={presetEnvValues[pendingPreset.envHint] || ''}
                    onChange={e => setPresetEnvValues(prev => ({ ...prev, [pendingPreset.envHint!]: e.target.value }))}
                  />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={adding || (() => {
                    if (pendingPreset.envHints) return pendingPreset.envHints.filter(h => h.required !== false).some(h => !presetEnvValues[h.key]?.trim())
                    if (pendingPreset.envHint) return !presetEnvValues[pendingPreset.envHint]?.trim()
                    return false
                  })()}
                  onClick={() => {
                    const envObj: Record<string, string> = {}
                    if (pendingPreset.envHints) {
                      for (const h of pendingPreset.envHints) {
                        if (presetEnvValues[h.key]?.trim()) envObj[h.key] = presetEnvValues[h.key]
                      }
                    } else if (pendingPreset.envHint) {
                      envObj[pendingPreset.envHint] = presetEnvValues[pendingPreset.envHint]
                    }
                    const envStr = Object.keys(envObj).length > 0 ? JSON.stringify(envObj) : undefined
                    submitPreset(pendingPreset, envStr)
                  }}
                >
                  {adding ? <><Loader2 size={12} className="animate-spin" /> Đang thêm...</> : 'Xác nhận'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setPendingPreset(null); setPresetEnvValues({}) }}>
                  Hủy
                </Button>
              </div>
            </div>
          )}

          {!loading && servers.map((server) => (
            <div
              key={server.id}
              className="px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
            >
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  server.connected ? 'bg-green-500'
                    : server.lastError ? 'bg-[var(--status-error-text)]'
                    : 'bg-[var(--text-tertiary)]'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {server.name}
                    </span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                      'bg-[var(--bg-primary)] text-[var(--text-tertiary)] border border-[var(--border-primary)]'
                    )}>
                      {server.transportType === 'stdio' ? (
                        <span className="flex items-center gap-0.5"><Terminal size={9} /> stdio</span>
                      ) : (
                        <span className="flex items-center gap-0.5"><Globe size={9} /> sse</span>
                      )}
                    </span>
                  </div>
                  {server.connected ? (
                    <p className="text-[11px] text-green-600 mt-0.5">
                      {server.toolCount} tools · {server.resourceCount} resources
                    </p>
                  ) : !server.lastError ? (
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      Chưa kết nối
                    </p>
                  ) : null}
                  {server.lastError && !server.connected && (
                    <p className="text-[11px] text-[var(--status-error-text)] mt-0.5 flex items-center gap-1">
                      <AlertCircle size={10} className="shrink-0" />
                      <span className="truncate">{server.lastError}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {connecting === server.id ? (
                    <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" />
                  ) : (
                    <button
                      onClick={() => handleToggleConnection(server)}
                      className={cn(
                        'px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-100',
                        server.connected
                          ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                          : 'bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)]'
                      )}
                    >
                      {server.connected ? (
                        <span className="flex items-center gap-1"><Plug size={10} /> Ngắt</span>
                      ) : (
                        <span className="flex items-center gap-1"><Plug size={10} /> Kết nối</span>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => checkHealth(server.id)}
                    className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors"
                    title="Kiểm tra"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    onClick={() => removeServer(server.id)}
                    className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--status-error-text)] transition-colors"
                    title="Xóa"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {!addOpen && !showPresets && servers.length > 0 && (
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => setShowPresets(true)}
                className="flex items-center gap-1.5 text-[12px] text-[var(--accent-primary)] hover:underline"
              >
                <Zap size={12} /> Presets
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                <Plus size={12} /> Thêm thủ công
              </button>
            </div>
          )}

          {addOpen && (
            <div className="px-3 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] space-y-2.5 mt-2">
              <Input
                placeholder="Tên server"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setFormTransport('stdio')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all',
                    'border',
                    formTransport === 'stdio'
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-light)] text-[var(--accent-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)]'
                  )}
                >
                  <Terminal size={14} /> stdio
                </button>
                <button
                  onClick={() => setFormTransport('sse')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all',
                    'border',
                    formTransport === 'sse'
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-light)] text-[var(--accent-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)]'
                  )}
                >
                  <Globe size={14} /> SSE / HTTP
                </button>
              </div>
              {formTransport === 'stdio' ? (
                <>
                  <Input
                    placeholder="Command (vd: npx, node, python)"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                  />
                  <Input
                    placeholder="Args (vd: -y @modelcontextprotocol/server-github)"
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                  />
                </>
              ) : (
                <Input
                  placeholder="Server URL (vd: http://localhost:3000/mcp)"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                />
              )}
              <Input
                placeholder='Env JSON (vd: {"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_..."})'
                value={formEnv}
                onChange={(e) => setFormEnv(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setAddOpen(false); resetForm() }}>
                  Hủy
                </Button>
                <Button size="sm" onClick={handleAdd} disabled={adding || !formName.trim()}>
                  {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Thêm & Kết nối
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
