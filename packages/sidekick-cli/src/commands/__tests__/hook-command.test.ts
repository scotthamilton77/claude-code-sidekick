/**
 * Unit tests for unified hook command handler.
 *
 * Tests the Claude Code format translation logic per the design doc:
 * docs/plans/2026-01-19-installation-distribution-design.md
 */
import { describe, expect, test } from 'vitest'
import { translateToClaudeCodeFormat, parseHookArg, type ClaudeCodeHookResponse } from '../hook-command.js'
import type { HookResponse } from '../hook.js'

describe('parseHookArg', () => {
  test('parses kebab-case hook names', () => {
    expect(parseHookArg('session-start')).toBe('SessionStart')
    expect(parseHookArg('session-end')).toBe('SessionEnd')
    expect(parseHookArg('user-prompt-submit')).toBe('UserPromptSubmit')
    expect(parseHookArg('pre-tool-use')).toBe('PreToolUse')
    expect(parseHookArg('post-tool-use')).toBe('PostToolUse')
    expect(parseHookArg('stop')).toBe('Stop')
    expect(parseHookArg('pre-compact')).toBe('PreCompact')
  })

  test('parses PascalCase hook names', () => {
    expect(parseHookArg('SessionStart')).toBe('SessionStart')
    expect(parseHookArg('UserPromptSubmit')).toBe('UserPromptSubmit')
    expect(parseHookArg('PreToolUse')).toBe('PreToolUse')
  })

  test('returns undefined for invalid hook names', () => {
    expect(parseHookArg('invalid')).toBeUndefined()
    expect(parseHookArg('session_start')).toBeUndefined()
    expect(parseHookArg('')).toBeUndefined()
    expect(parseHookArg(undefined)).toBeUndefined()
  })
})

