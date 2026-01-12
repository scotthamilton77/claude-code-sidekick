/**
 * Tests for Cleanup Handler
 *
 * Tests the cleanup task handler for session directory pruning.
 * Covers: validation, dry-run, actual cleanup, abortion, and error handling.
 */

import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLogger } from '@sidekick/testing-fixtures'
import { createCleanupHandler } from '../cleanup.handler.js'
import { TaskRegistry } from '../../task-registry.js'
import { StateManager } from '../../state-manager.js'
import type { TaskContext } from '@sidekick/types'

describe('CleanupHandler', () => {
  let tmpDir: string
  let projectDir: string
  let stateDir: string
  let sessionsDir: string
  let stateManager: StateManager
  let taskRegistry: TaskRegistry
  let logger: MockLogger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-handler-test-'))
    projectDir = tmpDir
    stateDir = path.join(tmpDir, '.sidekick', 'state')
    sessionsDir = path.join(projectDir, '.sidekick', 'sessions')
    logger = new MockLogger()
    stateManager = new StateManager(stateDir, logger)
    await stateManager.initialize()
    taskRegistry = new TaskRegistry(stateManager, logger)
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  function createContext(overrides?: Partial<TaskContext>): TaskContext {
    const abortController = new AbortController()
    return {
      taskId: 'test-task-123',
      sessionId: 'test-session',
      logger,
      signal: abortController.signal,
      ...overrides,
    }
  }

  describe('payload validation', () => {
    it('should throw on invalid payload type', async () => {
      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      // maxAgeMs must be a number, not a string
      await expect(handler({ maxAgeMs: 'not-a-number' }, ctx)).rejects.toThrow('Invalid task payload')
      expect(logger.wasLogged('Invalid payload', 'error')).toBe(true)
    })

    it('should accept valid empty payload', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      // Empty object is valid - uses defaults
      await handler({}, ctx)

      expect(logger.wasLogged('Cleanup task started')).toBe(true)
    })
  })

  describe('signal abortion at start', () => {
    it('should exit immediately when signal is already aborted', async () => {
      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const abortController = new AbortController()
      abortController.abort()

      const ctx = createContext({ signal: abortController.signal })

      await handler({}, ctx)

      expect(logger.wasLogged('Cleanup task cancelled')).toBe(true)
    })
  })

  describe('signal abortion mid-execution', () => {
    it('should stop processing and skip lastCleanup update when aborted mid-execution', async () => {
      // Create multiple sessions so we can abort mid-way
      await fs.mkdir(sessionsDir, { recursive: true })
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000

      // Create 5 old sessions
      for (let i = 0; i < 5; i++) {
        const sessionPath = path.join(sessionsDir, `session-${i}`)
        await fs.mkdir(sessionPath, { recursive: true })
        await fs.writeFile(path.join(sessionPath, 'data.json'), '{}')
        await fs.utimes(sessionPath, oldTime / 1000, oldTime / 1000)
      }

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const abortController = new AbortController()

      // Mock fs.stat to abort the signal after the first call
      const originalStat = fs.stat
      let callCount = 0
      vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
        callCount++
        if (callCount === 2) {
          // Abort after processing first session
          abortController.abort()
        }

        return originalStat(...(args as [any]))
      })

      const ctx = createContext({ signal: abortController.signal })

      await handler({ maxAgeMs: 1 }, ctx)

      // Should log mid-execution cancellation
      expect(
        logger.wasLogged('Cleanup task cancelled mid-execution') ||
          logger.wasLogged('Cleanup task cancelled mid-execution, not updating lastCleanup')
      ).toBe(true)
    })
  })

  describe('stat error handling', () => {
    it('should continue processing other sessions when stat fails for one', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      // Create a normal old session
      const normalSessionPath = path.join(sessionsDir, 'normal-session')
      await fs.mkdir(normalSessionPath, { recursive: true })
      await fs.writeFile(path.join(normalSessionPath, 'data.json'), '{}')
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000
      await fs.utimes(normalSessionPath, oldTime / 1000, oldTime / 1000)

      // Create a session that will fail stat (remove it after readdir but before stat)
      const problematicSessionPath = path.join(sessionsDir, 'problematic-session')
      await fs.mkdir(problematicSessionPath, { recursive: true })

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      // Delete problematic session after readdir
      const originalReaddir = fs.readdir
      vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args) => {
        const result = await originalReaddir(...(args as [any]))
        // Delete the problematic session before returning
        await fs.rm(problematicSessionPath, { recursive: true, force: true })
        return result
      })

      const ctx = createContext()

      await handler({ maxAgeMs: 1 }, ctx)

      expect(logger.wasLogged('Failed to stat session directory', 'warn')).toBe(true)
      expect(logger.wasLogged('Cleanup task completed')).toBe(true)
    })
  })

  describe('actual cleanup (non-dry-run)', () => {
    it('should delete old session directories', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      const oldSessionPath = path.join(sessionsDir, 'old-session')
      await fs.mkdir(oldSessionPath, { recursive: true })
      await fs.writeFile(path.join(oldSessionPath, 'data.json'), '{}')
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000
      await fs.utimes(oldSessionPath, oldTime / 1000, oldTime / 1000)

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await handler({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 }, ctx)

      // Verify session was deleted
      const exists = await fs
        .access(oldSessionPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)

      expect(logger.wasLogged('Cleaned session')).toBe(true)
      expect(logger.wasLogged('Cleanup task completed')).toBe(true)
    })

    it('should skip non-directory entries', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      // Create a file (not a directory) in sessions dir
      const filePath = path.join(sessionsDir, 'not-a-directory.txt')
      await fs.writeFile(filePath, 'test content')
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000
      await fs.utimes(filePath, oldTime / 1000, oldTime / 1000)

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await handler({ maxAgeMs: 1 }, ctx)

      // File should still exist (we only clean directories)
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })

    it('should skip recent sessions', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      const recentSessionPath = path.join(sessionsDir, 'recent-session')
      await fs.mkdir(recentSessionPath, { recursive: true })
      await fs.writeFile(path.join(recentSessionPath, 'data.json'), '{}')
      // Recent - don't touch mtime

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await handler({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 }, ctx)

      // Verify session was NOT deleted
      const exists = await fs
        .access(recentSessionPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })
  })

  describe('dry-run mode', () => {
    it('should log but not delete in dry-run mode', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      const oldSessionPath = path.join(sessionsDir, 'old-session')
      await fs.mkdir(oldSessionPath, { recursive: true })
      await fs.writeFile(path.join(oldSessionPath, 'data.json'), '{}')
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000
      await fs.utimes(oldSessionPath, oldTime / 1000, oldTime / 1000)

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await handler({ maxAgeMs: 7 * 24 * 60 * 60 * 1000, dryRun: true }, ctx)

      // Verify session was NOT deleted
      const exists = await fs
        .access(oldSessionPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)

      expect(logger.wasLogged('Would clean session (dry-run)')).toBe(true)
    })
  })

  describe('sessions directory does not exist', () => {
    it('should handle gracefully when sessions directory does not exist', async () => {
      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      // Should not throw
      await handler({}, ctx)

      expect(logger.wasLogged('Sessions directory does not exist, nothing to clean')).toBe(true)
    })
  })

  describe('unexpected error handling', () => {
    it('should rethrow unexpected errors', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      // Mock readdir to throw a non-ENOENT error
      vi.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('Disk read error'))

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await expect(handler({}, ctx)).rejects.toThrow('Disk read error')

      expect(logger.wasLogged('Cleanup task failed', 'error')).toBe(true)
    })
  })

  describe('lastCleanup update', () => {
    it('should update lastCleanup timestamp after successful cleanup', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      const stateBefore = taskRegistry.getState()
      const lastCleanupBefore = stateBefore.lastCleanupAt ?? 0

      await handler({}, ctx)

      const stateAfter = taskRegistry.getState()
      expect(stateAfter.lastCleanupAt).toBeDefined()
      expect(stateAfter.lastCleanupAt!).toBeGreaterThan(lastCleanupBefore)
    })
  })

  describe('taskRegistry integration', () => {
    it('should mark task as started via taskRegistry', async () => {
      await fs.mkdir(sessionsDir, { recursive: true })

      // Track the task first
      await taskRegistry.trackTask({
        id: 'test-task-123',
        type: 'cleanup',
        enqueuedAt: Date.now(),
      })

      const handler = createCleanupHandler({
        taskRegistry,
        projectDir,
        logger,
      })

      const ctx = createContext()

      await handler({}, ctx)

      // Verify task was marked as started
      const state = taskRegistry.getState()
      const task = state.activeTasks.find((t) => t.id === 'test-task-123')
      expect(task?.startedAt).toBeDefined()
    })
  })
})
