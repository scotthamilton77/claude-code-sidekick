/**
 * Unit tests for hook command handler.
 *
 * Tests the hook event construction, response formatting, and hook name mapping
 * per Phase 8 requirements.
 *
 * @see docs/design/flow.md §5 Complete Hook Flows
 */
import { describe, expect, test, vi } from 'vitest'
import type { ParsedHookInput } from '@sidekick/types'
import { buildHookEvent, getHookName, isHookCommand } from '../hook.js'

// Mock @sidekick/core IpcService
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    IpcService: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue(null),
      close: vi.fn(),
    })),
  }
})

describe('hook command utilities', () => {
  describe('isHookCommand', () => {
    test('returns true for valid hook commands (PascalCase)', () => {
      expect(isHookCommand('SessionStart')).toBe(true)
      expect(isHookCommand('SessionEnd')).toBe(true)
      expect(isHookCommand('UserPromptSubmit')).toBe(true)
      expect(isHookCommand('PreToolUse')).toBe(true)
      expect(isHookCommand('PostToolUse')).toBe(true)
      expect(isHookCommand('Stop')).toBe(true)
      expect(isHookCommand('PreCompact')).toBe(true)
    })

    test('returns true for valid hook commands (snake_case)', () => {
      expect(isHookCommand('session_start')).toBe(true)
      expect(isHookCommand('session_end')).toBe(true)
      expect(isHookCommand('user_prompt_submit')).toBe(true)
      expect(isHookCommand('pre_tool_use')).toBe(true)
      expect(isHookCommand('post_tool_use')).toBe(true)
      expect(isHookCommand('stop')).toBe(true)
      expect(isHookCommand('pre_compact')).toBe(true)
    })

    test('returns false for non-hook commands', () => {
      expect(isHookCommand('supervisor')).toBe(false)
      expect(isHookCommand('statusline')).toBe(false)
      expect(isHookCommand('ui')).toBe(false)
      expect(isHookCommand('unknown')).toBe(false)
      expect(isHookCommand('')).toBe(false)
    })
  })

  describe('getHookName', () => {
    test('normalizes hook commands to canonical HookName', () => {
      expect(getHookName('SessionStart')).toBe('SessionStart')
      expect(getHookName('session_start')).toBe('SessionStart')
      expect(getHookName('UserPromptSubmit')).toBe('UserPromptSubmit')
      expect(getHookName('user_prompt_submit')).toBe('UserPromptSubmit')
    })

    test('returns undefined for non-hook commands', () => {
      expect(getHookName('supervisor')).toBeUndefined()
      expect(getHookName('invalid')).toBeUndefined()
    })
  })
})

