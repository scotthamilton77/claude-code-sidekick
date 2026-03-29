/**
 * Transcript Event Type Definitions
 *
 * Events emitted by TranscriptService when monitoring transcript files.
 * Includes token usage metrics and transcript-level metrics.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1
 */

import type { EventContext } from './hook-events.js'

// ============================================================================
// Transcript Events - from file watching
// ============================================================================

/**
 * Transcript event types emitted by TranscriptService.
 */
export type TranscriptEventType =
  | 'UserPrompt'
  | 'AssistantMessage'
  | 'ToolCall'
  | 'ToolResult'
  | 'Compact'
  | 'BulkProcessingComplete'

/**
 * Raw transcript entry from JSONL file.
 * Structure varies by entry type.
 */
export type TranscriptEntry = Record<string, unknown>

/**
 * Token usage metrics extracted from native transcript metadata.
 * Cumulative totals across session.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1, §3.4
 */
export interface TokenUsageMetrics {
  /** Sum of usage.input_tokens across all assistant responses */
  inputTokens: number
  /** Sum of usage.output_tokens across all assistant responses */
  outputTokens: number
  /** inputTokens + outputTokens */
  totalTokens: number

  // Cache metrics (critical for cost analysis)
  /** Sum of cache_creation_input_tokens */
  cacheCreationInputTokens: number
  /** Sum of cache_read_input_tokens (cache hits) */
  cacheReadInputTokens: number

  /** Cache tier breakdown */
  cacheTiers: {
    /** cache_creation.ephemeral_5m_input_tokens */
    ephemeral5mInputTokens: number
    /** cache_creation.ephemeral_1h_input_tokens */
    ephemeral1hInputTokens: number
  }

  /** Service tier tracking (for cost/performance analysis) */
  serviceTierCounts: Record<string, number>

  /** Per-model breakdown (sessions may span model switches) */
  byModel: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      requestCount: number
    }
  >
}

/**
 * Full transcript metrics schema.
 * Single source of truth for transcript-derived metrics.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1
 */
export interface TranscriptMetrics {
  // Turn-level metrics
  /** Total user prompts in session */
  turnCount: number
  /** Tools since last UserPrompt (reset on UserPrompt) */
  toolsThisTurn: number

  // Session-level metrics
  /** Total tool invocations across session */
  toolCount: number
  /** Total messages (user + assistant + system) */
  messageCount: number

  // Token metrics (extracted from native transcript metadata)
  /** Token usage metrics from API responses (cumulative, never resets) */
  tokenUsage: TokenUsageMetrics

  /**
   * Current context window tokens (resets on compact).
   * Calculated from API usage: input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
   * Unlike tokenUsage which tracks cumulative totals for cost analysis,
   * this tracks the actual tokens in the current context window.
   *
   * - null: New session (no usage blocks yet) or post-compact indeterminate state
   * - number: Actual context window size from last API response
   */
  currentContextTokens: number | null

  /**
   * True after compact_boundary detected until first usage block arrives.
   * When true, statusline should show placeholder (e.g., "⟳ compacted").
   */
  isPostCompactIndeterminate: boolean

  // Derived ratios
  /** Average tools per turn (toolCount / turnCount) */
  toolsPerTurn: number

  // Watermarks
  /** Line number of last processed transcript entry */
  lastProcessedLine: number
  /** Timestamp of last metrics update (Unix ms) */
  lastUpdatedAt: number
}

/**
 * Transcript events emitted by TranscriptService when file changes detected.
 * TranscriptService updates internal state BEFORE emitting, so embedded
 * metrics reflect current state including this event.
 */
export interface TranscriptEvent {
  kind: 'transcript'
  eventType: TranscriptEventType
  context: EventContext
  payload: {
    /** Line in transcript file */
    lineNumber: number
    /** Raw JSONL entry */
    entry: TranscriptEntry
    /** Parsed content (if applicable) */
    content?: string
    /** For ToolCall/ToolResult events */
    toolName?: string
  }
  metadata: {
    /** Absolute path to transcript file */
    transcriptPath: string
    /** Snapshot of current metrics (after this event) */
    metrics: TranscriptMetrics
    /** True when replaying historical transcript data (first-time processing) */
    isBulkProcessing?: boolean
  }
}
