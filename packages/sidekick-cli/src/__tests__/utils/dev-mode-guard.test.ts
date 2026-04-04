/**
 * Tests for shared dev-mode conflict detection guard.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import type { Logger } from '@sidekick/types'
import { checkDevModeConflict } from '../../utils/dev-mode-guard.js'

// Track mock calls for SetupStatusService
const mockGetDevMode = vi.fn()
const mockSetDevMode = vi.fn()

vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    toErrorMessage: actual.toErrorMessage,
    SetupStatusService: vi.fn().mockImplementation(function () {
      return {
        getDevMode: mockGetDevMode,
        setDevMode: mockSetDevMode,
      }
    }),
  }
})

describe('checkDevModeConflict', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createFakeLogger()
    mockGetDevMode.mockClear()
    mockSetDevMode.mockClear()
  })

  describe('when forceDevMode is true (dev-mode hooks)', () => {
    test('returns "proceed" when devMode flag is already on', async () => {
      mockGetDevMode.mockResolvedValue(true)

      const result = await checkDevModeConflict('/project', true, logger, 'test-hook')

      expect(result).toBe('proceed')
      expect(mockSetDevMode).not.toHaveBeenCalled()
    })

    test('auto-corrects devMode flag when off and returns "proceed"', async () => {
      mockGetDevMode.mockResolvedValue(false)

      const result = await checkDevModeConflict('/project', true, logger, 'test-hook')

      expect(result).toBe('proceed')
      expect(mockSetDevMode).toHaveBeenCalledWith(true)
    })

    test('returns "proceed" even if auto-correct fails', async () => {
      mockGetDevMode.mockResolvedValue(false)
      mockSetDevMode.mockRejectedValue(new Error('disk full'))

      // This should NOT throw -- errors are logged, not thrown
      const result = await checkDevModeConflict('/project', true, logger, 'test-hook')

      expect(result).toBe('proceed')
    })

    test('returns "proceed" if getDevMode throws', async () => {
      mockGetDevMode.mockRejectedValue(new Error('permission denied'))

      const result = await checkDevModeConflict('/project', true, logger, 'test-hook')

      expect(result).toBe('proceed')
    })
  })

  describe('when forceDevMode is false/undefined (plugin hooks)', () => {
    test('returns "bail" when devMode is active', async () => {
      mockGetDevMode.mockResolvedValue(true)

      const result = await checkDevModeConflict('/project', false, logger, 'test-hook')

      expect(result).toBe('bail')
    })

    test('returns "proceed" when devMode is not active', async () => {
      mockGetDevMode.mockResolvedValue(false)

      const result = await checkDevModeConflict('/project', false, logger, 'test-hook')

      expect(result).toBe('proceed')
    })

    test('returns "proceed" when undefined (fail open)', async () => {
      mockGetDevMode.mockResolvedValue(false)

      const result = await checkDevModeConflict('/project', undefined, logger, 'test-hook')

      expect(result).toBe('proceed')
    })

    test('returns "proceed" if getDevMode throws (fail open)', async () => {
      mockGetDevMode.mockRejectedValue(new Error('file not found'))

      const result = await checkDevModeConflict('/project', false, logger, 'test-hook')

      expect(result).toBe('proceed')
    })
  })
})
