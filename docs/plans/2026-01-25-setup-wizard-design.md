# Setup Wizard Design

> Design doc for `sidekick setup` command (bead sidekick-ii3)

## Overview

Claude Code plugins cannot provide `statusLine` config - only hooks. Users who install sidekick via `/plugin install` get hooks but NOT the statusline. The setup wizard configures statusline and API keys post-install.

## State Files

Two JSON files track setup completion:

| File | Purpose |
|------|---------|
| `~/.sidekick/setup-status.json` | User-scoped: preferences, defaults, key health |
| `.sidekick/setup-status.json` | Project-scoped: steps done, can defer to user |

### API Key Health States

| State | Meaning |
|-------|---------|
| `missing` | Key needed (LLM profiles exist for provider) but not found |
| `not-required` | No LLM profiles configured for this provider |
| `pending-validation` | Key exists but not validated yet |
| `invalid` | Validation API call failed |
| `healthy` | Validation succeeded |
| `user` | (project only) Deferring to user-level key |

### User Setup Status Schema

```typescript
interface UserSetupStatus {
  version: 1
  lastUpdatedAt: string // ISO timestamp
  preferences: {
    autoConfigureProjects: boolean
    defaultStatuslineScope: 'user' | 'project'
    defaultApiKeyScope: 'user' | 'project' | 'skip'
  }
  statusline: 'configured' | 'skipped'
  apiKeys: {
    OPENROUTER_API_KEY: 'missing' | 'not-required' | 'pending-validation' | 'invalid' | 'healthy'
    OPENAI_API_KEY: 'missing' | 'not-required' | 'pending-validation' | 'invalid' | 'healthy'
  }
}
```

### Project Setup Status Schema

```typescript
interface ProjectSetupStatus {
  version: 1
  lastUpdatedAt: string // ISO timestamp
  autoConfigured: boolean
  statusline: 'configured' | 'skipped' | 'user'
  apiKeys: {
    OPENROUTER_API_KEY: 'missing' | 'not-required' | 'pending-validation' | 'invalid' | 'healthy' | 'user'
    OPENAI_API_KEY: 'missing' | 'not-required' | 'pending-validation' | 'invalid' | 'healthy' | 'user'
  }
}
```

## Commands

- `sidekick setup` - Full interactive wizard
- `sidekick setup --check` or `sidekick doctor` - Non-interactive status check

## Interactive Flow

```
┌─────────────────────────────────────────────────────────┐
│  Sidekick Setup Wizard                                  │
│                                                         │
│  This wizard configures sidekick for Claude Code.       │
│  Run 'sidekick setup' again anytime to reconfigure.     │
└─────────────────────────────────────────────────────────┘

Step 1: Statusline Configuration
────────────────────────────────
Claude Code plugins can't provide statusline config directly.
Where should sidekick configure your statusline?

  › User-level (~/.claude/settings.json) - works in all projects
    Project-level (.claude/settings.local.json) - this project only

Step 2: Persona Features
────────────────────────
Sidekick includes AI personas (Marvin, GLaDOS, Skippy, etc.) that add
personality to your coding sessions with snarky messages and contextual nudges.

These require an OpenRouter API key (small cost per message).

Enable persona features?
  › Yes, I want personas (requires API key)
    No, disable personas

[If No]:
  Disable personas for:
    › All projects (user-level config)
      This project only

  → Writes config to disable personas, marks keys as 'not-required'

[If Yes]:
  Checking for OPENROUTER_API_KEY...
    ✗ Not found in environment or ~/.sidekick/.env

  Configure API key now?
    › Yes, enter key now
      Skip for now

  [If Skip]:
    ⚠ Persona features will show warnings in the statusline until
      an API key is configured. Run 'sidekick setup' again or ask
      Claude to help configure API keys using /sidekick-config.

  [If Yes]:
    Where should the API key be stored?
      › User-level (~/.sidekick/.env) - works in all projects
        Project-level (.sidekick/.env) - this project only

    Paste your OpenRouter API key: sk-or-v1-████████
    Validating... ✓ Key is valid!

Step 3: Project Auto-Configuration
──────────────────────────────────
When sidekick runs in a new project for the first time:

  › Auto-configure using my defaults (recommended)
    Ask me each time
    Do nothing (manual setup only)

Step 4: Summary
───────────────
✓ Statusline: User-level (~/.claude/settings.json)
✓ Personas: Enabled
✓ API Key: Configured and healthy (user-level)
✓ Auto-configure: Enabled for new projects

Restart Claude Code to see your statusline: claude --continue
```

## SetupStatusService

Location: `packages/core/src/services/setup-status-service.ts`

