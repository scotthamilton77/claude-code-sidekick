/**
 * Event Adapter
 *
 * Converts SidekickEvent and ParsedLogRecord to UIEvent for display.
 * Handles mapping between canonical event schema and UI presentation types.
 *
 * @see src/types/index.ts for type definitions
 * @see docs/design/flow.md §3.2 Event Schema
 */

import type { SidekickEvent, HookEvent, TranscriptEvent } from '@sidekick/types'
import type { UIEvent, UIEventType, ReminderData, SummaryData, DecisionData } from '../types'
import { isHookEvent, isTranscriptEvent } from '../types'
import type { ParsedLogRecord, LogSource } from './log-parser'

// ============================================================================
// Event Kind Detection
// ============================================================================

/**
 * Event kind for badge display.
 * Derived from SidekickEvent.kind plus internal events.
 */
export type EventKind = 'hook' | 'transcript' | 'internal'

/**
 * Determine the event kind from a ParsedLogRecord.
 * Returns 'internal' for non-hook/non-transcript events (e.g., SummaryUpdated).
 */
export function getEventKind(record: ParsedLogRecord): EventKind {
  if (record.event) {
    return record.event.kind === 'hook' ? 'hook' : 'transcript'
  }

  // Internal events are logged without full SidekickEvent structure
  const internalTypes = new Set([
    'SummaryUpdated',
    'ReminderStaged',
    'ReminderConsumed',
    'RemindersCleared',
    'ContextPruned',
    'HandlerExecuted',
  ])

  if (record.type && internalTypes.has(record.type)) {
    return 'internal'
  }

  // Default based on source
  return record.source === 'supervisor' ? 'internal' : 'hook'
}

// ============================================================================
// UIEventType Mapping
// ============================================================================

/**
 * Map a HookEvent to UIEventType.
 */
function hookEventToUIType(event: HookEvent): UIEventType {
  switch (event.hook) {
    case 'SessionStart':
    case 'SessionEnd':
      return 'session'
    case 'UserPromptSubmit':
      return 'user'
    case 'PreToolUse':
    case 'PostToolUse':
      return 'tool'
    case 'Stop':
      return 'reminder' // Stop hook is often reminder-related
    case 'PreCompact':
      return 'decision'
    default:
      return 'state'
  }
}

/**
 * Map a TranscriptEvent to UIEventType.
 */
function transcriptEventToUIType(event: TranscriptEvent): UIEventType {
  switch (event.eventType) {
    case 'UserPrompt':
      return 'user'
    case 'AssistantMessage':
      return 'assistant'
    case 'ToolCall':
    case 'ToolResult':
      return 'tool'
    case 'Compact':
      return 'decision'
    default:
      return 'state'
  }
}

/**
 * Map a ParsedLogRecord type to UIEventType.
 * Used for internal events that don't have SidekickEvent.
 */
function logRecordTypeToUIType(recordType: string | undefined): UIEventType {
  switch (recordType) {
    case 'SummaryUpdated':
      return 'state'
    case 'ReminderStaged':
    case 'ReminderConsumed':
    case 'RemindersCleared':
      return 'reminder'
    case 'ContextPruned':
      return 'decision'
    case 'HandlerExecuted':
      return 'state'
    case 'HookReceived':
    case 'HookCompleted':
      return 'session'
    default:
      return 'state'
  }
}

// ============================================================================
// Label Generation
// ============================================================================

/**
 * Generate a display label for a HookEvent.
 */
function hookEventToLabel(event: HookEvent): string {
  switch (event.hook) {
    case 'SessionStart':
      return 'Session Start'
    case 'SessionEnd':
      return 'Session End'
    case 'UserPromptSubmit':
      return 'User message'
    case 'PreToolUse':
      return `Tool: ${(event.payload as { toolName?: string }).toolName ?? 'unknown'}`
    case 'PostToolUse':
      return `Tool completed: ${(event.payload as { toolName?: string }).toolName ?? 'unknown'}`
    case 'Stop':
      return 'Stop hook'
    case 'PreCompact':
      return 'Pre-compact'
  }
  // Exhaustive check - this line is unreachable but handles future hook types
  const _exhaustive: never = event
  return (_exhaustive as HookEvent).hook
}

/**
 * Generate a display label for a TranscriptEvent.
 */
function transcriptEventToLabel(event: TranscriptEvent): string {
  switch (event.eventType) {
    case 'UserPrompt':
      return 'User message'
    case 'AssistantMessage':
      return 'Claude response'
    case 'ToolCall':
      return event.payload.toolName ? `Tool: ${event.payload.toolName}` : 'Tool call'
    case 'ToolResult':
      return event.payload.toolName ? `Result: ${event.payload.toolName}` : 'Tool result'
    case 'Compact':
      return 'Compact'
    default:
      return event.eventType
  }
}

/**
 * Generate a display label for a ParsedLogRecord.
 */
