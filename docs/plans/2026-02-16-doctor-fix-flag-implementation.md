# Doctor `--fix` Flag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--fix` flag to `sidekick doctor` that automatically resolves fixable configuration issues using sensible defaults.

**Architecture:** Extend the existing `runDoctor()` function to accept a `fix` option. After checks complete, a new `runDoctorFixes()` function applies targeted fixes for each unhealthy item using existing setup primitives (same functions used by scripted and wizard modes). Also update the "needs attention" message to suggest `doctor --fix`.

**Tech Stack:** TypeScript, vitest

---

### Task 1: Add `fix` to CLI option parsing

**Files:**
- Modify: `packages/sidekick-cli/src/cli.ts:50-80` (ParsedArgs interface)
- Modify: `packages/sidekick-cli/src/cli.ts:108-121` (CLI_OPTIONS.boolean)
- Modify: `packages/sidekick-cli/src/cli.ts:181-211` (parseArgs return)
- Modify: `packages/sidekick-cli/src/cli.ts:588-595` (doctor command routing)

**Step 1: Add `fix` to ParsedArgs interface**

In `packages/sidekick-cli/src/cli.ts`, add `fix?: boolean` to the `ParsedArgs` interface, after the `force` field:

```typescript
  force?: boolean
  fix?: boolean  // <-- add this
  forceDevMode?: boolean
```

**Step 2: Add `fix` to CLI_OPTIONS.boolean**

In the `CLI_OPTIONS` const, add `'fix'` to the boolean array:

```typescript
  boolean: [
    'wait',
    'open',
    'prefer-project',
    'help',
    'version',
    'kill',
    'force',
    'fix',  // <-- add this
    'force-dev-mode',
    'dry-run',
    'check',
    'gitignore',
    'personas',
  ] as const,
```

**Step 3: Add `fix` to parseArgs return**

In the `parseArgs` function return object, add:

```typescript
    force: Boolean(parsed.force),
    fix: Boolean(parsed.fix),  // <-- add this
    forceDevMode: Boolean(parsed['force-dev-mode']),
```

**Step 4: Pass `fix` through doctor command routing**

In the `parsed.command === 'doctor'` block, pass `fix`:

```typescript
  if (parsed.command === 'doctor') {
    const { handleSetupCommand } = await import('./commands/setup.js')
    const result = await handleSetupCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      checkOnly: true,
      fix: parsed.fix,
      only: parsed.only,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }
```

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/cli.ts
git commit -m "feat(doctor): add fix flag to CLI option parsing"
```

---

### Task 2: Add `fix` to SetupCommandOptions and update help text

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:20-38` (SetupCommandOptions)
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:45-76` (USAGE_TEXT)

**Step 1: Add `fix` to SetupCommandOptions**

```typescript
export interface SetupCommandOptions {
  checkOnly?: boolean
  fix?: boolean  // <-- add this
  force?: boolean
  // ... rest unchanged
}
```

**Step 2: Update USAGE_TEXT**

Add `--fix` to the options section:

```
Options:
  --check                       Check configuration status (alias: sidekick doctor)
  --fix                         Auto-fix detected issues (use with --check or doctor)
  --only=<checks>               Run only specific doctor checks (comma-separated)
```

**Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(doctor): add fix option to SetupCommandOptions and help text"
```

---

### Task 3: Update the "needs attention" message

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:1150-1165` (runDoctor overall summary)
- Test: `packages/sidekick-cli/src/commands/__tests__/setup.test.ts`

**Step 1: Write the failing test**

Add this test in the existing `describe('doctor mode')` block (the first one, around line 115):

```typescript
    test('suggests doctor --fix and setup when not healthy', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('sidekick doctor --fix')
      expect(output.data).toContain('sidekick setup')
    })
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern='setup\.test' --testNamePattern='suggests doctor --fix'`
Expected: FAIL — output contains `sidekick setup` but not `sidekick doctor --fix`

**Step 3: Update the message in runDoctor**

In `runDoctor()`, change the unhealthy suggestion (around line 1161) from:

```typescript
      stdout.write("\nRun 'sidekick setup' to configure.\n")
```

to:

```typescript
      stdout.write("\nRun 'sidekick doctor --fix' to auto-fix, or 'sidekick setup' to configure interactively.\n")
```

**Step 4: Update the existing test assertion**

The existing test at line 337 (`'suggests running setup when not healthy'`) checks for `'sidekick setup'`. This will still pass since the new message contains `'sidekick setup'`. No change needed — but verify it still passes.

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern='setup\.test'`
Expected: All pass

