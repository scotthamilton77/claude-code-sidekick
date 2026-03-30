/**
 * Transcript Service Implementation
 *
 * Thin coordinator that delegates to extracted modules:
 * - transcript-helpers: shared constants, types, default creators
 * - transcript-normalizer: entry normalization, UUID parsing, rendering
 * - transcript-excerpt-builder: excerpt building, line formatting
 * - transcript-metrics-engine: entry processing, token extraction
 * - transcript-persistence: state persistence, compaction history
 * - transcript-file-watcher: file watching, streaming, circular buffer
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { FSWatcher } from 'chokidar'
import { LogEvents, logEvent } from './structured-logging.js'
import type {
  TranscriptService,
  TranscriptMetrics,
  CompactionEntry,
  Unsubscribe,
  TranscriptEventType,
  TranscriptEntry,
  HandlerRegistry,
  Logger,
  Transcript,
  CanonicalTranscriptEntry,
  ExcerptOptions,
  TranscriptExcerpt,
  MinimalStateService,
} from '@sidekick/types'

// Re-export from helpers for backward compatibility (barrel pattern)
export { createDefaultMetrics, createDefaultTokenUsage } from './transcript-helpers.js'

// Import from extracted modules
import { createDefaultMetrics } from './transcript-helpers.js'
import { normalizeEntry, parseBufferedEntry, parseRawLine, renderTranscriptString } from './transcript-normalizer.js'
import { buildExcerpt, getBufferedEntries } from './transcript-excerpt-builder.js'
import { processEntry as processMetricsEntry } from './transcript-metrics-engine.js'
import {
  persistMetrics as doPersistMetrics,
  loadPersistedState as doLoadPersistedState,
  persistCompactionHistory as doPersistCompactionHistory,
  loadCompactionHistory as doLoadCompactionHistory,
  schedulePersistence as doSchedulePersistence,
} from './transcript-persistence.js'
import {
  createStreamingState,
  startWatching,
  processTranscriptFile as doProcessTranscriptFile,
  enqueueProcessing,
  type StreamingState,
} from './transcript-file-watcher.js'
import { EXCERPT_BUFFER_SIZE } from './transcript-helpers.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a TranscriptServiceImpl.
 */
export interface TranscriptServiceOptions {
  /** Debounce interval for file watching (ms) */
  watchDebounceMs: number
  /** Interval for periodic metrics persistence (ms) */
  metricsPersistIntervalMs: number
  /** Handler registry for event emission */
  handlers: HandlerRegistry
  /** Logger for observability */
  logger: Logger
  /** Base state directory (e.g., .sidekick) - used for path construction */
  stateDir: string
  /** StateService for atomic writes and schema validation */
  stateService: MinimalStateService
}

// ============================================================================
// TranscriptServiceImpl
// ============================================================================

/**
 * Implementation of TranscriptService.
 *
 * Thin coordinator that delegates to extracted modules for:
 * - Entry normalization (transcript-normalizer)
 * - Excerpt building (transcript-excerpt-builder)
 * - Metrics computation (transcript-metrics-engine)
 * - State persistence (transcript-persistence)
 * - File watching and streaming (transcript-file-watcher)
 */
export class TranscriptServiceImpl implements TranscriptService {
  private sessionId: string | null = null
  private transcriptPath: string | null = null
  private metrics: TranscriptMetrics = createDefaultMetrics()
  private compactionHistory: CompactionEntry[] = []

  // File watching
  private watcher: FSWatcher | null = null
  private watcherCleanup: (() => void) | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Observable subscriptions
  private metricsCallbacks: Array<(metrics: TranscriptMetrics) => void> = []
  private thresholdCallbacks: Array<{
    metric: keyof TranscriptMetrics
    threshold: number
    callback: () => void
    fired: boolean
  }> = []

  // Persistence
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private persistIntervalTimer: ReturnType<typeof setInterval> | null = null
  private lastPersistedAt = 0

  /** Track whether prepare() has been called */
  private prepared = false

  /** Track whether we're in bulk processing mode (first-time transcript replay) */
  private isBulkProcessing = false

  /** One-shot guard -- prevents BulkProcessingComplete from firing more than once per instance */
  private hasFiredBulkComplete = false

  /** Whether the transcript file had existing data at prepare() time with no recovered state. */
  private hasBacklogAtPrepareTime = false

  /** Timestamp when bulk processing started */
  private bulkStartTime = 0

  /** Map tool_use_id -> tool name so ToolResult events can include the tool name */
  private toolUseIdToName = new Map<string, string>()

