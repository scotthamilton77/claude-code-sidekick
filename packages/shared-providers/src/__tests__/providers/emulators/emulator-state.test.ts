// @ts-nocheck - vitest 4.x Mock<Procedure | Constructable> type incompatibility. See beads issue for cleanup task.
/**
 * EmulatorStateManager Tests
 *
 * Tests the state management for LLM emulators including
 * file persistence, call counting, and reset functionality.
 */

import { describe, it, expect, vi } from 'vitest'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EmulatorStateManager } from '../../../providers/emulators/emulator-state'

// Fake logger that captures calls
function createFakeLogger(): any {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  }
}

// Helper to create isolated test context - each test gets its own directory
async function createTestContext(): Promise<{
  testSubDir: string
  statePath: string
  logger: ReturnType<typeof createFakeLogger>
  manager: EmulatorStateManager
  cleanup: () => Promise<void>
}> {
  const testSubDir = join('/tmp/claude/emulator-state-test', randomUUID())
  await mkdir(testSubDir, { recursive: true })
  const statePath = join(testSubDir, 'state.json')
  const logger = createFakeLogger()
  const manager = new EmulatorStateManager(statePath, logger)

  return {
    testSubDir,
    statePath,
    logger,
    manager,
    cleanup: async () => rm(testSubDir, { recursive: true, force: true }),
  }
}

describe('EmulatorStateManager', () => {
  describe('load', () => {
    it('creates new state file when none exists', async () => {
      const ctx = await createTestContext()
      try {
        const state = await ctx.manager.load()

        expect(state).toEqual({
          version: 1,
          providers: {},
        })
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          'Emulator state file not found, creating new state',
          expect.objectContaining({ path: ctx.statePath })
        )

        // Verify file was created
        const content = await readFile(ctx.statePath, 'utf-8')
        expect(JSON.parse(content)).toEqual({ version: 1, providers: {} })
      } finally {
        await ctx.cleanup()
      }
    })

    it('loads existing state from file', async () => {
      const ctx = await createTestContext()
      try {
        // Pre-create state file
        const existingState = {
          version: 1,
          providers: {
            openai: { callCount: 5, lastCallAt: '2025-01-01T00:00:00.000Z' },
          },
        }
        await writeFile(ctx.statePath, JSON.stringify(existingState))

        // Create fresh manager to load from file
        const freshManager = new EmulatorStateManager(ctx.statePath, ctx.logger)
        const state = await freshManager.load()

        expect(state).toEqual(existingState)
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          'Loaded emulator state',
          expect.objectContaining({ path: ctx.statePath, providerCount: 1 })
        )
      } finally {
        await ctx.cleanup()
      }
    })

    it('returns cached state on subsequent calls', async () => {
      const ctx = await createTestContext()
      try {
        const state1 = await ctx.manager.load()
        const state2 = await ctx.manager.load()

        expect(state1).toBe(state2) // Same object reference
        // Debug for "not found" should only be called once
        expect(ctx.logger.debug.mock.calls.filter((c) => (c[0] as string).includes('not found')).length).toBe(1)
      } finally {
        await ctx.cleanup()
      }
    })

    it('uses defaults when file read fails with non-ENOENT error', async () => {
      const ctx = await createTestContext()
      try {
        // Create a directory where the file should be - this will cause a read error
        await mkdir(ctx.statePath, { recursive: true })

        const freshManager = new EmulatorStateManager(ctx.statePath, ctx.logger)
        const state = await freshManager.load()

        expect(state).toEqual({ version: 1, providers: {} })
        expect(ctx.logger.warn).toHaveBeenCalledWith(
          'Failed to load emulator state, using defaults',
          expect.objectContaining({ path: ctx.statePath })
        )
      } finally {
        await ctx.cleanup()
      }
    })
  })

  describe('incrementCallCount', () => {
    it('increments count for new provider', async () => {
      const ctx = await createTestContext()
      try {
        const count = await ctx.manager.incrementCallCount('openai')

        expect(count).toBe(1)
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          'Incremented emulator call count',
          expect.objectContaining({ providerId: 'openai', callCount: 1 })
        )
      } finally {
        await ctx.cleanup()
      }
    })

    it('increments count for existing provider', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openai')
        const count = await ctx.manager.incrementCallCount('openai')

        expect(count).toBe(3)
      } finally {
        await ctx.cleanup()
      }
    })

    it('tracks multiple providers independently', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openrouter')

        const openaiCount = await ctx.manager.getCallCount('openai')
        const openrouterCount = await ctx.manager.getCallCount('openrouter')

        expect(openaiCount).toBe(2)
        expect(openrouterCount).toBe(1)
      } finally {
        await ctx.cleanup()
      }
    })

    it('persists state to disk after increment', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')

        // Read file directly to verify persistence
        const content = await readFile(ctx.statePath, 'utf-8')
        const state = JSON.parse(content)

        expect(state.providers.openai.callCount).toBe(1)
        expect(state.providers.openai.lastCallAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      } finally {
        await ctx.cleanup()
      }
    })
  })

  describe('getCallCount', () => {
    it('returns 0 for unknown provider', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.load()
        const count = await ctx.manager.getCallCount('unknown-provider')

        expect(count).toBe(0)
      } finally {
        await ctx.cleanup()
      }
    })

    it('returns correct count for known provider', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openai')

        const count = await ctx.manager.getCallCount('openai')
        expect(count).toBe(2)
      } finally {
        await ctx.cleanup()
      }
    })
  })

  describe('reset', () => {
    it('resets specific provider when providerId given', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openrouter')
        await ctx.manager.reset('openai')

        const openaiCount = await ctx.manager.getCallCount('openai')
        const openrouterCount = await ctx.manager.getCallCount('openrouter')

        expect(openaiCount).toBe(0)
        expect(openrouterCount).toBe(1)
        expect(ctx.logger.info).toHaveBeenCalledWith('Reset emulator state for provider', { providerId: 'openai' })
      } finally {
        await ctx.cleanup()
      }
    })

    it('resets all providers when no providerId given', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.incrementCallCount('openrouter')
        await ctx.manager.reset()

        const openaiCount = await ctx.manager.getCallCount('openai')
        const openrouterCount = await ctx.manager.getCallCount('openrouter')

        expect(openaiCount).toBe(0)
        expect(openrouterCount).toBe(0)
        expect(ctx.logger.info).toHaveBeenCalledWith('Reset all emulator state')
      } finally {
        await ctx.cleanup()
      }
    })

    it('persists reset state to disk', async () => {
      const ctx = await createTestContext()
      try {
        await ctx.manager.incrementCallCount('openai')
        await ctx.manager.reset()

        // Read file directly to verify persistence
        const content = await readFile(ctx.statePath, 'utf-8')
        const state = JSON.parse(content)

        expect(state.providers).toEqual({})
      } finally {
        await ctx.cleanup()
      }
    })
  })

  describe('save error handling', () => {
    it('throws and logs when save fails', async () => {
      // Use an invalid path that can't be written to
      const invalidPath = '/nonexistent-root-dir/state.json'
      const logger = createFakeLogger()
      const manager = new EmulatorStateManager(invalidPath, logger)

      await expect(manager.incrementCallCount('openai')).rejects.toThrow()
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save emulator state',
        expect.objectContaining({ path: invalidPath })
      )
    })
  })
})
