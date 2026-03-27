/**
 * Tests for Task Handlers and Orphan Prevention
 *
 * Tests the standard task types (cleanup)
 * and the TaskRegistry for orphan prevention.
 */

import { createConsoleLogger, SidekickConfig, StateService, TaskTypes, TrackedTask } from '@sidekick/core'
import type { MinimalAssetResolver, DaemonContext } from '@sidekick/types'
import { readFileSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerStandardTaskHandlers, TaskRegistry } from '../task-handlers.js'
import { validateSessionId } from '../task-registry.js'
import { ContextGetter, TaskEngine } from '../task-engine.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })

// Mock LLM provider
const mockLlmProvider = {
  id: 'mock',
  complete: () =>
    Promise.resolve({
      content: '{"message": "Test mock response"}',
      model: 'mock',
      usage: { inputTokens: 0, outputTokens: 0 },
      rawResponse: { status: 200, body: '' },
    }),
}

// Mock profile factory that returns the mock LLM provider
const mockProfileFactory = {
  createForProfile: () => mockLlmProvider,
  createDefault: () => mockLlmProvider,
}

// Mock context getter for tests
const mockContextGetter: ContextGetter = () =>
  ({
    role: 'daemon',
    config: {
      core: { logging: { level: 'error' }, development: { enabled: false } },
      llm: {
        defaultProfile: 'fast-lite',
        profiles: {
          'fast-lite': { provider: 'openrouter', model: 'test-model' },
          creative: { provider: 'openrouter', model: 'test-model' },
        },
        fallbackProfiles: {
          'cheap-fallback': { provider: 'openrouter', model: 'test-fallback' },
        },
      },
      getAll: () => ({}),
      getFeature: () => undefined,
    },
    logger,
    assets: { resolve: () => undefined },
    paths: { userConfigDir: '/tmp', projectConfigDir: '/tmp' },
    handlers: { register: () => {}, dispatch: async () => {} },
    llm: mockLlmProvider,
    profileFactory: mockProfileFactory,
    staging: {
      stageReminder: () => Promise.resolve(),
      readReminder: () => Promise.resolve(null),
      clearStaging: () => Promise.resolve(),
      listReminders: () => Promise.resolve([]),
      deleteReminder: () => Promise.resolve(false),
      listConsumedReminders: () => Promise.resolve([]),
      getLastConsumed: () => Promise.resolve(null),
    },
    transcript: {
      initialize: async () => {},
      prepare: async () => {},
      start: async () => {},
      shutdown: async () => {},
      getTranscript: () => ({
        entries: [],
        metadata: { sessionId: '', transcriptPath: '', lineCount: 0, lastModified: 0 },
        toString: () => '',
      }),
      getExcerpt: () => ({ content: '', lineCount: 0, startLine: 0, endLine: 0, bookmarkApplied: false }),
      getMetrics: () => ({
        turnCount: 0,
        toolCount: 0,
        toolsThisTurn: 0,
        messageCount: 0,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
          serviceTierCounts: {},
          byModel: {},
        },
        currentContextTokens: 0,
        isPostCompactIndeterminate: false,
        toolsPerTurn: 0,
        lastProcessedLine: 0,
        lastUpdatedAt: 0,
      }),
      getMetric: () => 0 as never,
      onMetricsChange: () => () => {},
      onThreshold: () => () => {},
      capturePreCompactState: async () => {},
      getCompactionHistory: () => [],
    },
  }) as unknown as DaemonContext

// Path to assets directory for loading real prompt/schema files
const ASSETS_DIR = path.join(__dirname, '../../../../assets/sidekick')

// Mock asset resolver that returns real assets for testing
const mockAssetResolver: MinimalAssetResolver = {
  cascadeLayers: [ASSETS_DIR],
  resolve: (assetPath: string): string | null => {
    try {
      const fullPath = path.join(ASSETS_DIR, assetPath)
      return readFileSync(fullPath, 'utf-8')
    } catch {
      return null
    }
  },
}

