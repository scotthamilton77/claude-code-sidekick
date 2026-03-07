import { useReducer, useEffect } from 'react'
import { NavigationContext, initialState, navigationReducer } from './hooks/useNavigation'
import { SessionSelector } from './components/SessionSelector'
import { SessionDashboard } from './components/SessionDashboard'
import { DetailPanel } from './components/detail/DetailPanel'
import { mockProjects } from './data/mock-data'

function App() {
  const [state, dispatch] = useReducer(navigationReducer, initialState)

  // Derive selected data from state
  const selectedProject = mockProjects.find(p => p.id === state.selectedProjectId)
  const selectedSession = selectedProject?.sessions.find(s => s.id === state.selectedSessionId)
  const selectedEvent = selectedSession?.events.find(e => e.id === state.selectedEventId)

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (state.depth === 'detail') {
          dispatch({ type: 'DESELECT_EVENT' })
        } else if (state.depth === 'dashboard') {
          dispatch({ type: 'BACK_TO_SELECTOR' })
        }
      }
      if (state.depth === 'detail' && selectedSession) {
        const idx = selectedSession.events.findIndex(ev => ev.id === state.selectedEventId)
        if (e.key === 'ArrowLeft' && idx > 0) {
          dispatch({ type: 'SELECT_EVENT', eventId: selectedSession.events[idx - 1].id })
        }
        if (e.key === 'ArrowRight' && idx < selectedSession.events.length - 1) {
          dispatch({ type: 'SELECT_EVENT', eventId: selectedSession.events[idx + 1].id })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.depth, state.selectedEventId, selectedSession])

  // Panel width classes
  const selectorWidth = state.selectorPanel.expanded ? 'flex-1' : 'w-10'
  const dashboardWidth = state.dashboardPanel.expanded ? 'flex-[3]' : 'w-10'
  const detailWidth = state.detailPanel.expanded ? 'flex-[2]' : 'w-0'

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      <div className={state.darkMode ? 'dark' : ''}>
        <div className="h-screen w-screen bg-slate-50 dark:bg-slate-950 flex overflow-hidden">
          {/* Session Selector */}
          <div className={`panel-transition ${selectorWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
            <SessionSelector projects={mockProjects} />
          </div>

          {/* Session Dashboard */}
          {state.selectedSessionId && selectedSession && (
            <div className={`panel-transition ${dashboardWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
              <SessionDashboard session={selectedSession} />
            </div>
          )}

          {/* Detail Panel */}
          {state.selectedEventId && selectedSession && selectedEvent && (
            <div className={`panel-transition ${detailWidth} overflow-hidden`}>
              <DetailPanel event={selectedEvent} events={selectedSession.events} />
            </div>
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  )
}

export default App
