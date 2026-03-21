/**
 * Jira Service — Read-only Jira Cloud integration
 *
 * Fetches tickets, sprints, boards, and backlogs from Jira Cloud REST API v3.
 * Converts Atlassian Document Format (ADF) to plain text for chunking.
 * Uses Basic Auth (email:apiToken) for authentication.
 *
 * Endpoints:
 * - POST /rest/api/3/search (JQL search for issues)
 * - GET /rest/agile/1.0/board (list boards)
 * - GET /rest/agile/1.0/board/{boardId}/sprint (list sprints)
 * - GET /rest/api/3/issue/{issueKey} (single issue with comments)
 */

// Config is passed externally via JiraConnectionConfig — no global config import needed

// ============================
// Types
// ============================

export interface JiraIssue {
  key: string
  summary: string
  description: string // plain text extracted from ADF
  status: string
  statusCategory: string
  assignee: string | null
  reporter: string | null
  priority: string
  labels: string[]
  issueType: string
  sprintName: string | null
  epicKey: string | null
  epicName: string | null
  comments: JiraComment[]
  created: string
  updated: string
  resolution: string | null
  storyPoints: number | null
  rawDescription?: any // ADF JSON
}

export interface JiraComment {
  author: string
  body: string // plain text
  created: string
}

export interface JiraSprint {
  id: number
  name: string
  state: string // active, closed, future
  startDate: string | null
  endDate: string | null
  completeDate: string | null
  goal: string | null
}

export interface JiraBoard {
  id: number
  name: string
  type: string // scrum, kanban
  projectKey: string
}

export interface JiraProject {
  key: string
  name: string
  projectTypeKey: string
}

export interface JiraConnectionConfig {
  siteUrl: string   // e.g., https://mysite.atlassian.net
  email: string
  apiToken: string
}

interface JiraSearchResponse {
  startAt: number
  maxResults: number
  total: number
  issues: any[]
}

// ============================
// Core API Client
// ============================

function getAuthHeader(config: JiraConnectionConfig): string {
  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
  return `Basic ${credentials}`
}

function normalizeBaseUrl(siteUrl: string): string {
  let url = siteUrl.trim().replace(/\/+$/, '')
  if (!url.startsWith('http')) {
    url = `https://${url}`
  }
  // Ensure it ends with atlassian.net or similar
  return url
}

