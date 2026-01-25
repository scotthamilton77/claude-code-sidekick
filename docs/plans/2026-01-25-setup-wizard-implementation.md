# Setup Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `sidekick setup` command that configures statusline and API keys post-plugin-install.

**Architecture:** SetupStatusService in sidekick-core manages dual-scope (user/project) state files with merged getters. Setup command in sidekick-cli provides interactive wizard. Auto-configuration triggers on SessionStart hook for new projects.

**Tech Stack:** Node.js readline for prompts, fetch for API validation, Zod for schemas, existing StateService patterns.

---

## Task 1: Setup Status Types & Schemas

**Files:**
- Create: `packages/types/src/setup-status.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the type definitions**

```typescript
// packages/types/src/setup-status.ts
import { z } from 'zod'

/**
 * API key health states for setup status tracking.
 */
export const ApiKeyHealthSchema = z.enum([
  'missing',           // Key needed but not found
  'not-required',      // No LLM profiles configured for provider
  'pending-validation', // Key exists but not validated
  'invalid',           // Validation failed
  'healthy',           // Validation succeeded
])
export type ApiKeyHealth = z.infer<typeof ApiKeyHealthSchema>

/**
 * Project-level API key health (adds 'user' option).
 */
export const ProjectApiKeyHealthSchema = z.enum([
  'missing',
  'not-required',
  'pending-validation',
  'invalid',
  'healthy',
  'user', // Deferring to user-level
])
export type ProjectApiKeyHealth = z.infer<typeof ProjectApiKeyHealthSchema>

/**
 * User-level setup status stored in ~/.sidekick/setup-status.json
 */
export const UserSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  preferences: z.object({
    autoConfigureProjects: z.boolean(),
    defaultStatuslineScope: z.enum(['user', 'project']),
    defaultApiKeyScope: z.enum(['user', 'project', 'skip']),
  }),
  statusline: z.enum(['configured', 'skipped']),
  apiKeys: z.object({
    OPENROUTER_API_KEY: ApiKeyHealthSchema,
    OPENAI_API_KEY: ApiKeyHealthSchema,
  }),
})
export type UserSetupStatus = z.infer<typeof UserSetupStatusSchema>

/**
 * Project-level setup status stored in .sidekick/setup-status.json
 */
export const ProjectSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  autoConfigured: z.boolean(),
  statusline: z.enum(['configured', 'skipped', 'user']),
  apiKeys: z.object({
    OPENROUTER_API_KEY: ProjectApiKeyHealthSchema,
    OPENAI_API_KEY: ProjectApiKeyHealthSchema,
  }),
})
export type ProjectSetupStatus = z.infer<typeof ProjectSetupStatusSchema>
```

**Step 2: Export from types index**

```typescript
// Add to packages/types/src/index.ts
export * from './setup-status.js'
```

**Step 3: Build types package**

Run: `pnpm --filter @sidekick/types build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/types/src/setup-status.ts packages/types/src/index.ts
git commit -m "feat(types): add setup status schemas"
```

---

## Task 2: SetupStatusService - Core Implementation

**Files:**
- Create: `packages/sidekick-core/src/setup-status-service.ts`
- Modify: `packages/sidekick-core/src/index.ts`

**Step 1: Write the service**

```typescript
// packages/sidekick-core/src/setup-status-service.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import {
  UserSetupStatusSchema,
  ProjectSetupStatusSchema,
  type UserSetupStatus,
  type ProjectSetupStatus,
  type ApiKeyHealth,
  type ProjectApiKeyHealth,
} from '@sidekick/types'

export type ApiKeyName = 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY'

export interface SetupStatusServiceOptions {
  homeDir?: string
  logger?: Logger
}

/**
 * SetupStatusService - Manages dual-scope setup status files.
 *
 * User-level: ~/.sidekick/setup-status.json
 * Project-level: .sidekick/setup-status.json
 *
 * Provides merged getters so consumers don't need to know about scope.
 */
export class SetupStatusService {
  private readonly projectDir: string
  private readonly homeDir: string
  private readonly logger?: Logger

