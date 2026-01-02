/**
 * Transcript Service Implementation
 *
 * Implements the TranscriptService interface for file watching, metrics computation,
 * and event emission. This is the single source of truth for transcript-derived metrics.
 *
 * Key responsibilities:
 * - Watch transcript file for changes with debouncing
 * - Incremental processing via watermark (lastProcessedLine)
 * - Compaction detection (file shorter than watermark triggers full recompute)
 * - Metrics computation from transcript entries
 * - Event emission to HandlerRegistry
 * - Metrics persistence with debouncing
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import chokidar, { FSWatcher } from 'chokidar'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LogEvents, logEvent } from './structured-logging.js'
import type {
  TranscriptService,
  TranscriptMetrics,
  TokenUsageMetrics,
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
} from '@sidekick/types'

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
  /** Base state directory (e.g., .sidekick) */
  stateDir: string
}

/**
 * Raw usage metadata from Claude Code transcript entries.
 * Extracted from assistant message.usage field.
 */
interface RawUsageMetadata {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  service_tier?: string
}

/**
 * Persisted transcript state for recovery.
 */
interface PersistedTranscriptState {
  sessionId: string
  metrics: TranscriptMetrics
  persistedAt: number
}

// ============================================================================
// Default Metrics Creators
// ============================================================================

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

// ============================================================================
// TranscriptServiceImpl
// ============================================================================

/**
 * Implementation of TranscriptService.
 *
 * Watches the Claude Code transcript file and maintains metrics as the
 * single source of truth for transcript-derived state.
 */
export class TranscriptServiceImpl implements TranscriptService {
  private sessionId: string | null = null
  private transcriptPath: string | null = null
  private metrics: TranscriptMetrics = createDefaultMetrics()
  private compactionHistory: CompactionEntry[] = []

  // File watching
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Observable subscriptions
  private metricsCallbacks: Array<(metrics: TranscriptMetrics) => void> = []
  private thresholdCallbacks: Array<{
    metric: keyof TranscriptMetrics
    threshold: number
    callback: () => void
    fired: boolean // Prevent repeated firing
  }> = []

  // Persistence
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private persistIntervalTimer: ReturnType<typeof setInterval> | null = null
  private lastPersistedAt = 0

  /** Track whether prepare() has been called */
  private prepared = false

  constructor(private readonly options: TranscriptServiceOptions) {}

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Initialize the service (legacy API).
   * @deprecated Use prepare() + start() for explicit lifecycle control.
   */
  async initialize(sessionId: string, transcriptPath: string): Promise<void> {
    await this.prepare(sessionId, transcriptPath)
    await this.start()
  }

  /**
   * Prepare the service without starting event emission.
   * Sets up paths, loads persisted state, but does NOT start file watching
   * or process the transcript file.
   */
  prepare(sessionId: string, transcriptPath: string): Promise<void> {
    if (this.sessionId !== null) {
      throw new Error('TranscriptService already prepared - call shutdown() first')
    }
    this.sessionId = sessionId
    this.transcriptPath = transcriptPath

    // Try to recover from persisted state
    const recovered = this.loadPersistedState()
    if (recovered) {
      this.metrics = recovered
      this.options.logger.info('Recovered transcript state', {
        sessionId,
        lastProcessedLine: this.metrics.lastProcessedLine,
      })
    } else {
      this.metrics = createDefaultMetrics()
    }

    // Load compaction history
    this.loadCompactionHistory()

    this.prepared = true
    this.options.logger.debug('TranscriptService prepared', { sessionId, transcriptPath })
    return Promise.resolve()
  }

