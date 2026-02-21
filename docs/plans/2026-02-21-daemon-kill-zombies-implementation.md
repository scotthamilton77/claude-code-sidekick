# Daemon Kill-Zombies Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add zombie daemon process detection and cleanup via `sidekick daemon kill-zombies` and `sidekick doctor --only=zombies`.

**Architecture:** Two new exported functions (`findZombieDaemons`, `killZombieDaemons`) in `daemon-client.ts` that scan OS processes via `ps -eo pid,args`, filter for sidekick daemon lines, compare against the `~/.sidekick/daemons/` PID registry, and SIGKILL untracked processes. CLI and doctor integrate by calling these functions.

**Tech Stack:** Node.js child_process (execFile), vitest for tests

---

### Task 1: Add `findZombieDaemons()` and `killZombieDaemons()` to daemon-client.ts

**Files:**
- Modify: `packages/sidekick-core/src/daemon-client.ts:468-578` (after KillResult interface, before killAllDaemons)
- Modify: `packages/sidekick-core/src/index.ts:122` (add exports)

**Step 1: Write failing tests for findZombieDaemons**

Add a new `describe('findZombieDaemons')` block to `packages/sidekick-core/src/__tests__/daemon-client.test.ts` after the existing `killAllDaemons` describe block. The tests need to mock `child_process.execFile` for the `ps` command.

Since `daemon-client.ts` currently imports only `spawn` from `child_process`, we need to also import `execFile` — but the test file already mocks the entire `child_process` module. We'll add `execFile` to that mock.

Update the mock at the top of the test file (line 21-23):
```typescript
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}))
```

Add import for execFile after mock setup (near line 26):
```typescript
import { spawn, execFile } from 'child_process'
```

Then add these test cases:

```typescript
describe('findZombieDaemons', () => {
  let tmpUserDir: string

  beforeEach(async () => {
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-zombie-test-'))
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'daemons'), { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpUserDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should return empty array when no daemon processes found', async () => {
    // ps returns no matching lines
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      }
    )

    const results = await findZombieDaemons(logger)
    expect(results).toEqual([])
  })

  it('should return empty array when all daemon processes are registered', async () => {
    // One daemon process running
    const psOutput = '  1234 node /path/to/sidekick-daemon/dist/index.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    // Register PID 1234 in the registry
    const pidInfo: UserPidInfo = {
      pid: 1234,
      projectDir: '/project',
      startedAt: new Date().toISOString(),
    }
    await fs.writeFile(path.join(getUserDaemonsDir(), 'abc123.pid'), JSON.stringify(pidInfo))

    const results = await findZombieDaemons(logger)
    expect(results).toEqual([])
  })

  it('should detect zombie process not in registry', async () => {
    const psOutput = '  5678 node /path/to/sidekick-daemon/dist/index.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    // No PID files in registry — PID 5678 is a zombie
    const results = await findZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0].pid).toBe(5678)
    expect(results[0].command).toContain('sidekick-daemon')
  })

  it('should detect production daemon zombie', async () => {
    const psOutput = '  9999 node /usr/local/lib/node_modules/sidekick/dist/daemon.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    const results = await findZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0].pid).toBe(9999)
  })

  it('should exclude the grep process itself from results', async () => {
    // ps output might include the grep command — should be filtered
    const psOutput = [
      '  5678 node /path/to/sidekick-daemon/dist/index.js /project',
      '  7777 grep sidekick daemon',
      '',
    ].join('\n')
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    const results = await findZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0].pid).toBe(5678)
  })

  it('should handle ps command failure gracefully', async () => {
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('ps not found'), '', '')
      }
    )

    const results = await findZombieDaemons(logger)
    expect(results).toEqual([])
  })

  it('should handle empty daemons directory gracefully', async () => {
    await fs.rm(getUserDaemonsDir(), { recursive: true, force: true })

    const psOutput = '  5678 node /path/to/sidekick-daemon/dist/index.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    const results = await findZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0].pid).toBe(5678)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/core test -- --testPathPattern daemon-client --run 2>&1 | tail -30`
Expected: FAIL — `findZombieDaemons` is not exported / does not exist

