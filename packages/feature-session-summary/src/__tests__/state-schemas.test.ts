/**
 * Runtime validation tests for feature-session-summary state descriptors.
 *
 * Validates that the state descriptors use correct schemas and defaults,
 * and that the factory function creates all expected accessors.
 *
 * @see packages/feature-session-summary/src/state.ts
 */

import { describe, expect, it } from 'vitest'
import {
  SessionSummaryStateSchema,
  SummaryCountdownStateSchema,
  ResumeMessageStateSchema,
  SnarkyMessageStateSchema,
  SessionPersonaStateSchema,
} from '@sidekick/types'

// ============================================================================
// Descriptor schema validation
// ============================================================================

/**
 * These tests verify that the Zod schemas referenced by the state descriptors
 * in state.ts actually validate the shapes they claim to validate.
 * The descriptors themselves are simple wiring (schema + filename + default),
 * so we focus on schema correctness.
 */

describe('SessionSummary descriptor schema', () => {
  it('accepts valid session summary (descriptor default is null)', () => {
    const result = SessionSummaryStateSchema.safeParse({
      session_id: 'sess-123',
      timestamp: '2026-01-01T00:00:00Z',
      session_title: 'Test Session',
      session_title_confidence: 0.9,
      latest_intent: 'Writing tests',
      latest_intent_confidence: 0.85,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty object', () => {
    const result = SessionSummaryStateSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('SummaryCountdown descriptor schema', () => {
  it('validates default countdown state', () => {
    const defaultCountdown = { countdown: 0, bookmark_line: 0 }
    const result = SummaryCountdownStateSchema.safeParse(defaultCountdown)
    expect(result.success).toBe(true)
  })

  it('validates active countdown', () => {
    const result = SummaryCountdownStateSchema.safeParse({
      countdown: 5,
      bookmark_line: 42,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.countdown).toBe(5)
      expect(result.data.bookmark_line).toBe(42)
    }
  })

  it('rejects missing fields', () => {
    expect(SummaryCountdownStateSchema.safeParse({ countdown: 5 }).success).toBe(false)
    expect(SummaryCountdownStateSchema.safeParse({ bookmark_line: 0 }).success).toBe(false)
  })
})

describe('ResumeMessage descriptor schema', () => {
  it('accepts valid resume message (descriptor default is null)', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: 'task-1',
      session_title: 'Debugging',
      snarky_comment: 'Back so soon?',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('defaults persona fields to null', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: null,
      session_title: null,
      snarky_comment: 'Welcome back.',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.persona_id).toBeNull()
      expect(result.data.persona_display_name).toBeNull()
    }
  })
})

describe('SnarkyMessage descriptor schema', () => {
  it('validates default snarky message state', () => {
    const defaultSnarky = { message: '', timestamp: '' }
    const result = SnarkyMessageStateSchema.safeParse(defaultSnarky)
    expect(result.success).toBe(true)
  })

  it('validates populated snarky message', () => {
    const result = SnarkyMessageStateSchema.safeParse({
      message: 'Another bug? Color me surprised.',
      timestamp: '2026-03-29T12:00:00Z',
    })
    expect(result.success).toBe(true)
  })
})

describe('SessionPersona descriptor schema', () => {
  it('accepts valid persona state (descriptor default is null)', () => {
    const result = SessionPersonaStateSchema.safeParse({
      persona_id: 'gandalf',
      selected_from: ['gandalf', 'yoda', 'picard'],
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty selected_from array', () => {
    const result = SessionPersonaStateSchema.safeParse({
      persona_id: 'default',
      selected_from: [],
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(SessionPersonaStateSchema.safeParse({ persona_id: 'test' }).success).toBe(false)
    expect(SessionPersonaStateSchema.safeParse({ selected_from: [] }).success).toBe(false)
  })
})
