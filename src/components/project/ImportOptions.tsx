import { FolderOpen, Github, Building } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ImportSourceType } from '../../types'

interface ImportOptionsProps {
  onSelectLocal: () => void
  onSelectGithub: () => void
  onSelectGithubOrg?: () => void
  selected: ImportSourceType | null
}

function OptionCard({ icon: Icon, title, subtitle, selected, onClick }: {
  icon: typeof FolderOpen
  title: string
  subtitle: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-3 p-5 rounded-xl border-2',
        'transition-all duration-200',
        'hover:shadow-md hover:-translate-y-0.5',
        selected
          ? 'border-[var(--accent-primary)] bg-[var(--accent-light)]'
          : 'border-[var(--border-primary)] bg-[var(--bg-input)] hover:border-[var(--border-input)]'
      )}
    >
      <div
        className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center',
          selected
            ? 'bg-[var(--accent-primary)] text-white'
            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
        )}
      >
        <Icon size={22} />
      </div>
      <div className="text-center">
        <div className="text-[14px] font-medium text-[var(--text-primary)]">{title}</div>
        <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">{subtitle}</div>
      </div>
    </button>
  )
}

export function ImportOptions({ onSelectLocal, onSelectGithub, onSelectGithubOrg, selected }: ImportOptionsProps) {
  return (
    <div className={cn('grid gap-3', onSelectGithubOrg ? 'grid-cols-3' : 'grid-cols-2')}>
      <OptionCard
        icon={FolderOpen}
        title="Từ máy tính"
        subtitle="Chọn folder dự án"
        selected={selected === 'local'}
        onClick={onSelectLocal}
      />
      <OptionCard
        icon={Github}
        title="Từ GitHub"
        subtitle="Nhập URL repository"
        selected={selected === 'github'}
        onClick={onSelectGithub}
      />
      {onSelectGithubOrg && (
        <OptionCard
          icon={Building}
          title="GitHub Org"
          subtitle="Import nhiều repo"
          selected={selected === 'github-org'}
          onClick={onSelectGithubOrg}
        />
      )}
    </div>
  )
}
