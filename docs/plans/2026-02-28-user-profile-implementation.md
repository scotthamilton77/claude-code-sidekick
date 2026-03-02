# User Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional `~/.sidekick/user.yaml` with name, role, interests — injected into snarky/resume prompts and Claude Code session reminders.

**Architecture:** New Zod type + loader in core, new `buildUserProfileContext()` in persona-utils, new staging handler for reminders, prompt template updates, setup wizard step. Follows existing persona patterns exactly.

**Tech Stack:** TypeScript, Zod, js-yaml, Vitest

**Design doc:** `docs/plans/2026-02-28-user-profile-design.md`

---

### Task 1: UserProfile Type + Zod Schema

**Files:**
- Create: `packages/types/src/services/user-profile.ts`
- Modify: `packages/types/src/services/index.ts:16` (add export)
- Test: `packages/types/src/services/__tests__/user-profile.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/types/src/services/__tests__/user-profile.test.ts
import { describe, it, expect } from 'vitest'
import { UserProfileSchema } from '../user-profile'

describe('UserProfileSchema', () => {
  it('parses valid profile', () => {
    const result = UserProfileSchema.safeParse({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
  })

  it('rejects missing name', () => {
    const result = UserProfileSchema.safeParse({ role: 'Dev', interests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects missing role', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', interests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects missing interests', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', role: 'Dev' })
    expect(result.success).toBe(false)
  })

  it('rejects non-string interests', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', role: 'Dev', interests: [42] })
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/types test -- --run packages/types/src/services/__tests__/user-profile.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/types/src/services/user-profile.ts
/**
 * User Profile Types
 *
 * Optional user identity loaded from ~/.sidekick/user.yaml.
 * Provides name, role, and interests for persona personalization.
 */
import { z } from 'zod'

export const UserProfileSchema = z.object({
  /** User's display name */
  name: z.string(),
  /** User's role (e.g., "Software Architect") */
  role: z.string(),
  /** User's interests as string array */
  interests: z.array(z.string()),
})

export type UserProfile = z.infer<typeof UserProfileSchema>
```

**Step 4: Add export to barrel**

In `packages/types/src/services/index.ts`, add after line 8 (`export * from './persona.js'`):
```typescript
export * from './user-profile.js'
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @sidekick/types test -- --run packages/types/src/services/__tests__/user-profile.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(types): add UserProfile Zod schema and type
```

---

### Task 2: User Profile Loader

**Files:**
- Create: `packages/sidekick-core/src/user-profile-loader.ts`
- Modify: `packages/sidekick-core/src/index.ts:222` (add export)
- Test: `packages/sidekick-core/src/__tests__/user-profile-loader.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/sidekick-core/src/__tests__/user-profile-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { loadUserProfile } from '../user-profile-loader'

const TEST_HOME = join(process.cwd(), 'tmp-test-home')
const SIDEKICK_DIR = join(TEST_HOME, '.sidekick')

function createFakeLogger() {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: function () { return this },
    flush: async () => {},
  }
}

describe('loadUserProfile', () => {
  beforeEach(() => {
    mkdirSync(SIDEKICK_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true })
  })

  it('returns null when file does not exist', () => {
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toBeNull()
  })

  it('loads valid user profile', () => {
    writeFileSync(join(SIDEKICK_DIR, 'user.yaml'), `
name: "Scott"
role: "Software Architect"
interests:
  - "Sci-Fi"
  - "80s sitcoms"
`)
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toEqual({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
  })

  it('returns null and logs warning for malformed YAML', () => {
    writeFileSync(join(SIDEKICK_DIR, 'user.yaml'), '{{{{not yaml')
    const logger = createFakeLogger()
    const warnCalls: unknown[] = []
    logger.warn = (...args: unknown[]) => { warnCalls.push(args) }
    const result = loadUserProfile({ homeDir: TEST_HOME, logger })
    expect(result).toBeNull()
    expect(warnCalls.length).toBeGreaterThan(0)
  })

  it('returns null and logs warning for missing required fields', () => {
    writeFileSync(join(SIDEKICK_DIR, 'user.yaml'), `
