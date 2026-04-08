import { useState, useEffect, useRef } from 'react'
import type { MemoryStats } from '@shared/types'

interface Props {
  projectPath: string
}

// ── Helpers ───────────────────────────────────────

function fmt(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

function pctStr(value: number, total: number): string {
  if (!total || !value) return ''
  return `${Math.round((value / total) * 100)}%`
}

function totalPssColor(kb: number): string {
  if (kb > 307200) return 'var(--red)'     // > 300 MB
  if (kb > 153600) return 'var(--yellow)'  // > 150 MB
  return 'var(--text)'
}

// Native Heap is the JS heap for RN (Hermes runs native) — most critical metric
function nativeHeapColor(kb: number): string | undefined {
  if (kb > 153600) return 'var(--red)'    // > 150 MB
  if (kb > 81920)  return 'var(--yellow)' // > 80 MB
  return 'var(--green)'
}

// ── Sparkline ─────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 64
  const H = 20
  if (data.length < 2) return <div style={{ width: W, height: H, flexShrink: 0 }} />
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (W - 2) + 1
    const y = (H - 4) - ((v - min) / range) * (H - 8) + 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
    </svg>
  )
}

// ── Bar ───────────────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ── Row config ────────────────────────────────────

const ROWS: {
  key: keyof MemoryStats
  label: string
  desc: string
  color: string
}[] = [
  { key: 'nativeHeap', label: 'Native Heap', desc: 'JS engine (Hermes) + C++ libs — the JS heap',  color: '#ff6b6b' },
  { key: 'javaHeap',   label: 'Java Heap',   desc: 'Android views, bridge & Java allocations',     color: '#4ecdc4' },
  { key: 'graphics',   label: 'Graphics',    desc: 'GPU textures, framebuffers, render targets',   color: '#a78bfa' },
  { key: 'code',       label: 'Code',        desc: 'Memory-mapped .so, .dex, .apk files',          color: '#60a5fa' },
  { key: 'system',     label: 'Other',       desc: 'JIT code, anonymous private allocations',      color: '#94a3b8' },
  { key: 'stack',      label: 'Stack',       desc: 'Thread stacks (usually small)',                color: '#64748b' },
]

// ── Screen ────────────────────────────────────────

