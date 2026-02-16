# Uninstall Confirmation Prompt — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a detection summary and confirmation prompt before uninstall executes destructive actions.

**Architecture:** Add a `collectDetectionSummary()` function that inspects installed artifacts and returns structured categories grouped by scope. Insert it between scope detection and execution in `handleUninstallCommand`, with a `promptYesNo` confirmation gate. `--force` skips the prompt; `--dry-run` bypasses it entirely (nothing executes).

**Tech Stack:** TypeScript, Vitest, Node.js fs

**Design doc:** See git history for the original design (replaced by this plan).

---

### Task 1: Add detection summary types and `collectDetectionSummary()`

**Files:**
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts`
- Test: `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts`

**Step 1: Write the failing test**

Add a new `describe('detection summary')` block in `uninstall.test.ts`. Since `collectDetectionSummary` is a private function, test it through `handleUninstallCommand` output — the summary text should appear in stdout when `force` is false.

```typescript
describe('detection summary and confirmation', () => {
  test('shows detection summary before prompting when not --force', async () => {
    // Set up project scope with several artifacts
    await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
    await writeFile(
      path.join(tempDir, '.claude', 'settings.json'),
      JSON.stringify({
        statusLine: { type: 'command', command: 'npx @scotthamilton77/sidekick statusline' },
      })
    )
    await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      scope: 'project',
      stdin: createAutoStdin('y'),
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('Detected sidekick installation:')
    expect(stdout.data).toContain('project:')
    expect(stdout.data).toContain('Settings:')
    expect(stdout.data).toContain('statusline')
    expect(stdout.data).toContain('Config:')
    expect(stdout.data).toContain('Data:')
    expect(stdout.data).toContain('Proceed with uninstall?')
  })

  test('skips summary and prompt when --force is set', async () => {
    await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).not.toContain('Detected sidekick installation:')
    expect(stdout.data).not.toContain('Proceed with uninstall?')
  })

  test('skips summary and prompt when --dry-run is set', async () => {
    await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      force: true,
      dryRun: true,
      scope: 'project',
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).not.toContain('Detected sidekick installation:')
    expect(stdout.data).toContain('dry-run')
  })

  test('exits with code 0 and cancellation message when user declines', async () => {
    await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      scope: 'project',
      stdin: createAutoStdin('n'),
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('Uninstall cancelled.')
    // Verify nothing was actually removed
    const status = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
    expect(status).toBeTruthy()
  })

  test('shows both scopes when both are detected', async () => {
    await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
    await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      stdin: createAutoStdin('y'),
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('project:')
    expect(stdout.data).toContain('user:')
  })

  test('shows plugin in summary when plugin is installed', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (args.includes('list')) {
          callback(
            null,
            JSON.stringify([{ id: 'sidekick@claude-code-sidekick', version: '0.0.8', scope: 'user', enabled: true }]),
            ''
          )
        } else if (args.includes('uninstall')) {
          callback(null, '', '')
        } else {
          callback(null, '[]', '')
        }
      }
    )
    await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

    const result = await handleUninstallCommand(tempDir, logger, stdout, {
      stdin: createAutoStdin('y'),
      userHome,
    })

    expect(result.exitCode).toBe(0)
    expect(stdout.data).toContain('Plugin:')
    expect(stdout.data).toContain('sidekick@')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/cli test -- --reporter verbose --testPathPattern uninstall`
Expected: FAIL — "Detected sidekick installation:" not found in output (summary not implemented yet).

**Step 3: Implement types and `collectDetectionSummary()`**

Add these types after the existing `UninstallAction` interface:

```typescript
interface DetectionCategory {
  label: string
  details: string
}

