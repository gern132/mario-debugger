import { useState, useEffect } from 'react'
import type { Project } from '@shared/types'

interface Props {
  onProjectSelected: (project: Project) => void
}

export function ProjectPicker({ onProjectSelected }: Props) {
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    window.api.getRecentProjects().then(setRecentProjects)
  }, [])

  const handleBrowse = async () => {
    const folderPath = await window.api.selectProjectFolder()
    if (folderPath) {
      const name = folderPath.split('/').pop() ?? folderPath
      onProjectSelected({ name, path: folderPath })
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      const filePath = (file as File & { path: string }).path
      const name = filePath.split('/').pop() ?? filePath
      onProjectSelected({ name, path: filePath })
    }
  }

  return (
    <div className="picker-screen">
      <div className="titlebar-drag" />

      <div className="picker-content">
        <div className="app-header">
          <div className="app-icon">⚡</div>
          <h1>RN Quality Checker</h1>
          <p>Static analysis for React Native projects</p>
        </div>

        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={handleBrowse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleBrowse()}
        >
          <span className="drop-icon">📁</span>
          <p className="drop-main">Drop your project folder here</p>
          <p className="drop-sub">or click to browse</p>
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h2>Recent</h2>
            {recentProjects.map((project) => (
              <button
                key={project.path}
                className="recent-item"
                onClick={() => onProjectSelected(project)}
              >
                <div className="recent-info">
                  <span className="recent-name">{project.name}</span>
                  <span className="recent-path">{project.path}</span>
                </div>
                {project.lastRun && (
                  <span className="recent-time">
                    {formatRelativeTime(project.lastRun)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
