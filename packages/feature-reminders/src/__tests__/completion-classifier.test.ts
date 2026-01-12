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
  classifyCompletion,
} from '../completion-classifier'
import {
  createMockDaemonContext,
  MockTranscriptService,
  MockLogger,
  MockLLMService,
  MockAssetResolver,
} from '@sidekick/testing-fixtures'
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

  describe('classifyCompletion', () => {
    let ctx: DaemonContext
    let transcript: MockTranscriptService
    let logger: MockLogger
    let llm: MockLLMService
    let assets: MockAssetResolver

    beforeEach(() => {
      transcript = new MockTranscriptService()
      logger = new MockLogger()
      llm = new MockLLMService()
      assets = new MockAssetResolver()

      // Register required assets
      assets.register(
        'prompts/completion-classifier.prompt.txt',
        'User: {{lastUserPrompt}}\nAssistant: {{lastAssistantMessage}}'
      )
      assets.register(
        'schemas/completion-classifier.schema.json',
        JSON.stringify({
          type: 'object',
          properties: {
            category: { type: 'string' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
        })
      )

      ctx = createMockDaemonContext({ transcript, logger, llm, assets })
    })

    function createEntry(role: 'user' | 'assistant', content: string): CanonicalTranscriptEntry {
      return {
        id: `entry-${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        role,
        type: 'text',
        content,
        metadata: {
          provider: 'claude',
          lineNumber: 1,
          isMeta: false,
          isCompactSummary: false,
        },
      }
    }

    it('returns default result when classification is disabled', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Do the thing'),
        createEntry('assistant', 'I have completed the task.'),
      ])

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: false, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(result.classification.reasoning).toContain('unavailable')
      expect(logger.wasLogged('Completion classification disabled - defaulting to block')).toBe(true)
    })

    it('returns default result when no assistant message found', async () => {
      transcript.setMockEntries([createEntry('user', 'Hello')])

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(logger.wasLogged('No assistant message found in transcript - defaulting to block')).toBe(true)
    })

    it('returns default result when prompt template not found', async () => {
      assets.reset() // Remove all assets
      transcript.setMockEntries([createEntry('user', 'Do something'), createEntry('assistant', 'Done!')])

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(logger.wasLoggedAtLevel('Failed to load completion classifier prompt template', 'error')).toBe(true)
    })

    it('classifies CLAIMING_COMPLETION and blocks when confidence exceeds threshold', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Fix the bug'),
        createEntry('assistant', 'I have fixed the bug. The task is complete.'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'CLAIMING_COMPLETION',
          confidence: 0.95,
          reasoning: 'The assistant explicitly states the task is complete',
        })
      )

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(result.classification.category).toBe('CLAIMING_COMPLETION')
      expect(result.classification.confidence).toBe(0.95)
    })

    it('does not block CLAIMING_COMPLETION when confidence below threshold', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Fix the bug'),
        createEntry('assistant', 'I think that should work.'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'CLAIMING_COMPLETION',
          confidence: 0.5,
          reasoning: 'Weak claim of completion',
        })
      )

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(false)
    })

    it('does not block ASKING_QUESTION', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Fix the bug'),
        createEntry('assistant', 'Which bug would you like me to fix?'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'ASKING_QUESTION',
          confidence: 0.9,
          reasoning: 'The assistant is asking for clarification',
        })
      )

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(false)
      expect(result.classification.category).toBe('ASKING_QUESTION')
      expect(result.userMessage).toBeUndefined()
    })

    it('does not block ANSWERING_QUESTION', async () => {
      transcript.setMockEntries([
        createEntry('user', 'What is TypeScript?'),
        createEntry('assistant', 'TypeScript is a typed superset of JavaScript.'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'ANSWERING_QUESTION',
          confidence: 0.85,
          reasoning: 'The assistant is answering an informational question',
        })
      )

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(false)
      expect(result.classification.category).toBe('ANSWERING_QUESTION')
      expect(result.userMessage).toBeUndefined()
    })

    it('returns warning message for OTHER category', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Do the thing'),
        createEntry('assistant', 'Here is some output...'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'OTHER',
          confidence: 0.6,
          reasoning: 'Unclear stopping intent',
        })
      )

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(false)
      expect(result.classification.category).toBe('OTHER')
      expect(result.userMessage).toContain('trust but verify')
    })

    it('returns default result when LLM response cannot be parsed', async () => {
      transcript.setMockEntries([createEntry('user', 'Do something'), createEntry('assistant', 'Done')])

      llm.queueResponse('This is not valid JSON')

      const result = await classifyCompletion({
        ctx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(logger.wasLogged('Failed to parse completion classifier response')).toBe(true)
    })

    it('returns default result when LLM call fails', async () => {
      transcript.setMockEntries([createEntry('user', 'Do something'), createEntry('assistant', 'Done')])

      // Create a mock that throws
      const throwingLlm = {
        id: 'throwing-llm',
        complete: () => Promise.reject(new Error('LLM API error')),
      }
      const throwingCtx = createMockDaemonContext({
        transcript,
        logger,
        llm: throwingLlm as unknown as MockLLMService,
        assets,
      })

      const result = await classifyCompletion({
        ctx: throwingCtx,
        settings: { enabled: true, confidence_threshold: 0.7 },
      })

      expect(result.shouldBlock).toBe(true)
      expect(logger.wasLoggedAtLevel('Completion classification failed', 'error')).toBe(true)
    })

    it('uses default settings when none provided', async () => {
      transcript.setMockEntries([
        createEntry('user', 'Do the task'),
        createEntry('assistant', 'Task completed successfully.'),
      ])

      llm.queueResponse(
        JSON.stringify({
          category: 'CLAIMING_COMPLETION',
          confidence: 0.9,
          reasoning: 'Clear completion claim',
        })
      )

      // No settings provided - should use defaults
      const result = await classifyCompletion({ ctx })

      // Default settings have enabled: false, so it should return default result
      expect(result.shouldBlock).toBe(true)
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
