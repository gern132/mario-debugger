import { useState, useEffect } from 'react'
import type { Project, CheckResult } from '@shared/types'
import { ProjectPicker } from './screens/ProjectPicker'
import { Dashboard } from './screens/Dashboard'
import { LogsScreen } from './screens/LogsScreen'

type AppState =
  | { screen: 'picker' }
  | { screen: 'dashboard'; project: Project; result?: CheckResult }

const params = new URLSearchParams(window.location.search)
const IS_LOGS_WINDOW = params.get('logsWindow') === '1'
const LOGS_PROJECT_PATH = params.get('projectPath') ?? ''

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'picker' })

  useEffect(() => {
    window.api.getTheme().then(theme => {
      document.documentElement.setAttribute('data-theme', theme)
    })
  }, [])

  if (IS_LOGS_WINDOW) {
    return (
      <div className="logs-window-root">
        <div className="titlebar-drag" />
        <LogsScreen projectPath={LOGS_PROJECT_PATH} />
      </div>
    )
  }

  if (state.screen === 'picker') {
    return (
      <ProjectPicker
        onProjectSelected={(project) =>
          setState({ screen: 'dashboard', project })
        }
      />
    )
  }

  return (
    <Dashboard
      project={state.project}
      onChangeProject={() => setState({ screen: 'picker' })}
    />
  )
}
