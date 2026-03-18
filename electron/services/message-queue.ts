/**
 * Message Queue — Serializes chat requests to prevent race conditions
 *
 * Like OpenCode's approach: when user sends multiple messages rapidly,
 * they're queued and processed one at a time per conversation.
 * Different conversations can process in parallel.
 */

type QueuedMessage = {
  id: string
  conversationId: string
  execute: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  enqueuedAt: number
  status: 'queued' | 'processing' | 'done' | 'failed'
}

const conversationQueues = new Map<string, QueuedMessage[]>()
const processing = new Map<string, boolean>()
const QUEUE_TIMEOUT = 300_000

let queueCounter = 0

function generateQueueId(): string {
  return `msg_${++queueCounter}_${Date.now()}`
}

async function processNext(conversationId: string): Promise<void> {
  const queue = conversationQueues.get(conversationId)
  if (!queue || queue.length === 0) {
    processing.set(conversationId, false)
    return
  }

  if (processing.get(conversationId)) return

  processing.set(conversationId, true)
  const msg = queue[0]
  msg.status = 'processing'

  try {
    const result = await msg.execute()
    msg.status = 'done'
    msg.resolve(result)
  } catch (err) {
    msg.status = 'failed'
    msg.reject(err)
  } finally {
    queue.shift()
    processing.set(conversationId, false)
    if (queue.length > 0) {
      processNext(conversationId)
    } else {
      conversationQueues.delete(conversationId)
    }
  }
}

export function enqueueMessage<T>(
  conversationId: string,
  execute: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!conversationQueues.has(conversationId)) {
      conversationQueues.set(conversationId, [])
    }

    const queue = conversationQueues.get(conversationId)!
    const msg: QueuedMessage = {
      id: generateQueueId(),
      conversationId,
      execute: execute as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      enqueuedAt: Date.now(),
      status: 'queued'
    }

    queue.push(msg)
    console.log(`[MessageQueue] Enqueued ${msg.id} for conversation ${conversationId} (position: ${queue.length})`)

    // Timeout guard
    setTimeout(() => {
      if (msg.status === 'queued') {
        const idx = queue.indexOf(msg)
        if (idx !== -1) queue.splice(idx, 1)
        msg.status = 'failed'
        reject(new Error(`Message queue timeout after ${QUEUE_TIMEOUT}ms`))
      }
    }, QUEUE_TIMEOUT)

    if (!processing.get(conversationId)) {
      processNext(conversationId)
    }
  })
}

export function getQueueStatus(): Array<{
  conversationId: string
  queueLength: number
  isProcessing: boolean
}> {
  const result: Array<{ conversationId: string; queueLength: number; isProcessing: boolean }> = []
  for (const [convId, queue] of conversationQueues) {
    result.push({
      conversationId: convId,
      queueLength: queue.length,
      isProcessing: processing.get(convId) || false
    })
  }
  return result
}

export function getQueueLength(conversationId: string): number {
  return conversationQueues.get(conversationId)?.length ?? 0
}

export function clearQueue(conversationId: string): number {
  const queue = conversationQueues.get(conversationId)
  if (!queue) return 0
  const cleared = queue.length
  for (const msg of queue) {
    if (msg.status === 'queued') {
      msg.reject(new Error('Queue cleared'))
    }
  }
  conversationQueues.delete(conversationId)
  processing.delete(conversationId)
  return cleared
}
