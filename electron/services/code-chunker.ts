/**
 * Code Chunker — AST-aware semantic code chunking
 *
 * Instead of naive line splitting, we chunk at semantic boundaries:
 * - Functions/methods → 1 chunk each
 * - Classes → 1 chunk for declaration + separate chunks per method
 * - Top-level exports → 1 chunk
 * - Config files → 1 chunk (usually small)
 * - Documentation → paragraph-based chunks
 *
 * Each chunk includes metadata for retrieval:
 * - file path, language, chunk type
 * - function/class name (if applicable)
 * - line range (start, end)
 * - imports/dependencies referenced
 */

export type ChunkType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'export'
  | 'import_block'
  | 'config'
  | 'documentation'
  | 'module'
  | 'route'
  | 'schema'
  | 'test'
  | 'document'
  | 'other'

export interface CodeChunk {
  id: string
  projectId: string
  repoId: string
  filePath: string
  relativePath: string
  language: string
  chunkType: ChunkType
  name: string | null       // function/class/variable name
  content: string
  lineStart: number
  lineEnd: number
  tokenEstimate: number     // rough token count
  dependencies: string[]    // imported modules referenced
  exports: string[]         // exported names
  metadata: Record<string, string>
  branch: string
}

// Target chunk size in tokens (approx 4 chars = 1 token)
const MAX_CHUNK_TOKENS = 1500
const MIN_CHUNK_TOKENS = 50
const CHARS_PER_TOKEN = 4

/**
 * Chunk source code into semantic pieces.
 * Uses regex-based heuristic parsing (fast, good enough for most languages).
 * Tree-sitter AST parsing will be added as an enhancement.
 */
export function chunkCode(
  content: string,
  filePath: string,
  relativePath: string,
  language: string,
  projectId: string,
  repoId: string,
  branch: string = 'main'
): CodeChunk[] {
  const lines = content.split('\n')
  const totalTokens = estimateTokens(content)

  // Small files → single chunk
  if (totalTokens <= MAX_CHUNK_TOKENS) {
    return [
      createChunk({
        projectId,
        repoId,
        filePath,
        relativePath,
        language,
        chunkType: detectFileType(relativePath, language),
        name: null,
        content,
        lineStart: 1,
        lineEnd: lines.length,
        dependencies: extractImports(content, language),
        exports: extractExports(content, language)
      })
    ].map(c => ({ ...c, branch }))
  }

  // Config/JSON/YAML → single chunk (truncate if huge)
  if (['json', 'yaml', 'toml', 'env'].includes(language)) {
    return [
      createChunk({
        projectId,
        repoId,
        filePath,
        relativePath,
        language,
        chunkType: 'config',
        name: null,
        content: totalTokens > MAX_CHUNK_TOKENS * 2
          ? content.slice(0, MAX_CHUNK_TOKENS * CHARS_PER_TOKEN) + '\n// ... truncated'
          : content,
        lineStart: 1,
        lineEnd: lines.length,
        dependencies: [],
        exports: []
      })
    ].map(c => ({ ...c, branch }))
  }

  // Markdown → paragraph chunks
  if (language === 'markdown') {
    return chunkMarkdown(content, filePath, relativePath, projectId, repoId).map(c => ({ ...c, branch }))
  }

  // Code files → semantic chunking
  return chunkCodeSemantic(content, lines, filePath, relativePath, language, projectId, repoId).map(c => ({ ...c, branch }))
}

