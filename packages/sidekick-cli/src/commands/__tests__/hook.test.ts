/**
 * Unit tests for hook command handler.
 *
 * Tests the hook event construction, response formatting, and hook name mapping
 * per Phase 8 requirements.
 *
 * @see docs/design/flow.md §5 Complete Hook Flows
 */
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import type { ParsedHookInput } from '@sidekick/types'
import { buildHookEvent, getHookName, handleHookCommand, isHookCommand, mergeHookResponses, validateHookName } from '../hook.js'
import type { HandleHookOptions } from '../hook.js'

// Collecting writable for capturing output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Hoisted mock functions for IpcService
const { mockSend, mockClose } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockClose: vi.fn(),
}))

// Mock @sidekick/core IpcService
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    IpcService: vi.fn().mockImplementation(() => ({
      send: mockSend,
      close: mockClose,
    })),
  }
})

// Mock context module to avoid complex runtime dependencies
vi.mock('../../context.js', () => ({
  buildCLIContext: vi.fn().mockReturnValue({
    handlers: {
      invokeHook: vi.fn().mockResolvedValue(null),
    },
  }),
  registerCLIFeatures: vi.fn(),
}))

describe('hook command utilities', () => {
  describe('validateHookName', () => {
    // Representative cases - validates the mapping logic works
    test('accepts valid PascalCase hook names', () => {
      expect(validateHookName('SessionStart')).toBe('SessionStart')
      expect(validateHookName('PreToolUse')).toBe('PreToolUse')
    })

    test('rejects invalid hook names', () => {
      // Various invalid formats
      expect(validateHookName('session_start')).toBeUndefined()
      expect(validateHookName('session-start')).toBeUndefined()
      expect(validateHookName('unknown')).toBeUndefined()
      expect(validateHookName('')).toBeUndefined()
    })
  })

  describe('isHookCommand', () => {
    test('recognizes valid kebab-case CLI commands', () => {
      expect(isHookCommand('session-start')).toBe(true)
      expect(isHookCommand('pre-tool-use')).toBe(true)
    })

    test('rejects non-hook commands', () => {
      expect(isHookCommand('statusline')).toBe(false)
      expect(isHookCommand('')).toBe(false)
      // Wrong case format
      expect(isHookCommand('SessionStart')).toBe(false)
    })
  })

  describe('getHookName', () => {
    test('maps kebab-case to PascalCase', () => {
      expect(getHookName('session-start')).toBe('SessionStart')
      expect(getHookName('user-prompt-submit')).toBe('UserPromptSubmit')
    })

    test('returns undefined for non-hook commands', () => {
      expect(getHookName('SessionStart')).toBeUndefined() // Wrong format
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
  test('CLI blocking takes precedence over daemon', () => {
    const daemonResponse = { blocking: false, reason: 'daemon reason' }
    const cliResponse = { blocking: true, reason: 'cli reason' }

    const merged = mergeHookResponses(daemonResponse, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('cli reason')
  })

  test('additionalContext concatenates with CLI first', () => {
    const daemonResponse = { additionalContext: 'daemon context' }
    const cliResponse = { additionalContext: 'cli context' }

    const merged = mergeHookResponses(daemonResponse, cliResponse)

    expect(merged.additionalContext).toBe('cli context\n\ndaemon context')
  })

  test('userMessage from CLI overrides daemon', () => {
    const daemonResponse = { userMessage: 'daemon message' }
    const cliResponse = { userMessage: 'cli message' }

    const merged = mergeHookResponses(daemonResponse, cliResponse)

    expect(merged.userMessage).toBe('cli message')
  })

  test('handles null daemon response', () => {
    const cliResponse = { blocking: true, reason: 'cli only' }

    const merged = mergeHookResponses(null, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('cli only')
  })

  test('handles empty CLI response', () => {
    const daemonResponse = { blocking: true, reason: 'daemon only' }
    const cliResponse = {}

    const merged = mergeHookResponses(daemonResponse, cliResponse)

    expect(merged.blocking).toBe(true)
    expect(merged.reason).toBe('daemon only')
  })

  test('preserves daemon fields when CLI response is empty', () => {
    const daemonResponse = {
      blocking: true,
      reason: 'daemon reason',
      additionalContext: 'daemon context',
      userMessage: 'daemon message',
    }
    const cliResponse = {}

    const merged = mergeHookResponses(daemonResponse, cliResponse)

    expect(merged).toEqual(daemonResponse)
  })
})

describe('handleHookCommand', () => {
  // Create mock logger and runtime
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
    scope: {
      scope: 'project' as const,
      source: 'hook-script-path' as const,
      hookScriptPath: '/project/.claude/hooks/sidekick/session-start',
      projectRoot: '/project',
      dualInstallDetected: false,
      warnings: [],
    },
    config: {
      get: vi.fn(),
    },
    logger: mockLogger,
    assets: {
      resolve: vi.fn(),
    },
    telemetry: {
      flush: vi.fn(),
    },
    correlationId: 'test-correlation-id',
    cleanup: vi.fn(),
    bindSessionId: vi.fn(),
    getLogCounts: vi.fn().mockReturnValue({ warnings: 0, errors: 0 }),
    resetLogCounts: vi.fn(),
    loadExistingLogCounts: vi.fn().mockResolvedValue(undefined),
  }

  const baseHookInput: ParsedHookInput = {
    sessionId: 'test-session-123',
    transcriptPath: '/path/to/transcript.jsonl',
    cwd: '/project/dir',
    hookEventName: 'SessionStart',
    permissionMode: 'default',
    raw: { session_id: 'test-session-123' },
  }

  const baseOptions: HandleHookOptions = {
    projectRoot: '/project',
    sessionId: 'test-session-123',
    hookInput: baseHookInput,
    correlationId: 'test-correlation',
    scope: 'project',
    runtime: mockRuntime as unknown as HandleHookOptions['runtime'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue(null) // Default to daemon unavailable
  })

  test('returns empty response on IPC failure (graceful degradation)', async () => {
    // Simulate IPC connection error
    mockSend.mockRejectedValue(new Error('Connection refused'))

    const stdout = new CollectingWritable()
    const result = await handleHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    // Key behavior: returns empty response to allow action to proceed
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('{}')
    expect(stdout.data).toBe('{}\n')
  })

  test('returns empty response on IPC timeout', async () => {
    // Simulate timeout
    mockSend.mockRejectedValue(new Error('Timeout waiting for response'))

    const stdout = new CollectingWritable()
    const result = await handleHookCommand('PreToolUse', baseOptions, mockLogger, stdout)

    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('{}')
  })

  test('returns daemon response when available', async () => {
    const daemonResponse = { additionalContext: 'Daemon says hello' }
    mockSend.mockResolvedValue(daemonResponse)

    const stdout = new CollectingWritable()
    const result = await handleHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output)).toEqual(daemonResponse)
  })

  test('returns empty object when daemon is unavailable (null response)', async () => {
    mockSend.mockResolvedValue(null)

    const stdout = new CollectingWritable()
    const result = await handleHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(result.exitCode).toBe(0)
    // Merging null daemon response with empty CLI response yields {}
    expect(JSON.parse(result.output)).toEqual({})
  })

  test('always closes IpcService even on error', async () => {
    mockSend.mockRejectedValue(new Error('Network error'))

    const stdout = new CollectingWritable()
    await handleHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(mockClose).toHaveBeenCalledOnce()
  })

  test('always closes IpcService on success', async () => {
    mockSend.mockResolvedValue({ blocking: false })

    const stdout = new CollectingWritable()
    await handleHookCommand('SessionStart', baseOptions, mockLogger, stdout)

    expect(mockClose).toHaveBeenCalledOnce()
  })
})
