/**
 * Filter Parser Tests
 *
 * Tests for filter query parsing and event matching against displayed content.
 */

import { describe, it, expect } from 'vitest'
import { parseFilterQuery, compileFilter, filterEvents } from '../filter-parser'
import type { UIEvent, ReminderData, SummaryData, DecisionData } from '../../types'

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockEvent = (overrides: Partial<UIEvent>): UIEvent => ({
  id: 1,
  time: '10:00:00',
  type: 'state',
  label: 'Test Event',
  content: 'Test content',
  source: 'supervisor',
  ...overrides,
})

// ============================================================================
// Parsing Tests
// ============================================================================

describe('parseFilterQuery', () => {
  it('should parse kind filters', () => {
    const tokens = parseFilterQuery('kind:hook kind:transcript')
    expect(tokens).toEqual([
      { type: 'kind', value: 'hook' },
      { type: 'kind', value: 'transcript' },
    ])
  })

  it('should parse type filters', () => {
    const tokens = parseFilterQuery('type:ReminderStaged')
    expect(tokens).toEqual([{ type: 'eventType', value: 'ReminderStaged' }])
  })

  it('should parse hook filters', () => {
    const tokens = parseFilterQuery('hook:UserPromptSubmit')
    expect(tokens).toEqual([{ type: 'hook', value: 'UserPromptSubmit' }])
  })

  it('should parse source filters', () => {
    const tokens = parseFilterQuery('source:cli source:supervisor')
    expect(tokens).toEqual([
      { type: 'source', value: 'cli' },
      { type: 'source', value: 'supervisor' },
    ])
  })

  it('should parse free text as text tokens', () => {
    const tokens = parseFilterQuery('hello world')
    expect(tokens).toEqual([
      { type: 'text', value: 'hello' },
      { type: 'text', value: 'world' },
    ])
  })

  it('should handle mixed filters and text', () => {
    const tokens = parseFilterQuery('kind:hook error message')
    expect(tokens).toEqual([
      { type: 'kind', value: 'hook' },
      { type: 'text', value: 'error' },
      { type: 'text', value: 'message' },
    ])
  })

  it('should handle quoted strings', () => {
    const tokens = parseFilterQuery('"error message" single')
    expect(tokens).toEqual([
      { type: 'text', value: 'error message' },
      { type: 'text', value: 'single' },
    ])
  })

  it('should treat invalid kind values as text', () => {
    const tokens = parseFilterQuery('kind:invalid')
    expect(tokens).toEqual([{ type: 'text', value: 'kind:invalid' }])
  })

  it('should treat empty prefix values as text', () => {
    const tokens = parseFilterQuery('kind:')
    expect(tokens).toEqual([{ type: 'text', value: 'kind:' }])
  })
})

// ============================================================================
// Event Matching Tests - Basic Fields
// ============================================================================

describe('compileFilter - basic field matching', () => {
  it('should match against event label (case-insensitive)', () => {
    const filter = compileFilter('reminder')
    const event = createMockEvent({ label: 'Reminder Staged', content: 'some content' })
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against event content (case-insensitive)', () => {
    const filter = compileFilter('fixing')
    const event = createMockEvent({ label: 'User message', content: 'Fixing the auth bug' })
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should not match when text not found', () => {
    const filter = compileFilter('error')
    const event = createMockEvent({ label: 'Summary Updated', content: 'Session is active' })
    expect(filter.matchEvent(event)).toBe(false)
  })

  it('should match case-insensitively', () => {
    const filter = compileFilter('ERROR')
    const event = createMockEvent({ content: 'Error occurred' })
    expect(filter.matchEvent(event)).toBe(true)
  })
})

// ============================================================================
// Event Matching Tests - Structured Payload Fields
// ============================================================================

describe('compileFilter - reminderData matching', () => {
  it('should match against reminderName', () => {
    const reminderData: ReminderData = {
      action: 'staged',
      reminderName: 'AreYouStuckReminder',
      hookName: 'UserPromptSubmit',
      blocking: false,
      priority: 5,
      persistent: true,
    }
    const event = createMockEvent({
      type: 'reminder',
      label: 'Reminder Staged',
      reminderData,
    })

    const filter = compileFilter('stuck')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against hookName in reminderData', () => {
    const reminderData: ReminderData = {
      action: 'consumed',
      reminderName: 'TestReminder',
      hookName: 'PreToolUse',
    }
    const event = createMockEvent({
      type: 'reminder',
      label: 'Reminder Consumed',
      reminderData,
    })

    const filter = compileFilter('pretooluse')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against reminder action', () => {
    const reminderData: ReminderData = {
      action: 'cleared',
      clearedCount: 3,
    }
    const event = createMockEvent({
      type: 'reminder',
      label: 'Reminders Cleared',
      reminderData,
    })

    const filter = compileFilter('cleared')
    expect(filter.matchEvent(event)).toBe(true)
  })
})