async function jiraFetch(
  config: JiraConnectionConfig,
  path: string,
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<any> {
  const baseUrl = normalizeBaseUrl(config.siteUrl)
  const url = `${baseUrl}${path}`

  const headers: Record<string, string> = {
    Authorization: getAuthHeader(config),
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 30000)
  })

  if (response.status === 429) {
    // Rate limited — extract retry-after and wait
    const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10)
    await sleep(retryAfter * 1000)
    return jiraFetch(config, path, options) // Retry once
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Jira API error ${response.status}: ${errorText}`)
  }

  return response.json()
}

// ============================
// Connection Test
// ============================

export async function testJiraConnection(config: JiraConnectionConfig): Promise<{
  success: boolean
  error?: string
  user?: string
  serverInfo?: { baseUrl: string; version: string }
}> {
  try {
    const myself = await jiraFetch(config, '/rest/api/3/myself')
    const serverInfo = await jiraFetch(config, '/rest/api/3/serverInfo').catch(() => null)

    return {
      success: true,
      user: myself.displayName || myself.emailAddress,
      serverInfo: serverInfo ? {
        baseUrl: serverInfo.baseUrl,
        version: serverInfo.versionNumbers?.join('.') || 'cloud'
      } : undefined
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed'
    }
  }
}

// ============================
// Fetch Projects
// ============================

export async function fetchJiraProjects(config: JiraConnectionConfig): Promise<JiraProject[]> {
  const data = await jiraFetch(config, '/rest/api/3/project/search?maxResults=100')
  return (data.values || []).map((p: any) => ({
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey
  }))
}

// ============================
// Fetch Boards
// ============================

export async function fetchBoards(config: JiraConnectionConfig, projectKey?: string): Promise<JiraBoard[]> {
  const params = new URLSearchParams({ maxResults: '100' })
  if (projectKey) params.set('projectKeyOrId', projectKey)

  const data = await jiraFetch(config, `/rest/agile/1.0/board?${params}`)
  return (data.values || []).map((b: any) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    projectKey: b.location?.projectKey || ''
  }))
}

// ============================
// Fetch Sprints
// ============================

export async function fetchSprints(config: JiraConnectionConfig, boardId: number): Promise<JiraSprint[]> {
  const allSprints: JiraSprint[] = []
  let startAt = 0

  while (true) {
    const data = await jiraFetch(
      config,
      `/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=50`
    )

    const sprints = (data.values || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      completeDate: s.completeDate || null,
      goal: s.goal || null
    }))

    allSprints.push(...sprints)

    if (data.isLast || sprints.length === 0) break
    startAt += sprints.length
  }

  return allSprints
}

// ============================
// Fetch Issues (with full pagination)
// ============================

export async function fetchIssuesByJQL(
  config: JiraConnectionConfig,
  jql: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<JiraIssue[]> {
  const allIssues: JiraIssue[] = []
  let startAt = 0
  const maxResults = 50 // Jira Cloud default max is 100, using 50 for stability

  const fields = [
    'summary', 'description', 'status', 'assignee', 'reporter',
    'priority', 'labels', 'issuetype', 'comment', 'created', 'updated',
    'resolution', 'customfield_10016', // story points (common field)
    'sprint', 'parent' // for epic link
  ].join(',')

  while (true) {
    const data: JiraSearchResponse = await jiraFetch(config, '/rest/api/3/search', {
      method: 'POST',
      body: {
        jql,
        startAt,
        maxResults,
        fields: fields.split(','),
        expand: ['names']
      }
    })

    for (const issue of data.issues) {
      allIssues.push(parseIssue(issue))
    }

    onProgress?.(allIssues.length, data.total)

    if (allIssues.length >= data.total || data.issues.length === 0) break
    startAt += data.issues.length

    // Small delay to avoid rate limits
    await sleep(100)
  }

  return allIssues
}

/**
 * Fetch all issues in a project
 */
export async function fetchProjectIssues(
  config: JiraConnectionConfig,
  projectKey: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<JiraIssue[]> {
  return fetchIssuesByJQL(config, `project = "${projectKey}" ORDER BY updated DESC`, onProgress)
}

/**
 * Fetch issues in a specific sprint
 */
export async function fetchSprintIssues(
  config: JiraConnectionConfig,
  sprintId: number,
  onProgress?: (fetched: number, total: number) => void
): Promise<JiraIssue[]> {
  return fetchIssuesByJQL(config, `sprint = ${sprintId} ORDER BY rank ASC`, onProgress)
}

/**
 * Fetch backlog issues (not in any sprint)
 */
export async function fetchBacklogIssues(
  config: JiraConnectionConfig,
  projectKey: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<JiraIssue[]> {
  return fetchIssuesByJQL(
    config,
    `project = "${projectKey}" AND sprint is EMPTY ORDER BY created DESC`,
    onProgress
  )
}

// ============================
// Fetch Single Issue by Key
// ============================

/**
 * Fetch a single Jira issue by key (e.g., 'WIN-4983').
 * Used by chat flow to auto-fetch ticket content when user pastes a Jira URL.
 */
export async function fetchSingleIssue(
  config: JiraConnectionConfig,
  issueKey: string
): Promise<JiraIssue> {
  const fields = [
    'summary', 'description', 'status', 'assignee', 'reporter',
    'priority', 'labels', 'issuetype', 'comment', 'created', 'updated',
    'resolution', 'customfield_10016', 'sprint', 'parent'
  ].join(',')

  const data = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}&expand=names`)
  return parseIssue(data)
}

/**
 * Extract Jira issue keys from a message that contains Atlassian URLs.
 * Matches patterns like:
 *   https://mysite.atlassian.net/browse/WIN-4983
 *   https://mysite.atlassian.net/browse/PROJ-123
 * Returns array of { siteUrl, issueKey } for each matched URL.
 */
