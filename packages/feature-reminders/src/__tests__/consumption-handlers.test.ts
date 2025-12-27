/**
 * Tests for consumption handlers and CLI staging reader
 * @see docs/design/FEATURE-REMINDERS.md §3.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLIStagingReader } from '../cli-staging-reader'
import type { RuntimePaths } from '@sidekick/types'

describe('consumption-handlers', () => {
  describe('CLIStagingReader', () => {
    const testStateDir = '/tmp/test-state-reminders'
    const sessionId = 'test-session-123'
    // CLIStagingReader uses projectConfigDir/sessions/sessionId/stage/hook
    const mockPaths: RuntimePaths = {
      projectDir: '/mock/project',
      userConfigDir: '/mock/user',
      projectConfigDir: testStateDir, // Points to our test directory
    }

    beforeEach(() => {
      const stagingDirs = ['PreToolUse', 'Stop', 'PostToolUse']
      stagingDirs.forEach((hook) => {
        // Path must match what CLIStagingReader expects: projectConfigDir/sessions/sessionId/stage/hook
        const dir = join(testStateDir, 'sessions', sessionId, 'stage', hook)
        mkdirSync(dir, { recursive: true })
      })
    })

    afterEach(() => {
      rmSync(testStateDir, { recursive: true, force: true })
    })

    it('returns empty array when no reminders staged', () => {
      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })
      const reminders = reader.listReminders('Stop')
      expect(reminders).toEqual([])
    })

    it('returns reminders sorted by priority (highest first)', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(
        join(stagingDir, 'low-priority.json'),
        JSON.stringify({
          name: 'low-priority',
          blocking: false,
          priority: 10,
          persistent: false,
        })
      )
      writeFileSync(
        join(stagingDir, 'high-priority.json'),
        JSON.stringify({
          name: 'high-priority',
          blocking: true,
          priority: 80,
          persistent: false,
        })
      )
      writeFileSync(
        join(stagingDir, 'medium-priority.json'),
        JSON.stringify({
          name: 'medium-priority',
          blocking: false,
          priority: 50,
          persistent: false,
        })
      )

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })
      const reminders = reader.listReminders('PreToolUse')

      expect(reminders).toHaveLength(3)
      expect(reminders[0].name).toBe('high-priority')
      expect(reminders[0].priority).toBe(80)
      expect(reminders[1].name).toBe('medium-priority')
      expect(reminders[1].priority).toBe(50)
      expect(reminders[2].name).toBe('low-priority')
      expect(reminders[2].priority).toBe(10)
    })

    it('handles suppression marker', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
      const suppressedMarker = join(stagingDir, '.suppressed')
      writeFileSync(suppressedMarker, '')

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      expect(existsSync(suppressedMarker)).toBe(true)
      expect(reader.checkAndClearSuppression('Stop')).toBe(true)
      expect(existsSync(suppressedMarker)).toBe(false)
    })

    it('returns false when checking suppression on non-suppressed hook', () => {
      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      expect(reader.checkAndClearSuppression('PreToolUse')).toBe(false)
    })

    it('deletes reminder file', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      const reminderPath = join(stagingDir, 'test-reminder.json')
      writeFileSync(
        reminderPath,
        JSON.stringify({
          name: 'test-reminder',
          blocking: true,
          priority: 70,
          persistent: false,
        })
      )

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      expect(existsSync(reminderPath)).toBe(true)
      reader.deleteReminder('PreToolUse', 'test-reminder')
      expect(existsSync(reminderPath)).toBe(false)
    })

    it('handles delete on non-existent reminder gracefully', () => {
      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      // Should not throw
      expect(() => {
        reader.deleteReminder('PreToolUse', 'nonexistent')
      }).not.toThrow()
    })

    it('returns empty array when staging directory does not exist', () => {
      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId: 'non-existent-session',
      })

      const reminders = reader.listReminders('PreToolUse')
      expect(reminders).toEqual([])
    })

    it('skips malformed JSON files', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(join(stagingDir, 'valid.json'), JSON.stringify({ name: 'valid', priority: 50 }))
      writeFileSync(join(stagingDir, 'malformed.json'), 'not valid json {')

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      const reminders = reader.listReminders('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('valid')
    })

    it('only reads JSON files', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(join(stagingDir, 'reminder.json'), JSON.stringify({ name: 'json-file', priority: 50 }))
      writeFileSync(join(stagingDir, 'readme.txt'), 'This is a text file')
      writeFileSync(join(stagingDir, '.suppressed'), '')

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      const reminders = reader.listReminders('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('json-file')
    })

    it('excludes consumed reminders (files with timestamp suffix)', () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      // Active reminder (should be included)
      writeFileSync(join(stagingDir, 'active-reminder.json'), JSON.stringify({ name: 'active-reminder', priority: 50 }))

      // Consumed reminders with timestamp suffixes (should be excluded)
      writeFileSync(
        join(stagingDir, 'consumed-reminder.1766841830298.json'),
        JSON.stringify({ name: 'consumed-reminder', priority: 60 })
      )
      writeFileSync(join(stagingDir, 'another.999.json'), JSON.stringify({ name: 'another', priority: 70 }))

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      const reminders = reader.listReminders('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('active-reminder')
    })

    it('handles multiple hooks independently', () => {
      const preToolUseDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      const stopDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')

      writeFileSync(
        join(preToolUseDir, 'pretool-reminder.json'),
        JSON.stringify({ name: 'pretool-reminder', priority: 80 })
      )
      writeFileSync(join(stopDir, 'stop-reminder.json'), JSON.stringify({ name: 'stop-reminder', priority: 60 }))

      const reader = new CLIStagingReader({
        paths: mockPaths,
        sessionId,
      })

      const preToolReminders = reader.listReminders('PreToolUse')
      const stopReminders = reader.listReminders('Stop')

      expect(preToolReminders).toHaveLength(1)
      expect(preToolReminders[0].name).toBe('pretool-reminder')

      expect(stopReminders).toHaveLength(1)
      expect(stopReminders[0].name).toBe('stop-reminder')
    })

    it('constructs correct staging path from projectConfigDir', () => {
      const customStateDir = '/tmp/custom-state-test'
      const customPaths: RuntimePaths = {
        projectDir: '/mock/project',
        userConfigDir: '/mock/user',
        projectConfigDir: customStateDir, // CLIStagingReader uses projectConfigDir
      }

      // Path follows CLIStagingReader convention: projectConfigDir/sessions/sessionId/stage/hook
      const expectedPath = join(customStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      mkdirSync(expectedPath, { recursive: true })

      writeFileSync(join(expectedPath, 'test.json'), JSON.stringify({ name: 'test', priority: 50 }))

      const reader = new CLIStagingReader({
        paths: customPaths,
        sessionId,
      })

      const reminders = reader.listReminders('PreToolUse')
      expect(reminders).toHaveLength(1)

      // Cleanup
      rmSync(customStateDir, { recursive: true, force: true })
    })
  })
})
