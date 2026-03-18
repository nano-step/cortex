/**
 * Project Analysis Tools — Git contributors, log search, grep, stats, config search
 *
 * These tools fill the gap where RAG cannot answer: team info, git history,
 * exact text search, and config value lookups. They are exposed as OpenAI
 * function-calling tools alongside filesystem-tools.
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type { MCPToolDefinition } from '../mcp/mcp-manager'
import { getDb, repoQueries } from '../../db'

const GIT_TIMEOUT = 15000

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || String(err)))
      else resolve(stdout.trim())
    })
  })
}

function isGitRepo(path: string): boolean {
  try {
    return existsSync(`${path}/.git`)
  } catch {
    return false
  }
}

function getRepoPaths(projectId: string): Array<{ path: string; name: string }> {
  const db = getDb()
  const repos = repoQueries.getByProject(db).all(projectId) as Array<{
    id: string; source_path: string; source_type: string
  }>
  return repos
    .filter(r => r.source_path && existsSync(r.source_path))
    .map(r => ({
      path: r.source_path,
      name: r.source_path.split('/').pop() || r.source_path
    }))
}

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_git_contributors',
      description: 'Get list of git contributors with commit counts and emails. Use when user asks about team size, who works on the project, or how many people are involved.',
      parameters: {
        type: 'object',
        properties: {
          timeframe: {
            type: 'string',
            description: 'Time filter: "90d" (last 90 days), "1y" (last year), "all" (all time). Default: "all"'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_git_log_search',
      description: 'Search git commit history by message text, author name, or date range. Use when user asks about changes, who made a change, or when something was added/modified.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search in commit messages'
          },
          author: {
            type: 'string',
            description: 'Filter by author name or email'
          },
          since: {
            type: 'string',
            description: 'Start date (e.g., "2024-01-01", "3 months ago")'
          },
          until: {
            type: 'string',
            description: 'End date (e.g., "2024-12-31")'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of commits to return. Default: 20'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_grep_search',
      description: 'Search for exact text patterns across all project files. More thorough than RAG — finds exact matches including config values, variable names, and string literals. Use when RAG context is insufficient or user needs to find a specific value.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regex pattern to search for'
          },
          file_pattern: {
            type: 'string',
            description: 'File glob filter (e.g., "*.ts", "*.cs", "*.env*", "*.json")'
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Whether search is case-sensitive. Default: false'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_project_stats',
      description: 'Get comprehensive project statistics: total files, languages breakdown, contributor count, recent commit activity, and repository info. Use when user asks about project overview or metadata.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cortex_search_config',
      description: 'Search for configuration values, environment variables, constants, or settings across all project files. Focuses on config-related files (.env, config/, constants/, appsettings.json, etc.). Use when user asks about a specific config name or setting value.',
      parameters: {
        type: 'object',
        properties: {
          config_name: {
            type: 'string',
            description: 'The config key or variable name to search for (e.g., "GeoLocation", "DATABASE_URL", "ApiKey")'
          }
        },
        required: ['config_name']
      }
    }
  }
]

export function getProjectToolDefinitions(_projectId: string): MCPToolDefinition[] {
  return TOOL_DEFINITIONS
}

export async function executeProjectTool(
  toolName: string,
  argsJson: string,
  projectId: string
): Promise<{ content: string; isError: boolean }> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return { content: 'Error parsing tool arguments: invalid JSON', isError: true }
  }

  const repos = getRepoPaths(projectId)
  if (repos.length === 0) {
    return { content: 'No accessible repositories found for this project', isError: true }
  }

  switch (toolName) {
    case 'cortex_git_contributors':
      return toolGitContributors(repos, args as { timeframe?: string })
    case 'cortex_git_log_search':
      return toolGitLogSearch(repos, args as { query?: string; author?: string; since?: string; until?: string; limit?: number })
    case 'cortex_grep_search':
      return toolGrepSearch(repos, args as { pattern: string; file_pattern?: string; case_sensitive?: boolean })
    case 'cortex_project_stats':
      return toolProjectStats(repos)
    case 'cortex_search_config':
      return toolSearchConfig(repos, args as { config_name: string })
    default:
      return { content: `Unknown project tool: ${toolName}`, isError: true }
  }
}

async function toolGitContributors(
  repos: Array<{ path: string; name: string }>,
  args: { timeframe?: string }
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = []

  for (const repo of repos) {
    if (!isGitRepo(repo.path)) continue

    try {
      const gitArgs = ['shortlog', '-sne', '--all']
      if (args.timeframe && args.timeframe !== 'all') {
        const sinceDate = parseTimeframe(args.timeframe)
        if (sinceDate) gitArgs.push(`--since=${sinceDate}`)
      }

      const output = await gitExec(gitArgs, repo.path)
      if (output) {
        results.push(`=== ${repo.name} ===`)
        results.push(output)

        const lines = output.split('\n').filter(Boolean)
        results.push(`\nTotal contributors: ${lines.length}`)
      }
    } catch (err) {
      results.push(`=== ${repo.name} === [Error: ${(err as Error).message}]`)
    }
  }

  if (results.length === 0) {
    return { content: 'No git repositories found or no contributors data available', isError: true }
  }

  return { content: results.join('\n'), isError: false }
}

async function toolGitLogSearch(
  repos: Array<{ path: string; name: string }>,
  args: { query?: string; author?: string; since?: string; until?: string; limit?: number }
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = []
  const limit = Math.min(args.limit || 20, 50)

  for (const repo of repos) {
    if (!isGitRepo(repo.path)) continue

    try {
      const gitArgs = ['log', '--oneline', '--all', `-${limit}`, '--date=short', '--format=%h %ad %an: %s']
      if (args.query) gitArgs.push(`--grep=${args.query}`)
      if (args.author) gitArgs.push(`--author=${args.author}`)
      if (args.since) gitArgs.push(`--since=${args.since}`)
      if (args.until) gitArgs.push(`--until=${args.until}`)

      const output = await gitExec(gitArgs, repo.path)
      if (output) {
        results.push(`=== ${repo.name} ===`)
        results.push(output)
      }
    } catch (err) {
      results.push(`=== ${repo.name} === [Error: ${(err as Error).message}]`)
    }
  }

  if (results.length === 0) {
    return { content: 'No matching commits found', isError: false }
  }

  return { content: results.join('\n'), isError: false }
}

async function toolGrepSearch(
  repos: Array<{ path: string; name: string }>,
  args: { pattern: string; file_pattern?: string; case_sensitive?: boolean }
): Promise<{ content: string; isError: boolean }> {
  if (!args.pattern || args.pattern.length < 2) {
    return { content: 'Search pattern must be at least 2 characters', isError: true }
  }

  // Reject path traversal
  if (args.pattern.includes('..') || (args.file_pattern && args.file_pattern.includes('..'))) {
    return { content: 'Invalid pattern: path traversal not allowed', isError: true }
  }

  const results: string[] = []
  const maxResults = 50

  for (const repo of repos) {
    try {
      const gitArgs = ['grep', '-n', '--max-count', String(maxResults)]
      if (!args.case_sensitive) gitArgs.push('-i')
      if (args.file_pattern) gitArgs.push('--', args.file_pattern)

      gitArgs.splice(2, 0, args.pattern)

      const output = isGitRepo(repo.path)
        ? await gitExec(gitArgs, repo.path).catch(() => '')
        : ''

      if (output) {
        results.push(`=== ${repo.name} ===`)
        const lines = output.split('\n').slice(0, maxResults)
        results.push(lines.join('\n'))
        if (output.split('\n').length > maxResults) {
          results.push(`... (truncated, showing first ${maxResults} results)`)
        }
      }
    } catch {
      // git grep returns exit code 1 when no matches — not an error
    }
  }

  if (results.length === 0) {
    return { content: `No matches found for "${args.pattern}"`, isError: false }
  }

  return { content: results.join('\n'), isError: false }
}

async function toolProjectStats(
  repos: Array<{ path: string; name: string }>
): Promise<{ content: string; isError: boolean }> {
  const results: string[] = []

  for (const repo of repos) {
    results.push(`=== ${repo.name} ===`)

    if (!isGitRepo(repo.path)) {
      results.push('(Not a git repository)')
      continue
    }

    try {
      const shortlog = await gitExec(['shortlog', '-sn', '--all'], repo.path).catch(() => '')
      const contributorCount = shortlog.split('\n').filter(Boolean).length

      const recentCommits = await gitExec(
        ['log', '--oneline', '--since=30 days ago', '--all'],
        repo.path
      ).catch(() => '')
      const recentCount = recentCommits ? recentCommits.split('\n').filter(Boolean).length : 0

      const totalCommits = await gitExec(['rev-list', '--count', '--all'], repo.path).catch(() => '0')
      const branch = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], repo.path).catch(() => 'unknown')
      const fileList = await gitExec(['ls-files'], repo.path).catch(() => '')
      const fileCount = fileList ? fileList.split('\n').filter(Boolean).length : 0
      const langBreakdown = getLanguageBreakdown(fileList)

      results.push(`Contributors: ${contributorCount}`)
      results.push(`Total commits: ${totalCommits}`)
      results.push(`Commits (last 30 days): ${recentCount}`)
      results.push(`Current branch: ${branch}`)
      results.push(`Tracked files: ${fileCount}`)
      if (langBreakdown) results.push(`Languages: ${langBreakdown}`)
    } catch (err) {
      results.push(`Error: ${(err as Error).message}`)
    }

    results.push('')
  }

  return { content: results.join('\n'), isError: false }
}

async function toolSearchConfig(
  repos: Array<{ path: string; name: string }>,
  args: { config_name: string }
): Promise<{ content: string; isError: boolean }> {
  if (!args.config_name || args.config_name.length < 2) {
    return { content: 'Config name must be at least 2 characters', isError: true }
  }

  const results: string[] = []

  const configPatterns = [
    '*.env*', '*.config.*', '*.json', '*.yaml', '*.yml',
    '*.toml', '*.ini', '*.properties', '**/constants.*',
    '**/config/**', '**/settings/**', 'appsettings.*'
  ]

  for (const repo of repos) {
    if (!isGitRepo(repo.path)) continue

    try {
      const gitArgs = ['grep', '-n', '-i', args.config_name, '--']
      gitArgs.push(...configPatterns)
      const configOutput = await gitExec(gitArgs, repo.path).catch(() => '')

      let allOutput = ''
      if (!configOutput) {
        allOutput = await gitExec(
          ['grep', '-n', '-i', '--max-count', '30', args.config_name],
          repo.path
        ).catch(() => '')
      }

      const output = configOutput || allOutput
      if (output) {
        results.push(`=== ${repo.name} ===`)
        results.push(output.split('\n').slice(0, 30).join('\n'))
      }
    } catch {
      // git grep exit 1 = no matches
    }
  }

  if (results.length === 0) {
    return { content: `No config entries found for "${args.config_name}". Try cortex_grep_search for a broader search.`, isError: false }
  }

  return { content: results.join('\n'), isError: false }
}

