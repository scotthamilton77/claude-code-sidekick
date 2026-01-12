/**
 * File Utilities Tests
 *
 * Tests for timestamped file operations used by:
 * - Dev mode backups (copy with timestamp)
 * - Reminder consumption (rename with timestamp)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  getTimestampedPath,
  copyWithTimestamp,
  renameWithTimestamp,
  backupIfDevMode,
  renameWithTimestampSync,
  copyWithTimestampSync,
} from '../file-utils.js'

describe('file-utils', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-file-utils-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('getTimestampedPath', () => {
    it('generates correct path for .json files', () => {
      const result = getTimestampedPath('/path/to/session-summary.json', 1704067200000)
      expect(result).toBe('/path/to/session-summary.1704067200000.json')
    })

    it('generates correct path for .txt files', () => {
      const result = getTimestampedPath('/path/to/snarky-message.txt', 1704067200000)
      expect(result).toBe('/path/to/snarky-message.1704067200000.txt')
    })

    it('uses Date.now() when timestamp not provided', () => {
      const before = Date.now()
      const result = getTimestampedPath('/path/to/file.json')
      const after = Date.now()

      const match = result.match(/file\.(\d+)\.json$/)
      expect(match).not.toBeNull()
      const timestamp = parseInt(match![1], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('handles files without extension', () => {
      const result = getTimestampedPath('/path/to/Makefile', 1234567890)
      expect(result).toBe('/path/to/Makefile.1234567890')
    })
  })

  describe('copyWithTimestamp', () => {
    it('creates copy with timestamp suffix', async () => {
      const srcPath = path.join(tempDir, 'test.json')
      await fs.writeFile(srcPath, '{"test": true}')

      const result = await copyWithTimestamp(srcPath, { timestamp: 1234567890 })

      expect(result).toBe(path.join(tempDir, 'test.1234567890.json'))
      expect(existsSync(result!)).toBe(true)
      expect(readFileSync(result!, 'utf-8')).toBe('{"test": true}')
      // Original still exists
      expect(existsSync(srcPath)).toBe(true)
    })

    it('returns null when source does not exist', async () => {
      const result = await copyWithTimestamp(path.join(tempDir, 'nonexistent.json'))
      expect(result).toBeNull()
    })

    it('logs debug message on success', async () => {
      const srcPath = path.join(tempDir, 'test.json')
      await fs.writeFile(srcPath, '{}')

      const debugMessages: Array<[string, unknown]> = []
      const logger = {
        debug: (msg: string, meta: unknown) => debugMessages.push([msg, meta]),
        warn: () => {},
        info: () => {},
        error: () => {},
        trace: () => {},
        fatal: () => {},
        child: () => logger,
        flush: async () => {},
      }

      await copyWithTimestamp(srcPath, { logger, timestamp: 123 })

      expect(debugMessages).toHaveLength(1)
      expect(debugMessages[0][0]).toBe('Created timestamped copy')
    })
  })

  describe('renameWithTimestamp', () => {
    it('renames file with timestamp suffix', async () => {
      const srcPath = path.join(tempDir, 'reminder.json')
      await fs.writeFile(srcPath, '{"name": "test"}')

      const result = await renameWithTimestamp(srcPath, { timestamp: 9876543210 })

      expect(result).toBe(path.join(tempDir, 'reminder.9876543210.json'))
      expect(existsSync(result!)).toBe(true)
      // Original no longer exists
      expect(existsSync(srcPath)).toBe(false)
    })

    it('returns null when source does not exist', async () => {
      const result = await renameWithTimestamp(path.join(tempDir, 'nonexistent.json'))
      expect(result).toBeNull()
    })
  })

  describe('backupIfDevMode', () => {
    it('creates backup when devMode is true', async () => {
      const srcPath = path.join(tempDir, 'summary.json')
      await fs.writeFile(srcPath, '{}')

      const result = await backupIfDevMode(true, srcPath, { timestamp: 111 })

      expect(result).toBe(path.join(tempDir, 'summary.111.json'))
      expect(existsSync(result!)).toBe(true)
    })

    it('returns null when devMode is false', async () => {
      const srcPath = path.join(tempDir, 'summary.json')
      await fs.writeFile(srcPath, '{}')

      const result = await backupIfDevMode(false, srcPath, { timestamp: 111 })

      expect(result).toBeNull()
      // No backup created
      const files = await fs.readdir(tempDir)
      expect(files).toEqual(['summary.json'])
    })
  })

  describe('renameWithTimestampSync', () => {
    it('renames file synchronously', async () => {
      const srcPath = path.join(tempDir, 'sync-test.json')
      await fs.writeFile(srcPath, '{}')

      const result = renameWithTimestampSync(srcPath, 555)

      expect(result).toBe(path.join(tempDir, 'sync-test.555.json'))
      expect(existsSync(result!)).toBe(true)
      expect(existsSync(srcPath)).toBe(false)
    })

    it('returns null when source does not exist', () => {
      const result = renameWithTimestampSync(path.join(tempDir, 'nope.json'))
      expect(result).toBeNull()
    })

    it('returns null when rename fails due to target being a directory', async () => {
      const srcPath = path.join(tempDir, 'src-file.json')
      await fs.writeFile(srcPath, '{}')

      // Create a directory at the target path, which will cause rename to fail
      const targetPath = path.join(tempDir, 'src-file.123.json')
      await fs.mkdir(targetPath, { recursive: true })

      const result = renameWithTimestampSync(srcPath, 123)

      expect(result).toBeNull()
      // Source file should still exist since rename failed
      expect(existsSync(srcPath)).toBe(true)
    })
  })

  describe('copyWithTimestampSync', () => {
    it('copies file synchronously', async () => {
      const srcPath = path.join(tempDir, 'sync-copy.txt')
      await fs.writeFile(srcPath, 'hello')

      const result = copyWithTimestampSync(srcPath, 777)

      expect(result).toBe(path.join(tempDir, 'sync-copy.777.txt'))
      expect(existsSync(result!)).toBe(true)
      expect(existsSync(srcPath)).toBe(true) // Original still exists
      expect(readFileSync(result!, 'utf-8')).toBe('hello')
    })

    it('returns null when source does not exist', () => {
      const result = copyWithTimestampSync(path.join(tempDir, 'nope.txt'))
      expect(result).toBeNull()
    })

    it('returns null when copy fails due to target being a directory', async () => {
      const srcPath = path.join(tempDir, 'copy-src.txt')
      await fs.writeFile(srcPath, 'content')

      // Create a directory at the target path, which will cause copy to fail
      const targetPath = path.join(tempDir, 'copy-src.456.txt')
      await fs.mkdir(targetPath, { recursive: true })

      const result = copyWithTimestampSync(srcPath, 456)

      expect(result).toBeNull()
      // Source file should still exist
      expect(existsSync(srcPath)).toBe(true)
    })
  })
})
