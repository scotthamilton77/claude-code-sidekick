/** Style lookup and label generation for transcript line rendering. */
import {
  User,
  Bot,
  Terminal,
  AlertTriangle,
  Lightbulb,
  Bell,
  Gauge,
  UserCog,
  FileText,
  Play,
  Square,
  Clock,
  GitPullRequest,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { TranscriptLine as TLine, TranscriptLineType } from '../../types'
import { CLAUDE_CODE_TYPES } from '../../utils/classifyTranscriptLine'
import { truncate, extractCommandName, formatDuration } from './TranscriptLineUtils'

export interface LineStyles {
  bg: string
  border: string
  Icon: LucideIcon
  iconColor: string
  label: string
  labelColor: string
}

export function isSidekickEventType(type: TranscriptLineType): boolean {
  return !CLAUDE_CODE_TYPES.has(type)
}

/** Build single-line label + optional detail for sidekick events */
export function buildSidekickSingleLine(line: TLine): { label: string; detail?: string } {
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
      return { label: `Decision: ${line.decisionTitle ?? line.decisionCategory ?? 'unknown'}`, detail: line.decisionReasoning }
    case 'session-summary:start':
      return { label: 'Session Analysis Start' }
    case 'session-summary:finish':
      return { label: 'Session Analysis Finish', detail: line.newValue ? `"${line.newValue}"` : undefined }
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
      return { label: 'Snarky Message Start' }
    case 'snarky-message:finish':
      return { label: 'Snarky Message Finish', detail: line.generatedMessage ? truncate(line.generatedMessage, 60) : undefined }
    case 'resume-message:start':
      return { label: 'Resume Message Start' }
    case 'resume-message:finish':
      return { label: 'Resume Message Finish', detail: line.generatedMessage ? truncate(line.generatedMessage, 60) : undefined }
    case 'persona:selected':
      return { label: `Persona chosen: ${line.personaTo ?? 'unknown'}` }
    case 'persona:changed':
      return { label: `Persona: ${line.personaFrom ?? '?'} → ${line.personaTo ?? '?'}` }
    case 'statusline:rendered': {
      const content = line.statuslineContent
      const detail = content ? truncate(content, 80) : undefined
      return { label: 'Statusline called', detail }
    }
    case 'error:occurred':
      return { label: `Error: ${line.errorMessage ?? 'unknown'}` }
    case 'hook:received':
      return { label: `Hook start: ${line.hookName ?? 'unknown'}` }
    case 'hook:completed':
      return { label: `Hook finish: ${line.hookName ?? 'unknown'}`, detail: line.hookDurationMs != null ? `${line.hookDurationMs}ms` : undefined }
    default:
      return { label: line.content ?? line.type }
  }
}

export function getLineStyles(line: TLine): LineStyles {
  switch (line.type) {
    case 'user-message': {
      if (line.userSubtype === 'command') {
        const cmdName = extractCommandName(line.content ?? '') ?? 'command'
        return {
          bg: 'bg-white dark:bg-slate-800',
          border: 'border border-blue-200 dark:border-blue-800',
          Icon: Terminal,
          iconColor: 'text-blue-500',
          label: `/${cmdName}`,
          labelColor: 'text-blue-600 dark:text-blue-400',
        }
      }
      return {
        bg: 'bg-white dark:bg-slate-800',
        border: 'border border-blue-200 dark:border-blue-800',
        Icon: User,
        iconColor: 'text-blue-500',
        label: 'User',
        labelColor: 'text-blue-600 dark:text-blue-400',
      }
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
        label: `Decision: ${line.decisionTitle ?? line.decisionCategory ?? 'unknown'}`,
        labelColor: 'text-amber-600 dark:text-amber-400',
      }
    case 'session-summary:start':
    case 'session-summary:finish':
      return {
        bg: 'bg-purple-50/50 dark:bg-purple-950/20',
        border: 'border border-dashed border-purple-200 dark:border-purple-800/50',
        Icon: line.type === 'session-summary:start' ? Play : Square,
        iconColor: 'text-purple-500',
        label: 'Session Analysis',
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
