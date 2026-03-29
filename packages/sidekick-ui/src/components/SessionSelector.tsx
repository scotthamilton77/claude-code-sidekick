import { useState, useMemo } from 'react'
import { FolderOpen, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import type { Project } from '../types'
import { useNavigation } from '../hooks/useNavigation'
import { PanelHeader } from './PanelHeader'
import { CompressedLabel } from './CompressedLabel'
import { groupSessionsByDate, DATE_GROUP_ORDER, type DateGroup } from '../utils/dateGrouping'

interface SessionSelectorProps {
  projects: Project[]
}

export function SessionSelector({ projects }: SessionSelectorProps) {
  const { state, dispatch } = useNavigation()
  // Default: only expand the project with the most recent session
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    if (projects.length === 0) return new Set<string>()
    let mostRecentProject = projects.find((p) => p.sessions.length > 0) ?? projects[0]
    if (!mostRecentProject) return new Set<string>()
    for (const p of projects) {
      if (p.sessions.length === 0) continue
      if (mostRecentProject.sessions.length === 0 || p.sessions[0].dateRaw > mostRecentProject.sessions[0].dateRaw) {
        mostRecentProject = p
      }
    }
    return new Set([mostRecentProject.id])
  })

  // Track which date groups are collapsed (most recent expanded by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

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

  function toggleDateGroup(projectId: string, group: DateGroup) {
    const key = `${projectId}:${group}`
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
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
          <ProjectSection
            key={project.id}
            project={project}
            isExpanded={expandedProjects.has(project.id)}
            collapsedGroups={collapsedGroups}
            selectedSessionId={state.selectedSessionId}
            onToggleProject={() => toggleProject(project.id)}
            onToggleDateGroup={(group) => toggleDateGroup(project.id, group)}
            onSelectSession={(sessionId) => dispatch({ type: 'SELECT_SESSION', projectId: project.id, sessionId })}
          />
        ))}
      </div>
    </div>
  )
}

interface ProjectSectionProps {
  project: Project
  isExpanded: boolean
  collapsedGroups: Set<string>
  selectedSessionId: string | null
  onToggleProject: () => void
  onToggleDateGroup: (group: DateGroup) => void
  onSelectSession: (sessionId: string) => void
}

function ProjectSection({
  project, isExpanded, collapsedGroups, selectedSessionId,
  onToggleProject, onToggleDateGroup, onSelectSession,
}: ProjectSectionProps) {
  const dateGroups = useMemo(() => groupSessionsByDate(project.sessions), [project.sessions])

  // Determine which group is the first (most recent) with content
  const firstActiveGroup = DATE_GROUP_ORDER.find(g => dateGroups.has(g))

  return (
    <div className="mb-3">
      {/* Project header */}
      <button
        onClick={onToggleProject}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
      >
        {isExpanded ? (
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
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {project.sessionLoadError && (
            <span title={project.sessionLoadError} className="text-amber-500">
              <AlertTriangle size={12} />
            </span>
          )}
          <span className="text-[10px] text-slate-400">{project.sessions.length}</span>
        </div>
      </button>

      {/* Date-grouped session list */}
      {isExpanded && (
        <div className="ml-5 mt-1">
          {DATE_GROUP_ORDER.map(group => {
            const sessions = dateGroups.get(group)
            if (!sessions || sessions.length === 0) return null

            const groupKey = `${project.id}:${group}`
            // First active group is expanded by default, others collapsed
            const isCollapsed = group === firstActiveGroup
              ? collapsedGroups.has(groupKey)
              : !collapsedGroups.has(groupKey) // inverted: need explicit toggle to expand non-first groups

            return (
              <div key={group} className="mb-1">
                {/* Date group header */}
                <button
                  onClick={() => onToggleDateGroup(group)}
                  className="flex items-center gap-1.5 w-full px-1.5 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight size={10} className="text-slate-300" />
                  ) : (
                    <ChevronDown size={10} className="text-slate-300" />
                  )}
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{group}</span>
                  <span className="text-[9px] text-slate-300 dark:text-slate-600 ml-auto">{sessions.length}</span>
                </button>

                {/* Sessions in this group */}
                {!isCollapsed && (
                  <div className="space-y-0.5 ml-2">
                    {sessions.map((session) => {
                      const isSelected = selectedSessionId === session.id
                      return (
                        <button
                          key={session.id}
                          onClick={() => onSelectSession(session.id)}
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
            )
          })}
        </div>
      )}
    </div>
  )
}
