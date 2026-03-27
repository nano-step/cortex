export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

type Validator<T> = (input: unknown) => ValidationResult<T>

function str(name: string, minLen = 0, maxLen = 100_000): Validator<string> {
  return (v) => {
    if (typeof v !== 'string') return { ok: false, error: `${name} must be a string` }
    if (v.length < minLen) return { ok: false, error: `${name} too short (min ${minLen})` }
    if (v.length > maxLen) return { ok: false, error: `${name} too long (max ${maxLen})` }
    return { ok: true, data: v }
  }
}

function uuid(name: string): Validator<string> {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return (v) => {
    if (typeof v !== 'string' || !re.test(v)) return { ok: false, error: `${name} must be a valid UUID` }
    return { ok: true, data: v }
  }
}

function num(name: string, min?: number, max?: number): Validator<number> {
  return (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${name} must be a number` }
    if (min !== undefined && v < min) return { ok: false, error: `${name} must be >= ${min}` }
    if (max !== undefined && v > max) return { ok: false, error: `${name} must be <= ${max}` }
    return { ok: true, data: v }
  }
}

function bool(name: string): Validator<boolean> {
  return (v) => {
    if (typeof v !== 'boolean') return { ok: false, error: `${name} must be a boolean` }
    return { ok: true, data: v }
  }
}

function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return (v) => {
    if (v === undefined || v === null) return { ok: true, data: undefined }
    return validator(v) as ValidationResult<T | undefined>
  }
}

export const V = { str, uuid, num, bool, optional }

type ChatSendPayload = {
  projectId: string; conversationId: string; query: string;
  mode: string; history: unknown[]; attachments?: unknown[]; agentMode?: string
}

export function validateChatSend(args: unknown[]): ValidationResult<ChatSendPayload> {
  const [projectId, conversationId, query, mode, history, , agentMode] = args

  const pv = uuid('projectId')(projectId)
  if (!pv.ok) return pv as { ok: false; error: string }

  const cv = uuid('conversationId')(conversationId)
  if (!cv.ok) return cv as { ok: false; error: string }

  const qv = str('query', 1, 50_000)(query)
  if (!qv.ok) return qv as { ok: false; error: string }

  if (typeof mode !== 'string') return { ok: false, error: 'mode must be a string' }
  if (!Array.isArray(history)) return { ok: false, error: 'history must be an array' }

  const agentModeV = optional(str('agentMode', 1, 100))(agentMode)
  if (!agentModeV.ok) return agentModeV as { ok: false; error: string }

  return { ok: true, data: { projectId: pv.data, conversationId: cv.data, query: qv.data, mode, history, agentMode: agentModeV.data } }
}

export function ipcValidate<T>(
  validatorFn: (args: unknown[]) => ValidationResult<T>,
  args: unknown[]
): ValidationResult<T> {
  const result = validatorFn(args)
  if (!result.ok) {
    const err = result as { ok: false; error: string }
    console.warn(`[IPC Validation] ${err.error}`)
  }
  return result
}
