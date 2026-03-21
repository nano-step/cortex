import { create } from 'zustand'
import type { Conversation, Message, ResponseMode, ThinkingStep, ChatAttachment } from '../types'

interface StoredThinkingStep {
  step: ThinkingStep['step']
  status: ThinkingStep['status']
  label: string
  detail?: string
  durationMs?: number
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  isLoadingConversations: boolean
  thinkingSteps: Map<string, StoredThinkingStep[]>

  loadConversations: (projectId: string) => Promise<void>
  setActiveConversation: (id: string | null) => void
  getProjectConversations: (projectId: string) => Conversation[]
  createConversation: (projectId: string, mode: ResponseMode, branch?: string) => Promise<string | null>
  addMessage: (conversationId: string, role: Message['role'], content: string, mode: ResponseMode, attachments?: ChatAttachment[]) => Promise<string | null>
  updateLastMessage: (conversationId: string, content: string) => void
  renameConversation: (conversationId: string, newTitle: string) => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  pinConversation: (conversationId: string) => Promise<void>
  setMessageStreaming: (conversationId: string, messageId: string, isStreaming: boolean) => void
  pushThinkingStep: (conversationId: string, step: StoredThinkingStep) => void
  clearThinkingSteps: (conversationId: string) => void
  getThinkingSteps: (conversationId: string) => StoredThinkingStep[]
}

/** Map DB conversation row to frontend Conversation */
function mapDbConversation(row: any, messages: Message[] = []): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    mode: row.mode as ResponseMode,
    branch: row.branch || 'main',
    pinned: row.pinned === 1,
    messages,
    createdAt: row.created_at
  }
}

/** Map DB message row to frontend Message */
function mapDbMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    mode: row.mode as ResponseMode,
    createdAt: row.created_at
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  isLoadingConversations: false,
  thinkingSteps: new Map<string, StoredThinkingStep[]>(),

  loadConversations: async (projectId: string) => {
    if (!window.electronAPI?.getConversationsByProject) return
    set({ isLoadingConversations: true })
    try {
      const convRows = await window.electronAPI.getConversationsByProject(projectId)
      const conversations: Conversation[] = []

      for (const row of convRows) {
        let messages: Message[] = []
        if (window.electronAPI.getMessagesByConversation) {
          const msgRows = await window.electronAPI.getMessagesByConversation(row.id)
          messages = msgRows.map(mapDbMessage).filter((m: Message) => m.content !== '')
        }
        conversations.push(mapDbConversation(row, messages))
      }

      set({ conversations })
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      set({ isLoadingConversations: false })
    }
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  getProjectConversations: (projectId) => {
    return get().conversations.filter((c) => c.projectId === projectId)
  },

  createConversation: async (projectId, mode, branch) => {
    if (!window.electronAPI?.createConversation) return null
    try {
      const row = await window.electronAPI.createConversation(projectId, 'Cuộc trò chuyện mới', mode, branch)
      if (!row) return null

      const conversation = mapDbConversation(row)
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id
      }))
      return conversation.id
    } catch (err) {
      console.error('Failed to create conversation:', err)
      return null
    }
  },

  addMessage: async (conversationId, role, content, mode, attachments?) => {
    let dbMessageId: string | null = null
    if (window.electronAPI?.createMessage) {
      try {
        const result = await window.electronAPI.createMessage(conversationId, role, content, mode)
        if (result?.id) dbMessageId = result.id
      } catch (err) {
        console.error('Failed to persist message:', err)
      }
    }

    const message: Message = {
      id: dbMessageId || crypto.randomUUID?.() || String(Date.now()),
      conversationId,
      role,
      content,
      mode,
      createdAt: Date.now(),
      ...(role === 'assistant' && !content ? { isStreaming: true } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {})
    }
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              title: c.messages.length === 0 && role === 'user'
                ? content.slice(0, 50)
                : c.title
            }
          : c
      )
    }))

    // Update conversation title in DB if first user message
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv && conv.messages.length === 1 && role === 'user' && window.electronAPI?.updateConversationTitle) {
      window.electronAPI.updateConversationTitle(conversationId, content.slice(0, 50)).catch(() => {})
    }

    return dbMessageId
  },

  updateLastMessage: (conversationId, content) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m, i) =>
                i === c.messages.length - 1 ? { ...m, content } : m
              )
            }
          : c
      )
    }))
  },

  renameConversation: async (conversationId, newTitle) => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    if (window.electronAPI?.updateConversationTitle) {
      try {
        await window.electronAPI.updateConversationTitle(conversationId, trimmed)
      } catch (err) {
        console.error('Failed to rename conversation:', err)
        return
      }
    }
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, title: trimmed } : c
      )
    }))
  },

  deleteConversation: async (conversationId) => {
    if (!window.electronAPI?.deleteConversation) return
    try {
      await window.electronAPI.deleteConversation(conversationId)
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId:
          state.activeConversationId === conversationId ? null : state.activeConversationId
      }))
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  },

  pinConversation: async (conversationId) => {
    console.log(`[ChatStore] pinConversation called: ${conversationId}, API available: ${!!window.electronAPI?.pinConversation}`)
    if (!window.electronAPI?.pinConversation) {
      console.warn('[ChatStore] pinConversation API not available — rebuild app')
      return
    }
    try {
      await window.electronAPI.pinConversation(conversationId)
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, pinned: !c.pinned } : c
        )
      }))
      console.log(`[ChatStore] Pin toggled for ${conversationId}`)
    } catch (err) {
      console.error('Failed to pin conversation:', err)
    }
  },

  setMessageStreaming: (conversationId, messageId, isStreaming) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, isStreaming } : m
              )
            }
          : c
      )
    }))
  },

  pushThinkingStep: (conversationId, step) => {
    set((state) => {
      const newMap = new Map(state.thinkingSteps)
      const existing = newMap.get(conversationId) || []
      const idx = existing.findIndex(s => s.step === step.step)
      if (idx >= 0) {
        const updated = [...existing]
        updated[idx] = step
        newMap.set(conversationId, updated)
      } else {
        newMap.set(conversationId, [...existing, step])
      }
      return { thinkingSteps: newMap }
    })
  },

  clearThinkingSteps: (conversationId) => {
    set((state) => {
      const newMap = new Map(state.thinkingSteps)
      newMap.delete(conversationId)
      return { thinkingSteps: newMap }
    })
  },

  getThinkingSteps: (conversationId) => {
    return get().thinkingSteps.get(conversationId) || []
  }
}))
