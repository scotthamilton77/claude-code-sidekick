# Setup Dev-Mode Scope Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Block project/local scope selection in `sidekick setup` when dev-mode is active, in all modes (wizard, scripted, force).

**Architecture:** Early `getDevMode()` check in `handleSetupCommand`, threaded as a boolean to `runWizard`, `runScripted`, and `ensurePluginInstalled`. Each mode restricts scope to `user` only.

**Tech Stack:** TypeScript, Vitest, `@sidekick/core` SetupStatusService

---

### Task 1: Add dev-mode scope guard tests for scripted mode

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/setup.test.ts`

**Step 1: Write failing tests for scripted mode dev-mode blocking**

Add a new `describe('scripted mode - dev-mode scope guard')` block after the existing `'scripted mode - project status file'` describe. These tests verify that when `devMode: true` exists in project setup-status.json, scripted mode rejects non-user scopes.

```typescript
describe('scripted mode - dev-mode scope guard', () => {
  async function enableDevMode(): Promise<void> {
    const sidekickDir = path.join(projectDir, '.sidekick')
    await mkdir(sidekickDir, { recursive: true })
    await writeFile(
      path.join(sidekickDir, 'setup-status.json'),
      JSON.stringify({
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        autoConfigured: false,
        statusline: 'local',
        apiKeys: {
          OPENROUTER_API_KEY: 'not-required',
          OPENAI_API_KEY: 'not-required',
        },
        gitignore: 'installed',
        devMode: true,
      })
    )
  }

  test('rejects --statusline-scope=project when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      statuslineScope: 'project',
      homeDir,
    })

    expect(result.exitCode).toBe(1)
    expect(output.data).toContain('Dev-mode')
    expect(output.data).toContain('--statusline-scope=project')
  })

  test('rejects --statusline-scope=local when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      statuslineScope: 'local',
      homeDir,
    })

    expect(result.exitCode).toBe(1)
    expect(output.data).toContain('Dev-mode')
  })

  test('allows --statusline-scope=user when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      statuslineScope: 'user',
      homeDir,
    })

    expect(result.exitCode).toBe(0)
    expect(output.data).not.toContain('Dev-mode is active')
  })

  test('rejects --marketplace-scope=project when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      marketplaceScope: 'project',
      homeDir,
    })

    expect(result.exitCode).toBe(1)
    expect(output.data).toContain('Dev-mode')
  })

  test('rejects --plugin-scope=local when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      pluginScope: 'local',
      homeDir,
    })

    expect(result.exitCode).toBe(1)
    expect(output.data).toContain('Dev-mode')
  })

  test('allows all non-scope flags when dev-mode active', async () => {
    await enableDevMode()
    const result = await handleSetupCommand(projectDir, logger, output, {
      gitignore: true,
      personas: true,
      homeDir,
    })

    expect(result.exitCode).toBe(0)
    expect(output.data).not.toContain('Dev-mode is active')
  })

  test('no blocking when dev-mode is NOT active', async () => {
    // No dev-mode setup — should allow project scope normally
    const result = await handleSetupCommand(projectDir, logger, output, {
      statuslineScope: 'project',
      homeDir,
    })

    expect(result.exitCode).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --run packages/sidekick-cli/src/commands/__tests__/setup.test.ts`
Expected: FAIL — `rejects --statusline-scope=project` expects exitCode 1 but gets 0

**Step 3: Commit failing tests**

```bash
git add packages/sidekick-cli/src/commands/__tests__/setup.test.ts
git commit -m "test: add failing tests for dev-mode scope guard in setup scripted mode"
```

---

### Task 2: Implement dev-mode scope guard in handleSetupCommand

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts`

**Step 1: Add dev-mode detection to handleSetupCommand**

In `handleSetupCommand` (line 1085), add a `SetupStatusService` instantiation and `getDevMode()` check before the dispatch. The `homeDir` comes from `options.homeDir ?? os.homedir()`.

Change the function body to:

```typescript
export async function handleSetupCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions = {}
): Promise<SetupCommandResult> {
  if (options.help) {
    stdout.write(USAGE_TEXT)
    return { exitCode: 0 }
  }
  if (options.checkOnly) {
    return runDoctor(projectDir, logger, stdout, { homeDir: options.homeDir, only: options.only })
  }

  // Detect dev-mode before dispatch (doctor mode is unaffected)
  const homeDir = options.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })
  const isDevMode = await setupService.getDevMode()

  if (hasScriptingFlags(options)) {
    return runScripted(projectDir, logger, stdout, options, isDevMode)
  }
  return runWizard(projectDir, logger, stdout, options, isDevMode)
}
```

**Step 2: Add dev-mode scope guard to runScripted**

Update `runScripted` signature to accept `isDevMode: boolean` and add the guard at the top:

```typescript
async function runScripted(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions,
  isDevMode: boolean
): Promise<SetupCommandResult> {
  const homeDir = options.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  // Dev-mode scope guard: block project/local scopes
  if (isDevMode) {
    const blocked: string[] = []
    if (options.marketplaceScope && options.marketplaceScope !== 'user') {
      blocked.push(`--marketplace-scope=${options.marketplaceScope}`)
    }
    if (options.pluginScope && options.pluginScope !== 'user') {
      blocked.push(`--plugin-scope=${options.pluginScope}`)
    }
    if (options.statuslineScope && options.statuslineScope !== 'user') {
      blocked.push(`--statusline-scope=${options.statuslineScope}`)
    }

    if (blocked.length > 0) {
      stdout.write(`\u2717 Dev-mode is active. Cannot use non-user scopes: ${blocked.join(', ')}\n`)
      stdout.write('  Disable dev-mode first (pnpm sidekick dev-mode disable) or use user scope.\n')
      return { exitCode: 1 }
    }
  }

  let configuredCount = 0
  // ... rest of existing function unchanged
```

**Step 3: Add isDevMode parameter to runWizard signature (pass-through for now)**

```typescript
async function runWizard(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions,
  isDevMode: boolean
): Promise<SetupCommandResult> {
  // ... existing code, isDevMode not yet used in wizard (Task 3)
```

**Step 4: Run tests to verify scripted mode tests pass**

Run: `pnpm --filter @sidekick/cli test -- --run packages/sidekick-cli/src/commands/__tests__/setup.test.ts`
Expected: All new `scripted mode - dev-mode scope guard` tests PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(setup): block project/local scopes in scripted mode when dev-mode active"
```

---

### Task 3: Add dev-mode scope guard to wizard mode

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts`
- Modify: `packages/sidekick-cli/src/commands/setup/plugin-installer.ts`

**Step 1: Add `isDevMode` to `PluginInstallerOptions` and `ensurePluginInstalled`**

In `plugin-installer.ts`, add `isDevMode?: boolean` to `PluginInstallerOptions`:

```typescript
export interface PluginInstallerOptions {
  // ... existing fields
  isDevMode?: boolean
}
```

Then in `ensurePluginInstalled`, in the interactive mode branch (the `else if (options.ctx)` block around line 368), add dev-mode scope filtering:

```typescript
  } else if (options.ctx) {
    // Interactive mode: prompt only for missing components
    printHeader(
      options.ctx,
      'Step 1: Plugin Installation',
      'Sidekick needs the marketplace and plugin installed in Claude Code.'
    )

    if (options.isDevMode) {
      printStatus(options.ctx, 'info', 'Dev-mode active — only user scope available for plugin installation')
    }

    if (detectedMktScope) {
      marketplaceScope = detectedMktScope
      printStatus(options.ctx, 'info', `Marketplace already installed (${detectedMktScope})`)
    } else if (options.isDevMode) {
      marketplaceScope = 'user'
      printStatus(options.ctx, 'info', 'Marketplace scope: user (constrained by dev-mode)')
    } else {
      marketplaceScope = await promptMarketplaceScope(options.ctx)
    }

    if (pluginDetected) {
      pluginScope = marketplaceScope
      printStatus(options.ctx, 'info', 'Plugin already installed')
    } else if (options.isDevMode) {
      pluginScope = 'user'
      printStatus(options.ctx, 'info', 'Plugin scope: user (constrained by dev-mode)')
    } else {
      const validPluginScopes = getValidPluginScopes(marketplaceScope)
      if (validPluginScopes.length === 1) {
        pluginScope = validPluginScopes[0]
        printStatus(
          options.ctx,
          'info',
          `Plugin scope auto-selected: ${pluginScope} (constrained by marketplace scope)`
        )
      } else {
        pluginScope = await promptPluginScope(options.ctx, validPluginScopes)
      }
    }
```

Also in force mode, override scope when dev-mode:

```typescript
  } else if (force) {
    // Force mode: use specified or detected or default
    marketplaceScope = options.isDevMode ? 'user' : (options.marketplaceScope ?? detectedMktScope ?? 'user')
    pluginScope = options.isDevMode ? 'user' : (options.pluginScope ?? 'user')
```

**Step 2: Wire up wizard banner and Step 2 dev-mode guard in setup/index.ts**

In `runWizard`, after the wizard header, add the dev-mode banner:

```typescript
  if (!force) {
    printWizardHeader(stdout)
  }

  // Dev-mode banner
  if (isDevMode && !force) {
    stdout.write('\n')
    stdout.write('  \u26a0 Dev-mode is active \u2014 project and local scope options are unavailable.\n')
    stdout.write('    Only user-scope configuration is available for plugin and statusline.\n')
    stdout.write('\n')
  }
```

Pass `isDevMode` to `ensurePluginInstalled`:

```typescript
  const pluginResult = await ensurePluginInstalled({
    logger,
    stdout,
    force,
    projectDir,
    ctx: wctx.ctx,
    marketplaceScope: options.marketplaceScope,
    pluginScope: options.pluginScope,
    isDevMode,
  })
```

In `runStep2Statusline`, add `isDevMode` parameter:

```typescript
async function runStep2Statusline(wctx: WizardContext, pluginScope: InstallScope, isDevMode: boolean): Promise<InstallScope> {
  const { ctx, homeDir, projectDir, logger } = wctx

  printHeader(ctx, 'Step 2: Statusline Configuration', 'Claude Code plugins cannot provide statusline config directly.')

  // Dev-mode: force user scope
  if (isDevMode) {
    const settingsPath = statuslineSettingsPath('user', homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      printStatus(ctx, 'success', 'Statusline configured at user scope (dev-mode active)')
    } else {
      printStatus(ctx, 'warning', 'Statusline managed by dev-mode (skipped)')
    }
    return 'user'
  }

  // ... rest of existing code unchanged
```

Update the call in `runWizard`:

```typescript
  const statuslineScope = force
    ? (isDevMode ? 'user' : forceStatuslineScope)
    : await runStep2Statusline(wctx, pluginResult.pluginScope, isDevMode)
```

Also update force mode statusline path:

```typescript
  if (force) {
    const effectiveScope = isDevMode ? 'user' as InstallScope : forceStatuslineScope
    const settingsPath = statuslineSettingsPath(effectiveScope, homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (!wrote) {
      stdout.write('\u26a0 Statusline managed by dev-mode (skipped)\n')
    }
  }
```

**Step 3: Run all setup tests**

Run: `pnpm --filter @sidekick/cli test -- --run packages/sidekick-cli/src/commands/__tests__/setup.test.ts`
Expected: All tests PASS (existing + new)

**Step 4: Run plugin-installer tests**

Run: `pnpm --filter @sidekick/cli test -- --run packages/sidekick-cli/src/commands/__tests__/plugin-installer.test.ts`
Expected: All tests PASS (no change in behavior for non-dev-mode callers)

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts packages/sidekick-cli/src/commands/setup/plugin-installer.ts
git commit -m "feat(setup): add dev-mode scope filtering to wizard and force modes"
```

---

### Task 4: Add plugin-installer dev-mode tests

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/plugin-installer.test.ts`

**Step 1: Write tests for ensurePluginInstalled with isDevMode**

Add a new `describe('dev-mode scope guard')` block in the `ensurePluginInstalled` describe:

```typescript
describe('dev-mode scope guard', () => {
  test('interactive mode auto-selects user scope when dev-mode active', async () => {
    const stdin = createFakeStdin([])

    const executor = createFakeExecutor(
      new Map([
        ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
        ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
        ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
        ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
      ])
    )

    const result = await ensurePluginInstalled({
      logger,
      stdout: output,
      force: false,
      projectDir,
      executor,
      ctx: { stdin, stdout: output },
      isDevMode: true,
    })

    expect(result.marketplaceScope).toBe('user')
    expect(result.pluginScope).toBe('user')
    // Should not have prompted for scope
    expect(output.data).not.toMatch(/Where should/)
    expect(output.data).toContain('dev-mode')
  })

  test('force mode uses user scope when dev-mode active regardless of defaults', async () => {
    const executor = createFakeExecutor(
      new Map([
        ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
        ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
        ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
        ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
      ])
    )

    const result = await ensurePluginInstalled({
      logger,
      stdout: output,
      force: true,
      projectDir,
      executor,
      isDevMode: true,
    })

    expect(result.marketplaceScope).toBe('user')
    expect(result.pluginScope).toBe('user')
  })
})
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --run packages/sidekick-cli/src/commands/__tests__/plugin-installer.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/__tests__/plugin-installer.test.ts
git commit -m "test: add dev-mode scope guard tests for plugin-installer"
```

---

### Task 5: Build, typecheck, and verify

**Files:** None (verification only)

**Step 1: Build**

Run: `pnpm build`
Expected: Clean build with no errors

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Run full CLI test suite**

Run: `pnpm --filter @sidekick/cli test -- --run`
Expected: All tests PASS

**Step 4: Commit any fixups if needed, then close the bead**

```bash
bd close 993d
bd sync
```
