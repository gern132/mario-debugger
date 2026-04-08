import { useState, useEffect, useRef } from 'react'
import type { PerformanceStats } from '@shared/types'

interface Props { projectPath: string }

type SessionMode  = 'timed' | 'manual'
type SessionState = 'idle' | 'recording' | 'reading'

const DURATIONS = [10, 15, 30, 60] as const
type Duration = typeof DURATIONS[number]

// ── Helpers ───────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// Frame budget in ms for the given refresh rate
function budget(hz: number): number {
  return parseFloat((1000 / hz).toFixed(1))
}

function frameColor(ms: number, budgetMs: number): string {
  if (ms <= budgetMs)       return 'var(--green)'
  if (ms <= budgetMs * 2)   return 'var(--yellow)'
  return 'var(--red)'
}

// For React Native we use SEVERE jank (>32ms) as the primary quality indicator.
// Android's built-in jankyPercent uses >16ms which counts imperceptible frames
// caused by RN's bridge overhead, giving misleadingly high numbers.
function jankyStatus(s: PerformanceStats) {
  if (s.totalFrames > 0 && (s.mildJankFrames + s.severeJankFrames > 0 || s.jankyFrames === 0)) {
    const severePct = (s.severeJankFrames / s.totalFrames) * 100
    if (severePct <= 2)  return { label: 'Smooth',     color: 'var(--green)',  cls: 'good' }
    if (severePct <= 8)  return { label: 'Acceptable', color: 'var(--yellow)', cls: 'warn' }
    return                      { label: 'Needs work',  color: 'var(--red)',    cls: 'bad'  }
  }
  // Fallback when histogram unavailable: use looser RN-adjusted thresholds
  if (s.jankyPercent <= 15) return { label: 'Smooth',     color: 'var(--green)',  cls: 'good' }
  if (s.jankyPercent <= 35) return { label: 'Acceptable', color: 'var(--yellow)', cls: 'warn' }
  return                           { label: 'Needs work',  color: 'var(--red)',    cls: 'bad'  }
}

// ── Insights ──────────────────────────────────────

interface Insight { kind: 'warn' | 'info'; text: string }

function getInsights(s: PerformanceStats, budgetMs: number): Insight[] {
  const out: Insight[] = []
  const severePct = s.totalFrames > 0 ? (s.severeJankFrames / s.totalFrames) * 100 : 0

  if (s.buildType === 'debug') {
    out.push({ kind: 'warn', text: 'Debug build: Hermes runs in interpreter mode — perf is significantly worse than Release. Always profile Release builds.' })
  }

  const isUiBottleneck = s.slowUiThread > 0 && s.slowUiThread >= s.missedVsync
  if (isUiBottleneck && s.slowUiThread > 5) {
    out.push({ kind: 'warn', text: `UI thread is the main bottleneck (${s.slowUiThread} slow frames). Likely: heavy JS bridge calls, synchronous operations, or expensive layout traversals. Profile with Flipper Performance Monitor.` })
  } else if (s.missedVsync > s.totalFrames * 0.1) {
    out.push({ kind: 'warn', text: `High VSync misses (${s.missedVsync} frames). CPU/GPU is overloaded — check for overdraw, expensive animations or heavy background work.` })
  }

  if (s.slowBitmapUploads > 5) {
    out.push({ kind: 'warn', text: `${s.slowBitmapUploads} bitmap upload stalls — large images are blocking the render thread. Use smaller resolutions, FastImage, or preload images before displaying.` })
  }

  if (s.slowDrawCommands > 5) {
    out.push({ kind: 'warn', text: `${s.slowDrawCommands} slow GPU command submissions. Reduce overdraw or complex canvas operations.` })
  }

  if (s.p99 > budgetMs * 6) {
    out.push({ kind: 'warn', text: `P99 spike of ${s.p99}ms is ${Math.round(s.p99 / budgetMs)}× over budget — occasional heavy operations cause visible freezes (navigation, large list renders?).` })
  }

  if (severePct <= 2 && s.buildType !== 'debug' && s.totalFrames > 30) {
    out.push({ kind: 'info', text: 'Solid rendering performance — almost no user-visible stutter.' })
  }

  out.push({ kind: 'info', text: 'gfxinfo measures the render/GPU thread only. For JS thread profiling use Flipper Performance Monitor or Android Systrace.' })

  return out
}

