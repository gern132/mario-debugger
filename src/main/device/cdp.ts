import WebSocket from 'ws'
import http from 'http'
import type { BrowserWindow } from 'electron'
import type { LogEntry, LogLevel, NetworkEvent } from '@shared/types'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'

let ws: WebSocket | null = null
let stopped = false
let idCounter = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let activeRequester: Requester | null = null
let sessionStartMs = 0

export function stopCdp(): void {
  stopped = true
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) { ws.terminate(); ws = null }
}

export async function startCdp(win: BrowserWindow, wsUrl: string): Promise<void> {
  stopped = false
  sessionStartMs = Date.now()
  connect(win, wsUrl, 1)
}

type Requester = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

function connect(win: BrowserWindow, wsUrl: string, attempt: number): void {
  if (stopped || win.isDestroyed()) return

  if (attempt > 5) {
    win.webContents.send('cdp-error', 'Cannot connect to Hermes inspector after 5 attempts. Try Logcat mode.')
    return
  }

  const socket = new WebSocket(wsUrl)
  ws = socket

  let msgId = 0
  const pending = new Map<number, (result: unknown) => void>()

  // Source map cache: scriptId → TraceMap (populated from Debugger.scriptParsed events)
  const sourceMaps = new Map<string, TraceMap>()

  const send = (method: string, params: Record<string, unknown> = {}) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: ++msgId, method, params }))
    }
  }

  const request: Requester = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++msgId
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, 5000)
      pending.set(id, (result) => { clearTimeout(timer); resolve(result as T) })
      socket.send(JSON.stringify({ id, method, params }))
    })

  socket.on('open', () => {
    if (stopped) { socket.terminate(); return }
    send('Runtime.enable')
    send('Debugger.enable')
    send('Runtime.runIfWaitingForDebugger')
    // Network domain — Expo's /inspector/network rebroadcasts Network.* events to our session
    send('Network.enable')
    activeRequester = request
    if (!win.isDestroyed()) win.webContents.send('cdp-connected')
  })

  socket.on('message', (data: Buffer) => {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown }
    try { msg = JSON.parse(data.toString()) } catch { return }

    // Resolve pending requests
    if (typeof msg.id === 'number' && msg.result !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result)
      pending.delete(msg.id)
      return
    }

    if (msg.method === 'Debugger.paused') { send('Debugger.resume'); return }

    // Cache source maps from Debugger.scriptParsed events
    if (msg.method === 'Debugger.scriptParsed') {
      const p = msg.params as { scriptId: string; url: string; sourceMapURL?: string }
      if (p.scriptId && p.sourceMapURL) {
        void loadSourceMap(p.scriptId, p.sourceMapURL, sourceMaps)
      }
      return
    }

    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params as unknown as ConsoleCallParams
      if (isSystemMessage(p.args)) return
      void handleConsoleCall(win, p, request, sourceMaps)
    }

    handleNetworkEvent(win, msg.method ?? '', msg.params)
  })

  socket.on('error', (err: Error) => {
    if (!win.isDestroyed()) win.webContents.send('cdp-error', err.message)
  })

  socket.on('close', (code: number, reason: Buffer) => {
    ws = null
    pending.clear()
    activeRequester = null
    if (stopped || win.isDestroyed()) return
    const reasonStr = reason.toString()
    if (code !== 1000) console.log(`[CDP] Closed code=${code}${reasonStr ? ' ' + reasonStr : ''}`)
    win.webContents.send('cdp-reconnecting', `Reconnecting (attempt ${attempt + 1}, code ${code})…`)
    reconnectTimer = setTimeout(() => {
      if (!stopped && !win.isDestroyed()) connect(win, wsUrl, attempt + 1)
    }, Math.min(1000 * attempt, 5000))
  })
}

// ── Network event handling ────────────────────────

