/**
 * Tests for runtime type guards in events.ts and context.ts
 *
 * These type guards are the primary runtime code in the types package.
 * Tests verify behavior (correct narrowing result) not implementation details.
 */

import { describe, expect, it } from 'vitest'
import {
  isHookEvent,
  isTranscriptEvent,
  isSessionStartEvent,
  isSessionEndEvent,
  isUserPromptSubmitEvent,
  isPreToolUseEvent,
  isPostToolUseEvent,
  isStopEvent,
  isPreCompactEvent,
  isLoggingEvent,
  isCLILoggingEvent,
  isDaemonLoggingEvent,
  isTranscriptLoggingEvent,
} from '../events.js'
import type { SidekickEvent, HookEvent, LoggingEvent } from '../events.js'
import { isCLIContext, isDaemonContext } from '../context.js'
import type { RuntimeContext } from '../context.js'

// ============================================================================
// Test Fixtures
// ============================================================================

const baseContext = {
  sessionId: 'test-session',
  timestamp: Date.now(),
}

function makeHookEvent(hook: string): HookEvent {
  return {
    kind: 'hook',
    hook,
    context: baseContext,
    payload: {},
  } as unknown as HookEvent
}

function makeTranscriptEvent(): SidekickEvent {
  return {
    kind: 'transcript',
    eventType: 'UserPrompt',
    context: baseContext,
    payload: { lineNumber: 1, entry: {} },
    metadata: {
      transcriptPath: '/p',
      metrics: {} as never,
    },
  } as SidekickEvent
}

function makeLoggingEvent(source: 'cli' | 'daemon' | 'transcript'): LoggingEvent {
  return {
    type: 'hook:received',
    time: Date.now(),
    source,
    context: { sessionId: 'test' },
    payload: { hook: 'SessionStart' },
  } as unknown as LoggingEvent
}

// ============================================================================
// SidekickEvent Type Guards
// ============================================================================

describe('isHookEvent', () => {
  it('returns true for hook events', () => {
    const event = makeHookEvent('SessionStart')
    expect(isHookEvent(event)).toBe(true)
  })

  it('returns false for transcript events', () => {
    const event = makeTranscriptEvent()
    expect(isHookEvent(event)).toBe(false)
  })
})

describe('isTranscriptEvent', () => {
  it('returns true for transcript events', () => {
    const event = makeTranscriptEvent()
    expect(isTranscriptEvent(event)).toBe(true)
  })

  it('returns false for hook events', () => {
    const event = makeHookEvent('SessionStart')
    expect(isTranscriptEvent(event)).toBe(false)
  })
})

// ============================================================================
// Hook-Specific Type Guards
// ============================================================================

describe('hook-specific type guards', () => {
  const guards = [
    { guard: isSessionStartEvent, hook: 'SessionStart' },
    { guard: isSessionEndEvent, hook: 'SessionEnd' },
    { guard: isUserPromptSubmitEvent, hook: 'UserPromptSubmit' },
    { guard: isPreToolUseEvent, hook: 'PreToolUse' },
    { guard: isPostToolUseEvent, hook: 'PostToolUse' },
    { guard: isStopEvent, hook: 'Stop' },
    { guard: isPreCompactEvent, hook: 'PreCompact' },
  ] as const

  for (const { guard, hook } of guards) {
    it(`${guard.name} returns true for ${hook} events`, () => {
      expect(guard(makeHookEvent(hook))).toBe(true)
    })

    it(`${guard.name} returns false for non-${hook} events`, () => {
      const otherHook = hook === 'SessionStart' ? 'SessionEnd' : 'SessionStart'
      expect(guard(makeHookEvent(otherHook))).toBe(false)
    })
  }
})

// ============================================================================
// Logging Event Type Guards
// ============================================================================

describe('isLoggingEvent', () => {
  it('returns true for valid logging event objects', () => {
    expect(isLoggingEvent(makeLoggingEvent('cli'))).toBe(true)
  })

  it('returns false for null', () => {
    expect(isLoggingEvent(null)).toBe(false)
  })

  it('returns false for non-objects', () => {
    expect(isLoggingEvent('string')).toBe(false)
    expect(isLoggingEvent(42)).toBe(false)
    expect(isLoggingEvent(undefined)).toBe(false)
  })

  it('returns false when required fields are missing', () => {
    expect(isLoggingEvent({ type: 'x', time: 1 })).toBe(false) // missing source, context, payload
    expect(isLoggingEvent({ type: 'x', time: 1, source: 'cli', context: {} })).toBe(false) // missing payload
  })

  it('returns true when all required fields present', () => {
    expect(isLoggingEvent({ type: 'x', time: 1, source: 'cli', context: {}, payload: {} })).toBe(true)
  })
})

describe('isCLILoggingEvent', () => {
  it('returns true for cli source', () => {
    expect(isCLILoggingEvent(makeLoggingEvent('cli'))).toBe(true)
  })

  it('returns false for daemon source', () => {
    expect(isCLILoggingEvent(makeLoggingEvent('daemon'))).toBe(false)
  })

  it('returns false for transcript source', () => {
    expect(isCLILoggingEvent(makeLoggingEvent('transcript'))).toBe(false)
  })
})

describe('isDaemonLoggingEvent', () => {
  it('returns true for daemon source', () => {
    expect(isDaemonLoggingEvent(makeLoggingEvent('daemon'))).toBe(true)
  })

  it('returns false for cli source', () => {
    expect(isDaemonLoggingEvent(makeLoggingEvent('cli'))).toBe(false)
  })
})

describe('isTranscriptLoggingEvent', () => {
  it('returns true for transcript source', () => {
    expect(isTranscriptLoggingEvent(makeLoggingEvent('transcript'))).toBe(true)
  })

  it('returns false for daemon source', () => {
    expect(isTranscriptLoggingEvent(makeLoggingEvent('daemon'))).toBe(false)
  })
})

// ============================================================================
// Context Type Guards
// ============================================================================

describe('isCLIContext', () => {
  it('returns true for cli role', () => {
    const ctx = { role: 'cli' } as RuntimeContext
    expect(isCLIContext(ctx)).toBe(true)
  })

  it('returns false for daemon role', () => {
    const ctx = { role: 'daemon' } as RuntimeContext
    expect(isCLIContext(ctx)).toBe(false)
  })
})

describe('isDaemonContext', () => {
  it('returns true for daemon role', () => {
    const ctx = { role: 'daemon' } as RuntimeContext
    expect(isDaemonContext(ctx)).toBe(true)
  })

  it('returns false for cli role', () => {
    const ctx = { role: 'cli' } as RuntimeContext
    expect(isDaemonContext(ctx)).toBe(false)
  })
})
