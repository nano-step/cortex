/**
 * Code Advisor — TabNine-inspired code research + suggestion engine
 *
 * When user asks about implementing something, this tool:
 * 1. Searches indexed codebase for similar patterns (RAG)
 * 2. Analyzes coding conventions (naming, structure, error handling)
 * 3. Generates style-matched code suggestions with multiple approaches
 * 4. References actual files in the project as examples
 */

import type { MCPToolDefinition } from '../mcp/mcp-manager'
import { getDb, repoQueries } from '../../db'
import { searchChunks } from '../../brain-engine'
import { execFile } from 'child_process'
import { existsSync } from 'fs'

const SEARCH_TIMEOUT = 10000

function gitGrep(pattern: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['grep', '-n', '-i', '--max-count', '20', pattern], {
      cwd, timeout: SEARCH_TIMEOUT, maxBuffer: 512 * 1024
    }, (err, stdout) => {
      resolve(err ? '' : stdout.trim())
    })
  })
}

function getRepoPaths(projectId: string): Array<{ path: string; name: string }> {
  const db = getDb()
  const repos = repoQueries.getByProject(db).all(projectId) as Array<{
    id: string; source_path: string; source_type: string
  }>
  return repos
    .filter(r => r.source_path && existsSync(r.source_path))
    .map(r => ({ path: r.source_path, name: r.source_path.split('/').pop() || r.source_path }))
}

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_code_advisor',
      description: 'Research existing codebase patterns and suggest code that matches the project style. Use when user asks "how to implement X" or "best way to do Y" or needs help with a coding problem. Searches indexed code for similar implementations, identifies conventions, and generates style-matched suggestions with multiple approaches.',
      parameters: {
        type: 'object',
        properties: {
          problem: {
            type: 'string',
            description: 'The coding problem or feature to implement (e.g., "pagination for API endpoints", "error handling in services", "authentication middleware")'
          },
          language: {
            type: 'string',
            description: 'Target language (e.g., "typescript", "python", "csharp"). Auto-detected if not specified.'
          },
          search_patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional patterns to search for in the codebase (e.g., ["paginate", "offset", "limit"])'
          }
        },
        required: ['problem']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_find_similar_code',
      description: 'Find code patterns in the indexed codebase that are similar to what the user wants to implement. Returns actual code snippets with file paths. Use when user needs to see how something is already done in the project.',
      parameters: {
        type: 'object',
        properties: {
          pattern_description: {
            type: 'string',
            description: 'Description of the pattern to find (e.g., "error handling in API controllers", "database query with pagination")'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of code snippets to return. Default: 5'
          }
        },
        required: ['pattern_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_suggest_fix',
      description: 'Analyze a bug or error and suggest fixes based on patterns found in the codebase. Searches for similar error handling, identifies how the project typically handles such cases, and proposes fixes that match the project style.',
      parameters: {
        type: 'object',
        properties: {
          error_description: {
            type: 'string',
            description: 'The error message, bug description, or code that needs fixing'
          },
          file_context: {
            type: 'string',
            description: 'The file path or code context where the error occurs'
          }
        },
        required: ['error_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_explain_code_pattern',
      description: 'Explain a code pattern or architecture decision found in the codebase. Searches for the pattern, finds related files, and explains how it works with examples from the actual project.',
      parameters: {
        type: 'object',
        properties: {
          pattern_or_concept: {
            type: 'string',
            description: 'The pattern, concept, or code to explain (e.g., "middleware chain", "repository pattern", "event sourcing")'
          }
        },
        required: ['pattern_or_concept']
      }
    }
  }
]

export function getCodeAdvisorToolDefinitions(): MCPToolDefinition[] {
  return TOOL_DEFINITIONS
}

export async function executeCodeAdvisorTool(
  toolName: string,
  argsJson: string,
  projectId: string
): Promise<{ content: string; isError: boolean }> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: 'Error: Invalid JSON arguments', isError: true }
  }

  const repos = getRepoPaths(projectId)

  switch (toolName) {
    case 'cortex_code_advisor':
      return toolCodeAdvisor(projectId, repos, args as { problem: string; language?: string; search_patterns?: string[] })
    case 'cortex_find_similar_code':
      return toolFindSimilarCode(projectId, repos, args as { pattern_description: string; max_results?: number })
    case 'cortex_suggest_fix':
      return toolSuggestFix(projectId, repos, args as { error_description: string; file_context?: string })
    case 'cortex_explain_code_pattern':
      return toolExplainPattern(projectId, repos, args as { pattern_or_concept: string })
    default:
      return { content: `Unknown code advisor tool: ${toolName}`, isError: true }
  }
}

