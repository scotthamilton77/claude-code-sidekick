import { useReducer, useEffect, useMemo } from 'react'
import { NavigationContext, initialState, navigationReducer } from './hooks/useNavigation'
import { useSessions } from './hooks/useSessions'
import { useTimeline } from './hooks/useTimeline'
import { useTranscript } from './hooks/useTranscript'
import { SessionSelector } from './components/SessionSelector'
import { SummaryStrip } from './components/SummaryStrip'
import { Timeline } from './components/timeline/Timeline'
import { Transcript } from './components/transcript/Transcript'
import { DetailPanel } from './components/detail/DetailPanel'
import { SubagentTranscript } from './components/transcript/SubagentTranscript'

function App() {
  const [state, dispatch] = useReducer(navigationReducer, initialState)
  const { projects, loading, error } = useSessions()

  const { events: timelineEvents, loading: timelineLoading, error: timelineError } = useTimeline(
    state.selectedProjectId,
    state.selectedSessionId
  )

  const { lines: transcriptLines, loading: transcriptLoading, error: transcriptError } = useTranscript(
    state.selectedProjectId,
    state.selectedSessionId
  )

  const selectedProject = projects.find(p => p.id === state.selectedProjectId)
  const selectedSession = selectedProject?.sessions.find(s => s.id === state.selectedSessionId)
  const selectedLine = transcriptLines.find(l => l.id === state.selectedTranscriptLineId)

  // Derive session default model (most common model across transcript lines)
  const defaultModel = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of transcriptLines) {
      if (l.model) counts.set(l.model, (counts.get(l.model) ?? 0) + 1)
    }
    let best = ''
    let bestCount = 0
    for (const [m, c] of counts) {
      if (c > bestCount) { best = m; bestCount = c }
    }
    return best || undefined
  }, [transcriptLines])

  const detailOpen = state.detailPanel.expanded && !!selectedLine

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (detailOpen) {
          dispatch({ type: 'CLOSE_DETAIL' })
        } else if (state.depth === 'dashboard') {
          dispatch({ type: 'BACK_TO_SELECTOR' })
        }
      }
      if (detailOpen && transcriptLines.length > 0) {
        const idx = transcriptLines.findIndex(l => l.id === state.selectedTranscriptLineId)
        if (e.key === 'ArrowUp' && idx > 0) {
          dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: transcriptLines[idx - 1].id })
        }
        if (e.key === 'ArrowDown' && idx < transcriptLines.length - 1) {
          dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: transcriptLines[idx + 1].id })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.depth, state.selectedTranscriptLineId, transcriptLines, detailOpen])

  const selectorWidth = state.selectorPanel.expanded ? 'flex-1' : 'w-10'

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      <div className={state.darkMode ? 'dark' : ''}>
        <div className="h-screen w-screen bg-slate-50 dark:bg-slate-950 flex overflow-hidden">
          {/* Session Selector — compresses to label */}
          <div className={`panel-transition ${selectorWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400">
                Loading sessions...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-red-500 px-4 text-center">
                {error}
              </div>
            ) : (
              <SessionSelector projects={projects} />
            )}
          </div>

          {/* Dashboard Area — visible when session selected */}
          {state.selectedSessionId && selectedSession && (
            <div className="flex-1 flex flex-col min-w-0">
              <SummaryStrip session={selectedSession} defaultModel={defaultModel} />

              <div className="flex-1 flex overflow-hidden">
                {/* Timeline — fixed width, never compresses */}
                <div className="w-60 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-hidden">
                  <Timeline events={timelineEvents} loading={timelineLoading} error={timelineError} />
                </div>

                {/* Transcript — shrinks when subagents or detail open */}
                <div className={`${state.subagentChain.length > 0 || detailOpen ? 'flex-[2]' : 'flex-[3]'} border-r border-slate-200 dark:border-slate-700 overflow-hidden min-w-0 panel-transition`}>
                  <Transcript
                    lines={transcriptLines}
                    loading={transcriptLoading}
                    error={transcriptError}
                    ledStates={selectedSession?.ledStates ?? new Map()}
                    scrollToLineId={state.syncedTranscriptLineId}
                    defaultModel={defaultModel}
                  />
                </div>

                {/* Subagent panel chain */}
                {state.subagentChain.map((entry, index) => (
                  <SubagentTranscript
                    key={`${entry.agentId}-${index}`}
                    projectId={entry.projectId}
                    sessionId={entry.sessionId}
                    agentId={entry.agentId}
                    agentType={entry.agentType}
                    depth={index}
                    onClose={() => {
                      // Close this and all panels to the right
                      dispatch({ type: 'CLOSE_SUBAGENT_AT', index })
                    }}
                  />
                ))}

                {/* Detail Panel — slides in on transcript click */}
                {detailOpen && selectedLine && (
                  <div className="flex-[2] overflow-hidden panel-transition">
                    <DetailPanel
                      line={selectedLine}
                      lines={transcriptLines}
                      stateSnapshots={selectedSession.stateSnapshots}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  )
}

export default App
