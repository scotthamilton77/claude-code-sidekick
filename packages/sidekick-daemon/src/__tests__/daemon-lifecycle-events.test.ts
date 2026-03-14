/**
 * Daemon Lifecycle Event Emission Tests
 *
 * Verifies that session:eviction-started events are emitted via logEvent()
 * when the daemon's eviction timer is started.
 *
 * Uses the same pattern as eviction-timer.test.ts — accessing private
 * methods via type casting to test internal behavior.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '@sidekick/types'

// Mock logEvent at the module level to intercept calls
const mockLogEvent = vi.fn()
vi.mock('@sidekick/core', async () => {
  const actual = await vi.importActual<typeof import('@sidekick/core')>('@sidekick/core')
  return {
    ...actual,
    logEvent: (...args: unknown[]) => mockLogEvent(...args),
  }
})

let tmpDir: string

describe('Daemon lifecycle event emission', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mockLogEvent.mockClear()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-lifecycle-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should emit session:eviction-started with correct intervalMs when eviction timer starts', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    const sup = daemon as unknown as {
      logger: Logger
      startEvictionTimer(): void
      stopEvictionTimer(): void
    }

    sup.startEvictionTimer()

    const evictionCalls = mockLogEvent.mock.calls.filter(
      (call: unknown[]) => (call[1] as { type: string })?.type === 'session:eviction-started'
    )
    expect(evictionCalls).toHaveLength(1)

    const event = evictionCalls[0][1] as { type: string; payload: { intervalMs: number } }
    expect(event.type).toBe('session:eviction-started')
    expect(event.payload.intervalMs).toBe(300000) // 5 minutes

    sup.stopEvictionTimer()
  })
})