name: "Scott"
`)
    const logger = createFakeLogger()
    const warnCalls: unknown[] = []
    logger.warn = (...args: unknown[]) => { warnCalls.push(args) }
    const result = loadUserProfile({ homeDir: TEST_HOME, logger })
    expect(result).toBeNull()
    expect(warnCalls.length).toBeGreaterThan(0)
  })

  it('returns null when ~/.sidekick/ directory does not exist', () => {
    rmSync(SIDEKICK_DIR, { recursive: true, force: true })
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/user-profile-loader.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/sidekick-core/src/user-profile-loader.ts
/**
 * User Profile Loader
 *
 * Loads optional user profile from ~/.sidekick/user.yaml.
 * No cascade, no defaults — file either exists or it doesn't.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { UserProfileSchema, type UserProfile } from '@sidekick/types'
import type { Logger } from '@sidekick/types'

export interface LoadUserProfileOptions {
  /** Override home directory (for testing) */
  homeDir?: string
  /** Logger for warnings */
  logger?: Logger
}

/**
 * Load user profile from ~/.sidekick/user.yaml.
 * Returns null if file doesn't exist or is invalid.
 */
export function loadUserProfile(options?: LoadUserProfileOptions): UserProfile | null {
  const home = options?.homeDir ?? homedir()
  const filePath = join(home, '.sidekick', 'user.yaml')

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(content)
    const result = UserProfileSchema.safeParse(parsed)

    if (!result.success) {
      options?.logger?.warn('Invalid user profile, ignoring', {
        path: filePath,
        errors: result.error.issues.map((i) => i.message),
      })
      return null
    }

    return result.data
  } catch (err) {
    options?.logger?.warn('Failed to read user profile', {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
```

**Step 4: Add export to barrel**

In `packages/sidekick-core/src/index.ts`, add after line 223 (`export { isInSandbox } from './sandbox'`):
```typescript
export { loadUserProfile, type LoadUserProfileOptions } from './user-profile-loader'
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/user-profile-loader.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(core): add user profile loader for ~/.sidekick/user.yaml
```

---

### Task 3: buildUserProfileContext + Prompt Template Updates

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/persona-utils.ts:20-29` (add interface + function)
- Modify: `assets/sidekick/prompts/snarky-message.prompt.txt` (add user block)
- Modify: `assets/sidekick/prompts/resume-message.prompt.txt` (add user block)
- Test: `packages/feature-session-summary/src/__tests__/persona-utils.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `packages/feature-session-summary/src/__tests__/persona-utils.test.ts`:

```typescript
import { buildUserProfileContext } from '../handlers/persona-utils'
import type { UserProfile } from '@sidekick/types'

describe('buildUserProfileContext', () => {
  it('returns populated context when profile is provided', () => {
    const profile: UserProfile = {
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    }
    const context = buildUserProfileContext(profile)
    expect(context).toEqual({
      user_name: 'Scott',
      user_role: 'Software Architect',
      user_interests: 'Sci-Fi, 80s sitcoms',
    })
  })

  it('returns empty strings when profile is null', () => {
    const context = buildUserProfileContext(null)
    expect(context).toEqual({
      user_name: '',
      user_role: '',
      user_interests: '',
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run src/__tests__/persona-utils.test.ts`
Expected: FAIL — `buildUserProfileContext` is not exported

**Step 3: Implement buildUserProfileContext**

In `packages/feature-session-summary/src/handlers/persona-utils.ts`, add the import and function:

After the existing `import type { DaemonContext, PersonaDefinition } from '@sidekick/types'` line, add:
```typescript
import type { UserProfile } from '@sidekick/types'
```

After `PersonaTemplateContext` interface (around line 29), add:

```typescript
/**
 * Template context for user profile prompt injection.
 */
export interface UserProfileTemplateContext {
  user_name: string
  user_role: string
  user_interests: string
}

/**
 * Build user profile template context.
 * Returns empty strings if profile is null (file doesn't exist).
 */
export function buildUserProfileContext(profile: UserProfile | null): UserProfileTemplateContext {
  if (!profile) {
    return {
      user_name: '',
      user_role: '',
      user_interests: '',
    }
  }
  return {
    user_name: profile.name,
    user_role: profile.role,
    user_interests: profile.interests.join(', '),
  }
}
```