// Mock config for testing - uses profile-based LLM structure
const mockConfig: SidekickConfig = {
  core: {
    logging: { level: 'error', format: 'json', consoleEnabled: false, components: {} },
    paths: { state: '.sidekick' },
    daemon: { idleTimeoutMs: 300000, shutdownTimeoutMs: 30000, projects: { retentionDays: 30 } },
    ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    development: { enabled: false },
  },
  llm: {
    defaultProfile: 'fast-lite',
    defaultFallbackProfileId: undefined,
    profiles: {
      'fast-lite': {
        provider: 'openrouter',
        model: 'x-ai/grok-4-fast',
        temperature: 0,
        maxTokens: 4096,
        timeout: 30,
        timeoutMaxRetries: 3,
      },
    },
    fallbackProfiles: {},
    global: {
      debugDumpEnabled: false,
      emulatedProvider: undefined,
    },
  },
  transcript: {
    watchDebounceMs: 100,
    metricsPersistIntervalMs: 5000,
  },
  features: {},
}

describe('validateSessionId', () => {
  it('should accept valid session IDs with alphanumeric, dashes, and underscores', () => {
    expect(() => validateSessionId('abc123')).not.toThrow()
    expect(() => validateSessionId('session-with-dashes')).not.toThrow()
    expect(() => validateSessionId('session_with_underscores')).not.toThrow()
    expect(() => validateSessionId('ABC-123_def')).not.toThrow()
  })

  it('should reject empty session ID', () => {
    expect(() => validateSessionId('')).toThrow('Invalid sessionId format')
  })

  it('should reject session IDs with path traversal characters', () => {
    expect(() => validateSessionId('../etc/passwd')).toThrow('Invalid sessionId format')
    expect(() => validateSessionId('session/../../root')).toThrow('Invalid sessionId format')
  })

  it('should reject session IDs with spaces', () => {
    expect(() => validateSessionId('session with spaces')).toThrow('Invalid sessionId format')
  })

  it('should reject session IDs with special characters', () => {
    expect(() => validateSessionId('session@id')).toThrow('Invalid sessionId format')
    expect(() => validateSessionId('session.id')).toThrow('Invalid sessionId format')
  })
})

