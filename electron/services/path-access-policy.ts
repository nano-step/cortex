import { resolve, isAbsolute } from 'path'
import { getSetting, setSetting } from './settings-service'

export type FilesystemAccessMode = 'restricted' | 'allowlist' | 'unrestricted'

const PROTECTED_PATHS = [
  '/System', '/etc', '/bin', '/sbin', '/usr/bin', '/usr/sbin',
  '/var', '/Library/LaunchDaemons', '/Library/LaunchAgents',
]

export function getAccessMode(): FilesystemAccessMode {
  if (getSetting('filesystem_unrestricted_mode') === 'true') return 'unrestricted'
  const mode = getSetting('filesystem_access_mode')
  if (mode === 'allowlist' || mode === 'unrestricted') return mode
  return 'restricted'
}

export function setAccessMode(mode: FilesystemAccessMode): void {
  setSetting('filesystem_access_mode', mode)
  setSetting('filesystem_unrestricted_mode', mode === 'unrestricted' ? 'true' : 'false')
}

export function getPathAllowlist(): string[] {
  const raw = getSetting('filesystem_path_allowlist')
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

export function setPathAllowlist(paths: string[]): void {
  setSetting('filesystem_path_allowlist', JSON.stringify(paths))
}

export function addToAllowlist(pathToAdd: string): void {
  const resolved = resolve(pathToAdd)
  const current = getPathAllowlist()
  if (!current.includes(resolved)) {
    current.push(resolved)
    setPathAllowlist(current)
  }
}

export function removeFromAllowlist(pathToRemove: string): void {
  const resolved = resolve(pathToRemove)
  setPathAllowlist(getPathAllowlist().filter((p) => p !== resolved))
}

export function isProtectedPath(absolutePath: string): boolean {
  const resolved = resolve(absolutePath)
  if (resolved.includes('/node_modules/') || resolved.endsWith('/node_modules')) return true
  return PROTECTED_PATHS.some((blocked) => resolved.startsWith(blocked))
}

export function isInAllowlist(absolutePath: string): boolean {
  const resolved = resolve(absolutePath)
  return getPathAllowlist().some((allowed) => {
    const resolvedAllowed = resolve(allowed)
    return resolved.startsWith(resolvedAllowed + '/') || resolved === resolvedAllowed
  })
}

export interface PathCheckResult {
  allowed: boolean
  reason: 'in_repo' | 'in_allowlist' | 'unrestricted' | 'protected' | 'needs_confirmation'
  path: string
}

export function checkAbsolutePathAccess(absolutePath: string, repoPaths: string[]): PathCheckResult {
  const resolved = resolve(absolutePath)

  for (const repoRoot of repoPaths) {
    const resolvedRepo = resolve(repoRoot)
    if (resolved.startsWith(resolvedRepo + '/') || resolved === resolvedRepo) {
      return { allowed: true, reason: 'in_repo', path: resolved }
    }
  }

  if (isProtectedPath(resolved)) {
    return { allowed: false, reason: 'protected', path: resolved }
  }

  const mode = getAccessMode()

  if (mode === 'unrestricted') {
    return { allowed: true, reason: 'unrestricted', path: resolved }
  }

  if (mode === 'allowlist' && isInAllowlist(resolved)) {
    return { allowed: true, reason: 'in_allowlist', path: resolved }
  }

  return { allowed: false, reason: 'needs_confirmation', path: resolved }
}