**Step 3: Write failing tests for killZombieDaemons**

Add after the `findZombieDaemons` describe block:

```typescript
describe('killZombieDaemons', () => {
  let tmpUserDir: string

  beforeEach(async () => {
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-killzombie-test-'))
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'daemons'), { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpUserDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should return empty array when no zombies found', async () => {
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      }
    )

    const results = await killZombieDaemons(logger)
    expect(results).toEqual([])
  })

  it('should SIGKILL zombie processes and return results', async () => {
    const psOutput = '  5678 node /path/to/sidekick-daemon/dist/index.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const results = await killZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      projectDir: 'unknown',
      pid: 5678,
      killed: true,
    })
    expect(killSpy).toHaveBeenCalledWith(5678, 'SIGKILL')

    killSpy.mockRestore()
  })

  it('should report error when SIGKILL fails', async () => {
    const psOutput = '  5678 node /path/to/sidekick-daemon/dist/index.js /project\n'
    ;(execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, psOutput, '')
      }
    )

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('EPERM') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    })

    const results = await killZombieDaemons(logger)
    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe(false)
    expect(results[0].error).toContain('EPERM')

    killSpy.mockRestore()
  })
})
```

**Step 4: Implement findZombieDaemons and killZombieDaemons**

In `packages/sidekick-core/src/daemon-client.ts`, add import for `execFile` at the top (line 9):

```typescript
import { spawn, execFile } from 'child_process'
```

Add the `ZombieProcess` interface and both functions after the existing `KillAllOptions` interface (after line 485, before `killAllDaemons`):

```typescript
/**
 * A daemon process found via OS process scan that is not in the PID registry.
 */
export interface ZombieProcess {
  pid: number
  command: string
}

/**
 * Scan OS processes for sidekick daemon instances not tracked in ~/.sidekick/daemons/.
 * Uses `ps -eo pid,args` and filters for lines containing both 'sidekick' and 'daemon'.
 * Compares found PIDs against the PID registry to identify zombies.
 *
 * @param logger - Logger instance for reporting
 * @returns Array of zombie processes (unregistered daemon processes)
 */
export async function findZombieDaemons(logger: Logger): Promise<ZombieProcess[]> {
  // 1. Get all running processes matching sidekick daemon pattern
  let psOutput: string
  try {
    psOutput = await new Promise<string>((resolve, reject) => {
      execFile('ps', ['-eo', 'pid,args'], (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout)
      })
    })
  } catch (err) {
    logger.warn('Failed to scan processes', { error: err instanceof Error ? err.message : String(err) })
    return []
  }

  // Filter for lines containing both 'sidekick' and 'daemon' (matches both dev and prod paths)
  // Exclude grep/ps processes and our own process
  const daemonLines = psOutput
    .split('\n')
    .filter((line) => {
      const lower = line.toLowerCase()
      return (
        lower.includes('sidekick') &&
        lower.includes('daemon') &&
        !lower.includes('grep') &&
        !lower.includes('kill-zombies') &&
        line.includes('node')
      )
    })

  if (daemonLines.length === 0) {
    logger.debug('No sidekick daemon processes found in ps output')
    return []
  }

  // Parse PIDs from ps output
  const foundProcesses: ZombieProcess[] = []
  for (const line of daemonLines) {
    const trimmed = line.trim()
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) continue
    const pid = parseInt(trimmed.substring(0, spaceIdx), 10)
    if (isNaN(pid)) continue
    foundProcesses.push({ pid, command: trimmed.substring(spaceIdx + 1).trim() })
  }

  if (foundProcesses.length === 0) {
    return []
  }

  // 2. Read registered PIDs from ~/.sidekick/daemons/
  const registeredPids = new Set<number>()
  const daemonsDir = getUserDaemonsDir()
  try {
    const files = await fs.readdir(daemonsDir)
    for (const file of files.filter((f) => f.endsWith('.pid'))) {
      try {
        const content = await fs.readFile(path.join(daemonsDir, file), 'utf-8')
        const info = JSON.parse(content) as UserPidInfo
        registeredPids.add(info.pid)
      } catch {
        // Skip invalid PID files
      }
    }
  } catch {
    // No daemons directory — all found processes are zombies
    logger.debug('No daemons registry directory found')
  }

  // 3. Filter to unregistered PIDs
  const zombies = foundProcesses.filter((p) => !registeredPids.has(p.pid))

  logger.info('Zombie daemon scan complete', {
    totalFound: foundProcesses.length,
    registered: registeredPids.size,
    zombies: zombies.length,
  })

  return zombies
}

/**
 * Find and kill zombie daemon processes.
 * Zombies are daemon processes not tracked in the PID registry.
 * Uses SIGKILL directly since these are untracked (no IPC available).
 *
 * @param logger - Logger instance for reporting
 * @returns Array of kill results
 */
export async function killZombieDaemons(logger: Logger): Promise<KillResult[]> {
  const zombies = await findZombieDaemons(logger)

  if (zombies.length === 0) {
    logger.debug('No zombie daemons found')
    return []
  }

  const results: KillResult[] = []

  for (const zombie of zombies) {
    try {
      process.kill(zombie.pid, 'SIGKILL')
      logger.info('Killed zombie daemon', { pid: zombie.pid, command: zombie.command })
      results.push({ projectDir: 'unknown', pid: zombie.pid, killed: true })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.warn('Failed to kill zombie daemon', { pid: zombie.pid, error: errorMsg })
      results.push({ projectDir: 'unknown', pid: zombie.pid, killed: false, error: errorMsg })
    }
  }

  return results
}
```

