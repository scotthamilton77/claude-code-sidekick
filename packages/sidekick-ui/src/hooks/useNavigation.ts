import { createContext, useContext, type Dispatch } from 'react'
import type { NavigationState, TimelineFilter, TranscriptFilter, SubagentChainEntry } from '../types'

// Action types
type NavigationAction =
  | { type: 'SELECT_SESSION'; projectId: string; sessionId: string }
  | { type: 'SELECT_TRANSCRIPT_LINE'; lineId: string }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'SYNC_TO_TIMELINE_EVENT'; lineId: string }
  | { type: 'SYNC_TO_TRANSCRIPT_EVENT'; lineId: string }
  | { type: 'CLEAR_SYNC' }
  | { type: 'BACK_TO_SELECTOR' }
  | { type: 'TOGGLE_SELECTOR_PANEL' }
  | { type: 'TOGGLE_TIMELINE_FILTER'; filter: TimelineFilter }
  | { type: 'TOGGLE_TRANSCRIPT_FILTER'; filter: TranscriptFilter }
  | { type: 'OPEN_SUBAGENT'; entry: SubagentChainEntry; depth?: number }
  | { type: 'CLOSE_SUBAGENT' }
  | { type: 'CLOSE_SUBAGENT_AT'; index: number }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_DARK_MODE' }

const initialState: NavigationState = {
  depth: 'selector',
  selectedProjectId: null,
  selectedSessionId: null,
  selectedTranscriptLineId: null,
  syncedTranscriptLineId: null,
  syncedTimelineLineId: null,
  selectorPanel: { expanded: true },
  detailPanel: { expanded: false },
  timelineFilters: new Set<TimelineFilter>(['reminders', 'decisions', 'session-analysis', 'statusline', 'errors', 'hooks']),
  transcriptFilters: new Set<TranscriptFilter>(['conversation', 'tools', 'thinking', 'system', 'reminders', 'decisions', 'session-analysis', 'statusline', 'errors', 'hooks']),
  subagentChain: [],
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
        syncedTimelineLineId: null,
      }

    case 'SYNC_TO_TRANSCRIPT_EVENT':
      return {
        ...state,
        syncedTimelineLineId: action.lineId,
        syncedTranscriptLineId: null,
      }

    case 'CLEAR_SYNC':
      return {
        ...state,
        syncedTranscriptLineId: null,
        syncedTimelineLineId: null,
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

    case 'TOGGLE_TRANSCRIPT_FILTER': {
      const newFilters = new Set(state.transcriptFilters)
      if (newFilters.has(action.filter)) {
        newFilters.delete(action.filter)
      } else {
        newFilters.add(action.filter)
      }
      return { ...state, transcriptFilters: newFilters }
    }

    case 'OPEN_SUBAGENT': {
      // If depth is specified, pop everything after that depth then push
      const chain = action.depth != null
        ? [...state.subagentChain.slice(0, action.depth), action.entry]
        : [...state.subagentChain, action.entry]
      return { ...state, subagentChain: chain }
    }

    case 'CLOSE_SUBAGENT':
      return { ...state, subagentChain: state.subagentChain.slice(0, -1) }

    case 'CLOSE_SUBAGENT_AT':
      return { ...state, subagentChain: state.subagentChain.slice(0, action.index) }

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
