/**
 * Path resolution tests for API utilities.
 *
 * Tests that the API correctly resolves paths in both project (.sidekick/)
 * and user (~/.sidekick/) locations, with proper precedence.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLogsPath, findSessionsPath, findStatePath } from '../utils'

describe('Dual-scope resolution', () => {
  let testRoot: string
  let projectDir: string
  let userDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    // Save original HOME
    originalHome = process.env.HOME

    // Create temporary test directories
    testRoot = join(tmpdir(), `sidekick-test-${Date.now()}`)
    projectDir = join(testRoot, 'project')
    userDir = join(testRoot, 'home', '.sidekick')

    mkdirSync(projectDir, { recursive: true })
    mkdirSync(userDir, { recursive: true })

    // Mock HOME environment variable
    process.env.HOME = join(testRoot, 'home')
  })

  afterEach(() => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }

    // Clean up test directories
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  describe('findLogsPath', () => {
    it('prefers project-local logs when preferProject=true', () => {
      const projectLogs = join(projectDir, '.sidekick', 'logs')
      const userLogs = join(userDir, 'logs')
      const homeDir = join(testRoot, 'home')

      mkdirSync(projectLogs, { recursive: true })
      mkdirSync(userLogs, { recursive: true })

      const result = findLogsPath(undefined, true, projectDir, homeDir)

      expect(result).toBe(projectLogs)
    })

    it('falls back to user logs when project logs missing', () => {
      const userLogs = join(userDir, 'logs')
      const homeDir = join(testRoot, 'home')
      mkdirSync(userLogs, { recursive: true })

      const result = findLogsPath(undefined, true, projectDir, homeDir)

      expect(result).toBe(userLogs)
    })

    it('returns null when no logs directory exists', () => {
      const homeDir = join(testRoot, 'home')
      const result = findLogsPath(undefined, true, projectDir, homeDir)

      expect(result).toBeNull()
    })

    it('uses user logs when preferProject=false', () => {
      const projectLogs = join(projectDir, '.sidekick', 'logs')
      const userLogs = join(userDir, 'logs')
      const homeDir = join(testRoot, 'home')

      mkdirSync(projectLogs, { recursive: true })
      mkdirSync(userLogs, { recursive: true })

      const result = findLogsPath(undefined, false, projectDir, homeDir)

      expect(result).toBe(userLogs)
    })

    it('respects explicit logsPath parameter', () => {
      const customLogs = join(testRoot, 'custom-logs')
      const homeDir = join(testRoot, 'home')
      mkdirSync(customLogs, { recursive: true })

      const result = findLogsPath('../custom-logs', true, projectDir, homeDir)

      expect(result).toBe(customLogs)
    })

    it('handles missing explicit logsPath', () => {
      const homeDir = join(testRoot, 'home')
      const result = findLogsPath('../nonexistent', true, projectDir, homeDir)

      expect(result).toBeNull()
    })
  })

  describe('findSessionsPath', () => {
    it('prefers project-local sessions when preferProject=true', () => {
      const projectSessions = join(projectDir, '.sidekick', 'sessions')
      const userSessions = join(userDir, 'sessions')
      const homeDir = join(testRoot, 'home')

      mkdirSync(projectSessions, { recursive: true })
      mkdirSync(userSessions, { recursive: true })

      const result = findSessionsPath(true, projectDir, homeDir)

      expect(result).toBe(projectSessions)
    })

    it('falls back to user sessions when project sessions missing', () => {
      const userSessions = join(userDir, 'sessions')
      const homeDir = join(testRoot, 'home')
      mkdirSync(userSessions, { recursive: true })

      const result = findSessionsPath(true, projectDir, homeDir)

      expect(result).toBe(userSessions)
    })

    it('returns null when no sessions directory exists', () => {
      const homeDir = join(testRoot, 'home')
      const result = findSessionsPath(true, projectDir, homeDir)

      expect(result).toBeNull()
    })
  })

  describe('findStatePath', () => {
    it('prefers project-local state when preferProject=true', () => {
      const projectState = join(projectDir, '.sidekick', 'state')
      const userState = join(userDir, 'state')
      const homeDir = join(testRoot, 'home')

      mkdirSync(projectState, { recursive: true })
      mkdirSync(userState, { recursive: true })

      const result = findStatePath(true, projectDir, homeDir)

      expect(result).toBe(projectState)
    })

    it('falls back to user state when project state missing', () => {
      const userState = join(userDir, 'state')
      const homeDir = join(testRoot, 'home')
      mkdirSync(userState, { recursive: true })

      const result = findStatePath(true, projectDir, homeDir)

      expect(result).toBe(userState)
    })

    it('returns null when no state directory exists', () => {
      const homeDir = join(testRoot, 'home')
      const result = findStatePath(true, projectDir, homeDir)

      expect(result).toBeNull()
    })
  })

  describe('Session-specific paths', () => {
    const sessionId = 'test-session-123'

    it('finds session state in project scope', () => {
      const projectSessions = join(projectDir, '.sidekick', 'sessions')
      const sessionStateDir = join(projectSessions, sessionId, 'state')

      mkdirSync(sessionStateDir, { recursive: true })
      writeFileSync(join(sessionStateDir, 'session-summary.json'), '{"title": "Test Session"}')

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(projectSessions)

      // Verify we can read the session state
      const statePath = join(sessionsPath!, sessionId, 'state', 'session-summary.json')
      expect(existsSync(statePath)).toBe(true)

      const content = JSON.parse(readFileSync(statePath, 'utf-8'))
      expect(content).toEqual({ title: 'Test Session' })
    })

    it('finds session state in user scope when project missing', () => {
      const userSessions = join(userDir, 'sessions')
      const sessionStateDir = join(userSessions, sessionId, 'state')

      mkdirSync(sessionStateDir, { recursive: true })
      writeFileSync(join(sessionStateDir, 'transcript-metrics.json'), '{"status": "active"}')

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(userSessions)

      // Verify we can read the session state
      const statePath = join(sessionsPath!, sessionId, 'state', 'transcript-metrics.json')
      expect(existsSync(statePath)).toBe(true)

      const content = JSON.parse(readFileSync(statePath, 'utf-8'))
      expect(content).toEqual({ status: 'active' })
    })

    it('finds staged reminders in project scope', () => {
      const projectSessions = join(projectDir, '.sidekick', 'sessions')
      const stageDir = join(projectSessions, sessionId, 'stage', 'UserPromptSubmit')

      mkdirSync(stageDir, { recursive: true })
      writeFileSync(
        join(stageDir, 'default-reminder.json'),
        JSON.stringify({
          name: 'default',
          blocking: false,
          priority: 10,
          persistent: true,
        })
      )

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(projectSessions)

      // Verify we can read staged reminders
      const reminderPath = join(sessionsPath!, sessionId, 'stage', 'UserPromptSubmit', 'default-reminder.json')
      expect(existsSync(reminderPath)).toBe(true)

      const reminder = JSON.parse(readFileSync(reminderPath, 'utf-8'))
      expect(reminder).toMatchObject({
        name: 'default',
        blocking: false,
        priority: 10,
        persistent: true,
      })
    })

    it('finds staged reminders in user scope when project missing', () => {
      const userSessions = join(userDir, 'sessions')
      const stageDir = join(userSessions, sessionId, 'stage', 'PreToolUse')

      mkdirSync(stageDir, { recursive: true })
      writeFileSync(
        join(stageDir, 'pause-and-reflect.json'),
        JSON.stringify({
          name: 'pause-and-reflect',
          blocking: true,
          priority: 100,
          persistent: false,
        })
      )

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(userSessions)

      // Verify we can read staged reminders
      const reminderPath = join(sessionsPath!, sessionId, 'stage', 'PreToolUse', 'pause-and-reflect.json')
      expect(existsSync(reminderPath)).toBe(true)

      const reminder = JSON.parse(readFileSync(reminderPath, 'utf-8'))
      expect(reminder).toMatchObject({
        name: 'pause-and-reflect',
        blocking: true,
        priority: 100,
        persistent: false,
      })
    })

    it('detects suppression markers in stage directories', () => {
      const projectSessions = join(projectDir, '.sidekick', 'sessions')
      const stageDir = join(projectSessions, sessionId, 'stage', 'Stop')

      mkdirSync(stageDir, { recursive: true })
      writeFileSync(join(stageDir, '.suppressed'), '')

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(projectSessions)

      // Verify suppression marker exists
      const suppressionMarker = join(sessionsPath!, sessionId, 'stage', 'Stop', '.suppressed')
      expect(existsSync(suppressionMarker)).toBe(true)
    })
  })

  describe('Precedence with both scopes present', () => {
    const sessionId = 'dual-scope-session'

    it('project-scope sessions take precedence over user-scope', () => {
      // Create both project and user session data
      const projectSessions = join(projectDir, '.sidekick', 'sessions')
      const userSessions = join(userDir, 'sessions')

      mkdirSync(join(projectSessions, sessionId, 'state'), { recursive: true })
      mkdirSync(join(userSessions, sessionId, 'state'), { recursive: true })

      writeFileSync(join(projectSessions, sessionId, 'state', 'session-summary.json'), '{"scope": "project"}')
      writeFileSync(join(userSessions, sessionId, 'state', 'session-summary.json'), '{"scope": "user"}')

      // Should resolve to project scope
      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(projectSessions)

      // Verify we read from project scope, not user scope
      const summaryPath = join(sessionsPath!, sessionId, 'state', 'session-summary.json')
      const content = JSON.parse(readFileSync(summaryPath, 'utf-8'))
      expect(content).toEqual({ scope: 'project' })
    })

    it('project-scope logs take precedence over user-scope', () => {
      const projectLogs = join(projectDir, '.sidekick', 'logs')
      const userLogs = join(userDir, 'logs')

      mkdirSync(projectLogs, { recursive: true })
      mkdirSync(userLogs, { recursive: true })

      writeFileSync(join(projectLogs, 'cli.log'), 'project-log\n')
      writeFileSync(join(userLogs, 'cli.log'), 'user-log\n')

      // Should resolve to project scope
      const logsPath = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))
      expect(logsPath).toBe(projectLogs)

      // Verify we read from project scope
      const logContent = readFileSync(join(logsPath!, 'cli.log'), 'utf-8')
      expect(logContent).toBe('project-log\n')
    })

    it('project-scope state takes precedence over user-scope', () => {
      const projectState = join(projectDir, '.sidekick', 'state')
      const userState = join(userDir, 'state')

      mkdirSync(projectState, { recursive: true })
      mkdirSync(userState, { recursive: true })

      writeFileSync(join(projectState, 'daemon-status.json'), '{"scope": "project"}')
      writeFileSync(join(userState, 'daemon-status.json'), '{"scope": "user"}')

      // Should resolve to project scope
      const statePath = findStatePath(true, projectDir, join(testRoot, 'home'))
      expect(statePath).toBe(projectState)

      // Verify we read from project scope
      const content = JSON.parse(readFileSync(join(statePath!, 'daemon-status.json'), 'utf-8'))
      expect(content).toEqual({ scope: 'project' })
    })
  })

  describe('Scope isolation', () => {
    it('project-scope data does not leak to user scope', () => {
      const projectLogs = join(projectDir, '.sidekick', 'logs')

      // Only create project logs
      mkdirSync(projectLogs, { recursive: true })
      writeFileSync(join(projectLogs, 'cli.log'), 'project data\n')

      // Should NOT find user logs
      const userResult = findLogsPath(undefined, false, projectDir, join(testRoot, 'home'))
      expect(userResult).toBeNull()

      // Should find project logs
      const projectResult = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))
      expect(projectResult).toBe(projectLogs)
    })

    it('user-scope data is accessible when project-scope missing', () => {
      const userLogs = join(userDir, 'logs')

      mkdirSync(userLogs, { recursive: true })
      writeFileSync(join(userLogs, 'cli.log'), 'user data\n')

      const result = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))

      expect(result).toBe(userLogs)
    })

    it('user-scope sessions are isolated from project sessions', () => {
      const userSessions = join(userDir, 'sessions')
      const sessionId = 'user-only-session'

      mkdirSync(join(userSessions, sessionId, 'state'), { recursive: true })
      writeFileSync(join(userSessions, sessionId, 'state', 'session-summary.json'), '{"scope": "user"}')

      // When looking for project scope, should fall back to user
      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBe(userSessions)

      // Verify session exists in user scope
      const summaryPath = join(sessionsPath!, sessionId, 'state', 'session-summary.json')
      expect(existsSync(summaryPath)).toBe(true)
    })
  })

  describe('Edge cases', () => {
    it('handles empty directories gracefully', () => {
      const projectLogs = join(projectDir, '.sidekick', 'logs')
      mkdirSync(projectLogs, { recursive: true })
      // Directory exists but is empty

      const logsPath = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))
      expect(logsPath).toBe(projectLogs)
    })

    it('handles missing parent directories', () => {
      // Neither project nor user directories exist
      const logsPath = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))
      expect(logsPath).toBeNull()

      const sessionsPath = findSessionsPath(true, projectDir, join(testRoot, 'home'))
      expect(sessionsPath).toBeNull()

      const statePath = findStatePath(true, projectDir, join(testRoot, 'home'))
      expect(statePath).toBeNull()
    })

    it('handles deeply nested project directories', () => {
      const deepProjectDir = join(testRoot, 'workspace', 'monorepo', 'packages', 'app')
      const projectLogs = join(deepProjectDir, '.sidekick', 'logs')

      mkdirSync(projectLogs, { recursive: true })
      writeFileSync(join(projectLogs, 'cli.log'), 'deep project\n')

      const logsPath = findLogsPath(undefined, true, deepProjectDir)
      expect(logsPath).toBe(projectLogs)
    })

    it('handles symbolic links in paths', () => {
      // Note: This is a basic test - actual symlink behavior depends on OS
      const projectLogs = join(projectDir, '.sidekick', 'logs')
      mkdirSync(projectLogs, { recursive: true })

      const logsPath = findLogsPath(undefined, true, projectDir, join(testRoot, 'home'))
      expect(logsPath).toBe(projectLogs)
    })
  })
})
