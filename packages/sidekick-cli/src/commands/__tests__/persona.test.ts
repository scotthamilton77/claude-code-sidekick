/**
 * Tests for persona command handler.
 *
 * Verifies BEHAVIOR of handlePersonaCommand:
 * - Routes subcommands correctly (list, set, clear, test, help)
 * - Validates required parameters (session-id, persona-id)
 * - Outputs correct formats (JSON, table)
 * - Handles errors gracefully
 *
 * @see persona.ts handlePersonaCommand
 */
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'

// Mock @sidekick/core before importing the module under test
// Note: vi.mock is hoisted, so we use vi.hoisted to define mock functions
const {
  mockDaemonStart,
  mockIpcSend,
  mockIpcClose,
  mockDiscoverPersonas,
  mockGetDefaultPersonasDir,
  mockStateServiceDelete,
  mockPersonaAccessorRead,
  mockPersonaAccessorWrite,
  mockConfigSet,
  mockConfigGet,
  mockConfigUnset,
} = vi.hoisted(() => ({
  mockDaemonStart: vi.fn(),
  mockIpcSend: vi.fn(),
  mockIpcClose: vi.fn(),
  mockDiscoverPersonas: vi.fn(),
  mockGetDefaultPersonasDir: vi.fn(),
  mockStateServiceDelete: vi.fn(),
  mockPersonaAccessorRead: vi.fn(),
  mockPersonaAccessorWrite: vi.fn(),
  mockConfigSet: vi.fn(),
  mockConfigGet: vi.fn(),
  mockConfigUnset: vi.fn(),
}))

vi.mock('@sidekick/core', () => {
  return {
    DaemonClient: vi.fn().mockImplementation(function () {
      return { start: mockDaemonStart }
    }),
    IpcService: vi.fn().mockImplementation(function () {
      return { send: mockIpcSend, close: mockIpcClose }
    }),
    StateService: vi.fn().mockImplementation(function () {
      return {
        sessionStatePath: vi.fn().mockReturnValue('/mock/path/to/state.json'),
        delete: mockStateServiceDelete,
      }
    }),
    SessionStateAccessor: vi.fn().mockImplementation(function () {
      return { read: mockPersonaAccessorRead, write: mockPersonaAccessorWrite }
    }),
    sessionState: vi.fn().mockReturnValue({
      filename: 'session-persona.json',
      schema: {},
      defaultValue: null,
    }),
    discoverPersonas: mockDiscoverPersonas,
    getDefaultPersonasDir: mockGetDefaultPersonasDir,
    configSet: mockConfigSet,
    configGet: mockConfigGet,
    configUnset: mockConfigUnset,
  }
})

/** Writable that collects output for assertions. */
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

import { handlePersonaCommand } from '../persona'

