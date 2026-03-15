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
  Zap,
} from 'lucide-react'
import type { TranscriptLine as TLine, TranscriptLineType } from '../../types'
import { formatTime } from '../../utils/formatTime'
import { CollapsibleContent } from './CollapsibleContent'

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

/** Only allow http/https URLs to prevent javascript: injection */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function formatDuration(ms?: number): string {
  if (ms == null) return '?'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface PairNavigation {
  color: string
  isToolUse: boolean
  onNavigate: () => void
}

interface TranscriptLineProps {
  line: TLine
  isSelected: boolean
  isSynced: boolean
  onClick: () => void
  pairNavigation?: PairNavigation
}

/** Extract command name from content containing <command-name> tag */
function extractCommandName(content: string): string | null {
  const match = content.match(/<command-name>\/?([\w-]+)<\/command-name>/)
  return match ? match[1] : null
}

const CLAUDE_CODE_TYPES: ReadonlySet<TranscriptLineType> = new Set([
  'user-message', 'assistant-message', 'tool-use', 'tool-result',
  'compaction', 'turn-duration', 'api-error', 'pr-link',
])

function isSidekickEventType(type: TranscriptLineType): boolean {
  return !CLAUDE_CODE_TYPES.has(type)
}

/** Build single-line label + optional detail for sidekick events */
function buildSidekickSingleLine(line: TLine): { label: string; detail?: string } {
  switch (line.type) {
    case 'reminder:staged':
      return { label: `Staged ${line.reminderId ?? 'unknown'}`, detail: line.reminderBlocking ? 'blocking' : undefined }
    case 'reminder:unstaged':
      return { label: `Unstaged ${line.reminderId ?? 'unknown'}` }
    case 'reminder:consumed':
      return { label: `Consumed ${line.reminderId ?? 'unknown'}` }
    case 'reminder:cleared':
      return { label: `Cleared ${line.reminderId ?? 'all'}` }
    case 'decision:recorded':
      return { label: `Decision: ${line.decisionCategory ?? 'unknown'}`, detail: line.decisionReasoning }
    case 'session-summary:start':
      return { label: 'Summary Analysis Start' }
    case 'session-summary:finish':
      return { label: 'Summary Analysis Finish', detail: line.newValue ? `"${line.newValue}"` : undefined }
    case 'session-title:changed':
      return {
        label: `Title → "${line.newValue ?? 'unknown'}"`,
        detail: line.confidence != null ? `${Math.round(line.confidence * 100)}%` : undefined,
      }
    case 'intent:changed':
      return {
        label: `Intent → "${line.newValue ?? 'unknown'}"`,
        detail: line.confidence != null ? `${Math.round(line.confidence * 100)}%` : undefined,
      }
    case 'snarky-message:start':
      return { label: 'Snarky Message…' }
    case 'snarky-message:finish':
      return { label: 'Snarky Message', detail: line.generatedMessage ? truncate(line.generatedMessage, 60) : undefined }
    case 'resume-message:start':
      return { label: 'Resume Message…' }
    case 'resume-message:finish':
      return { label: 'Resume Message', detail: line.generatedMessage ? truncate(line.generatedMessage, 60) : undefined }
    case 'persona:selected':
      return { label: `Persona chosen: ${line.personaTo ?? 'unknown'}` }
    case 'persona:changed':
      return { label: `Persona: ${line.personaFrom ?? '?'} → ${line.personaTo ?? '?'}` }
    case 'statusline:rendered':
      return { label: 'Statusline', detail: line.statuslineContent }
    case 'error:occurred':
      return { label: `Error: ${line.errorMessage ?? 'unknown'}` }
    case 'hook:received':
      return { label: `Hook: ${line.hookName ?? 'unknown'}` }
    case 'hook:completed':
      return { label: `Hook done: ${line.hookName ?? 'unknown'}`, detail: line.hookDurationMs != null ? `${line.hookDurationMs}ms` : undefined }
    default:
      return { label: line.content ?? line.type }
  }
}

export function TranscriptLineCard({ line, isSelected, isSynced, onClick, pairNavigation }: TranscriptLineProps) {
  const [showThinking, setShowThinking] = useState(false)
  const [showInjection, setShowInjection] = useState(false)

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

  // Command subtype: compact pill with terminal-green accent
  if (line.type === 'user-message' && line.userSubtype === 'command') {
    const cmdName = extractCommandName(line.content ?? '') ?? 'command'
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer">
        <div className={`rounded-lg px-2.5 py-1 bg-slate-50 dark:bg-slate-800/50 border border-emerald-300 dark:border-emerald-700 ${
          isSelected ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : isSynced ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''
        }`}>
          <div className="flex items-center gap-1.5">
            <Terminal size={11} className="text-emerald-500" />
            <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400">/{cmdName}</span>
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">{formatTime(line.timestamp)}</span>
          </div>
        </div>
      </div>
    )
  }

  // System injection / skill-content: collapsed by default, gray styling
  if (line.type === 'user-message' && (line.userSubtype === 'system-injection' || line.userSubtype === 'skill-content')) {
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
        <div className={`rounded-lg px-2.5 py-1 bg-gray-50 dark:bg-gray-900/50 border-l-2 border border-gray-200 dark:border-gray-700 border-l-gray-400 dark:border-l-gray-500 ${
          isSelected ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : isSynced ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''
        }`}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowInjection(!showInjection) }}
            className="flex items-center gap-1.5 w-full"
          >
            {showInjection ? <ChevronDown size={10} className="text-gray-400" /> : <ChevronRight size={10} className="text-gray-400" />}
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">System injection</span>
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">{formatTime(line.timestamp)}</span>
          </button>
          {showInjection && line.content && (
            <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mt-1 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
              {line.content}
            </p>
          )}
        </div>
        </div>
      </div>
    )
  }

  const isSidekick = isSidekickEventType(line.type)

  // Sidekick events: single-line compact, center-justified 60% width
  if (isSidekick) {
    const styles = getLineStyles(line)
    const { label, detail } = buildSidekickSingleLine(line)

    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
        <div
          className={`rounded-lg px-2.5 py-1 transition-all ${styles.bg} ${styles.border} ${
            isSelected
              ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
              : isSynced
                ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                : ''
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <styles.Icon size={11} className={`${styles.iconColor} flex-shrink-0`} />
            <span className={`text-[10px] font-medium ${styles.labelColor} truncate`}>{label}</span>
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">{formatTime(line.timestamp)}</span>
          </div>
          {detail && (
            <p className={`text-[10px] ${styles.labelColor} opacity-70 truncate mt-0.5 pl-4`}>{detail}</p>
          )}
        </div>
        </div>
      </div>
    )
  }

  const styles = getLineStyles(line)

  // Positioning: user prompts right-aligned, assistant left-aligned,
  // tools indented, system types center-justified 60% width
  const isUserPrompt = line.type === 'user-message' && line.userSubtype === 'prompt'
  const isAssistant = line.type === 'assistant-message'
  const isTool = line.type === 'tool-use' || line.type === 'tool-result'
  const isSystemType = line.type === 'turn-duration' || line.type === 'api-error' || line.type === 'pr-link'

  return (
    <div
      onClick={onClick}
      className={`px-2 py-0.5 transition-all cursor-pointer ${
        isUserPrompt ? 'flex justify-end' :
        isAssistant ? 'ml-2' :
        isTool ? 'ml-6' :
        isSystemType ? 'flex justify-center' : ''
      }`}
    >
      <div className={
        isUserPrompt ? 'w-[90%]' :
        isAssistant ? 'w-[90%]' :
        isTool ? 'w-[85%]' :
        isSystemType ? 'w-[60%]' :
        undefined
      }>
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
        {line.content && (
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-3 mt-0.5">
            {line.content}
          </p>
        )}

        {/* Thinking-only assistant message — show thinking as primary content */}
        {line.type === 'assistant-message' && !line.content && line.thinking && (
          <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-0.5">
            <CollapsibleContent
              content={line.thinking}
              previewLines={3}
              previewChars={300}
              className="text-slate-500 dark:text-slate-400 italic"
              label="thinking"
            />
          </div>
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
          <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-1">
            <CollapsibleContent
              content={line.thinking}
              previewLines={5}
              previewChars={500}
              className="text-slate-500 dark:text-slate-400 italic"
              label="thinking"
            />
          </div>
        )}

        {/* Tool use details */}
        {line.type === 'tool-use' && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            <span className="font-mono">{line.toolName}</span>
            {line.toolDurationMs != null && <span className="ml-2">{line.toolDurationMs}ms</span>}
            {line.toolInput && (() => {
              const preview = formatToolInput(line.toolName, line.toolInput)
              return preview ? (
                <CollapsibleContent
                  content={JSON.stringify(line.toolInput, null, 2)}
                  previewLines={2}
                  previewChars={200}
                  mono
                  className="text-slate-400 dark:text-slate-500 mt-0.5"
                  label="input"
                />
              ) : null
            })()}
          </div>
        )}

        {/* Tool result */}
        {line.type === 'tool-result' && line.toolOutput && (
          <CollapsibleContent
            content={line.toolOutput}
            previewLines={3}
            previewChars={300}
            mono
            className={line.toolSuccess === false ? 'text-red-600 dark:text-red-400 mt-0.5' : 'text-slate-500 dark:text-slate-400 mt-0.5'}
            label="output"
          />
        )}

        {/* Tool pair navigation link */}
        {pairNavigation && (line.type === 'tool-use' || line.type === 'tool-result') && (
          <button
            onClick={(e) => { e.stopPropagation(); pairNavigation.onNavigate() }}
            className="text-[9px] mt-0.5 hover:underline"
            style={{ color: pairNavigation.color }}
          >
            {pairNavigation.isToolUse ? '→ result' : '← call'}
          </button>
        )}

        {/* API error message */}
        {line.type === 'api-error' && line.errorMessage && (
          <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5 font-mono">{line.errorMessage}</p>
        )}

        {/* PR link URL */}
        {line.type === 'pr-link' && line.prUrl && isSafeUrl(line.prUrl) && (
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
      </div>
      </div>
    </div>
  )
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
    case 'reminder:cleared':
      return {
        bg: 'bg-rose-50/50 dark:bg-rose-950/20',
        border: 'border border-dashed border-rose-200 dark:border-rose-800/50',
        Icon: Bell,
        iconColor: 'text-rose-500',
        label: 'Reminder',
        labelColor: 'text-rose-600 dark:text-rose-400',
      }
    case 'decision:recorded':
      return {
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border border-dashed border-amber-200 dark:border-amber-800/50',
        Icon: Lightbulb,
        iconColor: 'text-amber-500',
        label: line.decisionCategory ? `Decision: ${line.decisionCategory}` : 'Decision',
        labelColor: 'text-amber-600 dark:text-amber-400',
      }
    case 'session-summary:start':
    case 'session-summary:finish':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-dashed border-purple-200 dark:border-purple-800/50',
        Icon: line.type === 'session-summary:start' ? Play : Square,
        iconColor: 'text-purple-500',
        label: line.type === 'session-summary:start' ? 'Summary Analysis' : 'Summary Analysis',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'session-title:changed':
    case 'intent:changed':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-dashed border-purple-200 dark:border-purple-800/50',
        Icon: FileText,
        iconColor: 'text-purple-500',
        label: line.type === 'session-title:changed' ? 'Title' : 'Intent',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'snarky-message:start':
    case 'snarky-message:finish':
    case 'resume-message:start':
    case 'resume-message:finish':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-dashed border-purple-200 dark:border-purple-800/50',
        Icon: line.type.includes('start') ? Play : Square,
        iconColor: 'text-purple-500',
        label: line.type.includes('snarky') ? 'Snarky' : 'Resume',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'persona:selected':
      return {
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border border-dashed border-amber-200 dark:border-amber-800/50',
        Icon: UserCog,
        iconColor: 'text-amber-500',
        label: 'Persona Chosen',
        labelColor: 'text-amber-600 dark:text-amber-400',
      }
    case 'persona:changed':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-dashed border-purple-200 dark:border-purple-800/50',
        Icon: UserCog,
        iconColor: 'text-purple-500',
        label: 'Persona Changed',
        labelColor: 'text-purple-600 dark:text-purple-400',
      }
    case 'statusline:rendered':
      return {
        bg: 'bg-teal-50/50 dark:bg-teal-950/20',
        border: 'border border-dashed border-teal-200 dark:border-teal-800/50',
        Icon: Gauge,
        iconColor: 'text-teal-500',
        label: 'Statusline',
        labelColor: 'text-teal-600 dark:text-teal-400',
      }
    case 'error:occurred':
      return {
        bg: 'bg-red-50 dark:bg-red-950/30',
        border: 'border-2 border-dashed border-red-300 dark:border-red-800',
        Icon: AlertTriangle,
        iconColor: 'text-red-500',
        label: 'Error',
        labelColor: 'text-red-600 dark:text-red-400',
      }
    case 'hook:received':
    case 'hook:completed':
      return {
        bg: 'bg-sky-50/50 dark:bg-sky-950/20',
        border: 'border border-dashed border-sky-200 dark:border-sky-800/50',
        Icon: Zap,
        iconColor: 'text-sky-500',
        label: 'Hook',
        labelColor: 'text-sky-600 dark:text-sky-400',
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
