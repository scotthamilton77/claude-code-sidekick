import { createConsoleLogger } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateManager } from '../state-manager.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
const tmpDir = path.join(__dirname, 'tmp_state')

describe('StateManager', () => {
  let stateManager: StateManager

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    stateManager = new StateManager(tmpDir, logger)
    await stateManager.initialize()
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail if test didn't create temp dir
    }
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
})
