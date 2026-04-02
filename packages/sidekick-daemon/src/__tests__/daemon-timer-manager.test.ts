/**
 * Timer Manager Tests
 *
 * Tests the TimerManager class extracted from Daemon (Step 3).
 * Verifies idle check, heartbeat, eviction, and registry timers.
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 * @see docs/design/DAEMON.md §4.6 / §4.7
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerManager, type TimerManagerDeps } from '../daemon-timer-manager.js'
import {
  IDLE_CHECK_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  EVICTION_INTERVAL_MS,
  REGISTRY_HEARTBEAT_INTERVAL_MS,
} from '../daemon-helpers.js'

function createMockDeps(overrides?: Partial<TimerManagerDeps>): TimerManagerDeps {
  return {
    configService: {
      core: { daemon: { idleTimeoutMs: 300_000 } },
    } as unknown as TimerManagerDeps['configService'],
    serviceFactory: {
      evictStaleSessions: vi.fn().mockResolvedValue(0),
    } as unknown as TimerManagerDeps['serviceFactory'],
    registryService: {
      register: vi.fn().mockResolvedValue(undefined),
    } as unknown as TimerManagerDeps['registryService'],
    logger: {
      info: vi.fn() as any,
      warn: vi.fn() as any,
      debug: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      trace: vi.fn() as any,
      child: vi.fn().mockReturnThis() as any,
    } as unknown as TimerManagerDeps['logger'],
    projectDir: '/tmp/test-project',
    startTime: Date.now(),
    onIdle: vi.fn().mockResolvedValue(undefined),
    onHeartbeat: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('TimerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── Idle check ─────────────────────────────────────────────────────────

  describe('idle check', () => {
    it('should fire onIdle after configured timeout', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startIdleCheck()

      // Advance to just under idle timeout — should NOT fire
      // Idle timeout is 300s, checks every 30s. After 270s (9 checks), still under 300s.
      await vi.advanceTimersByTimeAsync(270_000)
      expect(deps.onIdle).not.toHaveBeenCalled()

      // Advance to 300s — the 10th check fires and sees idleTime >= 300s
      await vi.advanceTimersByTimeAsync(IDLE_CHECK_INTERVAL_MS)
      expect(deps.onIdle).toHaveBeenCalled()

      tm.stopIdleCheck()
    })

    it('should not fire when activity is recent', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startIdleCheck()

      // Advance 4 minutes (under 5-minute default)
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

      // Reset activity
      tm.lastActivityTime = Date.now()

      // Advance another 4 minutes — still within timeout of last activity
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
      expect(deps.onIdle).not.toHaveBeenCalled()

      tm.stopIdleCheck()
    })

    it('should disable idle check when idleTimeoutMs = 0', () => {
      const deps = createMockDeps({
        configService: {
          core: { daemon: { idleTimeoutMs: 0 } },
        } as unknown as TimerManagerDeps['configService'],
      })
      const tm = new TimerManager(deps)

      tm.startIdleCheck()

      // Should have logged 'Idle timeout disabled'
      expect(deps.logger.info).toHaveBeenCalledWith('Idle timeout disabled')

      tm.stopIdleCheck()
    })
  })

  // ── Heartbeat ──────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    it('should fire onHeartbeat immediately and then at HEARTBEAT_INTERVAL_MS', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startHeartbeat()

      // Should fire immediately
      expect(deps.onHeartbeat).toHaveBeenCalledTimes(1)

      // Advance by one interval
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
      expect(deps.onHeartbeat).toHaveBeenCalledTimes(2)

      // Advance by another interval
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
      expect(deps.onHeartbeat).toHaveBeenCalledTimes(3)

      tm.stopHeartbeat()
    })
  })

  // ── Eviction timer ─────────────────────────────────────────────────────

  describe('eviction timer', () => {
    it('should call serviceFactory.evictStaleSessions at EVICTION_INTERVAL_MS', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startEvictionTimer()

      // Not called immediately
      expect(deps.serviceFactory.evictStaleSessions).not.toHaveBeenCalled()

      // Advance to first interval
      await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
      expect(deps.serviceFactory.evictStaleSessions).toHaveBeenCalledTimes(1)

      // Advance to second interval
      await vi.advanceTimersByTimeAsync(EVICTION_INTERVAL_MS)
      expect(deps.serviceFactory.evictStaleSessions).toHaveBeenCalledTimes(2)

      tm.stopEvictionTimer()
    })
  })

  // ── Registry heartbeat ─────────────────────────────────────────────────

  describe('registry heartbeat', () => {
    it('should call registryService.register at REGISTRY_HEARTBEAT_INTERVAL_MS', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startRegistryHeartbeat()

      // Not called immediately by startRegistryHeartbeat (registerProject is separate)
      expect(deps.registryService.register).not.toHaveBeenCalled()

      // Advance one interval
      await vi.advanceTimersByTimeAsync(REGISTRY_HEARTBEAT_INTERVAL_MS)
      expect(deps.registryService.register).toHaveBeenCalledTimes(1)

      tm.stopRegistryHeartbeat()
    })
  })

  // ── registerProject ────────────────────────────────────────────────────

  describe('registerProject', () => {
    it('should register the project and log success', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      await tm.registerProject()

      expect(deps.registryService.register).toHaveBeenCalledWith('/tmp/test-project')
      expect(deps.logger.info).toHaveBeenCalledWith('Project registered for UI discovery', {
        projectDir: '/tmp/test-project',
      })
    })

    it('should handle errors gracefully without throwing', async () => {
      const deps = createMockDeps({
        registryService: {
          register: vi.fn().mockRejectedValue(new Error('registry error')),
        } as unknown as TimerManagerDeps['registryService'],
      })
      const tm = new TimerManager(deps)

      await expect(tm.registerProject()).resolves.not.toThrow()
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to register project',
        expect.objectContaining({ error: 'registry error' })
      )
    })
  })

  // ── stopAll ────────────────────────────────────────────────────────────

  describe('stopAll', () => {
    it('should clear all intervals', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      tm.startIdleCheck()
      tm.startHeartbeat()
      tm.startEvictionTimer()
      tm.startRegistryHeartbeat()

      // Reset mock counts
      ;(deps.onHeartbeat as ReturnType<typeof vi.fn>).mockClear()
      ;(deps.serviceFactory.evictStaleSessions as ReturnType<typeof vi.fn>).mockClear()
      ;(deps.registryService.register as ReturnType<typeof vi.fn>).mockClear()

      tm.stopAll()

      // Advance well past all intervals — nothing should fire
      await vi.advanceTimersByTimeAsync(REGISTRY_HEARTBEAT_INTERVAL_MS * 2)
      expect(deps.onHeartbeat).not.toHaveBeenCalled()
      expect(deps.serviceFactory.evictStaleSessions).not.toHaveBeenCalled()
      expect(deps.registryService.register).not.toHaveBeenCalled()
    })
  })

  // ── startAll ───────────────────────────────────────────────────────────

  describe('startAll', () => {
    it('should start all timers and register the project', async () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      await tm.startAll()

      // registerProject was called
      expect(deps.registryService.register).toHaveBeenCalledTimes(1)
      // heartbeat fires immediately
      expect(deps.onHeartbeat).toHaveBeenCalledTimes(1)

      tm.stopAll()
    })
  })

  // ── lastActivityTime ──────────────────────────────────────────────────

  describe('lastActivityTime', () => {
    it('should be writable', () => {
      const deps = createMockDeps()
      const tm = new TimerManager(deps)

      const before = tm.lastActivityTime
      tm.lastActivityTime = before + 1000
      expect(tm.lastActivityTime).toBe(before + 1000)
    })
  })
})
