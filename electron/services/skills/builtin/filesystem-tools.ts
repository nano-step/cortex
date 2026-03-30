/**
 * Built-in Filesystem Tools for Cortex AI Chat
 *
 * Provides 4 tools that allow the AI to interact with project source code:
 * - cortex_read_file: Read file content
 * - cortex_write_file: Write/create files
 * - cortex_edit_file: Search & replace in files
 * - cortex_list_directory: List directory contents
 *
 * All paths are sandboxed to project repository directories for security.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, renameSync, unlinkSync, rmdirSync } from 'fs'
import { readFile as readFileAsync } from 'fs/promises'
import { resolve, join, dirname, relative, extname, isAbsolute } from 'path'
import { homedir } from 'os'
import type { MCPToolDefinition } from '../mcp/mcp-manager'
import { getDb, repoQueries } from '../../db'
import { convertDocument, isDocumentFile } from '../../document-converter'
import { checkAbsolutePathAccess, getAccessMode, isProtectedPath } from '../../path-access-policy'

// =====================
// Tool Definitions
// =====================

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_read_file',
      description: 'Read the contents of a file. Supports offset+limit for chunk reading of large files (up to 10MB). Accepts relative paths (resolved to repo root) or absolute paths including ~/. Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path: relative to repo root (e.g., "src/index.ts") or absolute (e.g., "~/Documents/notes.md", "/tmp/output.txt")'
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed). Use with limit to read large files in chunks.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read. Use with offset for chunk reading.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_write_file',
      description: 'Write content to a file at the given path. Creates parent directories if they do not exist. Accepts relative paths (resolved to repo root) or absolute paths including ~/. Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path: relative to repo root (e.g., "src/new-file.ts") or absolute (e.g., "~/Documents/notes.md", "/Users/me/output.txt")'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_edit_file',
      description: 'Edit a file by replacing all occurrences of old_string with new_string. Returns the number of replacements made. Accepts relative or absolute paths (including ~/). Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path: relative to repo root or absolute (e.g., "~/Documents/file.md")'
          },
          old_string: {
            type: 'string',
            description: 'The exact text to find in the file'
          },
          new_string: {
            type: 'string',
            description: 'The text to replace old_string with'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_list_directory',
      description: 'List the contents of a directory. Supports recursive traversal with depth control and extension filtering. Accepts relative or absolute paths (including ~/). Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path: relative to repo root (e.g., "src") or absolute (e.g., "~/Documents"). Defaults to repo root.'
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to list files recursively in all subdirectories. Defaults to false.'
          },
          depth: {
            type: 'number',
            description: 'Maximum depth for recursive listing (1-10). Only used when recursive is true. Defaults to 3.'
          },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter files by extension (e.g., [".ts", ".tsx"]). Leave empty to include all files.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_read_files',
      description: 'Read multiple files in a single call. More efficient than calling cortex_read_file repeatedly. Supports offset and limit for large files. Returns a map of path to content. Accepts relative or absolute paths (including ~/).',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths (relative to repo root or absolute). Maximum 10 files per call.'
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed). Use with limit to read large files in chunks.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read per file. Use with offset for chunk reading.'
          }
        },
        required: ['paths']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_grep_search',
      description: 'Search for a text pattern across multiple files. Returns matching lines with file paths and line numbers. Supports regex patterns. Accepts relative or absolute directory paths (including ~/).',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regex pattern to search for (e.g., "useState", "async function \\w+", "TODO:")'
          },
          directory: {
            type: 'string',
            description: 'Directory to search in: relative to repo root or absolute (e.g., "~/projects"). Defaults to repo root.'
          },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Limit search to specific file extensions (e.g., [".ts", ".tsx"]). Leave empty to search all text files.'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of matches to return. Defaults to 50, maximum 200.'
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive. Defaults to false.'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_edit_files',
      description: 'Apply multiple search-and-replace edits across multiple files in a single call. More efficient than calling cortex_edit_file repeatedly. All edits are applied atomically per file. Accepts relative or absolute paths (including ~/).',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: 'Array of edit operations to apply.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path: relative to repo root or absolute (including ~/).' },
                old_string: { type: 'string', description: 'Exact text to find.' },
                new_string: { type: 'string', description: 'Text to replace with.' }
              },
              required: ['path', 'old_string', 'new_string']
            }
          }
        },
        required: ['edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_move_file',
      description: 'Move or rename a file or directory. Accepts relative or absolute paths (including ~/). Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source path: relative to repo root or absolute (including ~/).'
          },
          destination: {
            type: 'string',
            description: 'Destination path: relative to repo root or absolute (including ~/).'
          }
        },
        required: ['source', 'destination']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_delete_file',
      description: 'Delete a file or empty directory. Use with caution — this is irreversible unless the project uses git. Accepts relative or absolute paths (including ~/). Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to delete: relative to repo root or absolute (including ~/).'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_read_document',
      description: 'Read and convert a document file (PDF, DOCX, XLSX, CSV, HTML) to readable markdown text. Use this instead of cortex_read_file for non-code documents. Returns extracted text with metadata. Accepts relative or absolute paths (including ~/).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to document: relative to repo root or absolute (e.g., "~/Documents/report.pdf"). Supports: .pdf, .docx, .xlsx, .xls, .csv, .html, .htm'
          }
        },
        required: ['path']
      }
    }
  }
]

// =====================
// Path Security
// =====================

const MAX_READ_SIZE = 10 * 1024 * 1024
const MAX_BATCH_FILES = 10
const MAX_GREP_RESULTS = 200
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.mp4', '.mp3', '.wav', '.zip', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.ttf', '.woff', '.woff2', '.eot'
])

const PROTECTED_PATHS = [
  '/System', '/etc', '/bin', '/sbin', '/usr/bin', '/usr/sbin',
  '/var', '/Library/LaunchDaemons', '/Library/LaunchAgents'
]

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return join(homedir(), p.slice(1))
  }
  return p
}

function resolveSafePath(repoPaths: string[], relativePath: string): string {
  if (!relativePath || relativePath.trim() === '') {
    throw new Error('Path cannot be empty')
  }

  const normalized = expandTilde(relativePath.replace(/\\/g, '/'))

  if (isAbsolute(normalized)) {
    const resolved = resolve(normalized)

    if (isProtectedPath(resolved)) {
      throw new Error(`Blocked: "${relativePath}" is in a protected system directory`)
    }

    const check = checkAbsolutePathAccess(resolved, repoPaths)
    if (check.allowed) return resolved

    if (check.reason === 'protected') {
      throw new Error(`Blocked: "${relativePath}" is in a protected system directory`)
    }

    const err = new Error(
      `PATH_NEEDS_CONFIRMATION:${resolved}` +
      `|Path "${relativePath}" requires permission. Add to allowlist in Settings > Filesystem Access, or approve one-time access.`
    )
    err.name = 'PathConfirmationError'
    throw err
  }

  const mode = getAccessMode()
  if (mode === 'unrestricted' && repoPaths.length > 0) {
    return resolve(repoPaths[0], normalized)
  }

  for (const repoRoot of repoPaths) {
    const resolved = resolve(repoRoot, normalized)
    const repoRootResolved = resolve(repoRoot)
    if (resolved.startsWith(repoRootResolved + '/') || resolved === repoRootResolved) {
      return resolved
    }
  }

  throw new Error(
    `Path "${relativePath}" is outside all project repositories. ` +
    `Allowed roots: ${repoPaths.join(', ')}. Add folders to allowlist in Settings > Filesystem Access.`
  )
}

/**
 * Get absolute paths for all repos in a project.
 */
