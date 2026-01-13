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
 * Default placeholder values for session summary state.
 * Used by create-first-summary handler and statusline service for consistent defaults.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */
export const SESSION_SUMMARY_PLACEHOLDERS = {
  /** Default title for new sessions before first analysis */
  newSession: 'New Session',
  /** Default intent message while awaiting first user prompt */
  awaitingFirstPrompt: 'Awaiting first prompt...',
} as const

/**
 * Internal countdown state for throttling session summary updates.
 * Stored alongside session summary for persistence across Daemon restarts.
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
  /** Source summary's session title */
  session_title: z.string().nullable(),
  /** Question format: "Shall we resume..." or "Want to continue..." */
  resume_last_goal_message: z.string(),
  /** Snarky welcome message for returning user */
  snarky_comment: z.string(),
  /** ISO8601 timestamp when this was generated */
  timestamp: z.string(),
})

export type ResumeMessageState = z.infer<typeof ResumeMessageStateSchema>

// ============================================================================
// Transcript Metrics State
// ============================================================================

/**
 * Projection of TranscriptMetrics for state file reading.
 * Contains only fields that are persisted to transcript-metrics.json.
 *
 * Note: Cost, duration, and model come from Claude Code's statusline hook input,
 * not from transcript-metrics.json. Those are merged at display time in
 * StatuslineService.buildViewModel().
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1 (source: TranscriptMetrics)
 */
