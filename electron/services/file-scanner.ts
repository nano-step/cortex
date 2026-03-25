import { readdir, stat, readFile } from 'fs/promises'
import { join, extname, basename, relative } from 'path'

export interface ScannedFile {
  path: string
  relativePath: string
  extension: string
  language: string
  size: number
  lastModified: number
}

// Language detection by extension
const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.dockerfile': 'dockerfile',
  '.prisma': 'prisma',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.tf': 'terraform',
  '.lua': 'lua',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.zig': 'zig',
  '.dart': 'dart',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.csv': 'csv',
  '.htm': 'html'
}

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.html', '.htm'])
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

// Directories to always skip
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  'vendor',
  '.gradle',
  '.idea',
  '.vscode',
  '.DS_Store',
  'coverage',
  '.turbo',
  '.cache',
  'tmp',
  '.tmp',
  'logs'
])

// Files to always skip
const SKIP_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock'
])

// Max file size to process (500KB)
const MAX_FILE_SIZE = 500 * 1024

// Important config files that don't have typical code extensions
const IMPORTANT_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  'README.md',
  'CHANGELOG.md',
  'Makefile',
  'Cargo.toml',
  'go.mod',
  'requirements.txt',
  'Pipfile',
  'Gemfile',
  'build.gradle',
  'pom.xml',
  '.eslintrc.json',
  '.prettierrc',
  'jest.config.js',
  'jest.config.ts',
  'vite.config.ts',
  'webpack.config.js',
  'next.config.js',
  'next.config.mjs',
  'tailwind.config.ts',
  'tailwind.config.js',
  'prisma/schema.prisma'
])

export async function scanDirectory(
  rootPath: string,
  maxFiles: number = 5000
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []

  async function walk(dirPath: string): Promise<void> {
    if (files.length >= maxFiles) return

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return // Permission denied or other error
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath)
        }
        continue
      }

      if (!entry.isFile()) continue
      if (SKIP_FILES.has(entry.name)) continue

      const ext = extname(entry.name).toLowerCase()
      const language = EXTENSION_MAP[ext]
      const isImportantFile = IMPORTANT_FILES.has(entry.name) ||
        IMPORTANT_FILES.has(relative(rootPath, fullPath))

      // Only process files we know how to parse, or important config files
      if (!language && !isImportantFile) continue

      try {
        const fileStat = await stat(fullPath)
        const sizeLimit = DOCUMENT_EXTENSIONS.has(ext) ? MAX_DOCUMENT_SIZE : MAX_FILE_SIZE
        if (fileStat.size > sizeLimit) continue
        if (fileStat.size === 0) continue

        files.push({
          path: fullPath,
          relativePath: relative(rootPath, fullPath),
          extension: ext,
          language: language || detectLanguageByName(entry.name),
          size: fileStat.size,
          lastModified: fileStat.mtimeMs
        })
      } catch {
        // Skip files we can't stat
      }
    }
  }

  await walk(rootPath)
  return files
}

function detectLanguageByName(filename: string): string {
  const name = basename(filename).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  if (name.startsWith('.env')) return 'env'
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml'
  if (name.endsWith('.md')) return 'markdown'
  return 'text'
}

export async function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}

/**
 * Get a summary of the project structure (directory tree)
 */
export async function getDirectoryTree(
  rootPath: string,
  maxDepth: number = 4
): Promise<string> {
  const lines: string[] = []

  async function walk(dirPath: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      lines.push(`${prefix}...`)
      return
    }

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    // Sort: dirs first, then files
    const sorted = entries
      .filter((e) => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 30) // Limit entries per directory

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      const isLast = i === sorted.length - 1
      const connector = isLast ? '└── ' : '├── '
      const nextPrefix = isLast ? '    ' : '│   '

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`)
        await walk(join(dirPath, entry.name), prefix + nextPrefix, depth + 1)
      } else {
        lines.push(`${prefix}${connector}${entry.name}`)
      }
    }

    if (entries.length > 30) {
      lines.push(`${prefix}... (${entries.length - 30} more)`)
    }
  }

  lines.push(basename(rootPath) + '/')
  await walk(rootPath, '', 0)
  return lines.join('\n')
}
