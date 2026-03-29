/**
 * Tests for TaskRegistry and validateSessionId.
 *
 * TaskRegistry tracks active tasks in state for orphan prevention on daemon restart.
 * validateSessionId ensures session IDs are safe for file paths.
 *
 * @see docs/design/DAEMON.md §4.3 Task Execution Engine
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockStateService, createFakeLogger } from '@sidekick/testing-fixtures'
import type { MockedLogger } from '@sidekick/testing-fixtures'
import type { TrackedTask } from '@sidekick/types'
import { StateService } from '@sidekick/core'
import { TaskRegistry, validateSessionId } from '../task-registry.js'

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides: Partial<TrackedTask> = {}): TrackedTask {
  return {
    id: overrides.id ?? 'task-1',
    type: overrides.type ?? 'session_summary',
    sessionId: overrides.sessionId ?? 'sess-abc',
    enqueuedAt: overrides.enqueuedAt ?? 1000,
    startedAt: overrides.startedAt,
  }
}

// ============================================================================
// validateSessionId
// ============================================================================

describe('validateSessionId', () => {
  it('accepts alphanumeric session IDs', () => {
    expect(() => validateSessionId('abc123')).not.toThrow()
  })

  it('accepts hyphens and underscores', () => {
    expect(() => validateSessionId('my-session_01')).not.toThrow()
  })

  it('rejects empty string', () => {
    expect(() => validateSessionId('')).toThrow('Invalid sessionId format')
  })

  it('rejects path traversal characters', () => {
    expect(() => validateSessionId('../etc/passwd')).toThrow('Invalid sessionId format')
  })

  it('rejects spaces', () => {
    expect(() => validateSessionId('has spaces')).toThrow('Invalid sessionId format')
  })

  it('rejects slashes', () => {
    expect(() => validateSessionId('foo/bar')).toThrow('Invalid sessionId format')
  })

  it('rejects special characters', () => {
    expect(() => validateSessionId('sess@id')).toThrow('Invalid sessionId format')
    expect(() => validateSessionId('sess.id')).toThrow('Invalid sessionId format')
  })
})

// ============================================================================
// TaskRegistry
// ============================================================================

describe('TaskRegistry', () => {
  let mockState: MockStateService
  let logger: MockedLogger
  let registry: TaskRegistry

  beforeEach(() => {
    mockState = new MockStateService('/test/project')
    logger = createFakeLogger()
    // TaskRegistry expects a StateService; MockStateService implements MinimalStateService
    // which StateService extends, so it's compatible at runtime
    registry = new TaskRegistry(mockState as unknown as StateService, logger)
  })

  describe('getState', () => {
    it('returns empty state when no tasks tracked', async () => {
      const state = await registry.getState()
      expect(state.activeTasks).toEqual([])
      expect(state.lastCleanupAt).toBeUndefined()
    })

    it('returns deep copy (mutations do not affect stored state)', async () => {
      const state = await registry.getState()
      state.activeTasks.push(makeTask())
      const stateAgain = await registry.getState()
      expect(stateAgain.activeTasks).toEqual([])
    })
  })

  describe('trackTask', () => {
    it('adds a task to active tasks', async () => {
      const task = makeTask({ id: 'task-A' })
      await registry.trackTask(task)

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0].id).toBe('task-A')
    })

    it('logs the tracked task', async () => {
      const task = makeTask({ id: 'task-log' })
      await registry.trackTask(task)
      expect(logger.debug).toHaveBeenCalledWith('Task tracked', {
        taskId: 'task-log',
        type: 'session_summary',
      })
    })

    it('accumulates multiple tasks', async () => {
      await registry.trackTask(makeTask({ id: 't1' }))
      await registry.trackTask(makeTask({ id: 't2', type: 'cleanup' }))
      await registry.trackTask(makeTask({ id: 't3', type: 'resume_generation' }))

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(3)
      expect(state.activeTasks.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    })
  })

  describe('markTaskStarted', () => {
    it('sets startedAt timestamp on matching task', async () => {
      const task = makeTask({ id: 'start-me' })
      await registry.trackTask(task)

      await registry.markTaskStarted('start-me')

      const state = await registry.getState()
      expect(state.activeTasks[0].startedAt).toBeTypeOf('number')
      expect(state.activeTasks[0].startedAt).toBeGreaterThan(0)
    })

    it('is a no-op when task ID not found', async () => {
      await registry.trackTask(makeTask({ id: 'existing' }))
      // Should not throw
      await registry.markTaskStarted('nonexistent')

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0].startedAt).toBeUndefined()
    })
  })

  describe('untrackTask', () => {
    it('removes matching task from active tasks', async () => {
      await registry.trackTask(makeTask({ id: 'keep' }))
      await registry.trackTask(makeTask({ id: 'remove' }))

      await registry.untrackTask('remove')

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0].id).toBe('keep')
    })

    it('logs the untracked task', async () => {
      await registry.trackTask(makeTask({ id: 'bye' }))
      await registry.untrackTask('bye')
      expect(logger.debug).toHaveBeenCalledWith('Task untracked', { taskId: 'bye' })
    })

    it('is safe to call for nonexistent task ID', async () => {
      await registry.trackTask(makeTask({ id: 'only' }))
      await registry.untrackTask('ghost')

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(1)
    })
  })

  describe('updateLastCleanup', () => {
    it('sets lastCleanupAt timestamp', async () => {
      await registry.updateLastCleanup()
      const state = await registry.getState()
      expect(state.lastCleanupAt).toBeTypeOf('number')
      expect(state.lastCleanupAt).toBeGreaterThan(0)
    })

    it('preserves existing active tasks', async () => {
      await registry.trackTask(makeTask({ id: 'preserved' }))
      await registry.updateLastCleanup()

      const state = await registry.getState()
      expect(state.activeTasks).toHaveLength(1)
      expect(state.activeTasks[0].id).toBe('preserved')
    })
  })

  describe('cleanupOrphans', () => {
    it('returns 0 when no tasks exist', async () => {
      const count = await registry.cleanupOrphans()
      expect(count).toBe(0)
    })

    it('clears all active tasks and returns count', async () => {
      await registry.trackTask(makeTask({ id: 'orphan-1' }))
      await registry.trackTask(makeTask({ id: 'orphan-2' }))
      await registry.trackTask(makeTask({ id: 'orphan-3' }))

      const count = await registry.cleanupOrphans()
      expect(count).toBe(3)

      const state = await registry.getState()
      expect(state.activeTasks).toEqual([])
    })

    it('logs warning with orphan details', async () => {
      await registry.trackTask(makeTask({ id: 'o1', type: 'cleanup' }))
      await registry.trackTask(makeTask({ id: 'o2', type: 'session_summary' }))

      await registry.cleanupOrphans()

      expect(logger.warn).toHaveBeenCalledWith('Cleaning up orphaned tasks from previous run', {
        orphanCount: 2,
        orphanedTasks: [
          { id: 'o1', type: 'cleanup' },
          { id: 'o2', type: 'session_summary' },
        ],
      })
    })

    it('does not log when no orphans exist', async () => {
      await registry.cleanupOrphans()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('preserves lastCleanupAt from previous state', async () => {
      await registry.updateLastCleanup()
      const before = (await registry.getState()).lastCleanupAt

      await registry.trackTask(makeTask({ id: 'orphan' }))
      await registry.cleanupOrphans()

      const state = await registry.getState()
      expect(state.lastCleanupAt).toBe(before)
    })

    it('is idempotent (second call returns 0)', async () => {
      await registry.trackTask(makeTask({ id: 'once' }))
      expect(await registry.cleanupOrphans()).toBe(1)
      expect(await registry.cleanupOrphans()).toBe(0)
    })
  })
})