function handleNetworkEvent(win: BrowserWindow, method: string, params: unknown): void {
  if (!method.startsWith('Network.') || win.isDestroyed()) return

  const p = params as Record<string, unknown>

  let event: NetworkEvent | null = null

  if (method === 'Network.requestWillBeSent') {
    const req = p.request as Record<string, unknown>
    event = {
      type: 'request',
      id: p.requestId as string,
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      body: req.postData as string | undefined,
      resourceType: p.type as string | undefined,
      startTime: (p.timestamp as number) * 1000,
    }
  } else if (method === 'Network.responseReceived') {
    const res = p.response as Record<string, unknown>
    event = {
      type: 'response',
      id: p.requestId as string,
      status: res.status as number,
      statusText: res.statusText as string,
      headers: (res.headers ?? {}) as Record<string, string>,
      mimeType: (res.mimeType as string) ?? '',
    }
  } else if (method === 'Network.loadingFinished') {
    event = {
      type: 'done',
      id: p.requestId as string,
      endTime: (p.timestamp as number) * 1000,
      size: (p.encodedDataLength as number) ?? 0,
    }
  } else if (method === 'Network.loadingFailed') {
    event = {
      type: 'fail',
      id: p.requestId as string,
      endTime: (p.timestamp as number) * 1000,
      error: (p.errorText as string) ?? 'Failed',
    }
  }

  if (event) win.webContents.send('network-event', event)
}

export async function getNetworkResponseBody(
  requestId: string
): Promise<{ body: string; base64Encoded: boolean } | null> {
  if (!activeRequester) return null
  try {
    return await activeRequester<{ body: string; base64Encoded: boolean }>(
      'Network.getResponseBody', { requestId }
    )
  } catch {
    return null
  }
}

// ── Source map loading ────────────────────────────

