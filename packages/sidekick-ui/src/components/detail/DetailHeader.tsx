import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { TranscriptLine } from '../../types'

interface DetailHeaderProps {
  line: TranscriptLine
  currentIndex: number
  totalCount: number
  activeTab: 'details' | 'state'
  onTabChange: (tab: 'details' | 'state') => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

export function DetailHeader({ line, currentIndex, totalCount, activeTab, onTabChange, onPrev, onNext, onClose }: DetailHeaderProps) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Top row: title + nav + close */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded flex-shrink-0">
            {line.type}
          </span>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
            {getLineLabel(line)}
          </h2>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onPrev}
            disabled={currentIndex <= 0}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous line"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[10px] text-slate-400 tabular-nums min-w-[40px] text-center">
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next line"
          >
            <ChevronRight size={14} />
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
            title="Close detail"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-4 px-3">
        <button
          onClick={() => onTabChange('details')}
          className={`pb-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'details'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Details
        </button>
        <button
          onClick={() => onTabChange('state')}
          className={`pb-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'state'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          State
        </button>
      </div>
    </div>
  )
}

function getLineLabel(line: TranscriptLine): string {
  switch (line.type) {
    case 'user-message': return line.content?.slice(0, 60) ?? 'User message'
    case 'assistant-message': return line.content?.slice(0, 60) ?? 'Assistant message'
    case 'tool-use': return line.toolName ?? 'Tool use'
    case 'tool-result': return 'Tool result'
    case 'compaction': return `Compaction (segment ${line.compactionSegment ?? '?'})`
    case 'reminder:staged':
    case 'reminder:unstaged':
    case 'reminder:consumed': return `${line.type}: ${line.reminderId ?? ''}`
    case 'decision:recorded': return `Decision: ${line.decisionTitle ?? line.decisionCategory ?? 'unknown'}`
    case 'session-title:changed': return line.newValue ? `Title → ${line.newValue}` : 'Title changed'
    case 'intent:changed': return line.newValue ? `Intent → ${line.newValue}` : 'Intent changed'
    case 'persona:selected': return `Persona: ${line.personaTo ?? ''}`
    case 'persona:changed': return `${line.personaFrom ?? ''} → ${line.personaTo ?? ''}`
    case 'snarky-message:start': return 'Snarky Message Start'
    case 'snarky-message:finish': return line.generatedMessage ? `Snarky Message Finish: ${line.generatedMessage.slice(0, 50)}` : 'Snarky Message Finish'
    case 'resume-message:start': return 'Resume Message Start'
    case 'resume-message:finish': return line.generatedMessage ? `Resume Message Finish: ${line.generatedMessage.slice(0, 50)}` : 'Resume Message Finish'
    case 'statusline:rendered': return 'Statusline called'
    case 'error:occurred': return line.errorMessage?.slice(0, 60) ?? 'Error'
    default: return line.type
  }
}
