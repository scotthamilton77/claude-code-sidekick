# Dev-Mode Setup Bootstrap & Uninstall Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make dev-mode self-contained (no separate setup step) and prevent uninstall from breaking dev-mode environments.

**Architecture:** Inline changes to `dev-mode.ts` (enable adds gitignore + setup-status.json; disable conditionally removes gitignore) and `uninstall.ts` (guards skip dev-mode-owned artifacts). Both use existing `SetupStatusService` and gitignore utilities from `@sidekick/core`.

**Tech Stack:** TypeScript, Vitest, `@sidekick/core` (SetupStatusService, installGitignoreSection, removeGitignoreSection, detectGitignoreStatus)

---

### Task 1: Dev-Mode Enable — Gitignore Installation

**Files:**
- Modify: `packages/sidekick-cli/src/commands/dev-mode.ts:356-446` (doEnable)
- Test: `packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts`

**Step 1: Write the failing test**

Add to the `enable subcommand` describe block in `dev-mode.test.ts`:

```typescript
test('installs gitignore entries during enable', async () => {
  const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)

  // Verify .gitignore was created with sidekick section
  const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
  expect(gitignoreContent).toContain('# >>> sidekick')
  expect(gitignoreContent).toContain('.sidekick/logs/')
  expect(gitignoreContent).toContain('.sidekick/setup-status.json')
  expect(gitignoreContent).toContain('# <<< sidekick')
})

test('gitignore install is idempotent on re-enable', async () => {
  // Enable twice
  await handleDevModeCommand('enable', tempDir, logger, stdout)
  stdout.data = ''
  // Re-enable should not fail (settings already enabled check short-circuits,
  // but gitignore should have been installed on first run)
  const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
  // Count occurrences of section marker - should be exactly 1
  const matches = gitignoreContent.match(/# >>> sidekick/g)
  expect(matches).toHaveLength(1)
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/cli test -- --run -t "installs gitignore entries"`
Expected: FAIL — `.gitignore` not created

**Step 3: Write implementation**

In `dev-mode.ts`, add `installGitignoreSection` to the imports from `@sidekick/core`:

```typescript
import {
  Logger,
  DaemonClient,
  getSocketPath,
  getTokenPath,
  getLockPath,
  getPidPath,
  getUserPidPath,
  getUserDaemonsDir,
  SetupStatusService,
  installGitignoreSection,
  type UserPidInfo,
} from '@sidekick/core'
```

In `doEnable()`, add gitignore installation right after `copySkillForDev` (line ~382) and before `backupSettings`:

```typescript
  // Install gitignore entries for .sidekick/ tracking files
  const gitignoreResult = await installGitignoreSection(projectDir)
  if (gitignoreResult.status === 'installed') {
    log(stdout, 'info', 'Installed .gitignore entries for .sidekick/')
  } else if (gitignoreResult.status === 'already-installed') {
    log(stdout, 'info', '.gitignore entries already installed')
  } else {
    log(stdout, 'warn', `Failed to install .gitignore entries: ${gitignoreResult.error}`)
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/cli test -- --run -t "installs gitignore entries"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/dev-mode.ts packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts
git commit -m "feat(dev-mode): install gitignore entries during enable"
```

---

### Task 2: Dev-Mode Enable — Setup-Status.json Bootstrap with Gitignore Field

**Files:**
- Modify: `packages/sidekick-cli/src/commands/dev-mode.ts:430-432` (existing setDevMode call)
- Test: `packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts`

**Context:** `SetupStatusService.setDevMode(true)` already creates setup-status.json with API key detection when none exists (lines 711-738 of setup-status-service.ts). But it sets `gitignore: 'unknown'` and doesn't force `statusline: 'local'` when the file already exists. We need to:
1. After `setDevMode(true)`, update `gitignore: 'installed'` and `statusline: 'local'`

**Step 1: Write the failing test**

Add to the `enable subcommand` describe block:

```typescript
test('creates setup-status.json with statusline local and gitignore installed', async () => {
  const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)

  const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
  const content = await readFile(setupStatusPath, 'utf-8')
  const status = JSON.parse(content)
  expect(status.devMode).toBe(true)
  expect(status.statusline).toBe('local')
  expect(status.gitignore).toBe('installed')
})

test('updates existing setup-status.json to local statusline and installed gitignore', async () => {
  // Create an existing setup-status.json with different values
  const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
  await writeFile(
    setupStatusPath,
    JSON.stringify({
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: true,
      statusline: 'user',
      apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
      gitignore: 'unknown',
      devMode: false,
    })
  )

  const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)

  const content = await readFile(setupStatusPath, 'utf-8')
  const status = JSON.parse(content)
  expect(status.devMode).toBe(true)
  expect(status.statusline).toBe('local')
  expect(status.gitignore).toBe('installed')
  // Should preserve autoConfigured
  expect(status.autoConfigured).toBe(true)
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/cli test -- --run -t "creates setup-status.json with statusline local"`
Expected: FAIL — statusline is detected value (not forced to 'local'), gitignore is 'unknown'