describe('compileFilter - summaryData matching', () => {
  it('should match against sessionTitle', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'user_prompt_forced',
      sessionTitle: 'Auth Bug Fix Session',
      titleConfidence: 0.95,
      latestIntent: 'Fix authentication',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Summary Updated',
      summaryData,
    })

    const filter = compileFilter('auth')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against latestIntent', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'countdown_reached',
      sessionTitle: 'Session',
      latestIntent: 'Implementing payment gateway',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Summary Updated',
      summaryData,
    })

    const filter = compileFilter('payment')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against oldTitle', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'user_prompt_forced',
      sessionTitle: 'New Title',
      oldTitle: 'Previous debugging session',
      latestIntent: 'Debug',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Summary Updated',
      summaryData,
    })

    const filter = compileFilter('debugging')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against oldIntent', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'countdown_reached',
      sessionTitle: 'Session',
      latestIntent: 'New intent',
      oldIntent: 'Refactor codebase',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Summary Updated',
      summaryData,
    })

    const filter = compileFilter('refactor')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against reason', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'compaction_reset',
      sessionTitle: 'Session',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Summary Updated',
      summaryData,
    })

    const filter = compileFilter('compaction')
    expect(filter.matchEvent(event)).toBe(true)
  })
})

describe('compileFilter - decisionData matching', () => {
  it('should match against decision category', () => {
    const decisionData: DecisionData = {
      category: 'context_prune',
    }
    const event = createMockEvent({
      type: 'decision',
      label: 'Context Pruned',
      decisionData,
    })

    const filter = compileFilter('prune')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against handlerId', () => {
    const decisionData: DecisionData = {
      category: 'handler',
      handlerId: 'session-summary:update',
      success: true,
      durationMs: 45,
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Handler Executed',
      decisionData,
    })

    const filter = compileFilter('session-summary')
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should match against error message', () => {
    const decisionData: DecisionData = {
      category: 'handler',
      handlerId: 'test-handler',
      success: false,
      error: 'Network timeout occurred',
    }
    const event = createMockEvent({
      type: 'state',
      label: 'Handler Failed',
      decisionData,
    })

    const filter = compileFilter('timeout')
    expect(filter.matchEvent(event)).toBe(true)
  })
})

// ============================================================================
// Combined Filter Tests
// ============================================================================

describe('compileFilter - combined filters', () => {
  it('should apply AND logic across multiple tokens', () => {
    const filter = compileFilter('auth fix')
    const event1 = createMockEvent({ content: 'Fixing the auth bug' })
    const event2 = createMockEvent({ content: 'Fixing the display' })
    const event3 = createMockEvent({ content: 'Auth system working' })

    expect(filter.matchEvent(event1)).toBe(true) // has both
    expect(filter.matchEvent(event2)).toBe(false) // missing 'auth'
    expect(filter.matchEvent(event3)).toBe(false) // missing 'fix'
  })

  it('should combine kind filter with text search', () => {
    const filter = compileFilter('kind:internal summary')

    const event1 = createMockEvent({
      type: 'state',
      source: 'supervisor',
      label: 'Summary Updated',
    })

    const event2 = createMockEvent({
      type: 'user',
      source: 'cli',
      label: 'User message',
      content: 'Update the summary',
    })

    // event1: internal kind + has 'summary' in label
    expect(filter.matchEvent(event1)).toBe(true)

    // event2: not internal (it's from cli/user), even though has 'summary'
    expect(filter.matchEvent(event2)).toBe(false)
  })

  it('should filter array of events correctly', () => {
    const events: UIEvent[] = [
      createMockEvent({ id: 1, label: 'User message', content: 'Fix auth' }),
      createMockEvent({ id: 2, label: 'Summary Updated', content: 'Session active' }),
      createMockEvent({
        id: 3,
        label: 'Reminder Staged',
        reminderData: { action: 'staged', reminderName: 'AuthCheckReminder' },
      }),
      createMockEvent({ id: 4, label: 'Handler Executed', content: 'Completed' }),
    ]

    const filtered = filterEvents(events, 'auth')
    expect(filtered).toHaveLength(2)
    expect(filtered[0].id).toBe(1) // matches content
    expect(filtered[1].id).toBe(3) // matches reminderName
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('compileFilter - edge cases', () => {
  it('should handle empty query (match all)', () => {
    const filter = compileFilter('')
    const event = createMockEvent({})
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should handle whitespace-only query (match all)', () => {
    const filter = compileFilter('   ')
    const event = createMockEvent({})
    expect(filter.matchEvent(event)).toBe(true)
  })

  it('should handle events without optional fields', () => {
    const filter = compileFilter('nonexistent')
    const event = createMockEvent({
      label: 'Simple Event',
      content: undefined,
      reminderData: undefined,
      summaryData: undefined,
      decisionData: undefined,
    })
    expect(filter.matchEvent(event)).toBe(false)
  })

  it('should handle partial matches in structured data', () => {
    const summaryData: SummaryData = {
      action: 'updated',
      reason: 'countdown_reached',
      sessionTitle: 'Authentication System Refactor',
    }
    const event = createMockEvent({ summaryData })

    // Partial matches should work
    expect(compileFilter('authen').matchEvent(event)).toBe(true)
    expect(compileFilter('refact').matchEvent(event)).toBe(true)
    expect(compileFilter('system').matchEvent(event)).toBe(true)
  })
})
