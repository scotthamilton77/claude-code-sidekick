# Uninstall Process Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure uninstall kills all tracked daemon processes (graceful then SIGKILL) before removing PID files, preventing orphaned daemons.

**Architecture:** Extend the existing uninstall command to (1) use graceful-then-force strategy for the project daemon, (2) call `killAllDaemons()` for user-scope uninstall, and (3) add graceful shutdown support to `killAllDaemons()` itself.

**Tech Stack:** TypeScript, vitest, @sidekick/core DaemonClient

---

### Task 1: Add graceful-then-force to `killDaemon()` in uninstall.ts

**Files:**
- Test: `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts:292-311`

**Step 1: Write the failing test**

In `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`, add a mock for `stopAndWait` in the hoisted block and the mock factory, then add a test:

Update the hoisted mocks:
```typescript
const { mockDaemonKill, mockDaemonStopAndWait, mockExecFile } = vi.hoisted(() => ({
  mockDaemonKill: vi.fn().mockResolvedValue({ killed: false }),
  mockDaemonStopAndWait: vi.fn().mockResolvedValue(true),
  mockExecFile: vi.fn(),
}))
```

Update the DaemonClient mock factory:
```typescript
DaemonClient: vi.fn().mockImplementation(function () {
  return { kill: mockDaemonKill, stopAndWait: mockDaemonStopAndWait }
}),
```

Update `beforeEach` to clear the new mock:
```typescript
mockDaemonStopAndWait.mockClear()
```

Add test in the `daemon handling` describe block:
```typescript
test('attempts graceful stop before kill during uninstall', async () => {
  await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
  mockDaemonStopAndWait.mockResolvedValue(true)

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    scope: 'project',
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockDaemonStopAndWait).toHaveBeenCalledWith(3000)
  // When graceful succeeds, kill should NOT be called
  expect(mockDaemonKill).not.toHaveBeenCalled()
})

test('falls back to kill when graceful stop fails', async () => {
  await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
  mockDaemonStopAndWait.mockResolvedValue(false) // Graceful failed (timeout)

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    scope: 'project',
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockDaemonStopAndWait).toHaveBeenCalledWith(3000)
  expect(mockDaemonKill).toHaveBeenCalled()
})

test('falls back to kill when graceful stop throws', async () => {
  await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
  mockDaemonStopAndWait.mockRejectedValue(new Error('IPC connection failed'))

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    scope: 'project',
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockDaemonKill).toHaveBeenCalled()
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern uninstall`
Expected: FAIL — `mockDaemonStopAndWait` is not called (current code uses `kill()` directly)

**Step 3: Implement graceful-then-force in killDaemon()**

In `packages/sidekick-cli/src/commands/uninstall.ts`, update the `killDaemon` function:

```typescript
async function killDaemon(
  projectDir: string,
  logger: Logger,
  _stdout: Writable,
  actions: UninstallAction[],
  options: { dryRun: boolean }
): Promise<void> {
  if (options.dryRun) {
    actions.push({ scope: 'project', artifact: 'Daemon process', path: projectDir, action: 'would-remove' })
    return
  }

  try {
    const client = new DaemonClient(projectDir, logger)

    // Try graceful shutdown first (3s timeout)
    const stopped = await client.stopAndWait(3000).catch(() => false)

    if (stopped) {
      logger.info('Daemon stopped gracefully')
      actions.push({ scope: 'project', artifact: 'Daemon process', path: projectDir, action: 'removed' })
      return
    }

    // Graceful failed — force kill
    logger.info('Graceful stop failed, killing daemon forcefully')
    const result = await client.kill()
    logger.info('Daemon kill result', { result })
    actions.push({ scope: 'project', artifact: 'Daemon process', path: projectDir, action: result.killed ? 'removed' : 'not-found' })
  } catch (err) {
    logger.debug('Daemon kill failed (may not be running)', { error: (err as Error).message })
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern uninstall`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts
git commit -m "feat(uninstall): graceful-then-force daemon shutdown for project scope"
```

---

### Task 2: Add user-scope daemon killing to uninstall.ts

**Files:**
- Test: `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts:72-76`

**Step 1: Write the failing tests**

First, get access to `mockKillAllDaemons` from the existing mock. It's already mocked at line 72 of the test:
```typescript
killAllDaemons: vi.fn().mockResolvedValue([]),
```

Import it to use in assertions. Add to the hoisted block:
```typescript
const { mockDaemonKill, mockDaemonStopAndWait, mockKillAllDaemons, mockExecFile } = vi.hoisted(() => ({
  mockDaemonKill: vi.fn().mockResolvedValue({ killed: false }),
  mockDaemonStopAndWait: vi.fn().mockResolvedValue(true),
  mockKillAllDaemons: vi.fn().mockResolvedValue([]),
  mockExecFile: vi.fn(),
}))
```

Update the mock factory to use the hoisted mock:
```typescript
killAllDaemons: mockKillAllDaemons,
```

Add `mockKillAllDaemons.mockClear()` to `beforeEach`.

Add tests in the `daemon handling` describe block:
```typescript
test('kills all daemons during user-scope uninstall', async () => {
  await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
  mockKillAllDaemons.mockResolvedValue([
    { projectDir: '/project/a', pid: 1001, killed: true },
    { projectDir: '/project/b', pid: 1002, killed: true },
  ])

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockKillAllDaemons).toHaveBeenCalled()
  // Each killed daemon should appear in the report
  expect(stdout.data).toContain('Daemon (PID 1001)')
  expect(stdout.data).toContain('Daemon (PID 1002)')
})

test('does not kill all daemons for project-only scope', async () => {
  await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    scope: 'project',
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockKillAllDaemons).not.toHaveBeenCalled()
})

test('handles killAllDaemons failures gracefully', async () => {
  await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
  mockKillAllDaemons.mockResolvedValue([
    { projectDir: '/project/a', pid: 1001, killed: false, error: 'EPERM' },
  ])

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    userHome,
  })

  expect(result.exitCode).toBe(0)
  // Failed kill should still be reported
  expect(stdout.data).toContain('Daemon (PID 1001)')
})