interface DetectionSummary {
  project: DetectionCategory[]
  user: DetectionCategory[]
}
```

Add the `collectDetectionSummary()` function after the existing detection functions (`detectProjectScope`, `detectUserScope`). It checks each artifact category and builds the summary:

```typescript
async function collectDetectionSummary(
  projectDir: string,
  userHome: string,
  projectDetected: boolean,
  userDetected: boolean,
  devModeActive: boolean,
  logger: Logger
): Promise<DetectionSummary> {
  const summary: DetectionSummary = { project: [], user: [] }

  // --- Plugin detection ---
  try {
    const plugins = await execFileAsync('claude', ['plugin', 'list', '--json'])
    const pluginList = JSON.parse(plugins) as Array<{ id: string; scope: string }>
    const sidekickPlugin = pluginList.find((p) => p.id.startsWith('sidekick@'))
    if (sidekickPlugin) {
      const scope = sidekickPlugin.scope as 'user' | 'project'
      summary[scope].push({ label: 'Plugin', details: sidekickPlugin.id })
    }
  } catch {
    logger.debug('Could not detect plugin for summary (claude CLI may not be available)')
  }

  // --- Project scope ---
  if (projectDetected) {
    // Settings
    const settingsDetails: string[] = []
    for (const file of ['settings.json', 'settings.local.json']) {
      if (devModeActive && file === 'settings.local.json') continue
      try {
        const content = await fs.readFile(path.join(projectDir, '.claude', file), 'utf-8')
        const settings = JSON.parse(content) as Record<string, unknown>
        const sl = settings.statusLine as { command?: string } | undefined
        if (sl?.command?.includes('sidekick')) settingsDetails.push('statusline')
        if (settings.hooks) {
          const hooks = settings.hooks as Record<string, unknown[]>
          const hasSidekickHooks = Object.values(hooks).some((handlers) =>
            Array.isArray(handlers) && handlers.some((h) => {
              const handler = h as { hooks?: Array<{ command?: string }> }
              return handler.hooks?.some((hook) =>
                hook.command?.includes('sidekick') || hook.command?.includes('dev-sidekick')
              )
            })
          )
          if (hasSidekickHooks) settingsDetails.push('hooks')
        }
      } catch { /* file doesn't exist */ }
    }
    if (settingsDetails.length > 0) {
      summary.project.push({ label: 'Settings', details: [...new Set(settingsDetails)].join(', ') })
    }

    // Daemon
    try {
      await fs.access(path.join(projectDir, '.sidekick', 'sidekickd.pid'))
      summary.project.push({ label: 'Daemon', details: 'pid file found' })
    } catch { /* no daemon */ }

    // Config
    const configFiles: string[] = []
    if (!devModeActive) {
      try { await fs.access(path.join(projectDir, '.sidekick', 'setup-status.json')); configFiles.push('setup-status.json') } catch { /* */ }
    }
    if (configFiles.length > 0) {
      summary.project.push({ label: 'Config', details: configFiles.join(', ') })
    }

    // Data
    const dataItems: string[] = []
    for (const dir of ['logs', 'sessions', 'state']) {
      try { await fs.access(path.join(projectDir, '.sidekick', dir)); dataItems.push(`${dir}/`) } catch { /* */ }
    }
    if (dataItems.length > 0) {
      summary.project.push({ label: 'Data', details: dataItems.join(', ') })
    }

    // .env
    try {
      const envContent = await fs.readFile(path.join(projectDir, '.sidekick', '.env'), 'utf-8')
      const hasKeys = envContent.split('\n').some((l) => l.includes('=') && !l.startsWith('#'))
      summary.project.push({ label: '.env', details: hasKeys ? 'contains API keys' : 'present' })
    } catch { /* no .env */ }

    // .gitignore
    if (!devModeActive) {
      try {
        const gitignore = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf-8')
        if (gitignore.includes('# >>> sidekick')) {
          summary.project.push({ label: '.gitignore', details: 'sidekick section' })
        }
      } catch { /* no gitignore */ }
    }
  }

  // --- User scope ---
  if (userDetected) {
    // Settings
    try {
      const content = await fs.readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8')
      const settings = JSON.parse(content) as Record<string, unknown>
      const sl = settings.statusLine as { command?: string } | undefined
      if (sl?.command?.includes('sidekick')) {
        summary.user.push({ label: 'Settings', details: 'statusline' })
      }
    } catch { /* */ }

    // Config
    const userConfigFiles: string[] = []
    try { await fs.access(path.join(userHome, '.sidekick', 'setup-status.json')); userConfigFiles.push('setup-status.json') } catch { /* */ }
    try { await fs.access(path.join(userHome, '.sidekick', 'features.yaml')); userConfigFiles.push('features.yaml') } catch { /* */ }
    if (userConfigFiles.length > 0) {
      summary.user.push({ label: 'Config', details: userConfigFiles.join(', ') })
    }

    // .env
    try {
      const envContent = await fs.readFile(path.join(userHome, '.sidekick', '.env'), 'utf-8')
      const hasKeys = envContent.split('\n').some((l) => l.includes('=') && !l.startsWith('#'))
      summary.user.push({ label: '.env', details: hasKeys ? 'contains API keys' : 'present' })
    } catch { /* no .env */ }

    // Data (user scope has state/ and daemons/)
    const userDataItems: string[] = []
    for (const dir of ['state', 'daemons']) {
      try { await fs.access(path.join(userHome, '.sidekick', dir)); userDataItems.push(`${dir}/`) } catch { /* */ }
    }
    if (userDataItems.length > 0) {
      summary.user.push({ label: 'Data', details: userDataItems.join(', ') })
    }
  }

  return summary
}
```

Add `printDetectionSummary()`:

```typescript
function printDetectionSummary(stdout: Writable, summary: DetectionSummary): void {
  stdout.write('\nDetected sidekick installation:\n')
  const scopes: Array<{ key: keyof DetectionSummary; label: string }> = [
    { key: 'user', label: 'user' },
    { key: 'project', label: 'project' },
  ]
  for (const { key, label } of scopes) {
    if (summary[key].length === 0) continue
    stdout.write(`  ${label}:\n`)
    for (const cat of summary[key]) {
      stdout.write(`    ${cat.label}: ${cat.details}\n`)
    }
  }
  stdout.write('\n')
}
```

Wire into `handleUninstallCommand` — insert after devModeActive detection (line 66), before step 1 (line 68):

```typescript
  // Show detection summary and confirm (unless --force or --dry-run)
  if (!force && !dryRun) {
    const summary = await collectDetectionSummary(projectDir, userHome, projectDetected, userDetected, devModeActive, logger)
    printDetectionSummary(stdout, summary)
    const proceed = await promptYesNo('Proceed with uninstall?', stdout, stdin)
    if (!proceed) {
      stdout.write('Uninstall cancelled.\n')
      return { exitCode: 0, output: '' }
    }
  }
