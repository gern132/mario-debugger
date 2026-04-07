import { contextBridge, ipcRenderer } from 'electron'
import type { Project, CheckResult, MemoryStats, PerformanceStats } from '@shared/types'

contextBridge.exposeInMainWorld('api', {
  selectProjectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-project-folder'),

  runAnalysis: (projectPath: string): Promise<CheckResult> =>
    ipcRenderer.invoke('run-analysis', projectPath),

  openInEditor: (filePath: string, line: number, editor: 'vscode' | 'webstorm'): Promise<void> =>
    ipcRenderer.invoke('open-in-editor', filePath, line, editor),

  getRecentProjects: (): Promise<Project[]> =>
    ipcRenderer.invoke('get-recent-projects'),

  saveRecentProject: (project: Project): Promise<void> =>
    ipcRenderer.invoke('save-recent-project', project),

  getEditorPreference: (): Promise<'vscode' | 'webstorm'> =>
    ipcRenderer.invoke('get-editor-preference'),

  setEditorPreference: (editor: 'vscode' | 'webstorm'): Promise<void> =>
    ipcRenderer.invoke('set-editor-preference', editor),

  // Device
  getAdbDevices: (): Promise<string[]> =>
    ipcRenderer.invoke('get-adb-devices'),

  detectPackageName: (projectPath: string): Promise<string | null> =>
    ipcRenderer.invoke('detect-package-name', projectPath),

  getMemoryStats: (packageName: string, device?: string): Promise<MemoryStats> =>
    ipcRenderer.invoke('get-memory-stats', packageName, device),

  resetGfxStats: (packageName: string, device?: string): Promise<void> =>
    ipcRenderer.invoke('reset-gfx-stats', packageName, device),

  readPerformanceStats: (packageName: string, device?: string): Promise<PerformanceStats> =>
    ipcRenderer.invoke('read-performance-stats', packageName, device),
})
