import { useState } from 'react'
import {
  User,
  Bot,
  Terminal,
  Scissors,
  AlertTriangle,
  Lightbulb,
  Bell,
  Gauge,
  UserCog,
  FileText,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Clock,
  GitPullRequest,
} from 'lucide-react'
import type { TranscriptLine as TLine, TranscriptLineType } from '../../types'

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

function formatToolInput(toolName?: string, input?: Record<string, unknown>): string {
  if (!input) return ''
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return truncate(input.command, 200)
  }
  if ((toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') && typeof input.file_path === 'string') {
    return truncate(input.file_path, 200)
  }
  if (toolName === 'Grep' && typeof input.pattern === 'string') {
    return `/${truncate(input.pattern, 100)}/`
  }
  if (toolName === 'Glob' && typeof input.pattern === 'string') {
    return truncate(input.pattern, 200)
  }
  if (toolName === 'Agent' && typeof input.description === 'string') {
    return truncate(input.description, 200)
  }
  // Fallback: show first string value
  for (const val of Object.values(input)) {
    if (typeof val === 'string') return truncate(val, 150)
  }
  return ''
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(ms?: number): string {
  if (ms == null) return '?'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface TranscriptLineProps {
  line: TLine
  isSelected: boolean
  isSynced: boolean
  onClick: () => void
}

export function TranscriptLineCard({ line, isSelected, isSynced, onClick }: TranscriptLineProps) {
  const [showThinking, setShowThinking] = useState(false)

  // Compaction gets special full-width divider treatment
  if (line.type === 'compaction') {
    return (
      <div
        onClick={onClick}
        className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Scissors size={12} />
          <span>Segment {line.compactionSegment ?? '?'}</span>
          {line.compactionTokensBefore != null && line.compactionTokensAfter != null && (
            <>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span>
                {(line.compactionTokensBefore / 1000).toFixed(0)}k → {(line.compactionTokensAfter / 1000).toFixed(0)}k
              </span>
            </>
          )}
        </div>
        <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
      </div>
    )
  }

  const styles = getLineStyles(line)
  const isSidekickEvent = isSidekickEventType(line.type)

  return (
    <div
      onClick={onClick}
      className={`px-2 py-0.5 transition-all cursor-pointer ${
        line.type === 'tool-use' || line.type === 'tool-result' ? 'ml-6' : ''
      }`}
    >
      <div
        className={`rounded-lg px-2.5 py-1.5 transition-all ${styles.bg} ${styles.border} ${
          isSelected
            ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
            : isSynced
              ? 'ring-2 ring-amber-400 dark:ring-amber-500'
              : ''
        }`}
      >
        {/* Header: icon + label + time */}
        <div className="flex items-center gap-1.5">
          <styles.Icon size={11} className={styles.iconColor} />
          <span className={`text-[10px] font-medium ${styles.labelColor}`}>{styles.label}</span>
          {line.isSidechain && (
            <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded">sidechain</span>
          )}
          {line.type === 'assistant-message' && !line.content && line.thinking && (
            <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded">thinking</span>
          )}
          {line.model && (
            <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded font-mono">
              {line.model.replace('claude-', '').split('-202')[0]}
            </span>
          )}
          <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
            {formatTime(line.timestamp)}
          </span>
        </div>

        {/* Content */}
        {line.content && !isSidekickEvent && (
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-3 mt-0.5">
            {line.content}
          </p>
        )}

        {/* Thinking-only assistant message — show thinking as primary content */}
        {line.type === 'assistant-message' && !line.content && line.thinking && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5 pl-3 border-l-2 border-slate-200 dark:border-slate-700 italic line-clamp-3">
            {line.thinking}
          </p>
        )}

        {/* Thinking block (collapsible) — only when there IS text content */}
        {line.type === 'assistant-message' && line.content && line.thinking && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowThinking(!showThinking)
            }}
            className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 hover:text-slate-600"
          >
            {showThinking ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <span>thinking</span>
          </button>
        )}
        {showThinking && line.thinking && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700 italic line-clamp-5">
            {line.thinking}
          </p>
        )}

        {/* Tool use details */}
        {line.type === 'tool-use' && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            <span className="font-mono">{line.toolName}</span>
            {line.toolDurationMs != null && <span className="ml-2">{line.toolDurationMs}ms</span>}
            {line.toolInput &&
              (() => {
                const preview = formatToolInput(line.toolName, line.toolInput)
                return preview ? (
                  <p className="font-mono text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-2">{preview}</p>
                ) : null
              })()}
          </div>
        )}

        {/* Tool result */}
        {line.type === 'tool-result' && line.toolOutput && (
          <p
            className={`text-[10px] font-mono mt-0.5 line-clamp-2 ${
              line.toolSuccess === false ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {line.toolOutput}
          </p>
        )}

        {/* API error message */}
        {line.type === 'api-error' && line.errorMessage && (
          <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5 font-mono">{line.errorMessage}</p>
        )}

        {/* PR link URL */}
        {line.type === 'pr-link' && line.prUrl && (
          <a
            href={line.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 mt-0.5 font-mono truncate block"
            onClick={(e) => e.stopPropagation()}
          >
            {line.prUrl}
          </a>
        )}

        {/* Sidekick event inline details */}
        {isSidekickEvent && renderSidekickDetail(line)}
      </div>
    </div>
  )
}

function isSidekickEventType(type: TranscriptLineType): boolean {
  return ![
    'user-message',
    'assistant-message',
    'tool-use',
    'tool-result',
    'compaction',
    'turn-duration',
    'api-error',
    'pr-link',
  ].includes(type)
}

function renderSidekickDetail(line: TLine) {
  switch (line.type) {
    case 'reminder:staged':
    case 'reminder:unstaged':
    case 'reminder:consumed':
      return (
        <div className="flex items-center gap-2 text-[10px] mt-0.5">
          <span
            className={`px-1 py-0.5 rounded font-medium ${
              line.type === 'reminder:staged'
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                : line.type === 'reminder:consumed'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            {line.type.split(':').pop()}
          </span>
          <span className="font-mono text-slate-500">{line.reminderId}</span>
          {line.reminderBlocking && <span className="text-red-400 font-medium">blocking</span>}
        </div>
      )

    case 'decision:recorded':
      return line.decisionReasoning ? (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 italic line-clamp-2">
          {line.decisionReasoning}
        </p>
      ) : null

    case 'session-title:changed':
    case 'intent:changed':
      return (
        <div className="text-[10px] text-slate-500 mt-0.5">
          {line.previousValue && <span className="line-through mr-1">{line.previousValue}</span>}
          {line.newValue && <span className="font-medium text-slate-700 dark:text-slate-300">{line.newValue}</span>}
          {line.confidence != null && <span className="ml-2 text-slate-400">{Math.round(line.confidence * 100)}%</span>}
        </div>
      )

    case 'persona:selected':
    case 'persona:changed':
      return (
        <div className="text-[10px] text-slate-500 mt-0.5">
          {line.personaFrom && <span className="line-through mr-1">{line.personaFrom}</span>}
          {line.personaTo && <span className="font-medium text-pink-600 dark:text-pink-400">{line.personaTo}</span>}
        </div>
      )

    case 'statusline:rendered':
      return line.statuslineContent ? (
        <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-0.5 font-mono">{line.statuslineContent}</p>
      ) : null

    case 'error:occurred':
      return line.errorMessage ? (
        <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 font-mono">{line.errorMessage}</p>
      ) : null

    case 'snarky-message:finish':
    case 'resume-message:finish':
      return line.generatedMessage ? (
        <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5 italic line-clamp-2">
          "{line.generatedMessage}"
        </p>
      ) : null

    default:
      return null
  }
}

function getLineStyles(line: TLine) {
  switch (line.type) {
    case 'user-message':
      return {
        bg: 'bg-white dark:bg-slate-800',
        border: 'border border-blue-200 dark:border-blue-800',
        Icon: User,
        iconColor: 'text-blue-500',
        label: 'User',
        labelColor: 'text-blue-600 dark:text-blue-400',
      }
    case 'assistant-message':
      return {
        bg: 'bg-white dark:bg-slate-800',
        border: 'border border-emerald-200 dark:border-emerald-800',
        Icon: Bot,
        iconColor: 'text-emerald-500',
        label: 'Assistant',
        labelColor: 'text-emerald-600 dark:text-emerald-400',
      }
    case 'tool-use':
      return {
        bg: 'bg-slate-50 dark:bg-slate-800/50',
        border: 'border border-cyan-200 dark:border-cyan-800',
        Icon: Terminal,
        iconColor: 'text-cyan-500',
        label: line.toolName ?? 'Tool',
        labelColor: 'text-cyan-600 dark:text-cyan-400',
      }
    case 'tool-result':
      return {
        bg: 'bg-slate-50 dark:bg-slate-800/50',
        border: `border ${line.toolSuccess === false ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'}`,
        Icon: FileText,
        iconColor: line.toolSuccess === false ? 'text-red-500' : 'text-slate-400',
        label: 'Result',
        labelColor:
          line.toolSuccess === false ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400',
      }
    case 'reminder:staged':
    case 'reminder:unstaged':
    case 'reminder:consumed':
      return {
        bg: 'bg-rose-50/50 dark:bg-rose-950/20',
        border: 'border border-rose-200 dark:border-rose-800/50',
        Icon: Bell,
        iconColor: 'text-rose-500',
        label: 'Reminder',
        labelColor: 'text-rose-600 dark:text-rose-400',
      }
    case 'decision:recorded':
      return {
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border border-amber-200 dark:border-amber-800/50',
        Icon: Lightbulb,
        iconColor: 'text-amber-500',
        label: line.decisionCategory ? `Decision: ${line.decisionCategory}` : 'Decision',
        labelColor: 'text-amber-600 dark:text-amber-400',
      }
    case 'session-summary:start':
    case 'session-summary:finish':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-purple-200 dark:border-purple-800/50',
        Icon: Play,
        iconColor: 'text-purple-500',
        label: line.type === 'session-summary:start' ? 'Summary ▶' : 'Summary ■',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'session-title:changed':
    case 'intent:changed':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-purple-200 dark:border-purple-800/50',
        Icon: FileText,
        iconColor: 'text-purple-500',
        label: line.type === 'session-title:changed' ? 'Title Changed' : 'Intent Changed',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'snarky-message:start':
    case 'snarky-message:finish':
    case 'resume-message:start':
    case 'resume-message:finish':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-purple-200 dark:border-purple-800/50',
        Icon: line.type.includes('start') ? Play : Square,
        iconColor: 'text-purple-500',
        label: line.type.replace(/[:-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'persona:selected':
    case 'persona:changed':
      return {
        bg: 'bg-pink-50/50 dark:bg-pink-950/20',
        border: 'border border-pink-200 dark:border-pink-800/50',
        Icon: UserCog,
        iconColor: 'text-pink-500',
        label: line.type === 'persona:selected' ? 'Persona Selected' : 'Persona Changed',
        labelColor: 'text-pink-600 dark:text-pink-400',
      }
    case 'statusline:rendered':
      return {
        bg: 'bg-teal-50/50 dark:bg-teal-950/20',
        border: 'border border-teal-200 dark:border-teal-800/50',
        Icon: Gauge,
        iconColor: 'text-teal-500',
        label: 'Statusline',
        labelColor: 'text-teal-600 dark:text-teal-400',
      }
    case 'error:occurred':
      return {
        bg: 'bg-red-50 dark:bg-red-950/30',
        border: 'border-2 border-red-300 dark:border-red-800',
        Icon: AlertTriangle,
        iconColor: 'text-red-500',
        label: 'Error',
        labelColor: 'text-red-600 dark:text-red-400',
      }
    case 'turn-duration':
      return {
        bg: 'bg-slate-50 dark:bg-slate-800/50',
        border: 'border border-slate-200 dark:border-slate-700',
        Icon: Clock,
        iconColor: 'text-slate-400',
        label: `Turn: ${formatDuration(line.durationMs)}`,
        labelColor: 'text-slate-500 dark:text-slate-400',
      }
    case 'api-error':
      return {
        bg: 'bg-orange-50 dark:bg-orange-950/20',
        border: 'border border-orange-200 dark:border-orange-800/50',
        Icon: AlertTriangle,
        iconColor: 'text-orange-500',
        label: `API Retry${line.retryAttempt != null && line.maxRetries != null ? ` ${line.retryAttempt}/${line.maxRetries}` : ''}`,
        labelColor: 'text-orange-600 dark:text-orange-400',
      }
    case 'pr-link':
      return {
        bg: 'bg-indigo-50 dark:bg-indigo-950/20',
        border: 'border border-indigo-200 dark:border-indigo-800/50',
        Icon: GitPullRequest,
        iconColor: 'text-indigo-500',
        label: `PR #${line.prNumber ?? '?'}`,
        labelColor: 'text-indigo-600 dark:text-indigo-400',
      }
    default:
      return {
        bg: 'bg-slate-50 dark:bg-slate-800',
        border: 'border border-slate-200 dark:border-slate-700',
        Icon: FileText,
        iconColor: 'text-slate-400',
        label: line.type,
        labelColor: 'text-slate-500',
      }
  }
}
