/**
 * Handler Registry Implementation
 *
 * Manages event handler registration and dispatch for both hook events
 * (from Claude Code) and transcript events (from file watching).
 *
 * Processing model:
 * - Hook events: Handlers execute sequentially (must produce single response)
 * - Transcript events: Handlers run concurrently within a single event,
 *   but events are serialized across lines (each line settles before the next)
 *
 * @see docs/design/flow.md §2.3 Handler Registration
 * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registry
 */

import type {
  HandlerRegistry,
  HandlerRegistration,
  HandlerFilter,
  HookName,
  HookEvent,
  HookResponse,
  TranscriptEventType,
  TranscriptEntry,
  TranscriptEvent,
  EventContext,
  HandlerContext,
  Logger,
  TranscriptMetrics,
  StagingService,
} from '@sidekick/types'
import { extractContentPreview } from './transcript-content.js'
import { LogEvents, logEvent } from './structured-logging.js'
import { toErrorMessage } from './error-utils.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a HandlerRegistryImpl.
 */
export interface HandlerRegistryOptions {
  /** Logger for observability */
  logger: Logger
  /** Session ID for event context */
  sessionId: string
  /** Transcript path for event metadata */
  transcriptPath?: string
  /** Function to get current metrics (for transcript events) */
  getMetrics?: () => TranscriptMetrics
  /** Function to get current staging service */
  getStaging?: () => StagingService
}

/**
 * Internal handler storage with typed handler function.
 */
interface StoredHandler {
  id: string
  priority: number
  filter: HandlerFilter
  handler: (event: unknown, context: HandlerContext) => Promise<unknown>
}

// ============================================================================
// HandlerRegistryImpl
// ============================================================================

/**
 * Implementation of HandlerRegistry.
 *
 * Handles registration and dispatch of event handlers with priority ordering
 * and filter matching.
 */
export class HandlerRegistryImpl implements HandlerRegistry {
  private handlers: StoredHandler[] = []
  private context: HandlerContext

  constructor(private readonly options: HandlerRegistryOptions) {
    // Build initial context from options - setContext() can replace with richer context
    this.context = {
      sessionId: options.sessionId,
      transcriptPath: options.transcriptPath,
    }
  }

  /**
   * Set the runtime context for handler invocation.
   * Must be called before invoking handlers.
   */
  setContext(context: HandlerContext): void {
    this.context = context
  }

  /**
   * Update session configuration (e.g., when transcript path becomes available).
   */
  updateSession(updates: { sessionId?: string; transcriptPath?: string }): void {
    if (updates.sessionId !== undefined) {
      ;(this.options as { sessionId: string }).sessionId = updates.sessionId
    }
    if (updates.transcriptPath !== undefined) {
      ;(this.options as { transcriptPath?: string }).transcriptPath = updates.transcriptPath
    }
  }

  /**
   * Set the metrics provider function for transcript events.
   * Called after TranscriptService is initialized.
   */
  setMetricsProvider(getMetrics: () => TranscriptMetrics): void {
    ;(this.options as { getMetrics?: () => TranscriptMetrics }).getMetrics = getMetrics
  }

  /**
   * Set the staging service provider function for reminder handlers.
   * Called after StagingService is initialized.
   *
   * @see docs/design/FEATURE-REMINDERS.md §4.1
   */
  setStagingProvider(getStaging: () => StagingService): void {
    ;(this.options as { getStaging?: () => StagingService }).getStaging = getStaging
  }

  // ============================================================================
  // Registration
  // ============================================================================

  register<TContext extends HandlerContext>(options: HandlerRegistration<TContext>): void {
    // Validate handler ID uniqueness
    if (this.handlers.some((h) => h.id === options.id)) {
      this.options.logger.warn('Handler already registered, replacing', { handlerId: options.id })
      this.handlers = this.handlers.filter((h) => h.id !== options.id)
    }

    this.handlers.push({
      id: options.id,
      priority: options.priority,
      filter: options.filter,
      handler: options.handler as StoredHandler['handler'],
    })

    // Sort by priority (higher first)
    this.handlers.sort((a, b) => b.priority - a.priority)

    this.options.logger.debug('Handler registered', {
      handlerId: options.id,
      priority: options.priority,
      filterKind: options.filter.kind,
    })
  }

