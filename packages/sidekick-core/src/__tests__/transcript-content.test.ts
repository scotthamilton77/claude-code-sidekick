/**
 * Transcript Content Extraction Tests
 *
 * Tests for extracting content previews from Claude transcript entries.
 * Covers various content structures found in real transcripts:
 * - String content (simple user prompts)
 * - Array content with text blocks (assistant messages)
 * - Array content with tool_use blocks (tool calls)
 * - Array content with tool_result blocks (tool results)
 */

import { describe, expect, it } from 'vitest'
import {
  extractContentPreview,
  extractTextFromContent,
  extractToolCallPreview,
  extractToolResultPreview,
} from '../transcript-content.js'

describe('extractTextFromContent', () => {
  it('should extract string content directly', () => {
    expect(extractTextFromContent('Hello world')).toBe('Hello world')
  })

  it('should extract text from array with text block', () => {
    const content = [{ type: 'text', text: 'Hello from array' }]
    expect(extractTextFromContent(content)).toBe('Hello from array')
  })

  it('should extract text from first text block in array', () => {
    const content = [
      { type: 'text', text: 'First text' },
      { type: 'text', text: 'Second text' },
    ]
    expect(extractTextFromContent(content)).toBe('First text')
  })

  it('should extract content from tool_result block', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'toolu_123', content: 'Tool output here' }]
    expect(extractTextFromContent(content)).toBe('Tool output here')
  })

  it('should return undefined for empty array', () => {
    expect(extractTextFromContent([])).toBeUndefined()
  })

  it('should return undefined for null', () => {
    expect(extractTextFromContent(null)).toBeUndefined()
  })

  it('should return undefined for undefined', () => {
    expect(extractTextFromContent(undefined)).toBeUndefined()
  })

  it('should return undefined for array without text or tool_result blocks', () => {
    const content = [{ type: 'image', source: { type: 'base64' } }]
    expect(extractTextFromContent(content)).toBeUndefined()
  })
})

describe('extractToolCallPreview', () => {
  it('should extract tool name from tool_use block', () => {
    const content = [{ type: 'tool_use', id: 'toolu_123', name: 'Bash', input: { command: 'ls' } }]
    expect(extractToolCallPreview(content)).toBe('Bash(...)')
  })

  it('should extract first tool name when multiple tool_use blocks', () => {
    const content = [
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'toolu_2', name: 'Write', input: {} },
    ]
    expect(extractToolCallPreview(content)).toBe('Read(...)')
  })

  it('should return undefined for non-array content', () => {
    expect(extractToolCallPreview('string content')).toBeUndefined()
    expect(extractToolCallPreview(null)).toBeUndefined()
    expect(extractToolCallPreview(undefined)).toBeUndefined()
  })

  it('should return undefined for array without tool_use blocks', () => {
    const content = [{ type: 'text', text: 'Hello' }]
    expect(extractToolCallPreview(content)).toBeUndefined()
  })
})

describe('extractToolResultPreview', () => {
  it('should extract content from tool_result block', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'toolu_123', content: 'Command output' }]
    expect(extractToolResultPreview(content)).toBe('Command output')
  })

  it('should return undefined for non-array content', () => {
    expect(extractToolResultPreview('string content')).toBeUndefined()
    expect(extractToolResultPreview(null)).toBeUndefined()
  })

  it('should return undefined for array without tool_result blocks', () => {
    const content = [{ type: 'text', text: 'Hello' }]
    expect(extractToolResultPreview(content)).toBeUndefined()
  })

  it('should return undefined when tool_result content is not a string', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'toolu_123', content: { complex: 'object' } }]
    expect(extractToolResultPreview(content)).toBeUndefined()
  })
})

describe('extractContentPreview', () => {
  describe('UserPrompt events', () => {
    it('should extract string content from user prompt', () => {
      const entry = { type: 'user', message: { role: 'user', content: 'Hello Claude' } }
      expect(extractContentPreview(entry, 'UserPrompt')).toBe('Hello Claude')
    })

    it('should extract text from array content in user prompt', () => {
      const entry = {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Array message' }] },
      }
      expect(extractContentPreview(entry, 'UserPrompt')).toBe('Array message')
    })

    it('should truncate long content', () => {
      const longContent = 'x'.repeat(150)
      const entry = { type: 'user', message: { role: 'user', content: longContent } }
      const preview = extractContentPreview(entry, 'UserPrompt')
      expect(preview).toHaveLength(103) // 100 + '...'
      expect(preview?.endsWith('...')).toBe(true)
    })

    it('should respect custom maxLen', () => {
      const entry = { type: 'user', message: { role: 'user', content: 'Hello world' } }
      expect(extractContentPreview(entry, 'UserPrompt', 5)).toBe('Hello...')
    })
  })

  describe('AssistantMessage events', () => {
    it('should extract text from assistant message array', () => {
      const entry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: "I'll help you with that." }],
        },
      }
      expect(extractContentPreview(entry, 'AssistantMessage')).toBe("I'll help you with that.")
    })

    it('should extract text even when tool_use blocks present', () => {
      const entry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me search for that.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Grep', input: {} },
          ],
        },
      }
      expect(extractContentPreview(entry, 'AssistantMessage')).toBe('Let me search for that.')
    })
  })

  describe('ToolCall events', () => {
    it('should extract tool name from tool_use content', () => {
      const entry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_123', name: 'Bash', input: { command: 'ls -la' } }],
        },
      }
      expect(extractContentPreview(entry, 'ToolCall')).toBe('Bash(...)')
    })
  })

  describe('ToolResult events', () => {
    it('should extract result from tool_result content', () => {
      const entry = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: 'file1.txt\nfile2.txt' }],
        },
      }
      expect(extractContentPreview(entry, 'ToolResult')).toBe('file1.txt\nfile2.txt')
    })

    it('should truncate long tool results', () => {
      const longResult = 'output line\n'.repeat(20)
      const entry = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: longResult }],
        },
      }
      const preview = extractContentPreview(entry, 'ToolResult')
      expect(preview!.length).toBeLessThanOrEqual(103)
      expect(preview?.endsWith('...')).toBe(true)
    })
  })

  describe('Compact events', () => {
    it('should return undefined for Compact events (no content)', () => {
      const entry = { type: 'summary' }
      expect(extractContentPreview(entry, 'Compact')).toBeUndefined()
    })
  })

  describe('missing or malformed entries', () => {
    it('should handle entry without message', () => {
      const entry = { type: 'user' }
      expect(extractContentPreview(entry, 'UserPrompt')).toBeUndefined()
    })

    it('should handle entry with null message', () => {
      const entry = { type: 'user', message: null }
      expect(extractContentPreview(entry, 'UserPrompt')).toBeUndefined()
    })

    it('should handle entry with message but no content', () => {
      const entry = { type: 'user', message: { role: 'user' } }
      expect(extractContentPreview(entry, 'UserPrompt')).toBeUndefined()
    })
  })
})
