const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'critical' | 'high' | 'medium' }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/gi, severity: 'critical' },
  { name: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, severity: 'critical' },
  { name: 'GitLab PAT', pattern: /glpat-[A-Za-z0-9_-]{20,}/g, severity: 'critical' },
  { name: 'Slack Token', pattern: /xox[bpors]-[A-Za-z0-9-]{10,}/g, severity: 'high' },
  { name: 'Stripe Key', pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g, severity: 'critical' },
  { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9]{20,}/g, severity: 'high' },
  { name: 'Private Key Block', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'critical' },
  { name: 'Generic API Key', pattern: /(?:api_key|apikey|api_secret)\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/gi, severity: 'medium' },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: 'medium' },
  { name: 'Database URL with Password', pattern: /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/gi, severity: 'high' },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/g, severity: 'medium' },
  { name: 'Anthropic Key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, severity: 'high' },
  { name: 'Google API Key', pattern: /AIza[A-Za-z0-9_-]{35}/g, severity: 'high' }
]

export interface SecretFinding {
  patternName: string
  severity: 'critical' | 'high' | 'medium'
  file: string
  line: number
  match: string
}

export function scanText(text: string, source: string = 'unknown'): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = text.split('\n')

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    for (const { name, pattern, severity } of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(line)) !== null) {
        const masked = match[0].slice(0, 8) + '***' + match[0].slice(-4)
        findings.push({ patternName: name, severity, file: source, line: lineNum + 1, match: masked })
      }
    }
  }

  return findings
}

export function scanFiles(files: Array<{ path: string; content: string }>): SecretFinding[] {
  const allFindings: SecretFinding[] = []
  for (const file of files) {
    const findings = scanText(file.content, file.path)
    allFindings.push(...findings)
  }
  return allFindings.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })
}

export function formatFindings(findings: SecretFinding[]): string {
  if (findings.length === 0) return '✅ No secrets detected.'

  const lines = [`⚠️ Found ${findings.length} potential secret(s):\n`]
  const grouped = new Map<string, SecretFinding[]>()
  for (const f of findings) {
    const key = f.severity
    const group = grouped.get(key) || []
    group.push(f)
    grouped.set(key, group)
  }

  for (const severity of ['critical', 'high', 'medium'] as const) {
    const group = grouped.get(severity) || []
    if (group.length === 0) continue
    const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : '🟡'
    lines.push(`${icon} ${severity.toUpperCase()} (${group.length}):`)
    for (const f of group) {
      lines.push(`  - ${f.patternName} in ${f.file}:${f.line} → ${f.match}`)
    }
  }

  return lines.join('\n')
}
