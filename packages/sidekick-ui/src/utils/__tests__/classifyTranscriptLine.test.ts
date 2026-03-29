import { describe, it, expect } from 'vitest'
import { classifyLineCategory, matchesTranscriptFilter } from '../classifyTranscriptLine'
import type { TranscriptLine, TranscriptFilter, SidekickEventType } from '../../types'

/** Create a minimal TranscriptLine with specified overrides */
function makeLine(overrides: Partial<TranscriptLine>): TranscriptLine {
  return {
    id: 'test-line',
    timestamp: Date.now(),
    type: 'user-message',
    ...overrides,
  }
}

describe('classifyLineCategory', () => {
  describe('thinking-only assistant messages', () => {
    it('returns "thinking" for assistant with thinking but no content', () => {
      const line = makeLine({ type: 'assistant-message', thinking: 'reasoning...', content: undefined })
      expect(classifyLineCategory(line)).toBe('thinking')
    })

    it('returns "thinking" for assistant with thinking and empty string content', () => {
      // empty string is falsy, so thinking+no-content branch should apply
      const line = makeLine({ type: 'assistant-message', thinking: 'reasoning...', content: '' })
      expect(classifyLineCategory(line)).toBe('thinking')
    })

    it('returns "conversation" for assistant with both content and thinking', () => {
      const line = makeLine({ type: 'assistant-message', thinking: 'reasoning...', content: 'Hello!' })
      expect(classifyLineCategory(line)).toBe('conversation')
    })
  })

  describe('user-message subtypes', () => {
    it('returns "conversation" for prompt subtype', () => {
      const line = makeLine({ type: 'user-message', userSubtype: 'prompt' })
      expect(classifyLineCategory(line)).toBe('conversation')
    })

    it('returns "conversation" for command subtype', () => {
      const line = makeLine({ type: 'user-message', userSubtype: 'command' })
      expect(classifyLineCategory(line)).toBe('conversation')
    })

    it('returns "system" for system-injection subtype', () => {
      const line = makeLine({ type: 'user-message', userSubtype: 'system-injection' })
      expect(classifyLineCategory(line)).toBe('system')
    })

    it('returns "system" for skill-content subtype', () => {
      const line = makeLine({ type: 'user-message', userSubtype: 'skill-content' })
      expect(classifyLineCategory(line)).toBe('system')
    })

    it('returns "system" for user-message with no subtype', () => {
      const line = makeLine({ type: 'user-message' })
      expect(classifyLineCategory(line)).toBe('system')
    })
  })

  describe('assistant-message', () => {
    it('returns "conversation" for regular assistant message', () => {
      const line = makeLine({ type: 'assistant-message', content: 'Hello world' })
      expect(classifyLineCategory(line)).toBe('conversation')
    })
  })

  describe('tool types', () => {
    it('returns "tools" for tool-use', () => {
      const line = makeLine({ type: 'tool-use', toolName: 'Bash' })
      expect(classifyLineCategory(line)).toBe('tools')
    })

    it('returns "tools" for tool-result', () => {
      const line = makeLine({ type: 'tool-result', toolOutput: 'output' })
      expect(classifyLineCategory(line)).toBe('tools')
    })
  })

  describe('system types', () => {
    it('returns "system" for compaction', () => {
      expect(classifyLineCategory(makeLine({ type: 'compaction' }))).toBe('system')
    })

    it('returns "system" for turn-duration', () => {
      expect(classifyLineCategory(makeLine({ type: 'turn-duration' }))).toBe('system')
    })

    it('returns "system" for api-error', () => {
      expect(classifyLineCategory(makeLine({ type: 'api-error' }))).toBe('system')
    })

    it('returns "system" for pr-link', () => {
      expect(classifyLineCategory(makeLine({ type: 'pr-link' }))).toBe('system')
    })
  })

  describe('sidekick event types map to correct filters', () => {
    const sidekickMappings: [SidekickEventType, string][] = [
      ['reminder:staged', 'reminders'],
      ['reminder:unstaged', 'reminders'],
      ['reminder:consumed', 'reminders'],
      ['reminder:cleared', 'reminders'],
      ['decision:recorded', 'decisions'],
      ['session-summary:start', 'session-analysis'],
      ['session-summary:finish', 'session-analysis'],
      ['session-title:changed', 'session-analysis'],
      ['intent:changed', 'session-analysis'],
      ['snarky-message:start', 'session-analysis'],
      ['snarky-message:finish', 'session-analysis'],
      ['resume-message:start', 'session-analysis'],
      ['resume-message:finish', 'session-analysis'],
      ['persona:selected', 'decisions'],
      ['persona:changed', 'session-analysis'],
      ['statusline:rendered', 'statusline'],
      ['error:occurred', 'errors'],
      ['hook:received', 'hooks'],
      ['hook:completed', 'hooks'],
    ]

    for (const [type, expectedFilter] of sidekickMappings) {
      it(`maps "${type}" to "${expectedFilter}"`, () => {
        const line = makeLine({ type })
        expect(classifyLineCategory(line)).toBe(expectedFilter)
      })
    }
  })
})

