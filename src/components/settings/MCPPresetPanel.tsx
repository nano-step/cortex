import { useState, useEffect } from 'react'
import {
  Github, FolderOpen, Search, MapPin, MessageSquare,
  Database, Brain, Globe, ListOrdered, Download,
  Sparkles, SearchCheck, Flame, Radar, FileText,
  CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronRight,
  Eye, EyeOff
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useMCPStore, type MCPPresetInfo } from '../../stores/mcpStore'

const ICON_MAP: Record<string, React.ElementType> = {
  Github, FolderOpen, Search, MapPin, MessageSquare,
  Database, Brain, Globe, ListOrdered, Download,
  Sparkles, SearchCheck, Flame, Radar, FileText
}

const CATEGORY_LABELS: Record<string, string> = {
  research: 'Research & Deep Search',
  dev: 'Development',
  search: 'Search',
  productivity: 'Productivity',
  data: 'Data',
  utility: 'Utility'
}

const CATEGORY_ORDER = ['research', 'dev', 'search', 'productivity', 'data', 'utility']

function PresetCard({ preset }: { preset: MCPPresetInfo }) {
  const { installPreset, installingPreset } = useMCPStore()
  const [expanded, setExpanded] = useState(false)
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  const Icon = ICON_MAP[preset.iconName] || Globe
  const installing = installingPreset === preset.id
  const hasEnvVars = preset.envVars.length > 0
  const allRequiredFilled = preset.envVars
    .filter(v => v.required)
    .every(v => envValues[v.name]?.trim())

  const handleInstall = async () => {
    await installPreset(preset.id, envValues)
    setExpanded(false)
    setEnvValues({})
  }

  return (
    <div className={cn(
      'border rounded-lg p-4 transition-colors',
      preset.connected ? 'border-green-500/30 bg-green-500/5' :
      preset.installed ? 'border-blue-500/30 bg-blue-500/5' :
      'border-zinc-700 hover:border-zinc-600'
    )}>
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => !preset.installed && setExpanded(!expanded)}
      >
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          preset.connected ? 'bg-green-500/20 text-green-400' :
          preset.installed ? 'bg-blue-500/20 text-blue-400' :
          'bg-zinc-800 text-zinc-400'
        )}>
          <Icon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{preset.name}</span>
            {preset.connected && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
            {preset.installed && !preset.connected && <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />}
          </div>
          <p className="text-xs text-zinc-500 truncate">{preset.description}</p>
        </div>

        {!preset.installed && (
          hasEnvVars ? (
            expanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => { e.stopPropagation(); handleInstall() }}
              disabled={installing}
            >
              {installing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Enable'}
            </Button>
          )
        )}

        {preset.installed && (
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full',
            preset.connected ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'
          )}>
            {preset.connected ? 'Connected' : 'Installed'}
          </span>
        )}
      </div>

      {expanded && hasEnvVars && !preset.installed && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
          {preset.envVars.map(envVar => (
            <div key={envVar.name}>
              <label className="text-xs text-zinc-400 mb-1 block">
                {envVar.label} {envVar.required && <span className="text-red-400">*</span>}
              </label>
              <div className="relative">
                <Input
                  type={envVar.encrypted && !showSecrets[envVar.name] ? 'password' : 'text'}
                  placeholder={envVar.placeholder}
                  value={envValues[envVar.name] || ''}
                  onChange={e => setEnvValues(prev => ({ ...prev, [envVar.name]: e.target.value }))}
                  className="pr-8 text-sm"
                />
                {envVar.encrypted && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    onClick={() => setShowSecrets(prev => ({ ...prev, [envVar.name]: !prev[envVar.name] }))}
                  >
                    {showSecrets[envVar.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={handleInstall}
            disabled={installing || !allRequiredFilled}
            className="w-full"
          >
            {installing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            {installing ? 'Installing...' : 'Enable & Connect'}
          </Button>
        </div>
      )}
    </div>
  )
}

export function MCPPresetPanel() {
  const { presets, loadPresets } = useMCPStore()

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  const categoriesSet = new Set(presets.map(p => p.category))
  const categories = CATEGORY_ORDER.filter(c => categoriesSet.has(c))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-1">MCP Server Presets</h3>
        <p className="text-xs text-zinc-500">Enable popular MCP servers with one click. Just add your API tokens.</p>
      </div>

      {categories.map(category => (
        <div key={category}>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
            {CATEGORY_LABELS[category] || category}
          </h4>
          <div className="space-y-2">
            {presets.filter(p => p.category === category).map(preset => (
              <PresetCard key={preset.id} preset={preset} />
            ))}
          </div>
        </div>
      ))}

      {presets.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading presets...
        </div>
      )}
    </div>
  )
}
