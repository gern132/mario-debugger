import { useState, useEffect, useRef } from 'react'

type Theme = 'dark' | 'light'

interface Props {
  onClose: () => void
}

const DEFAULT_PORTS = [8081, 8082, 8083, 19000, 19001, 19006]

export function SettingsPanel({ onClose }: Props) {
  const [theme, setThemeState]   = useState<Theme>('dark')
  const [ports, setPorts]         = useState<number[]>(DEFAULT_PORTS)
  const [portInput, setPortInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getTheme().then(setThemeState)
    window.api.getNetworkPorts().then(setPorts)
  }, [])

  const applyTheme = async (t: Theme) => {
    setThemeState(t)
    document.documentElement.setAttribute('data-theme', t)
    await window.api.setTheme(t)
  }

  const addPort = () => {
    const n = parseInt(portInput, 10)
    if (!n || n < 1 || n > 65535 || ports.includes(n)) {
      setPortInput('')
      return
    }
    const next = [...ports, n].sort((a, b) => a - b)
    setPorts(next)
    setPortInput('')
    void window.api.setNetworkPorts(next)
    inputRef.current?.focus()
  }

  const removePort = (port: number) => {
    const next = ports.filter(p => p !== port)
    setPorts(next)
    void window.api.setNetworkPorts(next)
  }

  const resetPorts = () => {
    setPorts(DEFAULT_PORTS)
    void window.api.setNetworkPorts(DEFAULT_PORTS)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>

        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Appearance ── */}
        <div className="settings-section">
          <div className="settings-section-label">Appearance</div>
          <div className="mode-toggle">
            {(['dark', 'light'] as Theme[]).map(t => (
              <button
                key={t}
                className={`mode-btn${theme === t ? ' active' : ''}`}
                onClick={() => void applyTheme(t)}
              >
                {t === 'dark' ? '◐ Dark' : '○ Light'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Network ports ── */}
        <div className="settings-section">
          <div className="settings-section-label">Metro / CDP Ports</div>
          <p className="settings-hint">Scanned when auto-detecting Metro port</p>

          <div className="ports-list">
            {ports.map(port => (
              <div key={port} className="port-chip">
                <span>{port}</span>
                <button className="port-chip-remove" onClick={() => removePort(port)} title="Remove">×</button>
              </div>
            ))}
          </div>

          <div className="port-add-row">
            <input
              ref={inputRef}
              className="control-input"
              type="number"
              placeholder="Port…"
              value={portInput}
              onChange={e => setPortInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPort()}
              min={1}
              max={65535}
              style={{ width: 90 }}
            />
            <button className="btn-ghost btn-sm" onClick={addPort}>Add</button>
            <button className="btn-ghost btn-sm" onClick={resetPorts} style={{ marginLeft: 'auto' }}>Reset</button>
          </div>
        </div>

      </div>
    </div>
  )
}
