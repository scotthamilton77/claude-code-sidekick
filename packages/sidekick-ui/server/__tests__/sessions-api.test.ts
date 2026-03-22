import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { listProjects, getProjectById, listSessions } from '../sessions-api.js'

/** Inline fake logger — avoids CJS/ESM incompatibility with @sidekick/testing-fixtures */
function createFakeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger & { [K in keyof Logger]: ReturnType<typeof vi.fn> }
}

// Mock node:fs/promises
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockAccess = vi.fn()

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}))

// Mock git-branch-cache (caching is tested separately in git-branch-cache.test.ts)
const mockGetGitBranch = vi.fn()
vi.mock('../git-branch-cache.js', () => ({
  getGitBranch: (...args: unknown[]) => mockGetGitBranch(...args),
}))

beforeEach(() => {
  mockReaddir.mockClear()
  mockReadFile.mockClear()
  mockStat.mockClear()
  mockAccess.mockClear()
  mockGetGitBranch.mockClear()
})

describe('listProjects', () => {
  it('returns empty array when registry directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })

  it('returns projects from registry entries', async () => {
    mockReaddir.mockResolvedValue([{ name: '-Users-scott-src-myproject', isDirectory: () => true }])

    const registryEntry = {
      path: '/Users/scott/src/myproject',
      displayName: 'myproject',
      lastActive: new Date(Date.now() - 2000).toISOString(), // 2s ago = active
    }
    mockReadFile.mockResolvedValue(JSON.stringify(registryEntry))
    mockAccess.mockResolvedValue(undefined)
    mockGetGitBranch.mockResolvedValue('main')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: '-Users-scott-src-myproject',
      name: 'myproject',
      projectDir: '/Users/scott/src/myproject',
      branch: 'main',
      active: true,
    })
  })

  it('returns active=false when heartbeat is stale', async () => {
    mockReaddir.mockResolvedValue([{ name: 'proj1', isDirectory: () => true }])

    const registryEntry = {
      path: '/Users/scott/src/proj1',
      displayName: 'proj1',
      lastActive: new Date(Date.now() - 60_000).toISOString(), // 60s ago = inactive
    }
    mockReadFile.mockResolvedValue(JSON.stringify(registryEntry))
    mockAccess.mockResolvedValue(undefined)
    mockGetGitBranch.mockResolvedValue('feat/branch')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result[0].active).toBe(false)
    expect(result[0].branch).toBe('feat/branch')
  })

  it('returns branch=unknown when git fails', async () => {
    mockReaddir.mockResolvedValue([{ name: 'proj1', isDirectory: () => true }])

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        path: '/Users/scott/src/proj1',
        displayName: 'proj1',
        lastActive: new Date().toISOString(),
      })
    )
    mockAccess.mockResolvedValue(undefined)
    mockGetGitBranch.mockResolvedValue('unknown')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result[0].branch).toBe('unknown')
  })

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValue([{ name: 'some-file.txt', isDirectory: () => false }])

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })

  it('skips entries with invalid registry.json', async () => {
    mockReaddir.mockResolvedValue([{ name: 'proj1', isDirectory: () => true }])
    mockReadFile.mockResolvedValue('not valid json')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })
})