  // Streaming state (delegated to transcript-file-watcher)
  private streamingState: StreamingState = createStreamingState()

  /** Serializes all processTranscriptFile() calls to prevent concurrent reads. */
  private processChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: TranscriptServiceOptions) {}

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  async prepare(sessionId: string, transcriptPath: string): Promise<void> {
    if (this.sessionId !== null) {
      throw new Error('TranscriptService already prepared - call shutdown() first')
    }
    this.sessionId = sessionId
    this.transcriptPath = transcriptPath

    // Try to recover from persisted state
    const recovered = await doLoadPersistedState(
      sessionId,
      this.options.stateService,
      this.options.stateDir,
      this.options.logger
    )
    if (recovered) {
      this.metrics = recovered.metrics
      this.streamingState.lastProcessedByteOffset = recovered.byteOffset
      this.options.logger.info('Recovered transcript state', {
        sessionId,
        lastProcessedLine: this.metrics.lastProcessedLine,
        lastProcessedByteOffset: this.streamingState.lastProcessedByteOffset,
      })
    } else {
      this.metrics = createDefaultMetrics()

      // Detect backlog: file exists with data and no recovered state.
      if (existsSync(transcriptPath)) {
        try {
          const stats = statSync(transcriptPath)
          this.hasBacklogAtPrepareTime = stats.size > 0
        } catch {
          this.hasBacklogAtPrepareTime = false
        }
      }
    }

    // Load compaction history
    this.compactionHistory = await doLoadCompactionHistory(
      sessionId,
      this.options.stateService,
      this.options.stateDir,
      this.options.logger
    )

    this.prepared = true
    this.options.logger.debug('TranscriptService prepared', { sessionId, transcriptPath })
  }

  async start(): Promise<void> {
    if (!this.prepared || this.sessionId === null) {
      throw new Error('TranscriptService.start() called before prepare()')
    }

    // Guard against duplicate start() calls
    if (this.persistIntervalTimer) {
      this.options.logger.debug('TranscriptService.start() called but already running, skipping', {
        sessionId: this.sessionId,
      })
      return
    }

    // Start file watcher
    this.startWatching()

    // Start periodic persistence timer (safety net)
    this.persistIntervalTimer = setInterval(() => {
      this.options.logger.debug('Periodic persist timer fired', {
        sessionId: this.sessionId,
        intervalMs: this.options.metricsPersistIntervalMs,
      })
      void this.persistMetrics()
    }, this.options.metricsPersistIntervalMs)
    if (this.persistIntervalTimer.unref) {
      this.persistIntervalTimer.unref()
    }

    // Process existing content (emits events), serialized through the chain
    await this.enqueueProcessing()

    this.options.logger.info('TranscriptService started', { sessionId: this.sessionId })
  }

  async catchUp(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcherCleanup) {
      this.watcherCleanup()
    }
    await this.enqueueProcessing()
  }

  private enqueueProcessing(): Promise<void> {
    const result = enqueueProcessing(this.processChain, () => this.processTranscriptFile())
    this.processChain = result.chain
    return result.promise
  }

  async shutdown(): Promise<void> {
    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcherCleanup) {
      this.watcherCleanup()
    }
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer)
      this.persistDebounceTimer = null
    }
    if (this.persistIntervalTimer) {
      clearInterval(this.persistIntervalTimer)
      this.persistIntervalTimer = null
    }

    // Stop file watcher
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    // Wait for any in-flight processing to complete before persisting
    await this.processChain

    // Persist final state immediately
    await this.persistMetrics(true)

    // Clear callbacks
    this.metricsCallbacks = []
    this.thresholdCallbacks = []

    this.options.logger.info('TranscriptService shutdown', { sessionId: this.sessionId })

    this.sessionId = null
    this.transcriptPath = null
    this.prepared = false
  }

  // ============================================================================
  // Transcript Access
  // ============================================================================

  getTranscript(): Transcript {
    if (!this.transcriptPath || !existsSync(this.transcriptPath)) {
      return {
        entries: [],
        metadata: {
          sessionId: this.sessionId ?? '',
          transcriptPath: this.transcriptPath ?? '',
          lineCount: 0,
          lastModified: 0,
        },
        toString: () => '',
      }
    }

    const entries: CanonicalTranscriptEntry[] = []
    const content = readFileSync(this.transcriptPath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim())

    for (let i = 0; i < lines.length; i++) {
      const rawEntry = parseRawLine(lines[i], i + 1, this.options.logger)
      if (!rawEntry) continue
      const normalized = normalizeEntry(rawEntry, i + 1)
      if (normalized) {
        entries.push(...normalized)
      }
    }

    const metadata = {
      sessionId: this.sessionId ?? '',
      transcriptPath: this.transcriptPath,
      lineCount: lines.length,
      lastModified: this.metrics.lastUpdatedAt,
    }

    return {
      entries,
      metadata,
      toString: () => renderTranscriptString(entries),
    }
  }

  getExcerpt(options: ExcerptOptions = {}): TranscriptExcerpt {
    // Empty result for uninitialized service
    if (!this.transcriptPath || this.streamingState.excerptBufferCount === 0) {
      return {
        content: '',
        lineCount: 0,
        startLine: 0,
        endLine: 0,
        bookmarkApplied: false,
      }
    }

    const bufferedEntries = getBufferedEntries(
      this.streamingState.excerptBuffer,
      this.streamingState.excerptBufferHead,
      this.streamingState.excerptBufferCount,
      EXCERPT_BUFFER_SIZE
    )

    return buildExcerpt(bufferedEntries, this.streamingState.knownUuids, options, this.options.logger)
  }

  getRecentEntries(count = 100): CanonicalTranscriptEntry[] {
    if (this.streamingState.excerptBufferCount === 0) {
      return []
    }

    const bufferedEntries = getBufferedEntries(
      this.streamingState.excerptBuffer,
      this.streamingState.excerptBufferHead,
      this.streamingState.excerptBufferCount,
      EXCERPT_BUFFER_SIZE
    )
    const recentRaw = bufferedEntries.slice(-count)

    const results: CanonicalTranscriptEntry[] = []
    for (const entry of recentRaw) {
      const normalized = parseBufferedEntry(entry, this.options.logger)
      if (normalized) {
        results.push(...normalized)
      }
    }

    return results
  }

  getRecentTextEntries(count = 10): CanonicalTranscriptEntry[] {
    if (this.streamingState.excerptBufferCount === 0) {
      return []
    }

    const bufferedEntries = getBufferedEntries(
      this.streamingState.excerptBuffer,
      this.streamingState.excerptBufferHead,
      this.streamingState.excerptBufferCount,
      EXCERPT_BUFFER_SIZE
    )

    const textEntries: CanonicalTranscriptEntry[] = []
    for (let i = bufferedEntries.length - 1; i >= 0 && textEntries.length < count; i--) {
      const normalized = parseBufferedEntry(bufferedEntries[i], this.options.logger)
      if (!normalized) continue

      for (let j = normalized.length - 1; j >= 0 && textEntries.length < count; j--) {
        if (normalized[j].type === 'text') {
          textEntries.push(normalized[j])
        }
      }
    }

    return textEntries.reverse()
  }

  // ============================================================================
  // Metrics Access
  // ============================================================================

  getMetrics(): TranscriptMetrics {
    return this.deepCloneMetrics()
  }

  getMetric<K extends keyof TranscriptMetrics>(key: K): TranscriptMetrics[K] {
    return this.metrics[key]
  }

  // ============================================================================
  // Observable API
  // ============================================================================

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
    const entry = { metric, threshold, callback, fired: false }
    this.thresholdCallbacks.push(entry)
    return () => {
      const idx = this.thresholdCallbacks.indexOf(entry)
      if (idx >= 0) {
        this.thresholdCallbacks.splice(idx, 1)
      }
    }
  }

  // ============================================================================
  // Compaction Management
  // ============================================================================

  async capturePreCompactState(snapshotPath: string): Promise<void> {
    if (!this.transcriptPath) {
      throw new Error('TranscriptService not initialized')
    }

    const snapshotDir = dirname(snapshotPath)
    if (!existsSync(snapshotDir)) {
      mkdirSync(snapshotDir, { recursive: true })
    }
    copyFileSync(this.transcriptPath, snapshotPath)

    const entry: CompactionEntry = {
      compactedAt: Date.now(),
      transcriptSnapshotPath: snapshotPath,
      metricsAtCompaction: this.deepCloneMetrics(),
      postCompactLineCount: 0,
    }
    this.compactionHistory.push(entry)

    this.compactionHistory = await doPersistCompactionHistory(
      this.compactionHistory,
      this.sessionId,
      this.options.stateService,
      this.options.stateDir,
      this.options.logger
    )

    if (this.sessionId) {
      const lineCount = statSync(snapshotPath).size > 0 ? this.metrics.lastProcessedLine : 0
      logEvent(
        this.options.logger,
        LogEvents.preCompactCaptured(
          { sessionId: this.sessionId },
          { snapshotPath, lineCount },
          { transcriptPath: this.transcriptPath ?? '', metrics: this.deepCloneMetrics() }
        )
      )
    }

    this.options.logger.info('Captured pre-compact state', { sessionId: this.sessionId, snapshotPath })
  }

  getCompactionHistory(): CompactionEntry[] {
    return [...this.compactionHistory]
  }

  // ============================================================================
  // File Watching (delegates to transcript-file-watcher)
  // ============================================================================

  private startWatching(): void {
    if (!this.transcriptPath) return

    if (this.watcher) {
      this.options.logger.debug('startWatching called but watcher already exists, skipping', {
        sessionId: this.sessionId,
      })
      return
    }

    const { watcher, clearDebounce } = startWatching(
      this.transcriptPath,
      this.options.watchDebounceMs,
      () => {
        this.enqueueProcessing().catch((err) => {
          this.options.logger.error('Error processing transcript file', { err, sessionId: this.sessionId })
        })
      },
      this.options.logger,
      this.sessionId
    )

    this.watcher = watcher
    this.watcherCleanup = clearDebounce
  }

  // ============================================================================
  // Transcript Processing (delegates to transcript-file-watcher + transcript-metrics-engine)
  // ============================================================================

  private async processTranscriptFile(): Promise<void> {
    if (!this.transcriptPath) return

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    await doProcessTranscriptFile(
      this.transcriptPath,
      this.streamingState,
      this.metrics,
      async (entry, lineNumber) => {
        await processMetricsEntry(entry, lineNumber, this.metrics, this.toolUseIdToName, (eventType, e, ln) =>
          this.emitEvent(eventType, e, ln)
        )
      },
      async (lineNumber, _durationMs) => {
        await this.emitEvent('BulkProcessingComplete', {} as TranscriptEntry, lineNumber)
      },
      this.options.logger,
      this.sessionId,
      {
        get hasBacklogAtPrepareTime() {
          return self.hasBacklogAtPrepareTime
        },
        get isBulkProcessing() {
          return self.isBulkProcessing
        },
        get hasFiredBulkComplete() {
          return self.hasFiredBulkComplete
        },
        get bulkStartTime() {
          return self.bulkStartTime
        },
        setIsBulkProcessing: (v) => {
          this.isBulkProcessing = v
        },
        setHasFiredBulkComplete: (v) => {
          this.hasFiredBulkComplete = v
        },
        setBulkStartTime: (v) => {
          this.bulkStartTime = v
        },
      }
    )

    this.notifyMetricsChange()
    this.schedulePersistence()
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  private async emitEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): Promise<void> {
    await this.options.handlers.emitTranscriptEvent(eventType, entry, lineNumber, this.isBulkProcessing)
  }

  // ============================================================================
  // Observable Notifications
  // ============================================================================

  private notifyMetricsChange(): void {
    const snapshot = this.deepCloneMetrics()

    for (const callback of this.metricsCallbacks) {
      try {
        callback(snapshot)
      } catch (err) {
        this.options.logger.error('Error in metrics change callback', { err })
      }
    }

    for (const entry of this.thresholdCallbacks) {
      if (entry.fired) continue

      const value = this.metrics[entry.metric]
      if (typeof value === 'number' && value >= entry.threshold) {
        entry.fired = true
        try {
          entry.callback()
        } catch (err) {
          this.options.logger.error('Error in threshold callback', {
            err,
            metric: entry.metric,
            threshold: entry.threshold,
          })
        }
      }
    }
  }

  // ============================================================================
  // Persistence (delegates to transcript-persistence)
  // ============================================================================

  private schedulePersistence(): void {
    this.persistDebounceTimer = doSchedulePersistence(
      this.persistDebounceTimer,
      this.options.watchDebounceMs,
      () => {
        void this.persistMetrics()
      },
      this.options.logger,
      this.sessionId
    )
  }

  private async persistMetrics(immediate = false): Promise<void> {
    this.lastPersistedAt = await doPersistMetrics(
      this.sessionId,
      this.deepCloneMetrics(),
      this.streamingState.lastProcessedByteOffset,
      this.options.stateService,
      this.options.stateDir,
      immediate,
      this.lastPersistedAt,
      this.options.watchDebounceMs,
      this.options.logger
    )
  }

  // ============================================================================
  // Utilities
  // ============================================================================

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
