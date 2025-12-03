/**
 * Tests for Task Handlers and Orphan Prevention
 *
 * Tests the standard task types (session_summary, resume_generation, cleanup, metrics_persist)
 * and the TaskRegistry for orphan prevention.
 *
 * @see docs/ROADMAP.md Phase 5.2
 */

import { createConsoleLogger, TaskTypes, TrackedTask } from '@sidekick/core'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StateManager } from '../state-manager.js'
import { createTaskRegistry, registerStandardTaskHandlers, TaskRegistry } from '../task-handlers.js'
import { TaskEngine } from '../task-engine.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })

describe('TaskRegistry (Orphan Prevention)', () => {
  let tmpDir: string
  let stateDir: string
  let stateManager: StateManager
  let taskRegistry: TaskRegistry

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-task-registry-test-'))
    stateDir = path.join(tmpDir, '.sidekick', 'state')
    stateManager = new StateManager(stateDir, logger)
    await stateManager.initialize()
    taskRegistry = createTaskRegistry(stateManager, logger)
  })

  afterEach(async () => {
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
        type: TaskTypes.SESSION_SUMMARY,
        sessionId: 'session-abc',
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      const state = taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0]).toEqual(task)
    })

    it('should track multiple tasks', async () => {
      const task1: TrackedTask = {
        id: 'task-1',
        type: TaskTypes.SESSION_SUMMARY,
        enqueuedAt: Date.now(),
      }
      const task2: TrackedTask = {
        id: 'task-2',
        type: TaskTypes.CLEANUP,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task1)
      await taskRegistry.trackTask(task2)
      const state = taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(2)
    })

    it('should mark task as started', async () => {
      const task: TrackedTask = {
        id: 'task-123',
        type: TaskTypes.SESSION_SUMMARY,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      await taskRegistry.markTaskStarted('task-123')
      const state = taskRegistry.getState()

      expect(state.activeTasks[0].startedAt).toBeDefined()
      expect(state.activeTasks[0].startedAt).toBeGreaterThan(0)
    })

    it('should untrack a completed task', async () => {
      const task: TrackedTask = {
        id: 'task-123',
        type: TaskTypes.SESSION_SUMMARY,
        enqueuedAt: Date.now(),
      }

      await taskRegistry.trackTask(task)
      await taskRegistry.untrackTask('task-123')
      const state = taskRegistry.getState()

      expect(state.activeTasks).toHaveLength(0)
    })
  })

  describe('orphan cleanup', () => {
    it('should clean up orphaned tasks on restart', async () => {
      // Simulate orphaned tasks from a crashed supervisor
      const orphanedTasks: TrackedTask[] = [
        { id: 'orphan-1', type: TaskTypes.SESSION_SUMMARY, enqueuedAt: Date.now() - 10000 },
        { id: 'orphan-2', type: TaskTypes.CLEANUP, enqueuedAt: Date.now() - 5000 },
      ]

      for (const task of orphanedTasks) {
        await taskRegistry.trackTask(task)
      }

      // Verify tasks are tracked
      let state = taskRegistry.getState()
      expect(state.activeTasks).toHaveLength(2)

      // Clean up orphans (simulates supervisor restart)
      const cleanedCount = await taskRegistry.cleanupOrphans()

      expect(cleanedCount).toBe(2)
      state = taskRegistry.getState()
      expect(state.activeTasks).toHaveLength(0)
    })

    it('should return 0 when no orphans exist', async () => {
      const cleanedCount = await taskRegistry.cleanupOrphans()
      expect(cleanedCount).toBe(0)
    })

    it('should preserve lastCleanupAt when cleaning orphans', async () => {
      await taskRegistry.updateLastCleanup()
      const stateBefore = taskRegistry.getState()
      const lastCleanup = stateBefore.lastCleanupAt

      // Add and clean orphan
      await taskRegistry.trackTask({
        id: 'orphan-1',
        type: TaskTypes.SESSION_SUMMARY,
        enqueuedAt: Date.now(),
      })
      await taskRegistry.cleanupOrphans()

      const stateAfter = taskRegistry.getState()
      expect(stateAfter.lastCleanupAt).toBe(lastCleanup)
    })
  })

  describe('lastCleanupAt tracking', () => {
    it('should update lastCleanupAt', async () => {
      await taskRegistry.updateLastCleanup()
      const state = taskRegistry.getState()

      expect(state.lastCleanupAt).toBeDefined()
      expect(state.lastCleanupAt).toBeGreaterThan(0)
    })
  })
})