**Step 5: Add exports to index.ts**

In `packages/sidekick-core/src/index.ts` line 122, update the export to include the new functions and type:

```typescript
export { killAllDaemons, killZombieDaemons, findZombieDaemons, DaemonClient, type KillResult, type KillAllOptions, type UserPidInfo, type ZombieProcess } from './daemon-client'
```

**Step 6: Run tests to verify they pass**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/core test -- --testPathPattern daemon-client --run 2>&1 | tail -30`
Expected: All tests PASS

**Step 7: Run build and typecheck**

Run: `cd /workspaces/claude-code-sidekick && pnpm build && pnpm typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/sidekick-core/src/daemon-client.ts packages/sidekick-core/src/index.ts packages/sidekick-core/src/__tests__/daemon-client.test.ts
git commit -m "feat(daemon): add findZombieDaemons and killZombieDaemons functions" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add `kill-zombies` CLI subcommand

**Files:**
- Modify: `packages/sidekick-cli/src/commands/daemon.ts:16,28-46,95-111`

**Step 1: Write failing test for the kill-zombies subcommand**

Create test or check if daemon command tests exist:

```bash
find packages/sidekick-cli/src -name '*daemon*test*' -o -name '*daemon*spec*'
```

If no test file exists for the daemon command handler, the CLI tests may be integration-level. In that case, we test via the core functions (already tested in Task 1). We'll add a lightweight test to verify the CLI handler wires through correctly.

Check for existing CLI command tests first — if there's a pattern, follow it. If not, add inline to an existing CLI test file or create `packages/sidekick-cli/src/__tests__/daemon.test.ts`.

**Step 2: Implement the kill-zombies subcommand**

In `packages/sidekick-cli/src/commands/daemon.ts`:

Add `killZombieDaemons` to imports (line 16):
```typescript
import { killAllDaemons, killZombieDaemons, Logger, DaemonClient } from '@sidekick/core'
```

Update the `USAGE_TEXT` constant (around line 28-46) to add the new command:
```typescript
const USAGE_TEXT = `Usage: sidekick daemon <command> [options]

Commands:
  start          Start the project-local daemon
  stop           Gracefully stop the daemon via IPC
  status         Check daemon status and ping
  kill           Forcefully terminate the daemon (SIGKILL)
  kill-all       Kill all daemons across all projects
  kill-zombies   Find and kill unregistered daemon processes

Options:
  --wait     Wait for daemon to fully stop (with 'stop' command)
  --help     Show this help message

Examples:
  sidekick daemon start
  sidekick daemon stop --wait
  sidekick daemon status
  sidekick daemon kill-all
  sidekick daemon kill-zombies
