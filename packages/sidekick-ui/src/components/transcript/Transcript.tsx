import { useRef, useEffect, useCallback, useMemo, memo, Fragment } from 'react'
import type { TranscriptLine, LEDState, SidekickEvent } from '../../types'
import { SIDEKICK_EVENT_TO_FILTER } from '../../types'
import { findNearestTimelineEvent } from '../../utils/findNearestTimelineEvent'
import { matchesTranscriptFilter } from '../../utils/classifyTranscriptLine'
import { useNavigation } from '../../hooks/useNavigation'
import { SearchFilterBar } from './SearchFilterBar'
import { TranscriptFilterBar } from './TranscriptFilterBar'
import { LEDColorKey } from './LEDColorKey'
import { LEDGutter } from './LEDGutter'
import { TranscriptLineCard } from './TranscriptLine'
import { useToolPairLookup, type GutterPairInfo, LEVEL_SPACING_PX, CONNECTOR_WIDTH_PX } from './ToolPairConnector'

interface TranscriptProps {
  lines: TranscriptLine[]
  loading?: boolean
  error?: string | null
  ledStates?: Map<string, LEDState> // deprecated — prefer line.ledState
  scrollToLineId: string | null
  defaultModel?: string
  timelineEvents?: SidekickEvent[]
}

const DEFAULT_LED: LEDState = {
  vcBuild: false,
  vcTypecheck: false,
  vcTest: false,
  vcLint: false,
  verifyCompletion: false,
  pauseAndReflect: false,
  titleConfidence: 'green',
  titleConfidencePct: 85,
}

/** Memoized row to prevent re-renders from parent hover state changes */
const TranscriptRow = memo(
  function TranscriptRow({
    line,
    isSelected,
    isSynced,
    ledState,
    gutterInfos,
    pairColor,
    pairIsToolUse,
    defaultModel,
    onLineClick,
    onPairNavigate,
    onRef,
  }: {
    line: TranscriptLine
    isSelected: boolean
    isSynced: boolean
    ledState: LEDState
    gutterInfos?: GutterPairInfo[]
    pairColor?: string
    pairIsToolUse?: boolean
    defaultModel?: string
    onLineClick: () => void
    onPairNavigate?: () => void
    onRef: (el: HTMLDivElement | null) => void
  }) {
    return (
      <div ref={onRef} className="flex">
        {/* LED Gutter with pair connector lines in dedicated column */}
        <div className="relative flex-shrink-0" style={{ overflow: 'visible' }}>
          <LEDGutter ledState={ledState} />
          {gutterInfos?.map((info) => (
            <Fragment key={info.toolUseId}>
              {/* Vertical connector at nesting level */}
              <div
                className={`absolute w-[2px] ${
                  info.role === 'start'
                    ? 'top-1/2 bottom-0 rounded-t-full'
                    : info.role === 'end'
                      ? 'top-0 bottom-1/2 rounded-b-full'
                      : 'top-0 bottom-0'
                }`}
                style={{
                  left: `calc(100% + ${info.level * LEVEL_SPACING_PX}px)`,
                  backgroundColor: info.color,
                  opacity: 0.6,
                }}
              />
              {/* Horizontal connector to content edge (start/end only) */}
              {(info.role === 'start' || info.role === 'end') && (
                <div
                  className="absolute h-[2px]"
                  style={{
                    left: `calc(100% + ${info.level * LEVEL_SPACING_PX}px)`,
                    width: `${CONNECTOR_WIDTH_PX - info.level * LEVEL_SPACING_PX}px`,
                    top: '50%',
                    backgroundColor: info.color,
                    opacity: 0.6,
                  }}
                />
              )}
            </Fragment>
          ))}
        </div>

        {/* Transcript content — margin reserves space for connector column */}
        <div className="flex-1 min-w-0 relative" style={{ marginLeft: `${CONNECTOR_WIDTH_PX}px` }}>
          {/* Bridge line from content edge to tool bubble (ml-6 + px-2 = 32px indent) */}
          {pairColor && (line.type === 'tool-use' || line.type === 'tool-result') && (
            <div
              className="absolute left-0 h-[2px] pointer-events-none"
              style={{ width: '32px', top: '50%', backgroundColor: pairColor, opacity: 0.6 }}
            />
          )}
          <TranscriptLineCard
            line={line}
            isSelected={isSelected}
            isSynced={isSynced}
            onClick={onLineClick}
            defaultModel={defaultModel}
            pairNavigation={
              pairColor && onPairNavigate
                ? {
                    color: pairColor,
                    isToolUse: pairIsToolUse ?? false,
                    onNavigate: onPairNavigate,
                  }
                : undefined
            }
          />
        </div>
      </div>
    )
  },
  (prev, next) =>
    prev.line === next.line &&
    prev.isSelected === next.isSelected &&
    prev.isSynced === next.isSynced &&
    prev.ledState === next.ledState &&
    prev.gutterInfos === next.gutterInfos &&
    prev.pairColor === next.pairColor &&
    prev.pairIsToolUse === next.pairIsToolUse &&
    prev.defaultModel === next.defaultModel
)