**Step 4: Update prompt templates**

In `assets/sidekick/prompts/snarky-message.prompt.txt`, insert after line 8 (`Your tone: {{persona_tone}}`):
```

{{#if user_name}}
You are speaking to {{user_name}}{{#if user_role}}, a {{user_role}}{{/if}}.
{{#if user_interests}}Their interests include: {{user_interests}}.{{/if}}
Use this to personalize your comment when it fits naturally.
{{/if}}
```

In `assets/sidekick/prompts/resume-message.prompt.txt`, insert after line 8 (`Your tone: {{persona_tone}}`):
```

{{#if user_name}}
You are speaking to {{user_name}}{{#if user_role}}, a {{user_role}}{{/if}}.
{{#if user_interests}}Their interests include: {{user_interests}}.{{/if}}
Use this to personalize your comment when it fits naturally.
{{/if}}
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run src/__tests__/persona-utils.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(session-summary): add buildUserProfileContext and update prompt templates
```

---

### Task 4: Wire User Profile into Snarky/Resume Generation

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts:516-527` (snarky interpolation)
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts:668-680` (resume interpolation)
- Modify: `packages/feature-session-summary/src/handlers/on-demand-generation.ts:127-142` (snarky on-demand)
- Modify: `packages/feature-session-summary/src/handlers/on-demand-generation.ts:240-264` (resume on-demand)

**Step 1: Add imports to update-summary.ts**

At the top of `update-summary.ts`, the existing import from `persona-utils.js` needs `buildUserProfileContext` added:
```typescript
export { buildPersonaContext, buildUserProfileContext, type PersonaTemplateContext, type UserProfileTemplateContext } from './persona-utils.js'
```

Add import for `loadUserProfile`:
```typescript
import { loadUserProfile } from '@sidekick/core'
```

**Step 2: Update generateSnarkyMessage in update-summary.ts**

After `const personaContext = buildPersonaContext(persona)` (line 516), add:
```typescript
const userProfileContext = buildUserProfileContext(loadUserProfile({ logger: ctx.logger }))
```

Update the interpolation call (line 519) to spread user profile context:
```typescript
const prompt = interpolateTemplate(promptTemplate, {
  ...personaContext,
  ...userProfileContext,
  session_title: summary.session_title,
  // ... rest stays the same
})
```

**Step 3: Update generateResumeMessage in update-summary.ts**

After `const personaContext = buildPersonaContext(persona)` (line 668), add:
```typescript
const userProfileContext = buildUserProfileContext(loadUserProfile({ logger: ctx.logger }))
```

Update the interpolation call (line 672) to spread user profile context:
```typescript
const prompt = interpolateTemplate(promptTemplate, {
  ...personaContext,
  ...userProfileContext,
  sessionTitle: summary.session_title,
  // ... rest stays the same
})
```

**Step 4: Update on-demand-generation.ts**

Same pattern for both `generateSnarkyMessageOnDemand` and `generateResumeMessageOnDemand`:

Add import at top:
```typescript
import { loadUserProfile } from '@sidekick/core'
```

Update existing import from persona-utils to include `buildUserProfileContext`:
```typescript
import {
  buildPersonaContext,
  buildUserProfileContext,
  getEffectiveProfile,
  loadSessionPersona,
  stripSurroundingQuotes,
} from './persona-utils.js'
```

After each `const personaContext = buildPersonaContext(persona)` call, add:
```typescript
const userProfileContext = buildUserProfileContext(loadUserProfile({ logger: ctx.logger }))
```

And spread `...userProfileContext` into each `interpolateTemplate()` call.

**Step 5: Run tests**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run`
Expected: PASS (existing tests should still pass — user profile context adds empty strings when no file exists)

**Step 6: Commit**

```
feat(session-summary): wire user profile context into snarky and resume generation
```

---

### Task 5: User Profile Reminder (Session Start Injection)

**Files:**
- Create: `assets/sidekick/reminders/user-profile.yaml`
- Create: `packages/feature-reminders/src/handlers/staging/stage-user-profile-reminders.ts`
- Modify: `packages/feature-reminders/src/handlers/staging/index.ts:27` (register handler)
- Modify: `packages/feature-reminders/src/types.ts:143` (add reminder ID)
- Test: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` (add tests)

