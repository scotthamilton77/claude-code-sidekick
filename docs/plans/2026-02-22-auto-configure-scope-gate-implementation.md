# Auto-Configure Scope Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent users from enabling auto-configure when the plugin isn't installed at user scope, since auto-configure can't work otherwise.

**Architecture:** Gate auto-configure at three entry points: wizard Step 6 (skip if non-user plugin scope), scripted mode `--auto-config` flag (warn and skip), and doctor (detect inconsistent state). Update USER-GUIDE.md.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Wizard — conditionally skip Step 6 based on plugin scope

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:604-615` (runStep6AutoConfig)
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:780-781` (runWizard call site)
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:332-339` (WizardState — add pluginScope)

**Step 1: Add `pluginScope` to WizardState**

In `WizardState` interface (~line 332), add:

```typescript
interface WizardState {
  pluginScope: InstallScope        // ← add this
  statuslineScope: InstallScope
  gitignoreStatus: GitignoreStatus
  wantPersonas: boolean
  apiKeyHealth: ApiKeyHealth
  apiKeyDetection: AllScopesDetectionResult | null
  autoConfig: 'auto' | 'manual'
}
```

**Step 2: Modify `runStep6AutoConfig` to accept and check plugin scope**

Replace `runStep6AutoConfig` (~lines 604-615):

```typescript
async function runStep6AutoConfig(wctx: WizardContext, pluginScope: InstallScope): Promise<'auto' | 'manual'> {
  const { ctx } = wctx

  printHeader(ctx, 'Step 6: Project Auto-Configuration')

  if (pluginScope !== 'user') {
    printStatus(ctx, 'info', 'Auto-configure requires user-scoped plugin installation (skipped)')
    return 'manual'
  }

  const autoConfig = await promptSelect(ctx, 'When sidekick runs in a new project for the first time:', [
    { value: 'auto' as const, label: 'Auto-configure using my defaults', description: 'Recommended' },
    { value: 'manual' as const, label: 'Do nothing', description: 'Manual setup only' },
  ])

  return autoConfig
}
```

**Step 3: Update `runWizard` call site to pass plugin scope and store it in state**

At ~line 781, change:
```typescript
const autoConfig = force ? 'auto' : await runStep6AutoConfig(wctx)
```
to:
```typescript
const effectivePluginScope = pluginResult.pluginScope
const autoConfig = force
  ? (effectivePluginScope === 'user' ? 'auto' : 'manual')
  : await runStep6AutoConfig(wctx, effectivePluginScope)
```

At ~lines 793-800, add `pluginScope` to the state object:
```typescript
const state: WizardState = {
  pluginScope: effectivePluginScope,
  statuslineScope,
  gitignoreStatus,
  wantPersonas,
  apiKeyHealth,
  apiKeyDetection,
  autoConfig,
}
```

**Step 4: Update force-mode summary to reflect actual auto-config state**

At ~line 815, change:
```typescript
stdout.write(`  Auto-configure: enabled\n`)
```
to:
```typescript
stdout.write(`  Auto-configure: ${autoConfig === 'auto' ? 'enabled' : 'disabled (requires user-scoped plugin)'}\n`)
```

**Step 5: Run typecheck**

Run: `pnpm --filter @sidekick/cli exec tsc --noEmit`
Expected: PASS (WizardState has new field, all usages updated)

**Step 6: Commit**

```
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "fix(setup): gate auto-configure on user-scoped plugin in wizard"
```

---

### Task 2: Scripted mode — warn and skip `--auto-config=auto` with non-user scope

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:950-974` (runScripted auto-config section)

**Step 1: Add scope detection before auto-config section**

Replace the auto-config block (~lines 950-974):

```typescript
  // 5. Configure auto-config preference if specified
  if (options.autoConfig) {
    // Determine effective plugin scope: explicit flag > detected > default
    const effectivePluginScope = options.pluginScope ?? 'user'

    if (options.autoConfig === 'auto' && effectivePluginScope !== 'user') {
      stdout.write(`⚠ Auto-configure requires user-scoped plugin installation (plugin scope: ${effectivePluginScope})\n`)
      stdout.write('  Skipping --auto-config=auto. Install plugin at user scope to enable.\n')
    } else {
      // Read existing user status or create new
      const existingUserStatus = await setupService.getUserStatus()
      const userStatus: UserSetupStatus = existingUserStatus ?? {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: options.autoConfig === 'auto',
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'user',
        },
        statusline: 'none',
        apiKeys: {
          OPENROUTER_API_KEY: 'missing',
          OPENAI_API_KEY: 'missing',
        },
      }

      userStatus.preferences.autoConfigureProjects = options.autoConfig === 'auto'
      userStatus.lastUpdatedAt = new Date().toISOString()
      await setupService.writeUserStatus(userStatus)
      stdout.write(`✓ Auto-config set to '${options.autoConfig}'\n`)
      configuredCount++
    }
  }
```

**Step 2: Run typecheck**

Run: `pnpm --filter @sidekick/cli exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "fix(setup): warn and skip auto-config with non-user plugin scope in scripted mode"
```