  constructor(projectDir: string, options?: SetupStatusServiceOptions) {
    this.projectDir = projectDir
    this.homeDir = options?.homeDir ?? os.homedir()
    this.logger = options?.logger
  }

  // === Paths ===

  private get userStatusPath(): string {
    return path.join(this.homeDir, '.sidekick', 'setup-status.json')
  }

  private get projectStatusPath(): string {
    return path.join(this.projectDir, '.sidekick', 'setup-status.json')
  }

  // === Low-level read/write ===

  async getUserStatus(): Promise<UserSetupStatus | null> {
    try {
      const content = await fs.readFile(this.userStatusPath, 'utf-8')
      const parsed = UserSetupStatusSchema.safeParse(JSON.parse(content))
      if (!parsed.success) {
        this.logger?.warn('Invalid user setup status', { error: parsed.error })
        return null
      }
      return parsed.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  async getProjectStatus(): Promise<ProjectSetupStatus | null> {
    try {
      const content = await fs.readFile(this.projectStatusPath, 'utf-8')
      const parsed = ProjectSetupStatusSchema.safeParse(JSON.parse(content))
      if (!parsed.success) {
        this.logger?.warn('Invalid project setup status', { error: parsed.error })
        return null
      }
      return parsed.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  async writeUserStatus(status: UserSetupStatus): Promise<void> {
    const validated = UserSetupStatusSchema.parse(status)
    const dir = path.dirname(this.userStatusPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.userStatusPath, JSON.stringify(validated, null, 2) + '\n')
    this.logger?.debug('User setup status written', { path: this.userStatusPath })
  }

  async writeProjectStatus(status: ProjectSetupStatus): Promise<void> {
    const validated = ProjectSetupStatusSchema.parse(status)
    const dir = path.dirname(this.projectStatusPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.projectStatusPath, JSON.stringify(validated, null, 2) + '\n')
    this.logger?.debug('Project setup status written', { path: this.projectStatusPath })
  }

  async updateUserStatus(updates: Partial<Omit<UserSetupStatus, 'version'>>): Promise<void> {
    const current = await this.getUserStatus()
    if (!current) {
      throw new Error('Cannot update user status: no existing status found')
    }
    const updated: UserSetupStatus = {
      ...current,
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    }
    await this.writeUserStatus(updated)
  }

  async updateProjectStatus(updates: Partial<Omit<ProjectSetupStatus, 'version'>>): Promise<void> {
    const current = await this.getProjectStatus()
    if (!current) {
      throw new Error('Cannot update project status: no existing status found')
    }
    const updated: ProjectSetupStatus = {
      ...current,
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    }
    await this.writeProjectStatus(updated)
  }

  // === Merged getters ===

  async getStatuslineHealth(): Promise<'configured' | 'skipped' | 'not-setup'> {
    const project = await this.getProjectStatus()
    if (project?.statusline === 'configured') return 'configured'
    if (project?.statusline === 'skipped') return 'skipped'
    if (project?.statusline === 'user') {
      const user = await this.getUserStatus()
      return user?.statusline ?? 'not-setup'
    }
    // No project status, check user directly
    const user = await this.getUserStatus()
    return user?.statusline ?? 'not-setup'
  }

  async getApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth | 'user'> {
    const project = await this.getProjectStatus()
    const projectHealth = project?.apiKeys[key]
    if (projectHealth && projectHealth !== 'user') {
      return projectHealth
    }
    // Project says 'user' or no project status - check user
    const user = await this.getUserStatus()
    return user?.apiKeys[key] ?? 'missing'
  }

  async getEffectiveApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth> {
    const health = await this.getApiKeyHealth(key)
    // 'user' means we should look at user level, which we already did
    return health === 'user' ? 'missing' : health
  }

  async isHealthy(): Promise<boolean> {
    const statusline = await this.getStatuslineHealth()
    const openrouterKey = await this.getEffectiveApiKeyHealth('OPENROUTER_API_KEY')
    return (
      statusline === 'configured' &&
      (openrouterKey === 'healthy' || openrouterKey === 'not-required')
    )
  }

  // === Auto-config helpers ===

  async isUserSetupComplete(): Promise<boolean> {
    const user = await this.getUserStatus()
    return user !== null
  }

  async isProjectConfigured(): Promise<boolean> {
    const project = await this.getProjectStatus()
    return project !== null
  }

  async shouldAutoConfigureProject(): Promise<boolean> {
    const user = await this.getUserStatus()
    if (!user?.preferences.autoConfigureProjects) {
      return false
    }
    return !(await this.isProjectConfigured())
  }

  async setApiKeyHealth(
    key: ApiKeyName,
    health: ApiKeyHealth | ProjectApiKeyHealth,
    scope: 'user' | 'project'
  ): Promise<void> {
    if (scope === 'user') {
      const current = await this.getUserStatus()
      if (!current) {
        throw new Error('Cannot update API key health: no user status found')
      }
      await this.updateUserStatus({
        apiKeys: { ...current.apiKeys, [key]: health as ApiKeyHealth },
      })
    } else {
      const current = await this.getProjectStatus()
      if (!current) {
        throw new Error('Cannot update API key health: no project status found')
      }
      await this.updateProjectStatus({
        apiKeys: { ...current.apiKeys, [key]: health as ProjectApiKeyHealth },
      })
    }
  }
}
```

**Step 2: Export from core index**

```typescript
// Add to packages/sidekick-core/src/index.ts
export { SetupStatusService, type SetupStatusServiceOptions, type ApiKeyName } from './setup-status-service.js'
```

**Step 3: Build core package**

Run: `pnpm --filter @sidekick/core build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/sidekick-core/src/setup-status-service.ts packages/sidekick-core/src/index.ts
git commit -m "feat(core): add SetupStatusService for setup state management"
```

---

## Task 3: SetupStatusService Tests

**Files:**
- Create: `packages/sidekick-core/src/__tests__/setup-status-service.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sidekick-core/src/__tests__/setup-status-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { SetupStatusService } from '../setup-status-service.js'
import type { UserSetupStatus, ProjectSetupStatus } from '@sidekick/types'

describe('SetupStatusService', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let service: SetupStatusService

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-status-test-'))
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(homeDir, { recursive: true })
    service = new SetupStatusService(projectDir, { homeDir })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createUserStatus = (overrides?: Partial<UserSetupStatus>): UserSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: true,
      defaultStatuslineScope: 'user',
      defaultApiKeyScope: 'user',
    },
    statusline: 'configured',
    apiKeys: {
      OPENROUTER_API_KEY: 'healthy',
      OPENAI_API_KEY: 'not-required',
    },
    ...overrides,
  })

  const createProjectStatus = (overrides?: Partial<ProjectSetupStatus>): ProjectSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    autoConfigured: false,
    statusline: 'user',
    apiKeys: {
      OPENROUTER_API_KEY: 'user',
      OPENAI_API_KEY: 'user',
    },
    ...overrides,
  })

  describe('getUserStatus / getProjectStatus', () => {
    it('returns null when no status file exists', async () => {
      expect(await service.getUserStatus()).toBeNull()
      expect(await service.getProjectStatus()).toBeNull()
    })

    it('reads and parses valid status files', async () => {
      const userStatus = createUserStatus()
      await service.writeUserStatus(userStatus)
      const result = await service.getUserStatus()
      expect(result?.statusline).toBe('configured')
    })
  })

  describe('merged getters', () => {
    it('returns user statusline when project is "user"', async () => {
      await service.writeUserStatus(createUserStatus({ statusline: 'configured' }))
      await service.writeProjectStatus(createProjectStatus({ statusline: 'user' }))
      expect(await service.getStatuslineHealth()).toBe('configured')
    })

    it('returns project statusline when explicitly configured', async () => {
      await service.writeUserStatus(createUserStatus({ statusline: 'skipped' }))
      await service.writeProjectStatus(createProjectStatus({ statusline: 'configured' }))
      expect(await service.getStatuslineHealth()).toBe('configured')
    })

    it('returns user API key health when project is "user"', async () => {
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' } })
      )
      await service.writeProjectStatus(
        createProjectStatus({ apiKeys: { OPENROUTER_API_KEY: 'user', OPENAI_API_KEY: 'user' } })
      )
      expect(await service.getApiKeyHealth('OPENROUTER_API_KEY')).toBe('healthy')
    })

    it('returns "not-setup" when no status files exist', async () => {
      expect(await service.getStatuslineHealth()).toBe('not-setup')
    })
  })

  describe('shouldAutoConfigureProject', () => {
    it('returns true when user opted in and project not configured', async () => {
      await service.writeUserStatus(createUserStatus({ preferences: { autoConfigureProjects: true, defaultStatuslineScope: 'user', defaultApiKeyScope: 'user' } }))
      expect(await service.shouldAutoConfigureProject()).toBe(true)
    })

    it('returns false when user opted out', async () => {
      await service.writeUserStatus(createUserStatus({ preferences: { autoConfigureProjects: false, defaultStatuslineScope: 'user', defaultApiKeyScope: 'user' } }))
      expect(await service.shouldAutoConfigureProject()).toBe(false)
    })

    it('returns false when project already configured', async () => {
      await service.writeUserStatus(createUserStatus({ preferences: { autoConfigureProjects: true, defaultStatuslineScope: 'user', defaultApiKeyScope: 'user' } }))
      await service.writeProjectStatus(createProjectStatus())
      expect(await service.shouldAutoConfigureProject()).toBe(false)
    })
  })

  describe('isHealthy', () => {
    it('returns true when statusline configured and key healthy', async () => {
      await service.writeUserStatus(
        createUserStatus({ statusline: 'configured', apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' } })
      )
      expect(await service.isHealthy()).toBe(true)
    })

    it('returns false when key is missing', async () => {
      await service.writeUserStatus(
        createUserStatus({ statusline: 'configured', apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' } })
      )
      expect(await service.isHealthy()).toBe(false)
    })
  })
})
```

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/core test -- src/__tests__/setup-status-service.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/sidekick-core/src/__tests__/setup-status-service.test.ts
git commit -m "test(core): add SetupStatusService tests"
```

---

## Task 4: API Key Validation Utility

**Files:**
- Create: `packages/sidekick-cli/src/commands/setup/validate-api-key.ts`

**Step 1: Write the validation function**

```typescript
// packages/sidekick-cli/src/commands/setup/validate-api-key.ts
import type { Logger } from '@sidekick/types'

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string }

/**
 * Validate OpenRouter API key by calling the models endpoint.
 * This is a free endpoint that doesn't consume credits.
 */
export async function validateOpenRouterKey(
  apiKey: string,
  logger?: Logger
): Promise<ValidationResult> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: `API returned status ${response.status}` }
  } catch (err) {
    logger?.warn('API key validation failed', { error: err })
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Validate OpenAI API key by calling the models endpoint.
 */
export async function validateOpenAIKey(
  apiKey: string,
  logger?: Logger
): Promise<ValidationResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: `API returned status ${response.status}` }
  } catch (err) {
    logger?.warn('API key validation failed', { error: err })
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
```

**Step 2: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/validate-api-key.ts
git commit -m "feat(cli): add API key validation utilities"
```

---

## Task 5: Setup Command - Prompt Utilities

**Files:**
- Create: `packages/sidekick-cli/src/commands/setup/prompts.ts`

**Step 1: Write the prompt utilities**

```typescript
// packages/sidekick-cli/src/commands/setup/prompts.ts
import * as readline from 'node:readline'

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

export interface PromptContext {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
}

/**
 * Display a header/title section.
 */
export function printHeader(ctx: PromptContext, title: string, description?: string): void {
  ctx.stdout.write('\n')
  ctx.stdout.write(`${colors.bold}${title}${colors.reset}\n`)
  ctx.stdout.write('─'.repeat(Math.min(title.length + 10, 60)) + '\n')
  if (description) {
    ctx.stdout.write(`${colors.dim}${description}${colors.reset}\n`)
  }
  ctx.stdout.write('\n')
}

/**
 * Display a status message with icon.
 */
export function printStatus(
  ctx: PromptContext,
  type: 'success' | 'warning' | 'info' | 'error',
  message: string
): void {
  const icons = { success: '✓', warning: '⚠', info: '•', error: '✗' }
  const colorMap = { success: colors.green, warning: colors.yellow, info: colors.blue, error: '\x1b[31m' }
  ctx.stdout.write(`${colorMap[type]}${icons[type]}${colors.reset} ${message}\n`)
}

/**
 * Prompt for single-choice selection.
 */
export async function promptSelect(
  ctx: PromptContext,
  question: string,
  options: Array<{ value: string; label: string; description?: string }>
): Promise<string> {
  ctx.stdout.write(`${question}\n\n`)

  options.forEach((opt, i) => {
    ctx.stdout.write(`  ${colors.cyan}${i + 1})${colors.reset} ${opt.label}\n`)
    if (opt.description) {
      ctx.stdout.write(`     ${colors.dim}${opt.description}${colors.reset}\n`)
    }
  })

  ctx.stdout.write('\n')

  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`Enter choice (1-${options.length}): `)
    rl.once('line', (answer) => {
      rl.close()
      const num = parseInt(answer.trim(), 10)
      if (num >= 1 && num <= options.length) {
        resolve(options[num - 1].value)
      } else {
        // Default to first option
        resolve(options[0].value)
      }
    })
  })
}