// ── Sub-components ────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function IssueRow({
  label, desc, value, total, color,
}: {
  label: string; desc: string; value: number; total: number; color: string
}) {
  if (value === 0) return null
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
  return (
    <div className="metric-row">
      <div className="metric-row-top">
        <div className="metric-info">
          <div className="metric-label-row">
            <span className="metric-label" style={{ color }}>{label}</span>
          </div>
          <span className="metric-desc">{desc}</span>
        </div>
        <div className="metric-value-group">
          <span className="metric-value" style={{ color }}>{value} frames</span>
          <span className="metric-pct">{pct}% of total</span>
        </div>
      </div>
      <Bar value={value} max={total} color={color} />
    </div>
  )
}

// ── Screen ────────────────────────────────────────

export function PerformanceStatsScreen({ projectPath }: Props) {
  const [devices, setDevices]           = useState<string[]>([])
  const [device, setDevice]             = useState('')
  const [pkg, setPkg]                   = useState('')
  const [sessionMode, setSessionMode]   = useState<SessionMode>('timed')
  const [duration, setDuration]         = useState<Duration>(30)
  const [sessionState, setSessionState] = useState<SessionState>('idle')
  const [elapsed, setElapsed]           = useState(0)
  const [stats, setStats]               = useState<PerformanceStats | null>(null)
  const [sessionSec, setSessionSec]     = useState(0)
  const [error, setError]               = useState<string | null>(null)

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
    const target = duration

    timerRef.current = setInterval(() => {
      elapsedRef.current += 1
      setElapsed(elapsedRef.current)
      if (sessionMode === 'timed' && elapsedRef.current >= target) {
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
  const progress    = sessionMode === 'timed' && isRecording
    ? Math.min((elapsed / duration) * 100, 100) : null

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
              {(['timed', 'manual'] as SessionMode[]).map(m => (
                <button
                  key={m}
                  className={`mode-btn${sessionMode === m ? ' active' : ''}`}
                  onClick={() => setSessionMode(m)}
                >
                  {m === 'timed' ? 'Timed' : 'Manual'}
                </button>
              ))}
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
              Start the session, interact with your app (scroll, navigate, run animations), then stop manually.
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

      {/* Recording */}
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
              <div className="rec-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          <p className="rec-hint">
            {sessionMode === 'timed'
              ? 'Interact with your app — stats will be read automatically.'
              : 'Scroll, navigate, trigger animations, then stop.'}
          </p>
          {sessionMode === 'manual' && (
            <button className="btn-stop" onClick={readStats}>■ Stop & Read</button>
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

      {sessionState === 'idle' && !stats && !error && (
        <div className="empty-state">
          <p>Configure a session above and press Start</p>
        </div>
      )}

      {/* Results */}
      {stats && sessionState === 'idle' && (() => {
        const budgetMs   = budget(stats.refreshRate)
        const renderFps  = sessionSec > 0 ? stats.totalFrames / sessionSec : 0
        const isIdle     = renderFps < 2 || stats.totalFrames < 30
        const status     = isIdle ? null : jankyStatus(stats)
        const insights   = isIdle ? [] : getInsights(stats, budgetMs)
        const hasHistogram = stats.mildJankFrames + stats.severeJankFrames > 0
        const severePct  = stats.totalFrames > 0
          ? ((stats.severeJankFrames / stats.totalFrames) * 100).toFixed(1) : '0'
        const mildPct    = stats.totalFrames > 0
          ? ((stats.mildJankFrames / stats.totalFrames) * 100).toFixed(1) : '0'
        const maxMs     = Math.max(stats.p99, budgetMs * 2)
        const totalIssues = stats.slowUiThread + stats.missedVsync + stats.slowBitmapUploads + stats.slowDrawCommands

        return (
          <div className="stats-body">

            {/* Build type banner */}
            {stats.buildType === 'debug' && (
              <div className="build-type-banner debug" style={{ marginBottom: 16 }}>
                <span className="build-type-icon">⚠</span>
                <div>
                  <strong>Debug build</strong> — performance is much worse than Release.
                  <span className="build-type-sub"> Hermes runs in interpreter mode (no bytecode), React DevTools active. Always profile Release builds.</span>
                </div>
              </div>
            )}
            {stats.buildType === 'release' && (
              <div className="build-type-banner release" style={{ marginBottom: 16 }}>
                <span className="build-type-icon">✓</span>
                <strong>Release build</strong> — accurate performance profile.
              </div>
            )}

            {isIdle ? (
              <>
                <div className="status-badge good">Idle / No rendering</div>
                <div className="perf-summary">
                  <span className="perf-big">{stats.totalFrames}</span>
                  <span className="perf-sub">frames in {sessionSec}s</span>
                </div>
                <div className="perf-note idle">
                  ✓ No active rendering detected. React Native only renders when state changes — a static screen produces near-zero frames, which is correct and efficient. Scroll, navigate or trigger animations to get meaningful data.
                </div>
              </>
            ) : (
              <>
                {/* Header */}
                <div className="perf-header-row">
                  <div className={`status-badge ${status!.cls}`}>{status!.label}</div>
                  <span className="perf-refresh-badge">
                    {stats.refreshRate}Hz · {budgetMs}ms budget
                    {stats.buildType !== 'unknown' && (
                      <span className={`build-badge ${stats.buildType}`} style={{ marginLeft: 6 }}>
                        {stats.buildType}
                      </span>
                    )}
                  </span>
                </div>

                {/* Summary numbers */}
                <div className="perf-summary">
                  <span className="perf-big">{stats.totalFrames.toLocaleString()}</span>
                  <span className="perf-sub">frames</span>
                  <span className="perf-sep">·</span>
                  {hasHistogram ? (
                    <>
                      <span className="perf-big" style={{ color: status!.color }}>
                        {severePct}%
                      </span>
                      <span className="perf-sub">severe jank</span>
                    </>
                  ) : (
                    <>
                      <span className="perf-big" style={{ color: status!.color }}>
                        {stats.jankyPercent.toFixed(1)}%
                      </span>
                      <span className="perf-sub">janky</span>
                    </>
                  )}
                  <span className="perf-sep">·</span>
                  <span className="perf-big">{renderFps.toFixed(1)}</span>
                  <span className="perf-sub">fps avg</span>
                </div>

                {hasHistogram ? (
                  <div className="perf-jank-breakdown">
                    <div className="perf-jank-row">
                      <span className="perf-jank-dot" style={{ background: 'var(--red)' }} />
                      <span className="perf-jank-label">Severe jank &gt;32ms</span>
                      <span className="perf-jank-val" style={{ color: 'var(--red)' }}>{stats.severeJankFrames} frames ({severePct}%)</span>
                      <span className="perf-jank-hint">— user notices</span>
                    </div>
                    <div className="perf-jank-row">
                      <span className="perf-jank-dot" style={{ background: 'var(--yellow)' }} />
                      <span className="perf-jank-label">Mild jank 17–32ms</span>
                      <span className="perf-jank-val" style={{ color: 'var(--text-secondary)' }}>{stats.mildJankFrames} frames ({mildPct}%)</span>
                      <span className="perf-jank-hint">— RN bridge overhead, usually imperceptible</span>
                    </div>
                    <div className="perf-jank-row">
                      <span className="perf-jank-dot" style={{ background: 'var(--text-dim)', opacity: 0.5 }} />
                      <span className="perf-jank-label">Android total</span>
                      <span className="perf-jank-val" style={{ color: 'var(--text-dim)' }}>{stats.jankyPercent.toFixed(1)}% janky</span>
                      <span className="perf-jank-hint">— includes mild+severe (misleading for RN)</span>
                    </div>
                  </div>
                ) : (
                  <div className="perf-note">
                    Histogram unavailable — using Android janky% with RN-adjusted thresholds (≤15% smooth, ≤35% acceptable).
                  </div>
                )}

                {/* Frame time percentiles */}
                <div className="section-label">Frame times</div>
                <div className="metric-list">
                  {([
                    { label: 'P50', value: stats.p50, desc: '50% of frames rendered faster than this' },
                    { label: 'P90', value: stats.p90, desc: '90% of frames rendered faster than this' },
                    { label: 'P95', value: stats.p95, desc: 'Represents typical worst-case frame time' },
                    { label: 'P99', value: stats.p99, desc: 'Worst 1% — visible stutter spikes' },
                  ] as const).map(({ label, value, desc }) => {
                    const color = frameColor(value, budgetMs)
                    return (
                      <div key={label} className="metric-row">
                        <div className="metric-row-top">
                          <div className="metric-info">
                            <div className="metric-label-row">
                              <span className="metric-label perf-label">{label}</span>
                            </div>
                            <span className="metric-desc">{desc}</span>
                          </div>
                          <div className="metric-value-group">
                            <span className="metric-value" style={{ color }}>{value}ms</span>
                            <span className="metric-pct">
                              {value > budgetMs ? `${(value / budgetMs).toFixed(1)}× budget` : 'within budget'}
                            </span>
                          </div>
                        </div>
                        <Bar value={value} max={maxMs} color={color} />
                      </div>
                    )
                  })}
                </div>

                {/* Frame issues breakdown */}
                {totalIssues > 0 && <>
                  <div className="section-label" style={{ marginTop: 16 }}>Frame issue breakdown</div>
                  <p className="perf-issues-hint">What caused the {stats.jankyFrames} janky frames:</p>
                  <div className="metric-list">
                    <IssueRow
                      label="Slow UI Thread"
                      desc="Main thread overloaded — JS bridge calls, layout, or event handlers took too long"
                      value={stats.slowUiThread}
                      total={stats.totalFrames}
                      color="var(--red)"
                    />
                    <IssueRow
                      label="Missed VSync"
                      desc="Frame started too late — CPU/GPU was busy when the display requested the next frame"
                      value={stats.missedVsync}
                      total={stats.totalFrames}
                      color="var(--yellow)"
                    />
                    <IssueRow
                      label="Slow Bitmap Uploads"
                      desc="Uploading images to GPU stalled the render thread — use smaller images or FastImage"
                      value={stats.slowBitmapUploads}
                      total={stats.totalFrames}
                      color="#a78bfa"
                    />
                    <IssueRow
                      label="Slow Draw Commands"
                      desc="GPU command submission was delayed — reduce overdraw or complex canvas operations"
                      value={stats.slowDrawCommands}
                      total={stats.totalFrames}
                      color="#60a5fa"
                    />
                  </div>
                </>}

                {/* Insights */}
                {insights.length > 0 && <>
                  <div className="section-label" style={{ marginTop: 16 }}>Insights</div>
                  <div className="perf-insights">
                    {insights.map((ins, i) => (
                      <div key={i} className={`perf-insight ${ins.kind}`}>
                        <span className="perf-insight-icon">{ins.kind === 'warn' ? '⚠' : 'ℹ'}</span>
                        <span>{ins.text}</span>
                      </div>
                    ))}
                  </div>
                </>}
              </>
            )}

            <p className="stats-time">
              Session: {sessionSec}s · Measured at {new Date(stats.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </p>
          </div>
        )
      })()}
    </div>
  )
}
