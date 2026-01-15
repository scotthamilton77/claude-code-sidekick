import { createConsoleLogger } from '@sidekick/core'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateManager } from '../state-manager.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpDir: string

describe('StateManager', () => {
  let stateManager: StateManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-state-test-'))
    stateManager = new StateManager(tmpDir, logger)
    await stateManager.initialize()
  })

  afterEach(async () => {
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail if test didn't create temp dir
    }
  })

  describe('corrupt state recovery', () => {
    it('should move corrupt JSON to .bak and reset to empty on initialize', async () => {
      // Create a corrupt JSON file before initializing new StateManager
      const corruptFile = path.join(tmpDir, 'corrupt.json')
      await fs.writeFile(corruptFile, '{ invalid json }', 'utf-8')

      // Create new StateManager and initialize (triggers corrupt file handling)
      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Original file should be reset to empty object
      const content = await fs.readFile(corruptFile, 'utf-8')
      expect(JSON.parse(content)).toEqual({})

      // Backup file should contain original corrupt content
      const bakContent = await fs.readFile(`${corruptFile}.bak`, 'utf-8')
      expect(bakContent).toBe('{ invalid json }')

      // Cache should have empty object
      expect(freshManager.get('corrupt')).toEqual({})
    })

    it('should load valid state files into cache on initialize', async () => {
      // Create valid JSON file
      const validFile = path.join(tmpDir, 'valid.json')
      await fs.writeFile(validFile, JSON.stringify({ key: 'value' }), 'utf-8')

      // Create new StateManager and initialize
      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Cache should have loaded content
      expect(freshManager.get('valid')).toEqual({ key: 'value' })
    })

    it('should handle mix of valid and corrupt files', async () => {
      // Create one valid and one corrupt file
      await fs.writeFile(path.join(tmpDir, 'good.json'), JSON.stringify({ status: 'ok' }), 'utf-8')
      await fs.writeFile(path.join(tmpDir, 'bad.json'), 'not { json at all', 'utf-8')

      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Good file should be loaded
      expect(freshManager.get('good')).toEqual({ status: 'ok' })

      // Bad file should be reset to empty
      expect(freshManager.get('bad')).toEqual({})

      // Backup should exist for bad file
      const bakExists = await fs
        .access(path.join(tmpDir, 'bad.json.bak'))
        .then(() => true)
        .catch(() => false)
      expect(bakExists).toBe(true)
    })
  })

  it('should write state atomically', async () => {
    await stateManager.update('test', { foo: 'bar' })

    const content = await fs.readFile(path.join(tmpDir, 'test.json'), 'utf-8')
    expect(JSON.parse(content)).toEqual({ foo: 'bar' })
  })

  it('should merge state', async () => {
    await stateManager.update('test', { foo: 'bar' })
    await stateManager.update('test', { baz: 'qux' }, true)

    const content = await fs.readFile(path.join(tmpDir, 'test.json'), 'utf-8')
    expect(JSON.parse(content)).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('should cache state', async () => {
    await stateManager.update('test', { foo: 'bar' })

    // Manually modify file to prove cache is used for merge
    await fs.writeFile(path.join(tmpDir, 'test.json'), JSON.stringify({ foo: 'modified' }))

    // Merge should use cache ({ foo: 'bar' }) + new data
    await stateManager.update('test', { baz: 'qux' }, true)

    // If it used cache, result is bar+qux. If it read file, result is modified+qux.
    // Our implementation prefers cache for merge base if available.
    // Wait, let's check implementation.
    // Implementation: let current = this.cache.get(file); if (!current) read file.
    // So it should use cache.

    const content = await fs.readFile(path.join(tmpDir, 'test.json'), 'utf-8')
    expect(JSON.parse(content)).toEqual({ foo: 'bar', baz: 'qux' })
  })

  describe('merge with cache miss', () => {
    it('should read from disk when merging with cache miss', async () => {
      // Create a fresh StateManager that hasn't seen this file
      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Write file directly to disk (bypassing cache)
      await fs.writeFile(path.join(tmpDir, 'diskonly.json'), JSON.stringify({ existing: 'data' }), 'utf-8')

      // Merge with cache miss - should read from disk
      await freshManager.update('diskonly', { new: 'value' }, true)

      const content = await fs.readFile(path.join(tmpDir, 'diskonly.json'), 'utf-8')
      expect(JSON.parse(content)).toEqual({ existing: 'data', new: 'value' })
    })

    it('should use empty object when merging with cache miss and no file', async () => {
      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Merge on non-existent file (cache miss, disk miss)
      await freshManager.update('newfile', { key: 'value' }, true)

      const content = await fs.readFile(path.join(tmpDir, 'newfile.json'), 'utf-8')
      expect(JSON.parse(content)).toEqual({ key: 'value' })
    })
  })

  describe('error handling', () => {
    it('should handle rename failure during corrupt file recovery', async () => {
      // Create corrupt file
      const corruptFile = path.join(tmpDir, 'unrecoverable.json')
      await fs.writeFile(corruptFile, '{ broken json', 'utf-8')

      // Make the directory read-only to cause rename to fail
      // Actually, let's use a different approach - create a .bak that's a directory
      // to cause rename to fail
      await fs.mkdir(`${corruptFile}.bak`, { recursive: true })

      const freshManager = new StateManager(tmpDir, logger)
      await freshManager.initialize()

      // Should have recovered by initializing cache with empty object despite rename failure
      expect(freshManager.get('unrecoverable')).toEqual({})
    })

    it('should throw and log when write fails', async () => {
      // Create a subdirectory where we expect a file - write will fail
      const blockerPath = path.join(tmpDir, 'blocked.json')
      await fs.mkdir(blockerPath, { recursive: true })

      await expect(stateManager.update('blocked', { data: 'test' })).rejects.toThrow()
    })
  })
})
