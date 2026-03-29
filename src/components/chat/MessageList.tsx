import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { cn } from '../../lib/utils'
import type { Message } from '../../types'

interface MessageListProps {
  messages: Message[]
  onFeedback?: (messageId: string, type: 'thumbs_up' | 'thumbs_down') => void
  onCopy?: (messageId: string) => void
  searchMatchIds?: string[]
  searchCurrentId?: string | null
  searchQuery?: string
}

export function MessageList({ messages, onFeedback, onCopy, searchMatchIds, searchCurrentId, searchQuery }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUp = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const scrollToBottom = useCallback(() => {
    isUserScrolledUp.current = false
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowScrollButton(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 100
    if (isAtBottom) {
      isUserScrolledUp.current = false
      setShowScrollButton(false)
    } else {
      isUserScrolledUp.current = true
      setShowScrollButton(true)
    }
  }, [])

  useEffect(() => {
    if (!isUserScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    if (!searchCurrentId) return
    const el = document.getElementById(`msg-${searchCurrentId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [searchCurrentId])

  return (
    <div className="relative h-full">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="max-w-[900px] mx-auto">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onFeedback={onFeedback}
              onCopy={onCopy}
              isSearchMatch={!!searchMatchIds?.includes(message.id)}
              isSearchCurrent={searchCurrentId === message.id}
              searchQuery={searchQuery ?? ''}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <button
        onClick={scrollToBottom}
        className={cn(
          'absolute bottom-4 right-6 z-10',
          'w-8 h-8 rounded-full flex items-center justify-center',
          'bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-md',
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]',
          'transition-all duration-200',
          showScrollButton
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-2 pointer-events-none'
        )}
        title="Cuộn xuống dưới"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  )
}
