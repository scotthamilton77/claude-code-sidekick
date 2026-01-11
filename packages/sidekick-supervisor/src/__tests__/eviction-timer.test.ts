/**
 * Eviction Timer Tests
 *
 * Tests the eviction timer mechanism that periodically calls
 * ServiceFactory.evictStaleSessions() to clean up orphaned sessions.
 *
 * NOTE: These tests access private Supervisor methods via type casting.
 * This is necessary because the eviction timer is an internal detail that
 * only manifests externally after 5+ minutes. The alternative (full integration
 * test with real timers) would be impractical.
 *
 * The tests verify:
 * 1. Timer starts and calls evictStaleSessions at the correct interval
 * 2. Timer stops when supervisor stops
 * 3. Errors don't break the timer loop
 *
 * @see docs/design/SUPERVISOR.md §4.7 (Phase 6)
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceFactory } from '@sidekick/types'

// Eviction interval constant matching supervisor.ts
const EVICTION_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

let tmpDir: string

describe('Supervisor eviction timer', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-eviction-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should start eviction timer on start()', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members to verify timer is set
    const sup = supervisor as unknown as {
      evictionTimer: ReturnType<typeof setInterval> | null
      serviceFactory: ServiceFactory
      startEvictionTimer(): void
      stopEvictionTimer(): void
    }

    // Timer should be null before start
    expect(sup.evictionTimer).toBeNull()

    // Start the eviction timer directly (without full supervisor startup)
    sup.startEvictionTimer()

    // Timer should now be set
    expect(sup.evictionTimer).not.toBeNull()

    // Cleanup
    sup.stopEvictionTimer()
  })

  it('should call evictStaleSessions periodically every 5 minutes', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members
    const sup = supervisor as unknown as {
      evictionTimer: ReturnType<typeof setInterval> | null
      serviceFactory: ServiceFactory
      startEvictionTimer(): void
      stopEvictionTimer(): void
    }

    // Spy on evictStaleSessions
    const evictSpy = vi.spyOn(sup.serviceFactory, 'evictStaleSessions').mockResolvedValue(0)

    // Start the eviction timer
    sup.startEvictionTimer()

    // Should not be called immediately
    expect(evictSpy).not.toHaveBeenCalled()

    // Advance just under 5 minutes - should not trigger
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS - 1000)
    expect(evictSpy).not.toHaveBeenCalled()

    // Advance past 5 minutes - should trigger first call
    await vi.advanceTimersByTimeAsync(1000)
    expect(evictSpy).toHaveBeenCalledTimes(1)

    // Advance another 5 minutes - should trigger second call
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
    expect(evictSpy).toHaveBeenCalledTimes(2)

    // Advance another 5 minutes - should trigger third call
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
    expect(evictSpy).toHaveBeenCalledTimes(3)

    // Cleanup
    sup.stopEvictionTimer()
  })

  it('should clear eviction timer on stop()', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members
    const sup = supervisor as unknown as {
      evictionTimer: ReturnType<typeof setInterval> | null
      serviceFactory: ServiceFactory
      startEvictionTimer(): void
      stopEvictionTimer(): void
    }

    // Spy on evictStaleSessions
    const evictSpy = vi.spyOn(sup.serviceFactory, 'evictStaleSessions').mockResolvedValue(0)

    // Start the eviction timer
    sup.startEvictionTimer()
    expect(sup.evictionTimer).not.toBeNull()

    // Stop the eviction timer
    sup.stopEvictionTimer()
    expect(sup.evictionTimer).toBeNull()

    // Advance time - should NOT trigger evictStaleSessions since timer is cleared
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS * 2)
    expect(evictSpy).not.toHaveBeenCalled()
  })

  it('should handle errors from evictStaleSessions gracefully', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members
    const sup = supervisor as unknown as {
      evictionTimer: ReturnType<typeof setInterval> | null
      serviceFactory: ServiceFactory
      startEvictionTimer(): void
      stopEvictionTimer(): void
    }

    // Mock evictStaleSessions to throw
    const evictSpy = vi
      .spyOn(sup.serviceFactory, 'evictStaleSessions')
      .mockRejectedValueOnce(new Error('Test error'))
      .mockResolvedValue(0)

    // Start the eviction timer
    sup.startEvictionTimer()

    // Advance past 5 minutes - first call throws but timer continues
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
    expect(evictSpy).toHaveBeenCalledTimes(1)

    // Advance another 5 minutes - second call should succeed
    await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
    expect(evictSpy).toHaveBeenCalledTimes(2)

    // Cleanup
    sup.stopEvictionTimer()
  })

  // NOTE: Test for unref() behavior was removed as it tests Node.js process internals
  // rather than observable behavior. The actual behavior (timer not blocking process exit)
  // is an integration concern, not a unit test concern.
})
