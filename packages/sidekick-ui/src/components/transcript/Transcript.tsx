import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { TranscriptLine, LEDState } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { SearchFilterBar } from './SearchFilterBar'
import { LEDColorKey } from './LEDColorKey'
import { LEDGutter } from './LEDGutter'
import { TranscriptLineCard } from './TranscriptLine'

interface TranscriptProps {
  lines: TranscriptLine[]
  loading?: boolean
  error?: string | null
  ledStates: Map<string, LEDState>
  scrollToLineId: string | null
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

  const filteredLines = useMemo(() => {
    if (!state.searchQuery) return lines
    const q = state.searchQuery.toLowerCase()
    return lines.filter(line =>
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
  }, [lines, state.searchQuery])

  return (
    <div className="h-full flex flex-col">
      <SearchFilterBar />
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
            {/* LED Gutter */}
            <LEDGutter ledState={ledStates.get(line.id) ?? DEFAULT_LED} />

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