function chunkCodeSemantic(
  content: string,
  lines: string[],
  filePath: string,
  relativePath: string,
  language: string,
  projectId: string,
  repoId: string
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  const globalImports = extractImports(content, language)

  // Extract import block as separate chunk
  const importBlock = extractImportBlock(lines, language)
  if (importBlock.end > importBlock.start) {
    const importContent = lines.slice(importBlock.start, importBlock.end).join('\n')
    if (estimateTokens(importContent) >= MIN_CHUNK_TOKENS) {
      chunks.push(
        createChunk({
          projectId,
          repoId,
          filePath,
          relativePath,
          language,
          chunkType: 'import_block',
          name: null,
          content: importContent,
          lineStart: importBlock.start + 1,
          lineEnd: importBlock.end,
          dependencies: globalImports,
          exports: []
        })
      )
    }
  }

  // Find semantic boundaries (functions, classes, etc.)
  const boundaries = findSemanticBoundaries(lines, language)

  if (boundaries.length === 0) {
    // No clear boundaries found → fall back to sliding window
    return fallbackChunking(content, lines, filePath, relativePath, language, projectId, repoId)
  }

  for (const boundary of boundaries) {
    const chunkContent = lines.slice(boundary.start, boundary.end).join('\n')
    const tokens = estimateTokens(chunkContent)

    if (tokens < MIN_CHUNK_TOKENS) continue

    // If chunk is too large, split it further
    if (tokens > MAX_CHUNK_TOKENS * 2) {
      const subChunks = splitLargeChunk(
        chunkContent,
        boundary,
        filePath,
        relativePath,
        language,
        projectId,
        repoId
      )
      chunks.push(...subChunks)
    } else {
      chunks.push(
        createChunk({
          projectId,
          repoId,
          filePath,
          relativePath,
          language,
          chunkType: boundary.type,
          name: boundary.name,
          content: chunkContent,
          lineStart: boundary.start + 1,
          lineEnd: boundary.end,
          dependencies: globalImports,
          exports: boundary.exported ? [boundary.name || ''] : []
        })
      )
    }
  }

  return chunks.length > 0 ? chunks : fallbackChunking(
    content, lines, filePath, relativePath, language, projectId, repoId
  )
}

interface SemanticBoundary {
  start: number      // line index (0-based)
  end: number        // line index (exclusive)
  type: ChunkType
  name: string | null
  exported: boolean
}

function findSemanticBoundaries(lines: string[], language: string): SemanticBoundary[] {
  const boundaries: SemanticBoundary[] = []

  // Language-specific patterns
  const patterns = getLanguagePatterns(language)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      i++
      continue
    }

    // Try matching patterns
    let matched = false
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex)
      if (match) {
        const end = findBlockEnd(lines, i, language)
        const exported = /^export\s/.test(trimmed) || /^pub\s/.test(trimmed)

        boundaries.push({
          start: findBlockStart(lines, i), // Include preceding comments/decorators
          end: end + 1,
          type: pattern.type,
          name: match[1] || null,
          exported
        })

        i = end + 1
        matched = true
        break
      }
    }

    if (!matched) i++
  }

  return boundaries
}

interface LanguagePattern {
  regex: RegExp
  type: ChunkType
}

