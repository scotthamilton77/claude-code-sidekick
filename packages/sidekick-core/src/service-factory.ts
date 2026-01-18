/**
 * Service Factory Implementation
 *
 * Factory for creating and managing session-scoped services.
 * Enables concurrent session support by providing session-aware service instances.
 *
 * Key responsibilities:
 * - Create StagingService wrappers that inject sessionId
 * - Create and cache TranscriptService instances per session
 * - Track session access times for stale eviction
 * - Shutdown session services on demand
 *
 * @see docs/design/CORE-RUNTIME.md
 */

import type {
  ServiceFactory,
  StagingService,
  TranscriptService,
  Logger,
  HandlerRegistry,
  MinimalStateService,
} from '@sidekick/types'
import { StagingServiceCore, SessionScopedStagingService } from './staging-service.js'
import { TranscriptServiceImpl } from './transcript-service.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a ServiceFactoryImpl.
 */
export interface ServiceFactoryOptions {
  /** Base state directory (e.g., .sidekick) */
  stateDir: string
  /** Logger for observability */
  logger: Logger
  /** Optional scope for logging context */
  scope?: 'project' | 'user'
  /** Handler registry for TranscriptService event emission */
  handlers: HandlerRegistry
  /** StateService for atomic writes and schema validation */
  stateService: MinimalStateService
  /**
   * Separate StateService for staging operations (cross-process access).
   * Should use cache: false to avoid cross-process staleness.
   * Falls back to stateService if not provided.
   */
  stagingStateService?: MinimalStateService
  /** Debounce interval for file watching (ms) - defaults to 100 */
  watchDebounceMs?: number
  /** Interval for periodic metrics persistence (ms) - defaults to 30000 */
  metricsPersistIntervalMs?: number
}

// ============================================================================
// ServiceFactoryImpl
// ============================================================================

/**
 * Implementation of the ServiceFactory interface.
 *
 * Manages session-scoped services with:
 * - A single StagingServiceCore shared across all sessions
 * - Per-session TranscriptService instances (cached)
 * - Session access tracking for stale eviction
 */
export class ServiceFactoryImpl implements ServiceFactory {
  /** Single StagingServiceCore shared by all sessions */
  private readonly stagingCore: StagingServiceCore

  /** Cached TranscriptService instances by sessionId */
  private readonly transcriptServices = new Map<string, TranscriptService>()

  /** Last access timestamp for each session */
  private readonly sessionLastAccess = new Map<string, number>()

  /** Session TTL for stale eviction (30 minutes) */
  private readonly SESSION_TTL_MS = 30 * 60 * 1000

  constructor(private readonly options: ServiceFactoryOptions) {
    // Use separate stagingStateService if provided (for non-caching cross-process access)
    const stagingStateService = options.stagingStateService ?? options.stateService
    this.stagingCore = new StagingServiceCore({
      stateDir: options.stateDir,
      logger: options.logger,
      scope: options.scope,
      stateService: stagingStateService,
    })
  }

  /**
   * Get a session-scoped StagingService.
   * Returns a lightweight wrapper that injects sessionId into underlying calls.
   */
  getStagingService(sessionId: string): StagingService {
    this.touchSession(sessionId)
    return new SessionScopedStagingService(this.stagingCore, sessionId, this.options.scope)
  }

  /**
   * Prepare a session-scoped TranscriptService without starting event emission.
   * Returns actual instance (created on demand, cached by sessionId).
   *
   * The service is prepared but NOT started - call transcriptService.start() after
   * wiring up handler context to begin event emission.
   */
  async prepareTranscriptService(sessionId: string, transcriptPath: string): Promise<TranscriptService> {
    this.touchSession(sessionId)

    let service = this.transcriptServices.get(sessionId)
    if (!service) {
      service = new TranscriptServiceImpl({
        stateDir: this.options.stateDir,
        logger: this.options.logger,
        handlers: this.options.handlers,
        stateService: this.options.stateService,
        watchDebounceMs: this.options.watchDebounceMs ?? 100,
        metricsPersistIntervalMs: this.options.metricsPersistIntervalMs ?? 30000,
      })
      // Only prepare, don't start - caller must call service.start() after wiring context
      await service.prepare(sessionId, transcriptPath)
      this.transcriptServices.set(sessionId, service)
    }
    return service
  }

  /**
   * Shutdown a session's services (called on SessionEnd).
   */
  async shutdownSession(sessionId: string): Promise<void> {
    const service = this.transcriptServices.get(sessionId)
    if (service) {
      await service.shutdown()
      this.transcriptServices.delete(sessionId)
    }
    this.sessionLastAccess.delete(sessionId)
    this.options.logger.debug('Session shutdown', { sessionId })
  }

  /**
   * Evict stale sessions (called periodically).
   * Returns count of evicted sessions.
   */
  async evictStaleSessions(): Promise<number> {
    const now = Date.now()
    let evicted = 0
    for (const [sessionId, lastAccess] of this.sessionLastAccess) {
      if (now - lastAccess > this.SESSION_TTL_MS) {
        await this.shutdownSession(sessionId)
        evicted++
      }
    }
    if (evicted > 0) {
      this.options.logger.info('Evicted stale sessions', { count: evicted })
    }
    return evicted
  }

  /**
   * Shutdown all sessions (called on daemon stop).
   * Returns count of sessions shutdown.
   */
  async shutdownAllSessions(): Promise<number> {
    const sessionIds = [...this.transcriptServices.keys()]
    const count = sessionIds.length
    for (const sessionId of sessionIds) {
      await this.shutdownSession(sessionId)
    }
    if (count > 0) {
      this.options.logger.info('Shutdown all sessions', { count })
    }
    return count
  }

  /**
   * Update the last access timestamp for a session.
   */
  private touchSession(sessionId: string): void {
    this.sessionLastAccess.set(sessionId, Date.now())
  }

  // ============================================================================
  // Testing helpers
  // ============================================================================

  /**
   * Get the StagingServiceCore instance (for testing).
   */
  getStagingCore(): StagingServiceCore {
    return this.stagingCore
  }

  /**
   * Get the cached TranscriptService instances map (for testing).
   */
  getTranscriptServices(): Map<string, TranscriptService> {
    return this.transcriptServices
  }

  /**
   * Get the session last access map (for testing).
   */
  getSessionLastAccess(): Map<string, number> {
    return this.sessionLastAccess
  }

  /**
   * Get the session TTL in milliseconds (for testing).
   */
  getSessionTtlMs(): number {
    return this.SESSION_TTL_MS
  }
}
