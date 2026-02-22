# Shell Alias Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users type `sidekick` instead of `npx @scotthamilton77/sidekick` by adding a shell alias to their rc file.

**Architecture:** New `shell-alias.ts` utility module with pure functions for alias detection/installation/removal. Integrated into setup wizard (Step 7), doctor checks, uninstall flow, and two new CLI subcommands.

**Tech Stack:** Node.js fs/path, process.env.SHELL detection, marker-bracketed alias blocks in ~/.zshrc/~/.bashrc.

---

### Task 1: Shell Alias Utility Module — Core Functions

**Files:**
- Create: `packages/sidekick-cli/src/commands/setup/shell-alias.ts`
- Create: `packages/sidekick-cli/src/__tests__/shell-alias.test.ts`

**Step 1: Write the test file with all test cases**

```typescript
// packages/sidekick-cli/src/__tests__/shell-alias.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectShell, isAliasInRcFile, installAlias, uninstallAlias, getAliasBlock } from '../commands/setup/shell-alias'
import * as fs from 'node:fs'
import * as path from 'node:path'

vi.mock('node:fs')

const MARKER_START = '# >>> sidekick alias >>>'
const MARKER_END = '# <<< sidekick alias <<<'

describe('shell-alias', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('detectShell', () => {
    it('returns zsh when SHELL ends with /zsh', () => {
      expect(detectShell('/bin/zsh')).toEqual({ shell: 'zsh', rcFile: '.zshrc' })
    })

    it('returns bash when SHELL ends with /bash', () => {
      expect(detectShell('/bin/bash')).toEqual({ shell: 'bash', rcFile: '.bashrc' })
    })

    it('returns null for unsupported shells', () => {
      expect(detectShell('/usr/bin/fish')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(detectShell('')).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(detectShell(undefined)).toBeNull()
    })
  })

  describe('getAliasBlock', () => {
    it('returns the marker-bracketed alias block', () => {
      const block = getAliasBlock()
      expect(block).toContain(MARKER_START)
      expect(block).toContain("alias sidekick='npx @scotthamilton77/sidekick'")
      expect(block).toContain(MARKER_END)
    })
  })

  describe('isAliasInRcFile', () => {
    it('returns true when marker block is present', () => {
      const content = `# some config\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n`
      vi.spyOn(fs, 'readFileSync').mockReturnValue(content)
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(true)
    })

    it('returns false when marker block is absent', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('# some config\nexport PATH=...\n')
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(false)
    })

    it('returns false when file does not exist', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }) })
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(false)
    })
  })

  describe('installAlias', () => {
    it('appends alias block to existing rc file', () => {
      const existingContent = '# existing config\nexport PATH=/usr/bin\n'
      vi.spyOn(fs, 'readFileSync').mockReturnValue(existingContent)
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('installed')
      expect(writeSpy).toHaveBeenCalledOnce()
      const written = writeSpy.mock.calls[0][1] as string
      expect(written).toContain(existingContent)
      expect(written).toContain(MARKER_START)
      expect(written).toContain(MARKER_END)
    })

    it('creates rc file if it does not exist', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }) })
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('installed')
      expect(writeSpy).toHaveBeenCalledOnce()
      const written = writeSpy.mock.calls[0][1] as string
      expect(written).toContain(MARKER_START)
    })

    it('returns already-installed when marker block exists', () => {
      const content = `# config\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n`
      vi.spyOn(fs, 'readFileSync').mockReturnValue(content)
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('already-installed')
      expect(writeSpy).not.toHaveBeenCalled()
    })
  })

  describe('uninstallAlias', () => {
    it('removes the marker block from rc file', () => {
      const before = `# before\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n# after\n`
      vi.spyOn(fs, 'readFileSync').mockReturnValue(before)
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('removed')
      const written = writeSpy.mock.calls[0][1] as string
      expect(written).toContain('# before')
      expect(written).toContain('# after')
      expect(written).not.toContain(MARKER_START)
      expect(written).not.toContain(MARKER_END)
    })

    it('returns not-found when marker block is absent', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('# config\n')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('not-found')
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it('returns not-found when file does not exist', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }) })

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('not-found')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/cli test -- --run shell-alias`
Expected: FAIL — module not found

**Step 3: Implement the shell-alias utility module**

```typescript
// packages/sidekick-cli/src/commands/setup/shell-alias.ts
import * as fs from 'node:fs'

