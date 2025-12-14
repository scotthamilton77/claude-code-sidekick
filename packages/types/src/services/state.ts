/**
 * State Domain Types
 *
 * Response types for session state files written to `.sidekick/sessions/{sessionId}/state/`.
 * These types define the stable API contract between backend state persistence and UI consumption.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md (session-summary.json, resume-message.json)
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.5 (transcript-metrics.json)
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4 Data Sources & Schema
 */

import { z } from 'zod'
import type { CompactionEntry } from './transcript.js'

// ============================================================================
// Session Summary State
// ============================================================================

/**
 * Session summary state persisted to disk.
 * Contains LLM-analyzed session title and current intent with confidence scores.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/session-summary.json`
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */
export const SessionSummaryStateSchema = z.object({
  /** Session identifier */
  session_id: z.string(),
  /** ISO8601 timestamp of last update */
  timestamp: z.string(),
  /** LLM-generated session title */
  session_title: z.string(),
  /** Confidence in session title (0-1) */
  session_title_confidence: z.number(),
  /** Key phrases from title analysis */
  session_title_key_phrases: z.array(z.string()).optional(),
  /** Current user intent */
  latest_intent: z.string(),
  /** Confidence in intent (0-1) */
  latest_intent_confidence: z.number(),
  /** Key phrases from intent analysis */
  latest_intent_key_phrases: z.array(z.string()).optional(),
  /** Whether a significant pivot was detected */
  pivot_detected: z.boolean().optional(),
  /** Previous title (for diff display) */
  previous_title: z.string().optional(),
  /** Previous intent (for diff display) */
  previous_intent: z.string().optional(),
  /** Analysis statistics */
  stats: z
    .object({
      /** Tokens used for analysis */
      total_tokens: z.number().optional(),
      /** Processing time in milliseconds */
      processing_time_ms: z.number().optional(),
    })
    .optional(),
})

export type SessionSummaryState = z.infer<typeof SessionSummaryStateSchema>

/**
 * Internal countdown state for throttling session summary updates.
 * Stored alongside session summary for persistence across Supervisor restarts.
 *
 * Location: Part of `.sidekick/sessions/{sessionId}/state/session-summary.json`
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.5 Countdown Mechanism
 */
export const SummaryCountdownStateSchema = z.object({
  /** Tool uses remaining until next analysis */
  countdown: z.number(),
  /** Transcript line where we last had high confidence */
  bookmark_line: z.number(),
})

export type SummaryCountdownState = z.infer<typeof SummaryCountdownStateSchema>

// ============================================================================
// Resume Message State
// ============================================================================

/**
 * Resume message state persisted to disk.
 * Generated as a side-effect of session summary updates when pivot is detected.
 * Used by statusline to show returning user a friendly prompt.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/resume-message.json`
 *
 * @see docs/design/FEATURE-RESUME.md §5.2
 */
export const ResumeMessageStateSchema = z.object({
  /** Most recent task ID from the summary, if available */
  last_task_id: z.string().nullable(),
  /** Question format: "Shall we resume..." or "Want to continue..." */
  resume_last_goal_message: z.string(),
  /** Snarky welcome message for returning user */
  snarky_comment: z.string(),
  /** ISO8601 timestamp when this was generated */
  timestamp: z.string(),
})

export type ResumeMessageState = z.infer<typeof ResumeMessageStateSchema>

// ============================================================================
// Session Metrics State
// ============================================================================

/**
 * General session metadata for UI display.
 * Extracted from transcript metrics and session summary.
 *
 * Note: This is a UI projection - the source of truth is TranscriptMetrics
 * in transcript-metrics.json, but this provides a simplified view for display.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1 (source: TranscriptMetrics)
 */
export const SessionMetricsStateSchema = z.object({
  /** Session identifier */
  sessionId: z.string(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
  /** Session duration in seconds */
  durationSeconds: z.number(),
  /** Estimated cost in USD */
  costUsd: z.number(),
  /** Primary model used in session */
  primaryModel: z.string().optional(),
  /** Token usage summary (from transcript metrics) */
  tokens: z.object({
    /** Total input tokens */
    input: z.number(),
    /** Total output tokens */
    output: z.number(),
    /** Total tokens (input + output) */
    total: z.number(),
    /** Cache creation tokens */
    cacheCreation: z.number(),
    /** Cache read tokens (cache hits) */
    cacheRead: z.number(),
  }),
})

export type SessionMetricsState = z.infer<typeof SessionMetricsStateSchema>

// ============================================================================
// Staged Reminders State
// ============================================================================

/**
 * Staged reminder metadata for UI display.
 * Extends base StagedReminder with hook context and suppression status.
 *
 * @see docs/design/flow.md §4 Reminder System
 */
export interface StagedReminderWithContext {
  /** Reminder name */
  name: string
  /** Target hook */
  hookName: string
  /** Whether this reminder blocks the action */
  blocking: boolean
  /** Priority (higher = consumed first) */
  priority: number
  /** Whether reminder persists across turns */
  persistent: boolean
  /** User-facing message */
  userMessage?: string
  /** Additional context for the agent */
  additionalContext?: string
  /** Stop reason (for stop reminders) */
  stopReason?: string
  /** Whether the reminder is currently suppressed */
  suppressed: boolean
  /** Timestamp when staged (Unix ms) */
  stagedAt: number
}

/**
 * Aggregated view of all staged reminders for a session.
 * Used by UI to display pending reminder state across all hooks.
 */
export interface StagedRemindersSnapshot {
  /** Session identifier */
  sessionId: string
  /** All staged reminders across all hooks */
  reminders: StagedReminderWithContext[]
  /** Total count of staged reminders */
  totalCount: number
  /** Count by hook */
  countByHook: Record<string, number>
  /** Hooks that have suppression markers */
  suppressedHooks: string[]
}

// ============================================================================
// Compaction History State
// ============================================================================

/**
 * Complete compaction history for timeline visualization.
 * Read from compaction-history.json for UI time-travel debugging.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/compaction-history.json`
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.1 Compaction Timeline
 */
export interface CompactionHistoryState {
  /** Session identifier */
  sessionId: string
  /** All compaction points in chronological order */
  entries: CompactionEntry[]
  /** Total number of compactions in this session */
  totalCompactions: number
}

// ============================================================================
// Unified Session State Response
// ============================================================================

/**
 * Complete session state snapshot for UI State Inspector.
 * Aggregates all state domains into a single response.
 *
 * This is the primary response type for the monitoring UI's state panel.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.C State Inspector
 */
export interface SessionStateSnapshot {
  /** Session identifier */
  sessionId: string
  /** Unix timestamp (ms) of this snapshot */
  timestamp: number
  /** Session summary state (if available) */
  summary?: SessionSummaryState
  /** Resume message state (if available) */
  resume?: ResumeMessageState
  /** Session metrics (if available) */
  metrics?: SessionMetricsState
  /** Staged reminders (if any) */
  stagedReminders?: StagedRemindersSnapshot
  /** Compaction history (if any) */
  compactionHistory?: CompactionHistoryState
}