describe('listSessions', () => {
  it('returns empty array when sessions directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await listSessions('/fake/project')
    expect(result).toEqual([])
  })

  it('returns sessions from session directories', async () => {
    mockReaddir.mockResolvedValue([{ name: 'abc-123', isDirectory: () => true }])

    const sessionDate = new Date('2026-03-10T14:30:00Z')
    mockStat.mockResolvedValue({ mtime: sessionDate })

    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('session-summary.json')) {
        return Promise.resolve(
          JSON.stringify({
            session_title: 'Fix daemon restart',
            latest_intent: 'Bug fix',
            latest_intent_confidence: 0.85,
          })
        )
      }
      if (filePath.includes('session-persona.json')) {
        return Promise.resolve(JSON.stringify({ persona_id: 'jarvis' }))
      }
      return Promise.reject(new Error('ENOENT'))
    })

    const result = await listSessions('/fake/project')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'abc-123',
      title: 'abc-123 — Fix daemon restart',
      date: sessionDate.toISOString(),
      status: 'completed',
      persona: 'jarvis',
      intent: 'Bug fix',
      intentConfidence: 0.85,
    })
  })

  it('uses truncated session ID when session-summary.json is missing', async () => {
    mockReaddir.mockResolvedValue([{ name: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', isDirectory: () => true }])
    mockStat.mockResolvedValue({ mtime: new Date('2026-03-10T14:30:00Z') })
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await listSessions('/fake/project')
    expect(result[0].title).toBe('a1b2c3d4 — No Title')
  })

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValue([{ name: 'some-file.log', isDirectory: () => false }])

    const result = await listSessions('/fake/project')
    expect(result).toEqual([])
  })

  it('marks session as active when isProjectActive=true and state is recently modified', async () => {
    mockReaddir.mockResolvedValue([{ name: 'session-1', isDirectory: () => true }])
    mockStat.mockResolvedValue({ mtime: new Date(Date.now() - 1000) })
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await listSessions('/fake/project', true)
    expect(result[0].status).toBe('active')
  })

  it('reads summary and persona files concurrently via Promise.allSettled', async () => {
    mockReaddir.mockResolvedValue([{ name: 'abc-123', isDirectory: () => true }])
    mockStat.mockResolvedValue({ mtime: new Date('2026-03-10T14:30:00Z') })

    // Deferred promises prove concurrency: persona read starts while summary is still pending
    let resolveSummary!: (value: string) => void
    let resolvePersona!: (value: string) => void
    const summaryPromise = new Promise<string>((r) => { resolveSummary = r })
    const personaPromise = new Promise<string>((r) => { resolvePersona = r })

    const callOrder: string[] = []
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('session-summary.json')) {
        callOrder.push('summary-called')
        return summaryPromise
      }
      if (filePath.includes('session-persona.json')) {
        callOrder.push('persona-called')
        return personaPromise
      }
      return Promise.reject(new Error('ENOENT'))
    })

    // Start listSessions — it will await the deferred promises
    const resultPromise = listSessions('/fake/project')

    // Yield to let Promise.allSettled initiate both reads
    await new Promise((r) => setTimeout(r, 0))

    // Both reads were initiated before either resolved (proves concurrency)
    expect(callOrder).toEqual(['summary-called', 'persona-called'])

    // Now resolve both
    resolveSummary(JSON.stringify({ session_title: 'Concurrent test' }))
    resolvePersona(JSON.stringify({ persona_id: 'jarvis' }))

    const result = await resultPromise
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('abc-123 — Concurrent test')
    expect(result[0].persona).toBe('jarvis')
  })
})

// --- Structured logging tests ---

describe('listProjects — logging', () => {
  it('logs warn when registry directory is unreadable', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockRejectedValue(new Error('EACCES'))

    await listProjects('/fake/.sidekick/projects', logger)

    expect(logger.warn).toHaveBeenCalledWith('Failed to read registry directory', {
      registryRoot: '/fake/.sidekick/projects',
      error: 'EACCES',
    })
  })

  it('logs debug when project directory is not accessible', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockResolvedValue([{ name: 'proj1', isDirectory: () => true }])
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        path: '/gone/project',
        displayName: 'proj1',
        lastActive: new Date().toISOString(),
      })
    )
    mockAccess.mockRejectedValue(new Error('ENOENT'))

    await listProjects('/fake/.sidekick/projects', logger)

    expect(logger.debug).toHaveBeenCalledWith('Project directory not accessible', {
      projectDir: '/gone/project',
      error: 'ENOENT',
    })
  })

  it('logs warn when registry entry has invalid JSON', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockResolvedValue([{ name: 'proj1', isDirectory: () => true }])
    mockReadFile.mockResolvedValue('not valid json')

    await listProjects('/fake/.sidekick/projects', logger)

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to parse registry entry',
      expect.objectContaining({
        registryFile: expect.stringContaining('proj1/registry.json'),
      })
    )
  })

  it('works silently without logger (backward compat)', async () => {
    mockReaddir.mockRejectedValue(new Error('EACCES'))
    // Should not throw — no logger provided
    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })
})