describe('handlePersonaCommand', () => {
  let stdout: CollectingWritable
  let logger: Logger
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
    // Reset state accessor mocks
    mockPersonaAccessorRead.mockResolvedValue({ data: null, source: 'default' })
    mockPersonaAccessorWrite.mockResolvedValue(undefined)
    mockStateServiceDelete.mockResolvedValue(undefined)
    // Config writer mocks
    mockConfigSet.mockReturnValue({
      domain: 'features',
      path: ['session-summary', 'personas', 'pinnedPersona'],
      value: 'marvin',
      filePath: '/mock/.sidekick/features.yaml',
    })
    mockConfigGet.mockReturnValue(undefined)
    mockConfigUnset.mockReturnValue({
      domain: 'features',
      path: ['session-summary', 'personas', 'pinnedPersona'],
      filePath: '/mock/.sidekick/features.yaml',
      existed: true,
    })
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

    test('sets persona successfully via direct file write', async () => {
      mockPersonaAccessorRead.mockResolvedValueOnce({ data: { persona_id: 'skippy' }, source: 'fresh' })

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      // Verify direct file write instead of IPC
      expect(mockPersonaAccessorWrite).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          persona_id: 'marvin',
          selected_from: expect.arrayContaining(['marvin', 'skippy']),
          timestamp: expect.any(String),
        })
      )
      // Verify no IPC call was made for persona set
      expect(mockIpcSend).not.toHaveBeenCalledWith('persona.set', expect.anything())

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBe('marvin')
      expect(output.previousPersonaId).toBe('skippy')
    })

    test('sets persona with no previous persona', async () => {
      mockPersonaAccessorRead.mockResolvedValueOnce({ data: null, source: 'default' })

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      expect(mockPersonaAccessorWrite).toHaveBeenCalled()

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBe('marvin')
      expect(output.previousPersonaId).toBeNull()
    })

    test('rejects unknown persona', async () => {
      const result = await handlePersonaCommand('set', ['nonexistent'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Persona "nonexistent" not found')
      expect(output.error).toContain('marvin')
      expect(output.error).toContain('skippy')
    })

    test('handles write failure', async () => {
      mockPersonaAccessorWrite.mockRejectedValueOnce(new Error('Disk full'))

      const result = await handlePersonaCommand('set', ['marvin'], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Disk full')
    })
  })

  describe('persona clear', () => {
    test('requires session ID', async () => {
      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona clear requires --session-id')
    })

    test('clears persona successfully via direct file deletion', async () => {
      mockPersonaAccessorRead.mockResolvedValueOnce({ data: { persona_id: 'marvin' }, source: 'fresh' })

      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      // Verify direct file deletion instead of IPC
      expect(mockStateServiceDelete).toHaveBeenCalledWith('/mock/path/to/state.json')
      // Verify no IPC call was made
      expect(mockIpcSend).not.toHaveBeenCalledWith('persona.set', expect.anything())

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBeNull()
      expect(output.previousPersonaId).toBe('marvin')
    })

    test('clears persona with no previous persona', async () => {
      mockPersonaAccessorRead.mockResolvedValueOnce({ data: null, source: 'default' })

      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(0)
      expect(mockStateServiceDelete).toHaveBeenCalled()

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBeNull()
      expect(output.previousPersonaId).toBeNull()
    })

    test('handles delete failure', async () => {
      mockStateServiceDelete.mockRejectedValueOnce(new Error('Permission denied'))

      const result = await handlePersonaCommand('clear', [], projectRoot, logger, stdout, {
        sessionId: 'test-session',
      })

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Permission denied')
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

  describe('persona pin', () => {
    test('requires persona ID', async () => {
      const result = await handlePersonaCommand('pin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona pin requires a persona ID')
    })

    test('pins persona at project scope by default', async () => {
      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(mockConfigSet).toHaveBeenCalledWith(
        'features.session-summary.settings.personas.pinnedPersona',
        'marvin',
        expect.objectContaining({ scope: 'project', projectRoot })
      )

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBe('marvin')
      expect(output.scope).toBe('project')
    })

    test('pins persona at user scope when specified', async () => {
      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, { scope: 'user' })

      expect(result.exitCode).toBe(0)
      expect(mockConfigSet).toHaveBeenCalledWith(
        'features.session-summary.settings.personas.pinnedPersona',
        'marvin',
        expect.objectContaining({ scope: 'user' })
      )

      const output = JSON.parse(stdout.data)
      expect(output.scope).toBe('user')
    })

    test('rejects unknown persona', async () => {
      const result = await handlePersonaCommand('pin', ['nonexistent'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(mockConfigSet).not.toHaveBeenCalled()

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Persona "nonexistent" not found')
    })

    test('handles configSet failure', async () => {
      mockConfigSet.mockImplementationOnce(() => {
        throw new Error('Write failed')
      })

      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Write failed')
    })
  })

  describe('persona unpin', () => {
    test('unpins persona from project scope by default', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'marvin', domain: 'features', path: [] })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(mockConfigUnset).toHaveBeenCalledWith(
        'features.session-summary.settings.personas.pinnedPersona',
        expect.objectContaining({ scope: 'project', projectRoot })
      )

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.scope).toBe('project')
      expect(output.previousPersonaId).toBe('marvin')
    })

    test('unpins persona from user scope when specified', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'skippy', domain: 'features', path: [] })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, { scope: 'user' })

      expect(result.exitCode).toBe(0)
      expect(mockConfigUnset).toHaveBeenCalledWith(
        'features.session-summary.settings.personas.pinnedPersona',
        expect.objectContaining({ scope: 'user' })
      )

      const output = JSON.parse(stdout.data)
      expect(output.scope).toBe('user')
      expect(output.previousPersonaId).toBe('skippy')
    })

    test('succeeds idempotently when no pin exists', async () => {
      mockConfigGet.mockReturnValueOnce(undefined)
      mockConfigUnset.mockReturnValueOnce({
        existed: false,
        domain: 'features',
        path: [],
        filePath: '/mock/.sidekick/features.yaml',
      })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.previousPersonaId).toBeNull()
    })

    test('handles configUnset failure', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'marvin', domain: 'features', path: [] })
      mockConfigUnset.mockImplementationOnce(() => {
        throw new Error('Permission denied')
      })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Permission denied')
    })
  })
})