describe('translateToClaudeCodeFormat', () => {
  describe('SessionStart', () => {
    test('translates empty response to empty object', () => {
      const internal: HookResponse = {}
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({})
    })

    test('translates blocking response', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Blocked for testing',
      }
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({
        continue: false,
        stopReason: 'Blocked for testing',
      })
    })

    test('translates blocking with default reason', () => {
      const internal: HookResponse = { blocking: true }
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({
        continue: false,
        stopReason: 'Blocked by Sidekick',
      })
    })

    test('translates userMessage to systemMessage', () => {
      const internal: HookResponse = { userMessage: 'Hello user!' }
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({ systemMessage: 'Hello user!' })
    })

    test('translates additionalContext to hookSpecificOutput', () => {
      const internal: HookResponse = { additionalContext: 'Extra context' }
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({
        hookSpecificOutput: { additionalContext: 'Extra context' },
      })
    })

    test('translates combined response', () => {
      const internal: HookResponse = {
        userMessage: 'Message',
        additionalContext: 'Context',
      }
      const result = translateToClaudeCodeFormat('SessionStart', internal)
      expect(result).toEqual({
        systemMessage: 'Message',
        hookSpecificOutput: { additionalContext: 'Context' },
      })
    })
  })

  describe('UserPromptSubmit', () => {
    test('translates empty response to empty object', () => {
      const internal: HookResponse = {}
      const result = translateToClaudeCodeFormat('UserPromptSubmit', internal)
      expect(result).toEqual({})
    })

    test('translates blocking response', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Blocked prompt',
      }
      const result = translateToClaudeCodeFormat('UserPromptSubmit', internal)
      expect(result).toEqual({
        decision: 'block',
        reason: 'Blocked prompt',
      })
    })

    test('translates additionalContext with hookEventName', () => {
      const internal: HookResponse = { additionalContext: 'Prompt context' }
      const result = translateToClaudeCodeFormat('UserPromptSubmit', internal)
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'Prompt context',
        },
      })
    })
  })

  describe('PreToolUse', () => {
    test('translates empty response to empty object', () => {
      const internal: HookResponse = {}
      const result = translateToClaudeCodeFormat('PreToolUse', internal)
      expect(result).toEqual({})
    })

    test('translates blocking to deny decision', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Tool not allowed',
      }
      const result = translateToClaudeCodeFormat('PreToolUse', internal)
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Tool not allowed',
        },
      })
    })

    test('combines reason and additionalContext when blocking', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Tool blocked',
        additionalContext: 'Additional info',
      }
      const result = translateToClaudeCodeFormat('PreToolUse', internal)
      expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('Tool blocked\n\nAdditional info')
    })

    test('translates non-blocking additionalContext to allow decision', () => {
      const internal: HookResponse = { additionalContext: 'Tool guidance' }
      const result = translateToClaudeCodeFormat('PreToolUse', internal)
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Tool guidance',
        },
      })
    })

    test('includes systemMessage alongside hookSpecificOutput', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Denied',
        userMessage: 'Tool denied for safety',
      }
      const result = translateToClaudeCodeFormat('PreToolUse', internal)
      expect(result.systemMessage).toBe('Tool denied for safety')
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
    })
  })

  describe('PostToolUse', () => {
    test('translates empty response to empty object', () => {
      const internal: HookResponse = {}
      const result = translateToClaudeCodeFormat('PostToolUse', internal)
      expect(result).toEqual({})
    })

    test('translates blocking response', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Tool result rejected',
      }
      const result = translateToClaudeCodeFormat('PostToolUse', internal)
      expect(result).toEqual({
        decision: 'block',
        reason: 'Tool result rejected',
      })
    })

    test('combines reason and additionalContext when blocking', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Blocked',
        additionalContext: 'Details',
      }
      const result = translateToClaudeCodeFormat('PostToolUse', internal)
      expect(result.reason).toBe('Blocked\n\nDetails')
    })

    test('translates non-blocking additionalContext to hookSpecificOutput', () => {
      const internal: HookResponse = { additionalContext: 'Tool observation' }
      const result = translateToClaudeCodeFormat('PostToolUse', internal)
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'Tool observation',
        },
      })
    })

    test('does not include additionalContext in hookSpecificOutput when blocking', () => {
      const internal: HookResponse = {
        blocking: true,
        additionalContext: 'Context',
      }
      const result = translateToClaudeCodeFormat('PostToolUse', internal)
      // additionalContext goes into reason, not hookSpecificOutput
      expect(result.hookSpecificOutput).toBeUndefined()
      expect(result.reason).toBe('Context')
    })
  })

  describe('Stop', () => {
    test('translates empty response to empty object', () => {
      const internal: HookResponse = {}
      const result = translateToClaudeCodeFormat('Stop', internal)
      expect(result).toEqual({})
    })

    test('translates blocking response', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Not finished yet',
      }
      const result = translateToClaudeCodeFormat('Stop', internal)
      expect(result).toEqual({
        decision: 'block',
        reason: 'Not finished yet',
      })
    })

    test('uses single newline separator for combined reason', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Stop blocked',
        additionalContext: 'More work needed',
      }
      const result = translateToClaudeCodeFormat('Stop', internal)
      // Stop uses \n separator instead of \n\n
      expect(result.reason).toBe('Stop blocked\nMore work needed')
    })

    test('uses default reason when blocking without reason/context', () => {
      const internal: HookResponse = { blocking: true }
      const result = translateToClaudeCodeFormat('Stop', internal)
      expect(result.reason).toBe('Task not complete - please continue')
    })

    test('does not add hookSpecificOutput (Stop does not support it)', () => {
      const internal: HookResponse = {
        blocking: true,
        additionalContext: 'Context',
      }
      const result = translateToClaudeCodeFormat('Stop', internal)
      expect(result.hookSpecificOutput).toBeUndefined()
    })
  })

  describe('SessionEnd', () => {
    test('always returns empty object (notification only)', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Should be ignored',
        additionalContext: 'Also ignored',
        userMessage: 'Ignored too',
      }
      const result = translateToClaudeCodeFormat('SessionEnd', internal)
      expect(result).toEqual({})
    })
  })

  describe('PreCompact', () => {
    test('always returns empty object (notification only)', () => {
      const internal: HookResponse = {
        blocking: true,
        reason: 'Should be ignored',
      }
      const result = translateToClaudeCodeFormat('PreCompact', internal)
      expect(result).toEqual({})
    })
  })
})

