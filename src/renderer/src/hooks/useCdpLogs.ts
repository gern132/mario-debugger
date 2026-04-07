import { useRef, useCallback } from 'react'
import type { LogEntry, LogLevel } from '@shared/types'

// ── CDP types (minimal) ───────────────────────────

interface CdpTarget {
  webSocketDebuggerUrl: string
  type: string
  title: string
}

interface CdpRemoteObject {
  type: string
  subtype?: string
  value?: unknown
  description?: string
  preview?: CdpPreview
}

interface CdpPreview {
  subtype?: string
  overflow: boolean
  properties: Array<{ name: string; type: string; value?: string; subtype?: string }>
}

interface CdpCallFrame {
  url: string
  lineNumber: number      // 0-indexed
  columnNumber: number
  functionName: string
}

// ── RemoteObject → string ─────────────────────────

function fmtObj(obj: CdpRemoteObject): string {
  if (obj.type === 'string')  return String(obj.value ?? '')
  if (obj.type === 'number' || obj.type === 'boolean') return String(obj.value)
  if (obj.type === 'undefined' || obj.subtype === 'null') return obj.type === 'undefined' ? 'undefined' : 'null'
  if (obj.preview) return fmtPreview(obj.preview)
  return obj.description ?? obj.type
}

function fmtPreview(p: CdpPreview): string {
  const overflow = p.overflow ? ', …' : ''
  const isArr = p.subtype === 'array'

  const items = (p.properties ?? []).map(prop => {
    const v = prop.value ?? 'null'
    return isArr ? v : `${prop.name}: ${v}`
  })

  return isArr
    ? `[${items.join(', ')}${overflow}]`
    : `{${items.join(', ')}${overflow}}`
}

function cdpTypeToLevel(type: string): LogLevel {
  if (type === 'warning') return 'warn'
  if (type === 'error')   return 'error'
  if (type === 'debug')   return 'debug'
  return 'info'
}

// ── Source URL → relative file path ──────────────

function extractFile(url: string): string | undefined {
  if (!url) return undefined
  // "http://localhost:8081/src/screens/Home.tsx?platform=..." → "src/screens/Home.tsx"
  if (url.startsWith('http')) {
    try {
      const pathname = new URL(url).pathname.replace(/^\//, '')
      if (!pathname || pathname.includes('?')) return undefined
      return pathname
    } catch { return undefined }
  }
  // absolute path or relative path as-is
  return url || undefined
}

// ── Hook ─────────────────────────────────────────

interface UseCdpLogsOptions {
  port: number
  onEntry: (entry: LogEntry) => void
  onStatus: (streaming: boolean, error?: string) => void
}

export function useCdpLogs({ port, onEntry, onStatus }: UseCdpLogsOptions) {
  const wsRef  = useRef<WebSocket | null>(null)
  const idRef  = useRef(0)

  const start = useCallback(async () => {
    stop()

    // 1. Discover Hermes CDP targets via main process (no CORS)
    let targets: CdpTarget[]
    try {
      const raw = await window.api.getCdpTargets(port)
      targets = (raw as CdpTarget[]).filter(t =>
        t.webSocketDebuggerUrl && (t.type === 'node' || t.title?.toLowerCase().includes('hermes') || true)
      )
    } catch {
      onStatus(false, `Cannot reach Metro at localhost:${port}`)
      return
    }

    if (!targets.length) {
      onStatus(false, `No Hermes targets found at localhost:${port}. Is Metro running?`)
      return
    }

    // 2. Open WebSocket to CDP endpoint (browser API — no extra packages needed)
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }))
      onStatus(true)
    }

    ws.onmessage = (event) => {
      let msg: { method?: string; params?: Record<string, unknown> }
      try { msg = JSON.parse(event.data as string) } catch { return }

      if (msg.method !== 'Runtime.consoleAPICalled') return

      const params = msg.params as {
        type: string
        args: CdpRemoteObject[]
        stackTrace?: { callFrames: CdpCallFrame[] }
        timestamp?: number
      }

      const { type, args, stackTrace, timestamp } = params

      // Build message string from CDP remote objects
      const message = args.map(fmtObj).join(' ')

      // Source location from first non-internal stack frame
      let sourceFile: string | undefined
      let sourceLine: number | undefined
      const frames = stackTrace?.callFrames ?? []
      for (const frame of frames) {
        const file = extractFile(frame.url)
        if (!file) continue
        if (file.includes('node_modules')) continue
        if (file.includes('Libraries/')) continue
        if (file.includes('polyfills/')) continue
        sourceFile = file
        sourceLine = frame.lineNumber + 1  // CDP is 0-indexed
        break
      }

      const ts = timestamp ? new Date(timestamp) : new Date()
      const time = ts.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })

      onEntry({
        id: String(++idRef.current),
        time,
        level: cdpTypeToLevel(type),
        tag: 'ReactNativeJS',
        message,
        sourceFile,
        sourceLine,
      })
    }

    ws.onerror = () => onStatus(false, 'CDP WebSocket error')
    ws.onclose = () => onStatus(false)
  }, [port, onEntry, onStatus])

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  return { start, stop }
}