export function Transcript({
  lines,
  loading,
  error,
  ledStates,
  scrollToLineId,
  defaultModel,
  timelineEvents,
}: TranscriptProps) {
  const { state, dispatch } = useNavigation()
  const expandedRef = useRef(state.detailPanel.expanded)
  expandedRef.current = state.detailPanel.expanded
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll to line when timeline syncs
  useEffect(() => {
    if (scrollToLineId) {
      const el = lineRefs.current.get(scrollToLineId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [scrollToLineId])

  const setRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) {
        lineRefs.current.set(id, el)
      } else {
        lineRefs.current.delete(id)
      }
    },
    []
  )

  // Filter timeline events to match active timeline filters (so click-sync only targets visible events)
  const visibleTimelineEvents = useMemo(() => {
    if (!timelineEvents) return []
    return timelineEvents.filter((event) => {
      const category = SIDEKICK_EVENT_TO_FILTER[event.type]
      return category ? state.timelineFilters.has(category) : true
    })
  }, [timelineEvents, state.timelineFilters])

  // Apply transcript category filters, then search query
  const filteredLines = useMemo(() => {
    let result = lines

    // Category filter — always run (no size-based optimization to avoid HMR state mismatch)
    result = result.filter((line) => matchesTranscriptFilter(line, state.transcriptFilters))

    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase()
      result = result.filter(
        (line) =>
          line.content?.toLowerCase().includes(q) ||
          line.toolName?.toLowerCase().includes(q) ||
          line.toolOutput?.toLowerCase().includes(q) ||
          line.errorMessage?.toLowerCase().includes(q) ||
          line.reminderId?.toLowerCase().includes(q) ||
          line.decisionReasoning?.toLowerCase().includes(q) ||
          line.statuslineContent?.toLowerCase().includes(q) ||
          line.newValue?.toLowerCase().includes(q) ||
          line.generatedMessage?.toLowerCase().includes(q)
      )
    }

    return result
  }, [lines, state.transcriptFilters, state.searchQuery])

  const { pairByToolUseId, gutterByIndex } = useToolPairLookup(filteredLines)

  const scrollToIndex = useCallback(
    (index: number) => {
      const targetLine = filteredLines[index]
      if (targetLine) {
        const el = lineRefs.current.get(targetLine.id)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          if (expandedRef.current) {
            dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: targetLine.id })
          }
          dispatch({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: targetLine.id })
          setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 1500)
        }
      }
    },
    [filteredLines, dispatch]
  )

  return (
    <div className="h-full flex flex-col">
      <SearchFilterBar />
      <TranscriptFilterBar />
      <LEDColorKey />
      <div className="flex-1 overflow-y-auto py-1">
        {loading && <div className="flex items-center justify-center h-full text-slate-400">Loading transcript...</div>}
        {error && <div className="flex items-center justify-center h-full text-red-500 px-4 text-center">{error}</div>}
        {!loading && !error && filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">No transcript available</div>
        )}
        {!loading &&
          !error &&
          filteredLines.length > 0 &&
          filteredLines.map((line, index) => {
            const pair = line.toolUseId ? pairByToolUseId.get(line.toolUseId) : undefined
            const gutterInfos = gutterByIndex.get(index)

            return (
              <TranscriptRow
                key={line.id}
                line={line}
                isSelected={state.selectedTranscriptLineId === line.id}
                isSynced={state.syncedTranscriptLineId === line.id}
                ledState={line.ledState ?? ledStates?.get(line.id) ?? DEFAULT_LED}
                gutterInfos={gutterInfos}
                pairColor={pair?.color}
                pairIsToolUse={line.type === 'tool-use'}
                defaultModel={defaultModel}
                onLineClick={() => {
                  if (
                    line.type === 'tool-use' &&
                    line.toolName === 'Agent' &&
                    line.agentId &&
                    state.selectedProjectId &&
                    state.selectedSessionId
                  ) {
                    dispatch({
                      type: 'OPEN_SUBAGENT',
                      entry: {
                        projectId: state.selectedProjectId,
                        sessionId: state.selectedSessionId,
                        agentId: line.agentId,
                      },
                    })
                  } else {
                    // Open detail panel for all line types
                    dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: line.id })
                    // Sync to timeline: Sidekick events use their own ID, Claude Code lines find nearest
                    if (line.type in SIDEKICK_EVENT_TO_FILTER) {
                      dispatch({ type: 'SYNC_TO_TRANSCRIPT_EVENT', lineId: line.id })
                      setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
                    } else if (visibleTimelineEvents.length > 0) {
                      const nearest = findNearestTimelineEvent(visibleTimelineEvents, line.timestamp)
                      if (nearest) {
                        dispatch({ type: 'SYNC_TO_TRANSCRIPT_EVENT', lineId: nearest.transcriptLineId })
                        setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
                      }
                    }
                  }
                }}
                onPairNavigate={
                  pair ? () => scrollToIndex(line.type === 'tool-use' ? pair.resultIndex : pair.useIndex) : undefined
                }
                onRef={setRef(line.id)}
              />
            )
          })}
      </div>
    </div>
  )
}
