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
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
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
  // Dev Mode Backup Tests
  // ============================================================================

  describe('dev mode backup', () => {
    it('creates timestamped backup when dev mode enabled and file exists', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.globalStatePath('backup-test.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      // Write new value - should create backup first
      await devState.write(path, { value: 2 }, TestSchema)

      // Check for backup file
      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('backup-test.') && f.endsWith('.json') && f !== 'backup-test.json'
      )

      expect(backupFiles.length).toBe(1)

      // Backup should contain original value
      const backupContent = JSON.parse(readFileSync(join(dir, backupFiles[0]), 'utf-8'))
      expect(backupContent.value).toBe(1)

      // Original should have new value
      const newContent = JSON.parse(readFileSync(path, 'utf-8'))
      expect(newContent.value).toBe(2)
    })

    it('does not create backup when dev mode disabled', async () => {
      const prodState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: false } } },
      })

      const path = prodState.globalStatePath('no-backup.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      await prodState.write(path, { value: 2 }, TestSchema)

      // No backup files should exist
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

      const path = defaultState.globalStatePath('default-no-backup.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ value: 1 }), 'utf-8')

      await defaultState.write(path, { value: 2 }, TestSchema)

      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter(
        (f) => f.startsWith('default-no-backup.') && f.endsWith('.json') && f !== 'default-no-backup.json'
      )

      expect(backupFiles.length).toBe(0)
    })

    it('does not fail when file does not exist (first write)', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.globalStatePath('new-file.json')

      // Should not throw - just creates file without backup
      await devState.write(path, { value: 1 }, TestSchema)

      expect(existsSync(path)).toBe(true)

      // No backup files since there was nothing to backup
      const dir = dirname(path)
      const files = readdirSync(dir)
      const backupFiles = files.filter((f) => f.startsWith('new-file.') && f.endsWith('.json') && f !== 'new-file.json')

      expect(backupFiles.length).toBe(0)
    })

    it('creates multiple backups on successive writes', async () => {
      const devState = new StateService(testDir, {
        logger: createMockLogger(),
        config: { core: { development: { enabled: true } } },
      })

      const path = devState.globalStatePath('multi-backup.json')

      // First write (no backup)
      await devState.write(path, { value: 1 }, TestSchema)

      // Small delay to ensure different timestamps
      await sleep(5)

      // Second write (backup of v1)
      await devState.write(path, { value: 2 }, TestSchema)

      await sleep(5)

      // Third write (backup of v2)
      await devState.write(path, { value: 3 }, TestSchema)

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
