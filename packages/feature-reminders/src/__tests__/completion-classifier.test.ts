/**
 * Tests for completion classifier
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRealUserPromptContent,
  extractConversationContext,
  interpolatePrompt,
  parseResponse,
} from '../completion-classifier'
import { createMockDaemonContext, MockTranscriptService, MockLogger } from '@sidekick/testing-fixtures'
import type { DaemonContext, CanonicalTranscriptEntry } from '@sidekick/types'

describe('completion-classifier', () => {
  describe('isRealUserPromptContent', () => {
    describe('returns false for system-generated content', () => {
      it('rejects empty string', () => {
        expect(isRealUserPromptContent('')).toBe(false)
      })

      it('rejects whitespace-only', () => {
        expect(isRealUserPromptContent('   ')).toBe(false)
        expect(isRealUserPromptContent('\n\t')).toBe(false)
      })

      it('rejects warmup message (case-insensitive)', () => {
        expect(isRealUserPromptContent('warmup')).toBe(false)
        expect(isRealUserPromptContent('Warmup')).toBe(false)
        expect(isRealUserPromptContent('WARMUP')).toBe(false)
        expect(isRealUserPromptContent('  warmup  ')).toBe(false)
      })

      it('rejects command-name tags', () => {
        expect(isRealUserPromptContent('<command-name>/clear</command-name>')).toBe(false)
        expect(
          isRealUserPromptContent('<command-name>/context</command-name>\n<command-message>context</command-message>')
        ).toBe(false)
      })

      it('rejects command-message tags', () => {
        expect(isRealUserPromptContent('<command-message>clear</command-message>')).toBe(false)
      })

      it('rejects local-command-stdout', () => {
        expect(isRealUserPromptContent('<local-command-stdout>some output</local-command-stdout>')).toBe(false)
        expect(isRealUserPromptContent('<local-command-stdout></local-command-stdout>')).toBe(false)
      })
    })

    describe('returns true for real user prompts', () => {
      it('accepts simple prompts', () => {
        expect(isRealUserPromptContent('yes')).toBe(true)
        expect(isRealUserPromptContent('commit')).toBe(true)
        expect(isRealUserPromptContent('do it')).toBe(true)
      })

      it('accepts questions', () => {
        expect(isRealUserPromptContent('what is next?')).toBe(true)
        expect(isRealUserPromptContent('can you explain this?')).toBe(true)
      })

      it('accepts detailed instructions', () => {
        expect(isRealUserPromptContent('Please refactor the authentication module to use JWT tokens')).toBe(true)
        expect(isRealUserPromptContent('Fix the bug in the login flow where users get redirected incorrectly')).toBe(
          true
        )
      })

      it('accepts prompts with special characters', () => {
        expect(isRealUserPromptContent('Update the README.md file')).toBe(true)
        expect(isRealUserPromptContent('Add a TODO: comment here')).toBe(true)
      })

      it('does not filter user-pasted command output', () => {
        // User intentionally pasted content that looks like command tags mid-message
        expect(isRealUserPromptContent('I ran this command and got <command-name> in the output')).toBe(true)
      })
    })
  })

  describe('extractConversationContext', () => {
    let ctx: DaemonContext
    let transcript: MockTranscriptService
    let logger: MockLogger

    beforeEach(() => {
      transcript = new MockTranscriptService()
      logger = new MockLogger()
      ctx = createMockDaemonContext({ transcript, logger })
    })

    function createEntry(
      role: 'user' | 'assistant',
      content: string,
      options: { isMeta?: boolean; isCompactSummary?: boolean; type?: 'text' | 'tool_use' | 'tool_result' } = {}
    ): CanonicalTranscriptEntry {
      return {
        id: `entry-${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        role,
        type: options.type ?? 'text',
        content,
        metadata: {
          provider: 'claude',
          lineNumber: 1,
          isMeta: options.isMeta ?? false,
          isCompactSummary: options.isCompactSummary ?? false,
        },
      }
    }

    it('returns null for both when transcript is empty', () => {
      transcript.setMockEntries([])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBeNull()
      expect(result.lastAssistantMessage).toBeNull()
    })

    it('extracts last user prompt and assistant message', () => {
      transcript.setMockEntries([
        createEntry('user', 'First user message'),
        createEntry('assistant', 'First assistant response'),
        createEntry('user', 'Second user message'),
        createEntry('assistant', 'Second assistant response'),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Second user message')
      expect(result.lastAssistantMessage).toBe('Second assistant response')
    })

    it('skips entries with isMeta: true', () => {
      transcript.setMockEntries([
        createEntry('user', 'Real user message'),
        createEntry('assistant', 'Assistant response'),
        createEntry('user', 'Caveat: system message', { isMeta: true }),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Real user message')
    })

    it('skips entries with isCompactSummary: true', () => {
      transcript.setMockEntries([
        createEntry('user', 'Real user message'),
        createEntry('assistant', 'Assistant response'),
        createEntry('user', 'This session is being continued...', { isCompactSummary: true }),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Real user message')
    })

    it('skips tool_use and tool_result entries', () => {
      transcript.setMockEntries([
        createEntry('user', 'Real user message'),
        createEntry('assistant', 'I will use a tool', { type: 'text' }),
        createEntry('assistant', '{"name": "Read"}', { type: 'tool_use' }),
        createEntry('user', '{"content": "file contents"}', { type: 'tool_result' }),
        createEntry('assistant', 'Here is what I found'),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Real user message')
      expect(result.lastAssistantMessage).toBe('Here is what I found')
    })

    it('skips warmup messages', () => {
      transcript.setMockEntries([
        createEntry('user', 'warmup'),
        createEntry('assistant', 'Warmup response'),
        createEntry('user', 'Actual user message'),
        createEntry('assistant', 'Actual response'),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Actual user message')
      expect(result.lastAssistantMessage).toBe('Actual response')
    })

    it('skips command invocations', () => {
      transcript.setMockEntries([
        createEntry('user', 'Real user message'),
        createEntry('assistant', 'Response'),
        createEntry('user', '<command-name>/clear</command-name>'),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Real user message')
    })

    it('skips local command stdout', () => {
      transcript.setMockEntries([
        createEntry('user', 'Real user message'),
        createEntry('assistant', 'Response'),
        createEntry('user', '<local-command-stdout>output</local-command-stdout>'),
      ])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Real user message')
    })

    it('handles case where only assistant messages exist', () => {
      transcript.setMockEntries([createEntry('user', 'warmup'), createEntry('assistant', 'I am ready to help')])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBeNull()
      expect(result.lastAssistantMessage).toBe('I am ready to help')
    })

    it('handles case where only user messages exist', () => {
      transcript.setMockEntries([createEntry('user', 'Hello there')])

      const result = extractConversationContext(ctx)

      expect(result.lastUserPrompt).toBe('Hello there')
      expect(result.lastAssistantMessage).toBeNull()
    })
  })

  describe('interpolatePrompt', () => {
    it('replaces lastUserPrompt placeholder', () => {
      const template = 'User said: {{lastUserPrompt}}'
      const context = { lastUserPrompt: 'Hello world', lastAssistantMessage: null }

      expect(interpolatePrompt(template, context)).toBe('User said: Hello world')
    })

    it('replaces lastAssistantMessage placeholder', () => {
      const template = 'Assistant said: {{lastAssistantMessage}}'
      const context = { lastUserPrompt: null, lastAssistantMessage: 'I can help' }

      expect(interpolatePrompt(template, context)).toBe('Assistant said: I can help')
    })

    it('replaces both placeholders', () => {
      const template = 'User: {{lastUserPrompt}}\nAssistant: {{lastAssistantMessage}}'
      const context = { lastUserPrompt: 'What is 2+2?', lastAssistantMessage: 'The answer is 4.' }

      expect(interpolatePrompt(template, context)).toBe('User: What is 2+2?\nAssistant: The answer is 4.')
    })

    it('replaces multiple occurrences of same placeholder', () => {
      const template = '{{lastUserPrompt}} - {{lastUserPrompt}}'
      const context = { lastUserPrompt: 'repeat', lastAssistantMessage: null }

      expect(interpolatePrompt(template, context)).toBe('repeat - repeat')
    })

    it('uses fallback for null lastUserPrompt', () => {
      const template = 'User: {{lastUserPrompt}}'
      const context = { lastUserPrompt: null, lastAssistantMessage: null }

      expect(interpolatePrompt(template, context)).toBe('User: (no user prompt found)')
    })

    it('uses fallback for null lastAssistantMessage', () => {
      const template = 'Assistant: {{lastAssistantMessage}}'
      const context = { lastUserPrompt: null, lastAssistantMessage: null }

      expect(interpolatePrompt(template, context)).toBe('Assistant: (no assistant message found)')
    })
  })

  describe('parseResponse', () => {
    it('parses valid JSON response', () => {
      const content = JSON.stringify({
        category: 'CLAIMING_COMPLETION',
        confidence: 0.9,
        reasoning: 'The assistant says it is done',
      })

      const result = parseResponse(content)

      expect(result).toEqual({
        category: 'CLAIMING_COMPLETION',
        confidence: 0.9,
        reasoning: 'The assistant says it is done',
      })
    })

    it('parses JSON wrapped in markdown code block', () => {
      const content = `Here is the classification:
\`\`\`json
{
  "category": "ASKING_QUESTION",
  "confidence": 0.85,
  "reasoning": "The assistant is asking for clarification"
}
\`\`\`
`

      const result = parseResponse(content)

      expect(result).toEqual({
        category: 'ASKING_QUESTION',
        confidence: 0.85,
        reasoning: 'The assistant is asking for clarification',
      })
    })

    it('parses JSON wrapped in plain markdown code block (no json specifier)', () => {
      const content = `\`\`\`
{"category": "OTHER", "confidence": 0.5, "reasoning": "Unclear intent"}
\`\`\``

      const result = parseResponse(content)

      expect(result).toEqual({
        category: 'OTHER',
        confidence: 0.5,
        reasoning: 'Unclear intent',
      })
    })

    it('returns null for invalid JSON', () => {
      const content = 'not valid json {'

      expect(parseResponse(content)).toBeNull()
    })

    it('returns null for empty content', () => {
      expect(parseResponse('')).toBeNull()
    })

    it('returns null for missing required fields', () => {
      const content = JSON.stringify({
        category: 'CLAIMING_COMPLETION',
        // missing confidence and reasoning
      })

      expect(parseResponse(content)).toBeNull()
    })

    it('returns null for invalid category', () => {
      const content = JSON.stringify({
        category: 'INVALID_CATEGORY',
        confidence: 0.9,
        reasoning: 'test',
      })

      expect(parseResponse(content)).toBeNull()
    })

    it('returns null for confidence out of range', () => {
      const content = JSON.stringify({
        category: 'CLAIMING_COMPLETION',
        confidence: 1.5, // > 1
        reasoning: 'test',
      })

      expect(parseResponse(content)).toBeNull()
    })

    it.each(['CLAIMING_COMPLETION', 'ASKING_QUESTION', 'ANSWERING_QUESTION', 'OTHER'] as const)(
      'accepts valid category: %s',
      (category) => {
        const content = JSON.stringify({
          category,
          confidence: 0.7,
          reasoning: 'Test reasoning',
        })

        const result = parseResponse(content)

        expect(result?.category).toBe(category)
      }
    )
  })
})
