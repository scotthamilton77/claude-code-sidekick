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
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Extra context' },
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
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Context' },
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

// Hoisted mocks
const {
  mockHandleHookCommand,
  mockGetSetupState,
  mockGetDevMode,
  mockShouldAutoConfigureProject,
  mockAutoConfigureProject,
  mockDaemonStart,
} = vi.hoisted(() => ({
  mockHandleHookCommand: vi.fn(),
  mockGetSetupState: vi.fn(),
  mockGetDevMode: vi.fn(),
  mockShouldAutoConfigureProject: vi.fn(),
  mockAutoConfigureProject: vi.fn(),
  mockDaemonStart: vi.fn(),
}))

// Mock the hook.js module to control internal responses
vi.mock('../hook.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hook.js')>()
  return {
    ...actual,
    handleHookCommand: mockHandleHookCommand,
  }
})

// Mock SetupStatusService and DaemonClient to control setup state and daemon startup
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    SetupStatusService: vi.fn().mockImplementation(() => ({
      getSetupState: mockGetSetupState,
      getDevMode: mockGetDevMode,
      shouldAutoConfigureProject: mockShouldAutoConfigureProject,
      autoConfigureProject: mockAutoConfigureProject,
    })),
    DaemonClient: vi.fn().mockImplementation(() => ({
      start: mockDaemonStart,
    })),
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
    // Default to healthy setup state so tests exercise normal flow
    mockGetSetupState.mockResolvedValue('healthy')
    // Default to dev-mode not enabled
    mockGetDevMode.mockResolvedValue(false)
    // Default to auto-configure not needed
    mockShouldAutoConfigureProject.mockResolvedValue(false)
    mockAutoConfigureProject.mockResolvedValue(false)
    // Default daemon start to succeed
    mockDaemonStart.mockResolvedValue(undefined)
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
    // Should be translated to Claude Code format, with safe word appended for SessionStart
    const output = JSON.parse(stdout.data.trim())
    expect(output.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    expect(output.hookSpecificOutput?.additionalContext).toContain('Test context')
    expect(output.hookSpecificOutput?.additionalContext).toContain('Sidekick')
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
    // SessionStart now always includes safe word in additionalContext
    expect(output.continue).toBe(false)
    expect(output.stopReason).toBe('Blocked by test')
    expect(output.hookSpecificOutput?.additionalContext).toContain('Sidekick')
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
    // Use PostToolUse since SessionStart now always gets safe word injection
    const result = await handleUnifiedHookCommand('PostToolUse', baseOptions, mockLogger, stdout)

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
    // Use PostToolUse since SessionStart now always gets safe word injection
    const result = await handleUnifiedHookCommand('PostToolUse', baseOptions, mockLogger, stdout)

    // Should not throw, should return empty translated response
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(stdout.data.trim())
    expect(output).toEqual({})
    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to parse internal hook response',
      expect.objectContaining({ hookName: 'PostToolUse' })
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

  describe('degraded mode (setup not healthy)', () => {
    test('returns degraded response when setup not run', async () => {
      mockGetSetupState.mockResolvedValue('not-run')

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      expect(output.hookSpecificOutput?.additionalContext).toContain('Sidekick plugin detected but not configured')
      expect(output.systemMessage).toContain("Run 'sidekick setup'")
      // Should NOT call internal hook handler
      expect(mockHandleHookCommand).not.toHaveBeenCalled()
      // Should log at INFO level for not-run
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Hook operating in degraded mode - setup not run',
        expect.any(Object)
      )
    })

    test('returns degraded response when setup partial', async () => {
      mockGetSetupState.mockResolvedValue('partial')

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      expect(output.hookSpecificOutput?.additionalContext).toContain('project is not configured')
      expect(output.systemMessage).toContain('project setup incomplete')
      expect(mockHandleHookCommand).not.toHaveBeenCalled()
      // Should log at WARN level for partial
      expect(mockLogger.warn).toHaveBeenCalledWith('Hook operating in degraded mode', expect.any(Object))
    })

    test('returns degraded response when setup unhealthy', async () => {
      mockGetSetupState.mockResolvedValue('unhealthy')

      const stdout = new CollectingWritable()
      // Use SessionStart since it's a verbose degraded hook
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      expect(output.hookSpecificOutput?.additionalContext).toContain('unhealthy')
      expect(output.systemMessage).toContain('sidekick doctor')
      expect(mockHandleHookCommand).not.toHaveBeenCalled()
      // Should log at WARN level for unhealthy
      expect(mockLogger.warn).toHaveBeenCalledWith('Hook operating in degraded mode', expect.any(Object))
    })

    test('non-verbose hooks return empty object in degraded mode', async () => {
      mockGetSetupState.mockResolvedValue('not-run')

      // Test PostToolUse - should return {} silently
      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('PostToolUse', baseOptions, mockLogger, stdout)

      const output = JSON.parse(stdout.data.trim())
      // Non-verbose hooks return empty object, no messages
      expect(output).toEqual({})
      expect(mockHandleHookCommand).not.toHaveBeenCalled()
      // Should still log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Hook operating in degraded mode - setup not run',
        expect.any(Object)
      )
    })

    test('proceeds normally when setup is healthy', async () => {
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Normal response"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      // Should call internal handler when healthy
      expect(mockHandleHookCommand).toHaveBeenCalled()
      const output = JSON.parse(stdout.data.trim())
      // Now includes both normal response and safe word (safe word is always appended)
      expect(output.hookSpecificOutput?.additionalContext).toContain('Normal response')
      expect(output.hookSpecificOutput?.additionalContext).toContain('Sidekick')
    })

    test('proceeds normally when setup check throws (assumes healthy)', async () => {
      mockGetSetupState.mockRejectedValue(new Error('Config file corrupted'))
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Normal response"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      // Should log warning about failed check
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to check setup state, assuming healthy',
        expect.objectContaining({ error: 'Config file corrupted' })
      )
      // Should proceed with internal handler
      expect(mockHandleHookCommand).toHaveBeenCalled()
      const output = JSON.parse(stdout.data.trim())
      // Now includes both normal response and safe word (safe word is always appended)
      expect(output.hookSpecificOutput?.additionalContext).toContain('Normal response')
      expect(output.hookSpecificOutput?.additionalContext).toContain('Sidekick')
    })
  })

  describe('safe word liveness injection', () => {
    beforeEach(() => {
      // Default to healthy setup
      mockGetSetupState.mockResolvedValue('healthy')
    })

    test('injects safe word context when SIDEKICK_SAFE_WORD env var is set', async () => {
      const originalEnv = process.env.SIDEKICK_SAFE_WORD
      process.env.SIDEKICK_SAFE_WORD = 'test-safe-word-xyz'

      try {
        mockHandleHookCommand.mockImplementation(
          (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
            stdout.write('{}\n')
            return Promise.resolve({ exitCode: 0, output: '{}' })
          }
        )

        const stdout = new CollectingWritable()
        await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

        const output = JSON.parse(stdout.data.trim())
        // Should include the safe word in additionalContext
        expect(output.hookSpecificOutput?.additionalContext).toContain('test-safe-word-xyz')
        expect(output.hookSpecificOutput?.additionalContext).toContain('magic Sidekick word')
      } finally {
        if (originalEnv === undefined) {
          delete process.env.SIDEKICK_SAFE_WORD
        } else {
          process.env.SIDEKICK_SAFE_WORD = originalEnv
        }
      }
    })

    test('uses default safe word "nope" when env var not set', async () => {
      const originalEnv = process.env.SIDEKICK_SAFE_WORD
      delete process.env.SIDEKICK_SAFE_WORD

      try {
        mockHandleHookCommand.mockImplementation(
          (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
            stdout.write('{}\n')
            return Promise.resolve({ exitCode: 0, output: '{}' })
          }
        )

        const stdout = new CollectingWritable()
        await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

        const output = JSON.parse(stdout.data.trim())
        // Should include default safe word
        expect(output.hookSpecificOutput?.additionalContext).toContain('nope')
      } finally {
        if (originalEnv !== undefined) {
          process.env.SIDEKICK_SAFE_WORD = originalEnv
        }
      }
    })

    test('appends safe word context to existing additionalContext', async () => {
      const originalEnv = process.env.SIDEKICK_SAFE_WORD
      process.env.SIDEKICK_SAFE_WORD = 'custom-safe-word'

      try {
        mockHandleHookCommand.mockImplementation(
          (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
            stdout.write('{"additionalContext":"Existing context from hook"}\n')
            return Promise.resolve({ exitCode: 0, output: '{}' })
          }
        )

        const stdout = new CollectingWritable()
        await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

        const output = JSON.parse(stdout.data.trim())
        // Should contain both existing context and safe word
        expect(output.hookSpecificOutput?.additionalContext).toContain('Existing context from hook')
        expect(output.hookSpecificOutput?.additionalContext).toContain('custom-safe-word')
      } finally {
        if (originalEnv === undefined) {
          delete process.env.SIDEKICK_SAFE_WORD
        } else {
          process.env.SIDEKICK_SAFE_WORD = originalEnv
        }
      }
    })

    test('does not inject safe word for non-SessionStart hooks', async () => {
      const originalEnv = process.env.SIDEKICK_SAFE_WORD
      process.env.SIDEKICK_SAFE_WORD = 'should-not-appear'

      try {
        mockHandleHookCommand.mockImplementation(
          (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
            stdout.write('{}\n')
            return Promise.resolve({ exitCode: 0, output: '{}' })
          }
        )

        const stdout = new CollectingWritable()
        await handleUnifiedHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

        const output = JSON.parse(stdout.data.trim())
        // Should NOT have safe word content for non-SessionStart hooks
        expect(output.hookSpecificOutput?.additionalContext).toBeUndefined()
      } finally {
        if (originalEnv === undefined) {
          delete process.env.SIDEKICK_SAFE_WORD
        } else {
          process.env.SIDEKICK_SAFE_WORD = originalEnv
        }
      }
    })
  })

  describe('devMode-based conflict detection', () => {
    beforeEach(() => {
      mockGetSetupState.mockResolvedValue('healthy')
    })

    test('returns empty response when devMode is true and force not passed', async () => {
      mockGetDevMode.mockResolvedValue(true)

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      // Should return empty object, letting dev-mode hooks win
      expect(output).toEqual({})
      // Should NOT call internal hook handler
      expect(mockHandleHookCommand).not.toHaveBeenCalled()
      // Should log about dev-mode conflict
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Dev-mode active, bailing early (let dev-mode hooks win)',
        expect.objectContaining({ hookName: 'SessionStart' })
      )
    })

    test('proceeds normally when devMode is true but force flag is true', async () => {
      mockGetDevMode.mockResolvedValue(true)
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Force mode response"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const optionsWithForce = { ...baseOptions, force: true }
      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', optionsWithForce, mockLogger, stdout)

      // Should call internal handler when force is passed
      expect(mockHandleHookCommand).toHaveBeenCalled()
      const output = JSON.parse(stdout.data.trim())
      expect(output.hookSpecificOutput?.additionalContext).toContain('Force mode response')
    })

    test('proceeds normally when devMode is false', async () => {
      mockGetDevMode.mockResolvedValue(false)
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Normal response"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      // Should call internal handler when devMode is false
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })

    test('proceeds normally when devMode check fails (fail open)', async () => {
      mockGetDevMode.mockRejectedValue(new Error('Failed to check devMode'))
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      // Should proceed with internal handler on error (fail open)
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })
  })

  describe('auto-configure on SessionStart', () => {
    beforeEach(() => {
      mockGetDevMode.mockResolvedValue(false)
    })

    test('calls autoConfigureProject on SessionStart when shouldAutoConfigureProject returns true', async () => {
      mockShouldAutoConfigureProject.mockResolvedValue(true)
      mockAutoConfigureProject.mockResolvedValue(true)
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Normal response"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(mockAutoConfigureProject).toHaveBeenCalled()
      expect(mockHandleHookCommand).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Project auto-configured on SessionStart',
        expect.objectContaining({ projectRoot: '/project' })
      )
    })

    test('does not call autoConfigureProject when shouldAutoConfigureProject returns false', async () => {
      mockShouldAutoConfigureProject.mockResolvedValue(false)
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(mockAutoConfigureProject).not.toHaveBeenCalled()
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })

    test('does not call autoConfigureProject for non-SessionStart hooks', async () => {
      mockShouldAutoConfigureProject.mockResolvedValue(true)
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

      expect(mockAutoConfigureProject).not.toHaveBeenCalled()
    })

    test('continues gracefully when auto-configure fails', async () => {
      mockShouldAutoConfigureProject.mockRejectedValue(new Error('Auto-configure check failed'))
      mockGetSetupState.mockResolvedValue('partial')

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to auto-configure project',
        expect.objectContaining({ error: 'Auto-configure check failed' })
      )
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      expect(output.hookSpecificOutput?.additionalContext).toContain('project is not configured')
    })

    test('auto-configure enables healthy mode - removes degraded response', async () => {
      mockShouldAutoConfigureProject.mockResolvedValue(true)
      mockAutoConfigureProject.mockResolvedValue(true)
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{"additionalContext":"Full features enabled"}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      const output = JSON.parse(stdout.data.trim())
      expect(output.systemMessage).toBeUndefined()
      expect(output.hookSpecificOutput?.additionalContext).toContain('Full features enabled')
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })
  })

  describe('daemon startup', () => {
    beforeEach(() => {
      mockGetDevMode.mockResolvedValue(false)
      mockGetSetupState.mockResolvedValue('healthy')
      mockHandleHookCommand.mockImplementation(
        (_hookName: unknown, _options: unknown, _logger: unknown, stdout: Writable) => {
          stdout.write('{}\n')
          return Promise.resolve({ exitCode: 0, output: '{}' })
        }
      )
    })

    test('starts daemon after auto-configure on SessionStart', async () => {
      mockShouldAutoConfigureProject.mockResolvedValue(true)
      mockAutoConfigureProject.mockResolvedValue(true)

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(mockDaemonStart).toHaveBeenCalledOnce()
      expect(mockLogger.debug).toHaveBeenCalledWith('Daemon started for hook execution')
    })

    test('starts daemon for non-SessionStart hooks when healthy', async () => {
      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

      expect(mockDaemonStart).toHaveBeenCalledOnce()
    })

    test('skips daemon start when setup not healthy', async () => {
      mockGetSetupState.mockResolvedValue('partial')

      const stdout = new CollectingWritable()
      await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(mockDaemonStart).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping daemon start - setup not healthy',
        expect.objectContaining({ setupState: 'partial' })
      )
    })

    test('gracefully handles daemon start failure', async () => {
      mockDaemonStart.mockRejectedValue(new Error('Daemon failed to start within timeout'))

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      // Should not crash - exit code should be 0
      expect(result.exitCode).toBe(0)
      expect(mockDaemonStart).toHaveBeenCalledOnce()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to start daemon for hook, proceeding without daemon features',
        expect.objectContaining({ error: 'Daemon failed to start within timeout' })
      )
      // Hook should still complete
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })

    test('does not crash when setup check throws', async () => {
      // First call from ensureDaemonForHook throws, second call from checkSetupState succeeds
      mockGetSetupState.mockRejectedValueOnce(new Error('Config corrupted')).mockResolvedValueOnce('healthy')

      const stdout = new CollectingWritable()
      const result = await handleUnifiedHookCommand('SessionStart', baseOptions, mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      // Should log warning about failed setup check
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to check setup status for daemon start, proceeding anyway',
        expect.objectContaining({ error: 'Config corrupted' })
      )
      // Daemon start should still be attempted (fail-open)
      expect(mockDaemonStart).toHaveBeenCalled()
      // Hook should still complete
      expect(mockHandleHookCommand).toHaveBeenCalled()
    })
  })
})
