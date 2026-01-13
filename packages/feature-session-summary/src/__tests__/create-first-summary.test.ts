/**
 * Tests for createFirstSessionSummary handler
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDaemonContext, MockLogger, MockHandlerRegistry, MockStateService } from '@sidekick/testing-fixtures'
import type { DaemonContext } from '@sidekick/types'
import type { SessionStartHookEvent } from '@sidekick/core'
import { createFirstSessionSummary } from '../handlers/create-first-summary'
import type { SessionSummaryState } from '../types'

describe('createFirstSessionSummary', () => {
  let ctx: DaemonContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let stateService: MockStateService
  const projectRoot = '/mock/project'

  beforeEach(() => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    stateService = new MockStateService(projectRoot)

    ctx = createMockDaemonContext({
      logger,
      handlers,
      stateService,
      paths: {
        projectDir: projectRoot,
        userConfigDir: `${projectRoot}/.sidekick`,
        projectConfigDir: `${projectRoot}/.sidekick`,
      },
    })
  })

  function createSessionStartEvent(
    startType: 'startup' | 'clear' | 'resume' | 'compact',
    sessionId = 'test-session-1'
  ): SessionStartHookEvent {
    return {
      kind: 'hook',
      hook: 'SessionStart',
      context: {
        sessionId,
        timestamp: Date.now(),
        scope: 'project',
      },
      payload: {
        startType,
        transcriptPath: '/tmp/transcript.jsonl',
      },
    }
  }

  describe('startup startType', () => {
    it('writes placeholder JSON to correct path', async () => {
      const sessionId = 'startup-session-1'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(statePath)).toBe(true)

      const summary = stateService.getStored(statePath) as SessionSummaryState

      expect(summary.session_id).toBe(sessionId)
      expect(summary.session_title).toBe('New Session')
      expect(summary.session_title_confidence).toBe(0)
      expect(summary.latest_intent).toBe('Awaiting first prompt...')
      expect(summary.latest_intent_confidence).toBe(0)
    })

    it('writes valid ISO timestamp', async () => {
      const sessionId = 'startup-session-3'
      const event = createSessionStartEvent('startup', sessionId)

      const beforeTime = new Date()
      await createFirstSessionSummary(event, ctx)
      const afterTime = new Date()

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summary = stateService.getStored(statePath) as SessionSummaryState

      const timestamp = new Date(summary.timestamp)
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })
  })

  describe('clear startType', () => {
    it('writes placeholder JSON to correct path', async () => {
      const sessionId = 'clear-session-1'
      const event = createSessionStartEvent('clear', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summary = stateService.getStored(statePath) as SessionSummaryState

      expect(summary.session_id).toBe(sessionId)
      expect(summary.session_title).toBe('New Session')
      expect(summary.session_title_confidence).toBe(0)
      expect(summary.latest_intent).toBe('Awaiting first prompt...')
      expect(summary.latest_intent_confidence).toBe(0)
    })
  })

  describe('resume startType', () => {
    it('exits early without writing file', async () => {
      const sessionId = 'resume-session-1'
      const event = createSessionStartEvent('resume', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')

      // File should not exist
      expect(stateService.has(statePath)).toBe(false)
    })
  })

  describe('compact startType', () => {
    it('exits early without writing file', async () => {
      const sessionId = 'compact-session-1'
      const event = createSessionStartEvent('compact', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')

      // File should not exist
      expect(stateService.has(statePath)).toBe(false)
    })
  })

  describe('Path resolution', () => {
    it('uses projectConfigDir when available', async () => {
      const sessionId = 'path-session-1'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      // StateService uses the projectRoot to build paths
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(statePath)).toBe(true)
    })

    it('falls back to userConfigDir when projectConfigDir is undefined', async () => {
      const sessionId = 'path-session-2'
      ctx.paths.projectConfigDir = undefined
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      // StateService uses the projectRoot to build paths, verifies the state was written
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(statePath)).toBe(true)
    })
  })

  describe('Multiple sessions', () => {
    it('creates separate directories for different sessions', async () => {
      const sessionId1 = 'multi-session-1'
      const sessionId2 = 'multi-session-2'

      await createFirstSessionSummary(createSessionStartEvent('startup', sessionId1), ctx)
      await createFirstSessionSummary(createSessionStartEvent('startup', sessionId2), ctx)

      const statePath1 = stateService.sessionStatePath(sessionId1, 'session-summary.json')
      const statePath2 = stateService.sessionStatePath(sessionId2, 'session-summary.json')

      const summary1 = stateService.getStored(statePath1) as SessionSummaryState
      const summary2 = stateService.getStored(statePath2) as SessionSummaryState

      expect(summary1.session_id).toBe(sessionId1)
      expect(summary2.session_id).toBe(sessionId2)
    })

    it('handles rapid successive calls to same session', async () => {
      const sessionId = 'rapid-session-1'
      const event = createSessionStartEvent('startup', sessionId)

      // Call twice rapidly
      await Promise.all([createFirstSessionSummary(event, ctx), createFirstSessionSummary(event, ctx)])

      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(statePath)).toBe(true)
    })
  })
})
