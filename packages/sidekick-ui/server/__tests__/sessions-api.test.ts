import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listProjects, listSessions } from '../sessions-api.js'

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

// Mock node:child_process
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}))

beforeEach(() => {
  mockReaddir.mockClear()
  mockReadFile.mockClear()
  mockStat.mockClear()
  mockAccess.mockClear()
  mockExec.mockClear()
})

/** Helper: mock exec to call back with stdout string */
function mockExecSuccess(stdout: string) {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, '')
    },
  )
}

/** Helper: mock exec to call back with error */
function mockExecFailure(message: string) {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error(message))
    },
  )
}

describe('listProjects', () => {
  it('returns empty array when registry directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })

  it('returns projects from registry entries', async () => {
    mockReaddir.mockResolvedValue([
      { name: '-Users-scott-src-myproject', isDirectory: () => true },
    ])

    const registryEntry = {
      path: '/Users/scott/src/myproject',
      displayName: 'myproject',
      lastActive: new Date(Date.now() - 2000).toISOString(), // 2s ago = active
    }
    mockReadFile.mockResolvedValue(JSON.stringify(registryEntry))
    mockAccess.mockResolvedValue(undefined)
    mockExecSuccess('main\n')

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
    mockReaddir.mockResolvedValue([
      { name: 'proj1', isDirectory: () => true },
    ])

    const registryEntry = {
      path: '/Users/scott/src/proj1',
      displayName: 'proj1',
      lastActive: new Date(Date.now() - 60_000).toISOString(), // 60s ago = inactive
    }
    mockReadFile.mockResolvedValue(JSON.stringify(registryEntry))
    mockAccess.mockResolvedValue(undefined)
    mockExecSuccess('feat/branch\n')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result[0].active).toBe(false)
    expect(result[0].branch).toBe('feat/branch')
  })

  it('returns branch=unknown when git fails', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'proj1', isDirectory: () => true },
    ])

    mockReadFile.mockResolvedValue(JSON.stringify({
      path: '/Users/scott/src/proj1',
      displayName: 'proj1',
      lastActive: new Date().toISOString(),
    }))
    mockAccess.mockResolvedValue(undefined)
    mockExecFailure('not a git repo')

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result[0].branch).toBe('unknown')
  })

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'some-file.txt', isDirectory: () => false },
    ])

    const result = await listProjects('/fake/.sidekick/projects')
    expect(result).toEqual([])
  })

  it('skips entries with invalid registry.json', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'proj1', isDirectory: () => true },
    ])
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
    mockReaddir.mockResolvedValue([
      { name: 'abc-123', isDirectory: () => true },
    ])

    const sessionDate = new Date('2026-03-10T14:30:00Z')
    mockStat.mockResolvedValue({ mtime: sessionDate })

    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('session-summary.json')) {
        return Promise.resolve(JSON.stringify({
          title: 'Fix daemon restart',
          intent: 'Bug fix',
          intentConfidence: 0.85,
        }))
      }
      if (filePath.includes('session-persona.json')) {
        return Promise.resolve(JSON.stringify({ personaId: 'jarvis' }))
      }
      return Promise.reject(new Error('ENOENT'))
    })

    const result = await listSessions('/fake/project')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'abc-123',
      title: 'Fix daemon restart',
      date: sessionDate.toISOString(),
      status: 'completed',
      persona: 'jarvis',
      intent: 'Bug fix',
      intentConfidence: 0.85,
    })
  })

  it('uses truncated session ID when session-summary.json is missing', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', isDirectory: () => true },
    ])
    mockStat.mockResolvedValue({ mtime: new Date('2026-03-10T14:30:00Z') })
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await listSessions('/fake/project')
    expect(result[0].title).toBe('a1b2c3d4')
  })

  it('skips non-directory entries', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'some-file.log', isDirectory: () => false },
    ])

    const result = await listSessions('/fake/project')
    expect(result).toEqual([])
  })

  it('marks session as active when isProjectActive=true and state is recently modified', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'session-1', isDirectory: () => true },
    ])
    mockStat.mockResolvedValue({ mtime: new Date(Date.now() - 1000) })
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await listSessions('/fake/project', true)
    expect(result[0].status).toBe('active')
  })
})
