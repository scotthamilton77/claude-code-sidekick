/**
 * Reminder State Domain Types
 *
 * Schemas for PR baseline, verification tools, reminder throttle, staged reminders,
 * and compaction history state.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 * @see docs/plans/2026-03-08-generic-reminder-throttle-design.md
 */

import { z } from 'zod'
import { HOOK_NAMES } from '../hook-events.js'
import type { CompactionEntry } from './transcript.js'
import { StagedReminderSchema } from './staging.js'

// ============================================================================
// PR Baseline State Schema
// ============================================================================

/**
 * Zod schema for PR baseline state.
 * Type definition: see PRBaselineState in ./staging.ts
 *
 * Location: `.sidekick/sessions/{sessionId}/state/pr-baseline.json`
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
export const PRBaselineStateSchema = z.object({
  /** Turn count when VC was consumed */
  turnCount: z.number(),
  /** Tool uses in that turn */
  toolsThisTurn: z.number(),
  /** Unix timestamp (ms) when baseline was set */
  timestamp: z.number(),
})

// ============================================================================
// VC Unverified State Schema
// ============================================================================

/**
 * Zod schema for VC unverified state.
 * Type definition: see VCUnverifiedState in ./staging.ts
 *
 * Location: `.sidekick/sessions/{sessionId}/state/vc-unverified.json`
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
export const VCUnverifiedStateSchema = z.object({
  /** Whether there are unverified changes */
  hasUnverifiedChanges: z.boolean(),
  /** Number of VC skips in this session */
  cycleCount: z.number(),
  /** Metrics when state was set */
  setAt: z.object({
    /** Unix timestamp (ms) */
    timestamp: z.number(),
    /** Turn count when set */
    turnCount: z.number(),
    /** Tool uses in that turn */
    toolsThisTurn: z.number(),
    /** Total tool count at that point */
    toolCount: z.number(),
  }),
  /** Last classification result */
  lastClassification: z.object({
    /** Classification category */
    category: z.string(),
    /** Classification confidence */
    confidence: z.number(),
  }),
})

// ============================================================================
// Verification Tools State Schema
// ============================================================================

/**
 * Zod schema for per-tool verification status.
 * Tracks whether each verification tool (build, test, etc.) needs re-running.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/verification-tools.json`
 *
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 */
export const VerificationToolStatusSchema = z.object({
  /** Current state: staged (needs run), verified (recently run), cooldown (post-verified, counting edits) */
  status: z.enum(['staged', 'verified', 'cooldown']),
  /** Number of qualifying file edits since last verification */
  editsSinceVerified: z.number(),
  /** Unix timestamp (ms) when last verified, null if never */
  lastVerifiedAt: z.number().nullable(),
  /** Unix timestamp (ms) when last staged, null if never */
  lastStagedAt: z.number().nullable(),
  /** tool_id of the pattern that last matched (metadata for future scope-aware logic) */
  lastMatchedToolId: z.string().nullable().optional(),
  /** Scope of the last matched pattern */
  lastMatchedScope: z.enum(['project', 'package', 'file']).nullable().optional(),
})

export type VerificationToolStatusState = z.infer<typeof VerificationToolStatusSchema>

/** Map of tool name → verification status */
export const VerificationToolsStateSchema = z.record(z.string(), VerificationToolStatusSchema)

export type VerificationToolsState = z.infer<typeof VerificationToolsStateSchema>

// ============================================================================
// Reminder Throttle State Schema
// ============================================================================

/**
 * Per-reminder throttle entry.
 * Stores counter, target hook, and cached resolved reminder for re-staging.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/reminder-throttle.json`
 *
 * @see docs/plans/2026-03-08-generic-reminder-throttle-design.md
 */
/**
 * Cached reminder shape — StagedReminder minus stagedAt.
 * Single source of truth for both throttle state and runtime construction.
 * Derived type: `CachedReminder = z.infer<typeof CachedReminderSchema>`
 */
export const CachedReminderSchema = StagedReminderSchema.omit({ stagedAt: true })

export type CachedReminder = z.infer<typeof CachedReminderSchema>

export const ReminderThrottleEntrySchema = z.object({
  /** Number of conversation messages since the reminder was last staged */
  messagesSinceLastStaging: z.number().int().nonnegative(),
  /** Hook to re-stage the reminder for */
  targetHook: z.enum(HOOK_NAMES),
  /** Cached resolved reminder content for re-staging */
  cachedReminder: CachedReminderSchema,
})

export type ReminderThrottleEntry = z.infer<typeof ReminderThrottleEntrySchema>

/** Map of reminder ID → throttle entry */
export const ReminderThrottleStateSchema = z.record(z.string(), ReminderThrottleEntrySchema)

export type ReminderThrottleState = z.infer<typeof ReminderThrottleStateSchema>

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
  /** Reason for blocking (blocking reminders) */
  reason?: string
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