const MARKER_START = '# >>> sidekick alias >>>'
const MARKER_END = '# <<< sidekick alias <<<'
const ALIAS_LINE = "alias sidekick='npx @scotthamilton77/sidekick'"

export interface ShellInfo {
  shell: 'zsh' | 'bash'
  rcFile: '.zshrc' | '.bashrc'
}

export function detectShell(shellEnv: string | undefined): ShellInfo | null {
  if (!shellEnv) return null
  if (shellEnv.endsWith('/zsh')) return { shell: 'zsh', rcFile: '.zshrc' }
  if (shellEnv.endsWith('/bash')) return { shell: 'bash', rcFile: '.bashrc' }
  return null
}

export function getAliasBlock(): string {
  return `${MARKER_START}\n${ALIAS_LINE}\n${MARKER_END}\n`
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export function isAliasInRcFile(rcFilePath: string): boolean {
  const content = readFileOrNull(rcFilePath)
  if (content === null) return false
  return content.includes(MARKER_START)
}

export function installAlias(rcFilePath: string): 'installed' | 'already-installed' {
  const content = readFileOrNull(rcFilePath) ?? ''
  if (content.includes(MARKER_START)) return 'already-installed'

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(rcFilePath, content + suffix + getAliasBlock())
  return 'installed'
}

export function uninstallAlias(rcFilePath: string): 'removed' | 'not-found' {
  const content = readFileOrNull(rcFilePath)
  if (content === null || !content.includes(MARKER_START)) return 'not-found'

  const startIdx = content.indexOf(MARKER_START)
  const endIdx = content.indexOf(MARKER_END)
  if (startIdx === -1 || endIdx === -1) return 'not-found'

  const before = content.substring(0, startIdx)
  const after = content.substring(endIdx + MARKER_END.length + 1) // +1 for trailing newline
  fs.writeFileSync(rcFilePath, before + after)
  return 'removed'
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/cli test -- --run shell-alias`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/shell-alias.ts packages/sidekick-cli/src/__tests__/shell-alias.test.ts
git commit -m "feat(cli): add shell-alias utility module with tests"
```

---

### Task 2: Setup Wizard Step 7 — Shell Alias

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts` (runWizard ~line 792, WizardState ~line 337)
- Modify: `packages/sidekick-cli/src/__tests__/shell-alias.test.ts` (add integration-style test)

**Step 1: Add `shellAlias` to WizardState**

In `packages/sidekick-cli/src/commands/setup/index.ts` at ~line 337:

```typescript
interface WizardState {
  statuslineScope: InstallScope
  gitignoreStatus: GitignoreStatus
  wantPersonas: boolean
  apiKeyHealth: ApiKeyHealth
  apiKeyDetection: AllScopesDetectionResult | null
  autoConfig: 'auto' | 'manual'
  shellAlias: 'installed' | 'already-installed' | 'skipped' | 'unsupported'
}
```

**Step 2: Create runStep7ShellAlias function**

Add after `runStep6AutoConfig` (~line 625):

```typescript
import { detectShell, installAlias, isAliasInRcFile } from './shell-alias.js'

async function runStep7ShellAlias(
  wctx: WizardContext
): Promise<'installed' | 'already-installed' | 'skipped' | 'unsupported'> {
  const { ctx, homeDir } = wctx
  const shellInfo = detectShell(process.env.SHELL)

  printHeader(ctx, 'Step 7: Shell Alias')

  if (!shellInfo) {
    printStatus(ctx, 'info', 'Unsupported shell — only zsh and bash are supported')
    return 'unsupported'
  }

  const rcPath = path.join(homeDir, shellInfo.rcFile)

  if (isAliasInRcFile(rcPath)) {
    printStatus(ctx, 'success', `Shell alias already configured in ~/${shellInfo.rcFile}`)
    return 'already-installed'
  }

  const choice = await promptSelect(ctx, "Add a 'sidekick' shell alias for easier CLI access?", [
    { value: 'yes' as const, label: 'Yes', description: `Add alias to ~/${shellInfo.rcFile}` },
    { value: 'no' as const, label: 'No', description: 'Skip — use npx @scotthamilton77/sidekick' },
  ])

  if (choice === 'no') {
    printStatus(ctx, 'info', 'Shell alias skipped')
    return 'skipped'
  }

  const result = installAlias(rcPath)
  if (result === 'installed') {
    printStatus(ctx, 'success', `Alias added to ~/${shellInfo.rcFile}`)
    printStatus(ctx, 'info', `Run 'source ~/${shellInfo.rcFile}' or open a new terminal to activate`)
  }
  return result
}
```

**Step 3: Wire Step 7 into runWizard**

In `runWizard()` after the `runStep6AutoConfig` call (~line 792), add:

```typescript
  const shellAlias = force ? 'skipped' as const : await runStep7ShellAlias(wctx)
```

Update the WizardState construction (~line 804):

```typescript
  const state: WizardState = {
    statuslineScope,
    gitignoreStatus,
    wantPersonas,
    apiKeyHealth,
    apiKeyDetection,
    autoConfig,
    shellAlias,
  }
```

**Step 4: Run build and typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: PASS (WizardState references in printSummary may need a minor update to handle the new field — add it to the summary output if printSummary renders state fields)

**Step 5: Run existing setup tests to verify no regressions**

Run: `pnpm --filter @sidekick/cli test -- --run setup`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(setup): add Step 7 shell alias to wizard"
```

---

### Task 3: Doctor Check for Shell Alias

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts` (DOCTOR_CHECK_NAMES ~line 1028, runDoctor ~line 1220)

**Step 1: Add 'shell-alias' to doctor check names**

At ~line 1028:

```typescript
const DOCTOR_CHECK_NAMES = [
  'api-keys',
  'statusline',
  'gitignore',
  'plugin',
  'liveness',
  'zombies',
  'auto-config',
  'shell-alias',
] as const
```

**Step 2: Add shell-alias check in runDoctor**

After the auto-config check block (~line 1330), before the overall summary:

```typescript
  // Shell alias check
  if (shouldRun('shell-alias')) {
    const shellInfo = detectShell(process.env.SHELL)
    if (!shellInfo) {
      stdout.write('• Shell Alias: unsupported shell (zsh/bash only)\n')
    } else {
      const rcPath = path.join(homeDir, shellInfo.rcFile)
      const inRcFile = isAliasInRcFile(rcPath)
      // Check if 'sidekick' command resolves (global install or active alias)
      let commandAvailable = false
      try {
        const { execSync } = await import('node:child_process')
        execSync('command -v sidekick', { stdio: 'ignore' })
        commandAvailable = true
      } catch { /* not available */ }

      if (inRcFile && commandAvailable) {
        stdout.write('✓ Shell Alias: configured (active)\n')
      } else if (inRcFile && !commandAvailable) {
        stdout.write(`⚠ Shell Alias: configured (inactive — run 'source ~/${shellInfo.rcFile}' or open a new terminal)\n`)
      } else if (!inRcFile && commandAvailable) {
        stdout.write('✓ Shell Alias: not configured (sidekick available via other means)\n')
      } else {
        stdout.write("⚠ Shell Alias: not configured (run 'sidekick setup' to add)\n")
      }
    }
  }
```

**Step 3: Ensure import of detectShell and isAliasInRcFile at top of file**

Add to imports:

```typescript
import { detectShell, isAliasInRcFile } from './shell-alias.js'
```

**Step 4: Decide if shell-alias affects overall health**

The shell alias is optional — it should NOT cause overall health to report `needs attention`. The existing `isHealthy` calculation (~line 1338) does not need to include shell-alias. No changes needed.

**Step 5: Run build and tests**

Run: `pnpm build && pnpm typecheck`
Run: `pnpm --filter @sidekick/cli test -- --run setup`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(doctor): add shell-alias health check"
```

---

### Task 4: CLI Subcommands — install-alias / uninstall-alias

**Files:**
- Modify: `packages/sidekick-cli/src/cli.ts` (~line 563-627, routeCommand and help text)

**Step 1: Add command routing for install-alias**

In `routeCommand()` before the unknown-command block (~line 623):

```typescript
  if (parsed.command === 'install-alias') {
    const { detectShell, installAlias } = await import('./commands/setup/shell-alias.js')
    const shellInfo = detectShell(process.env.SHELL)
    if (!shellInfo) {
      stdout.write('Unsupported shell. Only zsh and bash are supported.\n')
      return { exitCode: 1, stdout: '', stderr: '' }
    }
    const homeDir = process.env.HOME || ''
    const rcPath = path.join(homeDir, shellInfo.rcFile)
    const result = installAlias(rcPath)
    if (result === 'installed') {
      stdout.write(`✓ Alias added to ~/${shellInfo.rcFile}\n`)
      stdout.write(`  Run 'source ~/${shellInfo.rcFile}' or open a new terminal to activate.\n`)
    } else {
      stdout.write(`✓ Alias already configured in ~/${shellInfo.rcFile}\n`)
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (parsed.command === 'uninstall-alias') {
    const { detectShell, uninstallAlias } = await import('./commands/setup/shell-alias.js')
    const shellInfo = detectShell(process.env.SHELL)
    if (!shellInfo) {
      stdout.write('Unsupported shell. Only zsh and bash are supported.\n')
      return { exitCode: 1, stdout: '', stderr: '' }
    }
    const homeDir = process.env.HOME || ''
    const rcPath = path.join(homeDir, shellInfo.rcFile)
    const result = uninstallAlias(rcPath)
    if (result === 'removed') {
      stdout.write(`✓ Alias removed from ~/${shellInfo.rcFile}\n`)
      stdout.write(`  Run 'unalias sidekick' or open a new terminal to deactivate.\n`)
    } else {
      stdout.write(`No sidekick alias found in ~/${shellInfo.rcFile}\n`)
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
```

**Step 2: Update help text**

Add to `GLOBAL_HELP_TEXT` (search for the commands section):

```
  install-alias            Add 'sidekick' shell alias to ~/.zshrc or ~/.bashrc
  uninstall-alias          Remove 'sidekick' shell alias from shell config
```

**Step 3: Run build and manual test**

Run: `pnpm build && pnpm typecheck`
Run: `pnpm sidekick install-alias` (manual verification)
Run: `pnpm sidekick uninstall-alias` (manual verification)

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/cli.ts
git commit -m "feat(cli): add install-alias and uninstall-alias commands"
```

---

### Task 5: Integrate Alias Removal into Uninstall Flow

**Files:**
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts` (~line 203, before the report step)

**Step 1: Add alias removal step**

After the gitignore cleanup step (~line 228), before the report (~line 230):

```typescript
  // Step 8: Remove shell alias
  if (userDetected) {
    const { detectShell, uninstallAlias } = await import('./setup/shell-alias.js')
    const shellInfo = detectShell(process.env.SHELL)
    if (shellInfo) {
      const rcPath = path.join(userHome, shellInfo.rcFile)
      if (dryRun) {
        actions.push({ scope: 'user', artifact: 'shell alias', path: rcPath, action: 'would-remove' })
      } else {
        const result = uninstallAlias(rcPath)
        actions.push({
          scope: 'user',
          artifact: 'shell alias',
          path: rcPath,
          action: result === 'removed' ? 'removed' : 'not-found',
        })
      }
    }
  }
```

Update the "Step 8: Report" comment to "Step 9: Report".

**Step 2: Run build and tests**

Run: `pnpm build && pnpm typecheck`
Run: `pnpm --filter @sidekick/cli test -- --run uninstall`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts
git commit -m "feat(uninstall): remove shell alias during uninstall"
```

---

### Task 6: Final Verification and Lint

**Step 1: Run full quality gate**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: ALL PASS

**Step 2: Run all CLI package tests**

Run: `pnpm --filter @sidekick/cli test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: ALL PASS

**Step 3: Commit any final fixes, close the bead**

```bash
bd close sidekick-amt0
bd sync
git push
```
