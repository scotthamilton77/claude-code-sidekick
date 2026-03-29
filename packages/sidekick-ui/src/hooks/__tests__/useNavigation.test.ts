import { describe, it, expect } from 'vitest'
import { navigationReducer, initialState } from '../useNavigation'
import type { NavigationState, SubagentChainEntry, TimelineFilter, TranscriptFilter } from '../../types'

/** Return a fresh copy of initialState to avoid cross-test mutation */
function freshState(overrides: Partial<NavigationState> = {}): NavigationState {
  return {
    ...initialState,
    timelineFilters: new Set(initialState.timelineFilters),
    transcriptFilters: new Set(initialState.transcriptFilters),
    subagentChain: [...initialState.subagentChain],
    ...overrides,
  }
}

describe('navigationReducer', () => {
  describe('initialState', () => {
    it('starts at selector depth with no selections', () => {
      expect(initialState.depth).toBe('selector')
      expect(initialState.selectedProjectId).toBeNull()
      expect(initialState.selectedSessionId).toBeNull()
      expect(initialState.selectedTranscriptLineId).toBeNull()
      expect(initialState.syncedTranscriptLineId).toBeNull()
      expect(initialState.syncedTimelineLineId).toBeNull()
    })

    it('has selector panel expanded and detail panel collapsed', () => {
      expect(initialState.selectorPanel.expanded).toBe(true)
      expect(initialState.detailPanel.expanded).toBe(false)
    })

    it('has all timeline filters enabled', () => {
      const expected: TimelineFilter[] = ['reminders', 'decisions', 'session-analysis', 'statusline', 'errors', 'hooks']
      expect(initialState.timelineFilters.size).toBe(expected.length)
      for (const f of expected) {
        expect(initialState.timelineFilters.has(f)).toBe(true)
      }
    })

    it('has all transcript filters enabled', () => {
      const expected: TranscriptFilter[] = [
        'conversation', 'tools', 'thinking', 'system',
        'reminders', 'decisions', 'session-analysis', 'statusline', 'errors', 'hooks',
      ]
      expect(initialState.transcriptFilters.size).toBe(expected.length)
      for (const f of expected) {
        expect(initialState.transcriptFilters.has(f)).toBe(true)
      }
    })

    it('starts with empty subagent chain and search query', () => {
      expect(initialState.subagentChain).toEqual([])
      expect(initialState.searchQuery).toBe('')
      expect(initialState.darkMode).toBe(false)
    })
  })

  describe('SELECT_SESSION', () => {
    it('transitions to dashboard depth and stores project/session IDs', () => {
      const state = freshState()
      const result = navigationReducer(state, {
        type: 'SELECT_SESSION',
        projectId: 'proj-1',
        sessionId: 'sess-1',
      })
      expect(result.depth).toBe('dashboard')
      expect(result.selectedProjectId).toBe('proj-1')
      expect(result.selectedSessionId).toBe('sess-1')
    })

    it('clears transcript selection and sync state', () => {
      const state = freshState({
        selectedTranscriptLineId: 'line-42',
        syncedTranscriptLineId: 'line-7',
      })
      const result = navigationReducer(state, {
        type: 'SELECT_SESSION',
        projectId: 'proj-1',
        sessionId: 'sess-1',
      })
      expect(result.selectedTranscriptLineId).toBeNull()
      expect(result.syncedTranscriptLineId).toBeNull()
    })

    it('collapses both panels', () => {
      const state = freshState({
        selectorPanel: { expanded: true },
        detailPanel: { expanded: true },
      })
      const result = navigationReducer(state, {
        type: 'SELECT_SESSION',
        projectId: 'proj-1',
        sessionId: 'sess-1',
      })
      expect(result.selectorPanel.expanded).toBe(false)
      expect(result.detailPanel.expanded).toBe(false)
    })
  })

  describe('SELECT_TRANSCRIPT_LINE', () => {
    it('transitions to detail depth and stores line ID', () => {
      const state = freshState({ depth: 'dashboard', selectedSessionId: 'sess-1' })
      const result = navigationReducer(state, {
        type: 'SELECT_TRANSCRIPT_LINE',
        lineId: 'line-1',
      })
      expect(result.depth).toBe('detail')
      expect(result.selectedTranscriptLineId).toBe('line-1')
    })

    it('expands detail panel and clears sync', () => {
      const state = freshState({ syncedTranscriptLineId: 'line-old' })
      const result = navigationReducer(state, {
        type: 'SELECT_TRANSCRIPT_LINE',
        lineId: 'line-1',
      })
      expect(result.detailPanel.expanded).toBe(true)
      expect(result.syncedTranscriptLineId).toBeNull()
    })
  })

  describe('CLOSE_DETAIL', () => {
    it('returns to dashboard depth and clears transcript selection', () => {
      const state = freshState({
        depth: 'detail',
        selectedTranscriptLineId: 'line-1',
        detailPanel: { expanded: true },
      })
      const result = navigationReducer(state, { type: 'CLOSE_DETAIL' })
      expect(result.depth).toBe('dashboard')
      expect(result.selectedTranscriptLineId).toBeNull()
      expect(result.detailPanel.expanded).toBe(false)
    })
  })

  describe('SYNC_TO_TIMELINE_EVENT', () => {
    it('sets syncedTranscriptLineId and clears syncedTimelineLineId', () => {
      const state = freshState({ syncedTimelineLineId: 'old-timeline' })
      const result = navigationReducer(state, {
        type: 'SYNC_TO_TIMELINE_EVENT',
        lineId: 'line-5',
      })
      expect(result.syncedTranscriptLineId).toBe('line-5')
      expect(result.syncedTimelineLineId).toBeNull()
    })
  })

  describe('SYNC_TO_TRANSCRIPT_EVENT', () => {
    it('sets syncedTimelineLineId and clears syncedTranscriptLineId', () => {
      const state = freshState({ syncedTranscriptLineId: 'old-transcript' })
      const result = navigationReducer(state, {
        type: 'SYNC_TO_TRANSCRIPT_EVENT',
        lineId: 'line-9',
      })
      expect(result.syncedTimelineLineId).toBe('line-9')
      expect(result.syncedTranscriptLineId).toBeNull()
    })
  })

  describe('CLEAR_SYNC', () => {
    it('clears both sync IDs', () => {
      const state = freshState({
        syncedTranscriptLineId: 'a',
        syncedTimelineLineId: 'b',
      })
      const result = navigationReducer(state, { type: 'CLEAR_SYNC' })
      expect(result.syncedTranscriptLineId).toBeNull()
      expect(result.syncedTimelineLineId).toBeNull()
    })
  })

  describe('BACK_TO_SELECTOR', () => {
    it('resets to selector depth and clears all selections', () => {
      const state = freshState({
        depth: 'detail',
        selectedProjectId: 'proj-1',
        selectedSessionId: 'sess-1',
        selectedTranscriptLineId: 'line-1',
        syncedTranscriptLineId: 'line-2',
        detailPanel: { expanded: true },
        selectorPanel: { expanded: false },
      })
      const result = navigationReducer(state, { type: 'BACK_TO_SELECTOR' })
      expect(result.depth).toBe('selector')
      expect(result.selectedProjectId).toBeNull()
      expect(result.selectedSessionId).toBeNull()
      expect(result.selectedTranscriptLineId).toBeNull()
      expect(result.syncedTranscriptLineId).toBeNull()
      expect(result.selectorPanel.expanded).toBe(true)
      expect(result.detailPanel.expanded).toBe(false)
    })
  })

  describe('TOGGLE_SELECTOR_PANEL', () => {
    it('expands selector when collapsed, switching to selector depth', () => {
      const state = freshState({
        depth: 'dashboard',
        selectorPanel: { expanded: false },
        detailPanel: { expanded: true },
        selectedSessionId: 'sess-1',
      })
      const result = navigationReducer(state, { type: 'TOGGLE_SELECTOR_PANEL' })
      expect(result.depth).toBe('selector')
      expect(result.selectorPanel.expanded).toBe(true)
      expect(result.detailPanel.expanded).toBe(false)
    })

    it('collapses selector when expanded and session selected, returning to dashboard', () => {
      const state = freshState({
        depth: 'selector',
        selectorPanel: { expanded: true },
        selectedSessionId: 'sess-1',
        selectedTranscriptLineId: null,
      })
      const result = navigationReducer(state, { type: 'TOGGLE_SELECTOR_PANEL' })
      expect(result.depth).toBe('dashboard')
      expect(result.selectorPanel.expanded).toBe(false)
      expect(result.detailPanel.expanded).toBe(false)
    })

    it('collapses selector and returns to detail when transcript line is selected', () => {
      const state = freshState({
        depth: 'selector',
        selectorPanel: { expanded: true },
        selectedSessionId: 'sess-1',
        selectedTranscriptLineId: 'line-1',
      })
      const result = navigationReducer(state, { type: 'TOGGLE_SELECTOR_PANEL' })
      expect(result.depth).toBe('detail')
      expect(result.selectorPanel.expanded).toBe(false)
      expect(result.detailPanel.expanded).toBe(true)
    })

    it('is a no-op when selector is expanded but no session is selected', () => {
      const state = freshState({
        depth: 'selector',
        selectorPanel: { expanded: true },
        selectedSessionId: null,
      })
      const result = navigationReducer(state, { type: 'TOGGLE_SELECTOR_PANEL' })
      expect(result).toBe(state) // reference equality — no change
    })
  })

  describe('TOGGLE_TIMELINE_FILTER', () => {
    it('removes filter when present', () => {
      const state = freshState()
      expect(state.timelineFilters.has('reminders')).toBe(true)
      const result = navigationReducer(state, {
        type: 'TOGGLE_TIMELINE_FILTER',
        filter: 'reminders',
      })
      expect(result.timelineFilters.has('reminders')).toBe(false)
    })

    it('adds filter when absent', () => {
      const state = freshState({ timelineFilters: new Set<TimelineFilter>() })
      const result = navigationReducer(state, {
        type: 'TOGGLE_TIMELINE_FILTER',
        filter: 'hooks',
      })
      expect(result.timelineFilters.has('hooks')).toBe(true)
    })

    it('does not mutate original state', () => {
      const state = freshState()
      const originalSize = state.timelineFilters.size
      navigationReducer(state, { type: 'TOGGLE_TIMELINE_FILTER', filter: 'reminders' })
      expect(state.timelineFilters.size).toBe(originalSize)
    })
  })

  describe('SET_ALL_TIMELINE_FILTERS', () => {
    it('replaces timeline filters with provided set', () => {
      const state = freshState()
      const newFilters = new Set<TimelineFilter>(['errors', 'hooks'])
      const result = navigationReducer(state, {
        type: 'SET_ALL_TIMELINE_FILTERS',
        filters: newFilters,
      })
      expect(result.timelineFilters).toBe(newFilters)
    })
  })

  describe('TOGGLE_TRANSCRIPT_FILTER', () => {
    it('removes filter when present', () => {
      const state = freshState()
      const result = navigationReducer(state, {
        type: 'TOGGLE_TRANSCRIPT_FILTER',
        filter: 'tools',
      })
      expect(result.transcriptFilters.has('tools')).toBe(false)
    })

    it('adds filter when absent', () => {
      const state = freshState({ transcriptFilters: new Set<TranscriptFilter>() })
      const result = navigationReducer(state, {
        type: 'TOGGLE_TRANSCRIPT_FILTER',
        filter: 'conversation',
      })
      expect(result.transcriptFilters.has('conversation')).toBe(true)
    })
  })

  describe('SET_ALL_TRANSCRIPT_FILTERS', () => {
    it('replaces transcript filters with provided set', () => {
      const state = freshState()
      const empty = new Set<TranscriptFilter>()
      const result = navigationReducer(state, {
        type: 'SET_ALL_TRANSCRIPT_FILTERS',
        filters: empty,
      })
      expect(result.transcriptFilters.size).toBe(0)
    })
  })

  describe('OPEN_SUBAGENT', () => {
    const entry: SubagentChainEntry = {
      projectId: 'proj-1',
      sessionId: 'sess-1',
      agentId: 'agent-1',
    }

    it('appends entry to subagent chain', () => {
      const state = freshState()
      const result = navigationReducer(state, {
        type: 'OPEN_SUBAGENT',
        entry,
      })
      expect(result.subagentChain).toHaveLength(1)
      expect(result.subagentChain[0]).toBe(entry)
    })

    it('appends multiple entries', () => {
      const entry2: SubagentChainEntry = { projectId: 'proj-1', sessionId: 'sess-1', agentId: 'agent-2' }
      const state = freshState({ subagentChain: [entry] })
      const result = navigationReducer(state, {
        type: 'OPEN_SUBAGENT',
        entry: entry2,
      })
      expect(result.subagentChain).toHaveLength(2)
      expect(result.subagentChain[1]).toBe(entry2)
    })

    it('truncates chain at specified depth before appending', () => {
      const entry1: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a1' }
      const entry2: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a2' }
      const entry3: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a3' }
      const state = freshState({ subagentChain: [entry1, entry2] })
      const result = navigationReducer(state, {
        type: 'OPEN_SUBAGENT',
        entry: entry3,
        depth: 1,
      })
      expect(result.subagentChain).toHaveLength(2)
      expect(result.subagentChain[0]).toBe(entry1)
      expect(result.subagentChain[1]).toBe(entry3)
    })

    it('handles depth=0 replacing entire chain', () => {
      const existing: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a1' }
      const replacement: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a-new' }
      const state = freshState({ subagentChain: [existing] })
      const result = navigationReducer(state, {
        type: 'OPEN_SUBAGENT',
        entry: replacement,
        depth: 0,
      })
      expect(result.subagentChain).toEqual([replacement])
    })
  })

  describe('CLOSE_SUBAGENT', () => {
    it('removes last entry from chain', () => {
      const entry1: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a1' }
      const entry2: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a2' }
      const state = freshState({ subagentChain: [entry1, entry2] })
      const result = navigationReducer(state, { type: 'CLOSE_SUBAGENT' })
      expect(result.subagentChain).toHaveLength(1)
      expect(result.subagentChain[0]).toBe(entry1)
    })

    it('produces empty chain when closing last subagent', () => {
      const entry: SubagentChainEntry = { projectId: 'p', sessionId: 's', agentId: 'a1' }
      const state = freshState({ subagentChain: [entry] })
      const result = navigationReducer(state, { type: 'CLOSE_SUBAGENT' })
      expect(result.subagentChain).toEqual([])
    })
  })

  describe('CLOSE_SUBAGENT_AT', () => {
    it('truncates chain at specified index', () => {
      const entries: SubagentChainEntry[] = [
        { projectId: 'p', sessionId: 's', agentId: 'a1' },
        { projectId: 'p', sessionId: 's', agentId: 'a2' },
        { projectId: 'p', sessionId: 's', agentId: 'a3' },
      ]
      const state = freshState({ subagentChain: entries })
      const result = navigationReducer(state, { type: 'CLOSE_SUBAGENT_AT', index: 1 })
      expect(result.subagentChain).toHaveLength(1)
      expect(result.subagentChain[0].agentId).toBe('a1')
    })

    it('empties chain when index is 0', () => {
      const entries: SubagentChainEntry[] = [
        { projectId: 'p', sessionId: 's', agentId: 'a1' },
      ]
      const state = freshState({ subagentChain: entries })
      const result = navigationReducer(state, { type: 'CLOSE_SUBAGENT_AT', index: 0 })
      expect(result.subagentChain).toEqual([])
    })
  })

  describe('SET_SEARCH', () => {
    it('sets search query', () => {
      const state = freshState()
      const result = navigationReducer(state, { type: 'SET_SEARCH', query: 'hello' })
      expect(result.searchQuery).toBe('hello')
    })

    it('clears search query with empty string', () => {
      const state = freshState({ searchQuery: 'old' })
      const result = navigationReducer(state, { type: 'SET_SEARCH', query: '' })
      expect(result.searchQuery).toBe('')
    })
  })

  describe('TOGGLE_DARK_MODE', () => {
    it('toggles dark mode on', () => {
      const state = freshState({ darkMode: false })
      const result = navigationReducer(state, { type: 'TOGGLE_DARK_MODE' })
      expect(result.darkMode).toBe(true)
    })

    it('toggles dark mode off', () => {
      const state = freshState({ darkMode: true })
      const result = navigationReducer(state, { type: 'TOGGLE_DARK_MODE' })
      expect(result.darkMode).toBe(false)
    })
  })

  describe('unknown action type', () => {
    it('returns state unchanged', () => {
      const state = freshState()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = navigationReducer(state, { type: 'NONEXISTENT' } as any)
      expect(result).toBe(state)
    })
  })
})
