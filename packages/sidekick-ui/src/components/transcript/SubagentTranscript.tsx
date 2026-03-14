import { useRef, useCallback, useMemo, useState } from 'react'
import { X, Minimize2 } from 'lucide-react'
import type { TranscriptLine, TranscriptFilter } from '../../types'
import { useSubagentTranscript } from '../../hooks/useSubagentTranscript'
import { useNavigation } from '../../hooks/useNavigation'
import { TranscriptLineCard } from './TranscriptLine'
import { useToolPairs } from './ToolPairConnector'

interface SubagentTranscriptProps {
  projectId: string
  sessionId: string
  agentId: string
  agentType?: string
  depth: number  // position in the chain (0-indexed)
  onClose: () => void
}

const SUBAGENT_FILTER_CATEGORIES: TranscriptFilter[] = ['conversation', 'tools', 'thinking', 'system']

function matchesSubagentFilter(line: TranscriptLine, filters: Set<TranscriptFilter>): boolean {
  if (filters.size >= 4) return true // all active for subagent (no sidekick category)

  const type = line.type

  if (type === 'assistant-message' && line.thinking && !line.content) return filters.has('thinking')
  if (type === 'assistant-message' && line.thinking && line.content) {
    return filters.has('conversation') || filters.has('thinking')
  }
  if (type === 'user-message' || type === 'assistant-message') return filters.has('conversation')
  if (type === 'tool-use' || type === 'tool-result') return filters.has('tools')
  return filters.has('system')
}

export function SubagentTranscript({ projectId, sessionId, agentId, agentType, depth, onClose }: SubagentTranscriptProps) {
  const { dispatch } = useNavigation()
  const { lines, meta, loading, error } = useSubagentTranscript(projectId, sessionId, agentId)
  const [minimized, setMinimized] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<TranscriptFilter>>(
    new Set(SUBAGENT_FILTER_CATEGORIES)
  )
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [hoveredToolUseId, setHoveredToolUseId] = useState<string | null>(null)

  const setRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) lineRefs.current.set(id, el)
    else lineRefs.current.delete(id)
  }, [])

  const filteredLines = useMemo(() => {
    return lines.filter(line => matchesSubagentFilter(line, activeFilters))
  }, [lines, activeFilters])

  const toolPairs = useToolPairs(filteredLines)
  const pairByToolUseId = useMemo(() => {
    const map = new Map<string, { useIndex: number; resultIndex: number; color: string }>()
    for (const pair of toolPairs) map.set(pair.toolUseId, pair)
    return map
  }, [toolPairs])

  function toggleFilter(filter: TranscriptFilter) {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })
  }

  function scrollToIndex(index: number) {
    const targetLine = filteredLines[index]
    if (targetLine) {
      const el = lineRefs.current.get(targetLine.id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const label = meta.agentType ?? agentType ?? `Agent ${agentId.slice(0, 8)}`

  if (minimized) {
    return (
      <div className="flex flex-col items-center justify-center w-8 bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700"
        onClick={() => setMinimized(false)}
      >
        <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 writing-mode-vertical [writing-mode:vertical-lr] rotate-180 whitespace-nowrap">
          {label}
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col border-l border-slate-200 dark:border-slate-700 min-w-[250px]" style={{ flex: '1 1 300px' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider truncate flex-1">
          {label}
        </span>
        <button onClick={() => setMinimized(true)} className="text-slate-400 hover:text-slate-600">
          <Minimize2 size={12} />
        </button>
        <button onClick={onClose} className="text-slate-400 hover:text-red-500">
          <X size={12} />
        </button>
      </div>

      {/* Filter bar (4 categories, no Sidekick) */}
      <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        {SUBAGENT_FILTER_CATEGORIES.map(filter => {
          const isActive = activeFilters.has(filter)
          return (
            <button
              key={filter}
              onClick={() => toggleFilter(filter)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                isActive
                  ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  : 'text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700'
              }`}
            >
              {filter === 'conversation' ? 'Chat' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">Loading...</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-xs text-red-400 px-2 text-center">{error}</div>
        )}
        {!loading && !error && filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">Empty transcript</div>
        )}
        {!loading && !error && filteredLines.map((line) => {
          const pair = line.toolUseId ? pairByToolUseId.get(line.toolUseId) : undefined
          const isHighlightedPair = hoveredToolUseId != null && line.toolUseId === hoveredToolUseId

          return (
            <div
              key={line.id}
              ref={setRef(line.id)}
              className={`${isHighlightedPair ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''}`}
              onMouseEnter={() => line.toolUseId && setHoveredToolUseId(line.toolUseId)}
              onMouseLeave={() => line.toolUseId && setHoveredToolUseId(null)}
            >
              <TranscriptLineCard
                line={line}
                isSelected={false}
                isSynced={false}
                onClick={() => {
                  // If this is an Agent tool-use with agentId, open nested subagent
                  if (line.type === 'tool-use' && line.toolName === 'Agent' && line.agentId) {
                    dispatch({
                      type: 'OPEN_SUBAGENT',
                      entry: { projectId, sessionId, agentId: line.agentId },
                      depth: depth + 1,
                    })
                  }
                }}
                pairNavigation={pair ? {
                  color: pair.color,
                  isToolUse: line.type === 'tool-use',
                  onNavigate: () => scrollToIndex(line.type === 'tool-use' ? pair.resultIndex : pair.useIndex),
                } : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
