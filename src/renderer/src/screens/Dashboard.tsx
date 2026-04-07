import { useState, useEffect } from 'react'
import type { Project, CheckResult, Issue, IssueRule } from '@shared/types'
import { MemoryStatsScreen } from './MemoryStats'
import { PerformanceStatsScreen } from './PerformanceStats'
import { LogsScreen } from './LogsScreen'

type MainTab = 'analysis' | 'memory' | 'performance' | 'logs'

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
  const [mainTab, setMainTab] = useState<MainTab>('logs')
  const [logsEverShown, setLogsEverShown] = useState(true) // logs is default tab

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
          ['logs',        'Logs'],
          ['analysis',    'Code Analysis'],
          ['memory',      'Memory'],
          ['performance', 'Performance'],
        ] as [MainTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            className={`main-tab${mainTab === tab ? ' active' : ''}`}
            onClick={() => {
              if (tab === 'logs') setLogsEverShown(true)
              setMainTab(tab)
            }}
          >
            {label}
          </button>
        ))}
      </div>

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