describe('getProjectById — logging', () => {
  it('logs debug when project directory is not accessible', async () => {
    const logger = createFakeLogger()
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        path: '/gone/project',
        displayName: 'proj1',
        lastActive: new Date().toISOString(),
      })
    )
    mockAccess.mockRejectedValue(new Error('ENOENT'))

    await getProjectById('/fake/.sidekick/projects', 'proj1', logger)

    expect(logger.debug).toHaveBeenCalledWith('Project directory not accessible', {
      projectDir: '/gone/project',
      error: 'ENOENT',
    })
  })

  it('logs warn when registry file cannot be read', async () => {
    const logger = createFakeLogger()
    mockReadFile.mockRejectedValue(new Error('EACCES'))

    await getProjectById('/fake/.sidekick/projects', 'proj1', logger)

    expect(logger.warn).toHaveBeenCalledWith('Failed to read project registry', {
      projectId: 'proj1',
      error: 'EACCES',
    })
  })

  it('works silently without logger (backward compat)', async () => {
    mockReadFile.mockRejectedValue(new Error('EACCES'))
    const result = await getProjectById('/fake/.sidekick/projects', 'proj1')
    expect(result).toBeNull()
  })
})

describe('listSessions — logging', () => {
  it('logs debug when sessions directory is unreadable', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockRejectedValue(new Error('EACCES'))

    await listSessions('/fake/project', false, logger)

    expect(logger.debug).toHaveBeenCalledWith('Sessions directory not readable', {
      sessionsDir: expect.stringContaining('.sidekick/sessions'),
      error: 'EACCES',
    })
  })

  it('logs debug when session directory disappears during scan', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockResolvedValue([{ name: 'sess-1', isDirectory: () => true }])
    mockStat.mockRejectedValue(new Error('ENOENT'))

    await listSessions('/fake/project', false, logger)

    expect(logger.debug).toHaveBeenCalledWith('Session directory disappeared during scan', {
      sessionDir: expect.stringContaining('sess-1'),
      error: 'ENOENT',
    })
  })

  it('logs debug when session summary is not available', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockResolvedValue([{ name: 'a1b2c3d4-full-id', isDirectory: () => true }])
    mockStat.mockResolvedValue({ mtime: new Date('2026-03-10T14:30:00Z') })
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('session-summary.json')) {
        return Promise.reject(new Error('ENOENT'))
      }
      if (filePath.includes('session-persona.json')) {
        return Promise.resolve(JSON.stringify({ persona_id: 'jarvis' }))
      }
      return Promise.reject(new Error('ENOENT'))
    })

    await listSessions('/fake/project', false, logger)

    expect(logger.debug).toHaveBeenCalledWith('Session summary not available', {
      sessionId: 'a1b2c3d4-full-id',
      error: 'ENOENT',
    })
  })

  it('logs debug when session persona is not available', async () => {
    const logger = createFakeLogger()
    mockReaddir.mockResolvedValue([{ name: 'a1b2c3d4-full-id', isDirectory: () => true }])
    mockStat.mockResolvedValue({ mtime: new Date('2026-03-10T14:30:00Z') })
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('session-summary.json')) {
        return Promise.resolve(
          JSON.stringify({ session_title: 'Test session' })
        )
      }
      if (filePath.includes('session-persona.json')) {
        return Promise.reject(new Error('ENOENT'))
      }
      return Promise.reject(new Error('ENOENT'))
    })

    await listSessions('/fake/project', false, logger)

    expect(logger.debug).toHaveBeenCalledWith('Session persona not available', {
      sessionId: 'a1b2c3d4-full-id',
      error: 'ENOENT',
    })
  })

  it('works silently without logger (backward compat)', async () => {
    mockReaddir.mockRejectedValue(new Error('EACCES'))
    const result = await listSessions('/fake/project')
    expect(result).toEqual([])
  })
})
