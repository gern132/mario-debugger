import { useState } from 'react'
import type { Project, CheckResult } from '@shared/types'
import { ProjectPicker } from './screens/ProjectPicker'
import { Dashboard } from './screens/Dashboard'

type AppState =
  | { screen: 'picker' }
  | { screen: 'dashboard'; project: Project; result?: CheckResult }

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'picker' })

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