---

### Task 3: Doctor — detect auto-configure / plugin scope mismatch

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:1189-1232` (runDoctor check section)

The doctor already runs `detectPluginInstallation()` and reads user setup status. We need to cross-reference them.

**Step 1: Add auto-configure consistency check after existing checks**

After the `zombies` check block (~line 1287) and before `await Promise.all(promises)` (~line 1289), add a new check. Since this needs results from both the plugin detection and the doctor check (user status), it must run after `Promise.all`:

After `await Promise.all(promises)` (~line 1289), before the overall summary (~line 1292), add:

```typescript
  // --- Auto-configure consistency check ---
  if (shouldRun('auto-config')) {
    const userStatus = await setupService.getUserStatus()
    if (userStatus?.preferences.autoConfigureProjects) {
      // Plugin must be user-scoped for auto-configure to work
      const isUserScoped = pluginStatus === 'plugin' || pluginStatus === 'both'
      // If plugin is only dev-mode or none, auto-configure won't fire in new projects
      if (!isUserScoped) {
        stdout.write('⚠ Auto-configure is enabled but plugin is not installed at user scope\n')
        stdout.write("  Auto-configure won't work in new projects. Run 'sidekick setup' with user-scoped plugin.\n")
      }
    }
  }
```

**Step 2: Add `'auto-config'` to `DoctorCheckName`**

Find the `DoctorCheckName` type and add `'auto-config'`. Search for it:

Run: `grep -n 'DoctorCheckName' packages/sidekick-cli/src/commands/setup/index.ts`

Add `'auto-config'` to the union type.

**Step 3: Run typecheck**

Run: `pnpm --filter @sidekick/cli exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "fix(setup): detect auto-configure/plugin scope mismatch in doctor"
```

---

### Task 4: Write tests for all three entry points

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/setup.test.ts`

**Step 1: Write test — wizard skips Step 6 when plugin scope is non-user**

Add to the wizard test section:

```typescript
it('skips auto-configure step when plugin scope is project', async () => {
  // Setup: mock ensurePluginInstalled to return project scope
  // Run wizard (non-force)
  // Verify: output contains 'Auto-configure requires user-scoped plugin installation'
  // Verify: user status has autoConfigureProjects: false
})
```

**Step 2: Write test — force mode disables auto-configure when plugin scope is non-user**

```typescript
it('disables auto-configure in force mode when plugin scope is project', async () => {
  // Setup: mock ensurePluginInstalled to return project scope
  // Run wizard with force=true
  // Verify: output contains 'disabled (requires user-scoped plugin)'
  // Verify: user status has autoConfigureProjects: false
})
```

**Step 3: Write test — scripted mode warns and skips auto-config with non-user scope**

```typescript
it('warns and skips --auto-config=auto when plugin scope is project', async () => {
  // Run scripted with: pluginScope='project', autoConfig='auto'
  // Verify: output contains 'Auto-configure requires user-scoped plugin'
  // Verify: user status autoConfigureProjects is NOT set to true
})
```

**Step 4: Write test — scripted mode allows auto-config with user scope**

```typescript
it('allows --auto-config=auto when plugin scope is user', async () => {
  // Run scripted with: pluginScope='user', autoConfig='auto'
  // Verify: output contains "Auto-config set to 'auto'"
  // Verify: user status autoConfigureProjects is true
})
```

**Step 5: Write test — doctor detects mismatch**

```typescript
it('warns when auto-configure enabled but plugin is not user-scoped', async () => {
  // Setup: user status with autoConfigureProjects: true
  // Setup: mock detectPluginInstallation to return 'dev-mode' (not user-scoped)
  // Run doctor
  // Verify: output contains 'Auto-configure is enabled but plugin is not installed at user scope'
})
```

**Step 6: Run tests**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern=setup`
Expected: ALL PASS

**Step 7: Commit**

```
git add packages/sidekick-cli/src/commands/__tests__/setup.test.ts
git commit -m "test(setup): auto-configure scope gate validation tests"
```

---

### Task 5: Update USER-GUIDE.md

**Files:**
- Modify: `docs/USER-GUIDE.md:77-109`

**Step 1: Update Step 6 description**

Change line 84 from:
```
6. **Auto-Configuration** -- whether Sidekick should auto-configure when you enter a new project.
```
to:
```
6. **Auto-Configuration** -- whether Sidekick should auto-configure when you enter a new project. Only available when the plugin is installed at user scope, since auto-configure relies on hooks firing globally.
```

**Step 2: Update scripted flags table**

Change line 107 from:
```
| `--auto-config=auto\|manual` | Auto-configure preference |
```
to:
```
| `--auto-config=auto\|manual` | Auto-configure preference (requires `--plugin-scope=user`) |
```

**Step 3: Commit**

```
git add docs/USER-GUIDE.md
git commit -m "docs: clarify auto-configure requires user-scoped plugin"
```

---

### Task 6: Build & typecheck full project

**Step 1: Full build**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 2: Run full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/cli test`
Expected: ALL PASS

**Step 3: Final commit if any fixups needed**
