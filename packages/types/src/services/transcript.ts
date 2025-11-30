/**
 * Transcript Service Types
 *
 * Interfaces for transcript processing and metrics.
 * Used by Supervisor for background transcript analysis.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import type { TranscriptMetrics } from '../events.js'

/**
 * Unsubscribe function returned by observable subscriptions.
 */
export type Unsubscribe = () => void

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
   */
  initialize(sessionId: string, transcriptPath: string): Promise<void>

  /**
   * Shutdown the service.
   * Stops file watching and persists final state.
   */
  shutdown(): Promise<void>

  /**
   * Get current transcript metrics.
   * Synchronous getter - returns cached metrics.
   */
  getMetrics(): TranscriptMetrics

  /**
   * Get a specific metric value.
   */
  getMetric<K extends keyof TranscriptMetrics>(key: K): TranscriptMetrics[K]

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