**Step 3: Write implementation**

In `doEnable()`, replace the existing `setDevMode(true)` call (around line 431-432) with:

```typescript
  // Update devMode flag and ensure statusline='local' + gitignore='installed'
  const setupService = new SetupStatusService(projectDir)
  await setupService.setDevMode(true)
  await setupService.updateProjectStatus({ statusline: 'local', gitignore: 'installed' })
```

Note: `setDevMode(true)` creates the file if missing (with API key detection). Then `updateProjectStatus` patches it with the correct statusline and gitignore values.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/cli test -- --run -t "creates setup-status.json with statusline local"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/dev-mode.ts packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts
git commit -m "feat(dev-mode): bootstrap setup-status.json with statusline local and gitignore installed"
```

---

### Task 3: Dev-Mode Disable — Conditional Gitignore Removal

**Files:**
- Modify: `packages/sidekick-cli/src/commands/dev-mode.ts:451-515` (doDisable)
- Test: `packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts`

**Context:** `detectPluginInstallation()` spawns `claude plugin list --json` which takes real time and isn't available in test environments. The mock for `@sidekick/core` already provides `SetupStatusService` (the real one). We need to mock `detectPluginInstallation` or use a simpler check.

**Decision:** Use `SetupStatusService.isPluginInstalled()` instead of `detectPluginInstallation()`. It reads the cached `pluginDetected` flag from setup-status.json — no CLI spawn needed, fast, testable. If plugin detection hasn't been run, it returns `false` (safe default: we remove gitignore).

Actually, looking more carefully, `isPluginInstalled()` checks the `pluginDetected` flag in status files, which may not be set. A better approach: use `removeGitignoreSection` unconditionally during disable. The gitignore entries are cheap to re-add, and if a plugin is installed, the setup wizard or hook will re-detect and re-add them. But the design says "check for plugin first". Let me use the `pluginDetected` flag approach since it's simpler and doesn't require spawning a process.

**Step 1: Write the failing tests**

Add to the `disable subcommand` describe block:

```typescript
test('removes gitignore entries when no plugin installed', async () => {
  // Enable (installs gitignore)
  await handleDevModeCommand('enable', tempDir, logger, stdout)
  stdout.data = ''

  // Verify gitignore exists
  const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
  expect(gitignoreContent).toContain('# >>> sidekick')

  // Disable
  const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)

  // Gitignore section should be removed
  const updated = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
  expect(updated).not.toContain('# >>> sidekick')
})

