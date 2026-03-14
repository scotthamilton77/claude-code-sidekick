import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { TranscriptLine, TranscriptLineType, LEDState, TranscriptFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { SearchFilterBar } from './SearchFilterBar'
import { TranscriptFilterBar } from './TranscriptFilterBar'
import { LEDColorKey } from './LEDColorKey'
import { LEDGutter } from './LEDGutter'
import { TranscriptLineCard } from './TranscriptLine'

interface TranscriptProps {
  lines: TranscriptLine[]
  loading?: boolean
  error?: string | null
  ledStates?: Map<string, LEDState>  // deprecated — prefer line.ledState
  scrollToLineId: string | null
}

const CLAUDE_CODE_TYPES = new Set<TranscriptLineType>([
  'user-message', 'assistant-message', 'tool-use', 'tool-result',
  'compaction', 'turn-duration', 'api-error', 'pr-link',
])

function matchesTranscriptFilter(line: TranscriptLine, filters: Set<TranscriptFilter>): boolean {
  if (filters.size === 5) return true // all active = show everything

  const type = line.type

  // Thinking-only assistant message
  if (type === 'assistant-message' && line.thinking && !line.content) {
    return filters.has('thinking')
  }

  // Assistant message with both content and thinking: show if either filter is active
  if (type === 'assistant-message' && line.thinking && line.content) {
    return filters.has('conversation') || filters.has('thinking')
  }

  // Regular conversation
  if (type === 'user-message' || type === 'assistant-message') return filters.has('conversation')

  // Tools
  if (type === 'tool-use' || type === 'tool-result') return filters.has('tools')

  // System types
  if (type === 'compaction' || type === 'turn-duration' || type === 'api-error' || type === 'pr-link') {
    return filters.has('system')
  }

  // Everything else is a Sidekick event type
  if (!CLAUDE_CODE_TYPES.has(type)) return filters.has('sidekick')

  return true
}

const DEFAULT_LED: LEDState = {
  vcBuild: false, vcTypecheck: false, vcTest: false, vcLint: false,
  verifyCompletion: false, pauseAndReflect: false, titleConfidence: 'green', titleConfidencePct: 85,
}

export function Transcript({ lines, loading, error, ledStates, scrollToLineId }: TranscriptProps) {
  const { state, dispatch } = useNavigation()
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

  const setRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      lineRefs.current.set(id, el)
    } else {
      lineRefs.current.delete(id)
    }
  }, [])

  // Apply transcript category filters, then search query
  const filteredLines = useMemo(() => {
    let result = lines

    // Category filter
    if (state.transcriptFilters.size < 5) {
      result = result.filter(line => matchesTranscriptFilter(line, state.transcriptFilters))
    }

    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase()
      result = result.filter(line =>
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

  return (
    <div className="h-full flex flex-col">
      <SearchFilterBar />
      <TranscriptFilterBar />
      <LEDColorKey />
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center h-full text-slate-400">
            Loading transcript...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-red-500 px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !error && filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">
            No transcript available
          </div>
        )}
        {!loading && !error && filteredLines.length > 0 && filteredLines.map(line => (
          <div key={line.id} ref={setRef(line.id)} className="flex">
            {/* LED Gutter — prefer line.ledState (server-computed) over Map lookup */}
            <LEDGutter ledState={line.ledState ?? ledStates?.get(line.id) ?? DEFAULT_LED} />

            {/* Transcript content */}
            <div className="flex-1 min-w-0">
              <TranscriptLineCard
                line={line}
                isSelected={state.selectedTranscriptLineId === line.id}
                isSynced={state.syncedTranscriptLineId === line.id}
                onClick={() => dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: line.id })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