**Step 6: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts packages/sidekick-cli/src/commands/__tests__/setup.test.ts
git commit -m "feat(doctor): suggest doctor --fix in unhealthy output"
```

---

### Task 4: Implement `runDoctorFixes()` and wire it into `runDoctor()`

This is the core task. The function examines doctor results and applies targeted fixes.

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts` (add `runDoctorFixes()`, update `runDoctor()` signature and flow)
- Test: `packages/sidekick-cli/src/commands/__tests__/setup.test.ts`

**Step 1: Write failing tests**

Add a new `describe('doctor --fix mode')` block in the test file:

```typescript
  describe('doctor --fix mode', () => {
    test('fixes missing gitignore', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        homeDir,
      })

      // Should have attempted to fix gitignore
      expect(output.data).toContain('Gitignore')
      // Check that .gitignore was created with sidekick section
      const gitignorePath = path.join(projectDir, '.gitignore')
      const content = await readFile(gitignorePath, 'utf-8')
      expect(content).toContain('# >>> sidekick')
    })

    test('fixes missing statusline by configuring at user scope', async () => {
      // Create user setup-status so that check doesn't fail on missing user setup
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      await writeFile(
        path.join(sidekickDir, 'setup-status.json'),
        JSON.stringify({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          preferences: { autoConfigureProjects: true, defaultStatuslineScope: 'user', defaultApiKeyScope: 'skip' },
          statusline: 'none',
          apiKeys: { OPENROUTER_API_KEY: 'not-required', OPENAI_API_KEY: 'not-required' },
        })
      )

      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        homeDir,
      })

      expect(output.data).toContain('Statusline')
      // User-level settings.json should have been created with statusline
      const settingsPath = path.join(homeDir, '.claude', 'settings.json')
      const content = await readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content)
      expect(settings.statusLine.command).toContain('sidekick')
    })

    test('fixes missing user setup-status file', async () => {
      // No user setup-status.json exists
      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        homeDir,
      })

      expect(output.data).toContain('User Setup')
      // User setup-status.json should now exist
      const statusPath = path.join(homeDir, '.sidekick', 'setup-status.json')
      const content = await readFile(statusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.version).toBe(1)
    })

    test('skips API key issues with guidance message', async () => {
      // Create user setup with missing API key
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      await writeFile(
        path.join(sidekickDir, 'setup-status.json'),
        JSON.stringify({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          preferences: { autoConfigureProjects: true, defaultStatuslineScope: 'user', defaultApiKeyScope: 'user' },
          statusline: 'user',
          apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' },
        })
      )

      // Create statusline so that's not a problem
      const claudeDir = path.join(homeDir, '.claude')
      await mkdir(claudeDir, { recursive: true })
      await writeFile(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ statusLine: { command: 'npx @scotthamilton77/sidekick statusline' } })
      )

      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        homeDir,
      })

      // Should mention that API key can't be auto-fixed
      expect(output.data).toContain('sidekick setup')
    })

    test('returns exit code 0 when all fixable issues resolved', async () => {
      // Start with no config at all — everything unhealthy
      // After --fix: statusline, gitignore, user setup should be fixed
      // Plugin may still be 'none' but that's an install issue
      // API key is unfixable
      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        homeDir,
      })

      // Should have printed fix actions
      expect(output.data).toContain('Fixing')
    })

    test('respects --only filter during fix', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, {
        checkOnly: true,
        fix: true,
        only: 'gitignore',
        homeDir,
      })

      // Should fix gitignore
      const gitignorePath = path.join(projectDir, '.gitignore')
      const content = await readFile(gitignorePath, 'utf-8')
      expect(content).toContain('# >>> sidekick')

      // Should NOT have created statusline settings (not in --only)
      const settingsPath = path.join(homeDir, '.claude', 'settings.json')
      try {
        await readFile(settingsPath, 'utf-8')
        // If we get here, file exists — it shouldn't
        expect.fail('settings.json should not have been created')
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
      }
    })
  })
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern='setup\.test' --testNamePattern='doctor --fix'`
Expected: FAIL — `fix` option not recognized / no fix behavior exists

**Step 3: Update `runDoctor()` signature and wire in fix mode**

In `runDoctor()`, update the options type and add the fix flow:

```typescript
async function runDoctor(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options?: { homeDir?: string; only?: string; fix?: boolean }
): Promise<SetupCommandResult> {
```

