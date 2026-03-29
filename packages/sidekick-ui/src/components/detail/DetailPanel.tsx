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
import { ValueChangeDetail } from './ValueChangeDetail'
import { PersonaDetail } from './PersonaDetail'
import { GeneratedMessageDetail } from './GeneratedMessageDetail'
import { TranscriptMessageDetail } from './TranscriptMessageDetail'
import { ToolResultDetail } from './ToolResultDetail'
import { CompactionDetail } from './CompactionDetail'
import { StatuslineDetail } from './StatuslineDetail'

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
      return <StatuslineDetail line={line} />
    case 'session-title:changed':
    case 'intent:changed':
      return <ValueChangeDetail line={line} />
    case 'persona:selected':
    case 'persona:changed':
      return <PersonaDetail line={line} />
    case 'snarky-message:finish':
    case 'resume-message:finish':
      return <GeneratedMessageDetail line={line} />
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
