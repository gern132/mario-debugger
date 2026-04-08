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
  buildType: 'debug' | 'release' | 'unknown'
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

// ── Network ───────────────────────────────────────

export type NetworkEvent =
  | { type: 'request'; id: string; url: string; method: string; headers: Record<string, string>; body?: string; resourceType?: string; startTime: number }
  | { type: 'response'; id: string; status: number; statusText: string; headers: Record<string, string>; mimeType: string }
  | { type: 'done'; id: string; endTime: number; size: number }
  | { type: 'fail'; id: string; endTime: number; error: string }

export type NetworkEntry = {
  id: string
  url: string
  method: string
  status?: number
  statusText?: string
  resourceType?: string
  mimeType?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  startTime: number
  endTime?: number
  duration?: number
  size?: number
  failed?: boolean
  errorText?: string
}

export type PerformanceStats = {
  totalFrames: number
  jankyFrames: number       // Android's count (>1 vsync) — includes imperceptible frames
  jankyPercent: number
  mildJankFrames: number    // 17–32ms: borderline, usually imperceptible in RN
  severeJankFrames: number  // >32ms: visible stutters, user actually notices
  p50: number              // ms
  p90: number
  p95: number
  p99: number
  slowUiThread: number
  missedVsync: number
  slowBitmapUploads: number
  slowDrawCommands: number
  refreshRate: number
  buildType: 'debug' | 'release' | 'unknown'
  timestamp: string
}
