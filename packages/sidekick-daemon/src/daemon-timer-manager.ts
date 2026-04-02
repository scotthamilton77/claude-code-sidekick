/**
 * Timer Manager — extracted from Daemon class (Step 3).
 *
 * Manages all periodic timers: idle check, heartbeat, eviction, and
 * project registry heartbeat. Owns the timer handles and the two
 * time-tracking fields (lastActivityTime, startTime).
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 * @see docs/design/DAEMON.md §4.6 Heartbeat / §4.7 Eviction
 */
import type { ConfigService, Logger } from '@sidekick/core'
import type { ProjectRegistryService } from '@sidekick/core'
import type { ServiceFactory } from '@sidekick/types'
import {
  IDLE_CHECK_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  EVICTION_INTERVAL_MS,
  REGISTRY_HEARTBEAT_INTERVAL_MS,
} from './daemon-helpers.js'
import { LogEvents, logEvent } from '@sidekick/core'

// ── DI deps ────────────────────────────────────────────────────────────────

export interface TimerManagerDeps {
  configService: ConfigService
  serviceFactory: ServiceFactory
  registryService: ProjectRegistryService
  logger: Logger
  projectDir: string
  /** Called when idle timeout fires (daemon should self-terminate). */
  onIdle: () => Promise<void>
  /** Called on each heartbeat tick (write daemon status). */
  onHeartbeat: () => Promise<void>
}

// ── Class ──────────────────────────────────────────────────────────────────

export class TimerManager {
  /** Timestamp of last IPC activity — written by the IPC dispatcher. */
  lastActivityTime = Date.now()
  /** Timestamp of daemon process start. */
  readonly startTime = Date.now()

  private idleCheckInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private evictionTimer: ReturnType<typeof setInterval> | null = null
  private registryHeartbeatInterval: ReturnType<typeof setInterval> | null = null

  constructor(private deps: TimerManagerDeps) {}

  // ── Individual start/stop pairs ────────────────────────────────────────

  /**
   * Start the idle timeout checker.
   * Per design/CLI.md §7: Self-terminate after configured idle timeout (default 5 min).
   * Set daemon.idleTimeoutMs to 0 to disable.
   */
  startIdleCheck(): void {
    const idleTimeoutMs = this.deps.configService.core.daemon.idleTimeoutMs

    // 0 = disabled
    if (idleTimeoutMs === 0) {
      this.deps.logger.info('Idle timeout disabled')
      return
    }

    this.lastActivityTime = Date.now()
    this.idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime
      if (idleTime >= idleTimeoutMs) {
        this.deps.logger.info('Idle timeout reached, shutting down', {
          idleTimeMs: idleTime,
          idleTimeoutMs,
        })
        void this.deps.onIdle()
      }
    }, IDLE_CHECK_INTERVAL_MS)

    // Don't let the interval keep the process alive if everything else is done
    this.idleCheckInterval.unref()
  }

  stopIdleCheck(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
  }

  /**
   * Start the heartbeat mechanism.
   * Per design/DAEMON.md §4.6: Write daemon status every 5 seconds for Monitoring UI.
   */
  startHeartbeat(): void {
    // Write initial heartbeat immediately
    void this.deps.onHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      void this.deps.onHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    // Don't let the interval keep the process alive
    this.heartbeatInterval.unref()

    this.deps.logger.debug('Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL_MS })
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Start periodic session eviction timer.
   * Evicts orphaned sessions (e.g., from crashed Claude Code instances)
   * to prevent memory leaks. Runs every 5 minutes.
   */
  startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      void this.deps.serviceFactory.evictStaleSessions()
    }, EVICTION_INTERVAL_MS)

    // Don't let the interval keep the process alive
    this.evictionTimer.unref()

    this.deps.logger.info('Session eviction timer started', { intervalMs: EVICTION_INTERVAL_MS })
    logEvent(this.deps.logger, LogEvents.sessionEvictionStarted({ intervalMs: EVICTION_INTERVAL_MS }))
  }

  stopEvictionTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }

  /**
   * Register this project in the user-level registry for UI discovery.
   */
  async registerProject(): Promise<void> {
    try {
      await this.deps.registryService.register(this.deps.projectDir)
      this.deps.logger.info('Project registered for UI discovery', { projectDir: this.deps.projectDir })
    } catch (err) {
      this.deps.logger.warn('Failed to register project', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  startRegistryHeartbeat(): void {
    this.registryHeartbeatInterval = setInterval(() => {
      void this.registerProject()
    }, REGISTRY_HEARTBEAT_INTERVAL_MS)

    this.registryHeartbeatInterval.unref()
    this.deps.logger.debug('Registry heartbeat started', {
      intervalMs: REGISTRY_HEARTBEAT_INTERVAL_MS,
    })
  }

  stopRegistryHeartbeat(): void {
    if (this.registryHeartbeatInterval) {
      clearInterval(this.registryHeartbeatInterval)
      this.registryHeartbeatInterval = null
    }
  }

  // ── Aggregate helpers ─────────��────────────────────────────────────────

  /** Start all timers. Called from Daemon.start(). */
  async startAll(): Promise<void> {
    this.startIdleCheck()
    this.startHeartbeat()
    this.startEvictionTimer()
    await this.registerProject()
    this.startRegistryHeartbeat()
  }

  /** Stop all timers. Called from Daemon.stop(). */
  stopAll(): void {
    this.stopIdleCheck()
    this.stopHeartbeat()
    this.stopEvictionTimer()
    this.stopRegistryHeartbeat()
  }
}
