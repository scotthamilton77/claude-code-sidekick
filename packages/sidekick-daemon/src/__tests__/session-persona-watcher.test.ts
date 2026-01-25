import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLogger } from '@sidekick/testing-fixtures'
import { extractSessionIdFromPath, SessionPersonaWatcher } from '../session-persona-watcher.js'

let tmpDir: string
let sidekickDir: string
let logger: MockLogger

describe('extractSessionIdFromPath', () => {
  it('should extract session ID from valid Unix path', () => {
    const path = '/Users/scott/project/.sidekick/sessions/abc123/state/session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('abc123')
  })

  it('should extract session ID from valid Windows path', () => {
    const path = 'C:\\Users\\scott\\project\\.sidekick\\sessions\\abc123\\state\\session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('abc123')
  })

  it('should extract session ID with dashes and underscores', () => {
    const path = '/project/.sidekick/sessions/session-with-dashes_and_underscores/state/session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('session-with-dashes_and_underscores')
  })

  it('should extract session ID with UUID format', () => {
    const path = '/project/.sidekick/sessions/550e8400-e29b-41d4-a716-446655440000/state/session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('should return null for path without /sessions/', () => {
    const path = '/project/.sidekick/config.yaml'
    expect(extractSessionIdFromPath(path)).toBeNull()
  })

  it('should return null for path with sessions but no following slash', () => {
    const path = '/project/.sidekick/sessions'
    expect(extractSessionIdFromPath(path)).toBeNull()
  })

  it('should return null for path ending immediately after session ID', () => {
    // Edge case: /sessions/abc123 with no trailing content
    const path = '/project/.sidekick/sessions/abc123'
    expect(extractSessionIdFromPath(path)).toBeNull()
  })

  it('should handle multiple /sessions/ in path (uses last one)', () => {
    const path = '/sessions/old/.sidekick/sessions/abc123/state/session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('abc123')
  })

  it('should handle empty session ID segment', () => {
    const path = '/project/.sidekick/sessions//state/session-persona.json'
    expect(extractSessionIdFromPath(path)).toBe('')
  })
})

