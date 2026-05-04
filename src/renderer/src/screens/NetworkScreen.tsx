import { useState, useEffect, useRef, useCallback } from 'react'
import type { NetworkEntry, NetworkEvent } from '@shared/types'
import { JsonNode } from '../components/JsonTree'
import { LogsScreen } from './LogsScreen'

// ── Helpers ───────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtType(mimeType?: string, resourceType?: string): string {
  if (!mimeType) {
    const rt = resourceType?.toLowerCase()
    return (rt === 'xhr' || rt === 'fetch') ? 'xhr' : ''
  }
  const slash = mimeType.indexOf('/')
  return slash >= 0 ? mimeType.slice(slash + 1) : mimeType
}

function ResourceTypeIcon({ resourceType }: { resourceType?: string }) {
  const type = resourceType?.toLowerCase()
  if (type !== 'xhr' && type !== 'fetch') return null
  return (
    <svg className="net-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M 6.5 1.5 A 5 5 0 0 1 11.5 6.5" stroke="#e07b3e" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M 10.2 4.2 L 11.5 6.5 L 9.3 6.2" stroke="#e07b3e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M 6.5 11.5 A 5 5 0 0 1 1.5 6.5" stroke="#e07b3e" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M 2.8 8.8 L 1.5 6.5 L 3.7 6.8" stroke="#e07b3e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function statusColor(status?: number, failed?: boolean): string {
  if (failed) return 'var(--red)'
  if (!status) return 'var(--text-dim)'
  if (status < 300) return 'var(--green)'
  if (status < 400) return 'var(--blue)'
  return 'var(--red)'
}

function methodColor(method: string): string {
  if (method === 'GET')    return '#60a5fa'
  if (method === 'POST')   return '#34d399'
  if (method === 'PUT')    return '#fbbf24'
  if (method === 'DELETE') return '#f87171'
  if (method === 'PATCH')  return '#a78bfa'
  return 'var(--text-secondary)'
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + (u.search ? u.search.slice(0, 40) + (u.search.length > 40 ? '…' : '') : '')
  } catch {
    return url
  }
}

// Show only the last path segment (e.g. /api/v1/system/init → init)
function lastSegment(url: string): string {
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    const name = segs[segs.length - 1] ?? u.pathname
    return name + (u.search ? u.search.slice(0, 30) + (u.search.length > 30 ? '…' : '') : '')
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

// Detect if a JSON response contains meaningful/rich data (nested objects or arrays of objects)
function isRichJson(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false
  if (Array.isArray(val)) return val.length > 0 && typeof val[0] === 'object' && val[0] !== null
  const obj = val as Record<string, unknown>
  const vals = Object.values(obj)
  if (vals.some(v => Array.isArray(v) && v.length > 0)) return true
  return vals.some(v => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v as object).length > 1)
}

type ParsedBody = { kind: 'json'; value: unknown } | { kind: 'text'; value: string }

function parseBody(body: string, mimeType?: string): ParsedBody {
  if (!body) return { kind: 'text', value: '' }
  const trimmed = body.trimStart()
  if (
    mimeType?.includes('json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    try {
      return { kind: 'json', value: JSON.parse(body) }
    } catch { /* */ }
  }
  return { kind: 'text', value: body }
}

// ── Types ─────────────────────────────────────────

type DetailTab = 'headers' | 'request' | 'response'

// ── Component ─────────────────────────────────────

interface Props {
  projectPath: string
}