async function loadSourceMap(
  scriptId: string,
  sourceMapURL: string,
  cache: Map<string, TraceMap>
): Promise<void> {
  try {
    let json: string

    if (sourceMapURL.startsWith('data:')) {
      // Inline source map (data URI)
      const comma = sourceMapURL.indexOf(',')
      const isBase64 = sourceMapURL.slice(0, comma).includes('base64')
      const raw = sourceMapURL.slice(comma + 1)
      json = isBase64 ? Buffer.from(raw, 'base64').toString('utf-8') : decodeURIComponent(raw)
    } else {
      // External URL — fetch via Node.js http
      json = await fetchText(sourceMapURL)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawMap = JSON.parse(json) as any
    cache.set(scriptId, new TraceMap(rawMap))
  } catch {
    // Source map unavailable — callFrame URL fallback will be used
  }
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http
    const req = mod.get(url, (res: http.IncomingMessage) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ── Console event handler ─────────────────────────

async function handleConsoleCall(
  win: BrowserWindow,
  p: ConsoleCallParams,
  request: Requester,
  sourceMaps: Map<string, TraceMap>
): Promise<void> {
  // Skip logs that were buffered before Stream was pressed.
  // CDP timestamps may be in seconds or milliseconds — normalise to ms.
  if (p.timestamp) {
    const tsMs = p.timestamp > 1e12 ? p.timestamp : p.timestamp * 1000
    if (tsMs < sessionStartMs) return
  }

  const parts = await Promise.all(p.args.map(arg => resolveArg(arg, request)))
  const message = parts.join(' ')
  const { sourceFile, sourceLine } = extractLoc(p.stackTrace?.callFrames ?? [], sourceMaps)
  const ts = p.timestamp ? new Date(p.timestamp > 1e12 ? p.timestamp : p.timestamp * 1000) : new Date()
  emit(win, ts, cdpLevel(p.type), message, sourceFile, sourceLine)
}

async function resolveArg(arg: CdpArg, request: Requester): Promise<string> {
  if (arg.type === 'string')    return stripAnsi(String(arg.value ?? ''))
  if (arg.type === 'number' || arg.type === 'boolean') return String(arg.value)
  if (arg.type === 'undefined') return 'undefined'
  if (arg.subtype === 'null')   return 'null'

  if (arg.objectId) {
    try {
      const res = await request<{ result: { type: string; value?: unknown } }>('Runtime.callFunctionOn', {
        objectId: arg.objectId,
        functionDeclaration: '(function(){try{return JSON.stringify(this)}catch(e){return null}})',
        returnByValue: true,
      })
      if (res.result.type === 'string' && typeof res.result.value === 'string') {
        return res.result.value
      }
    } catch { /* fall through */ }
  }

  return fmtPreview(arg)
}

function fmtPreview(arg: CdpArg): string {
  if (!arg.preview) return arg.description ?? arg.type
  const p = arg.preview
  const isArr = p.subtype === 'array'
  const items = (p.properties ?? []).map(pr => {
    const isObj = (pr as { type?: string }).type === 'object'
    const val = isObj
      ? ((pr as { subtype?: string }).subtype === 'array' ? '[…]' : '{…}')
      : (pr.value ?? 'null')
    return isArr ? val : `${pr.name}: ${val}`
  })
  return isArr
    ? `[${items.join(', ')}${p.overflow ? ', …' : ''}]`
    : `{${items.join(', ')}${p.overflow ? ', …' : ''}}`
}

function emit(
  win: BrowserWindow, ts: Date, level: LogLevel,
  message: string, sourceFile?: string, sourceLine?: number
): void {
  if (stopped || win.isDestroyed()) return
  win.webContents.send('cdp-log', {
    id: String(++idCounter),
    time: ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    level, tag: 'ReactNativeJS', message, sourceFile, sourceLine,
  } satisfies LogEntry)
}

// ── Location resolution ───────────────────────────

function extractLoc(
  frames: CdpFrame[],
  sourceMaps: Map<string, TraceMap>
): { sourceFile?: string; sourceLine?: number } {
  for (const frame of frames) {
    // 1. Try source map resolution (gives original file/line from bundle position)
    if (frame.scriptId) {
      const tracer = sourceMaps.get(frame.scriptId)
      if (tracer) {
        const pos = originalPositionFor(tracer, {
          line: frame.lineNumber + 1,      // trace-mapping uses 1-indexed
          column: frame.columnNumber ?? 0,
        })
        if (pos.source && pos.line != null) {
          const src = pos.source
          if (!src.includes('node_modules') && !src.includes('Libraries/') && !src.includes('polyfills/')) {
            // pos.source might be an absolute path like /Users/alex/KOD/project/screens/Main/Guards.tsx
            return { sourceFile: src, sourceLine: pos.line }
          }
        }
      }
    }

    // 2. Fallback: if Hermes already resolved the URL to a source file
    const file = urlToFile(frame.url)
    if (file && !file.includes('node_modules') && !file.includes('Libraries/') && !file.includes('polyfills/')) {
      return { sourceFile: file, sourceLine: frame.lineNumber + 1 }
    }
  }
  return {}
}

// ── Types ─────────────────────────────────────────

interface CdpArg {
  type: string; subtype?: string; value?: unknown; objectId?: string; description?: string
  preview?: { subtype?: string; overflow: boolean; properties: Array<{ name: string; value?: string }> }
}
interface CdpFrame {
  url: string; lineNumber: number; columnNumber?: number
  functionName: string; scriptId?: string
}
interface ConsoleCallParams {
  type: string; args: CdpArg[]
  stackTrace?: { callFrames: CdpFrame[] }; timestamp?: number
}

// ── Helpers ───────────────────────────────────────

const ANSI_RE = /\x1B\[[0-9;]*[mGKHF]/g

function stripAnsi(s: string): string { return s.replace(ANSI_RE, '') }

function isSystemMessage(args: CdpArg[]): boolean {
  const first = args[0]
  if (!first || first.type !== 'string') return false
  const text = String(first.value ?? '')
  if (ANSI_RE.test(text)) return true
  ANSI_RE.lastIndex = 0
  return text.includes('unsupported debugging client') || text.includes('React Native DevTools')
}

function cdpLevel(t: string): LogLevel {
  return t === 'warning' ? 'warn' : t === 'error' ? 'error' : t === 'debug' ? 'debug' : 'info'
}

function urlToFile(url: string): string | undefined {
  if (!url) return undefined
  let path: string
  if (url.startsWith('http')) {
    try { path = new URL(url).pathname.replace(/^\//, '') }
    catch { return undefined }
  } else {
    path = url.split('?')[0].split('#')[0]
  }
  if (!path || !/\.(tsx?|jsx?)$/.test(path)) return undefined
  return path
}
