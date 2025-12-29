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
// First-Prompt Summary State
// ============================================================================

/**
 * Classification of the user's first prompt for appropriate response tone.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §4.2
 */
export const FirstPromptClassificationSchema = z.enum([
  'command', // Slash command or configuration action
  'conversational', // Greeting, small talk, or social interaction
  'interrogative', // Question about codebase, capabilities, or exploration
  'ambiguous', // Context-setting but unclear specific goal
  'actionable', // Clear task with specific intent
])

export type FirstPromptClassification = z.infer<typeof FirstPromptClassificationSchema>

/**
 * First-prompt summary state persisted to disk.
 * Generated on UserPromptSubmit when no session summary exists.
 * Provides snarky, contextual feedback during the first turn.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/first-prompt-summary.json`
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §6
 */
export const FirstPromptSummaryStateSchema = z.object({
  /** Session identifier */
  session_id: z.string(),
  /** ISO8601 timestamp of generation */
  timestamp: z.string(),
  /** The generated snarky message (max 60 chars) */
  message: z.string(),
  /** Classification determined by LLM */
  classification: FirstPromptClassificationSchema.optional(),
  /** Source of the message */
  source: z.enum(['llm', 'static', 'fallback']),
  /** Model used (if LLM-generated) */
  model: z.string().optional(),
  /** Generation latency in ms */
  latency_ms: z.number().optional(),
  /** Original user prompt (for debugging) */
  user_prompt: z.string(),
  /** Whether resume context was available */
  had_resume_context: z.boolean(),
})

export type FirstPromptSummaryState = z.infer<typeof FirstPromptSummaryStateSchema>

// ============================================================================
// First-Prompt Summary Configuration
// ============================================================================

/**
 * LLM provider model configuration.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §5.2
 */
export const FirstPromptModelConfigSchema = z.object({
  /** LLM provider */
  provider: z.enum(['claude-cli', 'openrouter', 'openai']),
  /** Model identifier */
  model: z.string(),
})

export type FirstPromptModelConfig = z.infer<typeof FirstPromptModelConfigSchema>

/**
 * First-prompt summary feature configuration.
 * Configures LLM generation, fallback behavior, and slash command handling.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §5.2
 */
export const FirstPromptConfigSchema = z.object({
  /** Enable/disable the feature */
  enabled: z.boolean().default(true),

  /** Model configuration with fallback chain */
  model: z
    .object({
      primary: FirstPromptModelConfigSchema.default({
        provider: 'openrouter',
        model: 'x-ai/grok-4-fast',
      }),
      fallback: FirstPromptModelConfigSchema.nullable().default({
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-lite',
      }),
    })
    .default({
      primary: { provider: 'openrouter', model: 'x-ai/grok-4-fast' },
      fallback: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' },
    }),

  /** Message shown when LLM call fails */
  staticFallbackMessage: z.string().default('Deciphering intent...'),

  /** Commands that skip LLM generation entirely */
  skipCommands: z
    .array(z.string())
    .default([
      'add-dir',
      'agents',
      'bashes',
      'bug',
      'clear',
      'compact',
      'config',
      'context',
      'cost',
      'doctor',
      'exit',
      'export',
      'help',
      'hooks',
      'ide',
      'install-github-app',
      'login',
      'logout',
      'mcp',
      'memory',
      'output-style',
      'permissions',
      'plugin',
      'pr-comments',
      'privacy-settings',
      'release-notes',
      'resume',
      'rewind',
      'sandbox',
      'security-review',
      'stats',
      'status',
      'statusline',
      'terminal-setup',
      'todos',
      'usage',
      'vim',
    ]),

  /** Message shown for skipped commands (null = no file written) */
  staticSkipMessage: z.string().nullable().default(null),

  /** Confidence threshold for preferring first-prompt over low-confidence summary */
  confidenceThreshold: z.number().default(0.6),

  /** LLM call timeout in milliseconds */
  llmTimeoutMs: z.number().default(10000),
})

export type FirstPromptConfig = z.infer<typeof FirstPromptConfigSchema>

/**
 * Default configuration for first-prompt summary generation.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §5.3
 */
export const DEFAULT_FIRST_PROMPT_CONFIG: FirstPromptConfig = FirstPromptConfigSchema.parse({})

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
  /** First-prompt summary state (if available) */
  firstPromptSummary?: FirstPromptSummaryState
  /** Resume message state (if available) */
  resume?: ResumeMessageState
  /** Session metrics (if available) */
  metrics?: SessionMetricsState
  /** Staged reminders (if any) */
  stagedReminders?: StagedRemindersSnapshot
  /** Compaction history (if any) */
  compactionHistory?: CompactionHistoryState
}
