import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import os from 'os'
import path from 'path'
import {
  getConnectedDevices,
  detectPackageName,
  getMemoryStats,
  resetGfxStats,
  readPerformanceStats,
} from './device/adb'

const execAsync = promisify(exec)

// Run command through user's login shell so PATH includes user-installed tools
function sh(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(cmd, { shell: '/bin/zsh' })
}

async function openInVSCode(filePath: string, line: number): Promise<void> {
  const candidates = [
    `code --goto "${filePath}:${line}"`,
    `/usr/local/bin/code --goto "${filePath}:${line}"`,
    `/opt/homebrew/bin/code --goto "${filePath}:${line}"`,
  ]
  for (const cmd of candidates) {
    try { await sh(cmd); return } catch { /* try next */ }
  }
  // URL scheme fallback
  await shell.openExternal(`vscode://file/${filePath}:${line}`)
}

async function openInWebStorm(filePath: string, line: number): Promise<void> {
  const toolboxScript = path.join(
    os.homedir(),
    'Library/Application Support/JetBrains/Toolbox/scripts/webstorm'
  )
  const candidates = [
    `webstorm --line ${line} "${filePath}"`,
    `/usr/local/bin/webstorm --line ${line} "${filePath}"`,
    `"${toolboxScript}" --line ${line} "${filePath}"`,
  ]
  for (const cmd of candidates) {
    try { await sh(cmd); return } catch { /* try next */ }
  }
  // open -a fallback (no line number but opens the file)
  try { await sh(`open -a WebStorm "${filePath}"`); return } catch { /* try next */ }
  await shell.openExternal(
    `jetbrains://webstorm/navigate/reference?file=${encodeURIComponent(filePath)}&line=${line}`
  )
}
import { runAnalysis } from './checkers/index'
import {
  getRecentProjects,
  saveRecentProject,
  getEditorPreference,
  setEditorPreference,
} from './store'
import { startLogcat, stopLogcat } from './device/logcat'
import { startCdp, stopCdp, getNetworkResponseBody } from './device/cdp'
import type { Project, LogMode } from '@shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 660,
    minWidth: 820,
    minHeight: 540,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 19 },
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = win
  win.on('closed', () => { mainWindow = null; stopLogcat(); stopCdp() })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('select-project-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select React Native project folder',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('run-analysis', async (_event, projectPath: string) => {
  return await runAnalysis(projectPath)
})

ipcMain.handle(
  'open-in-editor',
  async (_event, filePath: string, line: number, editor: 'vscode' | 'webstorm') => {
    if (editor === 'vscode') {
      await openInVSCode(filePath, line)
    } else {
      await openInWebStorm(filePath, line)
    }
  }
)

ipcMain.handle('get-recent-projects', async () => getRecentProjects())

ipcMain.handle('save-recent-project', async (_event, project: Project) => {
  await saveRecentProject(project)
})

ipcMain.handle('get-editor-preference', async () => getEditorPreference())

ipcMain.handle('set-editor-preference', async (_event, editor: 'vscode' | 'webstorm') => {
  await setEditorPreference(editor)
})

// ── Device / ADB handlers ──────────────────────────

ipcMain.handle('get-adb-devices', async () => getConnectedDevices())

ipcMain.handle('detect-package-name', async (_event, projectPath: string) =>
  detectPackageName(projectPath)
)

ipcMain.handle(
  'get-memory-stats',
  async (_event, packageName: string, device?: string) =>
    getMemoryStats(packageName, device)
)

ipcMain.handle(
  'reset-gfx-stats',
  async (_event, packageName: string, device?: string) =>
    resetGfxStats(packageName, device)
)

ipcMain.handle(
  'read-performance-stats',
  async (_event, packageName: string, device?: string) =>
    readPerformanceStats(packageName, device)
)

// ── Logcat streaming ───────────────────────────────

ipcMain.handle('start-logcat', async (_event, device: string | undefined, mode: LogMode) => {
  if (!mainWindow) return
  await startLogcat(mainWindow, device, mode)
})

ipcMain.handle('stop-logcat', async () => {
  stopLogcat()
})

// ── Metro / Hermes CDP target discovery ────────────

function fetchCdpTargets(port: number, timeoutMs = 2000): Promise<unknown[]> {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/json`, res => {
      let raw = ''
      res.on('data', (c: string) => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw) as unknown[]) } catch { resolve([]) }
      })
    })
    req.on('error', () => resolve([]))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve([]) })
  })
}

ipcMain.handle('get-cdp-targets', (_event, port: number) => fetchCdpTargets(port))

// ── CDP (Hermes inspector) ─────────────────────────

ipcMain.handle('start-cdp', async (_event, wsUrl: string) => {
  if (!mainWindow) return
  await startCdp(mainWindow, wsUrl)
})

ipcMain.handle('stop-cdp', () => stopCdp())

ipcMain.handle('get-network-response-body', (_event, requestId: string) =>
  getNetworkResponseBody(requestId)
)

// Scan common Metro/Expo ports and return first one with live targets
ipcMain.handle('find-metro-port', async () => {
  const ports = [8081, 8082, 8083, 19000, 19001, 19006]
  const results = await Promise.all(
    ports.map(port =>
      fetchCdpTargets(port, 1000)
        .then(targets => (targets.length ? { port, targets } : null))
        .catch(() => null)
    )
  )
  return results.find(r => r !== null) ?? null
})
