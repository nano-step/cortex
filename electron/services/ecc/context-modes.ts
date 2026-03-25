export type ContextMode = 'dev' | 'review' | 'research' | 'debug' | 'planning'

export interface ModeConfig {
  mode: ContextMode
  name: string
  systemPromptAddition: string
  enabledSkillCategories: string[]
  temperature: number
  focusAreas: string[]
}

const MODE_CONFIGS: Record<ContextMode, ModeConfig> = {
  dev: {
    mode: 'dev',
    name: 'Development',
    systemPromptAddition: `You are in DEVELOPMENT mode. Focus on:
- Writing clean, tested code following project conventions
- TDD: write failing test → implement → verify
- Keep changes minimal and focused
- Always run linting and type-checking after edits`,
    enabledSkillCategories: ['coding', 'testing', 'learning'],
    temperature: 0.3,
    focusAreas: ['implementation', 'testing', 'code-quality']
  },
  review: {
    mode: 'review',
    name: 'Code Review',
    systemPromptAddition: `You are in CODE REVIEW mode. Focus on:
- Quality, security, and maintainability analysis
- Pattern consistency with existing codebase
- Performance implications and edge cases
- NEVER modify code directly — only suggest improvements`,
    enabledSkillCategories: ['review', 'security'],
    temperature: 0.2,
    focusAreas: ['security', 'patterns', 'performance', 'readability']
  },
  research: {
    mode: 'research',
    name: 'Research & Exploration',
    systemPromptAddition: `You are in RESEARCH mode. Focus on:
- Deep exploration before any implementation
- Search documentation and codebase thoroughly
- Compare multiple approaches with pros/cons
- Do NOT write code — only research and recommend`,
    enabledSkillCategories: ['search', 'analysis'],
    temperature: 0.5,
    focusAreas: ['documentation', 'architecture', 'alternatives']
  },
  debug: {
    mode: 'debug',
    name: 'Debugging',
    systemPromptAddition: `You are in DEBUG mode. Focus on:
- Root cause analysis, not symptom treatment
- Reproduce the issue first, then fix
- Minimal changes — fix the bug, don't refactor
- Verify the fix doesn't introduce regressions`,
    enabledSkillCategories: ['debugging', 'testing'],
    temperature: 0.1,
    focusAreas: ['error-analysis', 'reproduction', 'minimal-fix']
  },
  planning: {
    mode: 'planning',
    name: 'Planning & Architecture',
    systemPromptAddition: `You are in PLANNING mode. Focus on:
- System design and architecture decisions
- Break down complex tasks into atomic steps
- Identify dependencies and risks
- Create clear implementation roadmaps
- Do NOT implement — only plan and design`,
    enabledSkillCategories: ['architecture', 'analysis'],
    temperature: 0.4,
    focusAreas: ['architecture', 'decomposition', 'risk-analysis']
  }
}

let activeMode: ContextMode = 'dev'

export function setContextMode(mode: ContextMode): ModeConfig {
  activeMode = mode
  console.log(`[ContextModes] Switched to ${MODE_CONFIGS[mode].name} mode`)
  return MODE_CONFIGS[mode]
}

export function getContextMode(): ContextMode {
  return activeMode
}

export function getModeConfig(mode?: ContextMode): ModeConfig {
  return MODE_CONFIGS[mode || activeMode]
}

export function getModePromptAddition(mode?: ContextMode): string {
  return MODE_CONFIGS[mode || activeMode].systemPromptAddition
}

export function getAllModes(): ModeConfig[] {
  return Object.values(MODE_CONFIGS)
}

export function getModeTemperature(mode?: ContextMode): number {
  return MODE_CONFIGS[mode || activeMode].temperature
}

export function getEnabledSkillCategories(mode?: ContextMode): string[] {
  return MODE_CONFIGS[mode || activeMode].enabledSkillCategories
}
