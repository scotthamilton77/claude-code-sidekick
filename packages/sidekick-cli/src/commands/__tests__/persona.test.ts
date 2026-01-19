/**
 * Tests for persona command handler.
 *
 * Verifies BEHAVIOR of handlePersonaCommand:
 * - Routes subcommands correctly (list, set, clear, test, help)
 * - Validates required parameters (session-id, persona-id)
 * - Outputs correct formats (JSON, table)
 * - Handles errors gracefully
 *
 * Uses mocks for IPC-dependent operations (DaemonClient, IpcService).
 *
 * @see persona.ts handlePersonaCommand
 */
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach } from 'vitest'

// Mock @sidekick/core before importing the module under test
// Note: vi.mock is hoisted, so we use vi.hoisted to define mock functions
const { mockDaemonStart, mockIpcSend, mockIpcClose, mockDiscoverPersonas, mockGetDefaultPersonasDir } = vi.hoisted(
  () => ({
    mockDaemonStart: vi.fn(),
    mockIpcSend: vi.fn(),
    mockIpcClose: vi.fn(),
    mockDiscoverPersonas: vi.fn(),
    mockGetDefaultPersonasDir: vi.fn(),
  })
)

vi.mock('@sidekick/core', () => {
  return {
    DaemonClient: vi.fn().mockImplementation(() => ({
      start: mockDaemonStart,
    })),
    IpcService: vi.fn().mockImplementation(() => ({
      send: mockIpcSend,
      close: mockIpcClose,
    })),
    StateService: vi.fn().mockImplementation(() => ({
      sessionStatePath: vi.fn().mockReturnValue('/mock/path/to/state.json'),
    })),
    discoverPersonas: mockDiscoverPersonas,
    getDefaultPersonasDir: mockGetDefaultPersonasDir,
  }
})

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Create fake logger
function createFakeLogger(): {
  trace: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  fatal: ReturnType<typeof vi.fn>
  child: ReturnType<typeof vi.fn>
  flush: ReturnType<typeof vi.fn>
} {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
    flush: vi.fn(),
  }
}

import { handlePersonaCommand } from '../persona'