describe('matchesTranscriptFilter', () => {
  it('returns true when line category is in the filter set', () => {
    const line = makeLine({ type: 'user-message', userSubtype: 'prompt' })
    const filters = new Set<TranscriptFilter>(['conversation'])
    expect(matchesTranscriptFilter(line, filters)).toBe(true)
  })

  it('returns false when line category is not in the filter set', () => {
    const line = makeLine({ type: 'user-message', userSubtype: 'prompt' })
    const filters = new Set<TranscriptFilter>(['tools'])
    expect(matchesTranscriptFilter(line, filters)).toBe(false)
  })

  describe('assistant with both content and thinking', () => {
    const dualLine = makeLine({
      type: 'assistant-message',
      thinking: 'reasoning...',
      content: 'Hello!',
    })

    it('matches when only "conversation" filter is active', () => {
      const filters = new Set<TranscriptFilter>(['conversation'])
      expect(matchesTranscriptFilter(dualLine, filters)).toBe(true)
    })

    it('matches when only "thinking" filter is active', () => {
      const filters = new Set<TranscriptFilter>(['thinking'])
      expect(matchesTranscriptFilter(dualLine, filters)).toBe(true)
    })

    it('matches when both filters are active', () => {
      const filters = new Set<TranscriptFilter>(['conversation', 'thinking'])
      expect(matchesTranscriptFilter(dualLine, filters)).toBe(true)
    })

    it('does not match when neither filter is active', () => {
      const filters = new Set<TranscriptFilter>(['tools', 'system'])
      expect(matchesTranscriptFilter(dualLine, filters)).toBe(false)
    })
  })

  it('matches tool-use when "tools" filter is active', () => {
    const line = makeLine({ type: 'tool-use', toolName: 'Bash' })
    const filters = new Set<TranscriptFilter>(['tools'])
    expect(matchesTranscriptFilter(line, filters)).toBe(true)
  })

  it('matches sidekick event when its category filter is active', () => {
    const line = makeLine({ type: 'reminder:staged' })
    const filters = new Set<TranscriptFilter>(['reminders'])
    expect(matchesTranscriptFilter(line, filters)).toBe(true)
  })

  it('does not match sidekick event when its category filter is inactive', () => {
    const line = makeLine({ type: 'error:occurred' })
    const filters = new Set<TranscriptFilter>(['reminders', 'tools'])
    expect(matchesTranscriptFilter(line, filters)).toBe(false)
  })

  it('returns false with empty filter set', () => {
    const line = makeLine({ type: 'assistant-message', content: 'Hi' })
    const filters = new Set<TranscriptFilter>()
    expect(matchesTranscriptFilter(line, filters)).toBe(false)
  })
})