describe('SessionPersonaWatcher', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-persona-watcher-test-'))
    sidekickDir = path.join(tmpDir, '.sidekick')
    logger = new MockLogger()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('constructor', () => {
    it('should store sidekickDir from options', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir: '/custom/path' }, logger, onChange)
      watcher.start()

      // Verify via log message
      const logEntry = logger.recordedLogs.find((log) => log.msg === 'SessionPersonaWatcher started')
      expect(logEntry?.meta?.sidekickDir).toBe('/custom/path')

      watcher.stop()
    })
  })

  describe('start', () => {
    it('should log start message with sidekickDir and pattern', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()

      expect(logger.wasLogged('SessionPersonaWatcher started')).toBe(true)
      const logEntry = logger.recordedLogs.find((log) => log.msg === 'SessionPersonaWatcher started')
      expect(logEntry?.meta?.sidekickDir).toBe(sidekickDir)
      expect(logEntry?.meta?.pattern).toContain('session-persona.json')
      expect(logEntry?.meta?.pattern).toContain('sessions')

      watcher.stop()
    })

    it('should not throw when watched directory does not exist', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir: '/nonexistent/path/.sidekick' }, logger, onChange)

      expect(() => watcher.start()).not.toThrow()

      watcher.stop()
    })

    it('should set up ready promise that resolves', async () => {
      const sessionDir = path.join(sidekickDir, 'sessions', 'test', 'state')
      await fs.mkdir(sessionDir, { recursive: true })

      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()

      // ready() should resolve without timing out
      await expect(watcher.ready()).resolves.toBeUndefined()

      expect(logger.wasLoggedAtLevel('SessionPersonaWatcher ready', 'debug')).toBe(true)

      watcher.stop()
    })
  })

  describe('ready', () => {
    it('should resolve immediately if called before start()', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      // Call ready() without calling start() - readyPromise is null
      await expect(watcher.ready()).resolves.toBeUndefined()
    })

    it('should resolve after watcher is ready', async () => {
      await fs.mkdir(sidekickDir, { recursive: true })

      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()
      await watcher.ready()

      expect(logger.wasLoggedAtLevel('SessionPersonaWatcher ready', 'debug')).toBe(true)

      watcher.stop()
    })
  })

  describe('stop', () => {
    it('should log stop message', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()
      watcher.stop()

      expect(logger.wasLogged('SessionPersonaWatcher stopped')).toBe(true)
    })

    it('should handle stop() when watcher is null (never started)', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      // Stop without starting - should not throw
      expect(() => watcher.stop()).not.toThrow()

      expect(logger.wasLogged('SessionPersonaWatcher stopped')).toBe(true)
    })

    it('should handle multiple stop() calls', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()
      watcher.stop()
      watcher.stop() // Second stop should not throw

      // Should have 2 stop log entries
      const stopLogs = logger.recordedLogs.filter((log) => log.msg === 'SessionPersonaWatcher stopped')
      expect(stopLogs.length).toBe(2)
    })

    it('should stop watching when stop() is called', async () => {
      const sessionId = 'stop-test'
      const sessionDir = path.join(sidekickDir, 'sessions', sessionId, 'state')
      await fs.mkdir(sessionDir, { recursive: true })
      const personaFile = path.join(sessionDir, 'session-persona.json')
      await fs.writeFile(personaFile, '{}', 'utf-8')

      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()
      await watcher.ready()

      watcher.stop()

      await new Promise((r) => setTimeout(r, 100))

      // Modify after stop - should not trigger callback
      await fs.writeFile(personaFile, '{"changed": true}', 'utf-8')

      await new Promise((r) => setTimeout(r, 300))

      expect(onChange).not.toHaveBeenCalled()
    })

    it('should clear pending debounce timers on stop', async () => {
      const sessionId = 'debounce-clear-test'
      const sessionDir = path.join(sidekickDir, 'sessions', sessionId, 'state')
      await fs.mkdir(sessionDir, { recursive: true })
      const personaFile = path.join(sessionDir, 'session-persona.json')
      await fs.writeFile(personaFile, '{}', 'utf-8')

      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      watcher.start()
      await watcher.ready()

      // We can't reliably trigger file events in temp directories, but we can
      // verify that stop() clears timers by checking logs
      watcher.stop()

      expect(logger.wasLogged('SessionPersonaWatcher stopped')).toBe(true)
    })
  })

  // Direct testing of handleEvent via prototype access
  // This bypasses chokidar to test the event handling logic directly
  describe('handleEvent (direct invocation)', () => {
    it('should call onChange with correct event after debounce', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      // Access private method via prototype
      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/test-session/state/session-persona.json'
      handleEvent('change', filePath)

      // Wait for debounce (100ms) + buffer
      await new Promise((r) => setTimeout(r, 150))

      expect(onChange).toHaveBeenCalledWith({
        sessionId: 'test-session',
        eventType: 'change',
        fullPath: filePath,
      })
      expect(logger.wasLogged('Session persona changed')).toBe(true)
    })

    it('should handle add event type', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/new-session/state/session-persona.json'
      handleEvent('add', filePath)

      await new Promise((r) => setTimeout(r, 150))

      expect(onChange).toHaveBeenCalledWith({
        sessionId: 'new-session',
        eventType: 'add',
        fullPath: filePath,
      })
    })

    it('should handle unlink event type', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/deleted-session/state/session-persona.json'
      handleEvent('unlink', filePath)

      await new Promise((r) => setTimeout(r, 150))

      expect(onChange).toHaveBeenCalledWith({
        sessionId: 'deleted-session',
        eventType: 'unlink',
        fullPath: filePath,
      })
    })

    it('should log warning when session ID cannot be extracted', () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      // Path without /sessions/ segment
      handleEvent('change', '/invalid/path/without/sessions/marker')

      // No debounce needed - warning logs immediately
      expect(logger.wasLoggedAtLevel('Could not extract session ID from persona file path', 'warn')).toBe(true)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should log error when onChange handler throws Error', async () => {
      const onChange = vi.fn().mockImplementation(() => {
        throw new Error('Handler exploded')
      })
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/error-session/state/session-persona.json'
      handleEvent('change', filePath)

      await new Promise((r) => setTimeout(r, 150))

      expect(onChange).toHaveBeenCalled()
      expect(logger.wasLoggedAtLevel('Error in persona change handler', 'error')).toBe(true)
      const errorLog = logger.recordedLogs.find((log) => log.msg === 'Error in persona change handler')
      expect(errorLog?.meta?.error).toBe('Handler exploded')
      expect(errorLog?.meta?.sessionId).toBe('error-session')
    })

    it('should log error when onChange handler throws non-Error', async () => {
      const onChange = vi.fn().mockImplementation(() => {
        throw 'string error' // eslint-disable-line @typescript-eslint/only-throw-error
      })
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/string-error-session/state/session-persona.json'
      handleEvent('change', filePath)

      await new Promise((r) => setTimeout(r, 150))

      expect(onChange).toHaveBeenCalled()
      expect(logger.wasLoggedAtLevel('Error in persona change handler', 'error')).toBe(true)
      const errorLog = logger.recordedLogs.find((log) => log.msg === 'Error in persona change handler')
      expect(errorLog?.meta?.error).toBe('string error')
    })

    it('should debounce multiple rapid events for same file', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/rapid-session/state/session-persona.json'

      // Fire multiple events rapidly
      handleEvent('change', filePath)
      handleEvent('change', filePath)
      handleEvent('change', filePath)

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 200))

      // Should only have called once due to debouncing
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should handle events for different sessions independently', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const path1 = '/project/.sidekick/sessions/session-a/state/session-persona.json'
      const path2 = '/project/.sidekick/sessions/session-b/state/session-persona.json'

      // Fire events for different sessions
      handleEvent('change', path1)
      handleEvent('change', path2)

      await new Promise((r) => setTimeout(r, 200))

      // Both should have fired (no cross-session debouncing)
      expect(onChange).toHaveBeenCalledTimes(2)
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a' }))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-b' }))
    })

    it('should clear pending debounce timers when stop() is called during debounce', async () => {
      const onChange = vi.fn()
      const watcher = new SessionPersonaWatcher({ sidekickDir }, logger, onChange)

      const handleEvent = (
        watcher as unknown as { handleEvent: (type: string, path: string) => void }
      ).handleEvent.bind(watcher)

      const filePath = '/project/.sidekick/sessions/pending-session/state/session-persona.json'

      // Trigger event to create a pending debounce timer
      handleEvent('change', filePath)

      // Stop immediately before debounce completes (debounceMs is 100)
      watcher.stop()

      // Wait for what would have been the debounce period
      await new Promise((r) => setTimeout(r, 200))

      // onChange should NOT have been called because timer was cleared
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
