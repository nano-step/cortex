import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Message } from '../../types'

interface MessageSearchProps {
  open: boolean
  messages: Message[]
  onClose: () => void
  onMatchChange: (matchedIds: string[], currentIndex: number, query: string) => void
}

export function MessageSearch({ open, messages, onClose, onMatchChange }: MessageSearchProps) {
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matchedIds = query.trim().length >= 1
    ? messages
        .filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
        .map(m => m.id)
    : []

  const matchCount = matchedIds.length

  useEffect(() => {
    setCurrentIndex(0)
    onMatchChange(matchedIds, 0, query)
  }, [query])

  useEffect(() => {
    onMatchChange(matchedIds, currentIndex, query)
  }, [currentIndex])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCurrentIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      onMatchChange([], 0, '')
    }
  }, [open])

  const goNext = useCallback(() => {
    if (matchCount === 0) return
    setCurrentIndex(i => (i + 1) % matchCount)
  }, [matchCount])

  const goPrev = useCallback(() => {
    if (matchCount === 0) return
    setCurrentIndex(i => (i - 1 + matchCount) % matchCount)
  }, [matchCount])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter') { e.shiftKey ? goPrev() : goNext() }
  }

  if (!open) return null

  return (
    <div className={cn(
      'absolute top-0 right-0 z-40',
      'flex items-center gap-2 px-3 py-2',
      'bg-[var(--bg-primary)] border border-[var(--border-primary)]',
      'rounded-bl-xl shadow-lg',
      'animate-in slide-in-from-top duration-150'
    )}>
      <Search size={14} className="text-[var(--text-tertiary)] shrink-0" />

      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tìm trong cuộc trò chuyện..."
        className={cn(
          'w-56 bg-transparent outline-none',
          'text-[13px] text-[var(--text-primary)]',
          'placeholder:text-[var(--text-tertiary)]'
        )}
      />

      {query.length > 0 && (
        <span className={cn(
          'text-[11px] shrink-0',
          matchCount > 0 ? 'text-[var(--text-tertiary)]' : 'text-[var(--status-error-text)]'
        )}>
          {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : 'Không tìm thấy'}
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <button
          onClick={goPrev}
          disabled={matchCount === 0}
          className={cn(
            'p-1 rounded-md transition-colors',
            'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--bg-secondary)]',
            'disabled:opacity-30 disabled:pointer-events-none'
          )}
          title="Trước (Shift+Enter)"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={goNext}
          disabled={matchCount === 0}
          className={cn(
            'p-1 rounded-md transition-colors',
            'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--bg-secondary)]',
            'disabled:opacity-30 disabled:pointer-events-none'
          )}
          title="Tiếp theo (Enter)"
        >
          <ChevronDown size={14} />
        </button>
        <button
          onClick={onClose}
          className={cn(
            'p-1 rounded-md transition-colors',
            'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--bg-secondary)]'
          )}
          title="Đóng (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