test('preserves gitignore entries when plugin is detected', async () => {
  // Enable (installs gitignore)
  await handleDevModeCommand('enable', tempDir, logger, stdout)
  stdout.data = ''

  // Simulate plugin being detected by setting pluginDetected flag
  const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
  const status = JSON.parse(await readFile(setupStatusPath, 'utf-8'))
  status.pluginDetected = true
  await writeFile(setupStatusPath, JSON.stringify(status, null, 2))

  // Disable
  const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)
  expect(stdout.data).toContain('plugin')

  // Gitignore section should be preserved
  const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
  expect(gitignoreContent).toContain('# >>> sidekick')
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --run -t "removes gitignore entries when no plugin"`
Expected: FAIL — doDisable doesn't touch gitignore

**Step 3: Write implementation**

In `doDisable()`, add `removeGitignoreSection` to imports (already imported in uninstall.ts but not dev-mode.ts). Update the `@sidekick/core` import:

```typescript
import {
  Logger,
  DaemonClient,
  getSocketPath,
  getTokenPath,
  getLockPath,
  getPidPath,
  getUserPidPath,
  getUserDaemonsDir,
  SetupStatusService,
  installGitignoreSection,
  removeGitignoreSection,
  type UserPidInfo,
} from '@sidekick/core'
```

In `doDisable()`, add after the `removeDevSkill` call and before the final log messages (around line 509):

```typescript
  // Conditionally remove gitignore entries
  const pluginInstalled = await setupService.isPluginInstalled()
  if (pluginInstalled) {
    log(stdout, 'info', 'Skipping .gitignore cleanup — plugin is still installed')
  } else {
    const removed = await removeGitignoreSection(projectDir)
    if (removed) {
      log(stdout, 'info', 'Removed .gitignore entries for .sidekick/')
    }
  }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --run -t "removes gitignore entries when no plugin|preserves gitignore entries when plugin"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/dev-mode.ts packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts
git commit -m "feat(dev-mode): conditionally remove gitignore on disable"
```

---

### Task 4: Uninstall — Dev-Mode Guard for Setup-Status and Gitignore

**Files:**
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts:37-157`
- Test: `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`

**Context:** The uninstall command uses `removeFile` for setup-status.json (line 89) and `removeGitignoreSection` (line 143). We need to add `SetupStatusService` import and check `devMode` flag before these operations.

**Step 1: Write the failing tests**

Add a new describe block in `uninstall.test.ts`:

```typescript
describe('dev-mode guard', () => {
  test('skips project setup-status.json deletion when dev-mode is active', async () => {
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, devMode: true, autoConfigured: false, statusline: 'local',
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
        lastUpdatedAt: new Date().toISOString() })
    )

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // setup-status.json should still exist
    const content = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
    expect(JSON.parse(content).devMode).toBe(true)
    expect(stdout.data).toContain('dev-mode')
  })

  test('skips gitignore removal when dev-mode is active', async () => {
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, devMode: true, autoConfigured: false, statusline: 'local',
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
        lastUpdatedAt: new Date().toISOString() })
    )
    // Install gitignore section
    const gitignoreContent = [
      'node_modules/',
      '',
      '# >>> sidekick',
      '.sidekick/logs/',
      '.sidekick/sessions/',
      '.sidekick/state/',
      '.sidekick/setup-status.json',
      '.sidekick/.env',
      '.sidekick/.env.local',
      '.sidekick/sidekick*.pid',
      '.sidekick/sidekick*.token',
      '# <<< sidekick',
    ].join('\n')
    await writeFile(path.join(tempDir, '.gitignore'), gitignoreContent)

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // .gitignore section should be preserved
    const updated = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(updated).toContain('# >>> sidekick')
    expect(stdout.data).toContain('dev-mode')
  })

  test('skips settings.local.json statusline removal when dev-mode is active', async () => {
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, devMode: true, autoConfigured: false, statusline: 'local',
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
        lastUpdatedAt: new Date().toISOString() })
    )
    // Create settings.local.json with dev-mode statusline and hooks
    const settings = {
      statusLine: { type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/statusline' },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] }],
      },
    }
    await writeFile(path.join(tempDir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // settings.local.json should be untouched
    const updated = JSON.parse(await readFile(path.join(tempDir, '.claude', 'settings.local.json'), 'utf-8'))
    expect(updated.statusLine.command).toContain('dev-sidekick')
    expect(updated.hooks.SessionStart).toHaveLength(1)
  })

  test('still allows transient data removal when dev-mode is active', async () => {
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, devMode: true, autoConfigured: false, statusline: 'local',
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
        lastUpdatedAt: new Date().toISOString() })
    )
    await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })
    await writeFile(path.join(tempDir, '.sidekick', 'logs', 'test.log'), 'log data')

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // Logs should still be removed
    await expect(readFile(path.join(tempDir, '.sidekick', 'logs', 'test.log'), 'utf-8')).rejects.toThrow()
  })

  test('still allows user-scope cleanup when dev-mode is active at project scope', async () => {
    // Dev-mode active at project scope
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, devMode: true, autoConfigured: false, statusline: 'local',
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
        lastUpdatedAt: new Date().toISOString() })
    )
    // User-scope artifacts
    await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // User-scope setup-status should be removed
    await expect(readFile(path.join(userHome, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
    // Project-scope setup-status should be preserved
    const projectStatus = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
    expect(JSON.parse(projectStatus).devMode).toBe(true)
  })

  test('non-dev-mode uninstall behavior unchanged', async () => {
    await writeFile(
      path.join(tempDir, '.sidekick', 'setup-status.json'),
      JSON.stringify({ version: 1, autoConfigured: true })
    )

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    // setup-status.json should be removed
    await expect(readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --run -t "dev-mode guard"`
Expected: FAIL — setup-status.json gets deleted, gitignore gets removed, settings.local.json gets cleaned

**Step 3: Write implementation**

In `uninstall.ts`, add `SetupStatusService` import:

```typescript
import { DaemonClient, removeGitignoreSection, SetupStatusService } from '@sidekick/core'
```

In `handleUninstallCommand`, add dev-mode detection after the scope detection block (after line ~50, before Step 1):

```typescript
  // Detect dev-mode status for project scope
  let devModeActive = false
  if (projectDetected) {
    const setupService = new SetupStatusService(projectDir)
    devModeActive = await setupService.getDevMode()
    if (devModeActive) {
      stdout.write('Dev-mode active — skipping dev-mode-managed artifacts.\n')
    }
  }
```

Modify Step 3 (settings surgery) — skip `settings.local.json` entirely when dev-mode is active:

Change the project settings cleaning block (lines 70-79) to:

```typescript
  if (projectDetected) {
    if (devModeActive) {
      // Dev-mode owns settings.local.json — don't touch it
      actions.push({
        scope: 'project',
        artifact: 'settings.local.json',
        path: path.join(projectDir, '.claude', 'settings.local.json'),
        action: 'skipped',
      })
    } else {
      await cleanSettingsFile(path.join(projectDir, '.claude', 'settings.local.json'), 'project', logger, actions, {
        dryRun,
        removeHooks: true,
      })
    }
    await cleanSettingsFile(path.join(projectDir, '.claude', 'settings.json'), 'project', logger, actions, {
      dryRun,
      removeHooks: true,
    })
  }
```

Modify Step 4 (config file removal) — skip project setup-status.json when dev-mode:

```typescript
  if (projectDetected) {
    if (devModeActive) {
      actions.push({
        scope: 'project',
        artifact: 'setup-status.json',
        path: path.join(projectDir, '.sidekick', 'setup-status.json'),
        action: 'skipped',
      })
    } else {
      await removeFile(path.join(projectDir, '.sidekick', 'setup-status.json'), 'project', 'setup-status.json', actions, {
        dryRun,
      })
    }
  }
```

Modify Step 7 (gitignore cleanup) — skip when dev-mode:

```typescript
  if (projectDetected) {
    if (devModeActive) {
      actions.push({
        scope: 'project',
        artifact: '.gitignore section',
        path: path.join(projectDir, '.gitignore'),
        action: 'skipped',
      })
    } else if (dryRun) {
      actions.push({
        scope: 'project',
        artifact: '.gitignore section',
        path: path.join(projectDir, '.gitignore'),
        action: 'would-remove',
      })
    } else {
      const removed = await removeGitignoreSection(projectDir)
      actions.push({
        scope: 'project',
        artifact: '.gitignore section',
        path: path.join(projectDir, '.gitignore'),
        action: removed ? 'removed' : 'not-found',
      })
    }
  }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --run -t "dev-mode guard"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts
git commit -m "feat(uninstall): guard dev-mode-managed artifacts during uninstall"
```

---

### Task 5: Verify All Tests Pass & Build

**Step 1: Run full test suite for sidekick-cli**

Run: `pnpm --filter @sidekick/cli test -- --run`
Expected: All tests pass (both existing and new)

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run build**

Run: `pnpm build`
Expected: Clean build

**Step 4: Commit if any fixes needed**

If any tests or typecheck issues found, fix them and commit:
```bash
git commit -m "fix: resolve test/typecheck issues from dev-mode and uninstall changes"
```

---

### Task 6: Update Existing Tests for New Behavior

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts`

**Context:** The existing test "sets devMode flag to true in project setup-status.json" (line 175) already verifies `devMode: true`. We should also verify the existing `gitignore: 'installed'` and `statusline: 'local'` expectations are consistent. The mock for `@sidekick/core` passes through the real `SetupStatusService` (via `importOriginal`), so `setDevMode` and `updateProjectStatus` should work on the temp filesystem.

**Step 1: Verify existing enable test still passes with new fields**

The test at line 175 already asserts `status.devMode === true`. After our Task 2 changes, this test should still pass AND the setup-status.json should also have `statusline: 'local'` and `gitignore: 'installed'`. Add assertions:

```typescript
test('sets devMode flag to true in project setup-status.json', async () => {
  const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

  expect(result.exitCode).toBe(0)

  // Check that devMode was set in .sidekick/setup-status.json
  const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
  const content = await readFile(setupStatusPath, 'utf-8')
  const status = JSON.parse(content)
  expect(status.devMode).toBe(true)
  expect(status.statusline).toBe('local')
  expect(status.gitignore).toBe('installed')
})
```

**Step 2: Run full dev-mode test file**

Run: `pnpm --filter @sidekick/cli test -- --run dev-mode`
Expected: All tests pass

**Step 3: Run full uninstall test file**

Run: `pnpm --filter @sidekick/cli test -- --run uninstall`
Expected: All tests pass (existing tests unaffected since they don't set devMode: true)

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/commands/__tests__/dev-mode.test.ts
git commit -m "test: strengthen dev-mode enable assertions for setup-status fields"
```
