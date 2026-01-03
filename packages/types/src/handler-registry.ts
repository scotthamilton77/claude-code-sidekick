/**
 * Handler Registry Interface Definitions
 *
 * Unified handler registration API for processing both hook events and transcript events.
 * Handlers register with filters to specify which events they process.
 *
 * @see docs/design/flow.md §2.3 Handler Registration
 * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registry
 */

import type { HookName, HookEvent, TranscriptEventType, TranscriptEntry, SidekickEvent } from './events.js'

// ============================================================================
// Handler Filter
// ============================================================================

/**
 * Filter for hook events only.
 * Handler receives events for the specified hook names.
 */
export interface HookFilter {
  kind: 'hook'
  hooks: HookName[]
}

/**
 * Filter for transcript events only.
 * Handler receives events for the specified transcript event types.
 */
export interface TranscriptFilter {
  kind: 'transcript'
  eventTypes: TranscriptEventType[]
}

/**
 * Filter for all events (hook and transcript).
 * Use sparingly - most handlers should be specific.
 */
export interface AllFilter {
  kind: 'all'
}

/**
 * Discriminated union of handler filters.
 * Determines which events a handler receives.
 */
export type HandlerFilter = HookFilter | TranscriptFilter | AllFilter

// ============================================================================
// Handler Response Types
// ============================================================================

/**
 * Response structure for hook events.
 * Returned to Claude Code by the CLI.
 */
export interface HookResponse {
  /** Whether to block the action (PreToolUse, Stop) */
  blocking?: boolean
  /** Reason for blocking (shown to user/agent) */
  reason?: string
  /** Additional context to inject */
  additionalContext?: string
  /** User-facing message */
  userMessage?: string
}

/**
 * Result returned by event handlers.
 */
export interface HandlerResult {
  /** Response to return for hook events (ignored for transcript events) */
  response?: HookResponse
  /** If true, skip remaining handlers in the chain */
  stop?: boolean
}

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Context passed to handlers during execution.
 * This is a subset of RuntimeContext - the full context is defined in sidekick-core.
 * Using a generic type parameter allows handlers to receive the full RuntimeContext.
 */
export type HandlerContext = Record<string, unknown>

/**
 * Event handler function signature.
 * Handlers may return a result or void (for fire-and-forget).
 *
 * @template TContext - The context type (defaults to generic HandlerContext)
 */
export type EventHandler<TContext extends HandlerContext = HandlerContext> = (
  event: SidekickEvent,
  context: TContext
) => Promise<HandlerResult | void>

/**
 * Handler registration options.
 */
export interface HandlerRegistration<TContext extends HandlerContext = HandlerContext> {
  /** Unique handler identifier (e.g., 'reminders:stuck-detector') */
  id: string
  /** Execution priority (higher = runs first) */
  priority: number
  /** Filter determining which events this handler receives */
  filter: HandlerFilter
  /** The handler function */
  handler: EventHandler<TContext>
}

// ============================================================================
// Handler Registry Interface
// ============================================================================

/**
 * Registry for event handlers.
 * Manages handler registration and event dispatch.
 *
 * Processing model:
 * - Hook events: Handlers execute sequentially (must produce single response)
 * - Transcript events: Handlers execute concurrently (fire-and-forget)
 *
 * Error handling:
 * - Handlers should implement internal try/catch for graceful degradation
 * - Unhandled exceptions are logged by the framework; execution continues
 */
export interface HandlerRegistry {
  /**
   * Register an event handler.
   * Handlers are invoked in priority order (higher first).
   */
  register<TContext extends HandlerContext>(options: HandlerRegistration<TContext>): void

  /**
   * Invoke handlers for a hook event.
   * Executes matching handlers sequentially and returns aggregated response.
   *
   * @param hook - The hook name
   * @param event - The hook event
   * @returns Aggregated hook response
   */
  invokeHook(hook: HookName, event: HookEvent): Promise<HookResponse>

  /**
   * Emit a transcript event to matching handlers.
   * Executes matching handlers concurrently (fire-and-forget).
   *
   * @param eventType - The transcript event type
   * @param entry - Raw transcript entry
   * @param lineNumber - Line number in transcript file
   * @param isBulkProcessing - True when replaying historical transcript data
   */
  emitTranscriptEvent(
    eventType: TranscriptEventType,
    entry: TranscriptEntry,
    lineNumber: number,
    isBulkProcessing?: boolean
  ): void
}