export function extractJiraReferences(text: string): Array<{ siteUrl: string; issueKey: string }> {
  const results: Array<{ siteUrl: string; issueKey: string }> = []
  const seen = new Set<string>()

  const browseRegex = /https?:\/\/([\w.-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9]+-\d+)/gi
  let match: RegExpExecArray | null
  while ((match = browseRegex.exec(text)) !== null) {
    const key = match[2].toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ siteUrl: `https://${match[1]}`, issueKey: key })
    }
  }

  const selectedIssueRegex = /https?:\/\/([\w.-]+\.atlassian\.net)\/.*[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/gi
  while ((match = selectedIssueRegex.exec(text)) !== null) {
    const key = match[2].toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ siteUrl: `https://${match[1]}`, issueKey: key })
    }
  }

  const boardIssueRegex = /https?:\/\/([\w.-]+\.atlassian\.net)\/.*?\/([A-Z][A-Z0-9]+-\d+)(?:\?|$|#|\s)/gi
  while ((match = boardIssueRegex.exec(text)) !== null) {
    const key = match[2].toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ siteUrl: `https://${match[1]}`, issueKey: key })
    }
  }

  return results
}

// ============================
// Issue Parsing
// ============================

function parseIssue(raw: any): JiraIssue {
  const fields = raw.fields || {}

  // Extract sprint name from sprint field (can be array or object)
  let sprintName: string | null = null
  const sprintField = fields.sprint
  if (sprintField) {
    sprintName = sprintField.name || null
  }

  // Extract epic info from parent (Jira next-gen) or customfield
  let epicKey: string | null = null
  let epicName: string | null = null
  if (fields.parent) {
    epicKey = fields.parent.key || null
    epicName = fields.parent.fields?.summary || null
  }

  // Extract comments
  const comments: JiraComment[] = []
  const commentData = fields.comment?.comments || []
  for (const c of commentData) {
    comments.push({
      author: c.author?.displayName || c.author?.emailAddress || 'Unknown',
      body: adfToPlainText(c.body),
      created: c.created
    })
  }

  return {
    key: raw.key,
    summary: fields.summary || '',
    description: adfToPlainText(fields.description),
    status: fields.status?.name || 'Unknown',
    statusCategory: fields.status?.statusCategory?.name || 'Unknown',
    assignee: fields.assignee?.displayName || null,
    reporter: fields.reporter?.displayName || null,
    priority: fields.priority?.name || 'None',
    labels: fields.labels || [],
    issueType: fields.issuetype?.name || 'Task',
    sprintName,
    epicKey,
    epicName,
    comments,
    created: fields.created || '',
    updated: fields.updated || '',
    resolution: fields.resolution?.name || null,
    storyPoints: fields.customfield_10016 ?? null
  }
}

// ============================
// ADF (Atlassian Document Format) → Plain Text
// ============================

/**
 * Recursively extract plain text from ADF JSON.
 *
 * ADF structure:
 * {
 *   "type": "doc",
 *   "content": [
 *     { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] },
 *     { "type": "heading", "attrs": { "level": 2 }, "content": [...] },
 *     { "type": "codeBlock", "attrs": { "language": "js" }, "content": [...] },
 *     { "type": "bulletList", "content": [{ "type": "listItem", ... }] },
 *     ...
 *   ]
 * }
 */
export function adfToPlainText(adf: any): string {
  if (!adf) return ''
  if (typeof adf === 'string') return adf

  const parts: string[] = []
  extractText(adf, parts)
  return parts.join('').trim()
}

