/**
 * Metrics State Domain Types
 *
 * Schemas for transcript metrics, log metrics, context metrics, and LLM metrics.
 * Persisted to `.sidekick/sessions/{sessionId}/state/` or `.sidekick/state/`.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.5
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import { z } from 'zod'

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
// Context Metrics State
// ============================================================================

/**
 * Base token metrics that are consistent across projects.
 * Captured via `claude -p "/context"` and stored globally.
 *
 * Location: `~/.sidekick/state/baseline-user-context-token-metrics.json`
 *
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
  /** Unix timestamp (ms) of last capture error (null = no recent error) */
  lastErrorAt: z.number().nullable().optional(),
  /** Last capture error message (for diagnostics) */
  lastErrorMessage: z.string().nullable().optional(),
})

export type BaseTokenMetricsState = z.infer<typeof BaseTokenMetricsStateSchema>

/**
 * Project-specific context metrics that vary per-project.
 * Updated when /context command output is observed in transcripts.
 *
 * Location: `.sidekick/state/baseline-project-context-token-metrics.json`
 *
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
  lastErrorAt: null,
  lastErrorMessage: null,
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
