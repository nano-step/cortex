import { getProxyUrl, getProxyKey } from '../settings-service'
import { getTrainingModel } from '../training/training-model'
import { scanText, type SecretFinding } from './secret-scanner'

export interface SecurityAuditResult {
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  score: number
  secretFindings: SecretFinding[]
  redTeamFindings: string[]
  blueTeamDefenses: string[]
  auditorSummary: string
  recommendations: string[]
}

async function callAgent(role: string, systemPrompt: string, content: string): Promise<string> {
  try {
    const response = await fetch(`${getProxyUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getProxyKey()}` },
      body: JSON.stringify({
        model: getTrainingModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 2048
      }),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) return `[${role}] Error: ${response.status}`
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content || `[${role}] No response`
  } catch (err) {
    return `[${role}] Failed: ${(err as Error).message}`
  }
}

export async function runSecurityAudit(
  configContent: string,
  source: string = 'config'
): Promise<SecurityAuditResult> {
  const secretFindings = scanText(configContent, source)

  const [redTeamResult, blueTeamResult] = await Promise.all([
    callAgent(
      'Red Team',
      `You are a Red Team security researcher. Your job is to find vulnerabilities, exploit chains, and attack vectors in AI agent configurations.
Analyze the provided configuration and report:
1. Each vulnerability found (numbered list)
2. Potential exploit chains (how multiple issues combine)
3. Severity rating for each (CRITICAL/HIGH/MEDIUM/LOW)
Be aggressive — assume a skilled attacker.`,
      `Analyze this AI agent configuration for vulnerabilities:\n\n${configContent.slice(0, 4000)}`
    ),
    callAgent(
      'Blue Team',
      `You are a Blue Team security defender. Your job is to evaluate protections and identify defense gaps in AI agent configurations.
Analyze the provided configuration and report:
1. Existing security controls found
2. Missing protections that should be present
3. Defense recommendations (prioritized)
Be thorough — assume the config will face real attacks.`,
      `Evaluate the security posture of this AI agent configuration:\n\n${configContent.slice(0, 4000)}`
    )
  ])

  const auditorResult = await callAgent(
    'Auditor',
    `You are a Security Auditor synthesizing Red Team and Blue Team reports into a final assessment.
Given both reports, produce:
1. A letter grade (A-F) based on overall security posture
2. A numeric score (0-100)
3. Top 5 prioritized recommendations
4. One-paragraph executive summary
Format your response as:
GRADE: [letter]
SCORE: [number]
SUMMARY: [paragraph]
RECOMMENDATIONS:
1. [rec1]
2. [rec2]
...`,
    `SECRET SCAN: ${secretFindings.length} findings (${secretFindings.filter(f => f.severity === 'critical').length} critical)\n\nRED TEAM REPORT:\n${redTeamResult.slice(0, 2000)}\n\nBLUE TEAM REPORT:\n${blueTeamResult.slice(0, 2000)}`
  )

  const grade = extractGrade(auditorResult)
  const score = extractScore(auditorResult)
  const recommendations = extractRecommendations(auditorResult)

  return {
    grade,
    score,
    secretFindings,
    redTeamFindings: redTeamResult.split('\n').filter(l => l.trim().length > 0),
    blueTeamDefenses: blueTeamResult.split('\n').filter(l => l.trim().length > 0),
    auditorSummary: auditorResult,
    recommendations
  }
}

function extractGrade(text: string): SecurityAuditResult['grade'] {
  const match = text.match(/GRADE:\s*([A-F])/i)
  return (match?.[1]?.toUpperCase() as SecurityAuditResult['grade']) || 'C'
}

function extractScore(text: string): number {
  const match = text.match(/SCORE:\s*(\d+)/i)
  return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : 50
}

function extractRecommendations(text: string): string[] {
  const section = text.split(/RECOMMENDATIONS?:/i)[1]
  if (!section) return []
  return section.split('\n')
    .map(l => l.replace(/^\d+[.)]\s*/, '').trim())
    .filter(l => l.length > 10)
    .slice(0, 10)
}

export function formatAuditResult(result: SecurityAuditResult): string {
  const gradeEmoji: Record<string, string> = { A: '🟢', B: '🔵', C: '🟡', D: '🟠', F: '🔴' }
  const lines = [
    `${gradeEmoji[result.grade] || '⚪'} Security Grade: ${result.grade} (${result.score}/100)`,
    '',
    `Secrets Found: ${result.secretFindings.length} (${result.secretFindings.filter(f => f.severity === 'critical').length} critical)`,
    `Red Team Issues: ${result.redTeamFindings.length}`,
    `Blue Team Controls: ${result.blueTeamDefenses.length}`,
    '',
    '## Recommendations',
    ...result.recommendations.map((r, i) => `${i + 1}. ${r}`)
  ]
  return lines.join('\n')
}
