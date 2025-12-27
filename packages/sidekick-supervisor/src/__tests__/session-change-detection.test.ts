/**
 * Session Change Detection Integration Tests
 *
 * Tests for Phase 4 ServiceFactory integration with Supervisor:
 * - When a hook arrives with a different sessionId, the old session is shutdown
 * - When the same sessionId arrives, services are reused (idempotency)
 *
 * @see docs/design/SUPERVISOR.md §4.7 TranscriptService Integration
 * @see docs/design/CORE-RUNTIME.md §3 Service Factory
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createConsoleLogger,
  HandlerRegistryImpl,
  ServiceFactoryImpl,
  type ServiceFactoryOptions,
} from '@sidekick/core'

// ============================================================================
// Test Utilities
// ============================================================================

const logger = createConsoleLogger({ minimumLevel: 'error' })

function createTestDir(): string {
  const dir = join(tmpdir(), `session-change-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createFactory(testDir: string, overrides: Partial<ServiceFactoryOptions> = {}): ServiceFactoryImpl {
  const registry = new HandlerRegistryImpl({
    logger,
    sessionId: '',
    scope: 'project',
  })
  return new ServiceFactoryImpl({
    stateDir: testDir,
    logger,
    handlers: registry,
    ...overrides,
  })
}

/**
 * Create a minimal transcript file for testing.
 * TranscriptService requires an actual file to watch.
 */
function createTranscriptFile(testDir: string, sessionId: string): string {
  const transcriptDir = join(testDir, 'transcripts')
  mkdirSync(transcriptDir, { recursive: true })
  const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)
  writeFileSync(transcriptPath, '', 'utf-8')
  return transcriptPath
}

// ============================================================================
// Tests
// ============================================================================

