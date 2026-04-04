/**
 * Tests for dev-mode clean-all-projects subcommand.
 *
 * Verifies BEHAVIOR of handleDevModeCommand('clean-all-projects'):
 * - Iterates over all projects in the registry
 * - Runs clean operation for each project
 * - Prompts for confirmation per project (unless --force)
 * - Handles empty registry gracefully
 * - Handles projects with missing .sidekick dirs
 *
 * @see dev-mode.ts handleDevModeCommand
 */
import { Writable, Readable } from 'node:stream'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import { handleDevModeCommand } from '../dev-mode'

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

/** Create a Readable that feeds lines one at a time, then closes. */
function createMockStdin(...lines: string[]): NodeJS.ReadableStream {
  const readable = new Readable({ read() {} })
  // Push all lines, then EOF
  for (const line of lines) {
    readable.push(line + '\n')
  }
  readable.push(null)
  return readable
}

// Mock @sidekick/core to avoid actual daemon operations
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    Logger: vi.fn(),
    DaemonClient: vi.fn().mockImplementation(function () {
      return { kill: vi.fn().mockResolvedValue({ killed: false }) }
    }),
    killAllDaemons: vi.fn().mockResolvedValue([]),
    findZombieDaemons: vi.fn().mockResolvedValue([]),
    killZombieDaemons: vi.fn().mockResolvedValue([]),
    getSocketPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.sock')),
    getTokenPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.token')),
    getLockPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.lock')),
    getUserDaemonsDir: vi.fn(() => '/tmp/claude/nonexistent-daemons-dir'),
    ProjectRegistryService: vi.fn().mockImplementation(function () {
      return { list: vi.fn().mockResolvedValue([]) }
    }),
  }
})

import { ProjectRegistryService } from '@sidekick/core'

describe('handleDevModeCommand clean-all-projects', () => {
  let stdout: CollectingWritable
  let logger: Logger
  let tempDir: string
  let registryDir: string
  let projectADir: string
  let projectBDir: string

  beforeEach(async () => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()
    tempDir = `/tmp/claude/dev-mode-cap-test-${Date.now()}`

    // Create a fake registry root and two project directories
    registryDir = path.join(tempDir, 'registry')
    projectADir = path.join(tempDir, 'project-a')
    projectBDir = path.join(tempDir, 'project-b')

    await mkdir(registryDir, { recursive: true })
    await mkdir(path.join(projectADir, '.sidekick', 'logs'), { recursive: true })
    await mkdir(path.join(projectADir, '.sidekick', 'state'), { recursive: true })
    await mkdir(path.join(projectBDir, '.sidekick', 'logs'), { recursive: true })
    await mkdir(path.join(projectBDir, '.sidekick', 'state'), { recursive: true })

    // Create some log files in each project
    await writeFile(path.join(projectADir, '.sidekick', 'logs', 'cli.log'), 'log-a content\n')
    await writeFile(path.join(projectBDir, '.sidekick', 'logs', 'cli.log'), 'log-b content\n')

    // Clear mock call counts
    vi.mocked(ProjectRegistryService).mockClear()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('shows message when no projects are registered', async () => {
    // Default mock returns empty list
    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return { list: vi.fn().mockResolvedValue([]) } as any
    })

    const result = await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { force: true })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('No registered projects found')
  })

  test('cleans all registered projects with --force', async () => {
    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([
          { path: projectADir, displayName: 'project-a', lastActive: new Date().toISOString() },
          { path: projectBDir, displayName: 'project-b', lastActive: new Date().toISOString() },
        ]),
      } as any
    })

    const result = await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { force: true })

    expect(result.exitCode).toBe(0)
    // Should mention both projects
    expect(stdout.data).toContain('project-a')
    expect(stdout.data).toContain('project-b')
    // Should report clean results
    expect(stdout.data).toMatch(/cleaned.*2|2.*project/i)
  })

  test('prompts for each project when --force is not set', async () => {
    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([
          { path: projectADir, displayName: 'project-a', lastActive: new Date().toISOString() },
          { path: projectBDir, displayName: 'project-b', lastActive: new Date().toISOString() },
        ]),
      } as any
    })

    // Confirm first, decline second
    const mockStdin = createMockStdin('y', 'n')

    const result = await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { stdin: mockStdin })

    expect(result.exitCode).toBe(0)
    // Should have prompted for project-a
    expect(stdout.data).toContain('project-a')
    // Should have skipped project-b
    expect(stdout.data).toMatch(/skip/i)
  })

  test('skips projects whose directory no longer exists', async () => {
    const missingDir = path.join(tempDir, 'missing-project')

    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([
          { path: missingDir, displayName: 'missing-project', lastActive: new Date().toISOString() },
          { path: projectADir, displayName: 'project-a', lastActive: new Date().toISOString() },
        ]),
      } as any
    })

    const result = await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { force: true })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toMatch(/missing-project.*not found|not found.*missing-project|skip.*missing/i)
    // Should still clean the valid project
    expect(stdout.data).toContain('project-a')
  })

  test('skips registry entries that point at a regular file instead of a directory', async () => {
    // Create a regular file where a project directory is expected
    const filePath = path.join(tempDir, 'not-a-dir')
    await writeFile(filePath, 'I am a file, not a directory')

    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([
          { path: filePath, displayName: 'not-a-dir', lastActive: new Date().toISOString() },
          { path: projectADir, displayName: 'project-a', lastActive: new Date().toISOString() },
        ]),
      } as any
    })

    const result = await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { force: true })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toMatch(/not-a-dir.*not a directory/i)
    // Should still clean the valid project
    expect(stdout.data).toContain('project-a')
  })

  test('uses ~/.sidekick/projects/ as registry root', async () => {
    vi.mocked(ProjectRegistryService).mockImplementation(function () {
      return { list: vi.fn().mockResolvedValue([]) } as any
    })

    await handleDevModeCommand('clean-all-projects', tempDir, logger, stdout, { force: true })

    // Verify ProjectRegistryService was constructed with the correct path
    expect(ProjectRegistryService).toHaveBeenCalledWith(path.join(os.homedir(), '.sidekick', 'projects'))
  })

  test('shows in usage/help text', async () => {
    const result = await handleDevModeCommand('help', tempDir, logger, stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('clean-all-projects')
  })
})