export function NetworkScreen({ projectPath }: Props) {
  const [entries, setEntries]     = useState<NetworkEntry[]>([])
  const [selected, setSelected]   = useState<NetworkEntry | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('headers')
  const [search, setSearch]       = useState('')
  const [respBody, setRespBody]   = useState<ParsedBody | null>(null)
  const [loadingBody, setLoadingBody] = useState(false)

  // Detail panel resize
  const [detailPct, setDetailPct]     = useState(45)
  const networkBodyRef = useRef<HTMLDivElement>(null)
  const isDetailDragging = useRef(false)

  // Console panel (no header — close button lives inside LogsScreen's source bar)
  const [showConsole, setShowConsole] = useState(true)
  const [consolePct, setConsolePct]   = useState(38)
  const containerRef  = useRef<HTMLDivElement>(null)
  const isDragging    = useRef(false)

  // CDP connection tracking for reconnect modal
  const [cdpConnected, setCdpConnected] = useState<boolean | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [metroPort, setMetroPort]       = useState(8081)

  // Host column collapsed by default (path is more important)
  const [showHost, setShowHost] = useState(false)

  // Rich response: track which entries we've already checked
  const richCheckedRef = useRef(new Set<string>())

  // Network events listener
  useEffect(() => {
    const off = window.api.onNetworkEvent((event: NetworkEvent) => {
      setEntries(prev => {
        switch (event.type) {
          case 'request':
            return [...prev, {
              id: event.id,
              url: event.url,
              method: event.method,
              requestHeaders: event.headers,
              requestBody: event.body,
              resourceType: event.resourceType,
              startTime: event.startTime,
            }]
          case 'response':
            return prev.map(e => e.id !== event.id ? e : {
              ...e,
              status: event.status,
              statusText: event.statusText,
              responseHeaders: event.headers,
              mimeType: event.mimeType,
            })
          case 'done':
            return prev.map(e => e.id !== event.id ? e : {
              ...e,
              endTime: event.endTime,
              duration: event.endTime - e.startTime,
              size: event.size,
            })
          case 'fail':
            return prev.map(e => e.id !== event.id ? e : {
              ...e,
              endTime: event.endTime,
              duration: event.endTime - e.startTime,
              failed: true,
              errorText: event.error,
            })
          default: return prev
        }
      })
    })
    return off
  }, [])

  // CDP connection state for reconnect modal
  useEffect(() => {
    window.api.findMetroPort().then(r => { if (r) setMetroPort(r.port) })

    const off = window.api.onCdpEvent((event) => {
      if (event === 'connected') setCdpConnected(true)
      if (event === 'closed' || event === 'error') setCdpConnected(false)
    })
    return off
  }, [])

  // Keep selected entry in sync with entries list
  useEffect(() => {
    if (selected) {
      setSelected(prev => entries.find(e => e.id === prev?.id) ?? prev)
    }
  }, [entries])

  // Async rich-response detection: fetch body for completed JSON responses
  useEffect(() => {
    const candidates = entries.filter(e =>
      e.size != null &&
      e.size > 200 &&
      e.mimeType?.includes('json') &&
      e.richResponse === undefined &&
      !richCheckedRef.current.has(e.id)
    )
    if (candidates.length === 0) return

    for (const entry of candidates) {
      richCheckedRef.current.add(entry.id)
      window.api.getNetworkResponseBody(entry.id).then(res => {
        if (!res) return
        const body = res.base64Encoded ? atob(res.body) : res.body
        try {
          const parsed = JSON.parse(body)
          const rich = isRichJson(parsed)
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, richResponse: rich } : e))
        } catch { /* not JSON */ }
      })
    }
  }, [entries])

  // ── Reconnect ─────────────────────────────────────

  const reconnect = useCallback(async () => {
    setReconnecting(true)
    try {
      const raw = await window.api.getCdpTargets(metroPort)
      const targets = raw as Array<{ webSocketDebuggerUrl?: string; title?: string }>
      const target =
        targets.find(t =>
          t.webSocketDebuggerUrl &&
          !t.webSocketDebuggerUrl.includes('page=-1') &&
          !t.title?.includes('Reserve')
        ) ?? targets.find(t => t.webSocketDebuggerUrl)
      if (target?.webSocketDebuggerUrl) {
        await window.api.startCdp(target.webSocketDebuggerUrl)
      }
    } finally {
      setReconnecting(false)
    }
  }, [metroPort])

  // ── Dividers ──────────────────────────────────────

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100
      setConsolePct(Math.max(15, Math.min(70, pct)))
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const onDetailDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDetailDragging.current = true

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDetailDragging.current || !networkBodyRef.current) return
      const rect = networkBodyRef.current.getBoundingClientRect()
      const pct = ((rect.right - ev.clientX) / rect.width) * 100
      setDetailPct(Math.max(20, Math.min(75, pct)))
    }

    const onMouseUp = () => {
      isDetailDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ── Body fetching ─────────────────────────────────

  const fetchResponseBody = async (entry: NetworkEntry) => {
    setRespBody(null)
    setLoadingBody(true)
    try {
      const res = await window.api.getNetworkResponseBody(entry.id)
      if (res) {
        const body = res.base64Encoded ? atob(res.body) : res.body
        setRespBody(parseBody(body, entry.mimeType))
      } else {
        setRespBody({ kind: 'text', value: '(no body)' })
      }
    } catch {
      setRespBody({ kind: 'text', value: '(failed to fetch body)' })
    } finally {
      setLoadingBody(false)
    }
  }

  const handleSelect = (entry: NetworkEntry) => {
    setSelected(entry)
    setRespBody(null)
    // Keep the active tab — if response is already open, auto-fetch for the new entry
    if (detailTab === 'response') {
      void fetchResponseBody(entry)
    }
  }

  const handleDetailTab = (tab: DetailTab) => {
    setDetailTab(tab)
    if (tab === 'response' && selected && respBody === null && !loadingBody) {
      void fetchResponseBody(selected)
    }
  }

  const filtered = entries.filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return e.url.toLowerCase().includes(q) || e.method.toLowerCase().includes(q)
  })

  // ── Grid layout ───────────────────────────────────

  const gridCols = showHost
    ? '52px 60px 130px 1fr 64px 64px 80px'
    : '52px 60px 18px 1fr 64px 64px 80px'

  // ── Network panel ─────────────────────────────────

  const networkPanel = (
    <div className="network-screen">
      {/* Reconnect modal overlay */}
      {cdpConnected === false && (
        <div className="reconnect-overlay">
          <div className="reconnect-modal">
            <span className="reconnect-icon">⚡</span>
            <p className="reconnect-title">Metro disconnected</p>
            <p className="reconnect-hint">Make sure Metro is running on port {metroPort}</p>
            <button
              className="btn-primary"
              onClick={reconnect}
              disabled={reconnecting}
            >
              {reconnecting ? 'Connecting…' : 'Reconnect'}
            </button>
          </div>
        </div>
      )}

      <div className="network-toolbar">
        <button className="btn-ghost btn-sm" onClick={() => { setEntries([]); setSelected(null) }}>
          Clear
        </button>
        <input
          className="control-input network-search"
          placeholder="Filter by URL or method…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          spellCheck={false}
        />
        <span className="network-count">{filtered.length} requests</span>
        <button
          className={`btn-ghost btn-sm${showConsole ? ' active' : ''}`}
          onClick={() => setShowConsole(v => !v)}
          title={showConsole ? 'Hide console' : 'Show console'}
        >
          Console
        </button>
      </div>

      <div className="network-body" ref={networkBodyRef}>
        <div
          className="network-list"
          style={selected ? { flex: `0 0 ${100 - detailPct}%`, minWidth: 120 } : undefined}
        >
          {/* Header */}
          <div className="net-row net-header" style={{ gridTemplateColumns: gridCols }}>
            <span className="net-col-status">Status</span>
            <span className="net-col-method">Method</span>
            <button
              className="net-col-host net-host-toggle"
              onClick={() => setShowHost(v => !v)}
              title={showHost ? 'Collapse host column' : 'Expand host column'}
            >
              {showHost ? '▾' : '▸'}
            </button>
            <span className="net-col-path">Path</span>
            <span className="net-col-size">Size</span>
            <span className="net-col-time">Time</span>
            <span className="net-col-type">Type</span>
          </div>

          {filtered.length === 0 && (
            <div className="empty-state">
              <p>Network requests will appear here when Metro (CDP) is connected</p>
            </div>
          )}

          {filtered.map(entry => (
            <div
              key={entry.id}
              className={[
                'net-row net-entry',
                selected?.id === entry.id ? 'selected' : '',
                entry.failed ? 'failed' : '',
                entry.richResponse ? 'rich' : '',
              ].filter(Boolean).join(' ')}
              style={{ gridTemplateColumns: gridCols }}
              onClick={() => handleSelect(entry)}
            >
              <span className="net-col-status" style={{ color: statusColor(entry.status, entry.failed) }}>
                {entry.failed ? '✗' : entry.status ?? '…'}
              </span>
              <span className="net-col-method" style={{ color: methodColor(entry.method) }}>
                {entry.method}
              </span>
              <span
                className="net-col-host"
                style={!showHost ? { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip', opacity: 0 } : undefined}
              >
                {showHost ? hostOf(entry.url) : ''}
              </span>
              <span className="net-col-path">
                <ResourceTypeIcon resourceType={entry.resourceType} />
                <span className="net-path-text" title={shortUrl(entry.url)}>{lastSegment(entry.url)}</span>
              </span>
              <span className="net-col-size">{entry.size != null ? fmtSize(entry.size) : '…'}</span>
              <span className="net-col-time">
                {entry.duration != null ? fmtDuration(entry.duration) : entry.endTime ? '—' : '…'}
              </span>
              <span className="net-col-type">{fmtType(entry.mimeType, entry.resourceType)}</span>
            </div>
          ))}
        </div>

        {selected && (
          <div
            className="net-detail-divider"
            onMouseDown={onDetailDividerMouseDown}
            title="Drag to resize"
          >
            <div className="net-detail-divider-handle" />
          </div>
        )}

        {selected && (
          <div className="net-detail" style={{ flex: `0 0 ${detailPct}%`, minWidth: 160 }}>
            <div className="net-detail-header">
              <span className="net-detail-method" style={{ color: methodColor(selected.method) }}>{selected.method}</span>
              <span className="net-detail-url">{selected.url}</span>
              <button className="net-detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="net-detail-tabs">
              {(['headers', 'request', 'response'] as DetailTab[]).map(tab => (
                <button
                  key={tab}
                  className={`net-tab${detailTab === tab ? ' active' : ''}`}
                  onClick={() => handleDetailTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="net-detail-body">
              {detailTab === 'headers' && (
                <div className="net-headers">
                  {selected.status && (
                    <div className="net-header-group">
                      <div className="net-header-title">General</div>
                      <HeaderRow k="Status" v={`${selected.status} ${selected.statusText ?? ''}`} />
                      <HeaderRow k="URL" v={selected.url} />
                      <HeaderRow k="Method" v={selected.method} />
                    </div>
                  )}
                  {selected.responseHeaders && Object.keys(selected.responseHeaders).length > 0 && (
                    <div className="net-header-group">
                      <div className="net-header-title">Response Headers</div>
                      {Object.entries(selected.responseHeaders).map(([k, v]) => (
                        <HeaderRow key={k} k={k} v={v} />
                      ))}
                    </div>
                  )}
                  {selected.requestHeaders && Object.keys(selected.requestHeaders).length > 0 && (
                    <div className="net-header-group">
                      <div className="net-header-title">Request Headers</div>
                      {Object.entries(selected.requestHeaders).map(([k, v]) => (
                        <HeaderRow key={k} k={k} v={v} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'request' && (() => {
                if (!selected.requestBody) {
                  return <div className="empty-state"><p className="net-empty">(no request body)</p></div>
                }
                const parsed = parseBody(selected.requestBody)
                return parsed.kind === 'json'
                  ? <div className="net-json-body"><JsonNode value={parsed.value as never} depth={0} defaultExpanded /></div>
                  : <pre className="net-body-pre">{parsed.value}</pre>
              })()}

              {detailTab === 'response' && (
                loadingBody
                  ? <div className="empty-state"><div className="spinner" /><p>Loading…</p></div>
                  : respBody
                    ? respBody.kind === 'json'
                      ? <div className="net-json-body">
                          <JsonNode value={respBody.value as never} depth={0} defaultExpanded />
                        </div>
                      : <pre className="net-body-pre">{respBody.value || <span className="net-empty">(empty)</span>}</pre>
                    : <div className="empty-state"><p className="net-empty">Click Response tab to load</p></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="network-with-console" ref={containerRef}>
      <div style={{
        flex: showConsole ? `0 0 ${100 - consolePct}%` : '1',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
      }}>
        {networkPanel}
      </div>

      {/* Divider — only visible when console is open */}
      <div
        className="console-divider"
        onMouseDown={onDividerMouseDown}
        style={{ display: showConsole ? 'flex' : 'none' }}
      >
        <div className="console-divider-handle" />
      </div>

      {/* Console pane — no header bar; close button is inside LogsScreen's source tab bar */}
      <div
        className="console-pane"
        style={{ flex: 1, minHeight: 0, display: showConsole ? 'flex' : 'none' }}
      >
        <div className="console-body">
          <LogsScreen projectPath={projectPath} onClose={() => setShowConsole(false)} />
        </div>
      </div>
    </div>
  )
}

function HeaderRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="net-header-row">
      <span className="net-header-key">{k}:</span>
      <span className="net-header-val">{v}</span>
    </div>
  )
}