async function toolCodeAdvisor(
  projectId: string,
  repos: Array<{ path: string; name: string }>,
  args: { problem: string; language?: string; search_patterns?: string[] }
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = []
  results.push(`## Code Research: ${args.problem}\n`)

  // 1. Search indexed codebase via RAG
  try {
    const ragResults = await searchChunks(projectId, args.problem, 8)
    if (ragResults.length > 0) {
      results.push('### Similar Patterns Found in Codebase\n')
      for (const chunk of ragResults.slice(0, 5)) {
        results.push(`**${chunk.relativePath}** (L${chunk.lineStart}-${chunk.lineEnd}, ${chunk.language})`)
        results.push('```' + (chunk.language || ''))
        results.push(chunk.content.slice(0, 500))
        results.push('```\n')
      }
    }
  } catch { /* RAG may not be available */ }

  // 2. Git grep for additional patterns
  const searchTerms = [
    ...extractKeywords(args.problem),
    ...(args.search_patterns || [])
  ]

  for (const repo of repos) {
    const grepResults: string[] = []
    for (const term of searchTerms.slice(0, 5)) {
      const output = await gitGrep(term, repo.path)
      if (output) grepResults.push(output)
    }

    if (grepResults.length > 0) {
      results.push(`### Pattern Matches in ${repo.name}\n`)
      const uniqueLines = new Set<string>()
      for (const output of grepResults) {
        for (const line of output.split('\n').slice(0, 10)) {
          if (!uniqueLines.has(line)) {
            uniqueLines.add(line)
            results.push(`  ${line}`)
          }
        }
      }
      results.push('')
    }
  }

  // 3. Detect conventions
  const conventions = await detectConventions(repos)
  if (conventions) {
    results.push('### Detected Coding Conventions\n')
    results.push(conventions)
  }

  if (results.length <= 2) {
    results.push('No similar patterns found in the codebase. The LLM will generate suggestions based on general best practices.')
  }

  return { content: results.join('\n'), isError: false }
}

async function toolFindSimilarCode(
  projectId: string,
  _repos: Array<{ path: string; name: string }>,
  args: { pattern_description: string; max_results?: number }
): Promise<{ content: string; isError: boolean }> {
  const maxResults = Math.min(args.max_results || 5, 10)

  try {
    const chunks = await searchChunks(projectId, args.pattern_description, maxResults)
    if (chunks.length === 0) {
      return { content: `No similar code found for: "${args.pattern_description}"`, isError: false }
    }

    const results: string[] = [`## Similar Code: ${args.pattern_description}\n`]
    for (const chunk of chunks) {
      results.push(`### ${chunk.relativePath} (L${chunk.lineStart}-${chunk.lineEnd})`)
      results.push(`Type: ${chunk.chunkType} | Language: ${chunk.language}`)
      results.push('```' + (chunk.language || ''))
      results.push(chunk.content.slice(0, 800))
      results.push('```\n')
    }

    return { content: results.join('\n'), isError: false }
  } catch (err) {
    return { content: `Search failed: ${(err as Error).message}`, isError: true }
  }
}

async function toolSuggestFix(
  projectId: string,
  repos: Array<{ path: string; name: string }>,
  args: { error_description: string; file_context?: string }
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = [`## Bug Analysis: ${args.error_description.slice(0, 100)}\n`]

  // Search for similar error handling patterns
  const errorKeywords = extractKeywords(args.error_description)
  try {
    const ragResults = await searchChunks(projectId, args.error_description, 5)
    if (ragResults.length > 0) {
      results.push('### Related Code Context\n')
      for (const chunk of ragResults.slice(0, 3)) {
        results.push(`**${chunk.relativePath}** (L${chunk.lineStart}-${chunk.lineEnd})`)
        results.push('```' + (chunk.language || ''))
        results.push(chunk.content.slice(0, 400))
        results.push('```\n')
      }
    }
  } catch { /* non-fatal */ }

  // Search for error handling patterns
  for (const repo of repos) {
    const errorPatterns = await gitGrep('catch\\|throw\\|Error\\|Exception', repo.path)
    if (errorPatterns) {
      results.push(`### Error Handling Patterns in ${repo.name}\n`)
      results.push(errorPatterns.split('\n').slice(0, 10).join('\n'))
      results.push('')
    }
  }

  if (args.file_context) {
    results.push(`### Context: ${args.file_context}\n`)
  }

  return { content: results.join('\n'), isError: false }
}