describe('ClaudeCodeHookResponse type', () => {
  // Type-level tests to ensure the response type is correct
  test('response can have SessionStart fields', () => {
    const response: ClaudeCodeHookResponse = {
      continue: false,
      stopReason: 'Test',
    }
    expect(response.continue).toBe(false)
  })

  test('response can have decision-based fields', () => {
    const response: ClaudeCodeHookResponse = {
      decision: 'block',
      reason: 'Test',
    }
    expect(response.decision).toBe('block')
  })

  test('response can have permission fields in hookSpecificOutput', () => {
    const response: ClaudeCodeHookResponse = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Test',
      },
    }
    expect(response.hookSpecificOutput?.permissionDecision).toBe('deny')
  })
})

// Integration tests for handleUnifiedHookCommand
import { Writable } from 'node:stream'
import { vi, beforeEach } from 'vitest'
import type { ParsedHookInput } from '@sidekick/types'
import { handleUnifiedHookCommand } from '../hook-command.js'

// Hoisted mock for handleHookCommand
const { mockHandleHookCommand } = vi.hoisted(() => ({
  mockHandleHookCommand: vi.fn(),
}))

// Mock the hook.js module to control internal responses
vi.mock('../hook.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hook.js')>()
  return {
    ...actual,
    handleHookCommand: mockHandleHookCommand,
  }
})

// Collecting writable for capturing output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

describe('handleUnifiedHookCommand', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  }

  const mockRuntime = {
    projectRoot: '/project',
    config: { get: vi.fn() },
    logger: mockLogger,
    assets: { resolve: vi.fn() },
    telemetry: { flush: vi.fn() },
    correlationId: 'test-correlation-id',
    cleanup: vi.fn(),
    bindSessionId: vi.fn(),
    getLogCounts: vi.fn().mockReturnValue({ warnings: 0, errors: 0 }),
    resetLogCounts: vi.fn(),
    loadExistingLogCounts: vi.fn().mockResolvedValue(undefined),
    stateService: { sessionRootDir: vi.fn(), sessionStatePath: vi.fn(), write: vi.fn() },
  }

  const baseHookInput: ParsedHookInput = {
    sessionId: 'test-session-123',
    transcriptPath: '/path/to/transcript.jsonl',
    cwd: '/project/dir',
    hookEventName: 'SessionStart',
    permissionMode: 'default',
    raw: { session_id: 'test-session-123' },
  }

  const baseOptions = {
    projectRoot: '/project',
    hookInput: baseHookInput,
    correlationId: 'test-correlation',
    runtime: mockRuntime as unknown as Parameters<typeof handleUnifiedHookCommand>[1]['runtime'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('translates internal response to Claude Code format and outputs JSON', async () => {
    // Mock handleHookCommand to write an internal response
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('{"additionalContext":"Test context"}\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(result.exitCode).toBe(0)
    // Should be translated to Claude Code format
    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({
      hookSpecificOutput: { additionalContext: 'Test context' },
    })
  })

  test('translates blocking response correctly for SessionStart', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('{"blocking":true,"reason":"Blocked by test"}\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({
      continue: false,
      stopReason: 'Blocked by test',
    })
  })

  test('translates blocking response correctly for UserPromptSubmit', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('{"blocking":true,"reason":"Prompt blocked"}\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    await handleUnifiedHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({
      decision: 'block',
      reason: 'Prompt blocked',
    })
  })

  test('handles empty internal response gracefully', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({})
  })

  test('handles malformed JSON internal response gracefully', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('not valid json\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    // Should not throw, should return empty translated response
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({})
    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to parse internal hook response',
      expect.objectContaining({ hookName: 'SessionStart' })
    )
  })

  test('outputs JSON with trailing newline', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('{}\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    // Output should end with newline
    expect(stdout.data.endsWith('\n')).toBe(true)
  })

  test('passes correct options to internal handleHookCommand', async () => {
    mockHandleHookCommand.mockImplementation(
      (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
        stdout.write('{}\n')
        return Promise.resolve({ exitCode: 0, output: '{}' })
      }
    )

    const stdout = new CollectingWritable()
    await handleUnifiedHookCommand('PreToolUse', baseOptions, mockLogger, stdout)

    expect(mockHandleHookCommand).toHaveBeenCalledWith(
      'PreToolUse',
      expect.objectContaining({
        projectRoot: '/project',
        sessionId: 'test-session-123',
        hookInput: baseHookInput,
        correlationId: 'test-correlation',
      }),
      mockLogger,
      expect.any(Object) // capture stream
    )
  })
})
