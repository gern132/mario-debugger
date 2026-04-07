import type { Issue } from '@shared/types'

export function checkInlineStyles(lines: string[], file: string): Issue[] {
  if (!file.endsWith('.tsx')) return []
  const issues: Issue[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/style=\{\{([^}]+)\}\}/)
    if (!match) continue

    const props = (match[1].match(/\w+\s*:/g) ?? []).length
    if (props > 3) {
      issues.push({
        file,
        line: i + 1,
        severity: 'warn',
        rule: 'inline-style',
        message: `Inline style with ${props} props — move to StyleSheet.create()`,
        code: lines[i].trim(),
      })
    }
  }

  return issues
}
