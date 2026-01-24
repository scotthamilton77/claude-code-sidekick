/**
 * Mock Transcript Service for Testing
 *
 * Provides an in-memory transcript service for testing without file watching.
 * Implements the TranscriptService interface from @sidekick/types.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import type {
  TranscriptService,
  TranscriptMetrics,
  TokenUsageMetrics,
  CompactionEntry,
  Unsubscribe,
  Transcript,
  ExcerptOptions,
  TranscriptExcerpt,
} from '@sidekick/types'

/**
 * Creates default token usage metrics with all zeros.
 */
export function createDefaultTokenUsage(): TokenUsageMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheTiers: {
      ephemeral5mInputTokens: 0,
      ephemeral1hInputTokens: 0,
    },
    serviceTierCounts: {},
    byModel: {},
  }
}

/**
 * Creates default transcript metrics with all zeros.
 */
export function createDefaultMetrics(): TranscriptMetrics {
  return {
    turnCount: 0,
    toolCount: 0,
    toolsThisTurn: 0,
    messageCount: 0,
    tokenUsage: createDefaultTokenUsage(),
    currentContextTokens: null,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}

export class MockTranscriptService implements TranscriptService {
  private metrics: TranscriptMetrics = createDefaultMetrics()
  private compactionHistory: CompactionEntry[] = []
  private metricsCallbacks: Array<(metrics: TranscriptMetrics) => void> = []
  private thresholdCallbacks: Array<{
    metric: keyof TranscriptMetrics
    threshold: number
    callback: () => void
  }> = []

  private sessionId: string | null = null
  private transcriptPath: string | null = null

  /** Mock content returned by getExcerpt() - set via setMockExcerptContent() */
  private mockExcerptContent: string = ''

  /** Mock entries returned by getTranscript() - set via setMockEntries() */
  private mockEntries: import('@sidekick/types').CanonicalTranscriptEntry[] = []

  /** Track whether prepare() has been called */
  private prepared = false

  /**
   * Prepare the service without starting event emission.
   */
  prepare(sessionId: string, transcriptPath: string): Promise<void> {
    this.sessionId = sessionId
    this.transcriptPath = transcriptPath
    this.metrics = createDefaultMetrics()
    this.compactionHistory = []
    this.prepared = true
    return Promise.resolve()
  }

  /**
   * Start event emission. No-op in mock since there's no file watching.
   */
  start(): Promise<void> {
    if (!this.prepared) {
      return Promise.reject(new Error('MockTranscriptService.start() called before prepare()'))
    }
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    this.sessionId = null
    this.transcriptPath = null
    this.metricsCallbacks = []
    this.thresholdCallbacks = []
    this.prepared = false
    return Promise.resolve()
  }

  getTranscript(): Transcript {
    return {
      entries: this.mockEntries,
      metadata: {
        sessionId: this.sessionId ?? '',
        transcriptPath: this.transcriptPath ?? '',
        lineCount: this.metrics.lastProcessedLine,
        lastModified: this.metrics.lastUpdatedAt,
      },
      toString: () => '',
    }
  }

  getExcerpt(options: ExcerptOptions = {}): TranscriptExcerpt {
    const maxLines = options.maxLines ?? 80
    return {
      content: this.mockExcerptContent,
      lineCount: Math.min(maxLines, this.metrics.lastProcessedLine),
      startLine: Math.max(1, this.metrics.lastProcessedLine - maxLines + 1),
      endLine: this.metrics.lastProcessedLine,
      bookmarkApplied: (options.bookmarkLine ?? 0) > 0,
    }
  }

  getRecentEntries(count = 100): import('@sidekick/types').CanonicalTranscriptEntry[] {
    return this.mockEntries.slice(-count)
  }

  getMetrics(): TranscriptMetrics {
    return this.deepCloneMetrics()
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
    this.metrics = createDefaultMetrics()
    this.compactionHistory = []
    this.metricsCallbacks = []
    this.thresholdCallbacks = []
    this.sessionId = null
    this.transcriptPath = null
    this.mockExcerptContent = ''
    this.mockEntries = []
  }

  /**
   * Set mock excerpt content for getExcerpt() to return.
   */
  setMockExcerptContent(content: string): void {
    this.mockExcerptContent = content
  }

  /**
   * Set mock transcript entries for getTranscript() to return.
   */
  setMockEntries(entries: import('@sidekick/types').CanonicalTranscriptEntry[]): void {
    this.mockEntries = entries
  }

  /**
   * Set metrics directly (for test setup).
   * Deep-merges tokenUsage if provided.
   * Notifies callbacks and checks thresholds.
   */
  setMetrics(newMetrics: Partial<TranscriptMetrics>): void {
    const oldMetrics = this.deepCloneMetrics()

    // Deep-merge tokenUsage if provided
    if (newMetrics.tokenUsage) {
      this.metrics = {
        ...this.metrics,
        ...newMetrics,
        tokenUsage: {
          ...this.metrics.tokenUsage,
          ...newMetrics.tokenUsage,
          cacheTiers: {
            ...this.metrics.tokenUsage.cacheTiers,
            ...(newMetrics.tokenUsage.cacheTiers ?? {}),
          },
          serviceTierCounts: {
            ...this.metrics.tokenUsage.serviceTierCounts,
            ...(newMetrics.tokenUsage.serviceTierCounts ?? {}),
          },
          byModel: {
            ...this.metrics.tokenUsage.byModel,
            ...(newMetrics.tokenUsage.byModel ?? {}),
          },
        },
      }
    } else {
      this.metrics = { ...this.metrics, ...newMetrics }
    }

    // Update lastUpdatedAt timestamp
    this.metrics.lastUpdatedAt = Date.now()

    // Notify callbacks
    for (const callback of this.metricsCallbacks) {
      callback(this.deepCloneMetrics())
    }

    // Check thresholds (only numeric metrics)
    for (const { metric, threshold, callback } of this.thresholdCallbacks) {
      const oldValue = oldMetrics[metric]
      const newValue = this.metrics[metric]
      if (typeof oldValue === 'number' && typeof newValue === 'number') {
        if (oldValue < threshold && newValue >= threshold) {
          callback()
        }
      }
    }
  }

  /**
   * Simulate a user turn (increments turnCount and messageCount, resets toolsThisTurn).
   * Updates toolsPerTurn derived metric.
   */
  simulateTurn(): void {
    const newTurnCount = this.metrics.turnCount + 1
    this.setMetrics({
      turnCount: newTurnCount,
      messageCount: this.metrics.messageCount + 1,
      toolsThisTurn: 0,
      toolsPerTurn: newTurnCount > 0 ? this.metrics.toolCount / newTurnCount : 0,
    })
  }

  /**
   * Simulate an assistant message (increments messageCount).
   */
  simulateAssistantMessage(): void {
    this.setMetrics({
      messageCount: this.metrics.messageCount + 1,
    })
  }

  /**
   * Simulate a tool call (increments toolCount and toolsThisTurn).
   * Updates toolsPerTurn derived metric.
   */
  simulateToolCall(): void {
    const newToolCount = this.metrics.toolCount + 1
    const newToolsThisTurn = this.metrics.toolsThisTurn + 1
    this.setMetrics({
      toolCount: newToolCount,
      toolsThisTurn: newToolsThisTurn,
      toolsPerTurn: this.metrics.turnCount > 0 ? newToolCount / this.metrics.turnCount : 0,
    })
  }

  /**
   * Simulate token usage from an API response.
   * Accumulates tokens into the running totals.
   */
  simulateTokenUsage(usage: {
    inputTokens: number
    outputTokens: number
    model?: string
    serviceTier?: string
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }): void {
    const current = this.metrics.tokenUsage

    const updatedByModel = { ...current.byModel }
    if (usage.model) {
      const existing = updatedByModel[usage.model] ?? { inputTokens: 0, outputTokens: 0, requestCount: 0 }
      updatedByModel[usage.model] = {
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
        requestCount: existing.requestCount + 1,
      }
    }

    const updatedServiceTierCounts = { ...current.serviceTierCounts }
    if (usage.serviceTier) {
      updatedServiceTierCounts[usage.serviceTier] = (updatedServiceTierCounts[usage.serviceTier] ?? 0) + 1
    }

    this.setMetrics({
      tokenUsage: {
        inputTokens: current.inputTokens + usage.inputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
        totalTokens: current.totalTokens + usage.inputTokens + usage.outputTokens,
        cacheCreationInputTokens: current.cacheCreationInputTokens + (usage.cacheCreationInputTokens ?? 0),
        cacheReadInputTokens: current.cacheReadInputTokens + (usage.cacheReadInputTokens ?? 0),
        cacheTiers: current.cacheTiers,
        serviceTierCounts: updatedServiceTierCounts,
        byModel: updatedByModel,
      },
    })
  }

  /**
   * Simulate processing a line (increments lastProcessedLine).
   */
  simulateLineProcessed(): void {
    this.setMetrics({
      lastProcessedLine: this.metrics.lastProcessedLine + 1,
    })
  }

  /**
   * Get current session info.
   */
  getSessionInfo(): { sessionId: string | null; transcriptPath: string | null } {
    return { sessionId: this.sessionId, transcriptPath: this.transcriptPath }
  }

  /**
   * Get callback counts for test assertions.
   */
  getCallbackCounts(): { metricsCallbacks: number; thresholdCallbacks: number } {
    return {
      metricsCallbacks: this.metricsCallbacks.length,
      thresholdCallbacks: this.thresholdCallbacks.length,
    }
  }

  /**
   * Deep clone metrics to avoid mutation issues.
   */
  private deepCloneMetrics(): TranscriptMetrics {
    return {
      ...this.metrics,
      tokenUsage: {
        ...this.metrics.tokenUsage,
        cacheTiers: { ...this.metrics.tokenUsage.cacheTiers },
        serviceTierCounts: { ...this.metrics.tokenUsage.serviceTierCounts },
        byModel: Object.fromEntries(Object.entries(this.metrics.tokenUsage.byModel).map(([k, v]) => [k, { ...v }])),
      },
    }
  }
}
