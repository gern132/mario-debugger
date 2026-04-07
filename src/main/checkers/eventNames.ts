import type { Issue } from '@shared/types'

export function checkEventNames(lines: string[], file: string): Issue[] {
  const issues: Issue[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/logEvent\s*\(\s*['"]([^'"]+)['"]/)
    if (match && match[1].length > 40) {
      issues.push({
        file,
        line: i + 1,
        severity: 'error',
        rule: 'event-name',
        message: `Firebase event "${match[1]}" is ${match[1].length} chars (limit 40)`,
        code: lines[i].trim(),
      })
    }
  }

  return issues
}
