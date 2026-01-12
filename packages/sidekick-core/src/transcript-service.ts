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
// Constants
// ============================================================================

/**
 * Built-in Claude Code slash commands to exclude from transcript excerpts.
 *
 * These are filtered because they're session management, settings, or status queries
 * that don't provide meaningful context for session summary analysis. Custom commands
 * (not in this list) are preserved since their parameters may be task-relevant.
 *
 * Note: /rename is intentionally NOT excluded - the rename parameter can hint at
 * the session's purpose and help the summary analyzer infer a title.
 */
const EXCLUDED_BUILTIN_COMMANDS = new Set([
  '/add-dir',
  '/agents',
  '/bashes',
  '/bug',
  '/clear',
  '/compact',
  '/config',
  '/context',
  '/cost',
  '/doctor',
  '/exit',
  '/export',
  '/help',
  '/hooks',
  '/ide',
  '/init',
  '/install-github-app',
  '/login',
  '/logout',
  '/mcp',
  '/memory',
  '/model',
  '/output-style',
  '/permissions',
  '/plan',
  '/plugin',
  '/pr-comments',
  '/privacy-settings',
  '/release-notes',
  '/remote-env',
  '/resume',
  '/review',
  '/rewind',
  '/sandbox',
  '/security-review',
  '/stats',
  '/status',
  '/statusline',
  '/teleport',
  '/terminal-setup',
  '/theme',
  '/todos',
  '/usage',
  '/vim',
])

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

  /** Track whether we're in bulk processing mode (first-time transcript replay) */
  private isBulkProcessing = false

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

    // Extract flags for filtering system-generated messages
    const isMeta = (rawEntry as { isMeta?: boolean }).isMeta === true
    const isCompactSummary = (rawEntry as { isCompactSummary?: boolean }).isCompactSummary === true

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
          isMeta,
          isCompactSummary,
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
              isMeta,
              isCompactSummary,
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

  /**
   * Extract a filtered transcript excerpt for LLM analysis.
   *
   * FILTERING RULES (see packages/sidekick-core/AGENTS.md for full documentation):
   *
   * ALWAYS INCLUDED:
   * - User prompts (human text only, system injections stripped)
   * - Assistant responses (model text only)
   * - Summary entries (only if leafUuid references entry in excerpt)
   *
   * CONDITIONALLY INCLUDED (via options):
   * - Tool use/result: includeToolMessages (default: true for messages, false for outputs)
   * - Thinking blocks: includeAssistantThinking (default: false)
   *
   * ALWAYS EXCLUDED (no config override):
   * - File history snapshots (type: 'file-history-snapshot')
   * - System reminders (<system-reminder> in content)
   * - Hook feedback ('hook feedback:' in content)
   * - Meta messages (isMeta: true)
   * - Local command stdout (<local-command-stdout> in content)
   *
   * KEY BEHAVIOR: maxLines counts POST-FILTER lines, ensuring caller gets
   * N useful conversation lines, not N raw transcript entries.
   */
  getExcerpt(options: ExcerptOptions = {}): TranscriptExcerpt {
    const maxLines = options.maxLines ?? 80
    const bookmarkLine = options.bookmarkLine ?? 0
    const includeToolMessages = options.includeToolMessages ?? true
    const includeToolOutputs = options.includeToolOutputs ?? false
    const includeAssistantThinking = options.includeAssistantThinking ?? false

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
      const content = readFileSync(this.transcriptPath, 'utf-8').trim()
      // Handle empty files: ''.split('\n') returns [''] with length 1
      const lines = content === '' ? [] : content.split('\n')
      const totalLines = lines.length

      // Collect UUIDs from ALL lines to validate summary leafUuid references
      const knownUuids = new Set<string>()
      for (const line of lines) {
        const uuid = this.parseUuid(line)
        if (uuid) knownUuids.add(uuid)
      }

      const filterOptions = { includeToolMessages, includeToolOutputs, includeAssistantThinking }

      // POST-FILTER maxLines: Filter all lines first, then take the tail.
      // This ensures caller gets N useful lines, not N raw entries.
      // Process from bookmark (or start) to end, filter, then take last N.
      const startFromLine = bookmarkLine > 0 && bookmarkLine < totalLines ? bookmarkLine : 0
      const bookmarkApplied = bookmarkLine > 0 && bookmarkLine < totalLines

      // Filter lines from startFromLine to end
      const filteredLines: { lineNumber: number; formatted: string }[] = []
      for (let i = startFromLine; i < totalLines; i++) {
        const formatted = this.formatExcerptLine(lines[i], knownUuids, filterOptions)
        if (formatted !== null) {
          filteredLines.push({ lineNumber: i + 1, formatted }) // 1-indexed
        }
      }

      // Take the last maxLines from filtered results
      const tailFiltered = filteredLines.slice(-maxLines)
      const formattedContent = tailFiltered.map((l) => l.formatted).join('\n')

      return {
        content: formattedContent,
        lineCount: tailFiltered.length,
        startLine: tailFiltered.length > 0 ? tailFiltered[0].lineNumber : 0,
        endLine: tailFiltered.length > 0 ? tailFiltered[tailFiltered.length - 1].lineNumber : 0,
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

  /**
   * Safely parse UUID from a JSON line, returning null on failure.
   */
  private parseUuid(line: string): string | null {
    try {
      const entry = JSON.parse(line) as { uuid?: string }
      return entry.uuid ?? null
    } catch {
      return null
    }
  }

  /**
   * Format a single excerpt line based on entry type.
   * Returns null for lines that should be filtered out.
   *
   * FILTERING RULES (see packages/sidekick-core/AGENTS.md):
   *
   * ALWAYS EXCLUDED (return null, no placeholders):
   * - type: 'file-history-snapshot'
   * - isMeta: true
   * - Content containing <system-reminder>
   * - Content containing 'hook feedback:' (case-insensitive)
   * - Content containing <local-command-stdout>
   * - Built-in slash commands (see EXCLUDED_BUILTIN_COMMANDS)
   *   - Note: /rename is NOT excluded (helps infer session title)
   *   - Custom commands are preserved (may have task-relevant parameters)
   *
   * CONDITIONALLY EXCLUDED:
   * - type: 'tool_use' / 'tool_result' → unless includeToolMessages
   * - type: 'thinking' → unless includeAssistantThinking
   * - Nested tool_use/tool_result blocks → stripped from user/assistant messages
   *
   * For user/assistant messages, nested tool blocks are stripped and only
   * actual text content is extracted via extractTextContent().
   */
  private formatExcerptLine(
    line: string,
    knownUuids: Set<string>,
    options: {
      includeToolMessages: boolean
      includeToolOutputs: boolean
      includeAssistantThinking: boolean
    }
  ): string | null {
    try {
      const entry = JSON.parse(line) as {
        type?: string
        name?: string
        content?: string
        thinking?: string
        summary?: string
        leafUuid?: string
        isMeta?: boolean
        message?: { content?: unknown }
      }

      const entryType = entry.type ?? 'unknown'

      // ========================================================================
      // ALWAYS EXCLUDED: No config override for these
      // ========================================================================

      // File history snapshots - internal Claude Code bookkeeping
      if (entryType === 'file-history-snapshot') return null

      // Meta messages - system-injected disclaimers/caveats
      if (entry.isMeta === true) return null

      // Get raw content for system injection checks
      const rawContent = this.getRawContentString(entry)

      // System reminders - injected context, not user/assistant content
      if (rawContent && rawContent.includes('<system-reminder>')) return null

      // Hook feedback - sidekick system messages
      if (rawContent && /hook feedback:/i.test(rawContent)) return null

      // Local command stdout - slash command output, not conversation
      if (rawContent && rawContent.includes('<local-command-stdout>')) return null

      // Built-in slash commands - session management, settings, status queries
      // Custom commands are preserved since their parameters may be task-relevant
      // Note: /rename is intentionally NOT excluded (helps infer session title)
      if (this.isExcludedBuiltinCommand(rawContent)) return null

      // ========================================================================
      // ENTRY TYPE HANDLING
      // ========================================================================

      const messageContent = entry.message?.content ?? entry.content

      switch (entryType) {
        case 'user': {
          const text = this.extractTextContent(messageContent, options)
          if (!text || text.trim() === '') return null
          return `[USER]: ${text}`
        }

        case 'assistant': {
          const text = this.extractTextContent(messageContent, options)
          if (!text || text.trim() === '') return null
          return `[ASSISTANT]: ${text}`
        }

        case 'thinking':
          if (!options.includeAssistantThinking) return null
          return `[THINKING]: ${String(entry.thinking ?? entry.content ?? '').slice(0, 200)}`

        case 'tool_use':
          if (!options.includeToolMessages) return null
          return `[TOOL]: ${entry.name ?? 'unknown'}`

        case 'tool_result':
          // Return null (not placeholder) when excluded - no line at all
          if (!options.includeToolMessages) return null
          if (!options.includeToolOutputs) return null
          return `[RESULT]: ${JSON.stringify(entry).slice(0, 500)}`

        case 'summary':
          // Include only summaries that reference entries within this transcript
          if (!entry.leafUuid || !knownUuids.has(entry.leafUuid)) {
            return null
          }
          return `[SESSION_HINT]: ${entry.summary ?? ''}`

        default:
          // Unknown types are excluded to avoid noise
          return null
      }
    } catch {
      // Malformed JSON - exclude
      return null
    }
  }

  /**
   * Get raw content string from entry for system injection detection.
   */
  private getRawContentString(entry: { message?: { content?: unknown }; content?: unknown }): string | null {
    const content = entry.message?.content ?? entry.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      // Check all text blocks for system content
      const textParts: string[] = []
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          (block as { type: unknown }).type === 'text' &&
          'text' in block &&
          typeof (block as { text: unknown }).text === 'string'
        ) {
          textParts.push((block as { text: string }).text)
        }
      }
      return textParts.join(' ')
    }
    return null
  }

  /**
   * Check if content is a built-in slash command that should be excluded.
   *
   * Built-in commands are wrapped in <command-name>/cmd</command-name> tags.
   * Custom commands are preserved since their parameters may be task-relevant.
   *
   * @param content - Raw content string to check
   * @returns true if this is an excluded built-in command
   */
  private isExcludedBuiltinCommand(content: string | null): boolean {
    if (!content) return false

    // Match <command-name>/something</command-name> pattern
    const match = content.match(/<command-name>(\/[a-z-]+)<\/command-name>/i)
    if (!match) return false

    const command = match[1].toLowerCase()
    return EXCLUDED_BUILTIN_COMMANDS.has(command)
  }

  /**
   * Extract text content from message, filtering out tool/thinking blocks.
   *
   * For user/assistant messages with nested content blocks:
   * - text blocks: Always included
   * - tool_use blocks: Excluded (stripped entirely, no placeholder)
   * - tool_result blocks: Excluded (stripped entirely, no placeholder)
   * - thinking blocks: Excluded unless includeAssistantThinking
   *
   * Returns null if no text content remains after filtering.
   */
  private extractTextContent(
    content: unknown,
    options: { includeToolMessages: boolean; includeToolOutputs: boolean; includeAssistantThinking: boolean }
  ): string | null {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return null

    // Claude API content blocks: [{type: 'text', text: '...'}, {type: 'tool_use', ...}, etc.]
    const textParts: string[] = []

    for (const block of content as Array<{ type?: string; text?: string; thinking?: string; name?: string }>) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text)
      } else if (block.type === 'thinking' && options.includeAssistantThinking && block.thinking) {
        textParts.push(`(thinking: ${block.thinking.slice(0, 100)}...)`)
      }
      // tool_use and tool_result blocks are stripped entirely - no placeholders
    }

    const result = textParts.join(' ').trim()
    return result || null
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
    // to release the handle. Daemon must call shutdown() before process exit.

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

    // Detect bulk mode: first-time processing with historical data
    const isBulkStart = startLine === 0 && newLineCount > 0
    if (isBulkStart) {
      this.isBulkProcessing = true
      this.options.logger.info('Bulk processing started', {
        sessionId: this.sessionId,
        linesToProcess: newLineCount,
      })
    }

    this.options.logger.debug('processTranscriptFile called', {
      sessionId: this.sessionId,
      totalLines: lines.length,
      lastProcessedLine: startLine,
      newLinesToProcess: newLineCount,
      isBulkProcessing: this.isBulkProcessing,
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

    // Emit BulkProcessingComplete if we were in bulk mode
    if (isBulkStart && this.isBulkProcessing) {
      this.isBulkProcessing = false
      this.emitEvent('BulkProcessingComplete', {} as TranscriptEntry, lines.length)
      this.options.logger.info('Bulk processing complete', {
        sessionId: this.sessionId,
        totalLinesProcessed: lines.length,
      })
    }

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
    this.options.handlers.emitTranscriptEvent(eventType, entry, lineNumber, this.isBulkProcessing)
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