**Step 1: Create reminder YAML**

```yaml
# assets/sidekick/reminders/user-profile.yaml
# Persistent reminder injected on SessionStart and UserPromptSubmit
# when a user profile exists at ~/.sidekick/user.yaml.
id: user-profile
blocking: false
priority: 4
persistent: true

additionalContext: |
  This session is with {{user_name}}{{#if user_role}} ({{user_role}}){{/if}}.
  {{#if user_interests}}Interests: {{user_interests}}.{{/if}}
```

**Step 2: Add reminder ID constant**

In `packages/feature-reminders/src/types.ts`, add to `ReminderIds` (line 143):
```typescript
USER_PROFILE: 'user-profile',
```

**Step 3: Write the staging handler**

```typescript
// packages/feature-reminders/src/handlers/staging/stage-user-profile-reminders.ts
/**
 * Stage user profile reminders on SessionStart
 *
 * Stages a persistent "user-profile" reminder for both
 * UserPromptSubmit and SessionStart hooks when a user profile
 * exists at ~/.sidekick/user.yaml.
 */
import type { RuntimeContext } from '@sidekick/core'
import { loadUserProfile } from '@sidekick/core'
import type { DaemonContext, HookName, SidekickEvent, HandlerContext } from '@sidekick/types'
import { isDaemonContext, isHookEvent, isSessionStartEvent } from '@sidekick/types'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { ReminderIds } from '../../types.js'

/** Target hooks for user profile reminders */
const USER_PROFILE_REMINDER_HOOKS: HookName[] = ['UserPromptSubmit', 'SessionStart']

/**
 * Stage user profile reminders for a session.
 * Loads ~/.sidekick/user.yaml and stages the reminder if profile exists.
 */
export async function stageUserProfileRemindersForSession(
  ctx: DaemonContext,
  sessionId: string
): Promise<void> {
  const profile = loadUserProfile({ logger: ctx.logger })

  if (!profile) {
    // No profile — clear any previously staged reminders
    for (const hook of USER_PROFILE_REMINDER_HOOKS) {
      await ctx.staging.deleteReminder(hook, ReminderIds.USER_PROFILE)
    }
    return
  }

  const templateContext: Record<string, string> = {
    user_name: profile.name,
    user_role: profile.role,
    user_interests: profile.interests.join(', '),
  }

  const reminder = resolveReminder(ReminderIds.USER_PROFILE, {
    context: templateContext,
    assets: ctx.assets,
  })

  if (reminder) {
    for (const targetHook of USER_PROFILE_REMINDER_HOOKS) {
      await stageReminder(ctx, targetHook, reminder)
    }
    ctx.logger.debug('Staged user profile reminders', { sessionId, userName: profile.name })
  } else {
    ctx.logger.warn('Failed to resolve user-profile reminder', { sessionId })
  }
}

/**
 * Register the user profile reminder staging handler.
 * Triggers on SessionStart to stage user profile reminders.
 */
export function registerStageUserProfileReminders(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:stage-user-profile-reminders',
    priority: 39, // Run after persona reminders (priority 40)
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context.sessionId

      await stageUserProfileRemindersForSession(daemonCtx, sessionId)
    },
  })
}
```

**Step 4: Register in staging index**

In `packages/feature-reminders/src/handlers/staging/index.ts`, add import:
```typescript
import { registerStageUserProfileReminders } from './stage-user-profile-reminders'
```

Add call in `registerStagingHandlers()`:
```typescript
registerStageUserProfileReminders(context)
```

**Step 5: Write tests for the staging handler**

Add to the existing `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` or create a focused test file. The tests should verify:
- Handler stages reminder when profile exists
- Handler clears reminder when no profile exists
- Reminder content includes user name, role, interests

Reference the patterns in the existing `staging-handlers.test.ts` for mock setup.

**Step 6: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run`
Expected: PASS

**Step 7: Commit**

```
feat(reminders): add user profile reminder for session start injection
```

---

### Task 6: Setup Wizard — User Profile Step

**Files:**
- Create: `packages/sidekick-cli/src/commands/setup/user-profile-setup.ts`
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:846-849` (add step call)

