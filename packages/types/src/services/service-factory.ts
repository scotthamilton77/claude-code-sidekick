/**
 * Service Factory Types
 *
 * Factory interface for session-scoped service management.
 * Enables concurrent session support by providing session-aware service instances.
 *
 * @see docs/design/CORE-RUNTIME.md
 */

import type { StagingService } from './staging.js'
import type { TranscriptService } from './transcript.js'

/**
 * Factory for creating and managing session-scoped services.
 *
 * Hides singleton vs prototype implementation details:
 * - StagingService: Returns lightweight wrappers that inject sessionId
 * - TranscriptService: Returns actual instances (stateful, one per session)
 *
 * Manages session lifecycle including creation and eviction.
 */
export interface ServiceFactory {
  /**
   * Get a session-scoped StagingService.
   * Returns a wrapper that injects sessionId into underlying calls.
   */
  getStagingService(sessionId: string): StagingService

  /**
   * Get a session-scoped TranscriptService.
   * Returns actual instance (created on demand, cached by sessionId).
   *
   * @deprecated Use prepareTranscriptService() + transcriptService.start() for explicit lifecycle control.
   * This method initializes and starts the service, which may emit events before context is ready.
   */
  getTranscriptService(sessionId: string, transcriptPath: string): Promise<TranscriptService>

  /**
   * Prepare a session-scoped TranscriptService without starting event emission.
   * Returns actual instance (created on demand, cached by sessionId).
   *
   * The service is prepared but NOT started - call transcriptService.start() after
   * wiring up handler context to begin event emission.
   */
  prepareTranscriptService(sessionId: string, transcriptPath: string): Promise<TranscriptService>

  /**
   * Shutdown a session's services (called on SessionEnd).
   */
  shutdownSession(sessionId: string): Promise<void>

  /**
   * Evict stale sessions (called periodically).
   * Returns count of evicted sessions.
   */
  evictStaleSessions(): Promise<number>

  /**
   * Shutdown all sessions (called on daemon stop).
   * Returns count of sessions shutdown.
   */
  shutdownAllSessions(): Promise<number>
}
