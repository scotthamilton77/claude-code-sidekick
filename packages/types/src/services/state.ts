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
}