export const TranscriptMetricsStateSchema = z.object({
  /** Session identifier */
  sessionId: z.string(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
  /** Token usage summary (from transcript metrics - cumulative) */
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
  /** Current context window tokens from API usage (resets on compact) */
  currentContextTokens: z.number().nullable().optional(),
  /** True after compact_boundary detected until first usage block arrives */
  isPostCompactIndeterminate: z.boolean().optional(),
})

export type TranscriptMetricsState = z.infer<typeof TranscriptMetricsStateSchema>

/** @deprecated Use TranscriptMetricsState instead */
export const SessionMetricsStateSchema = TranscriptMetricsStateSchema
/** @deprecated Use TranscriptMetricsState instead */
export type SessionMetricsState = TranscriptMetricsState

// ============================================================================
// Log Metrics State
// ============================================================================

/**
 * Log metrics state for tracking warnings and errors.
 * Daemon maintains in-memory counters and persists during heartbeat.
 * Statusline reads this for the {logs} template placeholder.
 *
 * Used for both per-session metrics (with sessionId) and global metrics (without sessionId).
 * - Per-session: `.sidekick/sessions/{sessionId}/state/daemon-log-metrics.json`
 * - Global: `.sidekick/state/daemon-global-log-metrics.json`
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */
export const LogMetricsStateSchema = z.object({
  /** Session identifier (optional for global metrics) */
  sessionId: z.string().optional(),
  /** Warning log count */
  warningCount: z.number(),
  /** Error log count */
  errorCount: z.number(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
})

export type LogMetricsState = z.infer<typeof LogMetricsStateSchema>

/**
 * Default log metrics for new sessions or when file is missing.
 */
export const EMPTY_LOG_METRICS: LogMetricsState = {
  sessionId: '',
  warningCount: 0,
  errorCount: 0,
  lastUpdatedAt: 0,
}

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
// Context Metrics State
// ============================================================================

/**
 * Base token metrics that are consistent across projects.
 * Captured via `claude -p "/context"` and stored globally.
 *
 * Location: `~/.sidekick/state/baseline-user-context-token-metrics.json`
 *
 * @see METRICS_PLAN.md
 */
export const BaseTokenMetricsStateSchema = z.object({
  /** System prompt tokens (~3.2k) */
  systemPromptTokens: z.number(),
  /** System tools tokens (~17.9k) */
  systemToolsTokens: z.number(),
  /** Autocompact buffer tokens (~45k reserved) */
  autocompactBufferTokens: z.number(),
  /** Unix timestamp (ms) when captured */
  capturedAt: z.number(),
  /** Source of the metrics */
  capturedFrom: z.enum(['defaults', 'context_command']),
  /** Session ID used for capture (if from context_command) */
  sessionId: z.string().optional(),
})

export type BaseTokenMetricsState = z.infer<typeof BaseTokenMetricsStateSchema>

/**
 * Project-specific context metrics that vary per-project.
 * Updated when /context command output is observed in transcripts.
 *
 * Location: `.sidekick/state/baseline-project-context-token-metrics.json`
 *
 * @see METRICS_PLAN.md
 */
export const ProjectContextMetricsSchema = z.object({
  /** MCP tools tokens (variable per project) */
  mcpToolsTokens: z.number(),
  /** Custom agents tokens (variable per project) */
  customAgentsTokens: z.number(),
  /** Memory files tokens (minimum seen - baseline for project) */
  memoryFilesTokens: z.number(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
})

export type ProjectContextMetrics = z.infer<typeof ProjectContextMetricsSchema>

/**
 * Full context metrics for a specific session.
 * Represents the current state of context usage in that session.
 *
 * Location: `.sidekick/sessions/{id}/state/context-metrics.json`
 *
 * @see METRICS_PLAN.md
 */
export const SessionContextMetricsSchema = z.object({
  /** Session identifier */
  sessionId: z.string(),
  /** System prompt tokens */
  systemPromptTokens: z.number(),
  /** System tools tokens */
  systemToolsTokens: z.number(),
  /** MCP tools tokens */
  mcpToolsTokens: z.number(),
  /** Custom agents tokens */
  customAgentsTokens: z.number(),
  /** Memory files tokens (current session value, may be higher than project baseline) */
  memoryFilesTokens: z.number(),
  /** Autocompact buffer tokens */
  autocompactBufferTokens: z.number(),
  /** Total overhead (sum of all above) */
  totalOverheadTokens: z.number(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
})

export type SessionContextMetrics = z.infer<typeof SessionContextMetricsSchema>

/**
 * Default base token metrics values.
 * Used when real capture hasn't been performed yet.
 */
export const DEFAULT_BASE_METRICS: BaseTokenMetricsState = {
  systemPromptTokens: 3200,
  systemToolsTokens: 17900,
  autocompactBufferTokens: 45000,
  capturedAt: 0,
  capturedFrom: 'defaults',
}

/**
 * Default project context metrics values.
 * Used when project hasn't been analyzed yet.
 */
export const DEFAULT_PROJECT_METRICS: ProjectContextMetrics = {
  mcpToolsTokens: 0,
  customAgentsTokens: 0,
  memoryFilesTokens: 0,
  lastUpdatedAt: 0,
}

// ============================================================================
// LLM Metrics State
// ============================================================================

/**
 * Latency statistics for LLM calls.
 */
export const LLMLatencyStatsSchema = z.object({
  /** Minimum latency in ms */
  min: z.number(),
  /** Maximum latency in ms */
  max: z.number(),
  /** Sum of all latencies (for computing average) */
  sum: z.number(),
  /** Count of successful calls (for computing average) */
  count: z.number(),
  /** 50th percentile latency in ms */
  p50: z.number(),
  /** 90th percentile latency in ms */
  p90: z.number(),
  /** 95th percentile latency in ms */
  p95: z.number(),
})

export type LLMLatencyStats = z.infer<typeof LLMLatencyStatsSchema>

/**
 * Per-model metrics within a provider.
 */
export const LLMModelMetricsSchema = z.object({
  /** Total call count */
  callCount: z.number(),
  /** Successful call count */
  successCount: z.number(),
  /** Failed call count */
  failedCount: z.number(),
  /** Total input tokens */
  inputTokens: z.number(),
  /** Total output tokens */
  outputTokens: z.number(),
  /** Latency statistics */
  latency: LLMLatencyStatsSchema,
})

export type LLMModelMetrics = z.infer<typeof LLMModelMetricsSchema>

/**
 * Per-provider metrics with model breakdown.
 */
export const LLMProviderMetricsSchema = z.object({
  /** Total call count */
  callCount: z.number(),
  /** Successful call count */
  successCount: z.number(),
  /** Failed call count */
  failedCount: z.number(),
  /** Total input tokens */
  inputTokens: z.number(),
  /** Total output tokens */
  outputTokens: z.number(),
  /** Latency statistics */
  latency: LLMLatencyStatsSchema,
  /** Breakdown by model within this provider */
  byModel: z.record(z.string(), LLMModelMetricsSchema),
})

export type LLMProviderMetrics = z.infer<typeof LLMProviderMetricsSchema>

/**
 * Session totals for convenience display.
 */
export const LLMSessionTotalsSchema = z.object({
  /** Total call count */
  callCount: z.number(),
  /** Successful call count */
  successCount: z.number(),
  /** Failed call count */
  failedCount: z.number(),
  /** Total input tokens */
  inputTokens: z.number(),
  /** Total output tokens */
  outputTokens: z.number(),
  /** Total latency in ms */
  totalLatencyMs: z.number(),
  /** Average latency in ms (computed: totalLatencyMs / successCount) */
  averageLatencyMs: z.number(),
})

export type LLMSessionTotals = z.infer<typeof LLMSessionTotalsSchema>

/**
 * LLM metrics aggregated per provider and model within a session.
 * Tracks call counts, token usage, and latency statistics.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/llm-metrics.json`
 */
export const LLMMetricsStateSchema = z.object({
  /** Session identifier */
  sessionId: z.string(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
  /** Aggregated metrics by provider */
  byProvider: z.record(z.string(), LLMProviderMetricsSchema),
  /** Session-level totals (convenience) */
  totals: LLMSessionTotalsSchema,
})

export type LLMMetricsState = z.infer<typeof LLMMetricsStateSchema>

/**
 * Default latency stats for initialization.
 */
export const DEFAULT_LATENCY_STATS: LLMLatencyStats = {
  min: Infinity,
  max: 0,
  sum: 0,
  count: 0,
  p50: 0,
  p90: 0,
  p95: 0,
}

/**
 * Create default LLM metrics state for a session.
 */
export function createDefaultLLMMetrics(sessionId: string): LLMMetricsState {
  return {
    sessionId,
    lastUpdatedAt: Date.now(),
    byProvider: {},
    totals: {
      callCount: 0,
      successCount: 0,
      failedCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
    },
  }
}

// ============================================================================
// Unified Session State Response
// ============================================================================

// ============================================================================
// StateService Interface
// ============================================================================

/**
 * Result of a state read operation.
 * Source indicates how the data was obtained.
 */
export interface StateReadResult<T> {
  /** The validated data */
  data: T
  /** How the data was obtained: fresh, stale (older than threshold), default (file missing), recovered (from .bak) */
  source: 'fresh' | 'stale' | 'default' | 'recovered'
  /** File modification time (ms) if file exists */
  mtime?: number
}

/**
 * Minimal StateService interface for DaemonContext.
 * Provides atomic writes with schema validation and corrupt file recovery.
 *
 * The actual implementation lives in @sidekick/core and is injected via DaemonContext.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */
export interface MinimalStateService {
  /**
   * Read state file with Zod validation.
   * @param path - Absolute path to state file
   * @param schema - Zod schema for validation
   * @param defaultValue - Optional default if file missing/corrupt
   * @throws StateNotFoundError if file missing and no default
   * @throws StateCorruptError if validation fails and no default
   */
  read<T>(path: string, schema: z.ZodType<T>, defaultValue?: T | (() => T)): Promise<StateReadResult<T>>

  /**
   * Atomic write with Zod validation.
   * Uses tmp + rename pattern to prevent corruption.
   * @param path - Absolute path to state file
   * @param data - Data to write
   * @param schema - Zod schema for validation
   */
  write<T>(path: string, data: T, schema: z.ZodType<T>): Promise<void>

  /**
   * Delete state file if it exists.
   * @param path - Absolute path to state file
   */
  delete(path: string): Promise<void>

  /**
   * Get absolute path for a session state file.
   * @param sessionId - Session identifier
   * @param filename - State file name (e.g., 'session-summary.json')
   */
  sessionStatePath(sessionId: string, filename: string): string
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
  /** Transcript metrics (if available) */
  metrics?: TranscriptMetricsState
  /** Context metrics for this session (if available) */
  contextMetrics?: SessionContextMetrics
  /** Staged reminders (if any) */
  stagedReminders?: StagedRemindersSnapshot
  /** Compaction history (if any) */
  compactionHistory?: CompactionHistoryState
  /** LLM metrics for this session (if available) */
  llmMetrics?: LLMMetricsState
  /** Log metrics (warnings/errors) for this session (if available) */
  logMetrics?: LogMetricsState
}