  // ============================================================================
  // Hook Event Dispatch (Sequential)
  // ============================================================================

  async invokeHook(hook: HookName, event: HookEvent, options?: { logger?: Logger }): Promise<HookResponse> {
    const log = options?.logger ?? this.options.logger
    const matchingHandlers = this.getHandlersForHook(hook)

    if (matchingHandlers.length === 0) {
      log.debug('No handlers for hook', { hook })
      return {}
    }

    log.debug('Invoking hook handlers', {
      hook,
      handlerCount: matchingHandlers.length,
    })

    // Aggregate response from all handlers
    let aggregatedResponse: HookResponse = {}

    for (const handler of matchingHandlers) {
      const startTime = Date.now()
      try {
        const result = await handler.handler(event, this.context)
        const durationMs = Date.now() - startTime

        log.debug('Handler executed', {
          handlerId: handler.id,
          hook,
          durationMs,
          hasResponse: !!result,
        })

        // Merge response if provided
        if (result && typeof result === 'object' && 'response' in result) {
          const response = (result as { response?: HookResponse }).response
          if (response) {
            aggregatedResponse = this.mergeResponses(aggregatedResponse, response)
          }
        }

        // Check for stop flag
        if (result && typeof result === 'object' && 'stop' in result && (result as { stop?: boolean }).stop) {
          log.debug('Handler requested stop', { handlerId: handler.id })
          break
        }
      } catch (err) {
        // Log error but continue to next handler
        log.error('Handler execution failed', {
          handlerId: handler.id,
          hook,
          error: toErrorMessage(err),
        })
      }
    }

    return aggregatedResponse
  }

  // ============================================================================
  // Transcript Event Dispatch (Concurrent within event, serialized across events)
  // ============================================================================

  async emitTranscriptEvent(
    eventType: TranscriptEventType,
    entry: TranscriptEntry,
    lineNumber: number,
    isBulkProcessing = false
  ): Promise<void> {
    const matchingHandlers = this.getHandlersForTranscript(eventType)

    // Build transcript event (needed for logging even if no handlers)
    const event = this.buildTranscriptEvent(eventType, entry, lineNumber, isBulkProcessing)

    // Log TranscriptEventEmitted for timeline visibility
    const metrics = this.options.getMetrics?.()
    if (metrics) {
      logEvent(
        this.options.logger,
        LogEvents.transcriptEventEmitted(
          { sessionId: this.options.sessionId },
          {
            eventType,
            lineNumber,
            uuid: (entry as { uuid?: string }).uuid,
            toolName: (entry as { tool_name?: string }).tool_name,
          },
          {
            transcriptPath: this.options.transcriptPath ?? '',
            contentPreview: extractContentPreview(entry, eventType),
            metrics,
          }
        )
      )
    }

    if (matchingHandlers.length === 0) {
      return // No handlers, nothing to do
    }

    this.options.logger.debug('Emitting transcript event', {
      eventType,
      lineNumber,
      handlerCount: matchingHandlers.length,
    })

    // Run all matching handlers concurrently, await settlement before returning
    await Promise.all(matchingHandlers.map((h) => this.invokeTranscriptHandler(h, event)))
  }

  private async invokeTranscriptHandler(handler: StoredHandler, event: TranscriptEvent): Promise<void> {
    const startTime = Date.now()
    const logContext = {
      sessionId: this.options.sessionId,
    }

    try {
      await handler.handler(event, this.context)
      const durationMs = Date.now() - startTime

      // Log EventProcessed for successful handler execution
      logEvent(
        this.options.logger,
        LogEvents.eventProcessed(logContext, { handlerId: handler.id, success: true }, { durationMs })
      )
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMsg = toErrorMessage(err)

      // Log EventProcessed for failed handler execution
      logEvent(
        this.options.logger,
        LogEvents.eventProcessed(logContext, { handlerId: handler.id, success: false }, { durationMs, error: errorMsg })
      )

      this.options.logger.error('Transcript handler failed', {
        handlerId: handler.id,
        eventType: event.eventType,
        error: errorMsg,
      })
    }
  }

