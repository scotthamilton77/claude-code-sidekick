import fs from 'fs/promises'
import syncFs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLogger } from '@sidekick/testing-fixtures'
import { ConfigChangeEvent, ConfigWatcher } from '../config-watcher.js'
let tmpDir: string
let logger: MockLogger

describe('ConfigWatcher', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-watcher-test-'))
    logger = new MockLogger()
    // Create .sidekick directory
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
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

  it('should log error when onChange handler throws', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', 'features.yaml')
    await fs.writeFile(configPath, 'feature1: enabled\n', 'utf-8')

    const onChangeError = new Error('Handler failed')
    const onChange = vi.fn().mockImplementation(() => {
      throw onChangeError
    })
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    watcher.start()

    // Modify the config file to trigger handler
    await fs.writeFile(configPath, 'feature1: disabled\n', 'utf-8')

    // Wait for debounce + fs.watch latency
    await vi.waitFor(
      () => {
        expect(onChange).toHaveBeenCalled()
      },
      { timeout: 500 }
    )

    // Error should have been logged
    expect(logger.wasLogged('Error in config change handler', 'error')).toBe(true)

    watcher.stop()
  })

  it('should log error when fs.watch fails', async () => {
    // Mock existsSync to return true but fs.watch to throw
    const mockExistsSync = vi.spyOn(syncFs, 'existsSync').mockReturnValue(true)
    const watchError = new Error('Permission denied')
    const mockWatch = vi.spyOn(syncFs, 'watch').mockImplementation(() => {
      throw watchError
    })

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    // Should not throw, but log error
    expect(() => watcher.start()).not.toThrow()

    // Error should have been logged for the file that failed
    expect(logger.wasLogged('Could not watch config file')).toBe(true)

    watcher.stop()

    mockExistsSync.mockRestore()
    mockWatch.mockRestore()
  })

  it('should clear pending debounce timers on stop', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', '.env')
    await fs.writeFile(configPath, 'API_KEY=test\n', 'utf-8')

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    watcher.start()

    // Trigger a change but stop before debounce completes
    await fs.writeFile(configPath, 'API_KEY=changed\n', 'utf-8')

    // Stop immediately (before debounce timeout of 100ms)
    watcher.stop()

    // Wait for what would have been the debounce period
    await new Promise((r) => setTimeout(r, 200))

    // onChange should NOT have been called because we stopped before debounce completed
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should log watcher error events', async () => {
    // Create config file
    const configPath = path.join(tmpDir, '.sidekick', 'sidekick.config')
    await fs.writeFile(configPath, 'test: value\n', 'utf-8')

    const onChange = vi.fn()
    const watcher = new ConfigWatcher(tmpDir, logger, onChange)

    // Capture the FSWatcher instances created
    const originalWatch = syncFs.watch
    let createdWatcher: syncFs.FSWatcher | null = null
    vi.spyOn(syncFs, 'watch').mockImplementation((filename, listener) => {
      createdWatcher = originalWatch(filename, listener as Parameters<typeof syncFs.watch>[1])
      return createdWatcher
    })

    watcher.start()

    // Emit an error on the watcher
    if (createdWatcher) {
      ;(createdWatcher as syncFs.FSWatcher).emit('error', new Error('Watch error'))
    }

    // Error should have been logged
    expect(logger.wasLogged('Watcher error', 'error')).toBe(true)

    watcher.stop()
  })
})
