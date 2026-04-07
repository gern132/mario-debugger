import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import type { Project } from '@shared/types'

type Prefs = { editor: 'vscode' | 'webstorm' }

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
    return JSON.parse(data) as Prefs
  } catch {
    return { editor: 'vscode' }
  }
}

export async function getEditorPreference(): Promise<'vscode' | 'webstorm'> {
  return (await readPrefs()).editor
}

export async function setEditorPreference(editor: 'vscode' | 'webstorm'): Promise<void> {
  const prefs = await readPrefs()
  await fs.writeFile(getPrefsPath(), JSON.stringify({ ...prefs, editor }, null, 2))
}