  // ============================================================================
  // Handler Filtering
  // ============================================================================

  private getHandlersForHook(hook: HookName): StoredHandler[] {
    return this.handlers.filter((h) => {
      if (h.filter.kind === 'all') return true
      if (h.filter.kind === 'hook') {
        return h.filter.hooks.includes(hook)
      }
      return false
    })
  }

  private getHandlersForTranscript(eventType: TranscriptEventType): StoredHandler[] {
    return this.handlers.filter((h) => {
      if (h.filter.kind === 'all') return true
      if (h.filter.kind === 'transcript') {
        return h.filter.eventTypes.includes(eventType)
      }
      return false
    })
  }

  // ============================================================================
  // Event Building
  // ============================================================================

  private buildTranscriptEvent(
    eventType: TranscriptEventType,
    entry: TranscriptEntry,
    lineNumber: number,
    isBulkProcessing = false
  ): TranscriptEvent {
    const context: EventContext = {
      sessionId: this.options.sessionId,
      timestamp: Date.now(),
    }

    // Get metrics snapshot if available
    const metrics = this.options.getMetrics?.() ?? this.createEmptyMetrics()

    return {
      kind: 'transcript',
      eventType,
      context,
      payload: {
        lineNumber,
        entry,
        content: this.extractContent(entry),
        toolName: this.extractToolName(entry),
      },
      metadata: {
        transcriptPath: this.options.transcriptPath ?? '',
        metrics,
        isBulkProcessing,
      },
    }
  }

  private extractContent(entry: TranscriptEntry): string | undefined {
    const message = entry.message as { content?: string | Array<{ text?: string }> } | undefined
    if (!message?.content) return undefined

    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      const textBlocks = message.content.filter((b) => typeof b === 'object' && b.text)
      return textBlocks.map((b) => b.text).join('\n')
    }

    return undefined
  }

  private extractToolName(entry: TranscriptEntry): string | undefined {
    if (entry.type === 'tool_use') {
      return (entry as { name?: string }).name
    }
    if (entry.type === 'tool_result') {
      return (entry as { tool_name?: string }).tool_name
    }
    return undefined
  }

  private createEmptyMetrics(): TranscriptMetrics {
    return {
      turnCount: 0,
      toolCount: 0,
      toolsThisTurn: 0,
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
        serviceTierCounts: {},
        byModel: {},
      },
      currentContextTokens: null,
      isPostCompactIndeterminate: false,
      toolsPerTurn: 0,
      lastProcessedLine: 0,
      lastUpdatedAt: 0,
    }
  }

  // ============================================================================
  // Response Merging
  // ============================================================================

  /**
   * Merge two hook responses. Later values override earlier ones,
   * except for additionalContext which is concatenated.
   */
  private mergeResponses(base: HookResponse, override: HookResponse): HookResponse {
    const merged: HookResponse = { ...base }

    if (override.blocking !== undefined) {
      merged.blocking = override.blocking
    }
    if (override.reason !== undefined) {
      merged.reason = override.reason
    }
    if (override.userMessage !== undefined) {
      merged.userMessage = override.userMessage
    }

    // Concatenate additionalContext
    if (override.additionalContext !== undefined) {
      merged.additionalContext = merged.additionalContext
        ? `${merged.additionalContext}\n\n${override.additionalContext}`
        : override.additionalContext
    }

    return merged
  }

  // ============================================================================
  // Introspection (for testing)
  // ============================================================================

  /**
   * Get count of registered handlers.
   */
  getHandlerCount(): number {
    return this.handlers.length
  }

  /**
   * Get handler IDs in priority order.
   */
  getHandlerIds(): string[] {
    return this.handlers.map((h) => h.id)
  }
}
