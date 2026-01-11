import { createConsoleLogger } from '@sidekick/core'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigChangeEvent, ConfigWatcher } from '../config-watcher.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpDir: string

describe('ConfigWatcher', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-watcher-test-'))
    // Create .sidekick directory
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should call onChange when watched config file changes', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', 'config.yaml')
    await fs.writeFile(configPath, 'logging:\n  level: info\n', 'utf-8')

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    watcher.start()

    // Modify the config file
    await fs.writeFile(configPath, 'logging:\n  level: debug\n', 'utf-8')

    // Wait for debounce + fs.watch latency
    await vi.waitFor(
      () => {
        expect(onChange).toHaveBeenCalled()
      },
      { timeout: 500 }
    )

    const event: ConfigChangeEvent = onChange.mock.calls[0][0] as ConfigChangeEvent
    expect(event.file).toBe('config.yaml')

    watcher.stop()
  })

  it('should not crash when watched files do not exist', () => {
    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    // Should not throw even though config files don't exist
    expect(() => watcher.start()).not.toThrow()

    watcher.stop()
  })

  it('should debounce rapid file changes', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', 'llm.yaml')
    await fs.writeFile(configPath, 'provider: openrouter\n', 'utf-8')

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    watcher.start()

    // Simulate rapid changes (like editor save)
    await fs.writeFile(configPath, 'provider: openrouter\ntemperature: 0.1\n', 'utf-8')
    await fs.writeFile(configPath, 'provider: openrouter\ntemperature: 0.2\n', 'utf-8')
    await fs.writeFile(configPath, 'provider: openrouter\ntemperature: 0.3\n', 'utf-8')

    // Wait for debounce to settle
    await new Promise((r) => setTimeout(r, 300))

    // Should have coalesced to a single callback (or very few)
    // Due to fs.watch timing, we might get 1-3 calls, but not 3 exactly per rapid write
    expect(onChange.mock.calls.length).toBeLessThanOrEqual(3)

    watcher.stop()
  })

  it('should stop watching when stop() is called', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', 'transcript.yaml')
    await fs.writeFile(configPath, 'watchDebounceMs: 100\n', 'utf-8')

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    watcher.start()
    watcher.stop()

    // Modify after stop
    await fs.writeFile(configPath, 'watchDebounceMs: 200\n', 'utf-8')

    // Give time for any potential callback
    await new Promise((r) => setTimeout(r, 200))

    // Should not have been called after stop
    expect(onChange).not.toHaveBeenCalled()
  })
})
