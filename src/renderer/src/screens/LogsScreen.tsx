import { useState, useEffect, useRef, useCallback } from 'react'
import type { LogEntry, LogLevel, LogMode } from '@shared/types'
import { LogMessage } from '../components/JsonTree'

interface Props {
  projectPath: string
}

const MAX_ENTRIES = 2000

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'var(--text-dim)',
  info:  'var(--green)',
  warn:  'var(--yellow)',
  error: 'var(--red)',
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info:  'INF',
  warn:  'WRN',
  error: 'ERR',
}

// Fallback for logcat entries: extract first user-code stack frame from message text
function parseLocFromMessage(msg: string): { file: string; line: number } | null {
  const RE = /at (?:[^\s(]+ \()?([^):\s]+\.(?:tsx?|jsx?)):(\d+)(?::\d+)?\)?/g
  let m: RegExpExecArray | null
  while ((m = RE.exec(msg)) !== null) {
    const [, file, lineStr] = m
    if (file.includes('node_modules') || file.includes('Libraries/')) continue
    return { file, line: parseInt(lineStr, 10) }
  }
  return null
}


export function LogsScreen({ projectPath }: Props) {
  // ── Source: metro (CDP) or logcat ─────────────────
  const [source, setSource]           = useState<'metro' | 'logcat'>('metro')
  const [metroPort, setMetroPort]     = useState(8081)
  const [portDetecting, setPortDetecting] = useState(false)

  // ── Logcat-specific ───────────────────────────────
  const [devices, setDevices]         = useState<string[]>([])
  const [device, setDevice]           = useState<string>('')
  const [logcatMode, setLogcatMode]   = useState<LogMode>('rn')

  // ── Shared ────────────────────────────────────────
  const [streaming, setStreaming]     = useState(false)
  const [cdpError, setCdpError]       = useState<string | null>(null)
  const [entries, setEntries]         = useState<LogEntry[]>([])
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [search, setSearch]           = useState('')
  const [autoScroll, setAutoScroll]   = useState(true)
  const [editor, setEditor]           = useState<'vscode' | 'webstorm'>('vscode')

  const bottomRef    = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bufferRef    = useRef<LogEntry[]>([])
  const idRef        = useRef(0)

  // Flush buffer → state every 100ms
  // Auto-detect Metro port on mount
  useEffect(() => {
    setPortDetecting(true)
    window.api.findMetroPort()
      .then(result => { if (result) setMetroPort(result.port) })
      .finally(() => setPortDetecting(false))
  }, [])

  useEffect(() => {
    window.api.getEditorPreference().then(setEditor)
    window.api.getAdbDevices().then(devs => {
      setDevices(devs)
      if (devs[0]) setDevice(devs[0])
    })

    const offLogcat = window.api.onLogEntry(e => { bufferRef.current.push(e) })
    const offCdpLog = window.api.onCdpLog(e => { bufferRef.current.push(e) })

    const offCdpEvent = window.api.onCdpEvent((event, detail) => {
      if (event === 'connected')    { setStreaming(true);  setCdpError(null) }
      if (event === 'closed')       setStreaming(false)
      if (event === 'reconnecting') setCdpError(detail ?? 'Reconnecting…')
      if (event === 'error')        { setStreaming(false); setCdpError(detail ?? 'CDP error') }
    })

    const timer = setInterval(() => {
      if (bufferRef.current.length === 0) return
      const batch = bufferRef.current.splice(0)
      setEntries(prev => {
        const next = prev.concat(batch)
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    }, 100)

    return () => {
      offLogcat()
      offCdpLog()
      offCdpEvent()
      clearInterval(timer)
      void window.api.stopCdp()
      void window.api.stopLogcat()
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [entries, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  // ── Metro / CDP start — connection lives in main process (no Origin issue) ──
  const startMetro = useCallback(async () => {
    setCdpError(null)
    const raw = await window.api.getCdpTargets(metroPort)
    const targets = raw as Array<{ webSocketDebuggerUrl?: string; title?: string }>

    const target = targets.find(t =>
      t.webSocketDebuggerUrl &&
      !t.webSocketDebuggerUrl.includes('page=-1') &&
      !t.title?.includes('Reserve')
    ) ?? targets.find(t => t.webSocketDebuggerUrl)

    if (!target?.webSocketDebuggerUrl) {
      setCdpError(`No Hermes targets at localhost:${metroPort}. Is Metro running?`)
      return
    }

    // Delegate to main process — Node.js ws can set Origin header freely
    await window.api.startCdp(target.webSocketDebuggerUrl)
    // streaming state is driven by cdp-connected / cdp-closed / cdp-error events
  }, [metroPort])

  // ── Unified start / stop ──────────────────────────
  const start = async () => {
    setEntries([])
    if (source === 'metro') {
      await startMetro()
    } else {
      setStreaming(true)
      await window.api.startLogcat(device || undefined, logcatMode)
    }
  }

  const stop = async () => {
    if (source === 'metro') {
      await window.api.stopCdp()
    } else {
      await window.api.stopLogcat()
    }
    setStreaming(false)
  }

  const switchSource = async (s: 'metro' | 'logcat') => {
    if (streaming) await stop()
    setSource(s)
    setEntries([])
    setCdpError(null)
  }

  // ── Filtering ─────────────────────────────────────
  const filtered = entries.filter(e => {
    if (levelFilter !== 'all' && e.level !== levelFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!e.message.toLowerCase().includes(q) && !e.tag.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Render ────────────────────────────────────────
  return (
    <div className="logs-screen">

      {/* Source mode bar */}
      <div className="logs-source-bar">
        {(['metro', 'logcat'] as const).map(s => (
          <button
            key={s}
            className={`source-tab${source === s ? ' active' : ''}`}
            onClick={() => void switchSource(s)}
          >
            {s === 'metro' ? '⚡ Metro (CDP)' : '📋 Logcat'}
          </button>
        ))}
        <span className="source-hint">
          {source === 'metro'
            ? 'Source location for every log'
            : 'All device logs including native'}
        </span>
      </div>

      {/* Controls */}
      <div className="logs-controls">
        {source === 'metro' ? (
          <div className="control-row">
            <label className="control-label">Port</label>
            <input
              className="control-input"
              type="number"
              value={metroPort}
              onChange={e => setMetroPort(Number(e.target.value) || 8081)}
              disabled={streaming || portDetecting}
              style={{ width: 72 }}
              spellCheck={false}
            />
            {portDetecting && <span className="no-device">Detecting…</span>}
          </div>
        ) : (
          <>
            <div className="control-row">
              <label className="control-label">Device</label>
              {devices.length > 0 ? (
                <select className="control-select" value={device} onChange={e => setDevice(e.target.value)} disabled={streaming}>
                  {devices.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : (
                <span className="no-device">No devices</span>
              )}
            </div>
            <div className="control-row">
              <label className="control-label">Filter</label>
              <div className="mode-toggle">
                {(['rn', 'all'] as LogMode[]).map(m => (
                  <button key={m} className={`mode-btn${logcatMode === m ? ' active' : ''}`} onClick={() => setLogcatMode(m)} disabled={streaming}>
                    {m === 'rn' ? 'RN Only' : 'All'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="logs-search-wrap">
          <input className="control-input logs-search" placeholder="Filter logs…" value={search} onChange={e => setSearch(e.target.value)} spellCheck={false} />
        </div>

        <div className="logs-actions">
          {streaming ? (
            <button className="btn-stop btn-sm" onClick={stop}>■ Stop</button>
          ) : (
            <button className="btn-primary" onClick={start} disabled={source === 'logcat' && devices.length === 0}>
              ▶ Stream
            </button>
          )}
          <button className="btn-ghost" onClick={() => setEntries([])} disabled={entries.length === 0}>Clear</button>
        </div>
      </div>

      {cdpError && <div className="device-error">{cdpError}</div>}

      {/* Level filter */}
      <div className="logs-level-bar">
        {(['all', 'debug', 'info', 'warn', 'error'] as (LogLevel | 'all')[]).map(lvl => (
          <button
            key={lvl}
            className={`log-level-btn${levelFilter === lvl ? ' active' : ''}`}
            style={levelFilter === lvl && lvl !== 'all' ? { borderColor: LEVEL_COLORS[lvl as LogLevel], color: LEVEL_COLORS[lvl as LogLevel] } : undefined}
            onClick={() => setLevelFilter(lvl)}
          >
            {lvl === 'all' ? `All  ${entries.length}` : lvl.toUpperCase()}
          </button>
        ))}
        {streaming && (
          <span className="log-live-badge">
            <span className="rec-dot" style={{ display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />
            LIVE
          </span>
        )}
        {!autoScroll && entries.length > 0 && (
          <button className="log-scroll-btn" onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}>
            ↓ Resume scroll
          </button>
        )}
      </div>

      {/* Log list */}
      <div className="log-list" ref={containerRef} onScroll={handleScroll}>
        {!streaming && entries.length === 0 && (
          <div className="empty-state">
            <p>
              {source === 'metro'
                ? 'Press Stream to connect to Metro (make sure metro is running)'
                : devices.length === 0 ? 'Connect an Android device' : 'Press Stream to start capturing logs'}
            </p>
          </div>
        )}

        {filtered.map(entry => {
          // CDP entries have sourceFile directly; logcat entries may have it in message text
          const srcFile = entry.sourceFile ?? parseLocFromMessage(entry.message)?.file ?? null
          const srcLine = entry.sourceLine ?? parseLocFromMessage(entry.message)?.line ?? null
          const fullPath = srcFile ? (srcFile.startsWith('/') ? srcFile : `${projectPath}/${srcFile}`) : null
          // Always show just the bare filename (no directory, no query params)
          const basename = srcFile ? (srcFile.split('/').pop()?.split('?')[0] ?? srcFile) : null
          const display  = basename && srcLine ? `${basename}:${srcLine}` : null

          return (
            <div key={entry.id} className={`log-entry log-${entry.level}`}>
              <span className="log-time">{entry.time}</span>
              <span className="log-level-badge" style={{ color: LEVEL_COLORS[entry.level] }}>
                {LEVEL_LABELS[entry.level]}
              </span>
              {entry.tag !== 'ReactNativeJS' && (
                <span className="log-tag">{entry.tag}</span>
              )}
              <LogMessage message={entry.message} />
              {display && fullPath && srcLine && (
                <button
                  className="log-source-link"
                  onClick={() => void window.api.openInEditor(fullPath, srcLine, editor)}
                  title={`Open ${srcFile}:${srcLine}`}
                >
                  {display}
                </button>
              )}
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
