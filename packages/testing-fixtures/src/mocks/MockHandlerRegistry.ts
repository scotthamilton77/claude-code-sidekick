/**
 * Mock Handler Registry for Testing
 *
 * Provides a test double for HandlerRegistry that records registrations
 * and allows controlled invocation of handlers.
 *
 * @see docs/design/flow.md §2.3 Handler Registration
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
  HandlerContext,
} from '@sidekick/types'

/**
 * Recorded handler registration for test assertions.
 */
export interface RegisteredHandler {
  id: string
  priority: number
  filter: HandlerFilter
}

/**
 * Mock implementation of HandlerRegistry for testing.
 *
 * Features:
 * - Records all registrations for assertions
 * - Allows retrieving handlers by filter
 * - Provides controlled invocation for integration tests
 */
export class MockHandlerRegistry implements HandlerRegistry {
  private handlers: Map<string, HandlerRegistration<HandlerContext>> = new Map()
  private invokeHookCalls: Array<{ hook: HookName; event: HookEvent }> = []
  private emitTranscriptCalls: Array<{
    eventType: TranscriptEventType
    entry: TranscriptEntry
    lineNumber: number
  }> = []

  /** Default response for invokeHook when no handlers match */
  public defaultHookResponse: HookResponse = {}

  register<TContext extends HandlerContext>(options: HandlerRegistration<TContext>): void {
    this.handlers.set(options.id, options as HandlerRegistration<HandlerContext>)
  }

  invokeHook(hook: HookName, event: HookEvent): Promise<HookResponse> {
    this.invokeHookCalls.push({ hook, event })
    return Promise.resolve(this.defaultHookResponse)
  }

  emitTranscriptEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): void {
    this.emitTranscriptCalls.push({ eventType, entry, lineNumber })
  }

  // ========== Test helpers ==========

  /** Get all registered handler metadata for assertions */
  getRegistrations(): RegisteredHandler[] {
    return Array.from(this.handlers.values()).map((h) => ({
      id: h.id,
      priority: h.priority,
      filter: h.filter,
    }))
  }

  /** Get a specific registered handler by ID */
  getHandler(id: string): HandlerRegistration<HandlerContext> | undefined {
    return this.handlers.get(id)
  }

  /** Get handlers matching a specific filter kind */
  getHandlersByKind(kind: 'hook' | 'transcript' | 'all'): RegisteredHandler[] {
    return this.getRegistrations().filter((h) => h.filter.kind === kind)
  }

  /** Get handlers for a specific hook */
  getHandlersForHook(hook: HookName): RegisteredHandler[] {
    return this.getRegistrations().filter((h) => h.filter.kind === 'hook' && h.filter.hooks.includes(hook))
  }

  /** Get handlers for a specific transcript event type */
  getHandlersForTranscriptEvent(eventType: TranscriptEventType): RegisteredHandler[] {
    return this.getRegistrations().filter(
      (h) => h.filter.kind === 'transcript' && h.filter.eventTypes.includes(eventType)
    )
  }

  /** Get all invokeHook calls for assertions */
  getInvokeHookCalls(): Array<{ hook: HookName; event: HookEvent }> {
    return [...this.invokeHookCalls]
  }

  /** Get all emitTranscriptEvent calls for assertions */
  getEmitTranscriptCalls(): Array<{
    eventType: TranscriptEventType
    entry: TranscriptEntry
    lineNumber: number
  }> {
    return [...this.emitTranscriptCalls]
  }

  /** Clear all recorded state */
  reset(): void {
    this.handlers.clear()
    this.invokeHookCalls = []
    this.emitTranscriptCalls = []
    this.defaultHookResponse = {}
  }
}
