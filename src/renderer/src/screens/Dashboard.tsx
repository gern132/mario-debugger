import { useState, useEffect } from 'react'
import type { Project, CheckResult, Issue, IssueRule } from '@shared/types'
import { MemoryStatsScreen } from './MemoryStats'
import { PerformanceStatsScreen } from './PerformanceStats'
import { LogsScreen } from './LogsScreen'
import { NetworkScreen } from './NetworkScreen'
import { SettingsPanel } from './SettingsPanel'

type MainTab = 'analysis' | 'memory' | 'performance' | 'logs' | 'network'

type Filter = 'all' | 'errors' | 'warnings'

const RULE_LABELS: Record<IssueRule, string> = {
  'effect-leak':  'Memory Leaks',
  'console-log':  'Console Logs',
  'async-effect': 'Async Effects',
  'inline-style': 'Inline Styles',
  'event-name':   'Firebase Events',
  'todo-comment': 'TODO / FIXME',
}

interface Props {
  project: Project
  onChangeProject: () => void
}

export function Dashboard({ project, onChangeProject }: Props) {
  const [result, setResult]   = useState<CheckResult | null>(null)
  const [running, setRunning] = useState(false)
  const [filter, setFilter]   = useState<Filter>('all')
  const [editor, setEditorState] = useState<'vscode' | 'webstorm'>('vscode')
  const [toast, setToast]     = useState('')
  const [mainTab, setMainTab] = useState<MainTab>('network')
  const [logsEverShown, setLogsEverShown] = useState(false)
  // network is default tab — keep it mounted permanently once shown
  const [networkEverShown, setNetworkEverShown] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.api.getEditorPreference().then(setEditorState)
    void run()
  }, [])

  const run = async () => {
    setRunning(true)
    try {
      const r = await window.api.runAnalysis(project.path)
      setResult(r)
      await window.api.saveRecentProject({ ...project, lastRun: r.timestamp })
    } finally {
      setRunning(false)
    }
  }

  const changeEditor = async (e: 'vscode' | 'webstorm') => {
    setEditorState(e)
    await window.api.setEditorPreference(e)
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }

  const errors   = result?.issues.filter(i => i.severity === 'error').length ?? 0
  const warnings = result?.issues.filter(i => i.severity === 'warn').length ?? 0

  const filtered = (result?.issues ?? []).filter(issue => {
    if (filter === 'errors')   return issue.severity === 'error'
    if (filter === 'warnings') return issue.severity === 'warn'
    return true
  })

  const grouped = filtered.reduce<Record<string, Issue[]>>((acc, issue) => {
    if (!acc[issue.rule]) acc[issue.rule] = []
    acc[issue.rule].push(issue)
    return acc
  }, {})

  const shortPath = project.path.replace(/\/Users\/[^/]+/, '~')

  return (
    <div className="dashboard">
      <div className="project-header">
        <div className="project-info">
          <span className="project-name">{project.name}</span>
          <span className="project-path">{shortPath}</span>
        </div>
        <div className="project-actions">
          <button className="btn-ghost" onClick={onChangeProject}>Change repo</button>
          <button className="btn-icon" onClick={() => setSettingsOpen(true)} title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94L2.86 14.52a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>
            </svg>
          </button>
          {mainTab === 'analysis' && (
            <button
              className={`btn-primary${running ? ' running' : ''}`}
              onClick={run}
              disabled={running}
            >
              {running ? '⏳ Analyzing...' : '▶ Run'}
            </button>
          )}
        </div>
      </div>

      <div className="main-tabs">
        {([
          ['network',     'Network'],
          ['logs',        'Logs'],
          ['analysis',    'Code Analysis'],
          ['memory',      'Memory'],
          ['performance', 'Performance'],
        ] as [MainTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            className={`main-tab${mainTab === tab ? ' active' : ''}`}
            onClick={() => {
              if (tab === 'logs')    setLogsEverShown(true)
              if (tab === 'network') setNetworkEverShown(true)
              setMainTab(tab)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {networkEverShown && (
        <div style={{ display: mainTab === 'network' ? 'contents' : 'none' }}>
          <NetworkScreen projectPath={project.path} />
        </div>
      )}

      {mainTab === 'memory' && (
        <MemoryStatsScreen projectPath={project.path} />
      )}

      {mainTab === 'performance' && (
        <PerformanceStatsScreen projectPath={project.path} />
      )}

      {/* LogsScreen stays mounted permanently once visited — CDP connection persists across tab switches */}
      {logsEverShown && (
        <div style={{ display: mainTab === 'logs' ? 'contents' : 'none' }}>
          <LogsScreen projectPath={project.path} />
        </div>
      )}

      {mainTab === 'analysis' && <div className="dashboard-body">
        <aside className="sidebar">
          <div className="stat-card error">
            <span className="stat-value">{errors}</span>
            <span className="stat-label">Errors</span>
          </div>
          <div className="stat-card warning">
            <span className="stat-value">{warnings}</span>
            <span className="stat-label">Warnings</span>
          </div>
          <div className="stat-card neutral">
            <span className="stat-value">{result?.filesScanned ?? '—'}</span>
            <span className="stat-label">Files</span>
          </div>
          <div className="stat-card neutral">
            <span className="stat-value">{result ? `${result.duration}ms` : '—'}</span>
            <span className="stat-label">Duration</span>
          </div>

          <div className="editor-section">
            <span className="editor-label">Open in</span>
            <div className="editor-toggle">
              <button
                className={`editor-btn${editor === 'vscode' ? ' active' : ''}`}
                onClick={() => changeEditor('vscode')}
              >
                VSCode
              </button>
              <button
                className={`editor-btn${editor === 'webstorm' ? ' active' : ''}`}
                onClick={() => changeEditor('webstorm')}
              >
                WebStorm
              </button>
            </div>
          </div>

          {result && (
            <p className="last-run">
              {new Date(result.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </aside>

        <main className="results-panel">
          {!result && running && (
            <div className="empty-state">
              <div className="spinner" />
              <p>Scanning files...</p>
            </div>
          )}

          {result && (
            <>
              <div className="filter-bar">
                {(['all', 'errors', 'warnings'] as Filter[]).map(f => (
                  <button
                    key={f}
                    className={`filter-btn${filter === f ? ' active' : ''}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all'      && `All  ${result.issues.length}`}
                    {f === 'errors'   && `Errors  ${errors}`}
                    {f === 'warnings' && `Warnings  ${warnings}`}
                  </button>
                ))}
              </div>

              <div className="results-body">
                {Object.keys(grouped).length === 0 ? (
                  <div className="empty-state success">
                    <span>✓</span>
                    <p>No issues found</p>
                  </div>
                ) : (
                  Object.entries(grouped).map(([rule, issues]) => (
                    <div key={rule} className="rule-group">
                      <h3 className="rule-title">
                        {RULE_LABELS[rule as IssueRule] ?? rule}
                        <span className="rule-count">{issues.length}</span>
                      </h3>
                      {issues.map((issue, idx) => (
                        <IssueCard
                          key={idx}
                          issue={issue}
                          projectPath={project.path}
                          editor={editor}
                          onCopy={showToast}
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </main>
      </div>}

      {toast && <div className="toast">{toast}</div>}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function IssueCard({
  issue,
  projectPath,
  editor,
  onCopy,
}: {
  issue: Issue
  projectPath: string
  editor: 'vscode' | 'webstorm'
  onCopy: (msg: string) => void
}) {
  const fullPath = `${projectPath}/${issue.file}`

  const openInEditor = () => {
    void window.api.openInEditor(fullPath, issue.line, editor)
  }

  const copyPath = async () => {
    await navigator.clipboard.writeText(`${fullPath}:${issue.line}`)
    onCopy('Path copied')
  }

  return (
    <div className={`issue-card ${issue.severity}`}>
      <div className="issue-header">
        <span className={`issue-icon ${issue.severity}`}>
          {issue.severity === 'error' ? '✗' : '⚠'}
        </span>
        <button className="issue-location" onClick={copyPath} title="Click to copy path">
          {issue.file}
          <span className="issue-line">:{issue.line}</span>
        </button>
        <button className="btn-open" onClick={openInEditor}>
          Open →
        </button>
      </div>
      <p className="issue-message">{issue.message}</p>
      {issue.code && <code className="issue-code">{issue.code}</code>}
    </div>
  )
}
