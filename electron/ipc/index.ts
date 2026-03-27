import type { IpcMain, App, BrowserWindow } from 'electron'
import { registerMemoryIPC } from './memory.ipc'
import { registerEfficiencyIPC } from './efficiency.ipc'
import { registerAtlassianIPC } from './atlassian.ipc'
import { registerLearningIPC } from './learning.ipc'
import { registerSystemIPC } from './system.ipc'
import { registerSkillsIPC } from './skills.ipc'
import { registerBrainIPC } from './brain.ipc'
import { registerProjectIPC } from './project.ipc'
import { registerSettingsIPC } from './settings.ipc'

export function registerAllIPC(
  ipcMain: IpcMain,
  app: App,
  getMainWindow: () => BrowserWindow | null
): void {
  registerMemoryIPC(ipcMain)
  registerEfficiencyIPC(ipcMain)
  registerAtlassianIPC(ipcMain, getMainWindow)
  registerLearningIPC(ipcMain, getMainWindow)
  registerSystemIPC(ipcMain, app, getMainWindow)
  registerSkillsIPC(ipcMain, getMainWindow)
  registerBrainIPC(ipcMain, app, getMainWindow)
  registerProjectIPC(ipcMain, app, getMainWindow)
  registerSettingsIPC(ipcMain, getMainWindow)
}
