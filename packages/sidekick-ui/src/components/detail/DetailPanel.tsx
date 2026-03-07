import type { TimelineEvent } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { DetailHeader } from './DetailHeader'
import { StateInspector } from './StateInspector'
import { ToolDetail } from './ToolDetail'
import { HookDetail } from './HookDetail'
import { DecisionDetail } from './DecisionDetail'
import { ReminderDetail } from './ReminderDetail'
import { ErrorDetail } from './ErrorDetail'
import { TranscriptDetail } from './TranscriptDetail'

interface DetailPanelProps {
  event: TimelineEvent
  events: TimelineEvent[]
}

export function DetailPanel({ event, events }: DetailPanelProps) {
  const { dispatch } = useNavigation()

  const currentIndex = events.findIndex(e => e.id === event.id)

  function handlePrev() {
    if (currentIndex > 0) {
      dispatch({ type: 'SELECT_EVENT', eventId: events[currentIndex - 1].id })
    }
  }

  function handleNext() {
    if (currentIndex < events.length - 1) {
      dispatch({ type: 'SELECT_EVENT', eventId: events[currentIndex + 1].id })
    }
  }

  function handleClose() {
    dispatch({ type: 'DESELECT_EVENT' })
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <DetailHeader
        event={event}
        currentIndex={currentIndex}
        totalCount={events.length}
        onPrev={handlePrev}
        onNext={handleNext}
        onClose={handleClose}
      />

      <div className="flex-1 overflow-y-auto">
        <DetailContent event={event} />
      </div>
    </div>
  )
}

function DetailContent({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case 'state-change':
      return <StateInspector event={event} />
    case 'tool-use':
      return <ToolDetail event={event} />
    case 'hook-execution':
      return <HookDetail event={event} />
    case 'decision':
      return <DecisionDetail event={event} />
    case 'reminder':
      return <ReminderDetail event={event} />
    case 'error':
      return <ErrorDetail event={event} />
    case 'user-message':
    case 'assistant-message':
    case 'llm-call':
      return <TranscriptDetail event={event} />
    default:
      return (
        <div className="p-3">
          <p className="text-xs text-slate-400 italic">No detail view for {event.type}</p>
          {event.content && (
            <p className="text-xs text-slate-700 dark:text-slate-300 mt-2">{event.content}</p>
          )}
        </div>
      )
  }
}
