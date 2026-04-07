import type { Project, CheckResult, MemoryStats, PerformanceStats, LogEntry, LogMode } from '@shared/types'

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
      // Logcat
      startLogcat: (device: string | undefined, mode: LogMode) => Promise<void>
      stopLogcat: () => Promise<void>
      onLogEntry: (cb: (entry: LogEntry) => void) => () => void
      getCdpTargets: (port: number) => Promise<unknown[]>
      findMetroPort: () => Promise<{ port: number; targets: unknown[] } | null>
      startCdp: (wsUrl: string) => Promise<void>
      stopCdp: () => Promise<void>
      onCdpLog: (cb: (entry: LogEntry) => void) => () => void
      onCdpEvent: (cb: (event: 'connected' | 'closed' | 'error' | 'reconnecting', detail?: string) => void) => () => void
    }
  }
}