function extractText(node: any, parts: string[]): void {
  if (!node) return

  // Text node — the leaf
  if (node.type === 'text') {
    parts.push(node.text || '')
    return
  }

  // Hard break
  if (node.type === 'hardBreak') {
    parts.push('\n')
    return
  }

  // Emoji
  if (node.type === 'emoji') {
    parts.push(node.attrs?.shortName || '')
    return
  }

  // Mention
  if (node.type === 'mention') {
    parts.push(`@${node.attrs?.text || 'user'}`)
    return
  }

  // InlineCard (Jira issue link, etc.)
  if (node.type === 'inlineCard') {
    parts.push(node.attrs?.url || '')
    return
  }

  // Media — skip binary content
  if (node.type === 'media' || node.type === 'mediaGroup' || node.type === 'mediaSingle') {
    parts.push('[media]')
    return
  }

  // Table
  if (node.type === 'table') {
    const rows = node.content || []
    for (const row of rows) {
      const cells = row.content || []
      const cellTexts: string[] = []
      for (const cell of cells) {
        const cellParts: string[] = []
        extractText(cell, cellParts)
        cellTexts.push(cellParts.join('').trim())
      }
      parts.push(cellTexts.join(' | ') + '\n')
    }
    return
  }

  // Recurse into children
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      extractText(child, parts)
    }
  }

  // Add appropriate separators based on block type
  const blockTypes = [
    'paragraph', 'heading', 'codeBlock', 'blockquote',
    'bulletList', 'orderedList', 'listItem', 'rule',
    'panel', 'expand', 'taskList', 'taskItem',
    'decisionList', 'decisionItem'
  ]

  if (blockTypes.includes(node.type)) {
    parts.push('\n')
  }

  // Code block — add language marker
  if (node.type === 'codeBlock' && node.attrs?.language) {
    // Already added children above, just mark it
  }

  // List items — add bullet prefix
  if (node.type === 'listItem') {
    // Prepend bullet marker
    const lastIdx = parts.length - 1
    if (lastIdx >= 0 && parts[lastIdx] === '\n') {
      parts.splice(lastIdx, 0, '• ')
    }
  }
}

// ============================
// Chunk Jira Issues for Brain
// ============================

/**
 * Convert a Jira issue to a text chunk suitable for embedding.
 * Each issue becomes one chunk with rich metadata.
 */
export function issueToChunkContent(issue: JiraIssue): string {
  const lines: string[] = [
    `[${issue.key}] ${issue.summary}`,
    `Type: ${issue.issueType} | Status: ${issue.status} | Priority: ${issue.priority}`,
  ]

  if (issue.assignee) lines.push(`Assignee: ${issue.assignee}`)
  if (issue.reporter) lines.push(`Reporter: ${issue.reporter}`)
  if (issue.labels.length > 0) lines.push(`Labels: ${issue.labels.join(', ')}`)
  if (issue.sprintName) lines.push(`Sprint: ${issue.sprintName}`)
  if (issue.epicName) lines.push(`Epic: ${issue.epicName} (${issue.epicKey})`)
  if (issue.storyPoints) lines.push(`Story Points: ${issue.storyPoints}`)
  if (issue.resolution) lines.push(`Resolution: ${issue.resolution}`)

  lines.push(`Created: ${issue.created} | Updated: ${issue.updated}`)

  if (issue.description) {
    lines.push('', '--- Description ---', issue.description)
  }

  if (issue.comments.length > 0) {
    lines.push('', '--- Comments ---')
    for (const comment of issue.comments.slice(0, 20)) { // Cap at 20 comments
      lines.push(`[${comment.author} - ${comment.created}]`)
      lines.push(comment.body)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Convert a sprint to a text chunk for embedding.
 */
export function sprintToChunkContent(sprint: JiraSprint, issues: JiraIssue[]): string {
  const lines: string[] = [
    `Sprint: ${sprint.name}`,
    `State: ${sprint.state}`,
  ]

  if (sprint.goal) lines.push(`Goal: ${sprint.goal}`)
  if (sprint.startDate) lines.push(`Start: ${sprint.startDate}`)
  if (sprint.endDate) lines.push(`End: ${sprint.endDate}`)

  lines.push(`Issues: ${issues.length}`)

  // Summary of issues in sprint
  const byStatus: Record<string, string[]> = {}
  for (const issue of issues) {
    if (!byStatus[issue.status]) byStatus[issue.status] = []
    byStatus[issue.status].push(`${issue.key}: ${issue.summary}`)
  }

  for (const [status, items] of Object.entries(byStatus)) {
    lines.push(`\n[${status}]`)
    for (const item of items) {
      lines.push(`  • ${item}`)
    }
  }

  return lines.join('\n')
}

// ============================
// Helpers
// ============================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
