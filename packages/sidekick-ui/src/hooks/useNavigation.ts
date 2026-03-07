import { createContext, useContext, type Dispatch } from 'react'
import type { NavigationState, TimelineFilter } from '../types'

// Action types
type NavigationAction =
  | { type: 'SELECT_SESSION'; projectId: string; sessionId: string }
  | { type: 'SELECT_TRANSCRIPT_LINE'; lineId: string }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'SYNC_TO_TIMELINE_EVENT'; lineId: string }
  | { type: 'CLEAR_SYNC' }
  | { type: 'BACK_TO_SELECTOR' }
  | { type: 'TOGGLE_SELECTOR_PANEL' }
  | { type: 'TOGGLE_TIMELINE_FILTER'; filter: TimelineFilter }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_DARK_MODE' }

const initialState: NavigationState = {
  depth: 'selector',
  selectedProjectId: null,
  selectedSessionId: null,
  selectedTranscriptLineId: null,
  syncedTranscriptLineId: null,
  selectorPanel: { expanded: true },
  detailPanel: { expanded: false },
  timelineFilters: new Set(),
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
        selectedTranscriptLineId: null,
        syncedTranscriptLineId: null,
        selectorPanel: { expanded: false },
        detailPanel: { expanded: false },
      }

    case 'SELECT_TRANSCRIPT_LINE':
      return {
        ...state,
        depth: 'detail',
        selectedTranscriptLineId: action.lineId,
        syncedTranscriptLineId: null,
        detailPanel: { expanded: true },
      }

    case 'CLOSE_DETAIL':
      return {
        ...state,
        depth: 'dashboard',
        selectedTranscriptLineId: null,
        detailPanel: { expanded: false },
      }

    case 'SYNC_TO_TIMELINE_EVENT':
      return {
        ...state,
        syncedTranscriptLineId: action.lineId,
      }

    case 'CLEAR_SYNC':
      return {
        ...state,
        syncedTranscriptLineId: null,
      }

    case 'BACK_TO_SELECTOR':
      return {
        ...state,
        depth: 'selector',
        selectedProjectId: null,
        selectedSessionId: null,
        selectedTranscriptLineId: null,
        syncedTranscriptLineId: null,
        selectorPanel: { expanded: true },
        detailPanel: { expanded: false },
      }

    case 'TOGGLE_SELECTOR_PANEL':
      if (!state.selectorPanel.expanded) {
        return {
          ...state,
          depth: 'selector',
          selectorPanel: { expanded: true },
          detailPanel: { expanded: false },
        }
      }
      if (state.selectedSessionId) {
        return {
          ...state,
          depth: state.selectedTranscriptLineId ? 'detail' : 'dashboard',
          selectorPanel: { expanded: false },
          detailPanel: { expanded: !!state.selectedTranscriptLineId },
        }
      }
      return state

    case 'TOGGLE_TIMELINE_FILTER': {
      const newFilters = new Set(state.timelineFilters)
      if (newFilters.has(action.filter)) {
        newFilters.delete(action.filter)
      } else {
        newFilters.add(action.filter)
      }
      return { ...state, timelineFilters: newFilters }
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
