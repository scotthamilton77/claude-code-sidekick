import { useState } from 'react'
import { FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import type { Project } from '../types'
import { useNavigation } from '../hooks/useNavigation'
import { PanelHeader } from './PanelHeader'
import { CompressedLabel } from './CompressedLabel'

interface SessionSelectorProps {
  projects: Project[]
}

export function SessionSelector({ projects }: SessionSelectorProps) {
  const { state, dispatch } = useNavigation()
  // Default: only expand the project with the most recent session
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    if (projects.length === 0) return new Set<string>()
    // Initialize to first project with sessions, falling back to projects[0]
    let mostRecentProject = projects.find((p) => p.sessions.length > 0) ?? projects[0]
    for (const p of projects) {
      if (p.sessions.length === 0) continue
      if (mostRecentProject.sessions.length === 0 || p.sessions[0].dateRaw > mostRecentProject.sessions[0].dateRaw) {
        mostRecentProject = p
      }
    }
    return new Set([mostRecentProject.id])
  })

  if (!state.selectorPanel.expanded) {
    const selectedProject = projects.find((p) => p.id === state.selectedProjectId)
    const selectedSession = selectedProject?.sessions.find((s) => s.id === state.selectedSessionId)
    const label = selectedSession ? `${selectedProject?.name} / ${selectedSession.title}` : 'Sessions'
    return <CompressedLabel text={label} onClick={() => dispatch({ type: 'TOGGLE_SELECTOR_PANEL' })} />
  }

  function toggleProject(projectId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <PanelHeader
        title="Sessions"
        expanded={state.selectorPanel.expanded}
        onToggle={() => dispatch({ type: 'TOGGLE_SELECTOR_PANEL' })}
        collapseDirection="left"
      />
      <div className="flex-1 overflow-y-auto p-2">
        {projects.map((project) => (
          <div key={project.id} className="mb-3">
            {/* Project header */}
            <button
              onClick={() => toggleProject(project.id)}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
            >
              {expandedProjects.has(project.id) ? (
                <ChevronDown size={14} className="text-slate-400" />
              ) : (
                <ChevronRight size={14} className="text-slate-400" />
              )}
              <FolderOpen size={14} className="text-amber-500" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  {project.name}
                </span>
                {project.projectDir && (
                  <div className="text-[9px] text-slate-400 truncate" title={project.projectDir}>
                    {project.projectDir}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 ml-auto flex-shrink-0">{project.sessions.length}</span>
            </button>

            {/* Session list */}
            {expandedProjects.has(project.id) && (
              <div className="ml-5 mt-1 space-y-1">
                {project.sessions.map((session) => {
                  const isSelected = state.selectedSessionId === session.id
                  return (
                    <button
                      key={session.id}
                      onClick={() => dispatch({ type: 'SELECT_SESSION', projectId: project.id, sessionId: session.id })}
                      className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                        isSelected
                          ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950'
                          : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            session.status === 'active'
                              ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                              : 'bg-slate-300 dark:bg-slate-600'
                          }`}
                        />
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                          {session.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 ml-4">
                        <span className="text-[10px] text-slate-400">{session.date}</span>
                        <span className="text-[10px] text-slate-400">•</span>
                        <span className="text-[10px] font-mono text-slate-400">{session.branch}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
