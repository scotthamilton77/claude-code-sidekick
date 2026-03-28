import { useState } from 'react'
import type { TranscriptLine, StateSnapshot } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { DetailHeader } from './DetailHeader'
import { StateTab } from './StateTab'
import { ToolDetail } from './ToolDetail'
import { DecisionDetail } from './DecisionDetail'
import { ReminderDetail } from './ReminderDetail'
import { ErrorDetail } from './ErrorDetail'
import { HookDetail } from './HookDetail'

interface DetailPanelProps {
  line: TranscriptLine
  lines: TranscriptLine[]
  stateSnapshots: StateSnapshot[]
}

export function DetailPanel({ line, lines, stateSnapshots }: DetailPanelProps) {
  const { dispatch } = useNavigation()
  const [activeTab, setActiveTab] = useState<'details' | 'state'>('details')

  const currentIndex = lines.findIndex(l => l.id === line.id)

  function handlePrev() {
    if (currentIndex > 0) {
      dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: lines[currentIndex - 1].id })
    }
  }

  function handleNext() {
    if (currentIndex < lines.length - 1) {
      dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: lines[currentIndex + 1].id })
    }
  }

  function handleClose() {
    dispatch({ type: 'CLOSE_DETAIL' })
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <DetailHeader
        line={line}
        currentIndex={currentIndex}
        totalCount={lines.length}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onPrev={handlePrev}
        onNext={handleNext}
        onClose={handleClose}
      />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'details' ? (
          <DetailContent line={line} />
        ) : (
          <StateTab snapshots={stateSnapshots} currentTimestamp={line.timestamp} />
        )}
      </div>
    </div>
  )
}

function DetailContent({ line }: { line: TranscriptLine }) {
  switch (line.type) {
    case 'tool-use':
      return <ToolDetail line={line} />
    case 'decision:recorded':
      return <DecisionDetail line={line} />
    case 'reminder:staged':
    case 'reminder:unstaged':
    case 'reminder:consumed':
    case 'reminder:cleared':
      return <ReminderDetail line={line} />
    case 'error:occurred':
      return <ErrorDetail line={line} />
    case 'hook:received':
    case 'hook:completed':
      return <HookDetail line={line} />
    case 'user-message':
    case 'assistant-message':
      return <TranscriptMessageDetail line={line} />
    case 'tool-result':
      return <ToolResultDetail line={line} />
    case 'compaction':
      return <CompactionDetail line={line} />
    case 'statusline:rendered':
      return (
        <div className="p-3">
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Statusline Content</h3>
          <p className="text-xs font-mono text-teal-600 dark:text-teal-400">{line.statuslineContent}</p>
        </div>
      )
    case 'session-title:changed':
    case 'intent:changed':
      return (
        <div className="p-3 space-y-2">
          {line.previousValue && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 mb-1">Previous</h3>
              <p className="text-xs text-slate-500 line-through">{line.previousValue}</p>
            </div>
          )}
          {line.newValue && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 mb-1">New</h3>
              <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">{line.newValue}</p>
            </div>
          )}
          {line.confidence != null && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">Confidence:</span>
              <div className={`w-2.5 h-2.5 rounded-full ${
                line.confidence > 0.8 ? 'bg-emerald-400' : line.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
              }`} />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {Math.round(line.confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )
    case 'persona:selected':
    case 'persona:changed':
      return (
        <div className="p-3 space-y-2">
          {line.personaFrom && (
            <div>
              <h3 className="text-[10px] font-medium text-slate-500 mb-1">From</h3>
              <p className="text-xs text-slate-500">{line.personaFrom}</p>
            </div>
          )}
          <div>
            <h3 className="text-[10px] font-medium text-slate-500 mb-1">To</h3>
            <p className="text-xs font-medium text-pink-600 dark:text-pink-400">{line.personaTo}</p>
          </div>
        </div>
      )
    case 'snarky-message:finish':
    case 'resume-message:finish':
      return (
        <div className="p-3">
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Generated Message</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic">
            "{line.generatedMessage}"
          </p>
        </div>
      )
    default:
      return (
        <div className="p-3">
          <p className="text-xs text-slate-400 italic">
            {line.type.replace(/-/g, ' ')}
          </p>
        </div>
      )
  }
}

function TranscriptMessageDetail({ line }: { line: TranscriptLine }) {
  return (
    <div className="p-3 space-y-3">
      {line.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {line.content}
          </p>
        </div>
      )}
      {line.thinking && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Thinking</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap italic border-l-2 border-slate-200 dark:border-slate-700 pl-3">
            {line.thinking}
          </p>
        </div>
      )}
    </div>
  )
}

function ToolResultDetail({ line }: { line: TranscriptLine }) {
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          line.toolSuccess === false
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        }`}>
          {line.toolSuccess === false ? 'FAILED' : 'SUCCESS'}
        </span>
      </div>
      {line.toolOutput && (
        <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-auto max-h-[400px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
          {line.toolOutput}
        </pre>
      )}
    </div>
  )
}

function CompactionDetail({ line }: { line: TranscriptLine }) {
  return (
    <div className="p-3 space-y-2">
      <div>
        <h3 className="text-[10px] font-medium text-slate-500 mb-1">Segment</h3>
        <span className="text-xs text-slate-700 dark:text-slate-300">{line.compactionSegment ?? '?'}</span>
      </div>
      {line.compactionTokensBefore != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Tokens Before</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">
            {line.compactionTokensBefore.toLocaleString()}
          </span>
        </div>
      )}
      {line.compactionTokensAfter != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Tokens After</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">
            {line.compactionTokensAfter.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}
