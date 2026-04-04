// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Transcript } from '../Transcript'
import { NavigationContext, type NavigationContextValue, initialState } from '../../../hooks/useNavigation'
import type { NavigationState, TranscriptLine } from '../../../types'

// Stub out heavy child components that aren't relevant to scrollToIndex behavior
vi.mock('../SearchFilterBar', () => ({ SearchFilterBar: () => <div data-testid="search-filter-bar" /> }))
vi.mock('../TranscriptFilterBar', () => ({ TranscriptFilterBar: () => <div data-testid="transcript-filter-bar" /> }))
vi.mock('../LEDColorKey', () => ({ LEDColorKey: () => <div data-testid="led-color-key" /> }))
vi.mock('../LEDGutter', () => ({ LEDGutter: () => <div data-testid="led-gutter" /> }))

// jsdom doesn't implement scrollIntoView — store mock for cleanup
const scrollIntoViewMock = vi.fn()

function freshState(overrides: Partial<NavigationState> = {}): NavigationState {
  return {
    ...initialState,
    // Ensure deep copies of mutable fields
    timelineFilters: new Set(initialState.timelineFilters),
    transcriptFilters: new Set(initialState.transcriptFilters),
    subagentChain: [],
    ...overrides,
  }
}

function makeToolPair(): TranscriptLine[] {
  const toolUseId = 'pair-001'
  return [
    {
      id: 'line-use',
      timestamp: 1711700000000,
      type: 'tool-use',
      toolUseId,
      toolName: 'Read',
      content: 'Reading file',
    },
    {
      id: 'line-result',
      timestamp: 1711700001000,
      type: 'tool-result',
      toolUseId,
      toolOutput: 'file contents',
      toolSuccess: true,
    },
  ]
}

function buildTree(state: NavigationState, dispatch: ReturnType<typeof vi.fn>) {
  const value: NavigationContextValue = { state, dispatch: dispatch as unknown as NavigationContextValue['dispatch'] }
  return (
    <NavigationContext.Provider value={value}>
      <Transcript
        lines={makeToolPair()}
        scrollToLineId={null}
      />
    </NavigationContext.Provider>
  )
}

function findDispatchCall(dispatch: ReturnType<typeof vi.fn>, type: string) {
  return dispatch.mock.calls.find(
    (call: unknown[]) => (call[0] as { type: string }).type === type
  )
}

function renderTranscript(state: NavigationState, dispatch: ReturnType<typeof vi.fn>) {
  const result = render(buildTree(state, dispatch))
  return {
    ...result,
    dispatch,
    rerenderWith: (newState: NavigationState) => result.rerender(buildTree(newState, dispatch)),
  }
}

describe('Transcript scrollToIndex via pair navigation', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof Element.prototype.scrollIntoView
    scrollIntoViewMock.mockClear()
    mockDispatch = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('dispatches SELECT_TRANSCRIPT_LINE when detail panel is expanded', () => {
    const state = freshState({
      detailPanel: { expanded: true },
      selectedProjectId: 'proj-1',
      selectedSessionId: 'sess-1',
    })
    renderTranscript(state, mockDispatch)

    // The tool-use line renders a "→ result" pair navigation link
    const navLink = screen.getByText('→ result')
    fireEvent.click(navLink)
    vi.runAllTimers()

    const selectCall = findDispatchCall(mockDispatch, 'SELECT_TRANSCRIPT_LINE')
    expect(selectCall).toBeDefined()
    expect(selectCall![0]).toEqual({ type: 'SELECT_TRANSCRIPT_LINE', lineId: 'line-result' })
  })

  it('does NOT dispatch SELECT_TRANSCRIPT_LINE when detail panel is collapsed', () => {
    const state = freshState({
      detailPanel: { expanded: false },
      selectedProjectId: 'proj-1',
      selectedSessionId: 'sess-1',
    })
    renderTranscript(state, mockDispatch)

    const navLink = screen.getByText('→ result')
    fireEvent.click(navLink)
    vi.runAllTimers()

    expect(findDispatchCall(mockDispatch, 'SELECT_TRANSCRIPT_LINE')).toBeUndefined()
  })

  it('always dispatches SYNC_TO_TIMELINE_EVENT regardless of expanded state', () => {
    const state = freshState({
      detailPanel: { expanded: false },
      selectedProjectId: 'proj-1',
      selectedSessionId: 'sess-1',
    })
    renderTranscript(state, mockDispatch)

    const navLink = screen.getByText('→ result')
    fireEvent.click(navLink)
    vi.runAllTimers()

    const syncCall = findDispatchCall(mockDispatch, 'SYNC_TO_TIMELINE_EVENT')
    expect(syncCall).toBeDefined()
    expect(syncCall![0]).toEqual({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: 'line-result' })
  })

  it('reads current expanded value via ref even when memo blocks row re-render (stale closure regression)', () => {
    // 1. Initial render with collapsed panel — rows capture a closure where expanded=false
    const collapsedState = freshState({
      detailPanel: { expanded: false },
      selectedProjectId: 'proj-1',
      selectedSessionId: 'sess-1',
    })
    const { rerenderWith } = renderTranscript(collapsedState, mockDispatch)

    // 2. Re-render with expanded panel — memo comparator blocks row re-render
    //    (none of the compared props changed: same lines, same selection, same LED, etc.)
    //    Without the ref fix, the onPairNavigate closure would still see expanded=false.
    const expandedState = freshState({
      detailPanel: { expanded: true },
      selectedProjectId: 'proj-1',
      selectedSessionId: 'sess-1',
    })
    rerenderWith(expandedState)

    const navLink = screen.getByText('→ result')
    fireEvent.click(navLink)
    vi.runAllTimers()

    // 3. Should dispatch SELECT_TRANSCRIPT_LINE because expandedRef.current is now true
    const selectCall = findDispatchCall(mockDispatch, 'SELECT_TRANSCRIPT_LINE')
    expect(selectCall).toBeDefined()
    expect(selectCall![0]).toEqual({ type: 'SELECT_TRANSCRIPT_LINE', lineId: 'line-result' })
  })
})
