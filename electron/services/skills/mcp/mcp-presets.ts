export interface MCPPresetEnvVar {
  name: string
  label: string
  placeholder: string
  encrypted: boolean
  required: boolean
}

export interface MCPPreset {
  id: string
  name: string
  description: string
  npmPackage: string
  command: string
  args: string[]
  envVars: MCPPresetEnvVar[]
  transport: 'stdio' | 'sse'
  /** For SSE/Streamable HTTP transport — the remote server URL */
  serverUrl?: string
  category: 'dev' | 'search' | 'productivity' | 'data' | 'utility' | 'research'
  iconName: string
}

export const MCP_PRESETS: MCPPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Access repositories, issues, PRs, and code search',
    npmPackage: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envVars: [
      { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub Token', placeholder: 'ghp_xxxxxxxxxxxx', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'dev',
    iconName: 'Github'
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and manage local files and directories',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    envVars: [
      { name: 'ALLOWED_PATHS', label: 'Allowed Paths', placeholder: '/Users/you/projects,/tmp', encrypted: false, required: true }
    ],
    transport: 'stdio',
    category: 'utility',
    iconName: 'FolderOpen'
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search using Brave Search API',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envVars: [
      { name: 'BRAVE_API_KEY', label: 'Brave API Key', placeholder: 'BSA_xxxxxxxxxxxx', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'search',
    iconName: 'Search'
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Location search, directions, and place details',
    npmPackage: '@modelcontextprotocol/server-google-maps',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    envVars: [
      { name: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API Key', placeholder: 'AIza...', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'search',
    iconName: 'MapPin'
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and send messages, manage channels',
    npmPackage: '@modelcontextprotocol/server-slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envVars: [
      { name: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token', placeholder: 'xoxb-...', encrypted: true, required: true },
      { name: 'SLACK_TEAM_ID', label: 'Slack Team ID', placeholder: 'T0123456789', encrypted: false, required: true }
    ],
    transport: 'stdio',
    category: 'productivity',
    iconName: 'MessageSquare'
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    npmPackage: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envVars: [
      { name: 'POSTGRES_CONNECTION_STRING', label: 'Connection String', placeholder: 'postgresql://user:pass@localhost:5432/db', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'data',
    iconName: 'Database'
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge graph memory for conversations',
    npmPackage: '@modelcontextprotocol/server-memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envVars: [],
    transport: 'stdio',
    category: 'utility',
    iconName: 'Brain'
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation, screenshots, and web scraping',
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    envVars: [],
    transport: 'stdio',
    category: 'dev',
    iconName: 'Globe'
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning and problem decomposition',
    npmPackage: '@modelcontextprotocol/server-sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    envVars: [],
    transport: 'stdio',
    category: 'utility',
    iconName: 'ListOrdered'
  },
  {
    id: 'tavily',
    name: 'Tavily Search',
    description: 'AI-optimized web search with full content extraction and contextual results',
    npmPackage: 'tavily-mcp',
    command: 'npx',
    args: ['-y', 'tavily-mcp'],
    envVars: [
      { name: 'TAVILY_API_KEY', label: 'Tavily API Key', placeholder: 'tvly-xxxxxxxxxxxx', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'research',
    iconName: 'SearchCheck'
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping, crawling, and structured data extraction — reads JS-rendered pages',
    npmPackage: 'firecrawl-mcp',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp'],
    envVars: [
      { name: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', placeholder: 'fc-xxxxxxxxxxxx', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'research',
    iconName: 'Flame'
  },
  {
    id: 'exa',
    name: 'Exa Search',
    description: 'Semantic web search with content crawling — finds pages by meaning, not just keywords',
    npmPackage: 'exa-mcp-server',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    envVars: [
      { name: 'EXA_API_KEY', label: 'Exa API Key', placeholder: 'exa-xxxxxxxxxxxx', encrypted: true, required: true }
    ],
    transport: 'stdio',
    category: 'research',
    iconName: 'Radar'
  },
  {
    id: 'universal-image',
    name: 'Universal Image Gen',
    description: 'Multi-provider AI image generation — AWS Bedrock, OpenAI GPT Image, Google Gemini/Imagen 4. Generate, transform, and edit images.',
    npmPackage: 'universal-image-mcp',
    command: 'uvx',
    args: ['universal-image-mcp@latest'],
    envVars: [
      { name: 'ENABLE_GEMINI', label: 'Enable Gemini', placeholder: 'true', encrypted: false, required: false },
      { name: 'GEMINI_API_KEY', label: 'Gemini API Key', placeholder: 'AIza...', encrypted: true, required: false },
      { name: 'ENABLE_OPENAI', label: 'Enable OpenAI', placeholder: 'true', encrypted: false, required: false },
      { name: 'OPENAI_API_KEY', label: 'OpenAI API Key', placeholder: 'sk-...', encrypted: true, required: false },
      { name: 'ENABLE_AWS', label: 'Enable AWS Bedrock', placeholder: 'true', encrypted: false, required: false },
      { name: 'AWS_REGION', label: 'AWS Region', placeholder: 'us-east-1', encrypted: false, required: false }
    ],
    transport: 'stdio',
    category: 'utility',
    iconName: 'Palette'
  },
  {
    id: 'jina-reader',
    name: 'Jina AI Reader',
    description: 'Read URLs, web search, image search, arXiv, screenshots — 19 research tools via remote MCP',
    npmPackage: 'jina-mcp',
    command: '',
    args: [],
    serverUrl: 'https://mcp.jina.ai/v1',
    envVars: [
      { name: 'JINA_API_KEY', label: 'Jina API Key (optional, free tier)', placeholder: 'jina_xxxxxxxxxxxx', encrypted: true, required: false }
    ],
    transport: 'sse',
    category: 'research',
    iconName: 'FileText'
  }
]

export function getPresets(): MCPPreset[] {
  return MCP_PRESETS
}

export function getPresetById(id: string): MCPPreset | undefined {
  return MCP_PRESETS.find(p => p.id === id)
}

export function getPresetsByCategory(category: MCPPreset['category']): MCPPreset[] {
  return MCP_PRESETS.filter(p => p.category === category)
}