```typescript
export class SetupStatusService {
  constructor(
    private readonly projectDir: string,
    private readonly homeDir: string = os.homedir()
  ) {}

  // === Low-level access (for setup wizard) ===
  async getUserStatus(): Promise<UserSetupStatus | null>
  async getProjectStatus(): Promise<ProjectSetupStatus | null>
  async writeUserStatus(status: UserSetupStatus): Promise<void>
  async writeProjectStatus(status: ProjectSetupStatus): Promise<void>
  async updateUserStatus(updates: Partial<UserSetupStatus>): Promise<void>
  async updateProjectStatus(updates: Partial<ProjectSetupStatus>): Promise<void>

  // === Merged getters (for consumers) ===

  /** Effective statusline state: configured | skipped | not-setup */
  async getStatuslineHealth(): Promise<'configured' | 'skipped' | 'not-setup'>

  /** Effective API key health, merging project → user */
  async getApiKeyHealth(key: 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY'): Promise<ApiKeyHealth>

  /** Is setup complete enough to function? */
  async isHealthy(): Promise<boolean>

  // === Helpers for auto-config ===
  async shouldAutoConfigureProject(): Promise<boolean>
  async setApiKeyHealth(key: string, health: ApiKeyHealth, scope: 'user' | 'project'): Promise<void>
}
```

Consumers use merged getters and don't need to know about user/project scope:

```typescript
const setupService = new SetupStatusService(projectDir)
const keyHealth = await setupService.getApiKeyHealth('OPENROUTER_API_KEY')
if (keyHealth === 'missing' || keyHealth === 'invalid') {
  // Show warning indicator in statusline
}
```

## Auto-Configuration

Trigger: During `SessionStart` hook execution

```typescript
async function maybeAutoConfigureProject(projectDir: string, logger: Logger): Promise<void> {
  const setupService = new SetupStatusService(projectDir)

  if (!await setupService.shouldAutoConfigureProject()) {
    return
  }

  logger.info('Auto-configuring project from user defaults')

  const user = await setupService.getUserStatus()
  const projectSetup: ProjectSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    autoConfigured: true,
    statusline: user.preferences.defaultStatuslineScope === 'user'
      ? 'user'
      : 'configured', // Will also write to settings.local.json
    apiKeys: {
      OPENROUTER_API_KEY: user.apiKeys.OPENROUTER_API_KEY === 'healthy' ? 'user' : user.apiKeys.OPENROUTER_API_KEY,
      OPENAI_API_KEY: user.apiKeys.OPENAI_API_KEY === 'healthy' ? 'user' : user.apiKeys.OPENAI_API_KEY,
    }
  }

  await setupService.writeProjectStatus(projectSetup)

  if (user.preferences.defaultStatuslineScope === 'project') {
    await configureStatusline(projectDir, 'project')
  }
}
```

## Implementation Files

| File | Purpose |
|------|---------|
| `packages/core/src/services/setup-status-service.ts` | SetupStatusService class |
| `packages/types/src/setup-status.ts` | Schema types & Zod validators |
| `packages/sidekick-cli/src/commands/setup.ts` | Main command handler |
| `packages/sidekick-cli/src/commands/doctor.ts` | Alias to setup --check |

## Key Operations

| Operation | Implementation |
|-----------|----------------|
| Write statusline to settings.json | Read existing JSON, merge `statusLine` key, write back |
| Write API key to .env | Append `OPENROUTER_API_KEY=...` to file |
| Validate API key | `fetch('https://openrouter.ai/api/v1/models')` with auth header |
| Disable personas | Write `features.personas.enabled: false` to sidekick.yaml |
| Detect key requirement | Check ConfigService for LLM profiles using each provider |

## Settings.json Merge Strategy

```typescript
// Read existing
const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))

// Add statusline (don't touch other keys)
settings.statusLine = {
  type: 'command',
  command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'
}

// Write back with formatting preserved
await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
```

## Testing Strategy

### Unit Tests

**SetupStatusService:**
- Merged getters return correct values for user/project combinations
- `shouldAutoConfigureProject` logic
- Write operations create directories and update timestamps

**Setup command:**
- Interactive flow with mocked stdin/stdout
- API key validation (mocked fetch)
- Writes correct status files on completion

**Doctor mode:**
- Reports healthy/unhealthy states correctly

### Integration Test (Manual)

```bash
# Fresh install flow
rm -rf ~/.sidekick/setup-status.json
rm -rf .sidekick/setup-status.json
pnpm sidekick setup
# Verify: statusline appears after claude --continue

# Auto-configure new project
cd /tmp/new-project && git init
claude  # Should auto-configure from user defaults
cat .sidekick/setup-status.json  # Verify autoConfigured: true
```

## Acceptance Criteria

- [x] `sidekick setup` walks through interactive setup
- [ ] `sidekick doctor` reports setup health
- [ ] Statusline appears after setup + Claude restart
- [ ] Auto-configuration works for new projects when enabled
- [ ] API key validation works with OpenRouter
- [ ] Build passes. Typecheck passes. Tests pass.
