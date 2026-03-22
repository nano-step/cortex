import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Check, X } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { ImportOptions } from './ImportOptions'
import { useProjectStore } from '../../stores/projectStore'
import type { ImportSourceType } from '../../types'

interface OrgRepo {
  name: string
  fullName: string
  htmlUrl: string
  cloneUrl: string
  language: string | null
  isPrivate: boolean
  description: string | null
  defaultBranch: string
}

interface OrgImportProgress {
  current: number
  total: number
  repoName: string
  phase: string
}

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const [step, setStep] = useState(1)
  const [projectName, setProjectName] = useState('')
  const [sourceType, setSourceType] = useState<ImportSourceType | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [nameError, setNameError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [orgRepos, setOrgRepos] = useState<OrgRepo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [isLoadingOrg, setIsLoadingOrg] = useState(false)
  const [orgImportProgress, setOrgImportProgress] = useState<OrgImportProgress | null>(null)
  const [orgResults, setOrgResults] = useState<Array<{ name: string; status: string; error?: string }>>([])

  const { addProject } = useProjectStore()

  const reset = () => {
    setStep(1)
    setProjectName('')
    setSourceType(null)
    setSourcePath('')
    setGithubToken('')
    setNameError('')
    setIsCreating(false)
    setCreateError('')
    setOrgRepos([])
    setSelectedRepos(new Set())
    setIsLoadingOrg(false)
    setOrgImportProgress(null)
    setOrgResults([])
  }

  const handleClose = () => {
    if (isCreating) return
    reset()
    onClose()
  }

  const handleNextStep = () => {
    if (!projectName.trim()) {
      setNameError('Vui lòng nhập tên dự án')
      return
    }
    setNameError('')
    setStep(2)
  }

  const handleSelectLocal = async () => {
    setSourceType('local')
    try {
      const folderPath = await window.electronAPI.openFolderDialog()
      if (folderPath) {
        setSourcePath(folderPath)
      }
    } catch {
      setSourcePath('/Users/dev/projects/my-project')
    }
  }

  const handleSelectGithub = () => {
    setSourceType('github')
    setOrgRepos([])
    setSelectedRepos(new Set())
  }

  const handleSelectGithubOrg = () => {
    setSourceType('github-org')
    setSourcePath('')
    setOrgRepos([])
    setSelectedRepos(new Set())
  }

  const handleFetchOrgRepos = async () => {
    if (!sourcePath.trim() || !githubToken.trim()) return
    setIsLoadingOrg(true)
    setCreateError('')
    try {
      const repos = await window.electronAPI.listOrgRepos(sourcePath.trim(), githubToken.trim())
      setOrgRepos(repos)
      setSelectedRepos(new Set(repos.map(r => r.name)))
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Không thể tải danh sách repos')
    } finally {
      setIsLoadingOrg(false)
    }
  }

  const toggleRepo = (name: string) => {
    setSelectedRepos(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedRepos.size === orgRepos.length) {
      setSelectedRepos(new Set())
    } else {
      setSelectedRepos(new Set(orgRepos.map(r => r.name)))
    }
  }

  useEffect(() => {
    if (!isCreating || sourceType !== 'github-org') return
    const cleanup = window.electronAPI.onOrgImportProgress?.((data) => {
      setOrgImportProgress(data)
    })
    return () => cleanup?.()
  }, [isCreating, sourceType])

  const handleCreate = async () => {
    if (!sourceType) return
    setIsCreating(true)
    setCreateError('')

    try {
      if (sourceType === 'github-org') {
        const selected = orgRepos.filter(r => selectedRepos.has(r.name))
        if (selected.length === 0) {
          setCreateError('Vui lòng chọn ít nhất 1 repository')
          setIsCreating(false)
          return
        }

        const projectId = await addProject(projectName.trim(), 'github-org', sourcePath.trim())
        if (!projectId) {
          setCreateError('Không thể tạo dự án.')
          setIsCreating(false)
          return
        }

        const results = await window.electronAPI.importOrgRepos(projectId, selected, githubToken.trim())
        setOrgResults(results)

        await useProjectStore.getState().loadProjects()

        const failed = results.filter(r => r.status === 'error')
        if (failed.length === 0) {
          reset()
          onClose()
        } else {
          setIsCreating(false)
          setCreateError(`${failed.length}/${results.length} repos gặp lỗi. Các repos thành công đã được import.`)
        }
        return
      }

      if (!sourcePath.trim()) return

      const projectId = await addProject(projectName.trim(), sourceType, sourcePath.trim())
      if (!projectId) {
        setCreateError('Không thể tạo dự án. Vui lòng thử lại.')
        setIsCreating(false)
        return
      }

      if (sourceType === 'local') {
        await window.electronAPI.importLocalRepo(projectId, sourcePath.trim())
      } else if (sourceType === 'github') {
        const result = await window.electronAPI.importGithubRepo(
          projectId,
          sourcePath.trim(),
          githubToken || undefined
        )
        if (!result.success) {
          if (result.needsToken) {
            setCreateError('Repository là private. Vui lòng cung cấp GitHub Token.')
            setIsCreating(false)
            return
          }
          setCreateError(result.error || 'Không thể import repository.')
          setIsCreating(false)
          return
        }
      }

      await useProjectStore.getState().loadProjects()
      reset()
      onClose()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Đã xảy ra lỗi. Vui lòng thử lại.')
    } finally {
      setIsCreating(false)
    }
  }

  const canCreate = sourceType === 'github-org'
    ? selectedRepos.size > 0 && orgRepos.length > 0
    : sourceType && sourcePath.trim()

  return (
    <Modal open={open} onClose={handleClose} title="Tạo dự án mới" width="md">
      {step === 1 && (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] text-[var(--text-secondary)] -mt-1">
            Đặt tên cho dự án. Cortex sẽ tự tạo một AI assistant riêng cho nó.
          </p>

          <Input
            id="project-name"
            label="Tên dự án"
            placeholder="Vi du: E-Commerce Platform"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value)
              if (nameError) setNameError('')
            }}
            error={nameError}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNextStep()
            }}
          />

          <div className="flex justify-end pt-2">
            <Button onClick={handleNextStep} size="md">
              Tiếp tục
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 -mt-1">
            <button
              onClick={() => setStep(1)}
              className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-sidebar-hover)] transition-all"
            >
              <ArrowLeft size={16} />
            </button>
            <p className="text-[14px] text-[var(--text-secondary)]">
              Chọn nguồn import cho <strong>{projectName}</strong>
            </p>
          </div>

          <ImportOptions
            onSelectLocal={handleSelectLocal}
            onSelectGithub={handleSelectGithub}
            onSelectGithubOrg={handleSelectGithubOrg}
            selected={sourceType}
          />

          {sourceType === 'local' && sourcePath && (
            <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-[13px] text-[var(--text-secondary)] font-mono truncate">
              {sourcePath}
            </div>
          )}

          {sourceType === 'github' && (
            <div className="flex flex-col gap-3">
              <Input
                id="github-url"
                label="Repository URL"
                placeholder="https://github.com/user/repo"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                autoFocus
              />
              <Input
                id="github-token"
                label="GitHub Token (cho private repo)"
                placeholder="ghp_xxxxxxxxxxxx"
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
              <a
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--text-link)] hover:underline"
              >
                Tạo token tại đây
                <ExternalLink size={11} />
              </a>
            </div>
          )}

          {sourceType === 'github-org' && (
            <div className="flex flex-col gap-3">
              <Input
                id="org-url"
                label="Organization URL"
                placeholder="https://github.com/orgs/ORG_NAME"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                autoFocus
              />
              <Input
                id="org-token"
                label="GitHub Token (bắt buộc)"
                placeholder="ghp_xxxxxxxxxxxx"
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />

              {orgRepos.length === 0 && !isLoadingOrg && (
                <Button
                  onClick={handleFetchOrgRepos}
                  disabled={!sourcePath.trim() || !githubToken.trim() || isLoadingOrg}
                  size="md"
                  variant="secondary"
                >
                  {isLoadingOrg ? <Loader2 size={16} className="animate-spin" /> : null}
                  Tải danh sách repos
                </Button>
              )}

              {isLoadingOrg && (
                <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <Loader2 size={14} className="animate-spin" />
                  Đang tải danh sách repositories...
                </div>
              )}

              {orgRepos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--text-tertiary)]">
                      {selectedRepos.size}/{orgRepos.length} repos đã chọn
                    </span>
                    <button
                      onClick={toggleAll}
                      className="text-[12px] text-[var(--text-link)] hover:underline"
                    >
                      {selectedRepos.size === orgRepos.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto border border-[var(--border-primary)] rounded-lg divide-y divide-[var(--border-primary)]">
                    {orgRepos.map((repo) => (
                      <label
                        key={repo.name}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-sidebar-hover)] cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRepos.has(repo.name)}
                          onChange={() => toggleRepo(repo.name)}
                          className="rounded border-[var(--border-primary)] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                              {repo.name}
                            </span>
                            {repo.isPrivate && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shrink-0">
                                Private
                              </span>
                            )}
                            {repo.language && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent-light)] text-[var(--accent-primary)] shrink-0">
                                {repo.language}
                              </span>
                            )}
                          </div>
                          {repo.description && (
                            <div className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">
                              {repo.description}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {orgImportProgress && (
                <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[var(--text-secondary)]">
                      {orgImportProgress.phase === 'complete'
                        ? 'Hoàn tất!'
                        : `${orgImportProgress.repoName} (${orgImportProgress.phase})`}
                    </span>
                    <span className="text-[var(--text-tertiary)]">
                      {orgImportProgress.current}/{orgImportProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--border-primary)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
                      style={{ width: `${(orgImportProgress.current / orgImportProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {orgResults.length > 0 && (
                <div className="max-h-[150px] overflow-y-auto text-[12px] space-y-1">
                  {orgResults.map((r) => (
                    <div key={r.name} className="flex items-center gap-2">
                      {r.status === 'ready'
                        ? <Check size={12} className="text-green-500 shrink-0" />
                        : <X size={12} className="text-red-500 shrink-0" />}
                      <span className={r.status === 'ready' ? 'text-[var(--text-secondary)]' : 'text-[var(--status-error-text)]'}>
                        {r.name} {r.error ? `- ${r.error.slice(0, 60)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {createError && (
            <div className="px-3 py-2 rounded-lg bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[13px] text-[var(--status-error-text)]">
              {createError}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleCreate} disabled={!canCreate || isCreating} size="md">
              {isCreating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {orgImportProgress
                    ? `Importing ${orgImportProgress.current}/${orgImportProgress.total}...`
                    : 'Dang import...'}
                </>
              ) : sourceType === 'github-org' && selectedRepos.size > 0 ? (
                `Import ${selectedRepos.size} repos`
              ) : (
                'Tạo dự án & Bắt đầu học'
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
