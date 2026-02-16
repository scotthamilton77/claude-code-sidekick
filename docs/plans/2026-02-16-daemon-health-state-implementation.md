# Daemon Health State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate noisy "token not found" warnings by tracking daemon health as persistent state and skipping IPC when daemon is unavailable.

**Architecture:** New Zod-validated state file `.sidekick/state/daemon-health.json` tracks daemon availability. CLI writes on transitions (log-once), daemon self-reports healthy on start, statusline reads for degraded display. `handleHookCommand` skips IPC when daemon unavailable.

**Tech Stack:** TypeScript, Zod, Vitest, StateService (atomic writes)

---

### Task 1: Add DaemonHealth schema to @sidekick/types

**Files:**
- Modify: `packages/types/src/setup-status.ts` (append schema, co-located with other health schemas)
- Modify: `packages/types/src/index.ts` (re-export)

**Step 1: Add schema to types**

In `packages/types/src/setup-status.ts`, append at end of file:

```typescript
/**
 * Daemon runtime health status.
 * Tracks whether the daemon process started successfully.
 * Written by CLI on state transitions, read by statusline.
 */
export const DaemonHealthStatusSchema = z.enum(['unknown', 'healthy', 'failed'])
export type DaemonHealthStatus = z.infer<typeof DaemonHealthStatusSchema>

export const DaemonHealthSchema = z.object({
  status: DaemonHealthStatusSchema,
  lastCheckedAt: z.string(),
  error: z.string().optional(),
})
export type DaemonHealth = z.infer<typeof DaemonHealthSchema>
```

**Step 2: Re-export from index**

In `packages/types/src/index.ts`, add to the existing `setup-status.ts` re-exports:

```typescript
export { DaemonHealthStatusSchema, DaemonHealthSchema } from './setup-status.js'
export type { DaemonHealthStatus, DaemonHealth } from './setup-status.js'
```

**Step 3: Verify typecheck**

Run: `pnpm --filter @sidekick/types typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/types/src/setup-status.ts packages/types/src/index.ts
git commit -m "feat(types): add DaemonHealth schema for runtime health tracking"
```

---

### Task 2: Add DaemonHealth typed accessor to @sidekick/core

The daemon and statusline use typed state accessors (`StateDescriptor` pattern) to read/write state. We need a new descriptor for daemon-health.json.

**Files:**
- Modify: `packages/sidekick-core/src/state/typed-accessor.ts` (add descriptor)
- Modify: `packages/sidekick-core/src/state/index.ts` (re-export)
- Modify: `packages/sidekick-core/src/index.ts` (re-export if needed)

**Step 1: Find existing descriptor pattern**

Look at existing descriptors in `packages/sidekick-core/src/state/typed-accessor.ts` for the pattern (e.g., `TranscriptMetricsDescriptor`, `DaemonLogMetricsDescriptor`). They define `{ filename, schema, defaultValue }`.

**Step 2: Add DaemonHealthDescriptor**

```typescript
import { DaemonHealthSchema } from '@sidekick/types'
import type { DaemonHealth } from '@sidekick/types'

export const DaemonHealthDescriptor: GlobalStateDescriptor<DaemonHealth> = {
  filename: 'daemon-health.json',
  schema: DaemonHealthSchema,
  defaultValue: { status: 'unknown', lastCheckedAt: new Date(0).toISOString() },
}
```

This is a **global** state descriptor (not session-scoped) since daemon health is project-wide.

**Step 3: Re-export from state/index.ts and core/index.ts**

Ensure `DaemonHealthDescriptor` is exported from the package.

**Step 4: Verify typecheck**

Run: `pnpm --filter @sidekick/core typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-core/src/state/typed-accessor.ts packages/sidekick-core/src/state/index.ts packages/sidekick-core/src/index.ts
git commit -m "feat(core): add DaemonHealth typed state accessor"
```

---

### Task 3: Write daemon health utility functions for CLI

The CLI doesn't have StateService (that's daemon-only with caching). The CLI needs lightweight read/write functions for daemon-health.json that use direct fs operations.

**Files:**
- Create: `packages/sidekick-core/src/daemon-health.ts`
- Create: `packages/sidekick-core/src/__tests__/daemon-health.test.ts`
- Modify: `packages/sidekick-core/src/index.ts` (re-export)

