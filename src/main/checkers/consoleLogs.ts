import type { Issue } from '@shared/types'

export function checkConsoleLogs(lines: string[], file: string): Issue[] {
  const issues: Issue[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/console\.(log|warn|error|debug)\s*\(/)
    if (!match) continue

    const context = lines.slice(Math.max(0, i - 5), i + 1).join('\n')
    if (context.includes('__DEV__')) continue

    issues.push({
      file,
      line: i + 1,
      severity: 'warn',
      rule: 'console-log',
      message: `console.${match[1]}() in production code`,
      code: lines[i].trim(),
    })
  }

  return issues
}
