/**
 * Tests for sessions command handler.
 *
 * Verifies BEHAVIOR of handleSessionsCommand:
 * - Returns empty list when no sessions exist
 * - Lists sessions with metadata (title, intent, persona)
 * - Handles missing metadata files gracefully
 * - Sorts sessions by modification time (most recent first)
 * - Outputs JSON and table formats correctly
 *
 * Uses real temp directories (fakes) - no mocks needed.
 *
 * @see sessions.ts handleSessionsCommand
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Create fake logger (we don't test logging behavior, just need the interface)
function createFakeLogger(): {
  trace: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  fatal: ReturnType<typeof vi.fn>
  child: ReturnType<typeof vi.fn>
  flush: ReturnType<typeof vi.fn>
} {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
    flush: vi.fn(),
  }
}

import { handleSessionsCommand, type SessionInfo } from '../sessions'

describe('handleSessionsCommand', () => {
  let tempDir: string
  let stdout: CollectingWritable
  let logger: ReturnType<typeof createFakeLogger>

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = await fs.mkdtemp(path.join('/tmp', 'sessions-test-'))
    stdout = new CollectingWritable()
    logger = createFakeLogger()
  })

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Helper to create a session with metadata
  async function createSession(
    sessionId: string,
    options: {
      title?: string
      intent?: string
      personaId?: string | null
      timestamp?: string
    } = {}
  ): Promise<void> {
    const sessionsDir = path.join(tempDir, '.sidekick', 'sessions')
    const sessionStateDir = path.join(sessionsDir, sessionId, 'state')
    await fs.mkdir(sessionStateDir, { recursive: true })

    if (options.title !== undefined) {
      const summary = {
        session_id: sessionId,
        timestamp: options.timestamp ?? new Date().toISOString(),
        session_title: options.title,
        session_title_confidence: 0.9,
        latest_intent: options.intent ?? 'Test intent',
        latest_intent_confidence: 0.8,
      }
      await fs.writeFile(path.join(sessionStateDir, 'session-summary.json'), JSON.stringify(summary))
    }

    if (options.personaId !== undefined) {
      const persona = {
        persona_id: options.personaId,
        selected_from: ['default'],
        timestamp: new Date().toISOString(),
      }
      await fs.writeFile(path.join(sessionStateDir, 'session-persona.json'), JSON.stringify(persona))
    }
  }

  describe('empty state', () => {
    test('returns empty list when sessions directory does not exist', async () => {
      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.sessions).toEqual([])
      expect(output.count).toBe(0)
    })

    test('returns empty list when sessions directory is empty', async () => {
      await fs.mkdir(path.join(tempDir, '.sidekick', 'sessions'), { recursive: true })

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.sessions).toEqual([])
      expect(output.count).toBe(0)
    })
  })

  describe('session listing', () => {
    test('lists session with full metadata', async () => {
      await createSession('session-123', {
        title: 'Test Session',
        intent: 'Testing things',
        personaId: 'skippy',
        timestamp: '2026-01-18T12:00:00.000Z',
      })

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.count).toBe(1)

      const session = output.sessions[0] as SessionInfo
      expect(session.sessionId).toBe('session-123')
      expect(session.title).toBe('Test Session')
      expect(session.intent).toBe('Testing things')
      expect(session.personaId).toBe('skippy')
      expect(session.lastUpdated).toBe('2026-01-18T12:00:00.000Z')
    })

    test('handles session without summary file', async () => {
      // Create session directory without any metadata files
      const sessionDir = path.join(tempDir, '.sidekick', 'sessions', 'session-no-summary', 'state')
      await fs.mkdir(sessionDir, { recursive: true })

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.count).toBe(1)

      const session = output.sessions[0] as SessionInfo
      expect(session.sessionId).toBe('session-no-summary')
      expect(session.title).toBeNull()
      expect(session.intent).toBeNull()
      expect(session.personaId).toBeNull()
    })

    test('handles session without persona file', async () => {
      await createSession('session-no-persona', {
        title: 'Session Without Persona',
        intent: 'No persona set',
        // No personaId
      })

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      const session = output.sessions[0] as SessionInfo
      expect(session.title).toBe('Session Without Persona')
      expect(session.personaId).toBeNull()
    })

    test('lists multiple sessions', async () => {
      await createSession('session-1', { title: 'First Session' })
      await createSession('session-2', { title: 'Second Session' })
      await createSession('session-3', { title: 'Third Session' })

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.count).toBe(3)
    })
  })

  describe('sorting', () => {
    test('sorts sessions by modification time (most recent first)', async () => {
      // Create sessions with different timestamps
      // Note: We control modifiedAt via file system mtime
      await createSession('old-session', { title: 'Old' })
      await createSession('new-session', { title: 'New' })

      // Set different mtimes
      const oldPath = path.join(tempDir, '.sidekick', 'sessions', 'old-session')
      const newPath = path.join(tempDir, '.sidekick', 'sessions', 'new-session')

      const oldTime = new Date('2026-01-01T00:00:00Z')
      const newTime = new Date('2026-01-18T00:00:00Z')

      await fs.utimes(oldPath, oldTime, oldTime)
      await fs.utimes(newPath, newTime, newTime)

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.sessions[0].sessionId).toBe('new-session')
      expect(output.sessions[1].sessionId).toBe('old-session')
    })
  })

  describe('output formats', () => {
    test('outputs JSON by default', async () => {
      await createSession('test-session', { title: 'Test' })

      await handleSessionsCommand(tempDir, logger, stdout)

      // Should be valid JSON
      expect(() => JSON.parse(stdout.data)).not.toThrow()
      const output = JSON.parse(stdout.data)
      expect(output).toHaveProperty('sessions')
      expect(output).toHaveProperty('count')
    })

    test('outputs JSON when format is json', async () => {
      await createSession('test-session', { title: 'Test' })

      await handleSessionsCommand(tempDir, logger, stdout, { format: 'json' })

      expect(() => JSON.parse(stdout.data)).not.toThrow()
    })

    test('outputs table format when requested', async () => {
      await createSession('test-session', {
        title: 'Test Session Title',
        intent: 'Test intent',
        personaId: 'skippy',
      })

      await handleSessionsCommand(tempDir, logger, stdout, { format: 'table' })

      // Table format should NOT be valid JSON
      expect(() => JSON.parse(stdout.data)).toThrow()

      // Should contain human-readable content
      expect(stdout.data).toContain('Sessions (1)')
      expect(stdout.data).toContain('test-session')
      expect(stdout.data).toContain('Test Session Title')
      expect(stdout.data).toContain('[skippy]')
      expect(stdout.data).toContain('Test intent')
    })

    test('table format shows no sessions message when empty', async () => {
      await fs.mkdir(path.join(tempDir, '.sidekick', 'sessions'), { recursive: true })

      await handleSessionsCommand(tempDir, logger, stdout, { format: 'table' })

      expect(stdout.data).toContain('No sessions found')
    })

    test('table format omits persona bracket when no persona', async () => {
      await createSession('test-session', {
        title: 'No Persona Session',
        // No personaId
      })

      await handleSessionsCommand(tempDir, logger, stdout, { format: 'table' })

      expect(stdout.data).toContain('No Persona Session')
      expect(stdout.data).not.toContain('[]') // Empty brackets should not appear
    })
  })

  describe('error handling', () => {
    test('returns exit code 1 on file system error', async () => {
      // Create sessions dir, then make it unreadable
      const sessionsDir = path.join(tempDir, '.sidekick', 'sessions')
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.chmod(sessionsDir, 0o000)

      const result = await handleSessionsCommand(tempDir, logger, stdout)

      // Restore permissions for cleanup
      await fs.chmod(sessionsDir, 0o755)

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output).toHaveProperty('error')
    })
  })
})