describe('buildHookEvent', () => {
  const baseInput: ParsedHookInput = {
    sessionId: 'test-session-123',
    transcriptPath: '/path/to/transcript.jsonl',
    cwd: '/project/dir',
    hookEventName: 'SessionStart',
    permissionMode: 'default',
    raw: {},
  }
  const correlationId = 'correlation-123'
  const scope = 'project' as const

  describe('SessionStart event', () => {
    test('builds event with default startType', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123' },
      }

      const event = buildHookEvent('SessionStart', input, correlationId, scope)

      expect(event.kind).toBe('hook')
      expect(event.hook).toBe('SessionStart')
      expect(event.context.sessionId).toBe('test-session-123')
      expect(event.context.correlationId).toBe(correlationId)
      expect(event.context.scope).toBe('project')
      expect(event.payload).toEqual({
        startType: 'startup',
        transcriptPath: input.transcriptPath,
      })
    })

    test('builds event with specified source', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123', source: 'resume' },
      }

      const event = buildHookEvent('SessionStart', input, correlationId, scope)
      expect(event.payload).toEqual({
        startType: 'resume',
        transcriptPath: input.transcriptPath,
      })
    })
  })

  describe('SessionEnd event', () => {
    test('builds event with default endReason', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123' },
      }

      const event = buildHookEvent('SessionEnd', input, correlationId, scope)

      expect(event.hook).toBe('SessionEnd')
      expect(event.payload).toEqual({
        endReason: 'other',
      })
    })

    test('builds event with specified reason', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123', reason: 'clear' },
      }

      const event = buildHookEvent('SessionEnd', input, correlationId, scope)
      expect(event.payload).toEqual({
        endReason: 'clear',
      })
    })
  })

  describe('UserPromptSubmit event', () => {
    test('builds event with prompt and metadata', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123', prompt: 'Hello, Claude!' },
      }

      const event = buildHookEvent('UserPromptSubmit', input, correlationId, scope)

      expect(event.hook).toBe('UserPromptSubmit')
      expect(event.payload).toEqual({
        prompt: 'Hello, Claude!',
        transcriptPath: input.transcriptPath,
        cwd: '/project/dir',
        permissionMode: 'default',
      })
    })

    test('uses process.cwd when cwd is undefined', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        cwd: undefined,
        raw: { session_id: 'test-session-123', prompt: 'test' },
      }

      const event = buildHookEvent('UserPromptSubmit', input, correlationId, scope)
      expect(event.hook).toBe('UserPromptSubmit')
      // Type narrowing via assertion since we know the hook type
      const payload = event.payload as { cwd: string }
      expect(payload.cwd).toBe(process.cwd())
    })
  })

  describe('PreToolUse event', () => {
    test('builds event with tool details', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: {
          session_id: 'test-session-123',
          tool_name: 'Read',
          tool_input: { file_path: '/path/to/file.ts' },
        },
      }

      const event = buildHookEvent('PreToolUse', input, correlationId, scope)

      expect(event.hook).toBe('PreToolUse')
      expect(event.payload).toEqual({
        toolName: 'Read',
        toolInput: { file_path: '/path/to/file.ts' },
      })
    })

    test('handles missing tool_input', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123', tool_name: 'Bash' },
      }

      const event = buildHookEvent('PreToolUse', input, correlationId, scope)
      expect(event.hook).toBe('PreToolUse')
      // Type narrowing via assertion since we know the hook type
      const payload = event.payload as { toolInput: Record<string, unknown> }
      expect(payload.toolInput).toEqual({})
    })
  })

  describe('PostToolUse event', () => {
    test('builds event with tool details and result', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: {
          session_id: 'test-session-123',
          tool_name: 'Read',
          tool_input: { file_path: '/path/to/file.ts' },
          tool_response: { content: 'file contents' },
        },
      }

      const event = buildHookEvent('PostToolUse', input, correlationId, scope)

      expect(event.hook).toBe('PostToolUse')
      expect(event.payload).toEqual({
        toolName: 'Read',
        toolInput: { file_path: '/path/to/file.ts' },
        toolResult: { content: 'file contents' },
      })
    })
  })

  describe('Stop event', () => {
    test('builds event with stop hook details', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123', stop_hook_active: true },
      }

      const event = buildHookEvent('Stop', input, correlationId, scope)

      expect(event.hook).toBe('Stop')
      expect(event.payload).toEqual({
        transcriptPath: input.transcriptPath,
        permissionMode: 'default',
        stopHookActive: true,
      })
    })

    test('defaults stopHookActive to false', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123' },
      }

      const event = buildHookEvent('Stop', input, correlationId, scope)
      expect(event.hook).toBe('Stop')
      // Type narrowing via assertion since we know the hook type
      const payload = event.payload as { stopHookActive: boolean }
      expect(payload.stopHookActive).toBe(false)
    })
  })

  describe('PreCompact event', () => {
    test('builds event with transcript paths', () => {
      const input: ParsedHookInput = {
        ...baseInput,
        raw: { session_id: 'test-session-123' },
      }

      const event = buildHookEvent('PreCompact', input, correlationId, scope)

      expect(event.hook).toBe('PreCompact')
      expect(event.payload).toEqual({
        transcriptPath: input.transcriptPath,
        transcriptSnapshotPath: '', // Placeholder until CLI populates
      })
    })
  })
})
