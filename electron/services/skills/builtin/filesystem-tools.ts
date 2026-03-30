/**
 * Built-in Filesystem Tools for Cortex AI Chat
 *
 * Provides 11 tools that allow the AI to interact with project source code:
 * - cortex_read_file: Read file content
 * - cortex_read_files: Batch read multiple files
 * - cortex_write_file: Write/create files
 * - cortex_edit_file: Search & replace in files (with fuzzy matching fallback)
 * - cortex_edit_file_lines: Edit by line range
 * - cortex_edit_files: Batch search & replace across files
 * - cortex_list_directory: List directory contents
 * - cortex_grep_search: Regex search across project
 * - cortex_move_file: Move/rename files
 * - cortex_delete_file: Delete files
 * - cortex_read_document: Read PDF/DOCX/XLSX/CSV documents
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
      name: 'cortex_edit_file_lines',
      description: 'Edit a file by replacing a range of lines (1-indexed, inclusive) with new content. Use cortex_read_file with offset+limit to verify exact line numbers first. Accepts relative or absolute paths (including ~/). Absolute paths outside repo may require user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path: relative to repo root or absolute (e.g., "~/Documents/file.md")'
          },
          start_line: {
            type: 'number',
            description: 'First line to replace (1-indexed, inclusive)'
          },
          end_line: {
            type: 'number',
            description: 'Last line to replace (1-indexed, inclusive). Use same as start_line to replace a single line.'
          },
          new_content: {
            type: 'string',
            description: 'The new content to insert in place of the specified line range. Can be empty string to delete lines.'
          }
        },
        required: ['path', 'start_line', 'end_line', 'new_content']
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

function hasAbsoluteOrTildePath(p: string): boolean {
  return isAbsolute(p) || p === '~' || p.startsWith('~/')
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

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) matrix[i] = [i]
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  return matrix[a.length][b.length]
}

function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1.0
  return 1 - levenshteinDistance(a, b) / maxLen
}

const BRACKET_LINES = new Set(['}', '};', ']);', ');', '});', '})', ']', ')'])

function leadingWhitespace(line: string): string {
  const match = line.match(/^(\s*)/)
  return match ? match[1] : ''
}

function matchUniformIndent(origLines: string[], oldLines: string[]): { index: number; indentOffset: string } | null {
  const oldLinesLstripped = oldLines.map(l => l.trimStart())

  for (let i = 0; i <= origLines.length - oldLines.length; i++) {
    const window = origLines.slice(i, i + oldLines.length)
    if (!window.every((line, j) => line.trimStart() === oldLinesLstripped[j])) continue

    const offsets = new Set<string>()
    for (let j = 0; j < oldLines.length; j++) {
      if (!oldLines[j].trim()) continue
      const origLead = leadingWhitespace(window[j])
      const oldLead = leadingWhitespace(oldLines[j])
      if (origLead.length < oldLead.length) return null
      offsets.add(origLead.slice(0, origLead.length - oldLead.length))
    }
    if (offsets.size === 1) {
      return { index: i, indentOffset: [...offsets][0] }
    }
  }
  return null
}

interface FuzzyMatchResult {
  matched: string
  strategy: string
  indentOffset?: string
}

function tryFuzzyMatchCore(origLines: string[], oldLines: string[]): FuzzyMatchResult | null {
  if (oldLines.length === 0) return null

  const oldLinesTrimmed = oldLines.map(l => l.trim())

  // Tier 1: Uniform indent detection — detect ALL lines differ by same prefix, enables re-indentation
  const uniformResult = matchUniformIndent(origLines, oldLines)
  if (uniformResult) {
    const window = origLines.slice(uniformResult.index, uniformResult.index + oldLines.length)
    return { matched: window.join('\n'), strategy: 'uniform-indent', indentOffset: uniformResult.indentOffset }
  }

  // Tier 2: Whitespace-normalized line matching — each line trimmed independently
  for (let i = 0; i <= origLines.length - oldLines.length; i++) {
    const window = origLines.slice(i, i + oldLines.length)
    if (window.every((line, j) => line.trim() === oldLinesTrimmed[j])) {
      return { matched: window.join('\n'), strategy: 'whitespace-normalized' }
    }
  }

  // Tier 4: Block anchor matching (3+ lines, first/last line anchors only)
  if (oldLines.length >= 3) {
    const firstAnchor = oldLinesTrimmed[0]
    const lastAnchor = oldLinesTrimmed[oldLinesTrimmed.length - 1]
    const blockSize = oldLines.length

    for (let i = 0; i <= origLines.length - blockSize; i++) {
      if (origLines[i].trim() !== firstAnchor) continue
      if (origLines[i + blockSize - 1].trim() !== lastAnchor) continue
      const window = origLines.slice(i, i + blockSize)
      return { matched: window.join('\n'), strategy: 'block-anchor' }
    }
  }

  // Tier 5: Ellipsis/dotdotdots — LLM uses "..." to mean "keep unchanged lines"
  const dotsResult = tryDotDotDots(origLines.join('\n'), oldLines.join('\n'))
  if (dotsResult) {
    return dotsResult
  }

  // Tier 6: Levenshtein with bracket protection + distance-proportional threshold
  const levenResult = levenshteinWindowMatch(origLines, oldLines, oldLinesTrimmed, false)
  if (levenResult) return levenResult

  // Tier 7: Variable-length window Levenshtein (±10% block size)
  const varResult = levenshteinWindowMatch(origLines, oldLines, oldLinesTrimmed, true)
  if (varResult) return varResult

  return null
}

function tryDotDotDots(whole: string, part: string): FuzzyMatchResult | null {
  const dotsRe = /(^\s*\.{3,}\s*$)/m
  const pieces = part.split(dotsRe).filter(p => !dotsRe.test(p))
  if (pieces.length < 2) return null

  for (const piece of pieces) {
    if (piece.trim() && !whole.includes(piece.trim())) {
      const wholeLines = whole.split('\n')
      const pieceLines = piece.trim().split('\n')
      let found = false
      for (let i = 0; i <= wholeLines.length - pieceLines.length; i++) {
        if (wholeLines.slice(i, i + pieceLines.length).every((l, j) => l.trim() === pieceLines[j].trim())) {
          found = true
          break
        }
      }
      if (!found) return null
    }
  }

  const firstPiece = pieces[0].trim()
  const lastPiece = pieces[pieces.length - 1].trim()
  if (!firstPiece || !lastPiece) return null

  const wholeLines = whole.split('\n')
  const firstLines = firstPiece.split('\n')
  const lastLines = lastPiece.split('\n')

  let startIdx = -1
  for (let i = 0; i <= wholeLines.length - firstLines.length; i++) {
    if (wholeLines.slice(i, i + firstLines.length).every((l, j) => l.trim() === firstLines[j].trim())) {
      startIdx = i
      break
    }
  }
  if (startIdx === -1) return null

  let endIdx = -1
  for (let i = startIdx + firstLines.length; i <= wholeLines.length - lastLines.length; i++) {
    if (wholeLines.slice(i, i + lastLines.length).every((l, j) => l.trim() === lastLines[j].trim())) {
      endIdx = i + lastLines.length
      break
    }
  }
  if (endIdx === -1) return null

  const matched = wholeLines.slice(startIdx, endIdx).join('\n')
  return { matched, strategy: 'ellipsis' }
}

function levenshteinWindowMatch(
  origLines: string[], oldLines: string[], oldLinesTrimmed: string[], variableLength: boolean
): FuzzyMatchResult | null {
  const baseLen = oldLines.length
  const minLen = variableLength ? Math.floor(baseLen * 0.9) : baseLen
  const maxLen = variableLength ? Math.ceil(baseLen * 1.1) : baseLen

  let bestWindow: string[] | null = null
  let bestAvg = 0

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i <= origLines.length - len; i++) {
      const window = origLines.slice(i, i + len)
      let allPass = true
      let totalSim = 0

      const compareLen = Math.min(len, oldLinesTrimmed.length)
      for (let j = 0; j < compareLen; j++) {
        const origTrimmed = window[j].trim()
        const searchTrimmed = oldLinesTrimmed[j] ?? ''

        if (BRACKET_LINES.has(origTrimmed) || BRACKET_LINES.has(searchTrimmed)) {
          if (origTrimmed !== searchTrimmed) { allPass = false; break }
          totalSim += 1.0
          continue
        }

        const threshold = Math.max(0, 0.48 - j * 0.04)
        const sim = lineSimilarity(origTrimmed, searchTrimmed)
        if (sim < threshold) { allPass = false; break }
        totalSim += sim
      }

      if (!allPass) continue
      const avg = totalSim / compareLen
      if (avg >= 0.75 && avg > bestAvg) {
        bestAvg = avg
        bestWindow = window
      }
    }
  }

  if (bestWindow) {
    return {
      matched: bestWindow.join('\n'),
      strategy: variableLength ? 'variable-window-levenshtein' : 'levenshtein-similarity'
    }
  }
  return null
}

function tryFuzzyMatch(original: string, oldString: string): FuzzyMatchResult | null {
  const origLines = original.split('\n')
  const oldLines = oldString.split('\n')

  if (oldLines.length > 1 && oldLines[oldLines.length - 1] === '') {
    oldLines.pop()
  }

  const result = tryFuzzyMatchCore(origLines, oldLines)
  if (result) return result

  // Tier 3: Skip spurious leading blank line — LLMs often add blank lines at start
  if (oldLines.length > 1 && !oldLines[0].trim()) {
    const withoutBlank = oldLines.slice(1)
    const retryResult = tryFuzzyMatchCore(origLines, withoutBlank)
    if (retryResult) {
      retryResult.strategy += '+skip-blank'
      return retryResult
    }
  }

  return null
}

function findSimilarBlock(origLines: string[], searchLines: string[]): string | null {
  if (searchLines.length === 0) return null
  const searchTrimmed = searchLines.map(l => l.trim())
  let bestRatio = 0
  let bestIdx = -1

  for (let i = 0; i <= origLines.length - searchLines.length; i++) {
    const window = origLines.slice(i, i + searchLines.length)
    let matchCount = 0
    for (let j = 0; j < searchLines.length; j++) {
      if (window[j].trim() === searchTrimmed[j]) matchCount++
      else if (lineSimilarity(window[j].trim(), searchTrimmed[j]) > 0.6) matchCount += 0.5
    }
    const ratio = matchCount / searchLines.length
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestIdx = i
    }
  }

  if (bestRatio < 0.3 || bestIdx === -1) return null
  const contextStart = Math.max(0, bestIdx - 3)
  const contextEnd = Math.min(origLines.length, bestIdx + searchLines.length + 3)
  const lines = origLines.slice(contextStart, contextEnd)
  return lines.map((l, j) => `  Line ${contextStart + j + 1}: ${l.slice(0, 120)}`).join('\n')
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
      let replacement = args.new_string
      if (fuzzy.indentOffset) {
        replacement = args.new_string.split('\n').map(line =>
          line.trim() ? fuzzy.indentOffset + line : line
        ).join('\n')
      }

      const matchedLines = fuzzy.matched.split('\n').length
      const replacementLines = replacement.split('\n').length
      if (replacementLines < matchedLines * 0.5 && matchedLines > 4) {
        console.log(`[FilesystemTools] Quality gate: rejected fuzzy match (${fuzzy.strategy}) — would remove >${Math.round((1 - replacementLines / matchedLines) * 100)}% of matched lines`)
      } else {
        const count = countOccurrences(original, fuzzy.matched)
        const updated = original.split(fuzzy.matched).join(replacement)
        writeFileSync(absPath, updated, 'utf-8')
        const indentNote = fuzzy.indentOffset ? ', re-indented' : ''
        console.log(`[FilesystemTools] Edited file (${fuzzy.strategy}${indentNote}): ${args.path} (${count} replacement${count > 1 ? 's' : ''})`)
        return {
          content: `Successfully replaced ${count} occurrence${count > 1 ? 's' : ''} in ${args.path} (matched via ${fuzzy.strategy}${indentNote})`,
          isError: false
        }
      }
    }

    const origLines = original.split('\n')
    const searchLines = args.old_string.split('\n')
    const similarBlock = findSimilarBlock(origLines, searchLines)
    const firstLine = searchLines[0].trim()

    const hintText = similarBlock
      ? `\n\nMost similar block found:\n${similarBlock}\n\nTip: Use cortex_read_file with offset+limit to see exact content, then retry with the exact text.`
      : firstLine
        ? `\n\nThe first line of your search ("${firstLine.slice(0, 60)}") was not found anywhere in the file.`
        : ''

    return {
      content: `old_string not found in "${args.path}". Tried: exact → uniform-indent → whitespace-normalized → skip-blank → block-anchor → ellipsis → levenshtein → variable-window → all failed.${hintText}`,
      isError: true
    }
  } catch (err) {
    return { content: `Error editing file: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function toolEditFileLines(
  repoPaths: string[],
  args: { path: string; start_line: number; end_line: number; new_content: string }
): { content: string; isError: boolean } {
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
    const lines = original.split('\n')
    const totalLines = lines.length

    const startLine = Math.floor(args.start_line)
    const endLine = Math.floor(args.end_line)

    if (startLine < 1 || endLine < 1) {
      return { content: `Line numbers must be >= 1. Got start_line=${startLine}, end_line=${endLine}`, isError: true }
    }
    if (startLine > endLine) {
      return { content: `start_line (${startLine}) must be <= end_line (${endLine})`, isError: true }
    }
    if (startLine > totalLines) {
      return { content: `start_line (${startLine}) exceeds file length (${totalLines} lines)`, isError: true }
    }

    const effectiveEnd = Math.min(endLine, totalLines)
    const removedCount = effectiveEnd - startLine + 1
    const newLines = args.new_content === '' ? [] : args.new_content.split('\n')

    const updated = [
      ...lines.slice(0, startLine - 1),
      ...newLines,
      ...lines.slice(effectiveEnd)
    ].join('\n')

    writeFileSync(absPath, updated, 'utf-8')

    const action = newLines.length === 0
      ? `Deleted ${removedCount} line${removedCount > 1 ? 's' : ''}`
      : `Replaced ${removedCount} line${removedCount > 1 ? 's' : ''} with ${newLines.length} new line${newLines.length > 1 ? 's' : ''}`

    console.log(`[FilesystemTools] Edit lines: ${args.path} L${startLine}-${effectiveEnd} (${action})`)
    return { content: `${action} in ${args.path} (lines ${startLine}-${effectiveEnd})`, isError: false }
  } catch (err) {
    return { content: `Error editing file lines: ${err instanceof Error ? err.message : String(err)}`, isError: true }
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
  } catch {
    repoPaths = []
  }

  const pathArg = (
    args.path ?? args.source ?? args.destination ??
    (args as any).paths?.[0] ??
    (args as any).edits?.[0]?.path ??
    (args as any).directory
  ) as string | undefined
  if (repoPaths.length === 0 && (!pathArg || !hasAbsoluteOrTildePath(pathArg))) {
    return { content: 'Error: No accessible repositories found for this project. Use an absolute path (e.g., ~/Documents/file.md) to write outside project repos.', isError: true }
  }

  switch (toolName) {
    case 'cortex_read_file':
      return toolReadFile(repoPaths, args as { path: string; offset?: number; limit?: number })

    case 'cortex_write_file':
      return toolWriteFile(repoPaths, args as { path: string; content: string })

    case 'cortex_edit_file':
      return toolEditFile(repoPaths, args as { path: string; old_string: string; new_string: string })

    case 'cortex_edit_file_lines':
      return toolEditFileLines(repoPaths, args as { path: string; start_line: number; end_line: number; new_content: string })

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
