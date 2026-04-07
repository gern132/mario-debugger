import fs from 'fs/promises'
import path from 'path'
import type { CheckResult, Issue } from '@shared/types'
import { checkEffectLeaks } from './effectLeaks'
import { checkConsoleLogs } from './consoleLogs'
import { checkAsyncEffects } from './asyncEffects'
import { checkInlineStyles } from './inlineStyles'
import { checkEventNames } from './eventNames'
import { checkTodoComments } from './todoComments'

const SKIP_DIRS = new Set([
  'node_modules', '.expo', 'ios', 'android', 'assets',
  'locales', '.git', 'out', 'dist', '.cache',
])

async function walkFiles(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const files: string[] = []
  for (const name of names) {
    const full = path.join(dir, name)
    let stat
    try { stat = await fs.stat(full) } catch { continue }
    if (stat.isDirectory() && !SKIP_DIRS.has(name)) {
      files.push(...await walkFiles(full))
    } else if (stat.isFile() && /\.(ts|tsx)$/.test(name)) {
      files.push(full)
    }
  }
  return files
}

export async function runAnalysis(projectPath: string): Promise<CheckResult> {
  const start = Date.now()
  const files = await walkFiles(projectPath)
  const allIssues: Issue[] = []

  for (const file of files) {
    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    const relPath = path.relative(projectPath, file)

    allIssues.push(
      ...checkEffectLeaks(lines, relPath),
      ...checkConsoleLogs(lines, relPath),
      ...checkAsyncEffects(lines, relPath),
      ...checkInlineStyles(lines, relPath),
      ...checkEventNames(lines, relPath),
      ...checkTodoComments(lines, relPath),
    )
  }

  return {
    issues: allIssues,
    filesScanned: files.length,
    duration: Date.now() - start,
    timestamp: new Date().toISOString(),
    projectPath,
  }
}
