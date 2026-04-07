import { useState, useEffect, useRef } from 'react'
import type { MemoryStats } from '@shared/types'

interface Props {
  projectPath: string
}

function fmt(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

const ROWS: { key: keyof MemoryStats; label: string; color: string }[] = [
  { key: 'nativeHeap', label: 'Native Heap', color: '#ff6b6b' },
  { key: 'javaHeap',   label: 'Java Heap',   color: '#4ecdc4' },
  { key: 'graphics',   label: 'Graphics',    color: '#a78bfa' },
  { key: 'code',       label: 'Code',        color: '#60a5fa' },
  { key: 'system',     label: 'System',      color: '#94a3b8' },
  { key: 'stack',      label: 'Stack',       color: '#64748b' },
]

export function MemoryStatsScreen({ projectPath }: Props) {
  const [devices, setDevices]       = useState<string[]>([])
  const [device, setDevice]         = useState<string>('')
  const [pkg, setPkg]               = useState('')
  const [stats, setStats]           = useState<MemoryStats | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showRaw, setShowRaw]       = useState(false)
  const rawRef                      = useRef<string>('')

  useEffect(() => {
    void init()
  }, [])

  const init = async () => {
    const [devs, detected] = await Promise.all([
      window.api.getAdbDevices(),
      window.api.detectPackageName(projectPath),
    ])
    setDevices(devs)
    if (devs[0]) setDevice(devs[0])
    if (detected) setPkg(detected)
  }

  const measure = async () => {
    if (!pkg.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getMemoryStats(pkg.trim(), device || undefined)
      rawRef.current = result._raw ?? ''
      setStats(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read memory stats')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="device-panel">
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
            <select
              className="control-select"
              value={device}
              onChange={e => setDevice(e.target.value)}
            >
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <span className="no-device">No devices connected</span>
          )}
        </div>
        <button
          className={`btn-primary${loading ? ' running' : ''}`}
          onClick={measure}
          disabled={loading || !pkg.trim() || devices.length === 0}
        >
          {loading ? '⏳ Reading...' : '▶ Measure'}
        </button>
      </div>

      {error && <div className="device-error">{error}</div>}

      {!stats && !loading && (
        <div className="empty-state">
          <p>Connect an Android device and press Measure</p>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <div className="spinner" />
          <p>Reading memory stats...</p>
        </div>
      )}

      {stats && !loading && (
        <div className="stats-body">
          <div className="total-pss">
            <span className="total-label">Total PSS</span>
            <span className="total-value">{fmt(stats.totalPss)}</span>
          </div>

          <div className="metric-list">
            {ROWS.map(({ key, label, color }) => {
              const val = stats[key] as number
              return (
                <div key={key} className="metric-row">
                  <div className="metric-row-top">
                    <span className="metric-dot" style={{ background: color }} />
                    <span className="metric-label">{label}</span>
                    <span className="metric-value">{fmt(val)}</span>
                  </div>
                  <Bar value={val} max={stats.totalPss} color={color} />
                </div>
              )
            })}
          </div>

          <p className="stats-time">
            Measured at {new Date(stats.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            })}
          </p>

          <div className="raw-section">
            <button
              className="raw-toggle"
              onClick={() => setShowRaw(v => !v)}
            >
              {showRaw ? '▾' : '▸'} Raw adb output
            </button>
            {showRaw && (
              <pre className="raw-output">{rawRef.current || '(empty)'}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