describe('handlePersonaCommand', () => {
  let stdout: CollectingWritable
  let logger: ReturnType<typeof createFakeLogger>
  const projectRoot = '/mock/project'

  beforeEach(() => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()

    // Reset all mocks to default behavior
    vi.clearAllMocks()
    mockDaemonStart.mockResolvedValue(undefined)
    mockIpcSend.mockResolvedValue({ success: true })
    mockGetDefaultPersonasDir.mockReturnValue('/mock/assets/personas')
    mockDiscoverPersonas.mockReturnValue(
      new Map([
        ['marvin', { id: 'marvin', display_name: 'Marvin', theme: 'Depressed robot' }],
        ['skippy', { id: 'skippy', display_name: 'Skippy', theme: 'Snarky AI' }],
      ])
    )
  })

  describe('subcommand routing', () => {
    test('shows help when no subcommand provided', async () => {
      const result = await handlePersonaCommand(undefined, [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Error: persona command requires a subcommand')
      expect(stdout.data).toContain('Usage: sidekick persona <subcommand>')
    })

    test('shows help for unknown subcommand', async () => {
      const result = await handlePersonaCommand('unknown', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Error: Unknown persona subcommand: unknown')
      expect(stdout.data).toContain('Usage: sidekick persona <subcommand>')
    })

    test('shows help for help subcommand', async () => {
      const result = await handlePersonaCommand('help', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick persona <subcommand>')
      expect(stdout.data).toContain('list')
      expect(stdout.data).toContain('set')
      expect(stdout.data).toContain('clear')
      expect(stdout.data).toContain('test')
    })

    test('shows help for --help flag', async () => {
      const result = await handlePersonaCommand('--help', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick persona <subcommand>')
    })

    test('shows help for -h flag', async () => {
      const result = await handlePersonaCommand('-h', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick persona <subcommand>')
    })
  })

  describe('persona list', () => {
    test('lists personas in JSON format by default', async () => {
      const result = await handlePersonaCommand('list', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(mockDiscoverPersonas).toHaveBeenCalledWith({
        defaultPersonasDir: '/mock/assets/personas',
        projectRoot,
        logger,
      })

      const output = JSON.parse(stdout.data)
      expect(output.personas).toHaveLength(2)
      expect(output.personas[0].id).toBe('marvin')
      expect(output.personas[1].id).toBe('skippy')
      expect(output.count).toBe(2)
    })

    test('lists personas in table format when requested', async () => {
      const result = await handlePersonaCommand('list', [], projectRoot, logger, stdout, { format: 'table' })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Available Personas (2)')
      expect(stdout.data).toContain('marvin')
      expect(stdout.data).toContain('Marvin')
      expect(stdout.data).toContain('skippy')
      expect(stdout.data).toContain('Skippy')
    })

    test('shows empty message in table format when no personas', async () => {
      mockDiscoverPersonas.mockReturnValueOnce(new Map())

      const result = await handlePersonaCommand('list', [], projectRoot, logger, stdout, { format: 'table' })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('No personas found')
    })

    test('returns empty array in JSON format when no personas', async () => {
      mockDiscoverPersonas.mockReturnValueOnce(new Map())

      const result = await handlePersonaCommand('list', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.personas).toHaveLength(0)
      expect(output.count).toBe(0)
    })
  })

  describe('persona set', () => {
    test('requires persona ID', async () => {
      const result = await handlePersonaCommand('set', [], projectRoot, logger, stdout, { sessionId: 'test-session' })

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona set requires a persona ID')
    })

    test('requires session ID', async () => {
      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona set requires --session-id')
    })

    test('sets persona successfully', async () => {
      mockIpcSend.mockResolvedValueOnce({ success: true, previousPersonaId: 'skippy' })

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      expect(mockIpcSend).toHaveBeenCalledWith('persona.set', { sessionId: 'test-session', personaId: 'marvin' })

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBe('marvin')
      expect(output.previousPersonaId).toBe('skippy')
    })

    test('handles IPC null response', async () => {
      mockIpcSend.mockResolvedValueOnce(null)

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('No response from daemon')
    })

    test('handles daemon start failure', async () => {
      mockDaemonStart.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Connection refused')
    })

    test('handles IPC failure response', async () => {
      mockIpcSend.mockResolvedValueOnce({ success: false, error: 'Persona not found' })

      const result = await handlePersonaCommand('set', ['nonexistent'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toBe('Persona not found')
    })
  })

  describe('persona clear', () => {
    test('requires session ID', async () => {
      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona clear requires --session-id')
    })

    test('clears persona successfully', async () => {
      mockIpcSend.mockResolvedValueOnce({ success: true, previousPersonaId: 'marvin' })

      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      expect(mockIpcSend).toHaveBeenCalledWith('persona.set', { sessionId: 'test-session', personaId: null })

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBeNull()
      expect(output.previousPersonaId).toBe('marvin')
    })

    test('handles clear failure', async () => {
      mockIpcSend.mockResolvedValueOnce({ success: false, error: 'Session not found' })

      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {
        sessionId: 'unknown-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
    })
  })

  describe('persona test', () => {
    test('requires persona ID', async () => {
      const result = await handlePersonaCommand('test', [], projectRoot, logger, stdout, { sessionId: 'test-session' })

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona test requires a persona ID')
    })

    test('requires session ID', async () => {
      const result = await handlePersonaCommand('test', ['skippy'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona test requires --session-id')
    })

    test('calls snarky.generate by default', async () => {
      mockIpcSend.mockResolvedValue({ success: true })

      // Test will fail at readFile step since we're not mocking fs, but we can verify IPC calls
      await handlePersonaCommand('test', ['skippy'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(mockIpcSend).toHaveBeenCalledWith('persona.set', { sessionId: 'test-session', personaId: 'skippy' })
      expect(mockIpcSend).toHaveBeenCalledWith('snarky.generate', { sessionId: 'test-session' })
    })

    test('calls resume.generate when type is resume', async () => {
      mockIpcSend.mockResolvedValue({ success: true })

      await handlePersonaCommand('test', ['skippy'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
        testType: 'resume',
      })

      expect(mockIpcSend).toHaveBeenCalledWith('resume.generate', { sessionId: 'test-session' })
    })

    test('handles persona.set failure in test', async () => {
      mockIpcSend.mockResolvedValueOnce({ success: false, error: 'Unknown persona' })

      const result = await handlePersonaCommand('test', ['unknown'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.error).toContain('Failed to set persona')
    })

    test('handles generation failure', async () => {
      mockIpcSend
        .mockResolvedValueOnce({ success: true }) // persona.set succeeds
        .mockResolvedValueOnce({ success: false, error: 'Generation error' }) // snarky.generate fails

      const result = await handlePersonaCommand('test', ['skippy'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.error).toContain('Generation failed')
    })
  })
})
