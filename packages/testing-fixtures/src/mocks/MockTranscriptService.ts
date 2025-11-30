/**
 * Mock Transcript Service for Testing
 *
 * Provides an in-memory transcript service for testing without file watching.
 * Implements the TranscriptService interface from @sidekick/types.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import type { TranscriptService, TranscriptMetrics, CompactionEntry, Unsubscribe } from '@sidekick/types'

const DEFAULT_METRICS: TranscriptMetrics = {
  turnCount: 0,
  toolCount: 0,
  toolsThisTurn: 0,
  totalTokens: 0,
}

export class MockTranscriptService implements TranscriptService {
  private metrics: TranscriptMetrics = { ...DEFAULT_METRICS }
  private compactionHistory: CompactionEntry[] = []
  private metricsCallbacks: Array<(metrics: TranscriptMetrics) => void> = []
  private thresholdCallbacks: Array<{
    metric: keyof TranscriptMetrics
    threshold: number
    callback: () => void
  }> = []

  private sessionId: string | null = null
  private transcriptPath: string | null = null

  initialize(sessionId: string, transcriptPath: string): Promise<void> {
    this.sessionId = sessionId
    this.transcriptPath = transcriptPath
    this.metrics = { ...DEFAULT_METRICS }
    this.compactionHistory = []
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    this.sessionId = null
    this.transcriptPath = null
    this.metricsCallbacks = []
    this.thresholdCallbacks = []
    return Promise.resolve()
  }

  getMetrics(): TranscriptMetrics {
    return { ...this.metrics }
  }

  getMetric<K extends keyof TranscriptMetrics>(key: K): TranscriptMetrics[K] {
    return this.metrics[key]
  }

  onMetricsChange(callback: (metrics: TranscriptMetrics) => void): Unsubscribe {
    this.metricsCallbacks.push(callback)
    return () => {
      const idx = this.metricsCallbacks.indexOf(callback)
      if (idx >= 0) {
        this.metricsCallbacks.splice(idx, 1)
      }
    }
  }

  onThreshold(metric: keyof TranscriptMetrics, threshold: number, callback: () => void): Unsubscribe {
    const entry = { metric, threshold, callback }
    this.thresholdCallbacks.push(entry)
    return () => {
      const idx = this.thresholdCallbacks.indexOf(entry)
      if (idx >= 0) {
        this.thresholdCallbacks.splice(idx, 1)
      }
    }
  }

  capturePreCompactState(snapshotPath: string): Promise<void> {
    this.compactionHistory.push({
      compactedAt: Date.now(),
      transcriptSnapshotPath: snapshotPath,
      metricsAtCompaction: { ...this.metrics },
      postCompactLineCount: 0, // Will be set after compaction
    })
    return Promise.resolve()
  }

  getCompactionHistory(): CompactionEntry[] {
    return [...this.compactionHistory]
  }

  // Test utilities

  /**
   * Reset the service to initial state.
   */
  reset(): void {
    this.metrics = { ...DEFAULT_METRICS }
    this.compactionHistory = []
    this.metricsCallbacks = []
    this.thresholdCallbacks = []
    this.sessionId = null
    this.transcriptPath = null
  }

  /**
   * Set metrics directly (for test setup).
   * Notifies callbacks and checks thresholds.
   */
  setMetrics(newMetrics: Partial<TranscriptMetrics>): void {
    const oldMetrics = { ...this.metrics }
    this.metrics = { ...this.metrics, ...newMetrics }

    // Notify callbacks
    for (const callback of this.metricsCallbacks) {
      callback(this.metrics)
    }

    // Check thresholds
    for (const { metric, threshold, callback } of this.thresholdCallbacks) {
      const oldValue = oldMetrics[metric]
      const newValue = this.metrics[metric]
      if (oldValue < threshold && newValue >= threshold) {
        callback()
      }
    }
  }

  /**
   * Simulate a turn (increments turnCount, resets toolsThisTurn).
   */
  simulateTurn(): void {
    this.setMetrics({
      turnCount: this.metrics.turnCount + 1,
      toolsThisTurn: 0,
    })
  }

  /**
   * Simulate a tool call (increments toolCount and toolsThisTurn).
   */
  simulateToolCall(): void {
    this.setMetrics({
      toolCount: this.metrics.toolCount + 1,
      toolsThisTurn: this.metrics.toolsThisTurn + 1,
    })
  }

  /**
   * Get current session info.
   */
  getSessionInfo(): { sessionId: string | null; transcriptPath: string | null } {
    return { sessionId: this.sessionId, transcriptPath: this.transcriptPath }
  }
}
