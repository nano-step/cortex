import type { IpcMain, BrowserWindow } from 'electron'
import { registerSkill, listSkills, activateSkill, deactivateSkill, executeSkill, getHealthReport, shutdownAll } from '../services/skills/skill-registry'
import { executeRouted } from '../services/skills/skill-router'
import { loadAndRegisterAll } from '../services/skills/skill-loader'
import { listMCPServers, addMCPServer, removeMCPServer, connectMCPServer, disconnectMCPServer, checkMCPServerHealth, shutdownAllMCP, ensureCoreMCPServers, autoConnectMCPServers, getToolDefinitions, executeMCPTool, getPresetStatuses, installPreset } from '../services/skills/mcp/mcp-manager'

export function registerSkillsIPC(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('agents:list', () => [
    { command: '/review', label: 'Code Review', description: 'Deep PR review với 4 perspectives (security, quality, performance, testing)', icon: 'Sparkles', skillName: 'pr-code-reviewer' },
    { command: '/pr-code-reviewer', label: 'PR Code Reviewer', description: 'Deep PR review — hỗ trợ GitHub PR URL', icon: 'Sparkles', skillName: 'pr-code-reviewer' },
    { command: '/security', label: 'Security Audit', description: 'Phân tích bảo mật và phát hiện lỗ hổng', icon: 'Shield', skillName: 'react-agent' },
    { command: '/performance', label: 'Performance', description: 'Profile hiệu suất và đề xuất tối ưu', icon: 'Gauge', skillName: 'performance-profiler' },
    { command: '/implement', label: 'Implement', description: 'Triển khai tính năng hoặc thay đổi code', icon: 'Code', skillName: 'react-agent' },
    { command: '/architect', label: 'Architecture', description: 'Phân tích và đề xuất kiến trúc hệ thống', icon: 'Blocks', skillName: 'react-agent' },
    { command: '/refactor', label: 'Refactor', description: 'Intelligent refactoring với LSP, AST-grep, và TDD verification', icon: 'Wrench', skillName: 'react-agent' },
    { command: '/playwright', label: 'Playwright', description: 'Browser automation — verification, scraping, testing, screenshots', icon: 'Globe', skillName: 'playwright-browser' },
    { command: '/frontend-ui-ux', label: 'Frontend UI/UX', description: 'UI/UX design — crafts stunning interfaces', icon: 'Palette', skillName: 'react-agent' },
    { command: '/git-master', label: 'Git Master', description: 'Git operations — atomic commits, rebase, squash, blame, bisect', icon: 'GitBranch', skillName: 'react-agent' },
    { command: '/dev-browser', label: 'Dev Browser', description: 'Browser automation với persistent page state', icon: 'Globe', skillName: 'playwright-browser' },
    { command: '/test', label: 'Test Generator', description: 'Tạo test cases tự động cho code', icon: 'FlaskConical', skillName: 'test-generator' },
    { command: '/rri-t-testing', label: 'RRI Testing', description: 'Testing framework và patterns', icon: 'FlaskConical', skillName: 'test-generator' },
    { command: '/nano-brain-init', label: 'Nano Brain Init', description: 'Initialize nano-brain persistent memory cho workspace', icon: 'Brain', skillName: 'session-memory' },
    { command: '/nano-brain-reindex', label: 'Nano Brain Reindex', description: 'Rescan codebase và refresh all indexes', icon: 'RefreshCw', skillName: 'session-memory' },
    { command: '/nano-brain-status', label: 'Nano Brain Status', description: 'Show nano-brain memory health và statistics', icon: 'Activity', skillName: 'session-memory' },
    { command: '/blog', label: 'Blog Writer', description: 'Draft SEO-optimized blog posts dựa trên project hiện tại', icon: 'PenLine', skillName: 'react-agent' },
    { command: '/idea', label: 'Idea Analyzer', description: 'Phân tích source code và tạo monetization strategy', icon: 'Lightbulb', skillName: 'react-agent' },
    { command: '/reddit', label: 'Reddit Post', description: 'Draft Reddit post tối ưu cho subreddit cụ thể', icon: 'MessageCircle', skillName: 'react-agent' },
    { command: '/team', label: 'Team Proposal', description: 'Phân tích feature/idea, tạo proposal với architecture và plan', icon: 'Users', skillName: 'react-agent' },
    { command: '/init-deep', label: 'Init Deep', description: 'Initialize hierarchical knowledge base', icon: 'Database', skillName: 'code-analysis' },
    { command: '/ralph-loop', label: 'Ralph Loop', description: 'Start self-referential development loop until completion', icon: 'Repeat', skillName: 'react-agent' },
    { command: '/ulw-loop', label: 'Ultrawork Loop', description: 'Start ultrawork loop — continues until completion', icon: 'Zap', skillName: 'react-agent' },
    { command: '/cancel-ralph', label: 'Cancel Ralph', description: 'Cancel active development loop', icon: 'XCircle', skillName: 'react-agent' },
    { command: '/start-work', label: 'Start Work', description: 'Start work session from plan', icon: 'Play', skillName: 'plan-execute' },
    { command: '/stop-continuation', label: 'Stop Continuation', description: 'Stop all continuation mechanisms', icon: 'Square', skillName: 'react-agent' },
    { command: '/handoff', label: 'Handoff', description: 'Create context summary for continuing in new session', icon: 'ArrowRightLeft', skillName: 'react-agent' },
    { command: '/migration', label: 'Migration Planner', description: 'Plan và execute codebase migration', icon: 'ArrowUpCircle', skillName: 'migration-planner' },
    { command: '/code-quality', label: 'Code Quality', description: 'Phân tích chất lượng code toàn diện', icon: 'CheckCircle', skillName: 'code-quality' },
    { command: '/dependency-audit', label: 'Dependency Audit', description: 'Audit dependencies cho security và updates', icon: 'Package', skillName: 'dependency-audit' },
    { command: '/api-contract', label: 'API Contract', description: 'Validate và generate API contracts', icon: 'FileJson', skillName: 'api-contract' },
    { command: '/diff-review', label: 'Diff Review', description: 'Review git diff với multi-perspective analysis', icon: 'GitCompare', skillName: 'diff-review' },
    { command: '/rtk-setup', label: 'RTK Setup', description: 'Redux Toolkit setup và enforcement', icon: 'Settings', skillName: 'react-agent' },
    { command: '/multi-agent', label: 'Multi-Agent', description: 'Phân tích toàn diện với 8 agents chuyên biệt', icon: 'Users', skillName: '__orchestrate__' },
    { command: '/perplexity', label: 'Perplexity Deep Search', description: 'Deep research với Perplexity Pro', icon: 'Search' },
    { command: '/agents', label: 'Agent Mode', description: 'Chọn agent mode (Sisyphus, Hephaestus, Prometheus, Atlas)', icon: 'Bot' },
  ])

  ipcMain.handle('skill:list', (_event, filter?: { category?: string, status?: string }) => listSkills(filter as any))
  ipcMain.handle('skill:activate', (_event, name: string) => activateSkill(name))
  ipcMain.handle('skill:deactivate', (_event, name: string) => deactivateSkill(name))
  ipcMain.handle('skill:execute', async (_event, name: string, input: any) => executeSkill(name, input))
  ipcMain.handle('skill:route', async (_event, input: any) => executeRouted(input))
  ipcMain.handle('skill:health', async () => {
    const report = await getHealthReport()
    return Object.entries(report).map(([name, status]) => ({ name, healthy: status.healthy, message: status.message }))
  })

  ipcMain.handle('mcp:list', () => listMCPServers())
  ipcMain.handle('mcp:add', (_event, config: { name: string; transportType: 'stdio' | 'sse'; command?: string; args?: string; serverUrl?: string; env?: string }) =>
    addMCPServer(config))
  ipcMain.handle('mcp:remove', (_event, id: string) => removeMCPServer(id))
  ipcMain.handle('mcp:connect', async (_event, id: string) => connectMCPServer(id))
  ipcMain.handle('mcp:disconnect', async (_event, id: string) => disconnectMCPServer(id))
  ipcMain.handle('mcp:health', async (_event, id: string) => checkMCPServerHealth(id))
  ipcMain.handle('mcp:getPresets', () => getPresetStatuses())
  ipcMain.handle('mcp:installPreset', async (_event, presetId: string, envValues: Record<string, string>) =>
    installPreset(presetId, envValues))
}
