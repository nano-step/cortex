import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import mermaid from 'mermaid'
import { Brain, User, Copy, Check, FolderTree, ThumbsUp, ThumbsDown, FileText, Download, Maximize2, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Message } from '../../types'
import { TypingIndicator } from './TypingIndicator'
import { ThinkingProcess } from './ThinkingProcess'
import { useChatStore } from '../../stores/chatStore'

// Initialize mermaid once
mermaid.initialize({ startOnLoad: false, theme: 'neutral' })

interface MessageBubbleProps {
  message: Message
  onFeedback?: (messageId: string, type: 'thumbs_up' | 'thumbs_down') => void
  onCopy?: (messageId: string) => void
}

// =====================
// Mermaid diagram renderer
// =====================
let mermaidCounter = 0

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const id = `mermaid-${++mermaidCounter}`

    mermaid
      .render(id, code)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) setSvg(renderedSvg)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <pre className="bg-[var(--status-error-bg)] border border-[var(--status-error-border)] rounded-xl p-4 my-3 text-[13px] text-[var(--status-error-text)] font-mono overflow-x-auto">
        <code>{code}</code>
      </pre>
    )
  }

  if (!svg) {
    return (
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl p-4 my-3 text-[13px] text-[var(--text-tertiary)]">
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// =====================
// Copy button for code blocks
// =====================
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all opacity-0 group-hover:opacity-100"
      title="Copy code"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function MessageCopyButton({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    onCopy?.()
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-0 right-0 p-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all opacity-0 group-hover/message:opacity-100"
      title="Copy message"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

/**
 * Fix inline numbered lists/bullets that LLMs produce on a single line.
 * "1. A 2. B - sub1 - sub2 3. C" → proper multi-line markdown.
 * Skips code fences. Guards against false positives (dashes in words like "re-fetch").
 */
function normalizeMarkdownLists(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let insideCodeFence = false

  for (const line of lines) {
    if (line.trimStart().startsWith('```') || line.trimStart().startsWith('~~~')) {
      insideCodeFence = !insideCodeFence
      result.push(line)
      continue
    }
    if (insideCodeFence) {
      result.push(line)
      continue
    }

    const numberedMatches = line.match(/\d+\.\s/g)
    if (numberedMatches && numberedMatches.length >= 2) {
      const expanded = line
        // "\n" before "N. " when preceded by non-whitespace (not start of line)
        .replace(/(?<=\S)\s+(\d+\.\s)/g, '\n$1')
        // "\n   - " before bullet sub-items; match any non-whitespace before the space-dash
        .replace(/(\S)\s+(- )(?=[A-Z])/g, '$1\n   $2')
      result.push(expanded)
      continue
    }

    const bulletMatches = line.match(/(?:^|\s)- \S/g)
    if (bulletMatches && bulletMatches.length >= 2) {
      const expanded = line.replace(/(\S)\s+(- )(?=[A-Z])/g, '$1\n$2')
      result.push(expanded)
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

// =====================
// Tree structure detection
// =====================
const TREE_CHARS = /[├└│─┌┐┘┤┬┴┼]/
const TREE_PATTERN = /[├└│].*[─┬]/

/** Detect if text contains a directory/file tree structure */
function hasTreeStructure(text: string): boolean {
  const lines = text.split('\n')
  // Need at least 2 lines with tree characters to be a tree
  let treeLines = 0
  for (const line of lines) {
    if (TREE_PATTERN.test(line) || (TREE_CHARS.test(line) && line.trim().length > 2)) {
      treeLines++
      if (treeLines >= 2) return true
    }
  }
  return false
}

/** Render a directory tree in a styled container */
function TreeBlock({ content }: { content: string }) {
  return (
    <div className="relative group my-3">
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] border-b-0 rounded-t-xl">
        <FolderTree size={12} className="text-[var(--accent-primary)]" />
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">Cấu trúc thư mục</span>
      </div>
      <pre className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-b-xl p-4 overflow-x-auto !mt-0 !rounded-t-none">
        <code className="text-[13px] font-mono leading-[1.6] text-[var(--text-primary)]">{content}</code>
      </pre>
      <CopyButton text={content} />
    </div>
  )
}

/** Recursively extract text content from React children */
function extractTextContent(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (!children) return ''
  if (Array.isArray(children)) return children.map(extractTextContent).join('')
  if (typeof children === 'object' && 'props' in (children as any)) {
    return extractTextContent((children as any).props?.children)
  }
  return ''
}

const imageCache = new Map<string, string>()

function CortexImageLoader({ path, alt }: { path: string; alt?: string }) {
  const [base64, setBase64] = useState<string | null>(imageCache.get(path) || null)
  const [loading, setLoading] = useState(!imageCache.has(path))

  useEffect(() => {
    console.log('[ImageLoader] Loading:', path, 'cached:', imageCache.has(path))

    if (imageCache.has(path)) {
      setBase64(imageCache.get(path)!)
      setLoading(false)
      return
    }

    const handler = (...args: unknown[]) => {
      const data = args[1] as { path: string; base64: string } | undefined
      if (data?.path === path && data.base64) {
        console.log('[ImageLoader] Received via event:', path, data.base64.length, 'chars')
        imageCache.set(path, data.base64)
        setBase64(data.base64)
        setLoading(false)
      }
    }
    window.electronAPI?.onGeneratedImage?.(handler)

    if (window.electronAPI?.readFileAsBase64) {
      console.log('[ImageLoader] Calling readFileAsBase64...')
      window.electronAPI.readFileAsBase64(path).then((b64: string) => {
        console.log('[ImageLoader] readFileAsBase64 result:', b64 ? `${b64.length} chars` : 'EMPTY')
        if (b64) {
          imageCache.set(path, b64)
          setBase64(b64)
          setLoading(false)
        } else {
          setLoading(false)
        }
      }).catch((err: unknown) => {
        console.error('[ImageLoader] readFileAsBase64 failed:', err)
        setLoading(false)
      })
    } else {
      console.error('[ImageLoader] readFileAsBase64 NOT available on electronAPI')
      setLoading(false)
    }

    return () => { window.electronAPI?.offGeneratedImage?.(handler) }
  }, [path])

  if (loading) {
    return (
      <div className="my-3 w-80 h-48 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[13px] text-[var(--text-tertiary)]">Generating image...</span>
      </div>
    )
  }

  if (!base64) {
    return (
      <div className="my-3 p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[13px] text-[var(--text-tertiary)]">
        Image saved at: {path}
      </div>
    )
  }

  return <GeneratedImagePreview src={`data:image/png;base64,${base64}`} alt={alt} />
}

function GeneratedImagePreview({ src, alt }: { src: string; alt?: string }) {
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = src
    link.download = `cortex-image-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopy = async () => {
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = src
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <>
      <div className="my-3 relative group/img inline-block max-w-full">
        <img
          src={src}
          alt={alt || 'Generated Image'}
          className="rounded-2xl border border-[var(--border-primary)] max-w-full max-h-[512px] object-contain cursor-pointer hover:brightness-95 transition-all shadow-sm"
          onClick={() => setFullscreen(true)}
        />
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setFullscreen(true) }}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
            title="Xem toàn màn hình"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy() }}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
            title="Copy ảnh"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload() }}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
            title="Tải xuống"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-8 cursor-pointer backdrop-blur-md"
          onClick={() => setFullscreen(false)}
        >
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          <div className="absolute bottom-6 flex gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy() }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-[13px]"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Đã copy' : 'Copy ảnh'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload() }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-[13px]"
            >
              <Download size={14} />
              Tải xuống
            </button>
          </div>
          <img
            src={src}
            alt={alt || 'Generated Image'}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

const markdownComponents = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const lang = match?.[1]
    const codeString = String(children).replace(/\n$/, '')

    // Mermaid diagram
    if (lang === 'mermaid') {
      return <MermaidBlock code={codeString} />
    }

    // Fenced code block (has language class)
    if (lang) {
      // Detect tree structure inside fenced code blocks too
      if (hasTreeStructure(codeString)) {
        return <TreeBlock content={codeString} />
      }
      return (
        <div className="relative group">
          <div className="flex items-center justify-between px-4 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] border-b-0 rounded-t-xl">
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase">{lang}</span>
          </div>
          <pre className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-b-xl p-4 overflow-x-auto !mt-0 !rounded-t-none">
            <code className={cn(className, 'text-[13px] font-mono')} {...props}>
              {children}
            </code>
          </pre>
          <CopyButton text={codeString} />
        </div>
      )
    }

    // Unfenced code block — check if it's a tree structure
    if (codeString.includes('\n') && hasTreeStructure(codeString)) {
      return <TreeBlock content={codeString} />
    }

    // Inline code
    return (
      <code
        className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-[13px] font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre({ children }: { children: ReactNode }) {
    // Let the code component handle all rendering
    return <>{children}</>
  },
  h1({ children }: { children: ReactNode }) {
    return <h1 className="text-[20px] font-bold mt-5 mb-2.5 pb-2 border-b border-[var(--border-primary)]">{children}</h1>
  },
  h2({ children }: { children: ReactNode }) {
    return <h2 className="text-[17px] font-semibold mt-5 mb-2 text-[var(--text-primary)]">{children}</h2>
  },
  h3({ children }: { children: ReactNode }) {
    return <h3 className="text-[15px] font-semibold mt-4 mb-1.5 text-[var(--text-primary)]">{children}</h3>
  },
  h4({ children }: { children: ReactNode }) {
    return <h4 className="text-[14px] font-semibold mt-3 mb-1 text-[var(--text-secondary)]">{children}</h4>
  },
  ul({ children }: { children: ReactNode }) {
    return <ul className="cortex-ul my-2 pl-5 space-y-1">{children}</ul>
  },
  ol({ children, start }: { children: ReactNode; start?: number }) {
    return <ol start={start} className="cortex-ol my-2.5 space-y-2">{children}</ol>
  },
  li({ children }: { children: ReactNode }) {
    return <li className="cortex-li leading-[1.7]">{children}</li>
  },
  strong({ children }: { children: ReactNode }) {
    return <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
  },
  em({ children }: { children: ReactNode }) {
    return <em className="italic text-[var(--text-secondary)]">{children}</em>
  },
  a({ href, children }: { href?: string; children: ReactNode }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent-primary)] hover:underline"
      >
        {children}
      </a>
    )
  },
  table({ children }: { children: ReactNode }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-[13px] border-collapse border border-[var(--border-primary)] rounded-lg">{children}</table>
      </div>
    )
  },
  th({ children }: { children: ReactNode }) {
    return (
      <th className="bg-[var(--bg-secondary)] px-3 py-2 text-left font-semibold border border-[var(--border-primary)]">{children}</th>
    )
  },
  td({ children }: { children: ReactNode }) {
    return (
      <td className="px-3 py-2 border border-[var(--border-primary)]">{children}</td>
    )
  },
  blockquote({ children }: { children: ReactNode }) {
    return (
      <blockquote className="border-l-3 border-[var(--accent-primary)] pl-4 my-3 text-[var(--text-secondary)] italic">{children}</blockquote>
    )
  },
  img({ src, alt }: { src?: string; alt?: string }) {
    if (src?.startsWith('data:image/')) {
      return <GeneratedImagePreview src={src} alt={alt} />
    }
    if (src?.startsWith('cortex-image://')) {
      return <CortexImageLoader path={src.replace('cortex-image://', '')} alt={alt} />
    }
    return (
      <img
        src={src}
        alt={alt || ''}
        className="rounded-xl max-w-full my-2 border border-[var(--border-primary)]"
        loading="lazy"
      />
    )
  },
  hr() {
    return <hr className="my-4 border-[var(--border-primary)]" />
  },
  p({ children }: { children: ReactNode }) {
    // Extract text content to check for tree structures
    const textContent = extractTextContent(children)
    if (textContent && hasTreeStructure(textContent) && textContent.includes('\n')) {
      return <TreeBlock content={textContent} />
    }
    return <p className="mb-2.5 last:mb-0 leading-[1.7]">{children}</p>
  },
}

// =====================
// Main component
// =====================
function FeedbackButtons({ messageId, onFeedback }: { messageId: string; onFeedback: (messageId: string, type: 'thumbs_up' | 'thumbs_down') => void }) {
  const [selected, setSelected] = useState<'thumbs_up' | 'thumbs_down' | null>(null)

  const handleFeedback = (type: 'thumbs_up' | 'thumbs_down') => {
    if (selected === type) return
    setSelected(type)
    onFeedback(messageId, type)
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <button
        onClick={() => handleFeedback('thumbs_up')}
        className={cn(
          'p-1 rounded-md transition-all',
          selected === 'thumbs_up'
            ? 'text-[var(--accent-primary)] bg-[var(--accent-light)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
        )}
        title="Hữu ích"
      >
        <ThumbsUp size={13} />
      </button>
      <button
        onClick={() => handleFeedback('thumbs_down')}
        className={cn(
          'p-1 rounded-md transition-all',
          selected === 'thumbs_down'
            ? 'text-[var(--status-error-text)] bg-[var(--status-error-bg)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
        )}
        title="Không hữu ích"
      >
        <ThumbsDown size={13} />
      </button>
    </div>
  )
}

const EMPTY_STEPS: { step: 'sanitize' | 'rag' | 'external_context' | 'web_search' | 'build_prompt' | 'streaming'; status: 'running' | 'done' | 'skipped' | 'error'; label: string; detail?: string; durationMs?: number }[] = []

function StreamingContent({ conversationId }: { conversationId: string }) {
  const streamRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const lastContentRef = useRef('')

  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      const conv = state.conversations.find((c) => c.id === conversationId)
      const lastMsg = conv?.messages[conv.messages.length - 1]
      const content = lastMsg?.content ?? ''
      if (content === lastContentRef.current) return
      lastContentRef.current = content

      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        if (streamRef.current) {
          let display = content
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
            .replace(/!\[.*?\]\(cortex-image:\/\/[^)]+\)/g, '🎨 Generating image...')
            .replace(/CORTEX_IMAGE_PATH:[^\n]+/g, '')
            .trim()
          streamRef.current.textContent = display || (content.includes('tool_call') ? '🎨 Generating image...' : '')
        }
      })
    })
    return () => {
      unsub()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [conversationId])

  return (
    <div
      ref={streamRef}
      className="text-[15px] leading-[1.7] text-[var(--text-primary)] break-words whitespace-pre-wrap typing-cursor stream-fade-in"
    />
  )
}

function cortexUrlTransform(url: string): string {
  if (url.startsWith('cortex-image://')) return url
  if (url.startsWith('data:image/')) return url
  const colon = url.indexOf(':')
  if (colon === -1) return url
  const protocol = url.slice(0, colon)
  if (/^(https?|ircs?|mailto|xmpp)$/i.test(protocol)) return url
  if (url.indexOf('/') !== -1 && colon > url.indexOf('/')) return url
  return ''
}

const MemoizedMarkdown = ({ content }: { content: string }) => {
  const rendered = useMemo(() => {
    const normalized = normalizeMarkdownLists(content)
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={cortexUrlTransform}
        components={markdownComponents}
      >
        {normalized}
      </ReactMarkdown>
    )
  }, [content])
  return rendered
}

export function MessageBubble({ message, onFeedback, onCopy }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isStreamingEmpty = message.isStreaming && !message.content
  const thinkingSteps = useChatStore((s) => s.thinkingSteps.get(message.conversationId)) ?? EMPTY_STEPS
  const [showMarkdown, setShowMarkdown] = useState(!message.isStreaming && !!message.content)
  const wasStreamingRef = useRef(message.isStreaming)

  useEffect(() => {
    if (wasStreamingRef.current && !message.isStreaming && message.content) {
      const timer = setTimeout(() => setShowMarkdown(true), 50)
      return () => clearTimeout(timer)
    }
    if (!message.isStreaming && message.content) {
      setShowMarkdown(true)
    }
    wasStreamingRef.current = message.isStreaming
  }, [message.isStreaming, message.content])

  return (
    <div className="message-enter">
      <div
        className={cn(
          'flex gap-3 py-5',
          'max-w-[720px] mx-auto'
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
            isUser
              ? 'bg-[var(--bg-sidebar-active)]'
              : 'bg-[var(--accent-light)]',
            !isUser && (isStreamingEmpty || message.isStreaming) && 'avatar-pulse'
          )}
        >
          {isUser ? (
            <User size={15} className="text-[var(--text-secondary)]" />
          ) : (
            <Brain size={15} className="text-[var(--accent-primary)]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 relative group/message">
          <div className="text-[12px] font-medium text-[var(--text-tertiary)] mb-1">
            {isUser ? 'Bạn' : 'Cortex'}
          </div>

          {isStreamingEmpty ? (
            <div className="stream-fade-in">
              {thinkingSteps.length > 0 && <ThinkingProcess steps={thinkingSteps} />}
              {(!thinkingSteps.length || thinkingSteps.every(s => s.status !== 'running')) && <TypingIndicator />}
            </div>
          ) : isUser ? (
            <div>
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {message.attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl max-w-[240px]">
                      {att.isImage && att.base64 ? (
                        <img
                          src={`data:${att.mimeType};base64,${att.base64}`}
                          alt={att.name}
                          className="w-12 h-12 rounded-lg object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => window.open(`data:${att.mimeType};base64,${att.base64}`, '_blank')}
                        />
                      ) : att.mimeType === 'application/pdf' ? (
                        <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                          <FileText size={18} className="text-red-500" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                          <FileText size={18} className="text-[var(--accent-primary)]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{att.name}</p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {att.size < 1024 ? `${att.size}B` : att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)}KB` : `${(att.size / (1024 * 1024)).toFixed(1)}MB`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {message.content && (
                <div className="text-[15px] leading-[1.7] text-[var(--text-primary)] whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              )}
            </div>
          ) : message.isStreaming ? (
            <StreamingContent conversationId={message.conversationId} />
          ) : showMarkdown ? (
            <div className="text-[15px] leading-[1.7] text-[var(--text-primary)] prose-cortex break-words stream-fade-in">
              <MemoizedMarkdown content={message.content} />
            </div>
          ) : (
            <div className="text-[15px] leading-[1.7] text-[var(--text-primary)] break-words whitespace-pre-wrap">
              {message.content}
            </div>
          )}

          {!isUser && message.content && !message.isStreaming && (
            <div className="stream-fade-in">
              <MessageCopyButton text={message.content} onCopy={onCopy ? () => onCopy(message.id) : undefined} />
              {onFeedback && (
                <FeedbackButtons messageId={message.id} onFeedback={onFeedback} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
