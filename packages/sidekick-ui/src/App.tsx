import { useReducer, useEffect } from 'react'
import { NavigationContext, initialState, navigationReducer } from './hooks/useNavigation'
import { useSessions } from './hooks/useSessions'
import { SessionSelector } from './components/SessionSelector'
import { SummaryStrip } from './components/SummaryStrip'
import { Timeline } from './components/timeline/Timeline'
import { Transcript } from './components/transcript/Transcript'
import { DetailPanel } from './components/detail/DetailPanel'

function App() {
  const [state, dispatch] = useReducer(navigationReducer, initialState)
  const { projects, loading, error } = useSessions()

  // Derive selected data from state
  const selectedProject = projects.find(p => p.id === state.selectedProjectId)
  const selectedSession = selectedProject?.sessions.find(s => s.id === state.selectedSessionId)
  const selectedLine = selectedSession?.transcriptLines.find(l => l.id === state.selectedTranscriptLineId)

  const detailOpen = state.detailPanel.expanded && !!selectedLine

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (detailOpen) {
          dispatch({ type: 'CLOSE_DETAIL' })
        } else if (state.depth === 'dashboard') {
          dispatch({ type: 'BACK_TO_SELECTOR' })
        }
      }
      if (detailOpen && selectedSession) {
        const idx = selectedSession.transcriptLines.findIndex(l => l.id === state.selectedTranscriptLineId)
        if (e.key === 'ArrowUp' && idx > 0) {
          dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: selectedSession.transcriptLines[idx - 1].id })
        }
        if (e.key === 'ArrowDown' && idx < selectedSession.transcriptLines.length - 1) {
          dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: selectedSession.transcriptLines[idx + 1].id })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.depth, state.selectedTranscriptLineId, selectedSession, detailOpen])

  // Panel width classes
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
              <SummaryStrip session={selectedSession} />

              <div className="flex-1 flex overflow-hidden">
                {/* Timeline — fixed width, never compresses */}
                <div className="w-60 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-hidden">
                  <Timeline events={selectedSession.sidekickEvents} />
                </div>

                {/* Transcript — shrinks when detail open */}
                <div className={`${detailOpen ? 'flex-[2]' : 'flex-[3]'} border-r border-slate-200 dark:border-slate-700 overflow-hidden min-w-0 panel-transition`}>
                  <Transcript
                    lines={selectedSession.transcriptLines}
                    ledStates={selectedSession.ledStates}
                    scrollToLineId={state.syncedTranscriptLineId}
                  />
                </div>

                {/* Detail Panel — slides in on transcript click */}
                {detailOpen && selectedLine && (
                  <div className="flex-[2] overflow-hidden panel-transition">
                    <DetailPanel
                      line={selectedLine}
                      lines={selectedSession.transcriptLines}
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
