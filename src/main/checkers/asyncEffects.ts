import type { Issue } from '@shared/types'

export function checkAsyncEffects(lines: string[], file: string): Issue[] {
  const issues: Issue[] = []

  for (let i = 0; i < lines.length; i++) {
    if (/useEffect\s*\(\s*async\s*(?:\([^)]*\)|)\s*=>/.test(lines[i])) {
      issues.push({
        file,
        line: i + 1,
        severity: 'warn',
        rule: 'async-effect',
        message: 'async callback directly in useEffect — wrap the call in void inside the effect',
        code: lines[i].trim(),
      })
    }
  }

  return issues
}