describe('Standard Task Handlers', () => {
  let tmpDir: string
  let projectDir: string
  let stateDir: string
  let stateManager: StateManager
  let taskEngine: TaskEngine

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-task-handlers-test-'))
    projectDir = tmpDir
    stateDir = path.join(tmpDir, '.sidekick', 'state')
    stateManager = new StateManager(stateDir, logger)
    await stateManager.initialize()
    // Use longer timeout for tests (10s instead of 5min)
    taskEngine = new TaskEngine(logger, 2, 10000)

    // Register handlers
    registerStandardTaskHandlers(taskEngine, stateManager, projectDir, logger)
  })

  afterEach(async () => {
    await taskEngine.shutdown()
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('session_summary handler', () => {
    it('should create session summary file', async () => {
      const sessionId = 'test-session-123'
      const completed = vi.fn()

      // Enqueue session summary task
      taskEngine.enqueue(TaskTypes.SESSION_SUMMARY, {
        sessionId,
        transcriptPath: '/fake/path/transcript.jsonl',
        reason: 'cadence_met',
      })

      // Wait for task to complete
      await vi.waitFor(
        async () => {
          const summaryPath = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
          try {
            await fs.access(summaryPath)
            completed()
          } catch {
            // File not yet created
          }
          expect(completed).toHaveBeenCalled()
        },
        { timeout: 5000 }
      )

      // Verify file contents
      const summaryPath = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const content = await fs.readFile(summaryPath, 'utf-8')
      const summary = JSON.parse(content) as { sessionId: string; reason: string }

      expect(summary.sessionId).toBe(sessionId)
      expect(summary.reason).toBe('cadence_met')
    })
  })

  describe('resume_generation handler', () => {
    it('should create resume message file', async () => {
      const sessionId = 'test-session-456'
      const completed = vi.fn()

      taskEngine.enqueue(TaskTypes.RESUME_GENERATION, {
        sessionId,
        summaryPath: '/fake/path/summary.json',
      })

      await vi.waitFor(
        async () => {
          const resumePath = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'resume-message.json')
          try {
            await fs.access(resumePath)
            completed()
          } catch {
            // File not yet created
          }
          expect(completed).toHaveBeenCalled()
        },
        { timeout: 5000 }
      )

      const resumePath = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'resume-message.json')
      const content = await fs.readFile(resumePath, 'utf-8')
      const resume = JSON.parse(content) as { sessionId: string }

      expect(resume.sessionId).toBe(sessionId)
    })
  })

  describe('cleanup handler', () => {
    it('should skip cleanup when sessions directory does not exist', async () => {
      // No sessions directory - cleanup should succeed without error
      taskEngine.enqueue(TaskTypes.CLEANUP, {})

      // Give time for task to complete
      await new Promise((r) => setTimeout(r, 100))

      // Task should complete without error (verified by no exception thrown)
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

  describe('metrics_persist handler', () => {
    it('should acknowledge metrics persist task (placeholder)', async () => {
      // This is a placeholder test - actual metrics persistence is in Phase 5.3
      taskEngine.enqueue(TaskTypes.METRICS_PERSIST, {
        sessionId: 'test-session',
        metricsPath: '/fake/path/metrics.json',
      })

      // Task should complete without error
      await new Promise((r) => setTimeout(r, 100))
    })
  })
})
