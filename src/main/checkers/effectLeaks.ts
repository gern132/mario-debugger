import type { Issue } from '@shared/types'

const LEAK_SIGNALS = ['addEventListener', 'addListener', 'setInterval', 'setTimeout']
// Valid cleanup patterns:
//   return () => { ... }          — arrow cleanup function
//   return subscription.remove    — direct function reference
//   return NetInfo.addEventListener(...)  — returns unsubscribe directly
// Valid cleanup patterns:
//   return () => { ... }               — arrow cleanup function
//   return subscription.remove         — direct function reference (ends with ; or EOL)
//   return NetInfo.addEventListener(   — returns unsubscribe from a call
const CLEANUP_RE = /return\s*(\(\s*\)\s*=>|[\w.]+\s*(;|\(|$))/m

export function checkEffectLeaks(lines: string[], file: string): Issue[] {
  const issues: Issue[] = []
  let i = 0

  while (i < lines.length) {
    if (/useEffect\s*\(/.test(lines[i])) {
      const effectLine = i + 1
      const body: string[] = []
      let depth = 0
      let started = false

      for (let j = i; j < Math.min(i + 150, lines.length); j++) {
        const line = lines[j]
        body.push(line)
        for (const ch of line) {
          if (ch === '{') { depth++; started = true }
          if (ch === '}') depth--
        }
        if (started && depth <= 0) break
      }

      const bodyStr = body.join('\n')
      const signal = LEAK_SIGNALS.find(s => bodyStr.includes(s))

      if (signal && !CLEANUP_RE.test(bodyStr)) {
        issues.push({
          file,
          line: effectLine,
          severity: 'error',
          rule: 'effect-leak',
          message: `useEffect: "${signal}" without cleanup return`,
          code: lines[i].trim(),
        })
      }
    }
    i++
  }

  return issues
}