function getLanguagePatterns(language: string): LanguagePattern[] {
  const tsPatterns: LanguagePattern[] = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
    { regex: /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/, type: 'class' },
    { regex: /^(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
    { regex: /^(?:export\s+)?type\s+(\w+)/, type: 'type' },
    { regex: /^(?:export\s+)?enum\s+(\w+)/, type: 'enum' },
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/, type: 'function' }, // arrow function
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=/, type: 'constant' },
    { regex: /^(?:app|router)\.(get|post|put|patch|delete)\s*\(/, type: 'route' },
    { regex: /^describe\s*\(/, type: 'test' },
    { regex: /^(?:it|test)\s*\(/, type: 'test' }
  ]

  const pyPatterns: LanguagePattern[] = [
    { regex: /^(?:async\s+)?def\s+(\w+)/, type: 'function' },
    { regex: /^class\s+(\w+)/, type: 'class' },
    { regex: /^(\w+)\s*=\s*/, type: 'constant' }
  ]

  const goPatterns: LanguagePattern[] = [
    { regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/, type: 'function' },
    { regex: /^type\s+(\w+)\s+struct/, type: 'class' },
    { regex: /^type\s+(\w+)\s+interface/, type: 'interface' }
  ]

  const rustPatterns: LanguagePattern[] = [
    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, type: 'function' },
    { regex: /^(?:pub\s+)?struct\s+(\w+)/, type: 'class' },
    { regex: /^(?:pub\s+)?enum\s+(\w+)/, type: 'enum' },
    { regex: /^(?:pub\s+)?trait\s+(\w+)/, type: 'interface' },
    { regex: /^impl\s+(?:<[^>]+>\s+)?(\w+)/, type: 'class' }
  ]

  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      return tsPatterns
    case 'python':
      return pyPatterns
    case 'go':
      return goPatterns
    case 'rust':
      return rustPatterns
    default:
      // Generic patterns that work across many C-like languages
      return [
        { regex: /^(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)?(\w+)\s*\(/, type: 'function' },
        { regex: /^(?:public\s+)?class\s+(\w+)/, type: 'class' },
        { regex: /^(?:public\s+)?interface\s+(\w+)/, type: 'interface' }
      ]
  }
}

/**
 * Find the end of a code block by tracking braces/indentation
 */
function findBlockEnd(lines: string[], startLine: number, language: string): number {
  // Python uses indentation
  if (language === 'python') {
    const startIndent = lines[startLine].search(/\S/)
    let end = startLine + 1
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() === '') {
        end++
        continue
      }
      const indent = line.search(/\S/)
      if (indent <= startIndent) break
      end++
    }
    return Math.max(startLine, end - 1)
  }

  // Brace-based languages
  let braceCount = 0
  let foundOpen = false

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    for (const char of line) {
      if (char === '{') {
        braceCount++
        foundOpen = true
      } else if (char === '}') {
        braceCount--
        if (foundOpen && braceCount === 0) {
          return i
        }
      }
    }
  }

  // No matching brace found — take reasonable block
  return Math.min(startLine + 50, lines.length - 1)
}

/**
 * Look backwards from a function/class to include decorators and doc comments
 */
function findBlockStart(lines: string[], lineIdx: number): number {
  let start = lineIdx
  while (start > 0) {
    const prev = lines[start - 1].trim()
    if (
      prev.startsWith('@') ||           // decorator
      prev.startsWith('/**') ||          // JSDoc
      prev.startsWith('*') ||            // JSDoc continuation
      prev.startsWith('///') ||          // Rust doc
      prev.startsWith('#[') ||           // Rust attribute
      prev.startsWith('"""') ||          // Python docstring
      prev.startsWith("'''") ||          // Python docstring
      prev === ''                         // blank line between decorator and function
    ) {
      start--
    } else {
      break
    }
  }
  return start
}

function extractImportBlock(lines: string[], language: string): { start: number; end: number } {
  let start = -1
  let end = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    const isImport =
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('require(') ||
      trimmed.startsWith('const ') && trimmed.includes('require(') ||
      trimmed.startsWith('use ') ||  // Rust/PHP
      trimmed.startsWith('package ')

    if (isImport) {
      if (start === -1) start = i
      end = i + 1
    } else if (start !== -1) {
      // Allow blank lines within import block
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
        break
      }
    }
  }

  return { start: start === -1 ? 0 : start, end }
}

function extractImports(content: string, language: string): string[] {
  const imports: string[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // TypeScript/JavaScript
    let match = trimmed.match(/(?:import|from)\s+['"]([^'"]+)['"]/)
    if (match) {
      imports.push(match[1])
      continue
    }

    // require()
    match = trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (match) {
      imports.push(match[1])
      continue
    }

    // Python
    match = trimmed.match(/^(?:from|import)\s+([\w.]+)/)
    if (match && language === 'python') {
      imports.push(match[1])
      continue
    }

    // Go
    match = trimmed.match(/^\s*"([^"]+)"/)
    if (match && language === 'go') {
      imports.push(match[1])
    }
  }

  return [...new Set(imports)]
}

