import { create } from 'zustand'
import type { Project } from '../types'

export interface RepoBranchState {
  activeBranch: string
  availableBranches: string[]
}

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  /** @deprecated Use repoBranches instead */
  activeBranch: string
  /** @deprecated Use repoBranches instead */
  availableBranches: string[]
  /** Per-repo branch state: repoId -> { activeBranch, availableBranches } */
  repoBranches: Record<string, RepoBranchState>

  loadProjects: () => Promise<void>
  setActiveProject: (id: string | null) => void
  addProject: (name: string, sourceType: Project['sourceType'], sourcePath: string) => Promise<string | null>
  removeProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  loadBranches: (repoId: string) => Promise<void>
  switchBranch: (projectId: string, repoId: string, branch: string) => Promise<boolean>
  getRepoBranch: (repoId: string) => RepoBranchState
}

/** Map DB row (snake_case) to frontend Project (camelCase) */
function mapDbProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    brainName: row.brain_name,
    sourceType: 'local',  // will be enriched from repos
    sourcePath: '',
    brainStatus: 'idle',
    lastSyncAt: row.updated_at,
    createdAt: row.created_at
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeBranch: 'main',
  availableBranches: [],
  repoBranches: {},

  loadProjects: async () => {
    if (!window.electronAPI?.getAllProjects) return
    try {
      const rows = await window.electronAPI.getAllProjects()
      const projects: Project[] = []

      for (const row of rows) {
        const p = mapDbProject(row)
        // Enrich with first repo info
        if (window.electronAPI.getReposByProject) {
          const repos = await window.electronAPI.getReposByProject(row.id)
          if (repos.length > 0) {
            const repo = repos[0]
            p.sourceType = repo.source_type
            p.sourcePath = repo.source_path
            p.brainStatus = repo.status
            p.lastSyncAt = repo.last_indexed_at
          }
        }
        projects.push(p)
      }

      set({ projects })
    } catch (err) {
      console.error('Failed to load projects:', err)
    }
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    try {
      if (id) localStorage.setItem('cortex-active-project', id)
      else localStorage.removeItem('cortex-active-project')
    } catch {}
  },

  addProject: async (name, sourceType, sourcePath) => {
    if (!window.electronAPI?.createProject) return null
    const brainNames = ['Atlas', 'Nova', 'Prism', 'Echo', 'Spark', 'Flux', 'Orbit', 'Sage']
    const randomBrain = brainNames[Math.floor(Math.random() * brainNames.length)]

    try {
      const row = await window.electronAPI.createProject(name, randomBrain)
      if (!row) return null

      const project = mapDbProject(row)
      project.sourceType = sourceType
      project.sourcePath = sourcePath
      project.brainStatus = 'indexing'

      set((state) => ({
        projects: [project, ...state.projects],
        activeProjectId: project.id
      }))

      return project.id
    } catch (err) {
      console.error('Failed to create project:', err)
      return null
    }
  },

  removeProject: async (id) => {
    if (!window.electronAPI?.deleteProject) return
    try {
      await window.electronAPI.deleteProject(id)
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId
      }))
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  },

  renameProject: async (id, name) => {
    if (!window.electronAPI?.renameProject) return
    try {
      await window.electronAPI.renameProject(id, name)
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p))
      }))
    } catch (err) {
      console.error('Failed to rename project:', err)
    }
  },

  loadBranches: async (repoId: string) => {
    if (!window.electronAPI?.listBranches) return
    try {
      const branches = await window.electronAPI.listBranches(repoId)
      const current = await window.electronAPI.getCurrentBranch?.(repoId) || 'main'
      set((state) => ({
        // Keep legacy fields in sync with first loaded repo
        availableBranches: branches,
        activeBranch: current,
        // Per-repo branch state
        repoBranches: {
          ...state.repoBranches,
          [repoId]: { activeBranch: current, availableBranches: branches }
        }
      }))
    } catch (err) {
      console.error('Failed to load branches:', err)
    }
  },

  switchBranch: async (projectId: string, repoId: string, branch: string) => {
    if (!window.electronAPI?.switchBranch) return false
    try {
      // Optimistic update
      set((state) => ({
        activeBranch: branch,
        repoBranches: {
          ...state.repoBranches,
          [repoId]: {
            ...state.repoBranches[repoId],
            activeBranch: branch
          }
        }
      }))
      const result = await window.electronAPI.switchBranch(projectId, repoId, branch)
      if (!result?.success) {
        console.error('Branch switch failed:', result?.error)
        // Revert optimistic update
        const current = await window.electronAPI.getCurrentBranch?.(repoId) || 'main'
        set((state) => ({
          activeBranch: current,
          repoBranches: {
            ...state.repoBranches,
            [repoId]: {
              ...state.repoBranches[repoId],
              activeBranch: current
            }
          }
        }))
        return false
      }
      return true
    } catch (err) {
      console.error('Failed to switch branch:', err)
      return false
    }
  },

  getRepoBranch: (repoId: string): RepoBranchState => {
    return get().repoBranches[repoId] || { activeBranch: 'main', availableBranches: [] }
  }
}))
