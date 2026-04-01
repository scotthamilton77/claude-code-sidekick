/**
 * Daemon Config Reload Safety Net Tests
 *
 * Tests config hot-reload propagation through handleConfigChange.
 * Both handleConfigChange and configService STAY on Daemon after extraction.
 *
 * Strategy: Writes config files to disk, triggers handleConfigChange,
 * verifies configService reflects the new config and logManager.setLevel
 * is called on log level changes.
 *
 * @see docs/design/DAEMON.md §4.3
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { ConfigService, LogManager } from '@sidekick/core'
import type { ConfigChangeEvent } from '../config-watcher.js'

let tmpDir: string

describe('Daemon config reload', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'config-reload-test-'))
    await fs.mkdir(join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  /**
   * Helper to create a Daemon with config-reload method access.
   * Only accesses fields/methods that STAY on Daemon after extraction.
   */
  async function createTestDaemon(projectDir: string): Promise<{
    daemon: InstanceType<typeof import('../daemon.js').Daemon>
    sup: { handleConfigChange(event: ConfigChangeEvent): void; configService: ConfigService; logManager: LogManager }
  }> {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(projectDir)
    const sup = daemon as unknown as {
      handleConfigChange(event: ConfigChangeEvent): void
      configService: ConfigService
      logManager: LogManager
    }
    return { daemon, sup }
  }

  /**
   * Create a ConfigChangeEvent for project-scope config file change.
   */
  function makeConfigChangeEvent(file: string, projectDir: string): ConfigChangeEvent {
    return {
      file,
      eventType: 'change',
      fullPath: join(projectDir, '.sidekick', file),
      scope: 'project',
    }
  }

  it('config change replaces configService instance', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    // Capture reference to original configService
    const originalConfigService = sup.configService

    // Write a config file (core.yaml is the domain file for core config)
    // Domain files contain the domain content directly -- NOT wrapped in `core:`
    // Valid log levels: debug, info, warn, error (Zod enum -- no trace/fatal)
    await fs.writeFile(join(tmpDir, '.sidekick', 'core.yaml'), 'logging:\n  level: debug\n')

    // Trigger config reload
    sup.handleConfigChange(makeConfigChangeEvent('core.yaml', tmpDir))

    // configService should be a new instance (replaced during reload)
    expect(sup.configService).not.toBe(originalConfigService)
  })

  it('config change with different log level calls logManager.setLevel', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    // Spy on logManager.setLevel
    const setLevelSpy = vi.spyOn(sup.logManager, 'setLevel')

    // Write a config file with a different log level than default
    // Default is 'info', change to 'debug'
    await fs.writeFile(join(tmpDir, '.sidekick', 'core.yaml'), 'logging:\n  level: debug\n')

    // Trigger config reload
    sup.handleConfigChange(makeConfigChangeEvent('core.yaml', tmpDir))

    // Verify the new configService reflects the change
    expect(sup.configService.core.logging.level).toBe('debug')

    // setLevel called since level changed from 'info' to 'debug'
    expect(setLevelSpy).toHaveBeenCalledWith('debug')
  })

  it('config change does not crash on invalid config', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    // Write garbage to a config file
    await fs.writeFile(join(tmpDir, '.sidekick', 'core.yaml'), '{{{{invalid yaml not valid')

    // handleConfigChange catches errors internally -- should not throw
    expect(() => {
      sup.handleConfigChange(makeConfigChangeEvent('core.yaml', tmpDir))
    }).not.toThrow()
  })

  it('multiple config changes in sequence apply the last config', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    // First change: set level to debug
    await fs.writeFile(join(tmpDir, '.sidekick', 'core.yaml'), 'logging:\n  level: debug\n')
    sup.handleConfigChange(makeConfigChangeEvent('core.yaml', tmpDir))
    expect(sup.configService.core.logging.level).toBe('debug')

    // Second change: set level to warn
    await fs.writeFile(join(tmpDir, '.sidekick', 'core.yaml'), 'logging:\n  level: warn\n')
    sup.handleConfigChange(makeConfigChangeEvent('core.yaml', tmpDir))
    expect(sup.configService.core.logging.level).toBe('warn')
  })
})
