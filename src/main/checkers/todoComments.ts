import type { Issue } from '@shared/types'

export function checkTodoComments(lines: string[], file: string): Issue[] {
  const issues: Issue[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/\/\/\s*(TODO|FIXME|HACK|XXX):?\s*(.+)/i)
    if (match) {
      issues.push({
        file,
        line: i + 1,
        severity: 'warn',
        rule: 'todo-comment',
        message: `${match[1].toUpperCase()}: ${match[2].trim()}`,
        code: lines[i].trim(),
      })
    }
  }

  return issues
}