```

**Step 4: Run tests to verify they pass**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/cli test -- --reporter verbose --testPathPattern uninstall`
Expected: ALL PASS

**Step 5: Run existing tests to verify no regressions**

Run: `cd /workspaces/claude-code-sidekick && pnpm --filter @sidekick/cli test -- --reporter verbose --testPathPattern uninstall`
Expected: ALL existing tests still pass. Most existing tests use `force: true` so they bypass the new prompt entirely.

Note: Two existing tests do NOT use `force: true`:
1. "keeps .env when user declines interactive prompt" — uses `stdin: createAutoStdin('n')`. This test will now see the confirmation prompt FIRST, consuming the 'n', then the .env prompt won't get an answer. **Fix:** add `force: true` to this test OR change stdin to emit `y\nn\n` (first answers confirmation, second answers .env prompt).
2. Any test without `force: true` that also lacks `stdin` — will hang on the confirmation prompt.

**Fix for the .env decline test:** Change the `createAutoStdin('n')` to a multi-answer stdin that answers 'y' to the first prompt (confirmation) and 'n' to the second (.env). Or simpler: the test already provides `stdin` but no `force`, so it will now hit the confirmation prompt. We need a `createMultiAnswerStdin('y', 'n')` helper, or just add `force: true` to the test since it's testing .env behavior not confirmation behavior.

The cleanest fix: add `force: true` to the .env decline test since it's testing .env prompting, not the confirmation prompt.

**Step 6: Commit**

```
git add packages/sidekick-cli/src/commands/uninstall.ts packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts
git commit -m "feat(uninstall): show detection summary and confirm before proceeding"
```

---

### Task 2: Build and typecheck

**Step 1: Run build**

Run: `cd /workspaces/claude-code-sidekick && pnpm build`
Expected: PASS

**Step 2: Run typecheck**

Run: `cd /workspaces/claude-code-sidekick && pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `cd /workspaces/claude-code-sidekick && pnpm lint`
Expected: PASS

---