`
```

Add the `kill-zombies` case after the `kill-all` case (after line 111, before the `help` case):
```typescript
    case 'kill-zombies': {
      const results = await killZombieDaemons(logger)
      if (results.length === 0) {
        stdout.write('No zombie daemons found\n')
      } else {
        for (const result of results) {
          if (result.killed) {
            stdout.write(`Killed zombie: PID ${result.pid}\n`)
          } else {
            stdout.write(`Failed: PID ${result.pid}: ${result.error}\n`)
          }
        }
        const killedCount = results.filter((r: KillResult) => r.killed).length
        stdout.write(`\nKilled ${killedCount} of ${results.length} zombie daemons\n`)
      }
      break
    }
```

**Step 3: Run build and typecheck**

Run: `cd /workspaces/claude-code-sidekick && pnpm build && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/commands/daemon.ts
git commit -m "feat(cli): add daemon kill-zombies subcommand" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add `zombies` doctor check

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:1005-1006,1149-1298`

**Step 1: Add `findZombieDaemons` and `killZombieDaemons` to imports**

Check what's currently imported from `@sidekick/core` at the top of `setup/index.ts` and add the new functions. Search for the import line and append.

**Step 2: Add 'zombies' to DOCTOR_CHECK_NAMES**

Line 1005:
```typescript
const DOCTOR_CHECK_NAMES = ['api-keys', 'statusline', 'gitignore', 'plugin', 'liveness', 'zombies'] as const
```

**Step 3: Add zombie check to runDoctor function**

In the `runDoctor` function, after the plugin/liveness promise block (around line 1252), add a new zombie check block:

```typescript
  // Zombie daemon check
  let zombieCount = 0
  if (shouldRun('zombies')) {
    promises.push(
      findZombieDaemons(logger).then((zombies) => {
        zombieCount = zombies.length
        const zombieIcon = zombies.length === 0 ? '✓' : '⚠'
        const label = zombies.length === 0
          ? 'none detected'
          : `${zombies.length} found (run 'sidekick daemon kill-zombies' or 'sidekick doctor --fix --only=zombies')`
        stdout.write(`${zombieIcon} Zombie Daemons: ${label}\n`)
      })
    )
  }
```

**Step 4: Update the overall health calculation**

In the `filter === null` block (around line 1262), add zombie check to the health calculation:

```typescript
    const isHealthy =
      doctorResult!.overallHealth === 'healthy' && gitignore === 'installed' && isPluginOk && isPluginLive && zombieCount === 0
```

**Step 5: Add zombie fix to runDoctorFixes**

In the `runDoctorFixes` function, add a fix block for zombies (after the plugin fix block, before the unfixable section):

```typescript
  // Fix: Zombie daemons
  if (shouldFix('zombies')) {
    const zombieResults = await killZombieDaemons(logger)
    if (zombieResults.length > 0) {
      stdout.write('Fixing: Zombie Daemons\n')
      const killed = zombieResults.filter((r) => r.killed).length
      stdout.write(`  ✓ Killed ${killed} zombie daemon${killed === 1 ? '' : 's'}\n`)
      fixedCount += killed > 0 ? 1 : 0
      const failed = zombieResults.filter((r) => !r.killed)
      for (const f of failed) {
        stdout.write(`  ⚠ Failed to kill PID ${f.pid}: ${f.error}\n`)
      }
    }
  }
```

**Step 6: Run build and typecheck**

Run: `cd /workspaces/claude-code-sidekick && pnpm build && pnpm typecheck`
Expected: PASS

**Step 7: Run doctor-related tests if they exist**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/cli test -- --run 2>&1 | tail -30`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(doctor): add zombies check with --fix support" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

**Step 1: Run full build + typecheck + lint**

Run: `cd /workspaces/claude-code-sidekick && pnpm build && pnpm typecheck`
Expected: PASS

**Step 2: Run all core tests (excluding IPC)**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client-ipc}.test.ts' --run 2>&1 | tail -30`
Expected: PASS

**Step 3: Run CLI tests**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/cli test -- --run 2>&1 | tail -30`
Expected: PASS