**Step 1: Write the failing tests**

```typescript
// packages/sidekick-core/src/__tests__/daemon-health.test.ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { readDaemonHealth, writeDaemonHealth, updateDaemonHealth } from '../daemon-health.js'
import type { Logger } from '@sidekick/types'

const TEST_DIR = '/tmp/test-daemon-health-' + process.pid

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis() as any,
  } as Logger
}

describe('daemon-health', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(TEST_DIR, '.sidekick', 'state'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('readDaemonHealth', () => {
    test('returns unknown when file does not exist', async () => {
      const result = await readDaemonHealth(TEST_DIR)
      expect(result.status).toBe('unknown')
    })

    test('reads existing health file', async () => {
      const health = { status: 'healthy', lastCheckedAt: new Date().toISOString() }
      await fs.writeFile(
        path.join(TEST_DIR, '.sidekick', 'state', 'daemon-health.json'),
        JSON.stringify(health)
      )
      const result = await readDaemonHealth(TEST_DIR)
      expect(result.status).toBe('healthy')
    })

    test('returns unknown on corrupt file', async () => {
      await fs.writeFile(
        path.join(TEST_DIR, '.sidekick', 'state', 'daemon-health.json'),
        'not json'
      )
      const result = await readDaemonHealth(TEST_DIR)
      expect(result.status).toBe('unknown')
    })
  })

  describe('updateDaemonHealth', () => {
    test('writes healthy and logs INFO on unknown -> healthy transition', async () => {
      const logger = createMockLogger()
      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      expect(changed).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Daemon health changed'),
        expect.objectContaining({ from: 'unknown', to: 'healthy' })
      )
      const result = await readDaemonHealth(TEST_DIR)
      expect(result.status).toBe('healthy')
    })

    test('writes failed with error and logs ERROR on unknown -> failed transition', async () => {
      const logger = createMockLogger()
      const changed = await updateDaemonHealth(TEST_DIR, 'failed', logger, 'Connection refused')
      expect(changed).toBe(true)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Daemon health changed'),
        expect.objectContaining({ from: 'unknown', to: 'failed', error: 'Connection refused' })
      )
    })

    test('does not write or log when status unchanged (healthy -> healthy)', async () => {
      const logger = createMockLogger()
      await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      vi.mocked(logger.info).mockClear()

      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      expect(changed).toBe(false)
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })

    test('does not write or log when status unchanged (failed -> failed)', async () => {
      const logger = createMockLogger()
      await updateDaemonHealth(TEST_DIR, 'failed', logger, 'err1')
      vi.mocked(logger.error).mockClear()

      const changed = await updateDaemonHealth(TEST_DIR, 'failed', logger, 'err2')
      expect(changed).toBe(false)
      expect(logger.error).not.toHaveBeenCalled()
    })

    test('logs INFO on failed -> healthy recovery', async () => {
      const logger = createMockLogger()
      await updateDaemonHealth(TEST_DIR, 'failed', logger, 'err')
      vi.mocked(logger.info).mockClear()
      vi.mocked(logger.error).mockClear()

      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      expect(changed).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Daemon health changed'),
        expect.objectContaining({ from: 'failed', to: 'healthy' })
      )
    })

    test('survives write failure without throwing', async () => {
      const logger = createMockLogger()
      // Make state dir read-only to trigger write failure
      await fs.chmod(path.join(TEST_DIR, '.sidekick', 'state'), 0o444)

      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      expect(changed).toBe(false)
      expect(logger.warn).toHaveBeenCalled()

      // Restore permissions for cleanup
      await fs.chmod(path.join(TEST_DIR, '.sidekick', 'state'), 0o755)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run daemon-health`
Expected: FAIL (module not found)

**Step 3: Implement daemon-health.ts**