export function MemoryStatsScreen({ projectPath }: Props) {
  const [devices, setDevices]         = useState<string[]>([])
  const [device, setDevice]           = useState<string>('')
  const [pkg, setPkg]                 = useState('')
  const [stats, setStats]             = useState<MemoryStats | null>(null)
  const [history, setHistory]         = useState<MemoryStats[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showRaw, setShowRaw]         = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const rawRef     = useRef<string>('')
  const measureRef = useRef<() => void>()

  useEffect(() => { void init() }, [])

  const init = async () => {
    const [devs, detected] = await Promise.all([
      window.api.getAdbDevices(),
      window.api.detectPackageName(projectPath),
    ])
    setDevices(devs)
    if (devs[0]) setDevice(devs[0])
    if (detected) setPkg(detected)
  }

  const measure = async (silent = false) => {
    if (!pkg.trim()) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      const result = await window.api.getMemoryStats(pkg.trim(), device || undefined)
      rawRef.current = result._raw ?? ''
      setStats(result)
      setHistory(prev => [...prev.slice(-19), result])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read memory stats')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Keep ref fresh so the interval always calls latest version
  measureRef.current = () => { void measure(true) }

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => measureRef.current?.(), 5000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  // Discrepancy = totalPss - sum of named buckets ≈ "Shared" overhead
  const accounted   = stats ? ROWS.reduce((s, r) => s + ((stats[r.key] as number) ?? 0), 0) : 0
  const discrepancy = stats ? stats.totalPss - accounted : 0

  return (
    <div className="device-panel">

      {/* Controls */}
      <div className="device-controls">
        <div className="control-row">
          <label className="control-label">Package</label>
          <input
            className="control-input"
            value={pkg}
            onChange={e => setPkg(e.target.value)}
            placeholder="com.example.app"
            spellCheck={false}
          />
        </div>
        <div className="control-row">
          <label className="control-label">Device</label>
          {devices.length > 0 ? (
            <select className="control-select" value={device} onChange={e => setDevice(e.target.value)}>
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <span className="no-device">No devices connected</span>
          )}
        </div>
        <button
          className={`btn-primary${loading ? ' running' : ''}`}
          onClick={() => void measure()}
          disabled={loading || !pkg.trim() || devices.length === 0}
        >
          {loading ? '⏳ Reading…' : '▶ Measure'}
        </button>
        {stats && (
          <button
            className={`btn-ghost btn-sm${autoRefresh ? ' mem-live-btn' : ''}`}
            onClick={() => setAutoRefresh(v => !v)}
            disabled={!pkg.trim() || devices.length === 0}
            title="Auto-refresh every 5 seconds"
          >
            {autoRefresh
              ? <><span className="rec-dot" style={{ display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />Live</>
              : '↻ Auto'}
          </button>
        )}
      </div>

      {error && <div className="device-error">{error}</div>}

      {stats?.buildType === 'debug' && (
        <div className="build-type-banner debug">
          <span className="build-type-icon">⚠</span>
          <div>
            <strong>Debug build</strong> — memory is typically 2–3× higher than Release.
            <span className="build-type-sub"> Metro bundle, Flipper, dev tools and uncompiled JS inflate all metrics. Measure a Release build for accurate profiling.</span>
          </div>
        </div>
      )}
      {stats?.buildType === 'release' && (
        <div className="build-type-banner release">
          <span className="build-type-icon">✓</span>
          <strong>Release build</strong> — accurate memory profile (Hermes bytecode, no dev tools).
        </div>
      )}

      {!stats && !loading && (
        <div className="empty-state">
          <p>Connect an Android device and press Measure</p>
        </div>
      )}

      {loading && !stats && (
        <div className="empty-state">
          <div className="spinner" />
          <p>Reading memory stats…</p>
        </div>
      )}

      {stats && (
        <div className="stats-body">

          {/* Total PSS */}
          <div className="total-pss">
            <div>
              <span className="total-label">Total PSS</span>
              <span className="total-sublabel">Proportional Set Size — true memory footprint</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="total-value" style={{ color: totalPssColor(stats.totalPss) }}>
                {fmt(stats.totalPss)}
              </span>
              {stats.buildType !== 'unknown' && (
                <span className={`build-badge ${stats.buildType}`}>
                  {stats.buildType}
                </span>
              )}
            </div>
          </div>

          {/* Metric rows */}
          <div className="metric-list">
            {ROWS.map(({ key, label, desc, color }) => {
              const val      = (stats[key] as number) ?? 0
              const hColor   = key === 'nativeHeap' ? nativeHeapColor(val) : undefined
              const sparkData = history.map(s => (s[key] as number) ?? 0)

              return (
                <div key={key} className="metric-row">
                  <div className="metric-row-top">
                    <span className="metric-dot" style={{ background: color }} />
                    <div className="metric-info">
                      <div className="metric-label-row">
                        <span className="metric-label">{label}</span>
                        {hColor && <span className="metric-health-dot" style={{ background: hColor }} />}
                      </div>
                      <span className="metric-desc">{desc}</span>
                    </div>
                    <div className="metric-value-group">
                      <span className="metric-value" style={hColor ? { color: hColor } : undefined}>
                        {fmt(val)}
                      </span>
                      <span className="metric-pct">{pctStr(val, stats.totalPss)}</span>
                    </div>
                    {sparkData.length >= 2 && <Sparkline data={sparkData} color={color} />}
                  </div>
                  <Bar value={val} max={stats.totalPss} color={color} />
                </div>
              )
            })}

            {/* Shared overhead — difference between totalPss and named buckets */}
            {discrepancy > 512 && (
              <div className="metric-row">
                <div className="metric-row-top">
                  <span className="metric-dot" style={{ background: 'var(--text-dim)', opacity: 0.4 }} />
                  <div className="metric-info">
                    <div className="metric-label-row">
                      <span className="metric-label" style={{ color: 'var(--text-dim)' }}>Shared</span>
                    </div>
                    <span className="metric-desc">Proportional shared-library overhead</span>
                  </div>
                  <div className="metric-value-group">
                    <span className="metric-value" style={{ color: 'var(--text-dim)' }}>{fmt(discrepancy)}</span>
                    <span className="metric-pct">{pctStr(discrepancy, stats.totalPss)}</span>
                  </div>
                </div>
                <Bar value={discrepancy} max={stats.totalPss} color="var(--text-dim)" />
              </div>
            )}
          </div>

          <p className="stats-time">
            {autoRefresh ? 'Refreshing every 5s · ' : ''}
            Measured at {new Date(stats.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            })}
            {history.length > 1 ? ` · ${history.length} snapshots` : ''}
          </p>

          <div className="raw-section">
            <button className="raw-toggle" onClick={() => setShowRaw(v => !v)}>
              {showRaw ? '▾' : '▸'} Raw adb output
            </button>
            {showRaw && <pre className="raw-output">{rawRef.current || '(empty)'}</pre>}
          </div>
        </div>
      )}
    </div>
  )
}
