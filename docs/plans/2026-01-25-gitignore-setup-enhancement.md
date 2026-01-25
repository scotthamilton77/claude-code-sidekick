# Gitignore Setup Enhancement

> Enhancement to setup wizard for automatic `.gitignore` management (bead sidekick-xyr)
>
> **Depends on:** sidekick-ii3 (Setup Wizard)

## Problem

When sidekick runs in a project, it creates `.sidekick/logs/` and `.sidekick/sessions/` directories. These contain transient data that shouldn't be version-controlled, but users discovered these showing up as untracked files in git.

## Scope

### What to ignore

| Path | Reason |
|------|--------|
| `.sidekick/logs/` | Transient log files |
| `.sidekick/sessions/` | Session-specific state, staging files |
| `.sidekick/state/` | Runtime state |
| `.sidekick/.env` | API keys (security) |
| `.sidekick/.env.local` | Local API key overrides (security) |

### What NOT to ignore

| Path | Reason |
|------|--------|
| `.sidekick/*.yaml` | Config files users may want to version |
| `.sidekick/sidekick.config` | Unified config |
| `.sidekick/setup-status.json` | Setup state (could go either way) |

## Schema Changes

Add to `ProjectSetupStatus`:

```typescript
interface ProjectSetupStatus {
  // ... existing fields ...
  gitignore: 'unknown' | 'missing' | 'installed'
}
```

| State | Meaning |
|-------|---------|
| `unknown` | Setup hasn't checked yet (legacy projects) |
| `missing` | User declined or entries not present |
| `installed` | Sidekick section present in .gitignore |

## Force Mode Enhancement

Add `--force` flag to setup command for non-interactive use:

```bash
sidekick setup --force   # Apply all recommended settings without prompts
```

When `--force` is set:
- Skip all confirmation prompts
- Apply recommended defaults (install gitignore, user-level statusline, etc.)
- Useful for CI/CD, scripting, or users who just want "do the right thing"

## Gitignore Section Format

Use comment markers for easy identification and removal:

```gitignore
# >>> sidekick
.sidekick/logs/
.sidekick/sessions/
.sidekick/state/
.sidekick/.env
.sidekick/.env.local
# <<< sidekick
```

This allows:
- Detection: Check if section already exists
- Updates: Replace section content if entries change
- Removal: Clean removal via `sidekick uninstall` or similar

## Implementation

### Core function

```typescript
const SIDEKICK_SECTION_START = '# >>> sidekick'
const SIDEKICK_SECTION_END = '# <<< sidekick'

const GITIGNORE_ENTRIES = [
  '.sidekick/logs/',
  '.sidekick/sessions/',
  '.sidekick/state/',
  '.sidekick/.env',
  '.sidekick/.env.local',
]

interface GitignoreResult {
  status: 'installed' | 'already-installed' | 'error'
  entriesAdded?: string[]
  error?: string
}

async function installGitignoreSection(projectDir: string): Promise<GitignoreResult> {
  const gitignorePath = join(projectDir, '.gitignore')

  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf-8')
  } catch {
    // File doesn't exist, will create
  }

  // Check if section already exists
  if (content.includes(SIDEKICK_SECTION_START)) {
    return { status: 'already-installed' }
  }

  // Build section
  const section = [
    '',
    SIDEKICK_SECTION_START,
    ...GITIGNORE_ENTRIES,
    SIDEKICK_SECTION_END,
  ].join('\n')

  const newContent = content.trimEnd() + section + '\n'
  await writeFile(gitignorePath, newContent)

  return { status: 'installed', entriesAdded: GITIGNORE_ENTRIES }
}

async function removeGitignoreSection(projectDir: string): Promise<boolean> {
  const gitignorePath = join(projectDir, '.gitignore')

  try {
    const content = await readFile(gitignorePath, 'utf-8')

    const startIdx = content.indexOf(SIDEKICK_SECTION_START)
    const endIdx = content.indexOf(SIDEKICK_SECTION_END)

    if (startIdx === -1 || endIdx === -1) {
      return false // Section not found
    }

    // Remove section including markers and surrounding newlines
    const before = content.slice(0, startIdx).trimEnd()
    const after = content.slice(endIdx + SIDEKICK_SECTION_END.length).trimStart()

    const newContent = before + (after ? '\n' + after : '\n')
    await writeFile(gitignorePath, newContent)

    return true
  } catch {
    return false
  }
}

function detectGitignoreStatus(projectDir: string): Promise<'installed' | 'missing'> {
  const gitignorePath = join(projectDir, '.gitignore')
  try {
    const content = await readFile(gitignorePath, 'utf-8')
    return content.includes(SIDEKICK_SECTION_START) ? 'installed' : 'missing'
  } catch {
    return 'missing'
  }
}
```

## Wizard Flow Integration

After Step 1 (Statusline), before Persona Features:

```
Step 2: Git Configuration
─────────────────────────
Sidekick creates logs and session data that shouldn't be committed.

Update .gitignore to exclude sidekick's transient files?
  › Yes, update .gitignore (recommended)
    No, I'll manage it myself

[If Yes]:
  ✓ Added sidekick section to .gitignore

[If already installed]:
  ✓ Sidekick entries already present in .gitignore
```

With `--force` flag, this step is skipped and gitignore is installed automatically.

## Auto-Configuration Behavior

When auto-configuring a new project (not part of this enhancement, but for reference):

```typescript
// Auto-config always installs gitignore (it's safe and recommended)
const result = await installGitignoreSection(projectDir)
projectSetup.gitignore = result.status === 'error' ? 'missing' : 'installed'
```

## Doctor Output

```
$ sidekick doctor

Sidekick Health Check
─────────────────────
✓ Statusline: Configured (user-level)
✓ API Keys: OPENROUTER_API_KEY healthy
⚠ Gitignore: Not configured
  Run 'sidekick setup' to add recommended .gitignore entries
```

## Testing

### Unit tests

- `installGitignoreSection` creates file if missing
- `installGitignoreSection` is idempotent (returns already-installed)
- `installGitignoreSection` preserves existing content
- `removeGitignoreSection` cleanly removes section
- `detectGitignoreStatus` returns correct state
- Force mode skips prompts and applies defaults

### Manual test

```bash
# Fresh setup
rm .gitignore 2>/dev/null
pnpm sidekick setup
cat .gitignore  # Verify sidekick section

# Idempotent
pnpm sidekick setup
cat .gitignore  # Verify no duplicates

# Force mode
rm .sidekick/setup-status.json
pnpm sidekick setup --force
# Verify no prompts, gitignore installed

# Remove
# (future: sidekick uninstall --gitignore)
```

## Acceptance Criteria

- [ ] Setup wizard includes gitignore step (interactive unless --force)
- [ ] Gitignore status tracked in project setup-status.json
- [ ] Section uses start/end markers for clean removal
- [ ] `--force` flag enables non-interactive setup
- [ ] Doctor reports gitignore health
- [ ] Idempotent - running multiple times doesn't duplicate
- [ ] Build passes. Typecheck passes. Tests pass.