describe('TaskRegistry (Orphan Prevention)', () => {
  let tmpDir: string
  let stateService: StateService
  let taskRegistry: TaskRegistry

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-task-registry-test-'))
    stateService = new StateService(tmpDir, { cache: true, logger })
    taskRegistry = new TaskRegistry(stateService, logger)
  })

  afterEach(async () => {
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('task tracking', () => {
    it('should track a new task', async () => {
      const task: TrackedTask = {
        id: 'task-123',
        type: TaskTypes.CLEANUP,
        sessionId: 'session-abc',
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      const state = await taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0]).toEqual(task)
    })

    it('should track multiple tasks', async () => {
      const task1: TrackedTask = {
        id: 'task-1',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      }
      const task2: TrackedTask = {
        id: 'task-2',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task1)
      await taskRegistry.trackTask(task2)
      const state = await taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(2)
    })

    it('should mark task as started', async () => {
      const task: TrackedTask = {
        id: 'task-123',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      await taskRegistry.markTaskStarted('task-123')
      const state = await taskRegistry.getState()

      expect(state.activeTasks[0].startedAt).toBeDefined()
      expect(state.activeTasks[0].startedAt).toBeGreaterThan(0)
    })

    it('should untrack a completed task', async () => {
      const task: TrackedTask = {
        id: 'task-123',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      await taskRegistry.untrackTask('task-123')
      const state = await taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(0)
    })
  })

  describe('orphan cleanup', () => {
    it('should clean up orphaned tasks on restart', async () => {
      // Simulate orphaned tasks from a crashed daemon
      const orphanedTasks: TrackedTask[] = [
        { id: 'orphan-1', type: TaskTypes.CLEANUP, enqueuedAt: Date.now() - 10000 },
        { id: 'orphan-2', type: TaskTypes.CLEANUP, enqueuedAt: Date.now() - 5000 },
      ]

      for (const task of orphanedTasks) {
        await taskRegistry.trackTask(task)
      }

      // Verify tasks are tracked
      let state = await taskRegistry.getState()
      expect(state.activeTasks).toHaveLength(2)

      // Clean up orphans (simulates daemon restart)
      const cleanedCount = await taskRegistry.cleanupOrphans()

      expect(cleanedCount).toBe(2)
      state = await taskRegistry.getState()
      expect(state.activeTasks).toHaveLength(0)
    })

    it('should return 0 when no orphans exist', async () => {
      const cleanedCount = await taskRegistry.cleanupOrphans()
      expect(cleanedCount).toBe(0)
    })

    it('should preserve lastCleanupAt when cleaning orphans', async () => {
      await taskRegistry.updateLastCleanup()
      const stateBefore = await taskRegistry.getState()
      const lastCleanup = stateBefore.lastCleanupAt

      // Add and clean orphan
      await taskRegistry.trackTask({
        id: 'orphan-1',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      })
      await taskRegistry.cleanupOrphans()

      const stateAfter = await taskRegistry.getState()
      expect(stateAfter.lastCleanupAt).toBe(lastCleanup)
    })
  })

  describe('lastCleanupAt tracking', () => {
    it('should update lastCleanupAt', async () => {
      await taskRegistry.updateLastCleanup()
      const state = await taskRegistry.getState()

      expect(state.lastCleanupAt).toBeDefined()
      expect(state.lastCleanupAt).toBeGreaterThan(0)
    })
  })
})

describe('Standard Task Handlers', () => {
  let tmpDir: string
  let projectDir: string
  let stateService: StateService
  let taskEngine: TaskEngine

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-task-handlers-test-'))
    projectDir = tmpDir
    stateService = new StateService(projectDir, { cache: true, logger })
    // Use longer timeout for tests (10s instead of 5min)
    taskEngine = new TaskEngine(logger, mockContextGetter, 2, 10000)

    // Register handlers
    registerStandardTaskHandlers(taskEngine, stateService, projectDir, logger, mockConfig, mockAssetResolver)
  })

  afterEach(async () => {
    await taskEngine.shutdown()
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('cleanup handler', () => {
    it('should skip cleanup when sessions directory does not exist', async () => {
      // Create a spy on the debug logger since the handler logs at debug level
      const debugSpy = vi.spyOn(logger, 'debug')

      // No sessions directory exists - cleanup should handle gracefully
      taskEngine.enqueue(TaskTypes.CLEANUP, {})

      // Wait for task to complete
      await vi.waitFor(
        () => {
          // Verify the debug log indicating sessions directory doesn't exist
          expect(debugSpy).toHaveBeenCalledWith('Sessions directory does not exist, nothing to clean')
        },
        { timeout: 1000 }
      )
    })

    it('should clean old session directories', async () => {
      const sessionsDir = path.join(projectDir, '.sidekick', 'sessions')

      // Create an old session directory
      const oldSessionPath = path.join(sessionsDir, 'old-session')
      await fs.mkdir(oldSessionPath, { recursive: true })
      await fs.writeFile(path.join(oldSessionPath, 'test.json'), '{}')

      // Touch the directory to set old mtime
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days ago
      await fs.utimes(oldSessionPath, oldTime / 1000, oldTime / 1000)

      // Create a recent session directory
      const newSessionPath = path.join(sessionsDir, 'new-session')
      await fs.mkdir(newSessionPath, { recursive: true })
      await fs.writeFile(path.join(newSessionPath, 'test.json'), '{}')

      // Enqueue cleanup with 7-day max age
      taskEngine.enqueue(TaskTypes.CLEANUP, {
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      })

      await vi.waitFor(
        async () => {
          // Old session should be removed
          const oldExists = await fs
            .access(oldSessionPath)
            .then(() => true)
            .catch(() => false)
          expect(oldExists).toBe(false)
        },
        { timeout: 5000 }
      )

      // New session should still exist
      const newExists = await fs
        .access(newSessionPath)
        .then(() => true)
        .catch(() => false)
      expect(newExists).toBe(true)
    })

    it('should respect dry-run mode', async () => {
      const sessionsDir = path.join(projectDir, '.sidekick', 'sessions')
      const oldSessionPath = path.join(sessionsDir, 'old-session')
      await fs.mkdir(oldSessionPath, { recursive: true })

      // Touch to make old
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000
      await fs.utimes(oldSessionPath, oldTime / 1000, oldTime / 1000)

      // Enqueue cleanup with dry-run
      taskEngine.enqueue(TaskTypes.CLEANUP, {
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
        dryRun: true,
      })

      await new Promise((r) => setTimeout(r, 200))

      // Session should still exist in dry-run mode
      const exists = await fs
        .access(oldSessionPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })
  })
})
