import { readFileSync } from 'fs'
import { extname } from 'path'

export interface StreamInfo {
  readonly extension: string
  readonly mimetype: string
  readonly filename: string
  readonly sizeBytes: number
}

export interface DocumentConverterResult {
  readonly markdown: string
  readonly metadata: Record<string, string | number | undefined>
}

export interface DocumentConverter {
  readonly priority: number
  accepts(info: StreamInfo): boolean
  convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult>
}

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.html', '.htm'])

export function isDocumentFile(filePath: string): boolean {
  return DOCUMENT_EXTENSIONS.has(extname(filePath).toLowerCase())
}

class PdfConverter implements DocumentConverter {
  readonly priority = 0

  accepts(info: StreamInfo): boolean {
    return info.extension === '.pdf'
  }

  async convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFParse } = require('pdf-parse') as {
        PDFParse: new (opts: { data: Buffer }) => {
          getText(params?: Record<string, unknown>): Promise<{ text: string; total: number }>
          getInfo(params?: Record<string, unknown>): Promise<{ info: Record<string, string> }>
        }
      }
      const buffer = readFileSync(filePath)
      const parser = new PDFParse({ data: buffer })
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => ({ info: {} as Record<string, string> }))
      ])
      const data = {
        text: textResult.text,
        numpages: textResult.total,
        info: infoResult.info as Record<string, string>
      }

      const lines = data.text.split('\n')
      const cleaned = lines
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n')

      return {
        markdown: cleaned,
        metadata: {
          sourceFormat: 'pdf',
          pageCount: data.numpages,
          title: data.info?.Title || undefined,
          author: data.info?.Author || undefined,
          filename: info.filename
        }
      }
    } catch (err) {
      return {
        markdown: `[PDF conversion failed: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceFormat: 'pdf', filename: info.filename, conversionError: 'true' }
      }
    }
  }
}

class DocxConverter implements DocumentConverter {
  readonly priority = 0

  accepts(info: StreamInfo): boolean {
    return info.extension === '.docx'
  }

  async convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult> {
    try {
      const mammoth = await import('mammoth')
      const TurndownService = (await import('turndown')).default
      const htmlResult = await mammoth.convertToHtml({ path: filePath })
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
      const markdown = td.turndown(htmlResult.value)

      return {
        markdown,
        metadata: {
          sourceFormat: 'docx',
          filename: info.filename,
          warnings: htmlResult.messages.length > 0 ? htmlResult.messages.length : undefined
        }
      }
    } catch (err) {
      return {
        markdown: `[DOCX conversion failed: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceFormat: 'docx', filename: info.filename, conversionError: 'true' }
      }
    }
  }
}

class XlsxConverter implements DocumentConverter {
  readonly priority = 0

  accepts(info: StreamInfo): boolean {
    return info.extension === '.xlsx' || info.extension === '.xls'
  }

  async convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult> {
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.readFile(filePath)
      const sections: string[] = []

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        const rows = csv.split('\n').filter(r => r.trim().length > 0)

        if (rows.length === 0) continue

        const headers = rows[0].split(',').map(h => h.trim())
        const dataRows = rows.slice(1)

        const headerRow = `| ${headers.join(' | ')} |`
        const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`
        const tableRows = dataRows.map(row => {
          const cols = row.split(',').map(c => c.trim())
          while (cols.length < headers.length) cols.push('')
          return `| ${cols.join(' | ')} |`
        })

        sections.push(`## Sheet: ${sheetName}\n\n${[headerRow, separatorRow, ...tableRows].join('\n')}`)
      }

      return {
        markdown: sections.join('\n\n'),
        metadata: {
          sourceFormat: info.extension === '.xls' ? 'xls' : 'xlsx',
          sheetCount: workbook.SheetNames.length,
          sheetNames: workbook.SheetNames.join(', '),
          filename: info.filename
        }
      }
    } catch (err) {
      return {
        markdown: `[XLSX conversion failed: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceFormat: 'xlsx', filename: info.filename, conversionError: 'true' }
      }
    }
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

class CsvConverter implements DocumentConverter {
  readonly priority = 0

  accepts(info: StreamInfo): boolean {
    return info.extension === '.csv'
  }

  async convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult> {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim().length > 0)

      if (lines.length === 0) {
        return { markdown: '(empty CSV)', metadata: { sourceFormat: 'csv', filename: info.filename } }
      }

      const headers = parseCsvLine(lines[0])
      const headerRow = `| ${headers.join(' | ')} |`
      const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`
      const dataRows = lines.slice(1).map(line => {
        const cols = parseCsvLine(line)
        while (cols.length < headers.length) cols.push('')
        return `| ${cols.join(' | ')} |`
      })

      return {
        markdown: [headerRow, separatorRow, ...dataRows].join('\n'),
        metadata: {
          sourceFormat: 'csv',
          rowCount: dataRows.length,
          columnCount: headers.length,
          filename: info.filename
        }
      }
    } catch (err) {
      return {
        markdown: `[CSV conversion failed: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceFormat: 'csv', filename: info.filename, conversionError: 'true' }
      }
    }
  }
}

class HtmlConverter implements DocumentConverter {
  readonly priority = 5

  accepts(info: StreamInfo): boolean {
    return info.extension === '.html' || info.extension === '.htm'
  }

  async convert(filePath: string, info: StreamInfo): Promise<DocumentConverterResult> {
    try {
      const TurndownService = (await import('turndown')).default
      const html = readFileSync(filePath, 'utf-8')

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : undefined

      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
      })

      const markdown = td.turndown(html)

      return {
        markdown,
        metadata: {
          sourceFormat: 'html',
          title,
          filename: info.filename
        }
      }
    } catch (err) {
      return {
        markdown: `[HTML conversion failed: ${err instanceof Error ? err.message : String(err)}]`,
        metadata: { sourceFormat: 'html', filename: info.filename, conversionError: 'true' }
      }
    }
  }
}

const CONVERTERS: DocumentConverter[] = [
  new PdfConverter(),
  new DocxConverter(),
  new XlsxConverter(),
  new CsvConverter(),
  new HtmlConverter()
].sort((a, b) => a.priority - b.priority)

export async function convertDocument(filePath: string): Promise<DocumentConverterResult | null> {
  const ext = extname(filePath).toLowerCase()
  const filename = filePath.split('/').pop() ?? filePath
  const info: StreamInfo = {
    extension: ext,
    mimetype: getMimetype(ext),
    filename,
    sizeBytes: 0
  }

  for (const converter of CONVERTERS) {
    if (converter.accepts(info)) {
      console.log(`[DocumentConverter] Converting ${filename} (${ext}) via ${converter.constructor.name}`)
      return converter.convert(filePath, info)
    }
  }

  return null
}

function getMimetype(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.htm': 'text/html'
  }
  return map[ext] ?? 'application/octet-stream'
}
