import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import type { Project } from '@shared/types'

type Prefs = {
  editor: 'vscode' | 'webstorm'
  theme: 'dark' | 'light'
  networkPorts: number[]
}

const DEFAULT_PORTS = [8081, 8082, 8083, 19000, 19001, 19006]

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

function getPrefsPath(): string {
  return path.join(app.getPath('userData'), 'preferences.json')
}

export async function getRecentProjects(): Promise<Project[]> {
  try {
    const data = await fs.readFile(getStorePath(), 'utf-8')
    return JSON.parse(data) as Project[]
  } catch {
    return []
  }
}

export async function saveRecentProject(project: Project): Promise<void> {
  const projects = await getRecentProjects()
  const filtered = projects.filter(p => p.path !== project.path)
  const updated = [project, ...filtered].slice(0, 8)
  await fs.writeFile(getStorePath(), JSON.stringify(updated, null, 2))
}

async function readPrefs(): Promise<Prefs> {
  try {
    const data = await fs.readFile(getPrefsPath(), 'utf-8')
    const p = JSON.parse(data) as Partial<Prefs>
    return {
      editor:       p.editor       ?? 'vscode',
      theme:        p.theme        ?? 'dark',
      networkPorts: p.networkPorts ?? DEFAULT_PORTS,
    }
  } catch {
    return { editor: 'vscode', theme: 'dark', networkPorts: DEFAULT_PORTS }
  }
}

async function writePrefs(patch: Partial<Prefs>): Promise<void> {
  const prefs = await readPrefs()
  await fs.writeFile(getPrefsPath(), JSON.stringify({ ...prefs, ...patch }, null, 2))
}

export async function getEditorPreference(): Promise<'vscode' | 'webstorm'> {
  return (await readPrefs()).editor
}

export async function setEditorPreference(editor: 'vscode' | 'webstorm'): Promise<void> {
  await writePrefs({ editor })
}

export async function getTheme(): Promise<'dark' | 'light'> {
  return (await readPrefs()).theme
}

export async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await writePrefs({ theme })
}

export async function getNetworkPorts(): Promise<number[]> {
  return (await readPrefs()).networkPorts
}

export async function setNetworkPorts(ports: number[]): Promise<void> {
  await writePrefs({ networkPorts: ports })
}
