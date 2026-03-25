import { getDb } from '../db'

export interface CodemapEntry {
  filePath: string
  language: string
  exports: string[]
  lineCount: number
  chunkCount: number
}

export interface Codemap {
  projectId: string
  totalFiles: number
  totalChunks: number
  languages: Record<string, number>
  keyFiles: CodemapEntry[]
  generatedAt: number
}

export function generateCodemap(projectId: string, maxKeyFiles: number = 30): Codemap {
  const db = getDb()

  const files = db.prepare(`
    SELECT c.file_path, c.language, c.name, c.chunk_type, c.content,
           LENGTH(c.content) as content_length
    FROM chunks c
    JOIN repositories r ON c.repo_id = r.id
    WHERE r.project_id = ? AND c.chunk_type IN ('function', 'class', 'interface', 'method', 'export_block')
    ORDER BY c.file_path
  `).all(projectId) as Array<{
    file_path: string; language: string; name: string;
    chunk_type: string; content: string; content_length: number
  }>

  const fileMap = new Map<string, CodemapEntry>()
  const langCount: Record<string, number> = {}

  for (const chunk of files) {
    const entry = fileMap.get(chunk.file_path) || {
      filePath: chunk.file_path,
      language: chunk.language || 'unknown',
      exports: [],
      lineCount: 0,
      chunkCount: 0
    }

    entry.chunkCount++
    if (chunk.name && !entry.exports.includes(chunk.name)) {
      entry.exports.push(chunk.name)
    }
    entry.lineCount += chunk.content.split('\n').length

    fileMap.set(chunk.file_path, entry)
    langCount[entry.language] = (langCount[entry.language] || 0) + 1
  }

  const allEntries = Array.from(fileMap.values())
  const keyFiles = allEntries
    .sort((a, b) => b.exports.length - a.exports.length || b.chunkCount - a.chunkCount)
    .slice(0, maxKeyFiles)

  const totalChunks = db.prepare(
    'SELECT COUNT(*) as count FROM chunks c JOIN repositories r ON c.repo_id = r.id WHERE r.project_id = ?'
  ).get(projectId) as { count: number }

  return {
    projectId,
    totalFiles: fileMap.size,
    totalChunks: totalChunks.count,
    languages: langCount,
    keyFiles,
    generatedAt: Date.now()
  }
}

export function formatCodemapAsContext(codemap: Codemap, maxTokens: number = 2000): string {
  const lines: string[] = [
    '<codemap>',
    `Files: ${codemap.totalFiles} | Chunks: ${codemap.totalChunks} | Languages: ${Object.entries(codemap.languages).map(([l, c]) => `${l}(${c})`).join(', ')}`,
    ''
  ]

  let tokenEstimate = 0
  for (const file of codemap.keyFiles) {
    const line = `${file.filePath}: ${file.exports.slice(0, 8).join(', ')}${file.exports.length > 8 ? '...' : ''}`
    tokenEstimate += Math.ceil(line.length / 4)
    if (tokenEstimate > maxTokens) break
    lines.push(line)
  }

  lines.push('</codemap>')
  return lines.join('\n')
}
