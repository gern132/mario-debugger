export type IssueSeverity = 'error' | 'warn'

export type IssueRule =
  | 'effect-leak'
  | 'console-log'
  | 'async-effect'
  | 'inline-style'
  | 'event-name'
  | 'todo-comment'

export type Issue = {
  file: string
  line: number
  message: string
  severity: IssueSeverity
  rule: IssueRule
  code?: string
}

export type CheckResult = {
  issues: Issue[]
  filesScanned: number
  duration: number
  timestamp: string
  projectPath: string
}

export type Project = {
  name: string
  path: string
  lastRun?: string
}

// ── Device / ADB ──────────────────────────────────

export type MemoryStats = {
  totalPss: number   // KB
  javaHeap: number
  nativeHeap: number
  code: number
  stack: number
  graphics: number
  system: number
  timestamp: string
  _raw?: string      // raw adb output for debugging
}

// ── Logs ──────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  id: string
  time: string     // HH:MM:SS.mmm
  level: LogLevel
  tag: string
  message: string
  sourceFile?: string   // e.g. "src/screens/Home.tsx"
  sourceLine?: number
}

export type LogMode = 'rn' | 'all'

export type PerformanceStats = {
  totalFrames: number
  jankyFrames: number
  jankyPercent: number
  p50: number        // ms
  p90: number
  p95: number
  p99: number
  slowUiThread: number
  missedVsync: number
  timestamp: string
}
