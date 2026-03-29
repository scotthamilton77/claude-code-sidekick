// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TranscriptFilterBar } from '../TranscriptFilterBar'
import { NavigationContext, type NavigationContextValue } from '../../../hooks/useNavigation'
import { initialState } from '../../../hooks/useNavigation'
import type { NavigationState, TranscriptFilter } from '../../../types'

function freshState(overrides: Partial<NavigationState> = {}): NavigationState {
  return {
    ...initialState,
    timelineFilters: new Set(initialState.timelineFilters),
    transcriptFilters: new Set(initialState.transcriptFilters),
    subagentChain: [],
    ...overrides,
  }
}

function renderWithNavigation(state: NavigationState, dispatch?: ReturnType<typeof vi.fn>) {
  const mockDispatch = dispatch ?? (vi.fn() as ReturnType<typeof vi.fn>)
  const value: NavigationContextValue = { state, dispatch: mockDispatch as unknown as NavigationContextValue['dispatch'] }
  return {
    ...render(
      <NavigationContext.Provider value={value}>
        <TranscriptFilterBar />
      </NavigationContext.Provider>,
    ),
    dispatch: mockDispatch,
  }
}

describe('TranscriptFilterBar', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDispatch = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all 10 filter buttons plus "All" button', () => {
    renderWithNavigation(freshState(), mockDispatch)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Reminders')).toBeInTheDocument()
    expect(screen.getByText('Decisions')).toBeInTheDocument()
    expect(screen.getByText('Analysis')).toBeInTheDocument()
    expect(screen.getByText('Statusline')).toBeInTheDocument()
    expect(screen.getByText('Errors')).toBeInTheDocument()
    expect(screen.getByText('Hooks')).toBeInTheDocument()
  })

  it('dispatches TOGGLE_TRANSCRIPT_FILTER when a filter button is clicked', () => {
    renderWithNavigation(freshState(), mockDispatch)
    fireEvent.click(screen.getByText('Chat'))
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'TOGGLE_TRANSCRIPT_FILTER',
      filter: 'conversation',
    })
  })

  it('dispatches SET_ALL_TRANSCRIPT_FILTERS with empty set when "All" clicked and all active', () => {
    // All filters active
    renderWithNavigation(freshState(), mockDispatch)
    fireEvent.click(screen.getByText('All'))
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    const call = mockDispatch.mock.calls[0][0]
    expect(call.type).toBe('SET_ALL_TRANSCRIPT_FILTERS')
    // When all are active, clicking "All" should clear them
    expect(call.filters.size).toBe(0)
  })

  it('dispatches SET_ALL_TRANSCRIPT_FILTERS with all filters when "All" clicked and not all active', () => {
    const state = freshState({ transcriptFilters: new Set<TranscriptFilter>(['tools']) })
    renderWithNavigation(state, mockDispatch)
    fireEvent.click(screen.getByText('All'))
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    const call = mockDispatch.mock.calls[0][0]
    expect(call.type).toBe('SET_ALL_TRANSCRIPT_FILTERS')
    // When not all active, clicking "All" should enable all 10
    expect(call.filters.size).toBe(10)
  })
})
