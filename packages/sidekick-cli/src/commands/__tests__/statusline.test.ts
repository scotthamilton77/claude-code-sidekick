/**
 * Tests for statusline command handler.
 *
 * Verifies BEHAVIOR of handleStatuslineCommand:
 * - Exit codes (always 0 for graceful degradation)
 * - Output format (text vs JSON)
 * - Error handling (graceful fallback)
 *
 * @see statusline.ts handleStatuslineCommand
 */
import { Writable } from 'node:stream'
import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Mock node:fs for existsSync control in persona polling tests
// vi.hoisted ensures the variable is available when the hoisted vi.mock factory runs
const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: mockExistsSync,
  }
})

// Mock the service factory
const mockRender = vi.fn()
const mockCreateStatuslineService = vi.fn(() => ({
  render: mockRender,
}))

// Mock the feature-statusline package
vi.mock('@sidekick/feature-statusline', () => ({
  createStatuslineService: mockCreateStatuslineService,
}))

// Mock @sidekick/core to avoid SetupStatusService spawning subprocesses
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    SetupStatusService: vi.fn().mockImplementation(function () {
      return { getDevMode: vi.fn().mockResolvedValue(false) }
    }),
  }
})

import { handleStatuslineCommand } from '../statusline'

describe('handleStatuslineCommand', () => {
  let stdout: CollectingWritable
  let logger: Logger

  beforeEach(() => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()
    vi.clearAllMocks()
    // Reset existsSync (clearAllMocks doesn't reset implementation)
    mockExistsSync.mockReset()
    mockExistsSync.mockReturnValue(true)
  })

  describe('successful render', () => {
    const mockRenderResult = {
      text: '[session] opus | 50k tokens | $0.42',
      displayMode: 'active' as const,
      staleData: false,
      viewModel: {
        model: 'opus',
        tokens: '50k',
        cost: '$0.42',
        duration: '5m',
        // Required fields for statusline.ts event logging
        tokenUsageActual: '50k',
        tokenUsageEffective: '100k',
      },
    }

    test('outputs text format by default', async () => {
      mockRender.mockResolvedValue(mockRenderResult)

      const result = await handleStatuslineCommand('/project', logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toBe('[session] opus | 50k tokens | $0.42\n')
    })

    test('outputs text format when explicitly requested', async () => {
      mockRender.mockResolvedValue(mockRenderResult)

      const result = await handleStatuslineCommand('/project', logger, stdout, {
        format: 'text',
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('opus')
    })

    test('outputs JSON format when requested', async () => {
      mockRender.mockResolvedValue(mockRenderResult)

      const result = await handleStatuslineCommand('/project', logger, stdout, {
        format: 'json',
      })

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data.trim())
      expect(output.model).toBe('opus')
      expect(output.tokens).toBe('50k')
      expect(output.cost).toBe('$0.42')
    })

    test('returns exit code 0 on success', async () => {
      mockRender.mockResolvedValue(mockRenderResult)

      const result = await handleStatuslineCommand('/project', logger, stdout)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('options handling', () => {
    test('passes sessionId to service', async () => {
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        sessionId: 'test-session-123',
      })

      // Service was created with correct sessionId
      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session-123',
        })
      )
    })

    test('passes hookInput to service when provided', async () => {
      const hookInput = {
        hook_event_name: 'Status' as const,
        session_id: 'abc123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project/dir',
        version: '1.0.0',
        model: { id: 'claude-opus', display_name: 'Opus' },
        workspace: { current_dir: '/project/dir', project_dir: '/project' },
        output_style: { name: 'default' },
        cost: {
          total_cost_usd: 0.42,
          total_duration_ms: 30000,
          total_api_duration_ms: 25000,
          total_lines_added: 100,
          total_lines_removed: 50,
        },
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          context_window_size: 200000,
          current_usage: null,
        },
      }

      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        hookInput,
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          hookInput,
        })
      )
    })

    test('passes isResumed flag to service', async () => {
      mockRender.mockResolvedValue({
        text: 'resumed',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        isResumed: true,
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          isResumedSession: true,
        })
      )
    })

    test('defaults sessionId to "current"', async () => {
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {})

      // Defaults to 'current' sessionId when not specified
      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'current',
        })
      )
    })
  })

  describe('error handling - graceful degradation', () => {
    test('returns exit code 0 even on render error', async () => {
      mockRender.mockRejectedValue(new Error('Service failed'))

      const result = await handleStatuslineCommand('/project', logger, stdout)

      expect(result.exitCode).toBe(0) // Don't fail the shell prompt
    })

    test('outputs fallback text on error in text mode', async () => {
      mockRender.mockRejectedValue(new Error('Service failed'))

      await handleStatuslineCommand('/project', logger, stdout, {
        format: 'text',
      })

      expect(stdout.data).toBe('[sidekick]\n')
    })

    test('outputs error JSON on error in json mode', async () => {
      mockRender.mockRejectedValue(new Error('Service failed'))

      await handleStatuslineCommand('/project', logger, stdout, {
        format: 'json',
      })

      const output = JSON.parse(stdout.data.trim())
      expect(output.error).toBe('render_failed')
    })

    test('logs warning on error', async () => {
      mockRender.mockRejectedValue(new Error('Service failed'))

      await handleStatuslineCommand('/project', logger, stdout)

      expect(logger.warn).toHaveBeenCalledWith(
        'Statusline render failed',
        expect.objectContaining({ durationMs: expect.any(Number) })
      )
    })
  })

  describe('service configuration', () => {
    test('passes configService when provided', async () => {
      const mockConfigService = { core: {}, getFeature: vi.fn() }
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        configService: mockConfigService as never,
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          configService: mockConfigService,
        })
      )
    })

    test('passes asset resolver when provided', async () => {
      const mockAssets = { resolve: vi.fn() }
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        assets: mockAssets as never,
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          assets: mockAssets,
        })
      )
    })

    test('enables colors for text format', async () => {
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        format: 'text',
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          useColors: true,
        })
      )
    })

    test('disables colors for json format', async () => {
      mockRender.mockResolvedValue({
        text: 'test',
        displayMode: 'active',
        staleData: false,
        viewModel: {},
      })

      await handleStatuslineCommand('/project', logger, stdout, {
        format: 'json',
      })

      expect(mockCreateStatuslineService).toHaveBeenCalledWith(
        expect.objectContaining({
          useColors: false,
        })
      )
    })
  })

  describe('persona file polling (new session race condition)', () => {
    const mockRenderResult = {
      text: '[session] opus | 50k tokens | $0.42',
      displayMode: 'active' as const,
      staleData: false,
      viewModel: {
        model: 'opus',
        tokenUsageActual: '50k',
        tokenUsageEffective: '100k',
      },
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    test('skips polling when sessionId is "current"', async () => {
      mockExistsSync.mockReturnValue(false)
      mockRender.mockResolvedValue(mockRenderResult)

      await handleStatuslineCommand('/project', logger, stdout)

      // Should not check for persona file when sessionId is 'current'
      expect(mockExistsSync).not.toHaveBeenCalledWith(expect.stringContaining('session-persona.json'))
    })

    test('skips polling when persona file already exists', async () => {
      mockExistsSync.mockReturnValue(true)
      mockRender.mockResolvedValue(mockRenderResult)

      await handleStatuslineCommand('/project', logger, stdout, {
        sessionId: 'test-session',
      })

      // File exists on first check — no polling, no log
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Persona file'), expect.anything())
    })

    test('polls and finds persona file', async () => {
      let callCount = 0
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('session-persona.json')) {
          return ++callCount > 3
        }
        return true
      })
      mockRender.mockResolvedValue(mockRenderResult)

      await handleStatuslineCommand('/project', logger, stdout, {
        sessionId: 'test-session',
      })

      expect(logger.info).toHaveBeenCalledWith(
        'Persona file appeared after polling',
        expect.objectContaining({
          sessionId: 'test-session',
          waitedMs: expect.any(Number),
        })
      )
    })

    test('logs timeout when persona file never appears', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] })
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('session-persona.json')) return false
        return true
      })
      mockRender.mockResolvedValue(mockRenderResult)

      const promise = handleStatuslineCommand('/project', logger, stdout, {
        sessionId: 'test-session',
      })

      await vi.advanceTimersByTimeAsync(1100)
      await promise

      expect(logger.info).toHaveBeenCalledWith(
        'Persona file poll timed out',
        expect.objectContaining({
          sessionId: 'test-session',
          waitedMs: expect.any(Number),
        })
      )
    })
  })
})