function parseTimeframe(tf: string): string | null {
  const match = tf.match(/^(\d+)(d|w|m|y)$/)
  if (!match) return null

  const [, num, unit] = match
  const n = parseInt(num)
  const now = new Date()

  switch (unit) {
    case 'd': now.setDate(now.getDate() - n); break
    case 'w': now.setDate(now.getDate() - n * 7); break
    case 'm': now.setMonth(now.getMonth() - n); break
    case 'y': now.setFullYear(now.getFullYear() - n); break
  }

  return now.toISOString().split('T')[0]
}

function getLanguageBreakdown(fileList: string): string {
  if (!fileList) return ''

  const extCounts = new Map<string, number>()
  for (const file of fileList.split('\n')) {
    const ext = file.split('.').pop()?.toLowerCase()
    if (ext && ext !== file && ext.length <= 10) {
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1)
    }
  }

  const EXT_TO_LANG: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript/React', js: 'JavaScript', jsx: 'JavaScript/React',
    py: 'Python', cs: 'C#', java: 'Java', go: 'Go', rs: 'Rust', rb: 'Ruby',
    css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', yaml: 'YAML', yml: 'YAML',
    sql: 'SQL', md: 'Markdown', sh: 'Shell', swift: 'Swift', kt: 'Kotlin'
  }

  const langCounts = new Map<string, number>()
  for (const [ext, count] of extCounts) {
    const lang = EXT_TO_LANG[ext] || ext.toUpperCase()
    langCounts.set(lang, (langCounts.get(lang) || 0) + count)
  }

  return Array.from(langCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, count]) => `${lang}(${count})`)
    .join(', ')
}
