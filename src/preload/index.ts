import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Project, CheckResult, MemoryStats, PerformanceStats, LogEntry, LogMode } from '@shared/types'

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

  // Logcat
  startLogcat: (device: string | undefined, mode: LogMode): Promise<void> =>
    ipcRenderer.invoke('start-logcat', device, mode),

  stopLogcat: (): Promise<void> =>
    ipcRenderer.invoke('stop-logcat'),

  onLogEntry: (cb: (entry: LogEntry) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, entry: LogEntry) => cb(entry)
    ipcRenderer.on('log-entry', handler)
    return () => ipcRenderer.off('log-entry', handler)
  },

  getCdpTargets: (port: number): Promise<unknown[]> =>
    ipcRenderer.invoke('get-cdp-targets', port),

  findMetroPort: (): Promise<{ port: number; targets: unknown[] } | null> =>
    ipcRenderer.invoke('find-metro-port'),

  // CDP (Hermes inspector) — connection lives in main process (no Origin restrictions)
  startCdp: (wsUrl: string): Promise<void> =>
    ipcRenderer.invoke('start-cdp', wsUrl),

  stopCdp: (): Promise<void> =>
    ipcRenderer.invoke('stop-cdp'),

  onCdpLog: (cb: (entry: LogEntry) => void): (() => void) => {
    const h = (_: IpcRendererEvent, e: LogEntry) => cb(e)
    ipcRenderer.on('cdp-log', h)
    return () => ipcRenderer.off('cdp-log', h)
  },

  onCdpEvent: (cb: (event: 'connected' | 'closed' | 'error' | 'reconnecting', detail?: string) => void): (() => void) => {
    const onConnected    = () => cb('connected')
    const onClosed       = () => cb('closed')
    const onError        = (_: IpcRendererEvent, msg: string) => cb('error', msg)
    const onReconnecting = (_: IpcRendererEvent, msg: string) => cb('reconnecting', msg)
    ipcRenderer.on('cdp-connected',    onConnected)
    ipcRenderer.on('cdp-closed',       onClosed)
    ipcRenderer.on('cdp-error',        onError)
    ipcRenderer.on('cdp-reconnecting', onReconnecting)
    return () => {
      ipcRenderer.off('cdp-connected',    onConnected)
      ipcRenderer.off('cdp-closed',       onClosed)
      ipcRenderer.off('cdp-error',        onError)
      ipcRenderer.off('cdp-reconnecting', onReconnecting)
    }
  },
})
