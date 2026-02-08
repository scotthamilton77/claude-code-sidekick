/**
 * Tests for StateService - unified state management with atomic writes and Zod validation.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import type { Logger } from '@sidekick/types'
import { StateService, StateNotFoundError, StateCorruptError } from '../state-service.js'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDir(): string {
  const dir = join(tmpdir(), `state-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true })
  }
}

function createMockLogger(): Logger {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Test schemas
const TestSchema = z.object({
  value: z.number(),
  name: z.string().optional(),
})
type TestData = z.infer<typeof TestSchema>

const ComplexSchema = z.object({
  items: z.array(z.string()),
  metadata: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

// ============================================================================
// read() Tests
// ============================================================================

describe('StateService', () => {
  let testDir: string
  let state: StateService

  beforeEach(() => {
    testDir = createTestDir()
    state = new StateService(testDir, { logger: createMockLogger() })
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('read()', () => {
    it('returns default when file is missing', async () => {
      const path = state.sessionStatePath('sess-1', 'test.json')
      const defaultValue: TestData = { value: 42 }

      const result = await state.read(path, TestSchema, defaultValue)

      expect(result.source).toBe('default')
      expect(result.data).toEqual({ value: 42 })
    })

    it('returns default from factory function when file is missing', async () => {
      const path = state.sessionStatePath('sess-1', 'test.json')
      const factory = vi.fn(() => ({ value: 99 }))

      const result = await state.read(path, TestSchema, factory)

      expect(result.source).toBe('default')
      expect(result.data).toEqual({ value: 99 })
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('throws StateNotFoundError when file missing and no default provided', async () => {
      const path = state.sessionStatePath('sess-1', 'test.json')

      await expect(state.read(path, TestSchema)).rejects.toThrow(StateNotFoundError)
    })

    it('StateNotFoundError includes the file path', async () => {
      const path = state.sessionStatePath('sess-1', 'missing.json')

      try {
        await state.read(path, TestSchema)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(StateNotFoundError)
        expect((err as StateNotFoundError).path).toBe(path)
      }
    })

    it('recovers corrupt JSON file and returns default', async () => {
      const path = state.sessionStatePath('sess-1', 'corrupt.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'not valid json!!!', 'utf-8')

      const result = await state.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('recovered')
      expect(result.data).toEqual({ value: 0 })
      // Original file moved to .bak
      expect(existsSync(`${path}.bak`)).toBe(true)
      expect(readFileSync(`${path}.bak`, 'utf-8')).toBe('not valid json!!!')
    })

    it('recovers file with schema validation failure and returns default', async () => {
      const path = state.sessionStatePath('sess-1', 'invalid-schema.json')
      mkdirSync(dirname(path), { recursive: true })
      // Valid JSON but wrong schema (value should be number, not string)
      writeFileSync(path, JSON.stringify({ value: 'not a number' }), 'utf-8')

      const result = await state.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('recovered')
      expect(result.data).toEqual({ value: 0 })
      expect(existsSync(`${path}.bak`)).toBe(true)
    })

    it('throws StateCorruptError when file corrupt and no default', async () => {
      const path = state.globalStatePath('corrupt.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'not json', 'utf-8')

      await expect(state.read(path, TestSchema)).rejects.toThrow(StateCorruptError)
    })

    it('StateCorruptError includes path and reason', async () => {
      const path = state.globalStatePath('corrupt.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'bad json', 'utf-8')

      try {
        await state.read(path, TestSchema)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(StateCorruptError)
        const corruptErr = err as StateCorruptError
        expect(corruptErr.path).toBe(path)
        expect(corruptErr.reason).toBe('parse_error')
      }
    })

    it('returns parsed data when file is valid', async () => {
      const path = state.sessionStatePath('sess-1', 'valid.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 123, name: 'test' }), 'utf-8')

      const result = await state.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('fresh')
      expect(result.data).toEqual({ value: 123, name: 'test' })
      expect(result.mtime).toBeDefined()
      expect(result.mtime).toBeGreaterThan(0)
    })

    it('detects stale files based on mtime threshold', async () => {
      const staleState = new StateService(testDir, {
        logger: createMockLogger(),
        staleThresholdMs: 1, // 1ms threshold for testing
      })

      const path = staleState.globalStatePath('stale-test.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      await sleep(10) // Exceed threshold

      const result = await staleState.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('stale')
      expect(result.data).toEqual({ value: 1 })
    })

    it('returns fresh for files within stale threshold', async () => {
      const freshState = new StateService(testDir, {
        logger: createMockLogger(),
        staleThresholdMs: 60000, // 60s threshold
      })

      const path = freshState.globalStatePath('fresh-test.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      const result = await freshState.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('fresh')
    })

    it('treats non-ENOENT errors (like permission denied) as corrupt', async () => {
      const logger = createMockLogger()
      const stateWithLogger = new StateService(testDir, { logger })

      // Create a directory where a file should be - reading it will cause EISDIR
      const path = stateWithLogger.globalStatePath('is-a-directory')
      mkdirSync(path, { recursive: true })

      // Reading a directory with readFile causes EISDIR error
      const result = await stateWithLogger.read(path, TestSchema, { value: 0 })

      // Should be treated as recovered (corrupt file)
      expect(result.source).toBe('recovered')
      expect(result.data).toEqual({ value: 0 })
      // Should have logged the corruption warning
      expect(logger.warn).toHaveBeenCalledWith('Corrupt state file detected', expect.anything())
    })

    it('throws StateCorruptError on non-ENOENT errors without default', async () => {
      const stateService = new StateService(testDir, { logger: createMockLogger() })

      // Create a directory where a file should be
      const path = stateService.globalStatePath('is-also-a-directory')
      mkdirSync(path, { recursive: true })

      await expect(stateService.read(path, TestSchema)).rejects.toThrow(StateCorruptError)
    })
  })

  // ============================================================================
  // write() Tests
  // ============================================================================

  describe('write()', () => {
    it('creates directories and writes file', async () => {
      const path = state.sessionStatePath('new-session', 'new-file.json')

      await state.write(path, { value: 42 }, TestSchema)

      expect(existsSync(path)).toBe(true)
      const content = JSON.parse(readFileSync(path, 'utf-8'))
      expect(content).toEqual({ value: 42 })
    })

    it('writes with proper JSON formatting', async () => {
      const path = state.globalStatePath('formatted.json')

      await state.write(path, { value: 1, name: 'test' }, TestSchema)

      const content = readFileSync(path, 'utf-8')
      // Should be formatted with 2-space indent
      expect(content).toContain('\n')
      expect(content).toContain('  ')
    })

    it('throws on schema validation failure before writing', async () => {
      const path = state.globalStatePath('invalid.json')
      const invalidData = { value: 'not a number' } as unknown as TestData

      await expect(state.write(path, invalidData, TestSchema)).rejects.toThrow()

      // File should not exist since write was rejected
      expect(existsSync(path)).toBe(false)
    })

    it('uses atomic write pattern (no partial files on crash simulation)', async () => {
      const path = state.globalStatePath('atomic.json')

      await state.write(path, { value: 1 }, TestSchema)

      // No .tmp files should remain
      const dir = dirname(path)
      const files = readdirSync(dir)
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
      expect(tmpFiles).toHaveLength(0)
    })

    it('overwrites existing file atomically', async () => {
      const path = state.globalStatePath('overwrite.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      await state.write(path, { value: 999 }, TestSchema)

      const content = JSON.parse(readFileSync(path, 'utf-8'))
      expect(content).toEqual({ value: 999 })
    })

    it('writes complex nested structures correctly', async () => {
      const path = state.sessionStatePath('sess-1', 'complex.json')
      const data = {
        items: ['a', 'b', 'c'],
        metadata: { created: 1000, updated: 2000 },
      }

      await state.write(path, data, ComplexSchema)

      const content = JSON.parse(readFileSync(path, 'utf-8'))
      expect(content).toEqual(data)
    })
  })

  // ============================================================================
  // delete() Tests
  // ============================================================================

  describe('delete()', () => {
    it('removes existing file', async () => {
      const path = state.globalStatePath('to-delete.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')
      expect(existsSync(path)).toBe(true)

      await state.delete(path)

      expect(existsSync(path)).toBe(false)
    })

    it('does not throw when file does not exist', async () => {
      const path = state.globalStatePath('nonexistent.json')

      await expect(state.delete(path)).resolves.not.toThrow()
    })

    it('throws non-ENOENT errors', async () => {
      // Try to delete a directory (not a file) - this causes EISDIR error
      const dirPath = join(testDir, 'a-directory')
      mkdirSync(dirPath, { recursive: true })

      await expect(state.delete(dirPath)).rejects.toThrow()
    })
  })

  // ============================================================================
  // rename() Tests
  // ============================================================================

  describe('rename()', () => {
    it('moves file to new location', async () => {
      const oldPath = state.globalStatePath('old-name.json')
      const newPath = state.globalStatePath('new-name.json')
      mkdirSync(dirname(oldPath), { recursive: true })
      writeFileSync(oldPath, JSON.stringify({ value: 42 }), 'utf-8')

      await state.rename(oldPath, newPath)

      expect(existsSync(oldPath)).toBe(false)
      expect(existsSync(newPath)).toBe(true)
      const content = JSON.parse(readFileSync(newPath, 'utf-8'))
      expect(content).toEqual({ value: 42 })
    })

    it('creates destination directory if needed', async () => {
      const oldPath = state.globalStatePath('source.json')
      const newPath = state.sessionStatePath('new-session', 'dest.json')
      mkdirSync(dirname(oldPath), { recursive: true })
      writeFileSync(oldPath, JSON.stringify({ value: 1 }), 'utf-8')

      await state.rename(oldPath, newPath)

      expect(existsSync(newPath)).toBe(true)
    })

    it('throws when source file does not exist', async () => {
      const oldPath = state.globalStatePath('missing.json')
      const newPath = state.globalStatePath('dest.json')

      await expect(state.rename(oldPath, newPath)).rejects.toThrow()
    })
  })

  // ============================================================================
  // Path Accessor Tests
  // ============================================================================

  describe('path accessors', () => {
    it('sessionStateDir returns correct path', () => {
      const path = state.sessionStateDir('test-session-123')

      expect(path).toBe(join(testDir, '.sidekick', 'sessions', 'test-session-123', 'state'))
    })

    it('sessionStagingDir returns correct path', () => {
      const path = state.sessionStagingDir('test-session-123')

      expect(path).toBe(join(testDir, '.sidekick', 'sessions', 'test-session-123', 'stage'))
    })

    it('rootDir returns correct path', () => {
      const path = state.rootDir()

      expect(path).toBe(join(testDir, '.sidekick'))
    })

    it('sessionsDir returns correct path', () => {
      const path = state.sessionsDir()

      expect(path).toBe(join(testDir, '.sidekick', 'sessions'))
    })

    it('sessionRootDir returns correct path', () => {
      const path = state.sessionRootDir('test-session-456')

      expect(path).toBe(join(testDir, '.sidekick', 'sessions', 'test-session-456'))
    })

    it('globalStateDir returns correct path', () => {
      const path = state.globalStateDir()

      expect(path).toBe(join(testDir, '.sidekick', 'state'))
    })

    it('logsDir returns correct path', () => {
      const path = state.logsDir()

      expect(path).toBe(join(testDir, '.sidekick', 'logs'))
    })

    it('sessionStatePath returns correct path', () => {
      const path = state.sessionStatePath('sess-1', 'my-state.json')

      expect(path).toBe(join(testDir, '.sidekick', 'sessions', 'sess-1', 'state', 'my-state.json'))
    })

    it('globalStatePath returns correct path', () => {
      const path = state.globalStatePath('global.json')

      expect(path).toBe(join(testDir, '.sidekick', 'state', 'global.json'))
    })

    it('hookStagingDir returns correct path', () => {
      const path = state.hookStagingDir('sess-1', 'UserPromptSubmit')

      expect(path).toBe(join(testDir, '.sidekick', 'sessions', 'sess-1', 'stage', 'UserPromptSubmit'))
    })
  })

  // ============================================================================
  // ensureDir() Tests
  // ============================================================================

  describe('ensureDir()', () => {
    it('creates directory if it does not exist', async () => {
      const dir = join(testDir, 'new', 'nested', 'directory')

      await state.ensureDir(dir)

      expect(existsSync(dir)).toBe(true)
    })

    it('does not throw if directory already exists', async () => {
      const dir = join(testDir, 'existing')
      mkdirSync(dir, { recursive: true })

      await expect(state.ensureDir(dir)).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // Cache Tests
  // ============================================================================

  describe('cache (when enabled)', () => {
    it('returns cached value on second read', async () => {
      const cachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: true,
      })

      const path = cachedState.globalStatePath('cached.json')
      await cachedState.write(path, { value: 1 }, TestSchema)

      // First read
      await cachedState.read(path, TestSchema, { value: 0 })

      // Modify file directly (bypassing StateService)
      writeFileSync(path, JSON.stringify({ value: 999 }), 'utf-8')

      // Second read should return cached value, not disk value
      const result = await cachedState.read(path, TestSchema, { value: 0 })

      expect(result.data.value).toBe(1) // Cached, not 999
    })

    it('write updates cache', async () => {
      const cachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: true,
      })

      const path = cachedState.globalStatePath('cache-write.json')
      await cachedState.write(path, { value: 1 }, TestSchema)
      await cachedState.read(path, TestSchema, { value: 0 }) // Populate cache

      // Write new value
      await cachedState.write(path, { value: 2 }, TestSchema)

      // Read should return new value from cache
      const result = await cachedState.read(path, TestSchema, { value: 0 })
      expect(result.data.value).toBe(2)
    })

    it('delete invalidates cache', async () => {
      const cachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: true,
      })

      const path = cachedState.globalStatePath('cache-delete.json')
      await cachedState.write(path, { value: 1 }, TestSchema)
      await cachedState.read(path, TestSchema, { value: 0 }) // Populate cache

      await cachedState.delete(path)

      // Read should return default (file deleted)
      const result = await cachedState.read(path, TestSchema, { value: 0 })
      expect(result.source).toBe('default')
    })

    it('does not cache when cache option is false', async () => {
      const uncachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: false,
      })

      const path = uncachedState.globalStatePath('uncached.json')
      await uncachedState.write(path, { value: 1 }, TestSchema)

      // First read
      await uncachedState.read(path, TestSchema, { value: 0 })

      // Modify file directly
      writeFileSync(path, JSON.stringify({ value: 999 }), 'utf-8')

      // Second read should return disk value (no cache)
      const result = await uncachedState.read(path, TestSchema, { value: 0 })
      expect(result.data.value).toBe(999)
    })

    it('preloadDirectory loads all JSON files into cache', async () => {
      const cachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: true,
      })

      // Create some files in global state dir
      const stateDir = cachedState.globalStateDir()
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'file1.json'), JSON.stringify({ value: 1 }), 'utf-8')
      writeFileSync(join(stateDir, 'file2.json'), JSON.stringify({ value: 2 }), 'utf-8')

      await cachedState.preloadDirectory(stateDir)

      // Modify files on disk
      writeFileSync(join(stateDir, 'file1.json'), JSON.stringify({ value: 999 }), 'utf-8')

      // Reads should return cached values
      const result1 = await cachedState.read(cachedState.globalStatePath('file1.json'), TestSchema, { value: 0 })
      expect(result1.data.value).toBe(1) // Cached
    })

    it('preloadDirectory warns when cache is disabled', async () => {
      const logger = createMockLogger()
      const uncachedState = new StateService(testDir, {
        logger,
        cache: false,
      })

      const stateDir = uncachedState.globalStateDir()
      mkdirSync(stateDir, { recursive: true })

      await uncachedState.preloadDirectory(stateDir)

      expect(logger.warn).toHaveBeenCalledWith('preloadDirectory called but caching is disabled')
    })

    it('preloadDirectory returns early when directory does not exist', async () => {
      const logger = createMockLogger()
      const cachedState = new StateService(testDir, {
        logger,
        cache: true,
      })

      const nonExistentDir = join(testDir, 'does-not-exist')

      // Should not throw, just return early
      await expect(cachedState.preloadDirectory(nonExistentDir)).resolves.not.toThrow()

      // Should not have logged any preload messages
      expect(logger.debug).not.toHaveBeenCalledWith('Preloaded state file', expect.anything())
    })

    it('preloadDirectory warns on invalid JSON files and continues', async () => {
      const logger = createMockLogger()
      const cachedState = new StateService(testDir, {
        logger,
        cache: true,
      })

      // Create directory with a corrupt JSON file
      const stateDir = cachedState.globalStateDir()
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'valid.json'), JSON.stringify({ value: 1 }), 'utf-8')
      writeFileSync(join(stateDir, 'corrupt.json'), 'not valid json!!!', 'utf-8')

      await cachedState.preloadDirectory(stateDir)

      // Should warn about the corrupt file
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to preload state file',
        expect.objectContaining({ file: 'corrupt.json' })
      )

      // Valid file should still be cached
      const result = await cachedState.read(cachedState.globalStatePath('valid.json'), TestSchema, { value: 0 })
      expect(result.data.value).toBe(1)
    })

    it('rename updates cache when source file was cached', async () => {
      const cachedState = new StateService(testDir, {
        logger: createMockLogger(),
        cache: true,
      })

      const oldPath = cachedState.globalStatePath('old-cached.json')
      const newPath = cachedState.globalStatePath('new-cached.json')

      // Write and read to populate cache
      await cachedState.write(oldPath, { value: 42 }, TestSchema)
      await cachedState.read(oldPath, TestSchema, { value: 0 })

      // Rename the file
      await cachedState.rename(oldPath, newPath)

      // Modify the new file on disk directly
      writeFileSync(newPath, JSON.stringify({ value: 999 }), 'utf-8')

      // Read from new path should return cached value (42), not disk value (999)
      const result = await cachedState.read(newPath, TestSchema, { value: 0 })
      expect(result.data.value).toBe(42)

      // Reading from old path should return default (not in cache anymore)
      const oldResult = await cachedState.read(oldPath, TestSchema, { value: 0 })
      expect(oldResult.source).toBe('default')
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('moveToBackup handles rename failure gracefully', async () => {
      const logger = createMockLogger()
      const stateWithLogger = new StateService(testDir, { logger })

      const path = stateWithLogger.globalStatePath('corrupt-readonly.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'not valid json', 'utf-8')

      // Create .bak file to cause rename conflict by making .bak a directory
      const bakPath = `${path}.bak`
      mkdirSync(bakPath, { recursive: true })

      // Read corrupt file with default - should recover and log the backup failure
      const result = await stateWithLogger.read(path, TestSchema, { value: 0 })

      expect(result.source).toBe('recovered')
      // Should have warned about corruption
      expect(logger.warn).toHaveBeenCalledWith('Corrupt state file detected', expect.anything())
      // Should have logged debug about backup failure
      expect(logger.debug).toHaveBeenCalledWith('Could not move corrupt file to backup', { path })
    })

    // SKIPPED: backupBeforeWrite copyFile failure (lines 432-436)
    // This error path requires causing fs.copyFile to fail, which needs either:
    // 1. Mocking fs.copyFile (violates "fakes over mocks" principle)
    // 2. Making directory read-only (chmod doesn't reliably prevent copyFile on macOS)
    // 3. Filling disk space (impractical for unit tests)
    // The behavior is best-effort and doesn't affect the main write path.
    // Recommended refactor: Extract backup logic to a separate class with injectable filesystem.

    it('write throws original error when tmp file write fails', async () => {
      // Create a path where the directory is actually a file (causes mkdir to fail)
      const blockingFilePath = join(testDir, 'blocking-file')
      writeFileSync(blockingFilePath, 'I am a file, not a directory', 'utf-8')

      // Try to write to a path nested under the blocking file
      const path = join(blockingFilePath, 'nested', 'file.json')

      await expect(state.write(path, { value: 1 }, TestSchema)).rejects.toThrow()
    })

    it('write cleans up tmp file on rename failure and rethrows', async () => {
      // This test verifies the error handling path when the atomic rename fails
      // We create a scenario where writeFile succeeds but rename fails
      // by making the destination a directory
      const path = state.globalStatePath('dest-is-dir')
      mkdirSync(path, { recursive: true }) // Create directory where file should go

      // The write should fail because we can't rename a file over a directory
      await expect(state.write(path, { value: 1 }, TestSchema)).rejects.toThrow()

      // The tmp file should have been cleaned up (no .tmp files remaining)
      const dir = dirname(path)
      const files = readdirSync(dir)
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
      expect(tmpFiles).toHaveLength(0)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty JSON object', async () => {
      const EmptySchema = z.object({})
      const path = state.globalStatePath('empty.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '{}', 'utf-8')

      const result = await state.read(path, EmptySchema, {})

      expect(result.source).toBe('fresh')
      expect(result.data).toEqual({})
    })

    it('handles deeply nested session IDs', async () => {
      const sessionId = 'very-long-session-id-with-dashes-and-numbers-123456789'
      const path = state.sessionStatePath(sessionId, 'nested.json')

      await state.write(path, { value: 1 }, TestSchema)

      expect(existsSync(path)).toBe(true)
      expect(path).toContain(sessionId)
    })

    it('handles special characters in filenames', async () => {
      // Filenames that are valid but unusual
      const path = state.sessionStatePath('sess-1', 'file-with-dashes_and_underscores.json')

      await state.write(path, { value: 1 }, TestSchema)

      expect(existsSync(path)).toBe(true)
    })
  })

  // ============================================================================
  // Dev Mode Backup Tests (Allow-list approach)
  // ============================================================================

  describe('dev mode backup', () => {
    it('creates timestamped backup when trackHistory: true and dev mode enabled', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.sessionStatePath('sess-1', 'tracked.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // Write with trackHistory: true - should create backup
      await devState.write(path, { value: 2 }, TestSchema, { trackHistory: true })

      // Check for backup file
      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter((f) => f.startsWith('tracked.') && f.endsWith('.json') && f !== 'tracked.json')

      expect(backupFiles.length).toBe(1)

      // Backup should contain original value
      const backupContent = JSON.parse(readFileSync(join(dir, backupFiles[0]), 'utf-8'))
      expect(backupContent.value).toBe(1)

      // Original should have new value
      const newContent = JSON.parse(readFileSync(path, 'utf-8'))
      expect(newContent.value).toBe(2)
    })

    it('does NOT create backup when trackHistory is not specified (default)', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.sessionStatePath('sess-1', 'untracked.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // Write without trackHistory option - no backup
      await devState.write(path, { value: 2 }, TestSchema)

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('untracked.') && f.endsWith('.json') && f !== 'untracked.json'
      )

      expect(backupFiles.length).toBe(0)

      // But the value should still be updated
      const content = JSON.parse(readFileSync(path, 'utf-8'))
      expect(content.value).toBe(2)
    })

    it('does NOT create backup when trackHistory: false', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.sessionStatePath('sess-1', 'explicit-no-track.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // Write with trackHistory: false - no backup
      await devState.write(path, { value: 2 }, TestSchema, { trackHistory: false })

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('explicit-no-track.') && f.endsWith('.json') && f !== 'explicit-no-track.json'
      )

      expect(backupFiles.length).toBe(0)
    })

    it('does NOT create backup when dev mode disabled even with trackHistory: true', async () => {
      const prodState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: false } } },
      })

      const path = prodState.sessionStatePath('sess-1', 'no-backup.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // trackHistory: true but dev mode disabled - no backup
      await prodState.write(path, { value: 2 }, TestSchema, { trackHistory: true })

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('no-backup.') && f.endsWith('.json') && f !== 'no-backup.json'
      )

      expect(backupFiles.length).toBe(0)
    })

    it('does not create backup when config not provided', async () => {
      // Default behavior (no config) should not create backups
      const defaultState = new StateService(testDir, {
        logger: createMockLogger(),
      })

      const path = defaultState.sessionStatePath('sess-1', 'default-no-backup.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // Even with trackHistory: true, no config means no dev mode
      await defaultState.write(path, { value: 2 }, TestSchema, { trackHistory: true })

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('default-no-backup.') && f.endsWith('.json') && f !== 'default-no-backup.json'
      )

      expect(backupFiles.length).toBe(0)
    })

    it('does not fail when file does not exist (first write with trackHistory)', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.sessionStatePath('sess-1', 'new-file.json')

      // Should not throw - just creates file without backup
      await devState.write(path, { value: 1 }, TestSchema, { trackHistory: true })

      expect(existsSync(path)).toBe(true)

      // No backup files since there was nothing to backup
      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter((f) => f.startsWith('new-file.') && f.endsWith('.json') && f !== 'new-file.json')

      expect(backupFiles.length).toBe(0)
    })

    it('supports config getter function for hot-reload', async () => {
      let devModeEnabled = false
      const configGetter = (): { core: { development: { enabled: boolean } } } => ({
        core: { development: { enabled: devModeEnabled } },
      })

      const hotReloadState = new StateService(testDir, {
        logger: createMockLogger(),
        config: configGetter,
      })

      const path = hotReloadState.sessionStatePath('sess-1', 'hot-reload.json')

      // First write with dev mode disabled
      await hotReloadState.write(path, { value: 1 }, TestSchema, { trackHistory: true })

      // No backup since dev mode was disabled
      const dir = dirname(path)
      let files = readdirSync(dir)
      let backupFiles = files.filter(
        (f) => f.startsWith('hot-reload.') && f.endsWith('.json') && f !== 'hot-reload.json'
      )
      expect(backupFiles.length).toBe(0)

      // Enable dev mode via the getter
      devModeEnabled = true

      // Second write - now should create backup
      await hotReloadState.write(path, { value: 2 }, TestSchema, { trackHistory: true })

      files = readdirSync(dir)
      backupFiles = files.filter((f) => f.startsWith('hot-reload.') && f.endsWith('.json') && f !== 'hot-reload.json')
      expect(backupFiles.length).toBe(1)
    })

    it('creates multiple backups on successive writes with trackHistory: true', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.sessionStatePath('sess-1', 'multi-backup.json')

      // First write (no backup since file doesn't exist yet)
      await devState.write(path, { value: 1 }, TestSchema, { trackHistory: true })

      // Small delay to ensure different timestamps
      await sleep(5)

      // Second write (backup of v1)
      await devState.write(path, { value: 2 }, TestSchema, { trackHistory: true })

      await sleep(5)

      // Third write (backup of v2)
      await devState.write(path, { value: 3 }, TestSchema, { trackHistory: true })

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('multi-backup.') && f.endsWith('.json') && f !== 'multi-backup.json'
      )

      // Should have 2 backups (from 2nd and 3rd writes)
      expect(backupFiles.length).toBe(2)
    })
  })
})