**Step 1: Write the setup module**

```typescript
// packages/sidekick-cli/src/commands/setup/user-profile-setup.ts
/**
 * User Profile Setup Step
 *
 * Collects or confirms user profile details (name, role, interests)
 * and writes ~/.sidekick/user.yaml.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { loadUserProfile } from '@sidekick/core'
import { printHeader, printStatus, promptConfirm, promptInput, type PromptContext } from './prompts.js'

export interface UserProfileSetupResult {
  configured: boolean
}

/**
 * Run the user profile setup step.
 * If profile exists, show and confirm. If not, collect details.
 */
export async function runUserProfileStep(
  ctx: PromptContext,
  homeDir: string
): Promise<UserProfileSetupResult> {
  printHeader(ctx, 'Step 8: User Profile', 'Personas can personalize messages when they know who you are.')

  const existing = loadUserProfile({ homeDir })

  if (existing) {
    ctx.stdout.write(`  Current profile:\n`)
    ctx.stdout.write(`    Name: ${existing.name}\n`)
    ctx.stdout.write(`    Role: ${existing.role}\n`)
    ctx.stdout.write(`    Interests: ${existing.interests.join(', ')}\n\n`)

    const keepIt = await promptConfirm(ctx, 'Keep this profile?', true)
    if (keepIt) {
      printStatus(ctx, 'success', 'User profile unchanged')
      return { configured: true }
    }
  }

  const name = await promptInput(ctx, 'Your name:')
  if (!name.trim()) {
    printStatus(ctx, 'info', 'Skipped user profile (no name provided)')
    return { configured: false }
  }

  const role = await promptInput(ctx, 'Your role (e.g., Software Architect):')
  const interestsRaw = await promptInput(ctx, 'Interests (comma-separated, e.g., Sci-Fi, hiking):')

  const interests = interestsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const profile = { name: name.trim(), role: role.trim(), interests }

  const sidekickDir = path.join(homeDir, '.sidekick')
  await fs.mkdir(sidekickDir, { recursive: true })
  const filePath = path.join(sidekickDir, 'user.yaml')
  await fs.writeFile(filePath, yaml.dump(profile, { lineWidth: -1 }), 'utf-8')

  printStatus(ctx, 'success', `User profile saved to ${filePath}`)
  return { configured: true }
}
```

**Step 2: Wire into setup wizard**

In `packages/sidekick-cli/src/commands/setup/index.ts`, add import:
```typescript
import { runUserProfileStep } from './user-profile-setup.js'
```

Add step call after step 7 (shell alias, around line 849), before the state collection:
```typescript
const userProfile = force ? { configured: false } : await runUserProfileStep(wctx.ctx, homeDir)
```

Note: Force mode skips user profile (non-interactive can't prompt). That's fine — the file is optional.

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```
feat(cli): add user profile step to setup wizard
```

---

### Task 7: Update Sidekick-Setup Skill File

**Files:**
- Modify: `packages/sidekick-plugin/skills/sidekick-setup/SKILL.md`

**Step 1: Update skill description and trigger list**

In the `## When to Use` section, add:
```
- User wants to set up or update their user profile (name, role, interests)
```

In the `## Quick Examples` section, add:

```markdown
### Configure User Profile

The user profile is stored at `~/.sidekick/user.yaml`. Run setup to configure:
```bash
npx @scotthamilton77/sidekick setup
```
Follow the Step 8 prompt for user profile details. Or create the file manually:
```yaml
# ~/.sidekick/user.yaml
name: "Your Name"
role: "Your Role"
interests:
  - "Interest 1"
  - "Interest 2"
```
```

**Step 2: Commit**

```
docs(skill): update sidekick-setup skill to include user profile
```

---

### Task 8: Build + Typecheck + Lint + Full Test Pass

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS (excluding IPC tests if in sandbox)

**Step 5: Commit any fixups**

If lint/typecheck caught issues, fix and commit:
```
fix: address lint and type errors from user profile feature
```

---

### Task 9: Code Review + Simplification

**Step 1: Run code-reviewer agent** against the full diff from `main`
**Step 2: Run code-simplifier agent** on all new/modified files
**Step 3: Address any findings and commit fixes