function getRepoPaths(projectId: string): string[] {
  const db = getDb()
  const repos = repoQueries.getByProject(db).all(projectId) as Array<{
    id: string
    source_path: string
    source_type: string
  }>
  const paths = repos
    .map(r => r.source_path)
    .filter(p => p && existsSync(p))

  if (paths.length === 0) {
    throw new Error('No accessible repositories found for this project')
  }

  return paths
}

// =====================
// Tool Implementations
// =====================

async function toolReadFile(
  repoPaths: string[],
  args: { path: string; offset?: number; limit?: number }
): Promise<{ content: string; isError: boolean }> {
  try {
    const absPath = resolveSafePath(repoPaths, args.path)

    if (!existsSync(absPath)) {
      return { content: `File not found: ${args.path}`, isError: true }
    }

    const stat = statSync(absPath)
    if (stat.isDirectory()) {
      return { content: `"${args.path}" is a directory, not a file. Use cortex_list_directory instead.`, isError: true }
    }

    if (stat.size > MAX_READ_SIZE) {
      return {
        content: `File too large (${(stat.size / 1024 / 1024).toFixed(2)}MB, max ${MAX_READ_SIZE / 1024 / 1024}MB). Use offset+limit to read in chunks.`,
        isError: true
      }
    }

    const raw = await readFileAsync(absPath, 'utf-8')

    if (raw.slice(0, 8192).includes('\0')) {
      return { content: `"${args.path}" appears to be a binary file.`, isError: true }
    }

    const lines = raw.split('\n')
    const totalLines = lines.length

    if (args.offset !== undefined || args.limit !== undefined) {
      const start = Math.max(0, (args.offset ?? 1) - 1)
      const end = args.limit !== undefined ? Math.min(start + args.limit, totalLines) : totalLines
      const slice = lines.slice(start, end)
      const header = `[Lines ${start + 1}-${end} of ${totalLines} total — ${args.path}]\n`
      console.log(`[FilesystemTools] Read file chunk: ${args.path} lines ${start + 1}-${end}/${totalLines}`)
      return { content: header + slice.join('\n'), isError: false }
    }

    console.log(`[FilesystemTools] Read file: ${args.path} (${raw.length} chars, ${totalLines} lines)`)
    return { content: raw, isError: false }
  } catch (err) {
    return { content: `Error reading file: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function toolWriteFile(repoPaths: string[], args: { path: string; content: string }): { content: string; isError: boolean } {
  try {
    const absPath = resolveSafePath(repoPaths, args.path)

    // Auto-create parent directories
    const dir = dirname(absPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(absPath, args.content, 'utf-8')

    // Find which repo root this belongs to for nice output
    let relDisplay = args.path
    for (const root of repoPaths) {
      const resolved = resolve(root)
      if (absPath.startsWith(resolved)) {
        relDisplay = relative(resolved, absPath)
        break
      }
    }

    console.log(`[FilesystemTools] Wrote file: ${relDisplay} (${args.content.length} chars)`)
    return { content: `Successfully wrote ${args.content.length} characters to ${relDisplay}`, isError: false }
  } catch (err) {
    return { content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

function tryFuzzyMatch(original: string, oldString: string): { matched: string; strategy: string } | null {
  const trimmedOld = oldString.split('\n').map(l => l.trim()).join('\n')
  const trimmedOriginal = original.split('\n').map(l => l.trim()).join('\n')
  if (trimmedOriginal.includes(trimmedOld)) {
    const origLines = original.split('\n')
    const oldLines = oldString.split('\n').map(l => l.trim())
    for (let i = 0; i <= origLines.length - oldLines.length; i++) {
      const window = origLines.slice(i, i + oldLines.length)
      if (window.every((line, j) => line.trim() === oldLines[j])) {
        return { matched: window.join('\n'), strategy: 'whitespace-normalized' }
      }
    }
  }

  const normalizedOld = oldString.replace(/\s+/g, ' ').trim()
  const normalizedOriginal = original.replace(/\s+/g, ' ').trim()
  if (normalizedOriginal.includes(normalizedOld)) {
    const startIdx = normalizedOriginal.indexOf(normalizedOld)
    let charCount = 0
    let realStart = 0
    const collapsed = original.replace(/\s+/g, ' ').trim()
    for (let i = 0; i < original.length && charCount < startIdx; i++) {
      if (original[i] === collapsed[charCount]) charCount++
      if (charCount === startIdx) { realStart = i + 1; break }
    }
    if (realStart > 0) {
      return null
    }
  }

  return null
}

function toolEditFile(repoPaths: string[], args: { path: string; old_string: string; new_string: string }): { content: string; isError: boolean } {
  try {
    const absPath = resolveSafePath(repoPaths, args.path)

    if (!existsSync(absPath)) {
      return { content: `File not found: ${args.path}`, isError: true }
    }

    const stat = statSync(absPath)
    if (stat.isDirectory()) {
      return { content: `"${args.path}" is a directory, not a file.`, isError: true }
    }

    const original = readFileSync(absPath, 'utf-8')

    if (original.includes(args.old_string)) {
      const count = countOccurrences(original, args.old_string)
      const updated = original.split(args.old_string).join(args.new_string)
      writeFileSync(absPath, updated, 'utf-8')
      console.log(`[FilesystemTools] Edited file: ${args.path} (${count} replacement${count > 1 ? 's' : ''})`)
      return { content: `Successfully replaced ${count} occurrence${count > 1 ? 's' : ''} in ${args.path}`, isError: false }
    }

    const fuzzy = tryFuzzyMatch(original, args.old_string)
    if (fuzzy) {
      const count = countOccurrences(original, fuzzy.matched)
      const updated = original.split(fuzzy.matched).join(args.new_string)
      writeFileSync(absPath, updated, 'utf-8')
      console.log(`[FilesystemTools] Edited file (${fuzzy.strategy}): ${args.path} (${count} replacement${count > 1 ? 's' : ''})`)
      return {
        content: `Successfully replaced ${count} occurrence${count > 1 ? 's' : ''} in ${args.path} (matched via ${fuzzy.strategy})`,
        isError: false
      }
    }

    const oldLines = args.old_string.split('\n')
    const firstLine = oldLines[0].trim()
    const lastLine = oldLines[oldLines.length - 1].trim()
    const origLines = original.split('\n')
    const hints: string[] = []
    for (let i = 0; i < origLines.length; i++) {
      if (origLines[i].trim().includes(firstLine.slice(0, 40))) {
        hints.push(`  Line ${i + 1}: ${origLines[i].trim().slice(0, 80)}`)
        if (hints.length >= 3) break
      }
    }

    const hintText = hints.length > 0
      ? `\n\nPossible matches found near:\n${hints.join('\n')}\n\nTip: Use cortex_read_file with offset+limit to see exact content around these lines, then retry with the exact text.`
      : `\n\nThe first line of your search ("${firstLine.slice(0, 60)}") was not found anywhere in the file.`

    return {
      content: `old_string not found in "${args.path}". Tried: exact match → whitespace-normalized match → both failed.${hintText}`,
      isError: true
    }
  } catch (err) {
    return { content: `Error editing file: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function collectDirEntries(
  absDir: string,
  repoRoot: string,
  prefix: string,
  currentDepth: number,
  maxDepth: number,
  exts: Set<string> | null,
  results: string[]
): void {
  if (currentDepth > maxDepth) return
  let items: import('fs').Dirent[]
  try {
    items = readdirSync(absDir, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[]
  } catch {
    return
  }

  const sorted = [...items]
    .filter(i => !String(i.name).startsWith('.') || i.name === '.env.example')
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return String(a.name).localeCompare(String(b.name))
    })

  for (const item of sorted) {
    const name = String(item.name)
    const indent = '  '.repeat(currentDepth)
    if (item.isDirectory()) {
      results.push(`${indent}${name}/`)
      if (currentDepth < maxDepth) {
        collectDirEntries(
          resolve(absDir, name),
          repoRoot,
          prefix,
          currentDepth + 1,
          maxDepth,
          exts,
          results
        )
      }
    } else {
      if (exts && !exts.has(extname(name).toLowerCase())) continue
      results.push(`${indent}${name}`)
    }
  }
}

function toolListDirectory(
  repoPaths: string[],
  args: { path?: string; recursive?: boolean; depth?: number; extensions?: string[] }
): { content: string; isError: boolean } {
  try {
    const targetPath = args.path || '.'
    const recursive = args.recursive ?? false
    const maxDepth = recursive ? Math.min(Math.max(1, args.depth ?? 3), 10) : 1
    const exts = args.extensions && args.extensions.length > 0
      ? new Set(args.extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
      : null

    if (targetPath === '.' || targetPath === '') {
      const entries: string[] = []
      for (const repoRoot of repoPaths) {
        const repoName = repoRoot.split('/').pop() || repoRoot
        entries.push(`=== ${repoName} (${repoRoot}) ===`)
        collectDirEntries(repoRoot, repoRoot, '', 0, maxDepth, exts, entries)
      }
      console.log(`[FilesystemTools] Listed all repos (recursive=${recursive}, depth=${maxDepth})`)
      return { content: entries.join('\n'), isError: false }
    }

    const absPath = resolveSafePath(repoPaths, targetPath)

    if (!existsSync(absPath)) {
      return { content: `Directory not found: ${targetPath}`, isError: true }
    }

    const stat = statSync(absPath)
    if (!stat.isDirectory()) {
      return { content: `"${targetPath}" is a file, not a directory.`, isError: true }
    }

    const lines: string[] = []
    collectDirEntries(absPath, absPath, '', 0, maxDepth, exts, lines)

    console.log(`[FilesystemTools] Listed: ${targetPath} (${lines.length} entries, recursive=${recursive})`)
    return { content: lines.join('\n') || '(empty directory)', isError: false }
  } catch (err) {
    return { content: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

async function toolReadFiles(
  repoPaths: string[],
  args: { paths: string[]; offset?: number; limit?: number }
): Promise<{ content: string; isError: boolean }> {
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    return { content: 'paths array is required and must not be empty', isError: true }
  }
  if (args.paths.length > MAX_BATCH_FILES) {
    return { content: `Too many files requested (${args.paths.length}). Maximum: ${MAX_BATCH_FILES} per call.`, isError: true }
  }

  const readResults = await Promise.all(
    args.paths.map(async (filePath) => {
      const result = await toolReadFile(repoPaths, { path: filePath, offset: args.offset, limit: args.limit })
      return { filePath, result }
    })
  )

  const outputs: string[] = []
  let hasError = false

  for (const { filePath, result } of readResults) {
    if (result.isError) {
      outputs.push(`=== ${filePath} [ERROR] ===\n${result.content}`)
      hasError = true
    } else {
      outputs.push(`=== ${filePath} ===\n${result.content}`)
    }
  }

  console.log(`[FilesystemTools] Batch read ${args.paths.length} files in parallel`)
  return { content: outputs.join('\n\n'), isError: hasError }
}

function toolGrepSearch(
  repoPaths: string[],
  args: { pattern: string; directory?: string; extensions?: string[]; max_results?: number; case_sensitive?: boolean }
): { content: string; isError: boolean } {
  try {
    const maxResults = Math.min(args.max_results ?? 50, MAX_GREP_RESULTS)
    const caseSensitive = args.case_sensitive ?? false
    const exts = args.extensions && args.extensions.length > 0
      ? new Set(args.extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
      : null

    let regex: RegExp
    try {
      regex = new RegExp(args.pattern, caseSensitive ? 'g' : 'gi')
    } catch {
      return { content: `Invalid regex pattern: ${args.pattern}`, isError: true }
    }

    const searchRoots = args.directory
      ? [resolveSafePath(repoPaths, args.directory)]
      : repoPaths

    const matches: string[] = []
    let totalScanned = 0

    function searchDir(dirPath: string): void {
      if (matches.length >= maxResults) return
      let items: import('fs').Dirent[]
      try {
        items = readdirSync(dirPath, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[]
      } catch {
        return
      }

      for (const item of items) {
        if (matches.length >= maxResults) return
        const name = String(item.name)
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === '.git') continue

        const absItem = resolve(dirPath, name)
        if (item.isDirectory()) {
          searchDir(absItem)
        } else if (item.isFile()) {
          const ext = extname(name).toLowerCase()
          if (BINARY_EXTENSIONS.has(ext)) continue
          if (exts && !exts.has(ext)) continue

          let content: string
          try {
            const stat = statSync(absItem)
            if (stat.size > MAX_READ_SIZE) return
            content = readFileSync(absItem, 'utf-8')
            if (content.slice(0, 8192).includes('\0')) return
          } catch {
            return
          }

          totalScanned++
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break
            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              const relPath = (() => {
                for (const root of repoPaths) {
                  if (absItem.startsWith(resolve(root))) return relative(resolve(root), absItem)
                }
                return absItem
              })()
              matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`)
            }
          }
        }
      }
    }

    for (const root of searchRoots) {
      if (!existsSync(root)) continue
      searchDir(root)
    }

    const header = `Found ${matches.length} match${matches.length !== 1 ? 'es' : ''} in ${totalScanned} files scanned (pattern: "${args.pattern}"):`
    console.log(`[FilesystemTools] Grep: "${args.pattern}" → ${matches.length} matches in ${totalScanned} files`)
    return {
      content: matches.length > 0 ? `${header}\n\n${matches.join('\n')}` : `${header}\n\n(no matches)`,
      isError: false
    }
  } catch (err) {
    return { content: `Error during grep: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function toolEditFiles(
  repoPaths: string[],
  args: { edits: Array<{ path: string; old_string: string; new_string: string }> }
): { content: string; isError: boolean } {
  if (!Array.isArray(args.edits) || args.edits.length === 0) {
    return { content: 'edits array is required and must not be empty', isError: true }
  }

  const results: string[] = []
  let hasError = false

  for (const edit of args.edits) {
    const result = toolEditFile(repoPaths, edit)
    if (result.isError) {
      results.push(`[FAILED] ${edit.path}: ${result.content}`)
      hasError = true
    } else {
      results.push(`[OK] ${result.content}`)
    }
  }

  const succeeded = results.filter(r => r.startsWith('[OK]')).length
  const summary = `${succeeded}/${args.edits.length} edits applied successfully.`
  return { content: `${summary}\n\n${results.join('\n')}`, isError: hasError }
}

function toolMoveFile(
  repoPaths: string[],
  args: { source: string; destination: string }
): { content: string; isError: boolean } {
  try {
    const srcAbs = resolveSafePath(repoPaths, args.source)
    const dstAbs = resolveSafePath(repoPaths, args.destination)

    if (!existsSync(srcAbs)) {
      return { content: `Source not found: ${args.source}`, isError: true }
    }
    if (existsSync(dstAbs)) {
      return { content: `Destination already exists: ${args.destination}. Delete it first if you want to overwrite.`, isError: true }
    }

    const dstDir = dirname(dstAbs)
    if (!existsSync(dstDir)) {
      mkdirSync(dstDir, { recursive: true })
    }

    renameSync(srcAbs, dstAbs)
    console.log(`[FilesystemTools] Moved: ${args.source} → ${args.destination}`)
    return { content: `Successfully moved ${args.source} → ${args.destination}`, isError: false }
  } catch (err) {
    return { content: `Error moving file: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function toolDeleteFile(
  repoPaths: string[],
  args: { path: string }
): { content: string; isError: boolean } {
  try {
    const absPath = resolveSafePath(repoPaths, args.path)

    if (!existsSync(absPath)) {
      return { content: `Not found: ${args.path}`, isError: true }
    }

    const stat = statSync(absPath)
    if (stat.isDirectory()) {
      rmdirSync(absPath)
      console.log(`[FilesystemTools] Deleted directory: ${args.path}`)
      return { content: `Successfully deleted directory: ${args.path}`, isError: false }
    }

    unlinkSync(absPath)
    console.log(`[FilesystemTools] Deleted file: ${args.path}`)
    return { content: `Successfully deleted: ${args.path}`, isError: false }
  } catch (err) {
    return { content: `Error deleting: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

async function toolReadDocument(
  repoPaths: string[],
  args: { path: string }
): Promise<{ content: string; isError: boolean }> {
  try {
    const absPath = resolveSafePath(repoPaths, args.path)

    if (!existsSync(absPath)) {
      return { content: `File not found: ${args.path}`, isError: true }
    }

    if (!isDocumentFile(absPath)) {
      return {
        content: `"${args.path}" is not a supported document format. Supported: .pdf, .docx, .xlsx, .xls, .csv, .html, .htm. Use cortex_read_file for text/code files.`,
        isError: true
      }
    }

    const result = await convertDocument(absPath)
    if (!result) {
      return { content: `No converter available for "${args.path}".`, isError: true }
    }

    const metaLines: string[] = []
    for (const [k, v] of Object.entries(result.metadata)) {
      if (v !== undefined) metaLines.push(`${k}: ${v}`)
    }

    const header = metaLines.length > 0
      ? `[Document: ${args.path}]\n${metaLines.join(' | ')}\n\n`
      : `[Document: ${args.path}]\n\n`

    console.log(`[FilesystemTools] Read document: ${args.path} (${result.markdown.length} chars)`)
    return { content: header + result.markdown, isError: false }
  } catch (err) {
    return { content: `Error reading document: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

// =====================
// Public API
// =====================

/**
 * Returns OpenAI-compatible tool definitions for all built-in filesystem tools.
 * These are injected alongside MCP tools in the chat handler.
 */
export function getBuiltinToolDefinitions(_projectId: string): MCPToolDefinition[] {
  // Tool definitions are static — projectId is accepted for future per-project tool filtering
  return TOOL_DEFINITIONS
}

/**
 * Execute a built-in filesystem tool by name.
 * Routes to the appropriate tool implementation and enforces path security.
 *
 * @param toolName — Tool name (e.g., 'cortex_read_file')
 * @param argsJson — Raw JSON string from LLM tool_calls
 * @param projectId — Project ID for repo path resolution
 * @returns Object with content string and isError flag
 */
export async function executeBuiltinTool(
  toolName: string,
  argsJson: string,
  projectId: string
): Promise<{ content: string; isError: boolean }> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: `Error parsing tool arguments: invalid JSON`, isError: true }
  }

  let repoPaths: string[]
  try {
    repoPaths = getRepoPaths(projectId)
  } catch (err) {
    return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }

  switch (toolName) {
    case 'cortex_read_file':
      return toolReadFile(repoPaths, args as { path: string; offset?: number; limit?: number })

    case 'cortex_write_file':
      return toolWriteFile(repoPaths, args as { path: string; content: string })

    case 'cortex_edit_file':
      return toolEditFile(repoPaths, args as { path: string; old_string: string; new_string: string })

    case 'cortex_list_directory':
      return toolListDirectory(repoPaths, args as { path?: string; recursive?: boolean; depth?: number; extensions?: string[] })

    case 'cortex_read_files':
      return toolReadFiles(repoPaths, args as { paths: string[]; offset?: number; limit?: number })

    case 'cortex_grep_search':
      return toolGrepSearch(repoPaths, args as { pattern: string; directory?: string; extensions?: string[]; max_results?: number; case_sensitive?: boolean })

    case 'cortex_edit_files':
      return toolEditFiles(repoPaths, args as { edits: Array<{ path: string; old_string: string; new_string: string }> })

    case 'cortex_move_file':
      return toolMoveFile(repoPaths, args as { source: string; destination: string })

    case 'cortex_delete_file':
      return toolDeleteFile(repoPaths, args as { path: string })

    case 'cortex_read_document':
      return toolReadDocument(repoPaths, args as { path: string })

    default:
      return { content: `Unknown builtin tool: ${toolName}`, isError: true }
  }
}