test('dry-run reports user daemons without killing', async () => {
  await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

  const result = await handleUninstallCommand(tempDir, logger, stdout, {
    force: true,
    dryRun: true,
    userHome,
  })

  expect(result.exitCode).toBe(0)
  expect(mockKillAllDaemons).not.toHaveBeenCalled()
  expect(stdout.data).toContain('dry-run')
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern uninstall`
Expected: FAIL — `killAllDaemons` is never called from uninstall

**Step 3: Implement user-scope daemon killing**

In `packages/sidekick-cli/src/commands/uninstall.ts`:

1. Add `killAllDaemons` to the import from `@sidekick/core`:
```typescript
import { DaemonClient, killAllDaemons, removeGitignoreSection, SetupStatusService } from '@sidekick/core'
```

Also add `KillResult` type import:
```typescript
import type { KillResult } from '@sidekick/core'
```

2. After the existing Step 2 daemon kill block (line 72-75), add user-scope daemon killing:

```typescript
  // Step 2b: Kill ALL daemons (user scope)
  if (userDetected) {
    await killAllTrackedDaemons(logger, stdout, actions, { dryRun })
  }
```

3. Add the new helper function:

```typescript
async function killAllTrackedDaemons(
  logger: Logger,
  _stdout: Writable,
  actions: UninstallAction[],
  options: { dryRun: boolean }
): Promise<void> {
  if (options.dryRun) {
    actions.push({ scope: 'user', artifact: 'All tracked daemons', path: '~/.sidekick/daemons/', action: 'would-remove' })
    return
  }

  try {
    const results: KillResult[] = await killAllDaemons(logger)
    for (const result of results) {
      actions.push({
        scope: 'user',
        artifact: `Daemon (PID ${result.pid})`,
        path: result.projectDir,
        action: result.killed ? 'removed' : 'skipped',
      })
    }
  } catch (err) {
    logger.debug('killAllDaemons failed', { error: (err as Error).message })
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern uninstall`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts
git commit -m "feat(uninstall): kill all tracked daemons during user-scope uninstall"
```

---

### Task 3: Add graceful shutdown support to `killAllDaemons()`

**Files:**
- Test: `packages/sidekick-core/src/__tests__/daemon-client.test.ts`
- Modify: `packages/sidekick-core/src/daemon-client.ts:491-550`
- Modify: `packages/sidekick-core/src/index.ts` (export if new types added)

**Step 1: Write the failing tests**

In `packages/sidekick-core/src/__tests__/daemon-client.test.ts`, in the `killAllDaemons` describe block, add:

```typescript
it('should attempt graceful stop before SIGKILL when graceful option is true', async () => {
  const pidInfo: UserPidInfo = {
    pid: process.pid,
    projectDir: tmpUserDir,
    startedAt: new Date().toISOString(),
  }

  const pidFilePath = path.join(getUserDaemonsDir(), 'graceful.pid')
  await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

  // Mock process.kill
  const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 0) return true
    if (signal === 'SIGKILL') return true
    return true
  })

  // Mock DaemonClient.stopAndWait to succeed
  const stopAndWaitMock = vi.fn().mockResolvedValue(true)
  vi.spyOn(DaemonClient.prototype, 'stopAndWait').mockImplementation(stopAndWaitMock)

  const results = await killAllDaemons(logger, { graceful: true, gracefulTimeoutMs: 3000 })

  expect(results).toHaveLength(1)
  expect(results[0].killed).toBe(true)
  // Graceful stop should have been attempted
  expect(stopAndWaitMock).toHaveBeenCalledWith(3000)
  // SIGKILL should NOT have been sent (graceful succeeded)
  expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL')

  killSpy.mockRestore()
})

it('should fall back to SIGKILL when graceful stop fails', async () => {
  const pidInfo: UserPidInfo = {
    pid: process.pid,
    projectDir: tmpUserDir,
    startedAt: new Date().toISOString(),
  }

  const pidFilePath = path.join(getUserDaemonsDir(), 'fallback.pid')
  await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

  const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 0) return true
    if (signal === 'SIGKILL') return true
    return true
  })

  // Mock DaemonClient.stopAndWait to fail
  vi.spyOn(DaemonClient.prototype, 'stopAndWait').mockResolvedValue(false)

  const results = await killAllDaemons(logger, { graceful: true, gracefulTimeoutMs: 3000 })

  expect(results).toHaveLength(1)
  expect(results[0].killed).toBe(true)
  // SIGKILL should have been sent as fallback
  expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

  killSpy.mockRestore()
})

it('should skip graceful stop when graceful option is false (default)', async () => {
  const pidInfo: UserPidInfo = {
    pid: process.pid,
    projectDir: tmpUserDir,
    startedAt: new Date().toISOString(),
  }

  const pidFilePath = path.join(getUserDaemonsDir(), 'nograceful.pid')
  await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

  const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 0) return true
    if (signal === 'SIGKILL') return true
    return true
  })

  const stopAndWaitSpy = vi.spyOn(DaemonClient.prototype, 'stopAndWait')

  const results = await killAllDaemons(logger)

  expect(results).toHaveLength(1)
  expect(results[0].killed).toBe(true)
  // No graceful stop attempted
  expect(stopAndWaitSpy).not.toHaveBeenCalled()
  // Straight to SIGKILL
  expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

  killSpy.mockRestore()
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern daemon-client --exclude '**/{ipc,ipc-service}.test.ts'`
Expected: FAIL — `killAllDaemons` doesn't accept options or attempt graceful stop

**Step 3: Implement graceful option in killAllDaemons()**

In `packages/sidekick-core/src/daemon-client.ts`, update the function signature and body:

```typescript
export interface KillAllOptions {
  /** Attempt graceful IPC shutdown before SIGKILL. Default: false */
  graceful?: boolean
  /** Timeout for graceful shutdown per daemon in ms. Default: 3000 */
  gracefulTimeoutMs?: number
}

export async function killAllDaemons(logger: Logger, options: KillAllOptions = {}): Promise<KillResult[]> {
  const { graceful = false, gracefulTimeoutMs = 3000 } = options
  const results: KillResult[] = []
  const daemonsDir = getUserDaemonsDir()

  let files: string[]
  try {
    files = await fs.readdir(daemonsDir)
  } catch {
    logger.debug('No daemons directory found', { path: daemonsDir })
    return results
  }

  const pidFiles = files.filter((f) => f.endsWith('.pid'))

  for (const pidFile of pidFiles) {
    const pidPath = path.join(daemonsDir, pidFile)

    try {
      const content = await fs.readFile(pidPath, 'utf-8')
      const info = JSON.parse(content) as UserPidInfo

      // Check if process is alive
      try {
        process.kill(info.pid, 0)
      } catch {
        logger.debug('Cleaning up stale PID file', { pidFile, pid: info.pid })
        await fs.unlink(pidPath).catch(() => {})
        continue
      }

      // Try graceful shutdown first if requested
      if (graceful) {
        try {
          const client = new DaemonClient(info.projectDir, logger)
          const stopped = await client.stopAndWait(gracefulTimeoutMs)
          if (stopped) {
            logger.info('Daemon stopped gracefully', { pid: info.pid, projectDir: info.projectDir })
            results.push({ projectDir: info.projectDir, pid: info.pid, killed: true })
            await fs.unlink(pidPath).catch(() => {})
            continue
          }
        } catch (err) {
          logger.debug('Graceful stop failed, falling back to SIGKILL', {
            pid: info.pid,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // Force kill (SIGKILL)
      try {
        process.kill(info.pid, 'SIGKILL')
        logger.info('Killed daemon', { pid: info.pid, projectDir: info.projectDir })
        results.push({ projectDir: info.projectDir, pid: info.pid, killed: true })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.warn('Failed to kill daemon', { pid: info.pid, error: errorMsg })
        results.push({ projectDir: info.projectDir, pid: info.pid, killed: false, error: errorMsg })
      }

      // Clean up user-level PID file
      await fs.unlink(pidPath).catch(() => {})

      // Also try to clean up project-level files
      const projectFiles = [getPidPath(info.projectDir), getSocketPath(info.projectDir), getTokenPath(info.projectDir)]
      for (const file of projectFiles) {
        await fs.unlink(file).catch(() => {})
      }
    } catch (err) {
      logger.warn('Invalid PID file, removing', { pidFile, error: err instanceof Error ? err.message : String(err) })
      await fs.unlink(pidPath).catch(() => {})
    }
  }

  return results
}
```

Update the export in `packages/sidekick-core/src/index.ts` to include `KillAllOptions`:
```typescript
export { killAllDaemons, DaemonClient, type KillResult, type KillAllOptions, type UserPidInfo } from './daemon-client'
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern daemon-client --exclude '**/{ipc,ipc-service}.test.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-core/src/daemon-client.ts packages/sidekick-core/src/index.ts packages/sidekick-core/src/__tests__/daemon-client.test.ts
git commit -m "feat(core): add graceful shutdown option to killAllDaemons()"
```

---

### Task 4: Wire graceful killAllDaemons into uninstall user-scope path

**Files:**
- Test: `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts`

**Step 1: Update the killAllTrackedDaemons call to pass graceful option**

In `packages/sidekick-cli/src/commands/uninstall.ts`, update the `killAllTrackedDaemons` helper:

```typescript
const results: KillResult[] = await killAllDaemons(logger, { graceful: true, gracefulTimeoutMs: 3000 })
```

**Step 2: Run all uninstall tests**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern uninstall`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts
git commit -m "feat(uninstall): use graceful shutdown for user-scope killAllDaemons"
```

---

### Task 5: Build and typecheck

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run full test suite (excluding IPC/LLM)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' && pnpm --filter @sidekick/cli test`
Expected: PASS

Note: daemon-client tests excluded from @sidekick/core because IPC tests fail in sandbox. Run the uninstall and daemon-client tests individually as done in prior tasks.

**Step 4: Commit (if any fixes needed)**

---

### Task 6: Close bead and sync

**Step 1: Close the bead**

Run: `bd close b6nz --reason="Uninstall now kills tracked processes: graceful IPC stop (3s timeout) then SIGKILL fallback. Project uninstall kills project daemon. User uninstall kills all tracked daemons via killAllDaemons()."`

**Step 2: Sync**

Run: `bd sync`
