import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getGitBranch, clearGitBranchCache, GIT_BRANCH_TTL_MS } from '../git-branch-cache.js'

// Mock node:child_process
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}))

beforeEach(() => {
  mockExec.mockClear()
  clearGitBranchCache()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Helper: mock exec to call back with stdout string */
function mockExecSuccess(stdout: string) {
  mockExec.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, '')
    }
  )
}

/** Helper: mock exec to call back with error */
function mockExecFailure(message: string) {
  mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
    cb(new Error(message))
  })
}

describe('getGitBranch', () => {
  it('returns trimmed branch name from git', async () => {
    mockExecSuccess('main\n')
    const result = await getGitBranch('/some/project')
    expect(result).toBe('main')
  })

  it('returns "unknown" when git command fails', async () => {
    mockExecFailure('not a git repo')
    const result = await getGitBranch('/some/project')
    expect(result).toBe('unknown')
  })

  it('caches result and does not re-exec within TTL', async () => {
    mockExecSuccess('main\n')

    const result1 = await getGitBranch('/some/project')
    const result2 = await getGitBranch('/some/project')

    expect(result1).toBe('main')
    expect(result2).toBe('main')
    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('uses separate cache entries per project path', async () => {
    let callCount = 0
    mockExec.mockImplementation(
      (_cmd: string, opts: { cwd: string }, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        callCount++
        const branch = opts.cwd === '/project-a' ? 'main\n' : 'develop\n'
        cb(null, branch, '')
      }
    )

    const resultA = await getGitBranch('/project-a')
    const resultB = await getGitBranch('/project-b')

    expect(resultA).toBe('main')
    expect(resultB).toBe('develop')
    expect(callCount).toBe(2)
  })

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers()

    mockExecSuccess('main\n')
    await getGitBranch('/some/project')
    expect(mockExec).toHaveBeenCalledTimes(1)

    // Advance time past TTL
    vi.advanceTimersByTime(GIT_BRANCH_TTL_MS + 1)

    mockExecSuccess('develop\n')
    const result = await getGitBranch('/some/project')
    expect(result).toBe('develop')
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('does not re-fetch before TTL expires', async () => {
    vi.useFakeTimers()

    mockExecSuccess('main\n')
    await getGitBranch('/some/project')

    // Advance time but stay within TTL
    vi.advanceTimersByTime(GIT_BRANCH_TTL_MS - 1)

    const result = await getGitBranch('/some/project')
    expect(result).toBe('main')
    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('caches "unknown" results too (avoids re-spawning for non-git dirs)', async () => {
    mockExecFailure('not a git repo')

    await getGitBranch('/not-a-git-dir')
    await getGitBranch('/not-a-git-dir')

    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('clearGitBranchCache causes next call to re-exec', async () => {
    mockExecSuccess('main\n')
    await getGitBranch('/some/project')
    expect(mockExec).toHaveBeenCalledTimes(1)

    clearGitBranchCache()

    mockExecSuccess('feature\n')
    const result = await getGitBranch('/some/project')
    expect(result).toBe('feature')
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('exports a reasonable TTL value', () => {
    expect(GIT_BRANCH_TTL_MS).toBeGreaterThanOrEqual(10_000)
    expect(GIT_BRANCH_TTL_MS).toBeLessThanOrEqual(120_000)
  })
})