  /**
   * Start file watching and process existing content.
   * Events will be emitted to handlers during this call.
   * Must call prepare() first.
   */
  async start(): Promise<void> {
    if (!this.prepared || this.sessionId === null) {
      throw new Error('TranscriptService.start() called before prepare()')
    }

    // Guard against duplicate start() calls - return early if already running
    // This prevents timer accumulation when setContextForHook() is called per-request
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
      this.persistMetrics()
    }, this.options.metricsPersistIntervalMs)
    // Unref so it doesn't block shutdown
    if (this.persistIntervalTimer.unref) {
      this.persistIntervalTimer.unref()
    }

    // Process existing content (emits events)
    await this.processTranscriptFile()

    this.options.logger.info('TranscriptService started', { sessionId: this.sessionId })
  }

  async shutdown(): Promise<void> {
    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
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

    // Persist final state immediately
    this.persistMetrics(true)

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

    // Parse the JSONL transcript file into canonical entries
    const entries: CanonicalTranscriptEntry[] = []
    const content = readFileSync(this.transcriptPath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim())

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      try {
        const rawEntry = JSON.parse(line) as TranscriptEntry
        const normalized = this.normalizeEntry(rawEntry, i + 1)
        if (normalized) {
          entries.push(...normalized)
        }
      } catch (err) {
        this.options.logger.warn('Skipping malformed transcript line', {
          sessionId: this.sessionId,
          line: i + 1,
          error: err instanceof Error ? err.message : String(err),
        })
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
      toString: () => this.renderTranscriptString(entries),
    }
  }

  /**
   * Normalize a raw transcript entry into canonical form.
   * Handles nested tool_use and tool_result blocks.
   * Returns array because one raw entry can produce multiple canonical entries.
   */
  private normalizeEntry(rawEntry: TranscriptEntry, lineNumber: number): CanonicalTranscriptEntry[] | null {
    const entryType = rawEntry.type as string | undefined

    // Skip non-message entry types (file-history-snapshot, summary, etc.)
    if (entryType !== 'user' && entryType !== 'assistant') {
      return null
    }

    const results: CanonicalTranscriptEntry[] = []
    const message = rawEntry.message as {
      role?: string
      content?: string | Array<{ type?: string; text?: string; [key: string]: unknown }>
      model?: string
      id?: string
    }

    if (!message) {
      return null
    }

    const role = message.role as 'user' | 'assistant' | 'system'
    const timestamp = new Date((rawEntry.timestamp as string) ?? Date.now())
    const uuid = (rawEntry.uuid as string) ?? `line-${lineNumber}`

    // Handle message content
    const content = message.content

    if (typeof content === 'string') {
      // Simple text message
      results.push({
        id: uuid,
        timestamp,
        role,
        type: 'text',
        content,
        metadata: {
          provider: 'claude',
          originalId: message.id,
          lineNumber,
        },
      })
    } else if (Array.isArray(content)) {
      // Complex message with nested blocks
      for (const block of content) {
        const blockType = block.type

        if (blockType === 'text') {
          // Text block
          results.push({
            id: `${uuid}-text-${results.length}`,
            timestamp,
            role,
            type: 'text',
            content: (block.text as string) ?? '',
            metadata: {
              provider: 'claude',
              originalId: message.id,
              lineNumber,
            },
          })
        } else if (blockType === 'tool_use') {
          // Tool use block (nested in assistant message)
          results.push({
            id: (block.id as string) ?? `${uuid}-tool-${results.length}`,
            timestamp,
            role: 'assistant',
            type: 'tool_use',
            content: {
              name: block.name,
              input: block.input,
            },
            metadata: {
              provider: 'claude',
              originalId: message.id,
              lineNumber,
              toolName: block.name as string,
            },
          })
        } else if (blockType === 'tool_result') {
          // Tool result block (nested in user message)
          results.push({
            id: (block.tool_use_id as string) ?? `${uuid}-result-${results.length}`,
            timestamp,
            role: 'user',
            type: 'tool_result',
            content: block,
            metadata: {
              provider: 'claude',
              originalId: message.id,
              lineNumber,
              toolUseId: block.tool_use_id as string,
              isError: block.is_error as boolean,
            },
          })
        }
      }
    }

    return results.length > 0 ? results : null
  }

  /**
   * Render transcript as a human-readable string.
   */
  private renderTranscriptString(entries: CanonicalTranscriptEntry[]): string {
    return entries
      .map((entry) => {
        const timestamp = entry.timestamp.toISOString()
        const role = entry.role.toUpperCase()
        const type = entry.type

        if (type === 'text') {
          const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)
          return `[${timestamp}] ${role}: ${content}`
        } else if (type === 'tool_use') {
          const toolContent = entry.content as Record<string, unknown>
          return `[${timestamp}] ${role} TOOL_USE: ${String(toolContent.name)}`
        } else if (type === 'tool_result') {
          return `[${timestamp}] ${role} TOOL_RESULT`
        }
        return `[${timestamp}] ${role}: ${JSON.stringify(entry.content)}`
      })
      .join('\n')
  }

  getExcerpt(options: ExcerptOptions = {}): TranscriptExcerpt {
    const maxLines = options.maxLines ?? 80
    const bookmarkLine = options.bookmarkLine ?? 0
    const includeToolOutputs = options.includeToolOutputs ?? false

    if (!this.transcriptPath) {
      return {
        content: '',
        lineCount: 0,
        startLine: 0,
        endLine: 0,
        bookmarkApplied: false,
      }
    }

    try {
      const content = readFileSync(this.transcriptPath, 'utf-8')
      const lines = content.trim().split('\n')
      const totalLines = lines.length

      // Determine extraction window
      let startLine: number
      const endLine = totalLines
      let bookmarkApplied = false

      if (bookmarkLine > 0 && bookmarkLine < totalLines) {
        // Bookmark strategy: prioritize recent context
        const recentLines = Math.min(maxLines, totalLines - bookmarkLine)
        startLine = Math.max(0, totalLines - recentLines)
        bookmarkApplied = true
      } else {
        // Fallback: simple tail
        startLine = Math.max(0, totalLines - maxLines)
      }

      // Extract and format lines
      const excerpt = lines.slice(startLine, endLine)
      const formatted = excerpt
        .map((line) => {
          try {
            const entry = JSON.parse(line) as {
              type?: string
              name?: string
              content?: string
              message?: { content?: string }
            }
            const entryType = entry.type ?? 'unknown'
            if (entryType === 'user') {
              return `[USER]: ${entry.message?.content ?? entry.content ?? JSON.stringify(entry)}`
            } else if (entryType === 'assistant') {
              return `[ASSISTANT]: ${entry.message?.content ?? entry.content ?? '(tool use)'}`
            } else if (entryType === 'tool_use') {
              return `[TOOL]: ${entry.name ?? 'unknown'}`
            } else if (entryType === 'tool_result') {
              return includeToolOutputs
                ? `[RESULT]: ${JSON.stringify(entry).slice(0, 500)}`
                : '[RESULT]: (output omitted)'
            }
            return `[${entryType.toUpperCase()}]: ${JSON.stringify(entry).slice(0, 100)}`
          } catch {
            return line.slice(0, 200)
          }
        })
        .join('\n')

      return {
        content: formatted,
        lineCount: excerpt.length,
        startLine: startLine + 1, // 1-indexed
        endLine,
        bookmarkApplied,
      }
    } catch (err) {
      this.options.logger.error('Failed to extract transcript excerpt', {
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        content: '',
        lineCount: 0,
        startLine: 0,
        endLine: 0,
        bookmarkApplied: false,
      }
    }
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

  capturePreCompactState(snapshotPath: string): Promise<void> {
    if (!this.transcriptPath) {
      throw new Error('TranscriptService not initialized')
    }

    // Copy current transcript to snapshot path
    const snapshotDir = dirname(snapshotPath)
    if (!existsSync(snapshotDir)) {
      mkdirSync(snapshotDir, { recursive: true })
    }
    copyFileSync(this.transcriptPath, snapshotPath)

    // Record compaction entry
    const entry: CompactionEntry = {
      compactedAt: Date.now(),
      transcriptSnapshotPath: snapshotPath,
      metricsAtCompaction: this.deepCloneMetrics(),
      postCompactLineCount: 0, // Will be updated after compaction
    }
    this.compactionHistory.push(entry)

    // Persist compaction history
    this.persistCompactionHistory()

    // Log PreCompactCaptured event for timeline visibility
    if (this.sessionId) {
      const lineCount = statSync(snapshotPath).size > 0 ? this.metrics.lastProcessedLine : 0
      logEvent(
        this.options.logger,
        LogEvents.preCompactCaptured(
          { sessionId: this.sessionId, scope: 'project' },
          { snapshotPath, lineCount },
          { transcriptPath: this.transcriptPath ?? '', metrics: this.deepCloneMetrics() }
        )
      )
    }

    this.options.logger.info('Captured pre-compact state', { sessionId: this.sessionId, snapshotPath })
    return Promise.resolve()
  }

  getCompactionHistory(): CompactionEntry[] {
    return [...this.compactionHistory]
  }

  // ============================================================================
  // File Watching
  // ============================================================================

  private startWatching(): void {
    if (!this.transcriptPath) return

    // Guard against duplicate watcher creation
    if (this.watcher) {
      this.options.logger.debug('startWatching called but watcher already exists, skipping', {
        sessionId: this.sessionId,
      })
      return
    }

    this.watcher = chokidar.watch(this.transcriptPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.watchDebounceMs,
        pollInterval: 50,
      },
    })

    // Note: chokidar doesn't expose unref() - we rely on watcher.close() in shutdown()
    // to release the handle. Supervisor must call shutdown() before process exit.

    this.watcher.on('change', () => {
      this.options.logger.debug('File watcher detected change', { sessionId: this.sessionId })
      // Debounce file change events
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }
      this.debounceTimer = setTimeout(() => {
        this.processTranscriptFile().catch((err) => {
          this.options.logger.error('Error processing transcript file', { err, sessionId: this.sessionId })
        })
      }, this.options.watchDebounceMs)
    })

    this.watcher.on('error', (err) => {
      this.options.logger.error('File watcher error', { err, sessionId: this.sessionId })
    })
  }

  // ============================================================================
  // Transcript Processing
  // ============================================================================

  private processTranscriptFile(): Promise<void> {
    if (!this.transcriptPath || !existsSync(this.transcriptPath)) {
      return Promise.resolve()
    }

    const content = readFileSync(this.transcriptPath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim())

    // Note: Compaction detection is now done via compact_boundary entries in processEntry().
    // The transcript is append-only, so file-size-based detection doesn't work.

    // Process only new lines (incremental)
    const startLine = this.metrics.lastProcessedLine
    const newLineCount = lines.length - startLine
    this.options.logger.debug('processTranscriptFile called', {
      sessionId: this.sessionId,
      totalLines: lines.length,
      lastProcessedLine: startLine,
      newLinesToProcess: newLineCount,
    })
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]
      try {
        const entry = JSON.parse(line) as TranscriptEntry
        this.processEntry(entry, i + 1) // Line numbers are 1-indexed
      } catch {
        // Skip malformed lines
        this.options.logger.warn('Skipping malformed transcript line', { sessionId: this.sessionId, line: i + 1 })
      }
    }

    // Update watermark
    this.metrics.lastProcessedLine = lines.length
    this.metrics.lastUpdatedAt = Date.now()

    // Notify subscribers
    this.notifyMetricsChange()

    // Schedule debounced persistence
    this.schedulePersistence()
    return Promise.resolve()
  }

  /**
   * Process a single transcript entry and update metrics.
   * Emits corresponding TranscriptEvent after updating metrics.
   *
   * Real Claude Code transcripts structure:
   * - tool_use blocks are nested in assistant.message.content[]
   * - tool_result blocks are nested in user.message.content[]
   * - Other entry types (summary, file-history-snapshot) are skipped
   *
   * Messages that should NOT increment turnCount:
   * - tool_result wrappers (arrays containing only tool_result blocks)
   * - isMeta messages (disclaimer/caveat messages injected by Claude Code)
   * - local-command-stdout messages (output from slash commands like /context)
   */
  private processEntry(entry: TranscriptEntry, lineNumber: number): void {
    const entryType = entry.type as string | undefined

    switch (entryType) {
      case 'user': {
        // Check conditions that should NOT increment turnCount
        const isToolResultWrapper = this.isToolResultOnlyMessage(entry)
        const isMetaMessage = (entry as { isMeta?: boolean }).isMeta === true
        const isLocalCommandOutput = this.isLocalCommandStdoutMessage(entry)

        if (isToolResultWrapper || isMetaMessage || isLocalCommandOutput) {
          // Non-user-prompt message: increment messageCount but DON'T increment turnCount
          // This allows toolsThisTurn to accumulate across multiple tool calls
          this.metrics.messageCount++

          // Still emit UserPrompt for local command output (e.g., /context) so handlers can process it
          // Handlers that want to scrape /context output need to receive these events
          if (isLocalCommandOutput) {
            this.emitEvent('UserPrompt', entry, lineNumber)
          }
        } else {
          // Real user prompt: new turn, reset toolsThisTurn
          this.metrics.turnCount++
          this.metrics.messageCount++
          this.metrics.toolsThisTurn = 0
          this.updateToolsPerTurn()
          this.emitEvent('UserPrompt', entry, lineNumber)
        }

        // Process tool_result blocks nested in user message content
        this.processNestedToolResults(entry, lineNumber)
        break
      }

      case 'assistant':
        // Assistant message: increment messageCount, extract token usage
        this.metrics.messageCount++
        this.extractTokenUsage(entry)
        this.emitEvent('AssistantMessage', entry, lineNumber)

        // Process tool_use blocks nested in assistant message content
        this.processNestedToolUses(entry, lineNumber)
        break

      case 'system': {
        // Check for compact_boundary entry (indicates compaction occurred)
        const subtype = (entry as { subtype?: string }).subtype
        if (subtype === 'compact_boundary') {
          this.handleCompactBoundary(entry, lineNumber)
        }
        // Skip other system entry types
        break
      }

      // Skip other entry types (summary, file-history-snapshot, etc.)
    }
  }

  /**
   * Check if a user message contains ONLY tool_result blocks (no actual user text).
   * Tool result wrappers should not reset toolsThisTurn or increment turnCount.
   *
   * Real user prompts have:
   * - content as a string (plain text)
   * - content as array with 'text' blocks
   * - content as array with 'document' blocks (file uploads)
   *
   * Tool result wrappers have:
   * - content as array with ONLY 'tool_result' blocks
   */
  private isToolResultOnlyMessage(entry: TranscriptEntry): boolean {
    const message = entry.message as { content?: string | Array<{ type?: string }> } | undefined
    if (!message?.content) return false

    // String content = real user prompt
    if (typeof message.content === 'string') return false

    // Not an array = unknown format, treat as real user prompt
    if (!Array.isArray(message.content)) return false

    // Empty array = treat as real user prompt (edge case)
    if (message.content.length === 0) return false

    // Check if ALL blocks are tool_result type
    return message.content.every((block) => block.type === 'tool_result')
  }

  /**
   * Check if a user message is a local command stdout injection.
   * These are output from slash commands like /context, /clear, etc.
   * They should not increment turnCount as they're not actual user prompts.
   *
   * Local command stdout messages have string content containing <local-command-stdout>.
   */
  private isLocalCommandStdoutMessage(entry: TranscriptEntry): boolean {
    const message = entry.message as { content?: string } | undefined
    if (!message?.content) return false

    // Only check string content
    if (typeof message.content !== 'string') return false

    return message.content.includes('<local-command-stdout>')
  }

  /**
   * Process nested tool_use blocks inside assistant message content.
   * Real transcripts have: assistant.message.content[{type: 'tool_use', name: '...'}]
   */
  private processNestedToolUses(entry: TranscriptEntry, lineNumber: number): void {
    const message = entry.message as { content?: Array<{ type?: string; name?: string }> } | undefined
    if (!message?.content || !Array.isArray(message.content)) return

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        // Count the tool call (increment here so metrics are current when ToolCall event fires)
        this.metrics.toolCount++
        this.metrics.toolsThisTurn++
        this.updateToolsPerTurn()

        // Emit ToolCall event for each tool_use block
        // Create a synthetic entry for the event with the tool info
        const toolEntry: TranscriptEntry = {
          type: 'tool_use',
          name: block.name,
          ...block,
        }
        this.emitEvent('ToolCall', toolEntry, lineNumber)
      }
    }
  }

  /**
   * Process nested tool_result blocks inside user message content.
   * Real transcripts have: user.message.content[{type: 'tool_result', ...}]
   * Note: Tool counting happens in processNestedToolUses (on ToolCall), not here.
   */
  private processNestedToolResults(entry: TranscriptEntry, lineNumber: number): void {
    const message = entry.message as { content?: Array<{ type?: string; tool_use_id?: string }> } | undefined
    if (!message?.content || !Array.isArray(message.content)) return

    for (const block of message.content) {
      if (block.type === 'tool_result') {
        // Emit ToolResult event for each tool_result block
        const toolEntry: TranscriptEntry = {
          type: 'tool_result',
          ...block,
        }
        this.emitEvent('ToolResult', toolEntry, lineNumber)
      }
    }
  }

  /**
   * Handle compact_boundary entry detected in transcript.
   * Sets indeterminate state until next usage block arrives.
   */
  private handleCompactBoundary(entry: TranscriptEntry, lineNumber: number): void {
    const metadata = (entry as { compactMetadata?: { trigger?: string; preTokens?: number } }).compactMetadata

    this.options.logger.info('Compaction boundary detected in transcript', {
      sessionId: this.sessionId,
      lineNumber,
      trigger: metadata?.trigger,
      preTokens: metadata?.preTokens,
    })

    // Set indeterminate state - context size unknown until next API response
    this.metrics.currentContextTokens = null
    this.metrics.isPostCompactIndeterminate = true

    // Emit Compact event for handlers
    this.emitEvent('Compact', entry, lineNumber)
  }

  /**
   * Extract token usage from assistant message metadata.
   *
   * Token calculation per TOKEN_TRACKING_PLAN.md:
   * - currentContextTokens: input + cache_creation + cache_read (actual context window size)
   * - tokenUsage: cumulative totals including all cache tokens
   */
  private extractTokenUsage(entry: TranscriptEntry): void {
    const message = entry.message as { usage?: RawUsageMetadata; model?: string } | undefined
    if (!message?.usage) return

    const usage = message.usage
    const model = message.model

    // Extract all token fields
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0

    // Current context window size: all input tokens including cache
    // This represents the actual tokens in the context window for this request
    const contextWindowTokens = inputTokens + cacheCreationTokens + cacheReadTokens
    this.metrics.currentContextTokens = contextWindowTokens

    // Clear indeterminate state - we now have accurate context size
    this.metrics.isPostCompactIndeterminate = false

    // Cumulative usage (all tokens sent to model, for cost tracking)
    this.metrics.tokenUsage.inputTokens += inputTokens + cacheCreationTokens + cacheReadTokens
    this.metrics.tokenUsage.outputTokens += outputTokens
    this.metrics.tokenUsage.totalTokens += inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens

    // Cache metrics (for detailed breakdown)
    this.metrics.tokenUsage.cacheCreationInputTokens += cacheCreationTokens
    this.metrics.tokenUsage.cacheReadInputTokens += cacheReadTokens

    // Cache tiers
    if (usage.cache_creation) {
      this.metrics.tokenUsage.cacheTiers.ephemeral5mInputTokens += usage.cache_creation.ephemeral_5m_input_tokens ?? 0
      this.metrics.tokenUsage.cacheTiers.ephemeral1hInputTokens += usage.cache_creation.ephemeral_1h_input_tokens ?? 0
    }

    // Service tier tracking
    if (usage.service_tier) {
      const tier = usage.service_tier
      this.metrics.tokenUsage.serviceTierCounts[tier] = (this.metrics.tokenUsage.serviceTierCounts[tier] ?? 0) + 1
    }

    // Per-model breakdown
    if (model) {
      const modelStats = this.metrics.tokenUsage.byModel[model] ?? {
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
      }
      modelStats.inputTokens += inputTokens
      modelStats.outputTokens += outputTokens
      modelStats.requestCount++
      this.metrics.tokenUsage.byModel[model] = modelStats
    }
  }

  /**
   * Update the derived toolsPerTurn ratio.
   */
  private updateToolsPerTurn(): void {
    this.metrics.toolsPerTurn = this.metrics.turnCount > 0 ? this.metrics.toolCount / this.metrics.turnCount : 0
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  /**
   * Emit a transcript event to the handler registry.
   * Metrics are updated BEFORE emitting, so handlers see current state.
   */
  private emitEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): void {
    this.options.handlers.emitTranscriptEvent(eventType, entry, lineNumber)
  }

  // ============================================================================
  // Observable Notifications
  // ============================================================================

  private notifyMetricsChange(): void {
    const snapshot = this.deepCloneMetrics()

    // Notify all subscribers
    for (const callback of this.metricsCallbacks) {
      try {
        callback(snapshot)
      } catch (err) {
        this.options.logger.error('Error in metrics change callback', { err })
      }
    }

    // Check thresholds
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
  // Persistence
  // ============================================================================

  private schedulePersistence(): void {
    this.options.logger.debug('schedulePersistence called', {
      sessionId: this.sessionId,
      debounceMs: this.options.watchDebounceMs,
    })
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer)
    }
    this.persistDebounceTimer = setTimeout(() => {
      this.persistMetrics()
    }, this.options.watchDebounceMs) // Use same debounce as file watching
  }

  private persistMetrics(immediate = false): void {
    if (!this.sessionId) return

    const now = Date.now()
    const timeSinceLastPersist = now - this.lastPersistedAt
    // Skip if recently persisted (unless immediate)
    if (!immediate && timeSinceLastPersist < this.options.watchDebounceMs) {
      this.options.logger.debug('persistMetrics skipped (too recent)', {
        sessionId: this.sessionId,
        immediate,
        timeSinceLastPersist,
        threshold: this.options.watchDebounceMs,
      })
      return
    }

    this.options.logger.debug('persistMetrics writing', {
      sessionId: this.sessionId,
      immediate,
      timeSinceLastPersist,
    })

    const statePath = this.getMetricsStatePath()
    if (!statePath) return

    const stateDir = dirname(statePath)
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true })
    }

    const state: PersistedTranscriptState = {
      sessionId: this.sessionId,
      metrics: this.deepCloneMetrics(),
      persistedAt: now,
    }

    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2))
      this.lastPersistedAt = now
    } catch (err) {
      this.options.logger.error('Failed to persist transcript metrics', { err, statePath })
    }
  }

  private loadPersistedState(): TranscriptMetrics | null {
    const statePath = this.getMetricsStatePath()
    if (!statePath || !existsSync(statePath)) return null

    try {
      const content = readFileSync(statePath, 'utf-8')
      const state = JSON.parse(content) as PersistedTranscriptState

      // Verify session ID matches
      if (state.sessionId !== this.sessionId) {
        this.options.logger.warn('Session ID mismatch in persisted state', {
          expectedSessionId: this.sessionId,
          foundSessionId: state.sessionId,
        })
        return null
      }

      // Merge with defaults to ensure backward compatibility
      const defaults = createDefaultMetrics()

      // FIXME this complexity can go away
      // Handle old object format for backward compat migration
      // Old format: { inputTokens, outputTokens, totalTokens }
      // New format: number | null
      const rawContextTokens = state.metrics.currentContextTokens as unknown
      let currentContextTokens: number | null = null
      if (typeof rawContextTokens === 'number') {
        currentContextTokens = rawContextTokens
      } else if (rawContextTokens && typeof rawContextTokens === 'object') {
        currentContextTokens = (rawContextTokens as { totalTokens?: number }).totalTokens ?? null
      }

      const metrics = state.metrics

      return {
        ...defaults,
        ...metrics,
        tokenUsage: {
          ...defaults.tokenUsage,
          ...metrics.tokenUsage,
        },
        currentContextTokens,
        isPostCompactIndeterminate: metrics.isPostCompactIndeterminate ?? false,
      }
    } catch (err) {
      this.options.logger.warn('Failed to load persisted transcript state', { err, statePath })
      return null
    }
  }

  private getMetricsStatePath(): string | null {
    if (!this.sessionId) return null
    return join(this.options.stateDir, 'sessions', this.sessionId, 'state', 'transcript-metrics.json')
  }

  // ============================================================================
  // Compaction History Persistence
  // ============================================================================

  private persistCompactionHistory(): void {
    const historyPath = this.getCompactionHistoryPath()
    if (!historyPath) return

    const historyDir = dirname(historyPath)
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true })
    }

    try {
      writeFileSync(historyPath, JSON.stringify(this.compactionHistory, null, 2))
    } catch (err) {
      this.options.logger.error('Failed to persist compaction history', { err, historyPath })
    }
  }

  private loadCompactionHistory(): void {
    const historyPath = this.getCompactionHistoryPath()
    if (!historyPath || !existsSync(historyPath)) {
      this.compactionHistory = []
      return
    }

    try {
      const content = readFileSync(historyPath, 'utf-8')
      this.compactionHistory = JSON.parse(content) as CompactionEntry[]
    } catch (err) {
      this.options.logger.warn('Failed to load compaction history', { err, historyPath })
      this.compactionHistory = []
    }
  }

  private getCompactionHistoryPath(): string | null {
    if (!this.sessionId) return null
    return join(this.options.stateDir, 'sessions', this.sessionId, 'state', 'compaction-history.json')
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