function logRecordToLabel(record: ParsedLogRecord): string {
  if (record.event) {
    if (isHookEvent(record.event)) {
      return hookEventToLabel(record.event)
    }
    if (isTranscriptEvent(record.event)) {
      return transcriptEventToLabel(record.event)
    }
  }

  // Internal event labels
  switch (record.type) {
    case 'SummaryUpdated':
      return 'Summary Updated'
    case 'ReminderStaged':
      return 'Reminder Staged'
    case 'ReminderConsumed':
      return 'Reminder Consumed'
    case 'RemindersCleared':
      return 'Reminders Cleared'
    case 'ContextPruned':
      return 'Prune Context'
    case 'HandlerExecuted':
      return 'Handler Executed'
    case 'HookReceived':
      return `Hook: ${(record.context?.hook as string) ?? 'unknown'}`
    case 'HookCompleted':
      return 'Hook Completed'
    default:
      return record.pino.msg ?? record.type ?? 'Event'
  }
}

// ============================================================================
// Structured Payload Extraction
// ============================================================================

/**
 * Extract structured reminder data from ReminderStaged/ReminderConsumed/RemindersCleared events.
 * Returns undefined for non-reminder events.
 */
function extractReminderData(record: ParsedLogRecord): ReminderData | undefined {
  if (!record.type) return undefined

  switch (record.type) {
    case 'ReminderStaged': {
      const state = record.payload?.state as {
        reminderName?: string
        hookName?: string
        blocking?: boolean
        priority?: number
        persistent?: boolean
      }
      return {
        action: 'staged',
        reminderName: state?.reminderName,
        hookName: state?.hookName,
        blocking: state?.blocking,
        priority: state?.priority,
        persistent: state?.persistent,
      }
    }

    case 'ReminderConsumed': {
      const state = record.payload?.state as {
        reminderName?: string
        reminderReturned?: boolean
        blocking?: boolean
        priority?: number
        persistent?: boolean
      }
      return {
        action: 'consumed',
        reminderName: state?.reminderName,
        reminderReturned: state?.reminderReturned,
        blocking: state?.blocking,
        priority: state?.priority,
        persistent: state?.persistent,
      }
    }

    case 'RemindersCleared': {
      const state = record.payload?.state as {
        clearedCount?: number
        hookNames?: string[]
      }
      return {
        action: 'cleared',
        clearedCount: state?.clearedCount,
      }
    }

    default:
      return undefined
  }
}

/**
 * Extract structured summary data from SummaryUpdated/SummarySkipped events.
 * Returns undefined for non-summary events.
 */
function extractSummaryData(record: ParsedLogRecord): SummaryData | undefined {
  if (!record.type) return undefined

  switch (record.type) {
    case 'SummaryUpdated': {
      const state = record.payload?.state as {
        session_title?: string
        session_title_confidence?: number
        latest_intent?: string
        latest_intent_confidence?: number
      }
      const metadata = record.payload?.metadata as {
        countdown_reset_to?: number
        pivot_detected?: boolean
        old_title?: string
        old_intent?: string
      }
      const reason = record.payload?.reason as
        | 'user_prompt_forced'
        | 'countdown_reached'
        | 'compaction_reset'
        | undefined

      return {
        action: 'updated',
        reason: reason ?? 'countdown_reached',
        sessionTitle: state?.session_title,
        titleConfidence: state?.session_title_confidence,
        latestIntent: state?.latest_intent,
        intentConfidence: state?.latest_intent_confidence,
        oldTitle: metadata?.old_title,
        oldIntent: metadata?.old_intent,
        pivotDetected: metadata?.pivot_detected,
        countdownResetTo: metadata?.countdown_reset_to,
      }
    }

    case 'SummarySkipped': {
      return {
        action: 'skipped',
        reason: 'countdown_active',
      }
    }

    default:
      return undefined
  }
}

/**
 * Extract structured decision data from decision-related events.
 * Categorizes HandlerExecuted, ContextPruned, and summary/reminder events.
 * Returns undefined for non-decision events.
 */
function extractDecisionData(record: ParsedLogRecord): DecisionData | undefined {
  if (!record.type) return undefined

  switch (record.type) {
    case 'HandlerExecuted': {
      const state = record.payload?.state as {
        handlerId?: string
        success?: boolean
      }
      const metadata = record.payload?.metadata as {
        durationMs?: number
        error?: string
      }
      return {
        category: 'handler',
        handlerId: state?.handlerId,
        success: state?.success,
        durationMs: metadata?.durationMs,
        error: metadata?.error,
      }
    }

    case 'ContextPruned':
      return {
        category: 'context_prune',
      }

    case 'SummaryUpdated':
    case 'SummarySkipped':
      return {
        category: 'summary',
      }

    case 'ReminderStaged':
    case 'ReminderConsumed':
    case 'RemindersCleared':
      return {
        category: 'reminder',
      }

    default:
      return undefined
  }
}

// ============================================================================
// Content Extraction
// ============================================================================

/**
 * Extract display content from a HookEvent.
 */