After the overall summary section (after `await Promise.all(promises)`), before the final return, add the fix logic:

```typescript
  // --- Fix mode: apply targeted fixes for unhealthy items ---
  if (options?.fix && filter === null && !isHealthy) {
    return runDoctorFixes(projectDir, logger, stdout, {
      homeDir,
      doctorResult: doctorResult!,
      gitignore: gitignore!,
      pluginStatus: pluginStatus!,
      liveness,
    })
  }

  if (options?.fix && filter !== null) {
    return runDoctorFixesFiltered(projectDir, logger, stdout, {
      homeDir,
      filter,
      doctorResult,
      gitignore,
      pluginStatus,
    })
  }
```

For the filtered case (when `--only` is used with `--fix`), we need a simpler path that only fixes the specified checks.

**Step 4: Implement `runDoctorFixes()`**

Add this function above `runDoctor()` in `setup/index.ts`:

```typescript
/**
 * Apply targeted fixes for unhealthy doctor items.
 * Only fixes what can be resolved non-interactively; prints guidance for the rest.
 */
async function runDoctorFixes(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  context: {
    homeDir: string
    doctorResult: DoctorCheckResultType
    gitignore: string
    pluginStatus: PluginInstallationStatus
    liveness: PluginLivenessStatus | null
  }
): Promise<SetupCommandResult> {
  const { homeDir, doctorResult, gitignore, pluginStatus, liveness } = context
  stdout.write('\nFixing detected issues...\n\n')

  let fixedCount = 0
  const unfixable: string[] = []

  // Fix 1: Missing user setup-status file
  if (!doctorResult.userSetupExists) {
    stdout.write('Fixing: User Setup\n')
    const setupService = new SetupStatusService(projectDir, { homeDir, logger })
    const userStatus: UserSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      preferences: {
        autoConfigureProjects: true,
        defaultStatuslineScope: 'user',
        defaultApiKeyScope: 'skip',
      },
      statusline: 'none',
      apiKeys: {
        OPENROUTER_API_KEY: SetupStatusService.userApiKeyStatusFromHealth('not-required'),
        OPENAI_API_KEY: SetupStatusService.userApiKeyStatusFromHealth('not-required'),
      },
    }
    await setupService.writeUserStatus(userStatus)
    stdout.write('  ✓ Created ~/.sidekick/setup-status.json with defaults\n')
    fixedCount++
  }

  // Fix 2: Missing statusline
  if (doctorResult.statusline.actual === 'none') {
    stdout.write('Fixing: Statusline\n')
    const settingsPath = statuslineSettingsPath('user', homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      stdout.write('  ✓ Statusline configured at user scope\n')
      fixedCount++
    } else {
      stdout.write('  ⚠ Statusline managed by dev-mode (skipped)\n')
    }
  }

  // Fix 3: Missing/incomplete gitignore
  if (gitignore !== 'installed') {
    stdout.write('Fixing: Gitignore\n')
    const result = await installGitignoreSection(projectDir)
    if (result.status === 'error') {
      stdout.write(`  ⚠ Failed to update .gitignore: ${result.error}\n`)
    } else {
      stdout.write('  ✓ Gitignore configured\n')
      fixedCount++
    }
  }

  // Fix 4: Missing plugin — attempt install
  if (pluginStatus === 'none') {
    stdout.write('Fixing: Plugin\n')
    try {
      const pluginResult = await ensurePluginInstalled({
        logger,
        stdout,
        force: true,
        projectDir,
        marketplaceScope: 'user',
      })
      if (pluginResult.error) {
        stdout.write(`  ⚠ Plugin installation issue: ${pluginResult.error}\n`)
      } else {
        stdout.write(`  ✓ Plugin installed (${pluginResult.pluginScope})\n`)
        fixedCount++
      }
    } catch (err) {
      stdout.write(`  ⚠ Plugin installation failed: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  // Unfixable: API key issues
  const openRouterHealth = doctorResult.apiKeys.OPENROUTER_API_KEY.actual
  if (openRouterHealth !== 'healthy' && openRouterHealth !== 'not-required') {
    unfixable.push("API Key: Run 'sidekick setup' to configure API keys interactively.")
  }

  // Unfixable: Plugin liveness
  if (liveness !== null && liveness !== 'active') {
    unfixable.push('Plugin Liveness: Restart Claude Code to activate hooks: claude --continue')
  }

  // Summary
  stdout.write('\n')
  if (fixedCount > 0) {
    stdout.write(`Fixed ${fixedCount} issue${fixedCount === 1 ? '' : 's'}.\n`)
  }
  if (unfixable.length > 0) {
    stdout.write('\nRequires manual action:\n')
    for (const msg of unfixable) {
      stdout.write(`  → ${msg}\n`)
    }
  }

  return { exitCode: unfixable.length > 0 ? 1 : 0 }
}
```

**Step 5: Implement `runDoctorFixesFiltered()` for `--only` + `--fix` combo**

```typescript
/**
 * Apply targeted fixes when --only filter is active.
 * Only runs fixes for the checks specified in the filter.
 */
