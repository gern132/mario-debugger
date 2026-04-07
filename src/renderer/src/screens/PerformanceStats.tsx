import { useState, useEffect, useRef } from 'react'
import type { PerformanceStats } from '@shared/types'

interface Props { projectPath: string }

type SessionMode = 'timed' | 'manual'
type SessionState = 'idle' | 'recording' | 'reading'

const DURATIONS = [10, 15, 30, 60] as const
type Duration = typeof DURATIONS[number]

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// Android counts any frame >16.67ms as janky (1 vsync at 60Hz).
// RN apps only render on change, so 200 frames / 30s = ~6.7fps render rate — normal.
// Realistic thresholds for RN:  ≤10% great, ≤25% acceptable, >25% needs work.
function jankyStatus(pct: number) {
  if (pct <= 10) return { label: 'Smooth',     color: 'var(--green)',  cls: 'good' }
  if (pct <= 25) return { label: 'Acceptable', color: 'var(--yellow)', cls: 'warn' }
  return             { label: 'Needs work',  color: 'var(--red)',    cls: 'bad'  }
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function PerformanceStatsScreen({ projectPath }: Props) {
  const [devices, setDevices]         = useState<string[]>([])
  const [device, setDevice]           = useState('')
  const [pkg, setPkg]                 = useState('')
  const [sessionMode, setSessionMode] = useState<SessionMode>('timed')
  const [duration, setDuration]       = useState<Duration>(30)
  const [sessionState, setSessionState] = useState<SessionState>('idle')
  const [elapsed, setElapsed]         = useState(0)
  const [stats, setStats]             = useState<PerformanceStats | null>(null)
  const [sessionSec, setSessionSec]   = useState(0)
  const [error, setError]             = useState<string | null>(null)

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => { void init() }, [])
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const init = async () => {
    const [devs, detected] = await Promise.all([
      window.api.getAdbDevices(),
      window.api.detectPackageName(projectPath),
    ])
    setDevices(devs)
    if (devs[0]) setDevice(devs[0])
    if (detected) setPkg(detected)
  }

  const startSession = async () => {
    if (!pkg.trim()) return
    setError(null)
    setStats(null)
    elapsedRef.current = 0
    setElapsed(0)

    try {
      await window.api.resetGfxStats(pkg.trim(), device || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset stats')
      return
    }

    setSessionState('recording')

    const isTimed = sessionMode === 'timed'
    const target  = duration

    timerRef.current = setInterval(() => {
      elapsedRef.current += 1
      setElapsed(elapsedRef.current)

      if (isTimed && elapsedRef.current >= target) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        void readStats()
      }
    }, 1000)
  }

  const readStats = async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setSessionSec(elapsedRef.current)
    setSessionState('reading')
    try {
      const result = await window.api.readPerformanceStats(pkg.trim(), device || undefined)
      setStats(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read stats')
    } finally {
      setSessionState('idle')
    }
  }

  const isRecording = sessionState === 'recording'
  const isReading   = sessionState === 'reading'
  const isBusy      = isRecording || isReading
  const noDevice    = devices.length === 0

  const progress = sessionMode === 'timed' && isRecording
    ? Math.min((elapsed / duration) * 100, 100)
    : null

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
            disabled={isBusy}
          />
        </div>
        <div className="control-row">
          <label className="control-label">Device</label>
          {devices.length > 0 ? (
            <select
              className="control-select"
              value={device}
              onChange={e => setDevice(e.target.value)}
              disabled={isBusy}
            >
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <span className="no-device">No devices connected</span>
          )}
        </div>
      </div>

      {/* Session config */}
      {!isBusy && (
        <div className="session-config">
          <div className="session-mode-row">
            <span className="control-label">Mode</span>
            <div className="mode-toggle">
              <button
                className={`mode-btn${sessionMode === 'timed' ? ' active' : ''}`}
                onClick={() => setSessionMode('timed')}
              >
                Timed
              </button>
              <button
                className={`mode-btn${sessionMode === 'manual' ? ' active' : ''}`}
                onClick={() => setSessionMode('manual')}
              >
                Manual
              </button>
            </div>
          </div>

          {sessionMode === 'timed' && (
            <div className="duration-row">
              <span className="control-label">Duration</span>
              <div className="duration-options">
                {DURATIONS.map(d => (
                  <button
                    key={d}
                    className={`duration-btn${duration === d ? ' active' : ''}`}
                    onClick={() => setDuration(d)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {sessionMode === 'manual' && (
            <p className="manual-hint">
              Start the session, interact with your app, then stop manually.
            </p>
          )}

          <button
            className="btn-primary btn-start"
            onClick={startSession}
            disabled={!pkg.trim() || noDevice}
          >
            ▶ Start Session
          </button>
        </div>
      )}

      {/* Recording state */}
      {isRecording && (
        <div className="session-recording">
          <div className="recording-header">
            <span className="rec-dot" />
            <span className="rec-label">Recording</span>
            <span className="rec-time">{fmtTime(elapsed)}</span>
            {sessionMode === 'timed' && (
              <span className="rec-target">/ {fmtTime(duration)}</span>
            )}
          </div>

          {progress !== null && (
            <div className="rec-progress-track">
              <div
                className="rec-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <p className="rec-hint">
            {sessionMode === 'timed'
              ? 'Interact with your app — stats will be read automatically when time is up.'
              : 'Interact with your app, then click Stop when done.'}
          </p>

          {sessionMode === 'manual' && (
            <button className="btn-stop" onClick={readStats}>
              ■ Stop & Read
            </button>
          )}
        </div>
      )}

      {isReading && (
        <div className="empty-state">
          <div className="spinner" />
          <p>Reading frame stats…</p>
        </div>
      )}

      {error && <div className="device-error">{error}</div>}

      {/* Idle — no stats yet */}
      {sessionState === 'idle' && !stats && !error && (
        <div className="empty-state">
          <p>Configure a session above and press Start</p>
        </div>
      )}

      {/* Results */}
      {stats && sessionState === 'idle' && (() => {
        const renderFps   = sessionSec > 0 ? stats.totalFrames / sessionSec : 0
        const isIdle      = renderFps < 2 || stats.totalFrames < 30
        const status      = isIdle ? null : jankyStatus(stats.jankyPercent)
        const maxMs       = Math.max(stats.p99, 32)

        return (
          <div className="stats-body">
            {isIdle ? (
              <>
                <div className="status-badge good">Idle</div>
                <div className="perf-summary">
                  <span className="perf-big">{stats.totalFrames}</span>
                  <span className="perf-sub">frames</span>
                  <span className="perf-sep">·</span>
                  <span className="perf-big">{renderFps.toFixed(1)}</span>
                  <span className="perf-sub">fps avg</span>
                </div>
                <div className="perf-note idle">
                  ✓ No active rendering detected — the screen was static.
                  RN only renders when something changes, so near-zero fps on a
                  still screen is correct and efficient behavior.
                  Interact with the app (scroll, navigate, animations) to get
                  meaningful frame stats.
                </div>
              </>
            ) : (
              <>
                <div className={`status-badge ${status!.cls}`}>{status!.label}</div>
                <div className="perf-summary">
                  <span className="perf-big">{stats.totalFrames.toLocaleString()}</span>
                  <span className="perf-sub">frames</span>
                  <span className="perf-sep">·</span>
                  <span className="perf-big" style={{ color: status!.color }}>
                    {stats.jankyPercent.toFixed(1)}%
                  </span>
                  <span className="perf-sub">janky</span>
                  <span className="perf-sep">·</span>
                  <span className="perf-big">{renderFps.toFixed(1)}</span>
                  <span className="perf-sub">fps avg</span>
                </div>
                <div className="perf-note">
                  Janky = frame &gt;16ms (1 vsync at 60Hz). Threshold: ≤10% great, ≤25% acceptable.
                </div>
              </>
            )}

            {!isIdle && <>
              <div className="section-label">Frame times</div>
              <div className="metric-list">
                {([
                  { label: 'P50', value: stats.p50 },
                  { label: 'P90', value: stats.p90 },
                  { label: 'P95', value: stats.p95 },
                  { label: 'P99', value: stats.p99 },
                ] as const).map(({ label, value }) => {
                  const color = value <= 16 ? 'var(--green)' : value <= 32 ? 'var(--yellow)' : 'var(--red)'
                  return (
                    <div key={label} className="metric-row">
                      <div className="metric-row-top">
                        <span className="metric-label perf-label">{label}</span>
                        <span className="metric-value" style={{ color }}>{value}ms</span>
                      </div>
                      <Bar value={value} max={maxMs} color={color} />
                    </div>
                  )
                })}
              </div>

              <div className="section-label" style={{ marginTop: 16 }}>Frame issues</div>
              <div className="detail-rows">
                <div className="detail-row">
                  <span>Slow UI thread</span>
                  <span className={stats.slowUiThread > 10 ? 'warn-text' : ''}>{stats.slowUiThread} frames</span>
                </div>
                <div className="detail-row">
                  <span>Missed VSync</span>
                  <span className={stats.missedVsync > 10 ? 'warn-text' : ''}>{stats.missedVsync} frames</span>
                </div>
                <div className="detail-row">
                  <span>Janky frames</span>
                  <span>{stats.jankyFrames} / {stats.totalFrames}</span>
                </div>
              </div>
            </>}

            <p className="stats-time">
              Measured at {new Date(stats.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </p>
          </div>
        )
      })()}
    </div>
  )
}