function hookEventToContent(event: HookEvent): string | undefined {
  switch (event.hook) {
    case 'SessionStart': {
      const payload = event.payload as { startType?: string }
      return `Session started (${payload.startType ?? 'unknown'})`
    }
    case 'SessionEnd': {
      const payload = event.payload as { endReason?: string }
      return `Session ended (${payload.endReason ?? 'unknown'})`
    }
    case 'UserPromptSubmit': {
      const payload = event.payload as { prompt?: string }
      return payload.prompt
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const payload = event.payload as { toolInput?: Record<string, unknown> }
      if (payload.toolInput) {
        // Summarize tool input
        const keys = Object.keys(payload.toolInput)
        return keys.length > 0 ? `Input: ${keys.join(', ')}` : undefined
      }
      return undefined
    }
    default:
      return undefined
  }
}

/**
 * Extract display content from a TranscriptEvent.
 */
function transcriptEventToContent(event: TranscriptEvent): string | undefined {
  return event.payload.content
}

/**
 * Extract display content from a ParsedLogRecord.
 */
function logRecordToContent(record: ParsedLogRecord): string | undefined {
  if (record.event) {
    if (isHookEvent(record.event)) {
      return hookEventToContent(record.event)
    }
    if (isTranscriptEvent(record.event)) {
      return transcriptEventToContent(record.event)
    }
  }

  // For internal events, use msg or summarize payload
  if (record.pino?.msg) {
    return record.pino.msg
  }

  if (record.payload) {
    // Summarize payload
    const keys = Object.keys(record.payload)
    if (keys.length > 0) {
      return `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`
    }
  }

  return undefined
}

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format a Unix timestamp to HH:MM:SS.
 * Returns placeholder if timestamp is invalid.
 */
export function formatTime(timestamp: number | undefined | null): string {
  // Guard against missing or invalid timestamps
  if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp)) {
    return '--:--:--'
  }

  const date = new Date(timestamp)

  // Guard against invalid dates
  if (isNaN(date.getTime())) {
    return '--:--:--'
  }

  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ============================================================================
// Main Adapter Functions
// ============================================================================

/**
 * Convert a SidekickEvent to UIEvent.
 *
 * @param event - Canonical SidekickEvent
 * @param id - Sequential ID for timeline positioning
 * @param source - Optional source component override
 * @returns UIEvent for display
 */
export function sidekickEventToUIEvent(event: SidekickEvent, id: number, source?: LogSource): UIEvent {
  const isHook = isHookEvent(event)

  // Guard against missing timestamp - use current time as fallback
  const timestamp = event.context?.timestamp ?? Date.now()

  const uiEvent: UIEvent = {
    id,
    time: formatTime(timestamp),
    type: isHook ? hookEventToUIType(event) : transcriptEventToUIType(event),
    label: isHook ? hookEventToLabel(event) : transcriptEventToLabel(event),
    content: isHook ? hookEventToContent(event) : transcriptEventToContent(event),
    source: source ?? (isHook ? 'cli' : 'supervisor'),
    rawEvent: event,
  }

  return uiEvent
}

/**
 * Convert a ParsedLogRecord to UIEvent.
 * Handles both records with embedded SidekickEvent and internal events.
 *
 * @param record - Parsed log record
 * @param id - Sequential ID for timeline positioning
 * @returns UIEvent for display
 */
export function logRecordToUIEvent(record: ParsedLogRecord, id: number): UIEvent {
  // If record has a SidekickEvent, use that for conversion
  if (record.event) {
    return sidekickEventToUIEvent(record.event, id, record.source)
  }

  // Extract traceId from context
  const traceId = record.context?.traceId

  // Extract structured payload data
  const reminderData = extractReminderData(record)
  const summaryData = extractSummaryData(record)
  const decisionData = extractDecisionData(record)

  // Guard against missing pino.time - use current time as fallback
  const timestamp = record.pino?.time ?? Date.now()

  // Otherwise, convert the log record directly
  const uiEvent: UIEvent = {
    id,
    time: formatTime(timestamp),
    type: logRecordTypeToUIType(record.type),
    label: logRecordToLabel(record),
    content: logRecordToContent(record),
    source: record.source,
    traceId,
    reminderData,
    summaryData,
    decisionData,
  }

  return uiEvent
}

/**
 * Convert an array of ParsedLogRecords to UIEvents.
 * Assigns sequential IDs starting from 0.
 *
 * @param records - Array of parsed log records
 * @returns Array of UIEvents
 */
export function logRecordsToUIEvents(records: ParsedLogRecord[]): UIEvent[] {
  return records.map((record, index) => logRecordToUIEvent(record, index))
}

/**
 * Convert an array of SidekickEvents to UIEvents.
 * Assigns sequential IDs starting from 0.
 *
 * @param events - Array of SidekickEvents
 * @param source - Optional source component override
 * @returns Array of UIEvents
 */
export function sidekickEventsToUIEvents(events: SidekickEvent[], source?: LogSource): UIEvent[] {
  return events.map((event, index) => sidekickEventToUIEvent(event, index, source))
}
