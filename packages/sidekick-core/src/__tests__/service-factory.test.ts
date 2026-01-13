/**
 * Tests for ServiceFactoryImpl
 *
 * Tests cover:
 * - getStagingService returns SessionScopedStagingService wrappers
 * - getTranscriptService creates and caches instances
 * - shutdownSession removes cached services
 * - evictStaleSessions removes old sessions
 * - touchSession updates access time
 *
 * @see docs/design/CORE-RUNTIME.md
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MockHandlerRegistry, MockLogger, MockStateService } from '@sidekick/testing-fixtures'
import { ServiceFactoryImpl, type ServiceFactoryOptions } from '../service-factory'
import { SessionScopedStagingService } from '../staging-service'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDir(): string {
  const dir = join(tmpdir(), `service-factory-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createFactory(testDir: string, overrides: Partial<ServiceFactoryOptions> = {}): ServiceFactoryImpl {
  return new ServiceFactoryImpl({
    stateDir: testDir,
    logger: new MockLogger(),
    handlers: new MockHandlerRegistry(),
    stateService: new MockStateService(testDir),
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

describe('ServiceFactoryImpl', () => {
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
  // Constructor tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create a StagingServiceCore instance', () => {
      const factory = createFactory(testDir)

      expect(factory.getStagingCore()).toBeDefined()
    })

    it('should initialize with empty transcript services map', () => {
      const factory = createFactory(testDir)

      expect(factory.getTranscriptServices().size).toBe(0)
    })

    it('should initialize with empty session last access map', () => {
      const factory = createFactory(testDir)

      expect(factory.getSessionLastAccess().size).toBe(0)
    })
  })

  // ==========================================================================
  // getStagingService tests
  // ==========================================================================

  describe('getStagingService', () => {
    it('should return a SessionScopedStagingService', () => {
      const factory = createFactory(testDir)

      const staging = factory.getStagingService('session-1')

      expect(staging).toBeInstanceOf(SessionScopedStagingService)
    })

    it('should return wrapper with correct sessionId', () => {
      const factory = createFactory(testDir)

      const staging = factory.getStagingService('my-session-id') as SessionScopedStagingService

      expect(staging.getSessionId()).toBe('my-session-id')
    })

    it('should pass scope to wrapper', () => {
      const factory = createFactory(testDir, { scope: 'project' })

      const staging = factory.getStagingService('session-1') as SessionScopedStagingService

      expect(staging.getScope()).toBe('project')
    })

    it('should return independent wrappers for same sessionId', () => {
      const factory = createFactory(testDir)

      const wrapper1 = factory.getStagingService('session-1')
      const wrapper2 = factory.getStagingService('session-1')

      expect(wrapper1).not.toBe(wrapper2)
    })

    it('should update session last access time', () => {
      const factory = createFactory(testDir)
      const before = Date.now()

      factory.getStagingService('session-1')

      const lastAccess = factory.getSessionLastAccess().get('session-1')
      expect(lastAccess).toBeDefined()
      expect(lastAccess).toBeGreaterThanOrEqual(before)
    })

    it('should share the same StagingServiceCore across all wrappers', async () => {
      const factory = createFactory(testDir)

      const wrapper1 = factory.getStagingService('session-1') as SessionScopedStagingService
      const wrapper2 = factory.getStagingService('session-2') as SessionScopedStagingService

      // Stage via wrapper1
      await wrapper1.stageReminder('PreToolUse', 'Test', {
        name: 'Test',
        blocking: false,
        priority: 50,
        persistent: false,
      })

      // Verify via core that it's stored correctly
      const reminder = await factory.getStagingCore().readReminder('session-1', 'PreToolUse', 'Test')
      expect(reminder?.name).toBe('Test')

      // Verify session-2 doesn't see session-1's data
      const session2Reminders = await wrapper2.listReminders('PreToolUse')
      expect(session2Reminders).toEqual([])
    })
  })

  // ==========================================================================
  // getTranscriptService tests
  // ==========================================================================

  describe('getTranscriptService', () => {
    it('should create a new TranscriptService instance', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service = await factory.getTranscriptService('session-1', transcriptPath)

      expect(service).toBeDefined()
      expect(service.getMetrics).toBeDefined()
    })

    it('should cache instance for same sessionId', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service1 = await factory.getTranscriptService('session-1', transcriptPath)
      const service2 = await factory.getTranscriptService('session-1', transcriptPath)

      expect(service1).toBe(service2)
    })

    it('should create different instances for different sessionIds', async () => {
      const factory = createFactory(testDir)
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      const transcriptPath2 = createTranscriptFile(testDir, 'session-2')

      const service1 = await factory.getTranscriptService('session-1', transcriptPath1)
      const service2 = await factory.getTranscriptService('session-2', transcriptPath2)

      expect(service1).not.toBe(service2)
    })

    it('should update session last access time', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')
      const before = Date.now()

      await factory.getTranscriptService('session-1', transcriptPath)

      const lastAccess = factory.getSessionLastAccess().get('session-1')
      expect(lastAccess).toBeDefined()
      expect(lastAccess).toBeGreaterThanOrEqual(before)
    })

    it('should store instance in cache', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)

      expect(factory.getTranscriptServices().has('session-1')).toBe(true)
    })
  })

  // ==========================================================================
  // shutdownSession tests
  // ==========================================================================

  describe('shutdownSession', () => {
    it('should remove cached TranscriptService', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      expect(factory.getTranscriptServices().has('session-1')).toBe(true)

      await factory.shutdownSession('session-1')

      expect(factory.getTranscriptServices().has('session-1')).toBe(false)
    })

    it('should remove session from access tracking', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      expect(factory.getSessionLastAccess().has('session-1')).toBe(true)

      await factory.shutdownSession('session-1')

      expect(factory.getSessionLastAccess().has('session-1')).toBe(false)
    })

    it('should log debug message', async () => {
      const logger = new MockLogger()
      const factory = createFactory(testDir, { logger })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      await factory.shutdownSession('session-1')

      const debugLogs = logger.getLogsByLevel('debug')
      expect(debugLogs.some((log) => log.msg === 'Session shutdown')).toBe(true)
    })

    it('should handle non-existent session gracefully', async () => {
      const factory = createFactory(testDir)

      // Should not throw
      await expect(factory.shutdownSession('non-existent')).resolves.toBeUndefined()
    })

    it('should call shutdown on TranscriptService', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service = await factory.getTranscriptService('session-1', transcriptPath)
      const shutdownSpy = vi.spyOn(service, 'shutdown')

      await factory.shutdownSession('session-1')

      expect(shutdownSpy).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // evictStaleSessions tests
  // ==========================================================================

  describe('evictStaleSessions', () => {
    it('should return 0 when no sessions exist', async () => {
      const factory = createFactory(testDir)

      const evicted = await factory.evictStaleSessions()

      expect(evicted).toBe(0)
    })

    it('should not evict fresh sessions', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)

      const evicted = await factory.evictStaleSessions()

      expect(evicted).toBe(0)
      expect(factory.getTranscriptServices().has('session-1')).toBe(true)
    })

    it('should evict stale sessions based on TTL', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)

      // Manipulate the last access time to be older than TTL
      const staleTime = Date.now() - factory.getSessionTtlMs() - 1000
      factory.getSessionLastAccess().set('session-1', staleTime)

      const evicted = await factory.evictStaleSessions()

      expect(evicted).toBe(1)
      expect(factory.getTranscriptServices().has('session-1')).toBe(false)
    })

    it('should evict multiple stale sessions', async () => {
      const factory = createFactory(testDir)
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      const transcriptPath2 = createTranscriptFile(testDir, 'session-2')
      const transcriptPath3 = createTranscriptFile(testDir, 'session-3')

      await factory.getTranscriptService('session-1', transcriptPath1)
      await factory.getTranscriptService('session-2', transcriptPath2)
      await factory.getTranscriptService('session-3', transcriptPath3)

      // Make sessions 1 and 2 stale
      const staleTime = Date.now() - factory.getSessionTtlMs() - 1000
      factory.getSessionLastAccess().set('session-1', staleTime)
      factory.getSessionLastAccess().set('session-2', staleTime)
      // Keep session-3 fresh

      const evicted = await factory.evictStaleSessions()

      expect(evicted).toBe(2)
      expect(factory.getTranscriptServices().has('session-1')).toBe(false)
      expect(factory.getTranscriptServices().has('session-2')).toBe(false)
      expect(factory.getTranscriptServices().has('session-3')).toBe(true)
    })

    it('should log info when sessions are evicted', async () => {
      const logger = new MockLogger()
      const factory = createFactory(testDir, { logger })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)

      const staleTime = Date.now() - factory.getSessionTtlMs() - 1000
      factory.getSessionLastAccess().set('session-1', staleTime)

      await factory.evictStaleSessions()

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs.some((log) => log.msg === 'Evicted stale sessions')).toBe(true)
    })

    it('should not log when no sessions are evicted', async () => {
      const logger = new MockLogger()
      const factory = createFactory(testDir, { logger })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)

      logger.reset() // Clear any logs from setup
      await factory.evictStaleSessions()

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs.some((log) => log.msg === 'Evicted stale sessions')).toBe(false)
    })
  })

  // ==========================================================================
  // touchSession tests
  // ==========================================================================

  describe('touchSession (via service access)', () => {
    it('should update access time on getStagingService', async () => {
      const factory = createFactory(testDir)

      factory.getStagingService('session-1')
      const firstAccess = factory.getSessionLastAccess().get('session-1')

      // Wait a small amount of time
      await new Promise((resolve) => setTimeout(resolve, 10))

      factory.getStagingService('session-1')
      const secondAccess = factory.getSessionLastAccess().get('session-1')

      expect(secondAccess).toBeGreaterThan(firstAccess!)
    })

    it('should update access time on getTranscriptService', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      const firstAccess = factory.getSessionLastAccess().get('session-1')

      // Wait a small amount of time
      await new Promise((resolve) => setTimeout(resolve, 10))

      await factory.getTranscriptService('session-1', transcriptPath)
      const secondAccess = factory.getSessionLastAccess().get('session-1')

      expect(secondAccess).toBeGreaterThan(firstAccess!)
    })
  })

  // ==========================================================================
  // Session TTL tests
  // ==========================================================================

  describe('session TTL', () => {
    it('should have a 30 minute TTL', () => {
      const factory = createFactory(testDir)

      expect(factory.getSessionTtlMs()).toBe(30 * 60 * 1000)
    })
  })

  // ==========================================================================
  // Options tests
  // ==========================================================================

  describe('options', () => {
    it('should pass custom watchDebounceMs to TranscriptService', async () => {
      const factory = createFactory(testDir, { watchDebounceMs: 500 })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      // This primarily tests that the option is passed through without error
      const service = await factory.getTranscriptService('session-1', transcriptPath)
      expect(service).toBeDefined()
    })

    it('should pass custom metricsPersistIntervalMs to TranscriptService', async () => {
      const factory = createFactory(testDir, { metricsPersistIntervalMs: 60000 })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      // This primarily tests that the option is passed through without error
      const service = await factory.getTranscriptService('session-1', transcriptPath)
      expect(service).toBeDefined()
    })
  })

  // ==========================================================================
  // prepareTranscriptService tests
  // ==========================================================================

  describe('prepareTranscriptService', () => {
    it('should create a new TranscriptService instance', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service = await factory.prepareTranscriptService('session-1', transcriptPath)

      expect(service).toBeDefined()
      expect(service.getMetrics).toBeDefined()
    })

    it('should cache instance for same sessionId', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service1 = await factory.prepareTranscriptService('session-1', transcriptPath)
      const service2 = await factory.prepareTranscriptService('session-1', transcriptPath)

      expect(service1).toBe(service2)
    })

    it('should create different instances for different sessionIds', async () => {
      const factory = createFactory(testDir)
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      const transcriptPath2 = createTranscriptFile(testDir, 'session-2')

      const service1 = await factory.prepareTranscriptService('session-1', transcriptPath1)
      const service2 = await factory.prepareTranscriptService('session-2', transcriptPath2)

      expect(service1).not.toBe(service2)
    })

    it('should update session last access time', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')
      const before = Date.now()

      await factory.prepareTranscriptService('session-1', transcriptPath)

      const lastAccess = factory.getSessionLastAccess().get('session-1')
      expect(lastAccess).toBeDefined()
      expect(lastAccess).toBeGreaterThanOrEqual(before)
    })

    it('should store instance in cache', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.prepareTranscriptService('session-1', transcriptPath)

      expect(factory.getTranscriptServices().has('session-1')).toBe(true)
    })

    it('should pass options to TranscriptService', async () => {
      const factory = createFactory(testDir, {
        watchDebounceMs: 250,
        metricsPersistIntervalMs: 45000,
      })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      const service = await factory.prepareTranscriptService('session-1', transcriptPath)
      expect(service).toBeDefined()
    })
  })

  // ==========================================================================
  // shutdownAllSessions tests
  // ==========================================================================

  describe('shutdownAllSessions', () => {
    it('should return 0 when no sessions exist', async () => {
      const factory = createFactory(testDir)

      const count = await factory.shutdownAllSessions()

      expect(count).toBe(0)
    })

    it('should shutdown single session', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      expect(factory.getTranscriptServices().size).toBe(1)

      const count = await factory.shutdownAllSessions()

      expect(count).toBe(1)
      expect(factory.getTranscriptServices().size).toBe(0)
    })

    it('should shutdown multiple sessions', async () => {
      const factory = createFactory(testDir)
      const transcriptPath1 = createTranscriptFile(testDir, 'session-1')
      const transcriptPath2 = createTranscriptFile(testDir, 'session-2')
      const transcriptPath3 = createTranscriptFile(testDir, 'session-3')

      await factory.getTranscriptService('session-1', transcriptPath1)
      await factory.getTranscriptService('session-2', transcriptPath2)
      await factory.getTranscriptService('session-3', transcriptPath3)
      expect(factory.getTranscriptServices().size).toBe(3)

      const count = await factory.shutdownAllSessions()

      expect(count).toBe(3)
      expect(factory.getTranscriptServices().size).toBe(0)
    })

    it('should log info when sessions are shutdown', async () => {
      const logger = new MockLogger()
      const factory = createFactory(testDir, { logger })
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      await factory.shutdownAllSessions()

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs.some((log) => log.msg === 'Shutdown all sessions')).toBe(true)
    })

    it('should not log when no sessions to shutdown', async () => {
      const logger = new MockLogger()
      const factory = createFactory(testDir, { logger })

      logger.reset()
      await factory.shutdownAllSessions()

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs.some((log) => log.msg === 'Shutdown all sessions')).toBe(false)
    })

    it('should clear session access tracking', async () => {
      const factory = createFactory(testDir)
      const transcriptPath = createTranscriptFile(testDir, 'session-1')

      await factory.getTranscriptService('session-1', transcriptPath)
      expect(factory.getSessionLastAccess().size).toBe(1)

      await factory.shutdownAllSessions()

      expect(factory.getSessionLastAccess().size).toBe(0)
    })
  })
})
