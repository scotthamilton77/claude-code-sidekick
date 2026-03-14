/**
 * Missing and empty file handling tests for API handlers.
 *
 * Tests that API endpoints gracefully handle missing files, empty files,
 * and malformed content without exposing internal errors.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleCompactionHistory } from '../handlers/compaction'
import { handleMetrics } from '../handlers/metrics'
import { handlePreCompact } from '../handlers/pre-compact'
import { handleSessionSummary } from '../handlers/session-summary'
import { handleStagedReminders } from '../handlers/staged-reminders'
import type { ApiRequest } from '../types'

describe('Missing file handling', () => {
  let testRoot: string
  let sessionsPath: string
  let testCounter = 0

  beforeEach(() => {
    // Create temporary test directory with counter to avoid Date.now() collisions
    testRoot = join(tmpdir(), `sidekick-test-${Date.now()}-${testCounter++}`)
    sessionsPath = join(testRoot, 'sessions')
    mkdirSync(sessionsPath, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  function createRequest(sessionId: string, additionalParams: Record<string, string> = {}): ApiRequest {
    return {
      ctx: { logsPath: null, sessionsPath, statePath: null },
      params: { sessionId, ...additionalParams },
      query: {},
      method: 'GET',
      url: '',
    } as unknown as ApiRequest
  }

  describe('handleSessionSummary', () => {
    it('returns empty object when summary file missing', async () => {
      const request = createRequest('valid-session')
      const response = await handleSessionSummary(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({})
    })

    it('returns empty object when session directory missing', async () => {
      const request = createRequest('nonexistent-session')
      const response = await handleSessionSummary(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({})
    })

    it('handles empty summary file gracefully', async () => {
      const sessionDir = join(sessionsPath, 'valid-session', 'state')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'session-summary.json'), '')

      const request = createRequest('valid-session')
      const response = await handleSessionSummary(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('handles malformed JSON gracefully', async () => {
      const sessionDir = join(sessionsPath, 'valid-session', 'state')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'session-summary.json'), '{ invalid json')

      const request = createRequest('valid-session')
      const response = await handleSessionSummary(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toHaveProperty('error')
    })
  })

  describe('handleCompactionHistory', () => {
    it('returns empty history when file missing', async () => {
      const request = createRequest('valid-session')
      const response = await handleCompactionHistory(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ history: [] })
    })

    it('handles empty compaction history file', async () => {
      const sessionDir = join(sessionsPath, 'valid-session', 'state')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'compaction-history.json'), '')

      const request = createRequest('valid-session')
      const response = await handleCompactionHistory(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('handles valid empty array', async () => {
      const sessionDir = join(sessionsPath, 'valid-session', 'state')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'compaction-history.json'), '[]')

      const request = createRequest('valid-session')
      const response = await handleCompactionHistory(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ history: [] })
    })
  })

  describe('handleMetrics', () => {
    it('returns null metrics when file missing', async () => {
      const request = createRequest('valid-session')
      const response = await handleMetrics(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ metrics: null })
    })
  })

  describe('handlePreCompact', () => {
    it('returns 404 when snapshot missing', async () => {
      const request = createRequest('valid-session', { timestamp: '1678888888888' })
      const response = await handlePreCompact(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('handles empty snapshot file', async () => {
      const transcriptsDir = join(sessionsPath, 'valid-session', 'transcripts')
      mkdirSync(transcriptsDir, { recursive: true })
      writeFileSync(join(transcriptsDir, 'pre-compact-1678888888888.jsonl'), '')

      const request = createRequest('valid-session', { timestamp: '1678888888888' })
      const response = await handlePreCompact(request)

      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('')
    })
  })

  describe('handleStagedReminders', () => {
    it('returns empty reminders when stage directory missing', async () => {
      const request = createRequest('valid-session', { hookName: 'UserPromptSubmit' })
      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ reminders: [] })
    })

    it('returns empty reminders when stage directory is empty', async () => {
      const stageDir = join(sessionsPath, 'valid-session', 'stage', 'UserPromptSubmit')
      mkdirSync(stageDir, { recursive: true })

      const request = createRequest('valid-session', { hookName: 'UserPromptSubmit' })
      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ reminders: [] })
    })

    it('skips malformed reminder files', async () => {
      const stageDir = join(sessionsPath, 'valid-session', 'stage', 'UserPromptSubmit')
      mkdirSync(stageDir, { recursive: true })

      // Write valid reminder
      writeFileSync(
        join(stageDir, 'valid.json'),
        JSON.stringify({
          name: 'ValidReminder',
          blocking: false,
          priority: 100,
          persistent: false,
        })
      )

      // Write malformed reminder
      writeFileSync(join(stageDir, 'invalid.json'), '{ invalid json')

      const request = createRequest('valid-session', { hookName: 'UserPromptSubmit' })
      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()

      // Should return only the valid reminder
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0].name).toBe('ValidReminder')
    })

    it('skips non-JSON files', async () => {
      const stageDir = join(sessionsPath, 'valid-session', 'stage', 'UserPromptSubmit')
      mkdirSync(stageDir, { recursive: true })

      // Write JSON file
      writeFileSync(
        join(stageDir, 'reminder.json'),
        JSON.stringify({
          name: 'Reminder',
          blocking: false,
          priority: 100,
          persistent: false,
        })
      )

      // Write non-JSON files
      writeFileSync(join(stageDir, 'readme.txt'), 'Not a reminder')
      writeFileSync(join(stageDir, '.hidden'), 'Hidden file')

      const request = createRequest('valid-session', { hookName: 'UserPromptSubmit' })
      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()

      // Should return only the JSON file
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0].name).toBe('Reminder')
    })

    it('sorts reminders by priority descending', async () => {
      const stageDir = join(sessionsPath, 'valid-session', 'stage', 'UserPromptSubmit')
      mkdirSync(stageDir, { recursive: true })

      // Write reminders with different priorities
      writeFileSync(
        join(stageDir, 'low.json'),
        JSON.stringify({
          name: 'LowPriority',
          blocking: false,
          priority: 10,
          persistent: false,
        })
      )

      writeFileSync(
        join(stageDir, 'high.json'),
        JSON.stringify({
          name: 'HighPriority',
          blocking: false,
          priority: 100,
          persistent: false,
        })
      )

      writeFileSync(
        join(stageDir, 'medium.json'),
        JSON.stringify({
          name: 'MediumPriority',
          blocking: false,
          priority: 50,
          persistent: false,
        })
      )

      const request = createRequest('valid-session', { hookName: 'UserPromptSubmit' })
      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()

      expect(data.reminders).toHaveLength(3)
      expect(data.reminders[0].name).toBe('HighPriority')
      expect(data.reminders[1].name).toBe('MediumPriority')
      expect(data.reminders[2].name).toBe('LowPriority')
    })
  })

  describe('Missing sessionsPath context', () => {
    it('handleSessionSummary returns error when sessionsPath is null', async () => {
      const request = {
        ctx: { logsPath: null, sessionsPath: null, statePath: null },
        params: { sessionId: 'valid-session' },
        query: {},
        method: 'GET',
        url: '',
      } as unknown as ApiRequest

      const response = await handleSessionSummary(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Sessions directory not found')
    })

    it('handleStagedReminders returns error when sessionsPath is null', async () => {
      const request = {
        ctx: { logsPath: null, sessionsPath: null, statePath: null },
        params: { sessionId: 'valid-session', hookName: 'UserPromptSubmit' },
        query: {},
        method: 'GET',
        url: '',
      } as unknown as ApiRequest

      const response = await handleStagedReminders(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({
        reminders: [],
        error: 'Sessions directory not found',
      })
    })
  })
})
