/**
 * Manages all periodic daemon timers: idle check, heartbeat, eviction,
 * and project registry heartbeat.
 */
import type { ConfigService, Logger, ProjectRegistryService } from '@sidekick/core'
import type { ServiceFactory } from '@sidekick/types'
import {
  IDLE_CHECK_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  EVICTION_INTERVAL_MS,
  REGISTRY_HEARTBEAT_INTERVAL_MS,
} from './daemon-helpers.js'
import { LogEvents, logEvent } from '@sidekick/core'

export interface TimerManagerDeps {
  configService: ConfigService
  serviceFactory: ServiceFactory
  registryService: ProjectRegistryService
  logger: Logger
  projectDir: string
  /** Injected from Daemon — captured at process start, before constructor work. */
  startTime: number
  /** Called when idle timeout fires (daemon should self-terminate). */
  onIdle: () => Promise<void>
  /** Called on each heartbeat tick (write daemon status). */
  onHeartbeat: () => Promise<void>
}

export class TimerManager {
  lastActivityTime = Date.now()
  readonly startTime: number

  private idleCheckInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private evictionTimer: ReturnType<typeof setInterval> | null = null
  private registryHeartbeatInterval: ReturnType<typeof setInterval> | null = null

  constructor(private deps: TimerManagerDeps) {
    this.startTime = deps.startTime
  }

  /** Start idle timeout checker. Set daemon.idleTimeoutMs to 0 to disable. */
  startIdleCheck(): void {
    const idleTimeoutMs = this.deps.configService.core.daemon.idleTimeoutMs

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
    this.idleCheckInterval.unref()
  }

  stopIdleCheck(): void {
    this.clearTimer('idleCheckInterval')
  }

  /** Start heartbeat: write daemon status every 5s for Monitoring UI. */
  startHeartbeat(): void {
    void this.deps.onHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      void this.deps.onHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    this.heartbeatInterval.unref()

    this.deps.logger.debug('Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL_MS })
  }

  stopHeartbeat(): void {
    this.clearTimer('heartbeatInterval')
  }

  /** Start periodic eviction of orphaned sessions (every 5 minutes). */
  startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      void this.deps.serviceFactory.evictStaleSessions()
    }, EVICTION_INTERVAL_MS)
    this.evictionTimer.unref()

    this.deps.logger.info('Session eviction timer started', { intervalMs: EVICTION_INTERVAL_MS })
    logEvent(this.deps.logger, LogEvents.sessionEvictionStarted({ intervalMs: EVICTION_INTERVAL_MS }))
  }

  stopEvictionTimer(): void {
    this.clearTimer('evictionTimer')
  }

  /** Register this project in the user-level registry for UI discovery. */
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

    this.deps.logger.debug('Registry heartbeat started', { intervalMs: REGISTRY_HEARTBEAT_INTERVAL_MS })
  }

  stopRegistryHeartbeat(): void {
    this.clearTimer('registryHeartbeatInterval')
  }

  async startAll(): Promise<void> {
    this.startIdleCheck()
    this.startHeartbeat()
    this.startEvictionTimer()
    await this.registerProject()
    this.startRegistryHeartbeat()
  }

  stopAll(): void {
    this.stopIdleCheck()
    this.stopHeartbeat()
    this.stopEvictionTimer()
    this.stopRegistryHeartbeat()
  }

  private clearTimer(
    field: 'idleCheckInterval' | 'heartbeatInterval' | 'evictionTimer' | 'registryHeartbeatInterval'
  ): void {
    if (this[field]) {
      clearInterval(this[field])
      this[field] = null
    }
  }
}