function extractExports(content: string, language: string): string[] {
  const exports: string[] = []

  if (['typescript', 'tsx', 'javascript', 'jsx'].includes(language)) {
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g
    let match
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1])
    }
  }

  return exports
}

function chunkMarkdown(
  content: string,
  filePath: string,
  relativePath: string,
  projectId: string,
  repoId: string
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  const sections = content.split(/^(#{1,3}\s.+)$/m)

  let currentContent = ''
  let currentName: string | null = null
  let lineOffset = 1

  for (const section of sections) {
    if (section.match(/^#{1,3}\s/)) {
      // Save previous chunk
      if (currentContent.trim()) {
        const contentLines = currentContent.split('\n')
        chunks.push(
          createChunk({
            projectId,
            repoId,
            filePath,
            relativePath,
            language: 'markdown',
            chunkType: 'documentation',
            name: currentName,
            content: currentContent.trim(),
            lineStart: lineOffset,
            lineEnd: lineOffset + contentLines.length - 1,
            dependencies: [],
            exports: []
          })
        )
        lineOffset += contentLines.length
      }
      currentName = section.replace(/^#+\s/, '').trim()
      currentContent = section + '\n'
    } else {
      currentContent += section
    }
  }

  // Last section
  if (currentContent.trim()) {
    const contentLines = currentContent.split('\n')
    chunks.push(
      createChunk({
        projectId,
        repoId,
        filePath,
        relativePath,
        language: 'markdown',
        chunkType: 'documentation',
        name: currentName,
        content: currentContent.trim(),
        lineStart: lineOffset,
        lineEnd: lineOffset + contentLines.length - 1,
        dependencies: [],
        exports: []
      })
    )
  }

  return chunks
}

function fallbackChunking(
  content: string,
  lines: string[],
  filePath: string,
  relativePath: string,
  language: string,
  projectId: string,
  repoId: string
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  const chunkSize = Math.floor(MAX_CHUNK_TOKENS * CHARS_PER_TOKEN)
  const overlap = 200 // char overlap for context continuity

  let start = 0
  let chunkIdx = 0

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length)

    // Try to break at a newline
    if (end < content.length) {
      const newlineIdx = content.lastIndexOf('\n', end)
      if (newlineIdx > start + chunkSize / 2) {
        end = newlineIdx + 1
      }
    }

    const chunkContent = content.slice(start, end)
    const startLine = content.slice(0, start).split('\n').length
    const endLine = startLine + chunkContent.split('\n').length - 1

    chunks.push(
      createChunk({
        projectId,
        repoId,
        filePath,
        relativePath,
        language,
        chunkType: 'other',
        name: `chunk_${chunkIdx}`,
        content: chunkContent,
        lineStart: startLine,
        lineEnd: endLine,
        dependencies: chunkIdx === 0 ? extractImports(content, language) : [],
        exports: []
      })
    )

    start = end - overlap
    if (start >= content.length - overlap) break
    chunkIdx++
  }

  return chunks
}

function splitLargeChunk(
  content: string,
  boundary: SemanticBoundary,
  filePath: string,
  relativePath: string,
  language: string,
  projectId: string,
  repoId: string
): CodeChunk[] {
  // Re-use fallback chunking for oversized blocks
  const lines = content.split('\n')
  return fallbackChunking(content, lines, filePath, relativePath, language, projectId, repoId).map(
    (chunk) => ({
      ...chunk,
      chunkType: boundary.type,
      name: boundary.name,
      lineStart: chunk.lineStart + boundary.start,
      lineEnd: chunk.lineEnd + boundary.start
    })
  )
}

function detectFileType(relativePath: string, language: string): ChunkType {
  const lower = relativePath.toLowerCase()
  if (lower.includes('route') || lower.includes('controller')) return 'route'
  if (lower.includes('schema') || lower.includes('model') || lower.includes('migration')) return 'schema'
  if (lower.includes('test') || lower.includes('spec') || lower.includes('__test__')) return 'test'
  if (lower.includes('config') || ['json', 'yaml', 'toml', 'env'].includes(language)) return 'config'
  if (language === 'markdown') return 'documentation'
  return 'module'
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

let chunkCounter = 0

function createChunk(params: Omit<CodeChunk, 'id' | 'tokenEstimate' | 'metadata' | 'branch'>): CodeChunk {
  chunkCounter++
  return {
    ...params,
    id: `chunk_${Date.now()}_${chunkCounter}`,
    tokenEstimate: estimateTokens(params.content),
    metadata: {},
    branch: 'main' // Will be overridden by chunkCode caller
  }
}

export function chunkDocument(
  convertedMarkdown: string,
  filePath: string,
  relativePath: string,
  projectId: string,
  repoId: string,
  sourceMetadata: Record<string, string | number | undefined>,
  branch: string = 'main'
): CodeChunk[] {
  if (!convertedMarkdown || convertedMarkdown.trim().length === 0) return []

  const lines = convertedMarkdown.split('\n')
  const totalTokens = estimateTokens(convertedMarkdown)
  const sourceFormat = String(sourceMetadata.sourceFormat ?? 'document')

  if (totalTokens <= MAX_CHUNK_TOKENS) {
    const chunk = createChunk({
      projectId,
      repoId,
      filePath,
      relativePath,
      language: sourceFormat,
      chunkType: 'document',
      name: String(sourceMetadata.title ?? relativePath.split('/').pop() ?? relativePath),
      content: convertedMarkdown,
      lineStart: 1,
      lineEnd: lines.length,
      dependencies: [],
      exports: []
    })
    chunk.metadata = buildDocMetadata(sourceMetadata)
    return [{ ...chunk, branch }]
  }

  const headerPattern = /^#{1,3}\s+/
  const sections: Array<{ start: number; end: number; heading: string }> = []
  let currentStart = 0
  let currentHeading = relativePath.split('/').pop() ?? relativePath

  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i]) && i > currentStart) {
      sections.push({ start: currentStart, end: i, heading: currentHeading })
      currentStart = i
      currentHeading = lines[i].replace(/^#+\s+/, '').trim()
    }
  }
  sections.push({ start: currentStart, end: lines.length, heading: currentHeading })

  const chunks: CodeChunk[] = []
  for (const section of sections) {
    const sectionContent = lines.slice(section.start, section.end).join('\n').trim()
    if (estimateTokens(sectionContent) < MIN_CHUNK_TOKENS) continue

    const chunk = createChunk({
      projectId,
      repoId,
      filePath,
      relativePath,
      language: sourceFormat,
      chunkType: 'document',
      name: section.heading,
      content: sectionContent,
      lineStart: section.start + 1,
      lineEnd: section.end,
      dependencies: [],
      exports: []
    })
    chunk.metadata = buildDocMetadata(sourceMetadata)
    chunks.push({ ...chunk, branch })
  }

  return chunks.length > 0 ? chunks : [{
    ...createChunk({
      projectId, repoId, filePath, relativePath,
      language: sourceFormat, chunkType: 'document',
      name: String(sourceMetadata.title ?? relativePath.split('/').pop() ?? relativePath),
      content: convertedMarkdown.slice(0, MAX_CHUNK_TOKENS * CHARS_PER_TOKEN),
      lineStart: 1, lineEnd: lines.length, dependencies: [], exports: []
    }),
    metadata: buildDocMetadata(sourceMetadata),
    branch
  }]
}

function buildDocMetadata(sourceMetadata: Record<string, string | number | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(sourceMetadata)) {
    if (v !== undefined) result[k] = String(v)
  }
  return result
}
