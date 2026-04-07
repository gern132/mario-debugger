import type { Project, CheckResult, MemoryStats, PerformanceStats } from '@shared/types'

declare global {
  interface Window {
    api: {
      selectProjectFolder: () => Promise<string | null>
      runAnalysis: (projectPath: string) => Promise<CheckResult>
      openInEditor: (filePath: string, line: number, editor: 'vscode' | 'webstorm') => Promise<void>
      getRecentProjects: () => Promise<Project[]>
      saveRecentProject: (project: Project) => Promise<void>
      getEditorPreference: () => Promise<'vscode' | 'webstorm'>
      setEditorPreference: (editor: 'vscode' | 'webstorm') => Promise<void>
      // Device
      getAdbDevices: () => Promise<string[]>
      detectPackageName: (projectPath: string) => Promise<string | null>
      getMemoryStats: (packageName: string, device?: string) => Promise<MemoryStats>
      resetGfxStats: (packageName: string, device?: string) => Promise<void>
      readPerformanceStats: (packageName: string, device?: string) => Promise<PerformanceStats>
    }
  }
}