describe('Session Change Detection', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  // ==========================================================================
  // Session change detection tests (simulating Supervisor behavior)
  // ==========================================================================

  describe('when hook arrives with different sessionId', () => {
    it('should shutdown old session services', async () => {
      const factory = createFactory(testDir)

      // Simulate first session initialization
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      const service1 = await factory.getTranscriptService('session-1', transcriptPath1)

      // Verify session-1 is active
      expect(factory.getTranscriptServices().has('session-1')).toBe(true)

      // Spy on shutdown before session change
      const shutdownSpy = vi.spyOn(service1, 'shutdown')

      // Simulate session change (what Supervisor.initializeSession does)
      // When currentSessionId !== newSessionId, it calls shutdownSession
      await factory.shutdownSession('session-1')

      // Verify old session was shutdown
      expect(shutdownSpy).toHaveBeenCalled()
      expect(factory.getTranscriptServices().has('session-1')).toBe(false)

      // Initialize new session
      const transcriptPath2 = createTranscriptFile(testDir, 'session-2')
      const service2 = await factory.getTranscriptService('session-2', transcriptPath2)

      // Verify new session is active
      expect(factory.getTranscriptServices().has('session-2')).toBe(true)
      expect(service2).not.toBe(service1)
    })

    it('should clear session last access tracking for old session', async () => {
      const factory = createFactory(testDir)

      // Initialize first session
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      await factory.getTranscriptService('session-1', transcriptPath1)

      // Verify session-1 is tracked
      expect(factory.getSessionLastAccess().has('session-1')).toBe(true)

      // Simulate session change
      await factory.shutdownSession('session-1')

      // Old session tracking should be cleared
      expect(factory.getSessionLastAccess().has('session-1')).toBe(false)
    })

    it('should create fresh StagingService for new session', async () => {
      const factory = createFactory(testDir)

      // Get staging service for session-1
      const staging1 = factory.getStagingService('session-1')

      // Stage a reminder in session-1
      await staging1.stageReminder('PreToolUse', 'TestReminder', {
        name: 'TestReminder',
        blocking: false,
        priority: 50,
        persistent: false,
      })

      // Verify reminder exists in session-1
      const reminders1 = await staging1.listReminders('PreToolUse')
      expect(reminders1).toHaveLength(1)

      // Simulate session change - shutdown session-1
      await factory.shutdownSession('session-1')

      // Get staging service for session-2
      const staging2 = factory.getStagingService('session-2')

      // Session-2 should have no reminders (fresh session)
      const reminders2 = await staging2.listReminders('PreToolUse')
      expect(reminders2).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Idempotency tests (same sessionId arrives)
  // ==========================================================================

  describe('when same sessionId arrives (idempotency)', () => {
    it('should reuse cached TranscriptService instance', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      // First request for session-1
      const service1 = await factory.getTranscriptService('session-1', transcriptPath)

      // Second request for same session-1
      const service2 = await factory.getTranscriptService('session-1', transcriptPath)

      // Should be the exact same instance (cached)
      expect(service1).toBe(service2)
    })

    it('should not call shutdown on repeated requests', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      // Initialize session
      const service = await factory.getTranscriptService('session-1', transcriptPath)
      const shutdownSpy = vi.spyOn(service, 'shutdown')

      // Multiple requests for same session should not trigger shutdown
      await factory.getTranscriptService('session-1', transcriptPath)
      await factory.getTranscriptService('session-1', transcriptPath)

      expect(shutdownSpy).not.toHaveBeenCalled()
    })

    it('should update session last access time on each request', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      // First request
      await factory.getTranscriptService('session-1', transcriptPath)
      const firstAccess = factory.getSessionLastAccess().get('session-1')!

      // Wait briefly
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Second request
      await factory.getTranscriptService('session-1', transcriptPath)
      const secondAccess = factory.getSessionLastAccess().get('session-1')!

      // Access time should be updated
      expect(secondAccess).toBeGreaterThan(firstAccess)
    })

    it('should preserve staged reminders on repeated requests', async () => {
      const factory = createFactory(testDir)

      // Get staging service
      const staging1 = factory.getStagingService('session-1')

      // Stage a reminder
      await staging1.stageReminder('PreToolUse', 'PersistentReminder', {
        name: 'PersistentReminder',
        blocking: false,
        priority: 50,
        persistent: false,
      })

      // Get staging service again (simulating another hook for same session)
      const staging2 = factory.getStagingService('session-1')

      // Reminder should still exist (wrappers share same StagingServiceCore)
      const reminders = await staging2.listReminders('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('PersistentReminder')
    })
  })

  // ==========================================================================
  // Supervisor pattern simulation
  // ==========================================================================

  describe('Supervisor session management pattern', () => {
    /**
     * Simulates the Supervisor.initializeSession() logic:
     * 1. Detect session change (currentSessionId !== newSessionId)
     * 2. Shutdown old session if different
     * 3. Track new session
     * 4. Get services from factory
     */
    class MockSupervisorSessionManager {
      private currentSessionId: string | null = null
      private transcriptService: unknown = null
      private stagingService: unknown = null
      public shutdownCalls: string[] = []

      constructor(private factory: ServiceFactoryImpl) {}

      async initializeSession(sessionId: string, transcriptPath: string): Promise<void> {
        // Detect session change
        if (this.currentSessionId && this.currentSessionId !== sessionId) {
          await this.factory.shutdownSession(this.currentSessionId)
          this.shutdownCalls.push(this.currentSessionId)
          this.transcriptService = null
          this.stagingService = null
        }

        // Already initialized for THIS session - idempotent
        if (this.currentSessionId === sessionId && this.transcriptService) {
          return
        }

        // Track new session
        this.currentSessionId = sessionId

        // Get services from factory
        this.stagingService = this.factory.getStagingService(sessionId)
        this.transcriptService = await this.factory.getTranscriptService(sessionId, transcriptPath)
      }

      getCurrentSessionId(): string | null {
        return this.currentSessionId
      }

      getTranscriptService(): unknown {
        return this.transcriptService
      }
    }

    it('should track session changes correctly', async () => {
      const factory = createFactory(testDir)
      const manager = new MockSupervisorSessionManager(factory)

      // Initialize session-1
      const path1 = createTranscriptFile(testDir, 'session-1')
      await manager.initializeSession('session-1', path1)

      expect(manager.getCurrentSessionId()).toBe('session-1')
      expect(manager.shutdownCalls).toEqual([])

      // Initialize session-2 (different session)
      const path2 = createTranscriptFile(testDir, 'session-2')
      await manager.initializeSession('session-2', path2)

      expect(manager.getCurrentSessionId()).toBe('session-2')
      expect(manager.shutdownCalls).toEqual(['session-1'])
    })

    it('should be idempotent for same session', async () => {
      const factory = createFactory(testDir)
      const manager = new MockSupervisorSessionManager(factory)

      const path1 = createTranscriptFile(testDir, 'session-1')

      // Initialize session-1 multiple times
      await manager.initializeSession('session-1', path1)
      const service1 = manager.getTranscriptService()

      await manager.initializeSession('session-1', path1)
      const service2 = manager.getTranscriptService()

      // Should be same service instance
      expect(service1).toBe(service2)
      expect(manager.shutdownCalls).toEqual([])
    })

    it('should handle rapid session switching', async () => {
      const factory = createFactory(testDir)
      const manager = new MockSupervisorSessionManager(factory)

      // Rapid session switches (simulating /clear being called multiple times)
      const sessions = ['session-a', 'session-b', 'session-c', 'session-d']

      for (const sessionId of sessions) {
        const path = createTranscriptFile(testDir, sessionId)
        await manager.initializeSession(sessionId, path)
      }

      expect(manager.getCurrentSessionId()).toBe('session-d')
      // Each transition should have shutdown the previous session
      expect(manager.shutdownCalls).toEqual(['session-a', 'session-b', 'session-c'])
    })
  })
})