```typescript
// packages/sidekick-core/src/daemon-health.ts
/**
 * Daemon health state utilities for CLI.
 *
 * Lightweight read/write for .sidekick/state/daemon-health.json.
 * Used by hook CLI to track daemon availability with log-once semantics.
 *
 * @see docs/plans/2026-02-16-daemon-health-state-design.md
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DaemonHealthSchema } from '@sidekick/types'
import type { DaemonHealth, DaemonHealthStatus, Logger } from '@sidekick/types'

const STATE_FILENAME = 'daemon-health.json'

function healthPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'state', STATE_FILENAME)
}

const DEFAULT_HEALTH: DaemonHealth = {
  status: 'unknown',
  lastCheckedAt: new Date(0).toISOString(),
}

/**
 * Read current daemon health state.
 * Returns default (unknown) on missing or corrupt file.
 */
export async function readDaemonHealth(projectDir: string): Promise<DaemonHealth> {
  try {
    const content = await fs.readFile(healthPath(projectDir), 'utf-8')
    const parsed = DaemonHealthSchema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : DEFAULT_HEALTH
  } catch {
    return DEFAULT_HEALTH
  }
}

/**
 * Write daemon health state atomically.
 */
async function writeDaemonHealth(projectDir: string, health: DaemonHealth): Promise<void> {
  const filePath = healthPath(projectDir)
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.${Date.now()}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(health, null, 2), 'utf-8')
  await fs.rename(tmpPath, filePath)
}

/**
 * Update daemon health with log-once transition semantics.
 *
 * Only writes and logs when status actually changes.
 * Returns true if state changed, false if unchanged or on write failure.
 */
export async function updateDaemonHealth(
  projectDir: string,
  newStatus: DaemonHealthStatus,
  logger: Logger,
  error?: string,
): Promise<boolean> {
  const current = await readDaemonHealth(projectDir)

  if (current.status === newStatus) {
    return false
  }

  const health: DaemonHealth = {
    status: newStatus,
    lastCheckedAt: new Date().toISOString(),
    ...(error && { error }),
  }

  try {
    await writeDaemonHealth(projectDir, health)
  } catch (err) {
    logger.warn('Failed to write daemon health state', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  const logContext = { from: current.status, to: newStatus, ...(error && { error }) }
  if (newStatus === 'failed') {
    logger.error('Daemon health changed: daemon failed to start', logContext)
  } else {
    logger.info('Daemon health changed', logContext)
  }

  return true
}

export { writeDaemonHealth }
```

**Step 4: Export from index**

Add to `packages/sidekick-core/src/index.ts`:

```typescript
export { readDaemonHealth, updateDaemonHealth, writeDaemonHealth } from './daemon-health.js'
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run daemon-health`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/sidekick-core/src/daemon-health.ts packages/sidekick-core/src/__tests__/daemon-health.test.ts packages/sidekick-core/src/index.ts
git commit -m "feat(core): daemon health read/write utilities with log-once transitions"
```

---

### Task 4: Thread daemonAvailable through hook command pipeline

**Files:**
- Modify: `packages/sidekick-cli/src/commands/hook.ts:293-299` (add field to HandleHookOptions)
- Modify: `packages/sidekick-cli/src/commands/hook.ts:354-362` (gate IPC on daemonAvailable)
- Modify: `packages/sidekick-cli/src/commands/hook-command.ts:463` (capture return value)
- Modify: `packages/sidekick-cli/src/commands/hook-command.ts:491` (pass through options)
- Modify: `packages/sidekick-cli/src/commands/__tests__/hook.test.ts:417` (update baseOptions)

**Step 1: Write failing test for daemonAvailable=false skipping IPC**

In `packages/sidekick-cli/src/commands/__tests__/hook.test.ts`, add test:

```typescript
test('skips IPC send when daemonAvailable is false', async () => {
  const stdout = new CollectingWritable()
  const options = { ...baseOptions, daemonAvailable: false }
  const result = await handleHookCommand('SessionStart', options, mockLogger, stdout)

  expect(result.exitCode).toBe(0)
  // IPC send should NOT have been called
  expect(mockSend).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/cli test -- --run hook.test`
Expected: FAIL (daemonAvailable not recognized / send still called)

**Step 3: Add daemonAvailable to HandleHookOptions**

In `packages/sidekick-cli/src/commands/hook.ts:293`:

```typescript
export interface HandleHookOptions {
  projectRoot: string
  sessionId: string
  hookInput: ParsedHookInput
  correlationId: string
  runtime: RuntimeShell
  /** Whether the daemon is available for IPC. When false, IPC send is skipped. */
  daemonAvailable?: boolean
}
```

**Step 4: Gate IPC send on daemonAvailable**

In `packages/sidekick-cli/src/commands/hook.ts`, around line 354-362, change:

```typescript
// Before:
const ipcService = new IpcService(projectRoot, logger)
const daemonResponse = await ipcService.send<HookResponse>('hook.invoke', {
  hook: hookName,
  event,
})

// After:
let daemonResponse: HookResponse | null = null
if (options.daemonAvailable !== false) {
  const ipcService = new IpcService(projectRoot, logger)
  try {
    daemonResponse = await ipcService.send<HookResponse>('hook.invoke', {
      hook: hookName,
      event,
    })
  } finally {
    ipcService.close()
  }
} else {
  logger.debug('Skipping IPC send - daemon not available', { hook: hookName })
}
```

Note: Check if the existing code already has a try/finally for ipcService.close(). Preserve existing error handling structure.

**Step 5: Capture return value in hook-command.ts**

In `packages/sidekick-cli/src/commands/hook-command.ts:463`:

```typescript
// Before:
await ensureDaemonForHook(projectRoot, logger)

// After:
const daemonAvailable = await ensureDaemonForHook(projectRoot, logger)
```

At line ~491, pass it through:

```typescript
// Before:
await handleHookCommand(
  hookName,
  { projectRoot, sessionId: hookInput.sessionId, hookInput, correlationId, runtime },
  logger,
  captureStream
)

// After:
await handleHookCommand(
  hookName,
  { projectRoot, sessionId: hookInput.sessionId, hookInput, correlationId, runtime, daemonAvailable },
  logger,
  captureStream
)
```

**Step 6: Update existing test baseOptions**

In `packages/sidekick-cli/src/commands/__tests__/hook.test.ts:417`, existing tests should continue to work since `daemonAvailable` is optional (defaults to undefined which is truthy-ish via `!== false`).

**Step 7: Run tests**

Run: `pnpm --filter @sidekick/cli test -- --run hook.test`
Expected: PASS (all existing + new test)

**Step 8: Commit**

```bash
git add packages/sidekick-cli/src/commands/hook.ts packages/sidekick-cli/src/commands/hook-command.ts packages/sidekick-cli/src/commands/__tests__/hook.test.ts
git commit -m "fix(hooks): skip IPC when daemon unavailable, thread daemonAvailable through pipeline"
```

---

### Task 5: Update ensureDaemonForHook to write health transitions

**Files:**
- Modify: `packages/sidekick-cli/src/commands/hook-command.ts:332-367` (add health writes)
- Modify: `packages/sidekick-cli/src/commands/__tests__/hook-command.test.ts` (add tests)

**Step 1: Write failing test**

In hook-command test file, add tests for health state updates. This may require mocking the `updateDaemonHealth` function from `@sidekick/core`. Check the existing mock structure in the test file.

Test cases:
- `ensureDaemonForHook` success → calls `updateDaemonHealth(projectRoot, 'healthy', logger)`
- `ensureDaemonForHook` failure → calls `updateDaemonHealth(projectRoot, 'failed', logger, errorMessage)`

**Step 2: Implement health writes in ensureDaemonForHook**

In `packages/sidekick-cli/src/commands/hook-command.ts`, import:

```typescript
import { updateDaemonHealth } from '@sidekick/core'
```

Modify `ensureDaemonForHook` (line 332-367):

```typescript
async function ensureDaemonForHook(projectRoot: string, logger: Logger): Promise<boolean> {
  if (isInSandbox()) {
    logger.debug('Skipping daemon start — sandbox mode')
    return false
  }

  try {
    const setupService = new SetupStatusService(projectRoot)
    const setupState = await setupService.getSetupState()

    if (setupState !== 'healthy') {
      logger.debug('Skipping daemon start - setup not healthy', { setupState })
      return false
    }
  } catch (err) {
    logger.warn('Failed to check setup status for daemon start, proceeding anyway', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    const daemonClient = new DaemonClient(projectRoot, logger)
    await daemonClient.start()
    logger.debug('Daemon started for hook execution')
    await updateDaemonHealth(projectRoot, 'healthy', logger)
    return true
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await updateDaemonHealth(projectRoot, 'failed', logger, errorMessage)
    return false
  }
}
```

Note: The old `logger.warn('Failed to start daemon...')` is removed — `updateDaemonHealth` handles logging with proper transition semantics.

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/cli test -- --run hook-command`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/commands/hook-command.ts packages/sidekick-cli/src/commands/__tests__/hook-command.test.ts
git commit -m "fix(hooks): write daemon health on start success/failure with log-once transitions"
```

---

### Task 6: Daemon self-reports healthy on startup

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts:332` (write healthy after successful start)

**Step 1: Add health write after successful start**

In `packages/sidekick-daemon/src/daemon.ts`, after line 332 ("Daemon started successfully"):

```typescript
// 12. Report healthy status (clears any previous failed state)
try {
  const healthPath = this.stateService.globalStatePath('daemon-health.json')
  await this.stateService.write(healthPath, {
    status: 'healthy',
    lastCheckedAt: new Date().toISOString(),
  }, DaemonHealthSchema)
} catch (err) {
  this.logger.warn('Failed to write daemon health state', {
    error: err instanceof Error ? err.message : String(err),
  })
}
```

Import `DaemonHealthSchema` from `@sidekick/types` at top of file.

Note: Check if `this.stateService.globalStatePath()` exists or if the equivalent method is named differently. The daemon already uses `this.stateService` for log metrics — follow the same pattern (see `daemon.ts:1558` for reference).

**Step 2: Verify typecheck**

Run: `pnpm --filter @sidekick/daemon typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/sidekick-daemon/src/daemon.ts
git commit -m "feat(daemon): self-report healthy status on successful startup"
```

---

### Task 7: Statusline reads daemon health for degraded display

**Files:**
- Modify: `packages/feature-statusline/src/statusline-service.ts:436-476` (add daemon health check)
- Modify: `packages/feature-statusline/src/__tests__/statusline.test.ts` (add test)

**Step 1: Write failing test**

Add test case: when setup is healthy but daemon health is `failed`, statusline shows daemon degraded warning.

**Step 2: Add daemon health check to checkSetupStatus**

In `packages/feature-statusline/src/statusline-service.ts`, after the existing `checkSetupStatus()` method returns `healthy` (the default case at line 473-474), add a daemon health check:

```typescript
case 'healthy': {
  // Setup is healthy — check daemon runtime health
  const daemonHealth = await readDaemonHealth(this.projectDir)
  if (daemonHealth.status === 'failed') {
    return {
      warning: `Daemon not running${daemonHealth.error ? ': ' + daemonHealth.error : ''}. Sidekick features limited.`,
      state: 'healthy', // Setup IS healthy, daemon is the problem
    }
  }
  return { warning: '', state: 'healthy' }
}
```

This requires:
- Import `readDaemonHealth` from `@sidekick/core`
- The StatuslineService needs access to `projectDir` (check constructor — it likely already has it via config or state reader)
- The warning message appears in yellow (existing ANSI color for warnings), same as other degraded states

Important: The `checkSetupStatus` return type uses `SetupState` for the `state` field. We're returning `state: 'healthy'` because setup IS healthy. The `warning` field being non-empty triggers the `setup_warning` display mode. Check if this logic works correctly — the render method at line 500 checks `setupCheck.state !== 'healthy'` to decide whether to show warning. If this check prevents our daemon warning from showing, we need to adjust the condition.

Alternative approach if the above doesn't work: Return a different state value, or add the daemon check inside the `render()` method after the setup check passes, before fetching full statusline data.

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/feature-statusline/src/statusline-service.ts packages/feature-statusline/src/__tests__/statusline.test.ts
git commit -m "feat(statusline): show degraded warning when daemon health is failed"
```

---

### Task 8: Build verification and cleanup

**Step 1: Full build**

Run: `pnpm build`
Expected: PASS

**Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS (excluding IPC tests in sandbox)

If sandbox blocks IPC tests:
Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`

**Step 4: Verify no leftover temp files**

Check for any `.tmp` files or test artifacts.

**Step 5: Final commit if any cleanup needed**

---

### Task 9: Close bead

Run: `bd close sidekick-kt0 --reason="Daemon health state tracking eliminates token-not-found warning spam"`
Run: `bd sync`
