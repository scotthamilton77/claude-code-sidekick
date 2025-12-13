/**
 * Tests for createFirstSessionSummary handler
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMockSupervisorContext, MockLogger, MockHandlerRegistry } from '@sidekick/testing-fixtures'
import type { SupervisorContext } from '@sidekick/types'
import type { SessionStartHookEvent } from '@sidekick/core'
import { createFirstSessionSummary } from '../handlers/create-first-summary'
import type { SessionSummaryState } from '../types'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('createFirstSessionSummary', () => {
  let ctx: SupervisorContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let tempDir: string

  beforeEach(async () => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()

    // Create temp directory for state files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-test-'))

    ctx = createMockSupervisorContext({
      logger,
      handlers,
      paths: {
        projectDir: tempDir,
        userConfigDir: path.join(tempDir, '.sidekick'),
        projectConfigDir: path.join(tempDir, '.sidekick'),
      },
    })
  })

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
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

      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')

      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      expect(summary.session_id).toBe(sessionId)
      expect(summary.session_title).toBe('New Session')
      expect(summary.session_title_confidence).toBe(0)
      expect(summary.latest_intent).toBe('Awaiting first prompt...')
      expect(summary.latest_intent_confidence).toBe(0)
    })

    it('creates directory recursively', async () => {
      const sessionId = 'startup-session-2'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const stats = await fs.stat(stateDir)

      expect(stats.isDirectory()).toBe(true)
    })

    it('writes valid ISO timestamp', async () => {
      const sessionId = 'startup-session-3'
      const event = createSessionStartEvent('startup', sessionId)

      const beforeTime = new Date()
      await createFirstSessionSummary(event, ctx)
      const afterTime = new Date()

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      const timestamp = new Date(summary.timestamp)
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })

    it('logs info message with sessionId', async () => {
      const sessionId = 'startup-session-4'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs).toHaveLength(1)
      expect(infoLogs[0].msg).toBe('Created placeholder session summary')
      expect(infoLogs[0].meta).toEqual({ sessionId })
    })

    it('writes formatted JSON with 2-space indentation', async () => {
      const sessionId = 'startup-session-5'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')

      // Check for 2-space indentation
      expect(fileContent).toContain('  "session_id"')
      expect(fileContent).toContain('  "timestamp"')
    })
  })

  describe('clear startType', () => {
    it('writes placeholder JSON to correct path', async () => {
      const sessionId = 'clear-session-1'
      const event = createSessionStartEvent('clear', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      expect(summary.session_id).toBe(sessionId)
      expect(summary.session_title).toBe('New Session')
      expect(summary.session_title_confidence).toBe(0)
      expect(summary.latest_intent).toBe('Awaiting first prompt...')
      expect(summary.latest_intent_confidence).toBe(0)
    })

    it('creates directory recursively', async () => {
      const sessionId = 'clear-session-2'
      const event = createSessionStartEvent('clear', sessionId)

      await createFirstSessionSummary(event, ctx)

      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const stats = await fs.stat(stateDir)

      expect(stats.isDirectory()).toBe(true)
    })

    it('logs info message with sessionId', async () => {
      const sessionId = 'clear-session-3'
      const event = createSessionStartEvent('clear', sessionId)

      await createFirstSessionSummary(event, ctx)

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs).toHaveLength(1)
      expect(infoLogs[0].msg).toBe('Created placeholder session summary')
      expect(infoLogs[0].meta).toEqual({ sessionId })
    })
  })

  describe('resume startType', () => {
    it('exits early without writing file', async () => {
      const sessionId = 'resume-session-1'
      const event = createSessionStartEvent('resume', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')

      // File should not exist
      await expect(fs.access(statePath)).rejects.toThrow()
    })

    it('logs debug message with startType and sessionId', async () => {
      const sessionId = 'resume-session-2'
      const event = createSessionStartEvent('resume', sessionId)

      await createFirstSessionSummary(event, ctx)

      const debugLogs = logger.getLogsByLevel('debug')
      expect(debugLogs).toHaveLength(1)
      expect(debugLogs[0].msg).toBe('Preserving existing summary')
      expect(debugLogs[0].meta).toEqual({ startType: 'resume', sessionId })
    })

    it('does not log info message', async () => {
      const sessionId = 'resume-session-3'
      const event = createSessionStartEvent('resume', sessionId)

      await createFirstSessionSummary(event, ctx)

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs).toHaveLength(0)
    })

    it('does not create state directory', async () => {
      const sessionId = 'resume-session-4'
      const event = createSessionStartEvent('resume', sessionId)

      await createFirstSessionSummary(event, ctx)

      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')

      // Directory should not exist
      await expect(fs.access(stateDir)).rejects.toThrow()
    })
  })

  describe('compact startType', () => {
    it('exits early without writing file', async () => {
      const sessionId = 'compact-session-1'
      const event = createSessionStartEvent('compact', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')

      // File should not exist
      await expect(fs.access(statePath)).rejects.toThrow()
    })

    it('logs debug message with startType and sessionId', async () => {
      const sessionId = 'compact-session-2'
      const event = createSessionStartEvent('compact', sessionId)

      await createFirstSessionSummary(event, ctx)

      const debugLogs = logger.getLogsByLevel('debug')
      expect(debugLogs).toHaveLength(1)
      expect(debugLogs[0].msg).toBe('Preserving existing summary')
      expect(debugLogs[0].meta).toEqual({ startType: 'compact', sessionId })
    })

    it('does not log info message', async () => {
      const sessionId = 'compact-session-3'
      const event = createSessionStartEvent('compact', sessionId)

      await createFirstSessionSummary(event, ctx)

      const infoLogs = logger.getLogsByLevel('info')
      expect(infoLogs).toHaveLength(0)
    })

    it('does not create state directory', async () => {
      const sessionId = 'compact-session-4'
      const event = createSessionStartEvent('compact', sessionId)

      await createFirstSessionSummary(event, ctx)

      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')

      // Directory should not exist
      await expect(fs.access(stateDir)).rejects.toThrow()
    })
  })

  describe('Placeholder JSON structure validation', () => {
    it('includes all required SessionSummaryState fields', async () => {
      const sessionId = 'validation-session-1'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      // Check all required fields exist
      expect(summary).toHaveProperty('session_id')
      expect(summary).toHaveProperty('timestamp')
      expect(summary).toHaveProperty('session_title')
      expect(summary).toHaveProperty('session_title_confidence')
      expect(summary).toHaveProperty('latest_intent')
      expect(summary).toHaveProperty('latest_intent_confidence')
    })

    it('uses correct placeholder values', async () => {
      const sessionId = 'validation-session-2'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      expect(summary.session_title).toBe('New Session')
      expect(summary.session_title_confidence).toBe(0)
      expect(summary.latest_intent).toBe('Awaiting first prompt...')
      expect(summary.latest_intent_confidence).toBe(0)
    })

    it('confidence values are numbers', async () => {
      const sessionId = 'validation-session-3'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      expect(typeof summary.session_title_confidence).toBe('number')
      expect(typeof summary.latest_intent_confidence).toBe('number')
    })

    it('timestamp is valid ISO 8601 string', async () => {
      const sessionId = 'validation-session-4'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileContent = await fs.readFile(statePath, 'utf-8')
      const summary: SessionSummaryState = JSON.parse(fileContent)

      // Should be parseable as Date
      const timestamp = new Date(summary.timestamp)
      expect(timestamp.toISOString()).toBe(summary.timestamp)
    })
  })

  describe('Path resolution', () => {
    it('uses projectConfigDir when available', async () => {
      const sessionId = 'path-session-1'
      const projectDir = path.join(tempDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })

      ctx.paths.projectConfigDir = path.join(projectDir, '.sidekick')
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileExists = await fs.access(statePath).then(
        () => true,
        () => false
      )

      expect(fileExists).toBe(true)
    })

    it('falls back to userConfigDir when projectConfigDir is undefined', async () => {
      const sessionId = 'path-session-2'

      ctx.paths.projectConfigDir = undefined
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      const statePath = path.join(ctx.paths.userConfigDir, 'sessions', sessionId, 'state', 'session-summary.json')
      const fileExists = await fs.access(statePath).then(
        () => true,
        () => false
      )

      expect(fileExists).toBe(true)
    })

    it('creates nested directory structure correctly', async () => {
      const sessionId = 'path-session-3'
      const event = createSessionStartEvent('startup', sessionId)

      await createFirstSessionSummary(event, ctx)

      // Verify all parts of the path exist
      const baseDir = path.join(tempDir, '.sidekick')
      const sessionsDir = path.join(baseDir, 'sessions')
      const sessionDir = path.join(sessionsDir, sessionId)
      const stateDir = path.join(sessionDir, 'state')

      const baseDirStats = await fs.stat(baseDir)
      const sessionsDirStats = await fs.stat(sessionsDir)
      const sessionDirStats = await fs.stat(sessionDir)
      const stateDirStats = await fs.stat(stateDir)

      expect(baseDirStats.isDirectory()).toBe(true)
      expect(sessionsDirStats.isDirectory()).toBe(true)
      expect(sessionDirStats.isDirectory()).toBe(true)
      expect(stateDirStats.isDirectory()).toBe(true)
    })
  })

  describe('Multiple sessions', () => {
    it('creates separate directories for different sessions', async () => {
      const sessionId1 = 'multi-session-1'
      const sessionId2 = 'multi-session-2'

      await createFirstSessionSummary(createSessionStartEvent('startup', sessionId1), ctx)
      await createFirstSessionSummary(createSessionStartEvent('startup', sessionId2), ctx)

      const statePath1 = path.join(tempDir, '.sidekick', 'sessions', sessionId1, 'state', 'session-summary.json')
      const statePath2 = path.join(tempDir, '.sidekick', 'sessions', sessionId2, 'state', 'session-summary.json')

      const summary1 = JSON.parse(await fs.readFile(statePath1, 'utf-8'))
      const summary2 = JSON.parse(await fs.readFile(statePath2, 'utf-8'))

      expect(summary1.session_id).toBe(sessionId1)
      expect(summary2.session_id).toBe(sessionId2)
    })

    it('handles rapid successive calls to same session', async () => {
      const sessionId = 'rapid-session-1'
      const event = createSessionStartEvent('startup', sessionId)

      // Call twice rapidly
      await Promise.all([createFirstSessionSummary(event, ctx), createFirstSessionSummary(event, ctx)])

      const statePath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const fileExists = await fs.access(statePath).then(
        () => true,
        () => false
      )

      expect(fileExists).toBe(true)
    })
  })
})
