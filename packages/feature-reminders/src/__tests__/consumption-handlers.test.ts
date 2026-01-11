/**
 * Tests for consumption handlers and CLI staging reader
 * @see docs/design/FEATURE-REMINDERS.md §3.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLIStagingReader } from '../cli-staging-reader'
import type { RuntimePaths } from '@sidekick/types'

describe('consumption-handlers', () => {
  describe('CLIStagingReader', () => {
    const testStateDir = '/tmp/claude/test-state-reminders'
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

    describe('constructor', () => {
      it('throws when projectConfigDir is undefined', () => {
        const pathsWithoutProjectConfig: RuntimePaths = {
          projectDir: '/mock/project',
          userConfigDir: '/mock/user',
          projectConfigDir: undefined,
        }

        expect(() => {
          new CLIStagingReader({
            paths: pathsWithoutProjectConfig,
            sessionId,
          })
        }).toThrow('CLIStagingReader requires project scope (projectConfigDir must be defined)')
      })
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
      const customStateDir = '/tmp/claude/custom-state-test'
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

    describe('renameReminder (consumption tracking)', () => {
      it('renames reminder with timestamp suffix for consumption history', () => {
        const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
        const originalPath = join(stagingDir, 'verify-completion.json')

        writeFileSync(
          originalPath,
          JSON.stringify({
            name: 'verify-completion',
            blocking: true,
            priority: 50,
            persistent: false,
          })
        )

        const reader = new CLIStagingReader({
          paths: mockPaths,
          sessionId,
        })

        expect(existsSync(originalPath)).toBe(true)
        reader.renameReminder('Stop', 'verify-completion')

        // Original file should be gone
        expect(existsSync(originalPath)).toBe(false)

        // Should have a timestamped file instead (verify-completion.{timestamp}.json)
        const files = readdirSync(stagingDir).filter(
          (f: string) => f.startsWith('verify-completion.') && f.endsWith('.json')
        )
        expect(files.length).toBe(1)
        expect(files[0]).toMatch(/^verify-completion\.\d+\.json$/)
      })
    })

    describe('path traversal protection (isValidPathSegment)', () => {
      /**
       * Security tests: isValidPathSegment rejects malicious path segments
       * to prevent directory traversal attacks.
       */
      it('rejects path traversal with double-dots in hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(reader.listReminders('..')).toEqual([])
        expect(reader.listReminders('../etc')).toEqual([])
        expect(reader.listReminders('hook/../etc')).toEqual([])
        expect(reader.listReminders('..%2f..%2fetc')).toEqual([]) // URL-encoded
      })

      it('rejects absolute paths in hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(reader.listReminders('/etc/passwd')).toEqual([])
        expect(reader.listReminders('/tmp/evil')).toEqual([])
      })

      it('rejects special characters in hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(reader.listReminders('hook/subdir')).toEqual([])
        expect(reader.listReminders('hook:name')).toEqual([])
        expect(reader.listReminders('hook name')).toEqual([])
        expect(reader.listReminders('hook\x00name')).toEqual([])
      })

      it('rejects empty hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(reader.listReminders('')).toEqual([])
      })

      it('allows valid hookNames (alphanumeric, hyphens, underscores)', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        // PreToolUse exists in beforeEach setup
        expect(reader.listReminders('PreToolUse')).toEqual([])
        expect(reader.listReminders('Stop')).toEqual([])
        expect(reader.listReminders('my-hook')).toEqual([]) // Doesn't exist but valid format
        expect(reader.listReminders('my_hook_123')).toEqual([])
      })

      it('deleteReminder silently ignores invalid hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        // Should not throw, just silently return
        expect(() => reader.deleteReminder('..', 'test')).not.toThrow()
        expect(() => reader.deleteReminder('/etc', 'passwd')).not.toThrow()
      })

      it('deleteReminder silently ignores invalid reminderName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(() => reader.deleteReminder('PreToolUse', '..')).not.toThrow()
        expect(() => reader.deleteReminder('PreToolUse', '../../../etc/passwd')).not.toThrow()
        expect(() => reader.deleteReminder('PreToolUse', 'name/with/slash')).not.toThrow()
      })

      it('renameReminder silently ignores invalid hookName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(() => reader.renameReminder('..', 'test')).not.toThrow()
        expect(() => reader.renameReminder('/etc', 'passwd')).not.toThrow()
      })

      it('renameReminder silently ignores invalid reminderName', () => {
        const reader = new CLIStagingReader({ paths: mockPaths, sessionId })
        expect(() => reader.renameReminder('Stop', '..')).not.toThrow()
        expect(() => reader.renameReminder('Stop', '../../../etc/passwd')).not.toThrow()
      })
    })

    describe('inject-stop P&R cascade prevention', () => {
      /**
       * When consuming verify-completion, inject-stop should delete any staged
       * pause-and-reflect reminder to prevent cascade confusion.
       *
       * NOTE: Full integration test with IPC requires INTEGRATION_TESTS=1.
       * This test verifies the file deletion behavior only.
       */
      it('CLIStagingReader.deleteReminder removes P&R when consuming VC', () => {
        // Set up: VC staged for Stop, P&R staged for PreToolUse
        const stopDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
        const preToolDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

        writeFileSync(
          join(stopDir, 'verify-completion.json'),
          JSON.stringify({
            name: 'verify-completion',
            blocking: true,
            priority: 50,
            persistent: false,
          })
        )
        writeFileSync(
          join(preToolDir, 'pause-and-reflect.json'),
          JSON.stringify({
            name: 'pause-and-reflect',
            blocking: true,
            priority: 80,
            persistent: false,
          })
        )

        const reader = new CLIStagingReader({
          paths: mockPaths,
          sessionId,
        })

        // Verify both exist
        expect(reader.listReminders('Stop')).toHaveLength(1)
        expect(reader.listReminders('PreToolUse')).toHaveLength(1)

        // Simulate VC consumption: rename VC and delete P&R
        reader.renameReminder('Stop', 'verify-completion')
        reader.deleteReminder('PreToolUse', 'pause-and-reflect')

        // VC should be consumed (renamed), P&R should be deleted
        expect(reader.listReminders('Stop')).toHaveLength(0)
        expect(reader.listReminders('PreToolUse')).toHaveLength(0)
      })
    })
  })
})
