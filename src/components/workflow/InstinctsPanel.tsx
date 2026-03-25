import { useState, useEffect, useCallback } from 'react'
import { Brain, Trash2, RefreshCw, Star, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Instinct {
  id: string
  name: string
  pattern: string
  action: string
  evidence: string
  confidence: number
  useCount: number
  createdAt: number
  lastUsed: number | null
}

interface InstinctsPanelProps {
  open: boolean
  onClose: () => void
}

export function InstinctsPanel({ open, onClose }: InstinctsPanelProps) {
  const [instincts, setInstincts] = useState<Instinct[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.instinctsList?.()
      setInstincts((result || []) as Instinct[])
    } catch (err) {
      console.error('Failed to load instincts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await window.electronAPI?.instinctsDelete?.(id)
      setInstincts(prev => prev.filter(i => i.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[640px] max-h-[80vh] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-[var(--accent-primary)]" />
            <span className="font-semibold text-[15px]">Learned Instincts</span>
            <span className="text-[12px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full">
              {instincts.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-4 py-3 bg-[var(--accent-light)] border-b border-[var(--border-primary)]">
          <p className="text-[12px] text-[var(--text-secondary)]">
            Instincts are patterns automatically extracted from your conversations. They're injected as context to help Cortex respond better to similar situations.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
              <RefreshCw size={16} className="animate-spin mr-2" />
              Loading instincts...
            </div>
          )}

          {!loading && instincts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Brain size={32} className="text-[var(--text-tertiary)] mb-3 opacity-40" />
              <p className="text-[13px] text-[var(--text-tertiary)]">No instincts yet</p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1 opacity-70">
                Instincts are extracted automatically every 10 messages
              </p>
            </div>
          )}

          {!loading && instincts.map(instinct => (
            <div
              key={instinct.id}
              className="border border-[var(--border-primary)] rounded-xl overflow-hidden bg-[var(--bg-secondary)]"
            >
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                onClick={() => toggleExpand(instinct.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {expanded.has(instinct.id)
                    ? <ChevronDown size={14} className="text-[var(--text-tertiary)] shrink-0" />
                    : <ChevronRight size={14} className="text-[var(--text-tertiary)] shrink-0" />
                  }
                  <span className="text-[13px] font-medium truncate">{instinct.name}</span>
                </div>
                <div className="flex items-center gap-3 ml-3 shrink-0">
                  <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                    <TrendingUp size={10} />
                    <span>{Math.round(instinct.confidence * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                    <Star size={10} />
                    <span>{instinct.useCount}</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(instinct.id) }}
                    disabled={deleting === instinct.id}
                    className={cn(
                      'p-1 rounded hover:bg-red-500/10 hover:text-red-400 text-[var(--text-tertiary)] transition-colors',
                      deleting === instinct.id && 'opacity-50'
                    )}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </button>

              {expanded.has(instinct.id) && (
                <div className="px-4 pb-4 border-t border-[var(--border-primary)] pt-3 space-y-3">
                  <div>
                    <p className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Pattern</p>
                    <p className="text-[12px] text-[var(--text-secondary)]">{instinct.pattern}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Action</p>
                    <p className="text-[12px] text-[var(--text-secondary)]">{instinct.action}</p>
                  </div>
                  {instinct.evidence && (
                    <div>
                      <p className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Evidence</p>
                      <p className="text-[11px] text-[var(--text-tertiary)] italic">&ldquo;{instinct.evidence.slice(0, 150)}&rdquo;</p>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-[10px] text-[var(--text-tertiary)]">
                    <span>Created {new Date(instinct.createdAt).toLocaleDateString()}</span>
                    {instinct.lastUsed && (
                      <span>Last used {new Date(instinct.lastUsed).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