/**
 * Prompt for yes/no confirmation.
 */
export async function promptConfirm(
  ctx: PromptContext,
  question: string,
  defaultYes = true
): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'

  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`${question} ${hint} `)
    rl.once('line', (answer) => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      if (normalized === '') {
        resolve(defaultYes)
      } else {
        resolve(normalized === 'y' || normalized === 'yes')
      }
    })
  })
}

/**
 * Prompt for text input (e.g., API key).
 */
export async function promptInput(
  ctx: PromptContext,
  question: string,
  options?: { mask?: boolean }
): Promise<string> {
  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`${question}: `)
    rl.once('line', (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
```

**Step 2: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/prompts.ts
git commit -m "feat(cli): add setup wizard prompt utilities"
```

---

## Task 6: Setup Command - Main Handler

**Files:**
- Create: `packages/sidekick-cli/src/commands/setup/index.ts`
- Create: `packages/sidekick-cli/src/commands/setup.ts` (re-export)

**Step 1: Write the main setup command handler**

```typescript
// packages/sidekick-cli/src/commands/setup/index.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus, ApiKeyHealth } from '@sidekick/types'
import { SetupStatusService } from '@sidekick/core'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput, type PromptContext } from './prompts.js'
import { validateOpenRouterKey } from './validate-api-key.js'

export interface SetupCommandOptions {
  checkOnly?: boolean
  stdin?: NodeJS.ReadableStream
}

export interface SetupCommandResult {
  exitCode: number
  output?: string
}

const STATUSLINE_COMMAND = 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'

/**
 * Write statusline config to Claude Code settings.json
 */
async function configureStatusline(settingsPath: string, logger?: Logger): Promise<void> {
  let settings: Record<string, unknown> = {}

  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    settings = JSON.parse(content) as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
    // File doesn't exist, start fresh
  }

  settings.statusLine = {
    type: 'command',
    command: STATUSLINE_COMMAND,
  }

  const dir = path.dirname(settingsPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  logger?.info('Statusline configured', { path: settingsPath })
}

/**
 * Write API key to .env file
 */
async function writeApiKeyToEnv(envPath: string, key: string, value: string): Promise<void> {
  const dir = path.dirname(envPath)
  await fs.mkdir(dir, { recursive: true })

  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf-8')
  } catch {
    // File doesn't exist
  }

  // Check if key already exists
  const keyRegex = new RegExp(`^${key}=.*$`, 'm')
  if (keyRegex.test(content)) {
    // Replace existing
    content = content.replace(keyRegex, `${key}=${value}`)
  } else {
    // Append
    if (content && !content.endsWith('\n')) {
      content += '\n'
    }
    content += `${key}=${value}\n`
  }

  await fs.writeFile(envPath, content)
}

/**
 * Check if API key exists in environment or .env files
 */
async function findExistingApiKey(keyName: string, homeDir: string, projectDir: string): Promise<string | null> {
  // Check environment variable
  if (process.env[keyName]) {
    return process.env[keyName]!
  }

  // Check .env files
  const envPaths = [
    path.join(homeDir, '.sidekick', '.env'),
    path.join(projectDir, '.sidekick', '.env'),
    path.join(projectDir, '.sidekick', '.env.local'),
  ]

  for (const envPath of envPaths) {
    try {
      const content = await fs.readFile(envPath, 'utf-8')
      const match = content.match(new RegExp(`^${keyName}=(.+)$`, 'm'))
      if (match) {
        return match[1]
      }
    } catch {
      // File doesn't exist
    }
  }

  return null
}

/**
 * Run the interactive setup wizard
 */
async function runWizard(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions
): Promise<SetupCommandResult> {
  const ctx: PromptContext = {
    stdin: options.stdin ?? process.stdin,
    stdout,
  }
  const homeDir = os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  // Header
  stdout.write('\n┌─────────────────────────────────────────────────────────┐\n')
  stdout.write('│  Sidekick Setup Wizard                                  │\n')
  stdout.write('│                                                         │\n')
  stdout.write('│  This wizard configures sidekick for Claude Code.       │\n')
  stdout.write('│  Run \'sidekick setup\' again anytime to reconfigure.     │\n')
  stdout.write('└─────────────────────────────────────────────────────────┘\n')

  // === Step 1: Statusline ===
  printHeader(ctx, 'Step 1: Statusline Configuration', 'Claude Code plugins cannot provide statusline config directly.')

  const statuslineScope = await promptSelect(ctx, 'Where should sidekick configure your statusline?', [
    { value: 'user', label: 'User-level (~/.claude/settings.json)', description: 'Works in all projects' },
    { value: 'project', label: 'Project-level (.claude/settings.local.json)', description: 'This project only' },
  ])

  // Configure statusline
  const statuslinePath =
    statuslineScope === 'user'
      ? path.join(homeDir, '.claude', 'settings.json')
      : path.join(projectDir, '.claude', 'settings.local.json')

  await configureStatusline(statuslinePath, logger)
  printStatus(ctx, 'success', `Statusline configured in ${statuslinePath}`)

  // === Step 2: Personas ===
  printHeader(
    ctx,
    'Step 2: Persona Features',
    'Sidekick includes AI personas (Marvin, GLaDOS, Skippy, etc.) that add\npersonality to your coding sessions with snarky messages and contextual nudges.'
  )

  stdout.write('These require an OpenRouter API key (small cost per message).\n\n')

  const wantPersonas = await promptConfirm(ctx, 'Enable persona features?', true)

  let apiKeyHealth: ApiKeyHealth = 'not-required'

  if (!wantPersonas) {
    // TODO: Write config to disable personas
    printStatus(ctx, 'info', 'Personas disabled')
  } else {
    // Check for existing key
    const existingKey = await findExistingApiKey('OPENROUTER_API_KEY', homeDir, projectDir)

    if (existingKey) {
      printStatus(ctx, 'success', 'OPENROUTER_API_KEY found')
      stdout.write('Validating... ')
      const result = await validateOpenRouterKey(existingKey, logger)
      if (result.valid) {
        stdout.write('valid!\n')
        apiKeyHealth = 'healthy'
      } else {
        stdout.write(`invalid (${result.error})\n`)
        apiKeyHealth = 'invalid'
      }
    } else {
      printStatus(ctx, 'warning', 'OPENROUTER_API_KEY not found')

      const configureNow = await promptConfirm(ctx, 'Configure API key now?', true)

      if (configureNow) {
        const keyScope = await promptSelect(ctx, 'Where should the API key be stored?', [
          { value: 'user', label: 'User-level (~/.sidekick/.env)', description: 'Works in all projects' },
          { value: 'project', label: 'Project-level (.sidekick/.env)', description: 'This project only' },
        ])

        const apiKey = await promptInput(ctx, 'Paste your OpenRouter API key')

        stdout.write('Validating... ')
        const result = await validateOpenRouterKey(apiKey, logger)

        if (result.valid) {
          stdout.write('valid!\n')
          const envPath =
            keyScope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
          await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
          printStatus(ctx, 'success', `API key saved to ${envPath}`)
          apiKeyHealth = 'healthy'
        } else {
          stdout.write(`invalid (${result.error})\n`)
          printStatus(ctx, 'warning', 'API key validation failed, saving anyway')
          const envPath =
            keyScope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
          await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
          apiKeyHealth = 'invalid'
        }
      } else {
        stdout.write('\n')
        printStatus(
          ctx,
          'warning',
          'Persona features will show warnings in the statusline until an API key is configured.'
        )
        stdout.write("Run 'sidekick setup' again or ask Claude to help configure API keys using /sidekick-config.\n")
        apiKeyHealth = 'missing'
      }
    }
  }

  // === Step 3: Auto-configure ===
  printHeader(ctx, 'Step 3: Project Auto-Configuration')

  const autoConfig = await promptSelect(ctx, 'When sidekick runs in a new project for the first time:', [
    { value: 'auto', label: 'Auto-configure using my defaults', description: 'Recommended' },
    { value: 'ask', label: 'Ask me each time' },
    { value: 'manual', label: 'Do nothing', description: 'Manual setup only' },
  ])

  // === Write status files ===
  const userStatus: UserSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: autoConfig === 'auto',
      defaultStatuslineScope: statuslineScope as 'user' | 'project',
      defaultApiKeyScope: wantPersonas ? 'user' : 'skip',
    },
    statusline: 'configured',
    apiKeys: {
      OPENROUTER_API_KEY: apiKeyHealth,
      OPENAI_API_KEY: 'not-required',
    },
  }

  await setupService.writeUserStatus(userStatus)

  // Write project status if using project scope
  if (statuslineScope === 'project') {
    const projectStatus: ProjectSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: false,
      statusline: 'configured',
      apiKeys: {
        OPENROUTER_API_KEY: apiKeyHealth === 'healthy' ? 'user' : apiKeyHealth,
        OPENAI_API_KEY: 'not-required',
      },
    }
    await setupService.writeProjectStatus(projectStatus)
  }

  // === Summary ===
  printHeader(ctx, 'Step 4: Summary')
  printStatus(ctx, 'success', `Statusline: ${statuslineScope === 'user' ? 'User-level' : 'Project-level'}`)
  printStatus(ctx, wantPersonas ? 'success' : 'info', `Personas: ${wantPersonas ? 'Enabled' : 'Disabled'}`)
  printStatus(
    ctx,
    apiKeyHealth === 'healthy' ? 'success' : apiKeyHealth === 'not-required' ? 'info' : 'warning',
    `API Key: ${apiKeyHealth}`
  )
  printStatus(ctx, 'success', `Auto-configure: ${autoConfig === 'auto' ? 'Enabled' : 'Disabled'}`)

  stdout.write('\n')
  stdout.write("Restart Claude Code to see your statusline: claude --continue\n")

  return { exitCode: 0 }
}

/**
 * Run the doctor/check mode
 */
async function runDoctor(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream
): Promise<SetupCommandResult> {
  const homeDir = os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  stdout.write('\nSidekick Doctor\n')
  stdout.write('===============\n\n')

  const statusline = await setupService.getStatuslineHealth()
  const apiKey = await setupService.getEffectiveApiKeyHealth('OPENROUTER_API_KEY')
  const isHealthy = await setupService.isHealthy()

  stdout.write(`Statusline: ${statusline}\n`)
  stdout.write(`OpenRouter API Key: ${apiKey}\n`)
  stdout.write(`Overall: ${isHealthy ? 'healthy' : 'needs attention'}\n`)

  if (!isHealthy) {
    stdout.write("\nRun 'sidekick setup' to configure.\n")
  }

  return { exitCode: isHealthy ? 0 : 1 }
}

/**
 * Main setup command handler
 */
export async function handleSetupCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions = {}
): Promise<SetupCommandResult> {
  if (options.checkOnly) {
    return runDoctor(projectDir, logger, stdout)
  }
  return runWizard(projectDir, logger, stdout, options)
}
```

**Step 2: Create re-export file**

```typescript
// packages/sidekick-cli/src/commands/setup.ts
export { handleSetupCommand, type SetupCommandOptions, type SetupCommandResult } from './setup/index.js'
```

**Step 3: Build CLI package**

Run: `pnpm --filter @sidekick/cli build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup packages/sidekick-cli/src/commands/setup.ts
git commit -m "feat(cli): add sidekick setup command"
```

---

## Task 7: Wire Setup Command into CLI Router

**Files:**
- Modify: `packages/sidekick-cli/src/cli.ts`

**Step 1: Add setup and doctor commands to routeCommand**

Add after the `dev-mode` handler (around line 500):

```typescript
  if (parsed.command === 'setup') {
    const { handleSetupCommand } = await import('./commands/setup.js')
    const result = await handleSetupCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      checkOnly: parsed.help ? false : parsed._?.[1] === '--check',
      stdin: process.stdin,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'doctor') {
    const { handleSetupCommand } = await import('./commands/setup.js')
    const result = await handleSetupCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      checkOnly: true,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }
```

**Step 2: Update help text in GLOBAL_HELP_TEXT**

Add to the Commands section:

```typescript
  setup                    Run the setup wizard (configure statusline, API keys)
  doctor                   Check sidekick health (alias: setup --check)
```

**Step 3: Build and test**

Run: `pnpm build && pnpm sidekick setup --help`
Expected: Help output shows, no errors

**Step 4: Commit**

```bash
git add packages/sidekick-cli/src/cli.ts
git commit -m "feat(cli): wire setup and doctor commands into CLI router"
```

---

## Task 8: Setup Command Tests

**Files:**
- Create: `packages/sidekick-cli/src/commands/__tests__/setup.test.ts`

**Step 1: Write basic tests**

```typescript
// packages/sidekick-cli/src/commands/__tests__/setup.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Readable, Writable } from 'node:stream'
import { handleSetupCommand } from '../setup.js'
import { createTestLogger } from '../../../testing-fixtures/src/test-logger.js'

// Mock fetch for API validation
vi.mock('node:fetch', () => ({
  default: vi.fn(),
}))

describe('handleSetupCommand', () => {
  let tempDir: string
  let projectDir: string
  let output: string[]
  let stdout: Writable
  let logger: ReturnType<typeof createTestLogger>

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'))
    projectDir = path.join(tempDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    output = []
    stdout = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString())
        callback()
      },
    })
    logger = createTestLogger()
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('doctor mode', () => {
    it('reports not-setup when no status files exist', async () => {
      const result = await handleSetupCommand(projectDir, logger, stdout, { checkOnly: true })
      expect(result.exitCode).toBe(1)
      expect(output.join('')).toContain('not-setup')
    })
  })
})
```

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/cli test -- src/commands/__tests__/setup.test.ts`
Expected: Tests pass

**Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/__tests__/setup.test.ts
git commit -m "test(cli): add setup command tests"
```

---

## Task 9: Full Build and Typecheck

**Step 1: Run full build**

Run: `pnpm build`
Expected: All packages build successfully

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(setup): complete setup wizard implementation

- Add SetupStatusService for dual-scope status management
- Add sidekick setup interactive wizard
- Add sidekick doctor health check
- Add API key validation
- Add setup status types and schemas

Closes sidekick-ii3"
```

---

## Deferred: Auto-Configuration in SessionStart Hook

This task is deferred to a follow-up issue. The auto-configuration logic should:

1. Import SetupStatusService in session-start hook handler
2. Call `shouldAutoConfigureProject()` on session start
3. If true, copy user defaults to project status
4. Optionally configure project-level statusline if user preference is 'project'

This can be implemented after the core setup wizard is working.

---

**Plan complete and saved to `docs/plans/2026-01-25-setup-wizard-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