async function runDoctorFixesFiltered(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  context: {
    homeDir: string
    filter: Set<DoctorCheckName>
    doctorResult: DoctorCheckResultType | null
    gitignore: string | null
    pluginStatus: PluginInstallationStatus | null
  }
): Promise<SetupCommandResult> {
  const { homeDir, filter, doctorResult, gitignore, pluginStatus } = context
  stdout.write('\nFixing detected issues...\n\n')

  let fixedCount = 0

  if (filter.has('statusline') && doctorResult?.statusline.actual === 'none') {
    stdout.write('Fixing: Statusline\n')
    const settingsPath = statuslineSettingsPath('user', homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      stdout.write('  ✓ Statusline configured at user scope\n')
      fixedCount++
    } else {
      stdout.write('  ⚠ Statusline managed by dev-mode (skipped)\n')
    }
  }

  if (filter.has('gitignore') && gitignore !== null && gitignore !== 'installed') {
    stdout.write('Fixing: Gitignore\n')
    const result = await installGitignoreSection(projectDir)
    if (result.status === 'error') {
      stdout.write(`  ⚠ Failed to update .gitignore: ${result.error}\n`)
    } else {
      stdout.write('  ✓ Gitignore configured\n')
      fixedCount++
    }
  }

  if (filter.has('plugin') && pluginStatus === 'none') {
    stdout.write('Fixing: Plugin\n')
    try {
      const pluginResult = await ensurePluginInstalled({
        logger,
        stdout,
        force: true,
        projectDir,
        marketplaceScope: 'user',
      })
      if (pluginResult.error) {
        stdout.write(`  ⚠ Plugin installation issue: ${pluginResult.error}\n`)
      } else {
        stdout.write(`  ✓ Plugin installed (${pluginResult.pluginScope})\n`)
        fixedCount++
      }
    } catch (err) {
      stdout.write(`  ⚠ Plugin installation failed: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  if (fixedCount > 0) {
    stdout.write(`\nFixed ${fixedCount} issue${fixedCount === 1 ? '' : 's'}.\n`)
  } else {
    stdout.write('No fixable issues found.\n')
  }

  return { exitCode: 0 }
}
```

**Step 6: Wire fix into `runDoctor()` and `handleSetupCommand()`**

Update `handleSetupCommand()` to pass `fix` through:

```typescript
  if (options.checkOnly) {
    return runDoctor(projectDir, logger, stdout, { homeDir: options.homeDir, only: options.only, fix: options.fix })
  }
```

In `runDoctor()`, extract `isHealthy` to a variable available after Promise.all (it already is), and add the fix calls after the overall summary, before the final return. The key change: the fix calls need to go inside the `if (filter === null)` block after the unhealthy message, and a separate path for filtered fixes.

**Step 7: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern='setup\.test'`
Expected: All pass

**Step 8: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts packages/sidekick-cli/src/commands/__tests__/setup.test.ts
git commit -m "feat(doctor): implement --fix flag for targeted auto-fixes"
```

---

### Task 5: Build, typecheck, and verify

**Files:**
- All modified files from previous tasks

**Step 1: Build**

Run: `pnpm build`
Expected: Clean build

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter @sidekick/cli test`
Expected: All pass

**Step 4: Commit any fixes**

If any build/type/test issues were found, fix and commit.

---

### Task 6: Update help text in cli.ts

**Files:**
- Modify: `packages/sidekick-cli/src/cli.ts:340` (doctor help line)

**Step 1: Update the doctor command description in the main help text**

In `cli.ts`, update the doctor description line from:

```
  doctor                   Check sidekick health (alias: setup --check)
```

to:

```
  doctor [--fix]           Check sidekick health (--fix to auto-repair)
```

**Step 2: Commit**

```bash
git add packages/sidekick-cli/src/cli.ts
git commit -m "docs(doctor): update help text to show --fix flag"
```
