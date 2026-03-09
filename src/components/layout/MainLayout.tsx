import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ChatArea } from '../chat/ChatArea'
import { NewProjectModal } from '../project/NewProjectModal'
import { SettingsPanel } from '../settings/SettingsPanel'
import { ArchitecturePanel } from '../project/ArchitecturePanel'
import { BrainDashboard } from '../project/BrainDashboard'
import { OnboardingWizard } from '../onboarding/OnboardingWizard'
import { MemoryDashboard } from '../memory/MemoryDashboard'
import { SkillManager } from '../skills/SkillManager'
import { LearningDashboard } from '../learning/LearningDashboard'
import { AgentPanel } from '../agent/AgentPanel'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'

export function MainLayout() {
  const {
    newProjectModalOpen, closeNewProjectModal,
    settingsOpen, toggleSettings,
    architectureOpen, setArchitectureOpen,
    dashboardOpen, setDashboardOpen,
    onboardingOpen, setOnboardingOpen,
    memoryOpen, setMemoryOpen,
    skillsOpen, setSkillsOpen,
    learningOpen, setLearningOpen,
    agentOpen, setAgentOpen
  } = useUIStore()
  const { loadProjects, activeProjectId } = useProjectStore()
  const [onboardingChecked, setOnboardingChecked] = useState(false)

  useEffect(() => {
    loadProjects().then(() => {
      const { projects, activeProjectId: currentId } = useProjectStore.getState()
      if (currentId || projects.length === 0) return

      try {
        const savedId = localStorage.getItem('cortex-active-project')
        if (savedId && projects.find(p => p.id === savedId)) {
          useProjectStore.getState().setActiveProject(savedId)
          return
        }
      } catch {}

      useProjectStore.getState().setActiveProject(projects[0].id)
    })
  }, [loadProjects])

  // Check onboarding on first load
  useEffect(() => {
    if (onboardingChecked) return
    window.electronAPI?.isOnboardingCompleted?.().then((completed) => {
      if (!completed) setOnboardingOpen(true)
      setOnboardingChecked(true)
    }).catch(() => setOnboardingChecked(true))
  }, [onboardingChecked, setOnboardingOpen])

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ChatArea />
      </main>

      <NewProjectModal open={newProjectModalOpen} onClose={closeNewProjectModal} />
      <SettingsPanel open={settingsOpen} onClose={toggleSettings} />
      <ArchitecturePanel open={architectureOpen} onClose={() => setArchitectureOpen(false)} projectId={activeProjectId} />
      <BrainDashboard open={dashboardOpen} onClose={() => setDashboardOpen(false)} projectId={activeProjectId} />
      <OnboardingWizard open={onboardingOpen} onComplete={() => setOnboardingOpen(false)} />
      <MemoryDashboard open={memoryOpen} onClose={() => setMemoryOpen(false)} projectId={activeProjectId} />
      <SkillManager open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <LearningDashboard open={learningOpen} onClose={() => setLearningOpen(false)} projectId={activeProjectId} />
      <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} projectId={activeProjectId} />
    </div>
  )
}
