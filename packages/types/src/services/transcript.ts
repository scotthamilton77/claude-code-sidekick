/**
 * Transcript Service Types
 *
 * Interfaces for transcript processing and metrics.
 * Used by Daemon for background transcript analysis.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import type { TranscriptMetrics } from '../events.js'

/**
 * Unsubscribe function returned by observable subscriptions.
 */
export type Unsubscribe = () => void

// ============================================================================
// Canonical Transcript Types (per §2.1.2, §2.1.3)
// ============================================================================

/**
 * Canonical transcript entry - normalized from raw JSONL.
 * Provider-agnostic representation used by features.
 *
 * Note: Different from TranscriptEvent in events.ts which is a file-watching event.
 * @see docs/design/TRANSCRIPT-PROCESSING.md §2.1.2
 */
export interface CanonicalTranscriptEntry {
  id: string
  timestamp: Date
  role: 'user' | 'assistant' | 'system'
  type: 'text' | 'tool_use' | 'tool_result'
  content: string | Record<string, unknown>
  metadata: {
    provider: string
    originalId?: string
    lineNumber?: number
    [key: string]: unknown
  }
}

/**
 * Transcript metadata.
 */
export interface TranscriptMetadata {
  sessionId: string
  transcriptPath: string
  lineCount: number
  lastModified: number
}

/**
 * Transcript wrapper with utility methods.
 * @see docs/design/TRANSCRIPT-PROCESSING.md §2.1.3
 */
export interface Transcript {
  entries: CanonicalTranscriptEntry[]
  metadata: TranscriptMetadata
  toString(): string
}

// ============================================================================
// Excerpt Types (for LLM context windows)
// ============================================================================

/**
 * Options for extracting a transcript excerpt.
 * Supports the bookmark strategy per §3.2.2 of FEATURE-SESSION-SUMMARY.md
 */
export interface ExcerptOptions {
  /** Maximum lines to include (default: 80) */
  maxLines?: number
  /** Bookmark line for tiered extraction (0 = no bookmark) */
  bookmarkLine?: number
  /** Filtering level for historical context (before bookmark) */
  historicalFilterLevel?: 'aggressive' | 'light' | 'none'
  /** Filtering level for recent context (after bookmark) */
  recentFilterLevel?: 'aggressive' | 'light' | 'none'
  /**
   * Include tool messages ([TOOL]: and [RESULT]:) in excerpt.
   * When false, both tool_use and tool_result entries are omitted entirely.
   * @default true
   */
  includeToolMessages?: boolean
  /**
   * Include full tool output content in [RESULT]: lines.
   * Only relevant when includeToolMessages is true.
   * When false, shows "[RESULT]: (output omitted)" instead.
   * @default false
   */
  includeToolOutputs?: boolean
  /**
   * Include assistant thinking blocks in excerpt.
   * When true, shows "[THINKING]: ..." for thinking content.
   * @default false
   */
  includeAssistantThinking?: boolean
}

/**
 * Extracted transcript excerpt ready for LLM context.
 */
export interface TranscriptExcerpt {
  /** Formatted text content for LLM prompt */
  content: string
  /** Number of lines included */
  lineCount: number
  /** Start line number in original transcript */
  startLine: number
  /** End line number in original transcript */
  endLine: number
  /** Whether bookmark strategy was applied */
  bookmarkApplied: boolean
}

/**
 * Compaction entry for timeline tracking.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2
 */
export interface CompactionEntry {
  /** When compaction occurred (Unix ms) */
  compactedAt: number
  /** Path to pre-compact transcript snapshot */
  transcriptSnapshotPath: string
  /** Metrics at time of compaction */
  metricsAtCompaction: TranscriptMetrics
  /** Lines remaining after compaction */
  postCompactLineCount: number
}

/**
 * Transcript service interface.
 * Single source of truth for transcript-derived metrics.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §2.2.5
 */
export interface TranscriptService {
  /**
   * Initialize the service for a session.
   * Starts file watching and metrics computation.
   *
   * @deprecated Use prepare() + start() for explicit lifecycle control.
   * This method exists for backward compatibility and calls prepare() then start().
   */
  initialize(sessionId: string, transcriptPath: string): Promise<void>

  /**
   * Prepare the service for a session without starting event emission.
   * Sets up paths, loads persisted state, but does NOT start file watching
   * or process the transcript file. This allows the caller to wire up
   * context before events fire.
   *
   * Call start() after wiring up handler context to begin event emission.
   */
  prepare(sessionId: string, transcriptPath: string): Promise<void>

  /**
   * Start file watching and process existing transcript content.
   * Events will be emitted to handlers during this call.
   * Must call prepare() first.
   *
   * @throws Error if prepare() was not called first
   */
  start(): Promise<void>

  /**
   * Shutdown the service.
   * Stops file watching and persists final state.
   */
  shutdown(): Promise<void>

  // ---- Transcript Access ----

  /**
   * Get the current normalized transcript.
   * @see docs/design/TRANSCRIPT-PROCESSING.md §2.2.5
   */
  getTranscript(): Transcript

  /**
   * Get a windowed excerpt for LLM context.
   * Supports bookmark-based tiered extraction.
   * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.2
   */
  getExcerpt(options?: ExcerptOptions): TranscriptExcerpt

  // ---- Metrics Access ----

  /**
   * Get current transcript metrics.
   * Synchronous getter - returns cached metrics.
   */
  getMetrics(): TranscriptMetrics

  /**
   * Get a specific metric value.
   */
  getMetric<K extends keyof TranscriptMetrics>(key: K): TranscriptMetrics[K]

  // ---- Observable API ----

  /**
   * Subscribe to metrics changes.
   * Callback invoked on any metric update.
   */
  onMetricsChange(callback: (metrics: TranscriptMetrics) => void): Unsubscribe

  /**
   * Subscribe to threshold alerts.
   * Callback invoked when metric crosses threshold.
   */
  onThreshold(metric: keyof TranscriptMetrics, threshold: number, callback: () => void): Unsubscribe

  // ---- Compaction Management ----

  /**
   * Capture pre-compaction state for timeline.
   * Called by PreCompact handler.
   */
  capturePreCompactState(snapshotPath: string): Promise<void>

  /**
   * Get compaction history for UI timeline.
   */
  getCompactionHistory(): CompactionEntry[]
}
