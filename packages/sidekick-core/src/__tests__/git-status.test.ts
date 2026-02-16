/**
 * Tests for git-status utility
 *
 * @see git-status.ts
 * @see docs/plans/2026-02-16-bash-vc-detection-design.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import { getGitFileStatus, parseGitStatusOutput } from '../git-status'

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>

type EventCallback = (...args: unknown[]) => void

/**
 * Create a mock ChildProcess that simulates spawn behavior.
 * Data/close/error events fire asynchronously via setImmediate.
 */
function createMockProcess(stdout: string, exitCode: number, error?: Error): Record<string, unknown> {
  const stdoutHandlers: Record<string, EventCallback> = {}
  const procHandlers: Record<string, EventCallback> = {}

  const proc = {
    stdout: {
      on: vi.fn((event: string, handler: EventCallback) => {
        stdoutHandlers[event] = handler
      }),
    },
    on: vi.fn((event: string, handler: EventCallback) => {
      procHandlers[event] = handler
    }),
    kill: vi.fn(),
  }

  // Simulate async behavior
  setImmediate(() => {
    if (error) {
      procHandlers['error']?.(error)
    } else {
      if (stdout) stdoutHandlers['data']?.(Buffer.from(stdout))
      procHandlers['close']?.(exitCode)
    }
  })

  return proc
}

describe('parseGitStatusOutput', () => {
  it('parses modified files', () => {
    expect(parseGitStatusOutput(' M src/foo.ts')).toEqual(['src/foo.ts'])
  })

  it('parses new untracked files', () => {
    expect(parseGitStatusOutput('?? src/new.ts')).toEqual(['src/new.ts'])
  })

  it('parses staged files', () => {
    expect(parseGitStatusOutput('A  src/added.ts')).toEqual(['src/added.ts'])
  })

  it('parses deleted files', () => {
    expect(parseGitStatusOutput('D  src/deleted.ts')).toEqual(['src/deleted.ts'])
  })

  it('parses renamed files (takes new path)', () => {
    expect(parseGitStatusOutput('R  old.ts -> new.ts')).toEqual(['new.ts'])
  })

  it('parses multiple lines', () => {
    const output = ' M src/a.ts\n?? src/b.ts\nA  src/c.ts'
    expect(parseGitStatusOutput(output)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('handles empty output', () => {
    expect(parseGitStatusOutput('')).toEqual([])
  })

  it('skips empty lines', () => {
    expect(parseGitStatusOutput(' M src/a.ts\n\n M src/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('handles whitespace-only output', () => {
    expect(parseGitStatusOutput('   \n  ')).toEqual([])
  })

  it('parses both staged and unstaged modifications (MM)', () => {
    expect(parseGitStatusOutput('MM src/both.ts')).toEqual(['src/both.ts'])
  })

  it('strips quotes from paths with spaces', () => {
    expect(parseGitStatusOutput(' M "path with spaces/file.ts"')).toEqual(['path with spaces/file.ts'])
  })

  it('strips quotes from renamed paths with spaces', () => {
    expect(parseGitStatusOutput('R  "old name.ts" -> "new name.ts"')).toEqual(['new name.ts'])
  })
})

describe('getGitFileStatus', () => {
  beforeEach(() => {
    mockSpawn.mockClear()
  })

  it('returns parsed file paths on success', async () => {
    mockSpawn.mockReturnValue(createMockProcess(' M src/foo.ts\n?? src/bar.ts', 0))

    const result = await getGitFileStatus('/test/dir')

    expect(result).toEqual(['src/foo.ts', 'src/bar.ts'])
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain'],
      expect.objectContaining({ cwd: '/test/dir' })
    )
  })

  it('returns empty array on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 128))

    const result = await getGitFileStatus('/not-a-repo')

    expect(result).toEqual([])
  })

  it('returns empty array on spawn error', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 0, new Error('ENOENT')))

    const result = await getGitFileStatus('/test/dir')

    expect(result).toEqual([])
  })

  it('returns empty array on timeout and kills the process', async () => {
    vi.useFakeTimers()

    try {
      // Create a process that never completes
      const proc = {
        stdout: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      }
      mockSpawn.mockReturnValue(proc)

      const promise = getGitFileStatus('/test/dir', 100)

      vi.advanceTimersByTime(101)

      const result = await promise

      expect(result).toEqual([])
      expect(proc.kill).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns empty array for clean working directory', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 0))

    const result = await getGitFileStatus('/clean/repo')

    expect(result).toEqual([])
  })
})
