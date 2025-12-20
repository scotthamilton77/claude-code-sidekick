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
import { buildHookEvent, getHookName, isHookCommand, mergeHookResponses, validateHookName } from '../hook.js'

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
  describe('validateHookName', () => {
    test('returns HookName for valid PascalCase hook names', () => {
      expect(validateHookName('SessionStart')).toBe('SessionStart')
      expect(validateHookName('SessionEnd')).toBe('SessionEnd')
      expect(validateHookName('UserPromptSubmit')).toBe('UserPromptSubmit')
      expect(validateHookName('PreToolUse')).toBe('PreToolUse')
      expect(validateHookName('PostToolUse')).toBe('PostToolUse')
      expect(validateHookName('Stop')).toBe('Stop')
      expect(validateHookName('PreCompact')).toBe('PreCompact')
    })

    test('returns undefined for invalid hook names', () => {
      expect(validateHookName('session_start')).toBeUndefined()
      expect(validateHookName('session-start')).toBeUndefined()
      expect(validateHookName('supervisor')).toBeUndefined()
      expect(validateHookName('unknown')).toBeUndefined()
      expect(validateHookName('')).toBeUndefined()
    })
  })

  describe('isHookCommand', () => {
    test('returns true for valid kebab-case CLI commands', () => {
      expect(isHookCommand('session-start')).toBe(true)
      expect(isHookCommand('session-end')).toBe(true)
      expect(isHookCommand('user-prompt-submit')).toBe(true)
      expect(isHookCommand('pre-tool-use')).toBe(true)
      expect(isHookCommand('post-tool-use')).toBe(true)
      expect(isHookCommand('stop')).toBe(true)
      expect(isHookCommand('pre-compact')).toBe(true)
    })

    test('returns false for non-hook commands', () => {
      expect(isHookCommand('supervisor')).toBe(false)
      expect(isHookCommand('statusline')).toBe(false)
      expect(isHookCommand('ui')).toBe(false)
      expect(isHookCommand('unknown')).toBe(false)
      expect(isHookCommand('')).toBe(false)
      expect(isHookCommand('SessionStart')).toBe(false)
      expect(isHookCommand('session_start')).toBe(false)
    })
  })

  describe('getHookName', () => {
    test('maps kebab-case CLI commands to PascalCase HookName', () => {
      expect(getHookName('session-start')).toBe('SessionStart')
      expect(getHookName('session-end')).toBe('SessionEnd')
      expect(getHookName('user-prompt-submit')).toBe('UserPromptSubmit')
      expect(getHookName('pre-tool-use')).toBe('PreToolUse')
      expect(getHookName('post-tool-use')).toBe('PostToolUse')
      expect(getHookName('stop')).toBe('Stop')
      expect(getHookName('pre-compact')).toBe('PreCompact')
    })

    test('returns undefined for non-hook commands', () => {
      expect(getHookName('supervisor')).toBeUndefined()
      expect(getHookName('invalid')).toBeUndefined()
      expect(getHookName('SessionStart')).toBeUndefined()
      expect(getHookName('session_start')).toBeUndefined()
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

describe('mergeHookResponses', () => {
  test('CLI blocking takes precedence over supervisor', () => {
    const supervisorResponse = { blocking: false, reason: 'supervisor reason' }
    const cliResponse = { blocking: true, reason: 'cli reason' }

    const merged = mergeHookResponses(supervisorResponse, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('cli reason')
  })

  test('additionalContext concatenates with CLI first', () => {
    const supervisorResponse = { additionalContext: 'supervisor context' }
    const cliResponse = { additionalContext: 'cli context' }

    const merged = mergeHookResponses(supervisorResponse, cliResponse)

    expect(merged.additionalContext).toBe('cli context\n\nsupervisor context')
  })

  test('userMessage from CLI overrides supervisor', () => {
    const supervisorResponse = { userMessage: 'supervisor message' }
    const cliResponse = { userMessage: 'cli message' }

    const merged = mergeHookResponses(supervisorResponse, cliResponse)

    expect(merged.userMessage).toBe('cli message')
  })

  test('handles null supervisor response', () => {
    const cliResponse = { blocking: true, reason: 'cli only' }

    const merged = mergeHookResponses(null, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('cli only')
  })

  test('handles empty CLI response', () => {
    const supervisorResponse = { blocking: true, reason: 'supervisor only' }
    const cliResponse = {}

    const merged = mergeHookResponses(supervisorResponse, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('supervisor only')
  })

  test('preserves supervisor fields when CLI response is empty', () => {
    const supervisorResponse = {
      blocking: true,
      reason: 'supervisor reason',
      additionalContext: 'supervisor context',
      userMessage: 'supervisor message',
    }
    const cliResponse = {}

    const merged = mergeHookResponses(supervisorResponse, cliResponse)

    expect(merged).toEqual(supervisorResponse)
  })
})
