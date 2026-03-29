import type { IpcMain } from 'electron'
import { initCostSchema, getCostByProject, getDailyCosts, getCompressionStats } from '../services/skills/efficiency/cost-tracker'
import { invalidateCache, getCacheStats } from '../services/skills/efficiency/semantic-cache'
import { initSkillMetricsTable } from '../services/skills/skill-metrics'

export function registerEfficiencyIPC(ipcMain: IpcMain): void {
  try { initCostSchema() } catch (err) { console.error('[Main] Cost schema init failed:', err) }
  try { initSkillMetricsTable() } catch (err) { console.error('[Main] Skill metrics init failed:', err) }

  ipcMain.handle('cost:stats', (_event, projectId: string) => {
    try { return getCostByProject(projectId) } catch { return null }
  })
  ipcMain.handle('cost:history', (_event, projectId: string, days?: number) => {
    try { return getDailyCosts(projectId, days) } catch { return [] }
  })
  ipcMain.handle('cache:stats', () => {
    try { return getCacheStats() } catch { return null }
  })
  ipcMain.handle('cache:invalidate', () => {
    try { return invalidateCache() } catch { return false }
  })
}