async function toolExplainPattern(
  projectId: string,
  repos: Array<{ path: string; name: string }>,
  args: { pattern_or_concept: string }
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = [`## Pattern Explanation: ${args.pattern_or_concept}\n`]

  try {
    const ragResults = await searchChunks(projectId, args.pattern_or_concept, 8)
    if (ragResults.length > 0) {
      results.push('### Found in Codebase\n')

      const fileGroups = new Map<string, typeof ragResults>()
      for (const chunk of ragResults) {
        const key = chunk.relativePath
        if (!fileGroups.has(key)) fileGroups.set(key, [])
        fileGroups.get(key)!.push(chunk)
      }

      for (const [filePath, chunks] of fileGroups) {
        results.push(`**${filePath}**`)
        for (const chunk of chunks.slice(0, 2)) {
          results.push('```' + (chunk.language || ''))
          results.push(chunk.content.slice(0, 400))
          results.push('```')
        }
        results.push('')
      }
    }
  } catch { /* non-fatal */ }

  // Grep for related patterns
  for (const repo of repos) {
    const output = await gitGrep(args.pattern_or_concept, repo.path)
    if (output) {
      results.push(`### Occurrences in ${repo.name}\n`)
      const lines = output.split('\n').slice(0, 15)
      results.push(lines.join('\n'))
      results.push('')
    }
  }

  return { content: results.join('\n'), isError: false }
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their',
    'implement', 'create', 'make', 'build', 'add', 'use', 'need', 'want', 'like'])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w))
    .slice(0, 8)
}

async function detectConventions(
  repos: Array<{ path: string; name: string }>
): Promise<string> {
  const conventions: string[] = []

  for (const repo of repos) {
    // Check for common convention indicators
    const hasEslint = existsSync(`${repo.path}/.eslintrc.js`) || existsSync(`${repo.path}/.eslintrc.json`) || existsSync(`${repo.path}/eslint.config.js`)
    const hasPrettier = existsSync(`${repo.path}/.prettierrc`) || existsSync(`${repo.path}/.prettierrc.json`)
    const hasTsConfig = existsSync(`${repo.path}/tsconfig.json`)
    const hasEditorConfig = existsSync(`${repo.path}/.editorconfig`)

    if (hasEslint) conventions.push('- ESLint configured (code style enforcement)')
    if (hasPrettier) conventions.push('- Prettier configured (auto-formatting)')
    if (hasTsConfig) conventions.push('- TypeScript project (strict typing)')
    if (hasEditorConfig) conventions.push('- EditorConfig present (consistent formatting)')

    // Detect naming patterns from git ls-files
    try {
      const output = await new Promise<string>((resolve) => {
        execFile('git', ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.cs'], {
          cwd: repo.path, timeout: 5000, maxBuffer: 64 * 1024
        }, (err, stdout) => resolve(err ? '' : stdout.trim()))
      })

      if (output) {
        const files = output.split('\n').map(f => f.split('/').pop() || '')
        const camelCase = files.filter(f => /^[a-z][a-zA-Z]+\.(ts|js|py)$/.test(f)).length
        const kebabCase = files.filter(f => /^[a-z]+-[a-z]/.test(f)).length
        const pascalCase = files.filter(f => /^[A-Z][a-zA-Z]+\.(tsx|jsx|cs)$/.test(f)).length

        if (camelCase > kebabCase && camelCase > pascalCase) {
          conventions.push('- Naming: camelCase for files')
        } else if (kebabCase > camelCase) {
          conventions.push('- Naming: kebab-case for files')
        } else if (pascalCase > camelCase) {
          conventions.push('- Naming: PascalCase for component files')
        }
      }
    } catch { /* non-fatal */ }
  }

  return conventions.length > 0 ? conventions.join('\n') : ''
}
