import { createContext, useContext, type Dispatch } from 'react'
import type { NavigationState, FocusFilter } from '../types'

// Action types
type NavigationAction =
  | { type: 'SELECT_SESSION'; projectId: string; sessionId: string }
  | { type: 'SELECT_EVENT'; eventId: string }
  | { type: 'DESELECT_EVENT' }
  | { type: 'BACK_TO_SELECTOR' }
  | { type: 'TOGGLE_SELECTOR_PANEL' }
  | { type: 'TOGGLE_DASHBOARD_PANEL' }
  | { type: 'TOGGLE_DETAIL_PANEL' }
  | { type: 'TOGGLE_FILTER'; filter: FocusFilter }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_DARK_MODE' }

const initialState: NavigationState = {
  depth: 'selector',
  selectedProjectId: null,
  selectedSessionId: null,
  selectedEventId: null,
  selectorPanel: { expanded: true },
  dashboardPanel: { expanded: false },
  detailPanel: { expanded: false },
  activeFilters: new Set(),
  searchQuery: '',
  darkMode: false,
}

function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'SELECT_SESSION':
      return {
        ...state,
        depth: 'dashboard',
        selectedProjectId: action.projectId,
        selectedSessionId: action.sessionId,
        selectedEventId: null,
        selectorPanel: { expanded: false },
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }
    case 'SELECT_EVENT':
      return {
        ...state,
        depth: 'detail',
        selectedEventId: action.eventId,
        selectorPanel: { expanded: false },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: true },
      }
    case 'DESELECT_EVENT':
      return {
        ...state,
        depth: 'dashboard',
        selectedEventId: null,
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }
    case 'BACK_TO_SELECTOR':
      return {
        ...state,
        depth: 'selector',
        selectedProjectId: null,
        selectedSessionId: null,
        selectedEventId: null,
        selectorPanel: { expanded: true },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: false },
      }
    case 'TOGGLE_SELECTOR_PANEL':
      // Expanding selector compresses dashboard/detail
      if (!state.selectorPanel.expanded) {
        return {
          ...state,
          depth: 'selector',
          selectorPanel: { expanded: true },
          dashboardPanel: { expanded: false },
          detailPanel: { expanded: false },
        }
      }
      // Collapsing selector expands dashboard (if session selected)
      if (state.selectedSessionId) {
        return {
          ...state,
          depth: state.selectedEventId ? 'detail' : 'dashboard',
          selectorPanel: { expanded: false },
          dashboardPanel: { expanded: !state.selectedEventId },
          detailPanel: { expanded: !!state.selectedEventId },
        }
      }
      return state

    case 'TOGGLE_DASHBOARD_PANEL':
      if (!state.dashboardPanel.expanded) {
        // Expanding dashboard compresses detail
        return {
          ...state,
          depth: 'dashboard',
          dashboardPanel: { expanded: true },
          detailPanel: { expanded: false },
        }
      }
      // Collapsing dashboard expands selector
      return {
        ...state,
        depth: 'selector',
        selectorPanel: { expanded: true },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: false },
      }

    case 'TOGGLE_DETAIL_PANEL':
      if (!state.detailPanel.expanded) {
        return state // Can't expand detail without selecting an event
      }
      // Collapsing detail expands dashboard
      return {
        ...state,
        depth: 'dashboard',
        selectedEventId: null,
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }

    case 'TOGGLE_FILTER': {
      const newFilters = new Set(state.activeFilters)
      if (newFilters.has(action.filter)) {
        newFilters.delete(action.filter)
      } else {
        newFilters.add(action.filter)
      }
      return { ...state, activeFilters: newFilters }
    }

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query }

    case 'TOGGLE_DARK_MODE':
      return { ...state, darkMode: !state.darkMode }

    default:
      return state
  }
}

export interface NavigationContextValue {
  state: NavigationState
  dispatch: Dispatch<NavigationAction>
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

export { initialState, navigationReducer }
export type { NavigationAction }
