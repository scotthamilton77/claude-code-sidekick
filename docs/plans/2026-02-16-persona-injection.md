# Persona Injection into Claude Code Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Inject the active persona's voice/personality into Claude Code's responses via the reminder system on SessionStart and UserPromptSubmit hooks.

**Architecture:** Extend the consumption handler factory to concatenate `additionalContext` from ALL staged reminders (not just the highest-priority one). Add new persona-aware staging handlers that stage a persistent "remember your persona" reminder and a one-shot "persona changed" reminder. Gate everything on a new `injectPersonaIntoClaude` config flag and whether the active persona is not `disabled`/null.

**Tech Stack:** TypeScript, Vitest, YAML (reminder definitions + config defaults), existing staging/consumption pattern from `@sidekick/feature-reminders`

**Bead:** sidekick-n35d

---

## Context for the Implementing Agent

### Key Concepts

- **Staging/Consumption Pattern**: The daemon stages reminder JSON files to `.sidekick/sessions/{sessionId}/stage/{HookName}/`. The CLI hook reads those files and returns their content to Claude Code. These are separate processes.
- **Consumption Handler Factory** (`packages/feature-reminders/src/handlers/consumption/consumption-handler-factory.ts`): Currently takes only `reminders[0]` (highest priority). This plan changes it to concatenate ALL reminders' `additionalContext`.
- **Staging Handler Utils** (`packages/feature-reminders/src/handlers/staging/staging-handler-utils.ts`): Creates daemon-side handlers that respond to events and stage reminders.
- **Reminder YAML Files** (`assets/sidekick/reminders/`): Define reminder properties (id, blocking, priority, persistent, additionalContext). Resolved by `resolveReminder()` using the asset cascade.
- **Persona System**: Personas are YAML files in `assets/sidekick/personas/`. Session persona state is stored in `.sidekick/sessions/{sessionId}/state/session-persona.json`. The daemon's `SessionPersonaWatcher` already watches for file changes and calls `handlePersonaChange()`.
- **Config Service**: `features.session-summary.settings.personas` already exists. We add `injectPersonaIntoClaude` here.

### Existing Files You'll Modify

| File | What Changes |
|------|-------------|
| `packages/feature-reminders/src/handlers/consumption/consumption-handler-factory.ts` | Concatenate ALL reminders' additionalContext, not just `reminders[0]` |
| `packages/feature-reminders/src/handlers/staging/index.ts` | Register new persona staging handler |
| `packages/feature-reminders/src/handlers/consumption/index.ts` | Register new SessionStart consumption handler |
| `packages/feature-reminders/src/types.ts` | Add persona reminder IDs |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Add `injectPersonaIntoClaude: true` |
| `packages/feature-session-summary/src/types.ts` | Add `injectPersonaIntoClaude` to `SessionSummaryConfig.personas` |
| `packages/sidekick-daemon/src/daemon.ts` | Wire persona change → persona reminder re-staging |

### New Files You'll Create

| File | Purpose |
|------|---------|
| `assets/sidekick/reminders/remember-your-persona.yaml` | Persistent persona reminder template |
| `assets/sidekick/reminders/persona-changed.yaml` | One-shot persona change notification |
| `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts` | Daemon-side: stage persona reminders on SessionStart + persona change |
| `packages/feature-reminders/src/handlers/consumption/inject-session-start.ts` | CLI-side: consume SessionStart reminders |

### Priority Map (higher number = consumed first, but all are concatenated)

| Reminder | Hook | Priority | Persistent |
|----------|------|----------|------------|
| `user-prompt-submit` (existing) | UserPromptSubmit | 10 | Yes |
| `remember-your-persona` (new) | UserPromptSubmit | 5 | Yes |
| `persona-changed` (new) | UserPromptSubmit | 8 | No (one-shot) |
| `remember-your-persona` (new) | SessionStart | 5 | Yes |
| `pause-and-reflect` (existing) | UserPromptSubmit | 80 | No |
| `verify-completion` (existing) | Stop | 50 | No |

### Gating Logic

Persona reminders are staged ONLY when both conditions are true:
1. Active session persona exists AND is not `"disabled"`
2. Config `features.session-summary.settings.personas.injectPersonaIntoClaude` is `true` (default)

---

## Task 1: Multi-Reminder Concatenation in Consumption Handler

The core change: make the consumption handler concatenate `additionalContext` from ALL staged reminders instead of using only the highest-priority one.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/consumption/consumption-handler-factory.ts`
- Test: `packages/feature-reminders/src/__tests__/consumption-factory.test.ts`

**Step 1: Write the failing test**

Add a new test to `consumption-factory.test.ts`:

```typescript
it('concatenates additionalContext from ALL reminders by priority', async () => {
  const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

  writeFileSync(
    join(stagingDir, 'low-priority.json'),
    JSON.stringify(
      createReminder({
        name: 'low-priority',
        priority: 10,
        persistent: true,
        additionalContext: 'Low priority context',
      })
    )
  )
  writeFileSync(
    join(stagingDir, 'high-priority.json'),
    JSON.stringify(
      createReminder({
        name: 'high-priority',
        priority: 90,
        persistent: true,
        additionalContext: 'High priority context',
      })
    )
  )
  writeFileSync(
    join(stagingDir, 'medium-priority.json'),
    JSON.stringify(
      createReminder({
        name: 'medium-priority',
        priority: 50,
        persistent: true,
        additionalContext: 'Medium priority context',
      })
    )
  )

  createConsumptionHandler(ctx, {
    id: 'test:consume',
    hook: 'PreToolUse',
  })

  const handler = handlers.getHandler('test:consume')
  const result = await handler?.handler(
    createPreToolUseEvent(),
    ctx as unknown as import('@sidekick/types').HandlerContext
  )

  // Should concatenate all contexts, highest priority first
  expect(result).toEqual({
    response: {
      additionalContext: 'High priority context\n\nMedium priority context\n\nLow priority context',
    },
  })
})
```

Also add tests for:
- Blocking uses highest-priority winner (only one reminder can block)
- userMessage uses highest-priority winner
- Non-persistent reminders still get renamed after consumption
- Reminders without additionalContext are skipped in concatenation

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --testPathPattern=consumption-factory --no-coverage`
Expected: FAIL — currently returns only "High priority context"

**Step 3: Implement multi-reminder concatenation**

Modify `consumption-handler-factory.ts`. The key change is in the handler function (lines 98-151):

```typescript
// Replace single-reminder logic with multi-reminder concatenation
const reminders = reader.listReminders(hook)
if (reminders.length === 0) {
  return { response: {} }
}

// Primary reminder (highest priority) determines blocking and userMessage
const primary = reminders[0]

// Rename all non-persistent reminders (preserves consumption history)
for (const reminder of reminders) {
  if (!reminder.persistent) {
    reader.renameReminder(hook, reminder.name)
  }
}

// Build response: concatenate additionalContext from all reminders (already sorted by priority desc)
let response: HookResponse

if (buildResponse) {
  // Custom response builder gets primary reminder (for backward compat)
  response = await buildResponse({ reminder: primary, reader, cliCtx, sessionId, event, supportsBlocking })
} else {
  response = buildDefaultResponse(primary, supportsBlocking)
}

// Concatenate additionalContext from ALL reminders (highest priority first)
const allContexts = reminders
  .map(r => r.additionalContext)
  .filter((ctx): ctx is string => !!ctx)
if (allContexts.length > 0) {
  response.additionalContext = allContexts.join('\n\n')
}

// Call optional onConsume callback with primary reminder
if (onConsume) {
  await onConsume({ reminder: primary, reader, cliCtx, sessionId })
}
```

Important: `buildDefaultResponse` still uses the primary reminder for `blocking`/`reason`/`userMessage`. The concatenation only affects `additionalContext`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-reminders test -- --testPathPattern=consumption-factory --no-coverage`
Expected: PASS

**Step 5: Update existing test expectations**

The existing test "consumes highest-priority reminder when multiple are staged" (line 152) needs updating — it currently expects only the high-priority context, but now it will get all three concatenated. Update the assertion accordingly. Note: that test uses non-persistent reminders, so verify all are renamed.

**Step 6: Run all consumption tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --no-coverage`
Expected: ALL PASS

**Step 7: Commit**

```
feat(reminders): concatenate additionalContext from all staged reminders

The consumption handler now concatenates additionalContext from all staged
reminders sorted by priority (highest first), instead of using only the
single highest-priority reminder. Blocking and userMessage still use the
highest-priority winner.
```

---

## Task 2: Config Flag and Type Updates

**Files:**
- Modify: `assets/sidekick/defaults/features/session-summary.defaults.yaml`
- Modify: `packages/feature-session-summary/src/types.ts`
- Modify: `packages/feature-reminders/src/types.ts`

**Step 1: Add config default**

In `session-summary.defaults.yaml`, add under `personas:` section (after `resumeFreshnessHours: 4`):

```yaml
    # Inject active persona into Claude Code's system prompt via reminders
    # When true, a persistent reminder is staged on SessionStart and UserPromptSubmit
    # describing the persona's voice/personality for Claude to adopt
    injectPersonaIntoClaude: true
```

**Step 2: Add to TypeScript config type**

In `packages/feature-session-summary/src/types.ts`, add to the `personas` field in `SessionSummaryConfig` interface (line ~73):

```typescript
/** Inject active persona into Claude Code's system prompt via reminders */
injectPersonaIntoClaude?: boolean
```

Update `DEFAULT_SESSION_SUMMARY_CONFIG.personas` (line ~105) to include:

```typescript
injectPersonaIntoClaude: true,
```

**Step 3: Add persona reminder IDs**

In `packages/feature-reminders/src/types.ts`, add to `ReminderIds` (line ~138):

```typescript
REMEMBER_YOUR_PERSONA: 'remember-your-persona',
PERSONA_CHANGED: 'persona-changed',
```

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(config): add injectPersonaIntoClaude config flag and persona reminder IDs
```

---

## Task 3: Persona Reminder YAML Templates

**Files:**
- Create: `assets/sidekick/reminders/remember-your-persona.yaml`
- Create: `assets/sidekick/reminders/persona-changed.yaml`

**Step 1: Create persistent persona reminder**

Create `assets/sidekick/reminders/remember-your-persona.yaml`:

```yaml
# remember-your-persona.yaml
# Persistent reminder injected on SessionStart and UserPromptSubmit
# to keep Claude in character with the active persona.
id: remember-your-persona
blocking: false
priority: 5
persistent: true

additionalContext: |
  You have an active persona: {{persona_name}}
  Voice: {{persona_theme}}
  Tone: {{persona_tone}}

  Adopt this personality in all responses. Stay in character while following all other instructions.
```

**Step 2: Create one-shot persona-changed reminder**

Create `assets/sidekick/reminders/persona-changed.yaml`:

```yaml
# persona-changed.yaml
# One-shot reminder fired when persona changes mid-session.
# Consumed after delivery (non-persistent).
id: persona-changed
blocking: false
priority: 8
persistent: false

additionalContext: |
  Your persona has changed to: {{persona_name}}
  Voice: {{persona_theme}}
  Tone: {{persona_tone}}

  Examples of this persona's style:
  {{persona_snarky_examples}}

  Adopt this new personality immediately. Stay in character while following all other instructions.
```

**Step 3: Verify YAML parses correctly**

Write a quick test or use existing `reminder-utils.test.ts` pattern to verify:

Run: `pnpm --filter @sidekick/feature-reminders test -- --testPathPattern=reminder-utils --no-coverage`
Expected: PASS (existing tests; add a new test for the new YAML files if needed)

**Step 4: Commit**

```
feat(reminders): add persona reminder YAML templates
```

---

## Task 4: Persona Staging Handler (Daemon-Side)

Stage persona reminders on SessionStart when persona is active and not `disabled`.

**Files:**
- Create: `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts`
- Modify: `packages/feature-reminders/src/handlers/staging/index.ts`
- Test: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Write failing tests**

Add to `staging-handlers.test.ts`. The tests need to verify:

1. Stages `remember-your-persona` for both UserPromptSubmit and SessionStart on session start when persona is active and not `disabled`
2. Does NOT stage when persona is `disabled`
3. Does NOT stage when persona is null/missing
4. Does NOT stage when `injectPersonaIntoClaude` config is `false`
5. Template variables are interpolated (`persona_name`, `persona_theme`, `persona_tone`)

For the test setup, you'll need to:
- Register the persona YAML files in `MockAssetResolver`
- Set up `MockConfigService` to return session-summary config with `personas.injectPersonaIntoClaude`
- Mock `stateService` to return session persona state
- Use the existing `createMockDaemonContext` pattern

**Step 2: Run to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --testPathPattern=staging-handlers --no-coverage`
Expected: FAIL

**Step 3: Implement the staging handler**

Create `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts`:

```typescript
/**
 * Stage persona reminders on SessionStart
 *
 * Stages a persistent "remember-your-persona" reminder for both
 * UserPromptSubmit and SessionStart hooks when the active persona
 * is not "disabled" and the injectPersonaIntoClaude config is true.
 *
 * @see docs/plans/2026-02-16-persona-injection.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { isHookEvent, isSessionStartEvent, isDaemonContext } from '@sidekick/types'
import type { DaemonContext, SessionSummaryConfig } from '@sidekick/types'
// ... (or import SessionSummaryConfig from feature-session-summary if cross-feature import is allowed)
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds } from '../../types.js'
```

Key implementation details:
- **Trigger**: SessionStart hook event (same trigger as `stage-default-user-prompt.ts`)
- **Persona loading**: Use `loadSessionPersona()` from `@sidekick/feature-session-summary` (already exports it), or read session-persona state directly from `stateService`
- **Config access**: `ctx.config.getFeature<SessionSummaryConfig>('session-summary')` to read `personas.injectPersonaIntoClaude`
- **Two staging actions**: One for `UserPromptSubmit`, one for `SessionStart` (same reminder ID, different target hooks)
- **Template context**: Use `buildPersonaContext()` from `persona-utils.ts` to get `persona_name`, `persona_theme`, `persona_tone`

**Important architectural note**: The staging handler runs in the daemon context. It needs access to session persona state. The existing `selectPersonaForSession()` in `persona-selection.ts` already runs on SessionStart and writes the persona state. The persona staging handler must run AFTER persona selection. Use a higher priority number (lower priority = runs later) or check that persona state exists.

**Recommended approach**: Rather than using `createStagingHandler` (which expects a single `StagingAction`), create a custom handler that:
1. Reads config to check `injectPersonaIntoClaude`
2. Reads session persona state
3. If persona is active and not `disabled`, stages reminders for both hooks using `stageReminder()` directly
4. If persona is `disabled` or missing, does nothing

**Step 4: Register in staging index**

In `packages/feature-reminders/src/handlers/staging/index.ts`, add:

```typescript
import { registerStagePersonaReminders } from './stage-persona-reminders'

// In registerStagingHandlers():
registerStagePersonaReminders(context)
```

**Step 5: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --testPathPattern=staging-handlers --no-coverage`
Expected: PASS

**Step 6: Commit**

```
feat(reminders): add persona reminder staging on SessionStart
```

---

## Task 5: SessionStart Consumption Handler (CLI-Side)

Currently there is NO consumption handler for SessionStart. Add one so the persona reminder staged for SessionStart is consumed and returned to Claude Code.

**Files:**
- Create: `packages/feature-reminders/src/handlers/consumption/inject-session-start.ts`
- Modify: `packages/feature-reminders/src/handlers/consumption/index.ts`
- Test: `packages/feature-reminders/src/__tests__/consumption-handlers.test.ts`

**Step 1: Write failing test**

Add test for SessionStart consumption to `consumption-handlers.test.ts` (or create a new test file).

**Step 2: Implement SessionStart consumption handler**

Create `packages/feature-reminders/src/handlers/consumption/inject-session-start.ts`:

```typescript
/**
 * Inject reminders into SessionStart hook (CLI-side)
 * @see docs/plans/2026-02-16-persona-injection.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { createConsumptionHandler } from './consumption-handler-factory.js'

export function registerInjectSessionStart(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-session-start',
    hook: 'SessionStart',
  })
}
```

**Step 3: Register in consumption index**

In `packages/feature-reminders/src/handlers/consumption/index.ts`:

```typescript
import { registerInjectSessionStart } from './inject-session-start'

// In registerConsumptionHandlers():
registerInjectSessionStart(context)
```

**Step 4: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --no-coverage`
Expected: PASS

**Step 5: Commit**

```
feat(reminders): add SessionStart consumption handler
```

---

## Task 6: Wire Persona Change into Reminder Re-Staging

When persona changes mid-session (detected by `SessionPersonaWatcher`), stage the one-shot `persona-changed` reminder and update the persistent `remember-your-persona` reminder.

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts` (handlePersonaChange method)
- Modify: `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts` (export a function for on-demand staging)

**Step 1: Export a re-staging function from the staging handler**

In `stage-persona-reminders.ts`, export a function like:

```typescript
export async function stagePersonaRemindersForSession(
  ctx: DaemonContext,
  sessionId: string,
  options?: { includeChangedReminder?: boolean }
): Promise<void>
```

This function:
1. Reads config (`injectPersonaIntoClaude`)
2. Loads session persona
3. If persona is active and not `disabled`:
   - Stages/updates `remember-your-persona` for UserPromptSubmit
   - Stages/updates `remember-your-persona` for SessionStart
   - If `options.includeChangedReminder`, stages `persona-changed` for UserPromptSubmit (one-shot)
4. If persona is `disabled` or missing:
   - Removes any existing persona reminders (unstage)

**Step 2: Wire into daemon's handlePersonaChange**

In `daemon.ts`, in the `handlePersonaChange` method (~line 473), after the existing `regenerateMessagesForSession` call, also call:

```typescript
// Stage/update persona reminders for injection
void this.stagePersonaRemindersForSession(event)
```

Add a private method that creates a temporary DaemonContext and calls the exported staging function.

**Step 3: Test manually** (this involves daemon wiring, hard to unit test)

Verify by:
1. Setting a persona: `pnpm sidekick persona set skippy --session-id=test`
2. Check that `remember-your-persona.json` appears in `.sidekick/sessions/test/stage/UserPromptSubmit/`
3. Check that `remember-your-persona.json` appears in `.sidekick/sessions/test/stage/SessionStart/`
4. Check that `persona-changed.json` appears in `.sidekick/sessions/test/stage/UserPromptSubmit/`

**Step 4: Commit**

```
feat(daemon): wire persona changes into reminder re-staging
```

---

## Task 7: Integration Verification

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run all tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --no-coverage`
Run: `pnpm --filter @sidekick/feature-session-summary test -- --no-coverage`
Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' --no-coverage`
Expected: ALL PASS

**Step 4: Lint**

Run: `pnpm lint`
Expected: PASS

**Step 5: Manual smoke test**

1. `pnpm build`
2. `pnpm sidekick dev-mode enable`
3. Start a new Claude Code session
4. Verify the session start output includes persona injection text in `<system-reminder>` tags
5. Send a message and verify UserPromptSubmit includes both the default reminder AND persona reminder
6. Change persona mid-session: `pnpm sidekick persona set marvin --session-id=<id>`
7. Send another message and verify the persona-changed one-shot appears once, then the persistent reminder continues

---

## Cross-Feature Import Consideration

The persona staging handler (in `@sidekick/feature-reminders`) needs to:
1. Read session persona state — available via `stateService.readSessionState()` directly
2. Load persona definition — needs `createPersonaLoader` from `@sidekick/core` (already available)
3. Build persona template context — `buildPersonaContext()` is in `@sidekick/feature-session-summary`
4. Read config — `ctx.config.getFeature('session-summary')` available on DaemonContext

Option A: Import `buildPersonaContext` from `@sidekick/feature-session-summary` (creates a cross-feature dependency).

Option B: Duplicate the simple persona context building logic in the reminders feature (4 lines of code).

Option C: Move `buildPersonaContext` to `@sidekick/core` (it's a pure function with no feature dependencies).

**Recommended: Option C** — `buildPersonaContext` is a pure utility that converts a `PersonaDefinition` to template variables. It belongs in core. Move it to `@sidekick/core` and import from there in both features.

If time-constrained, Option B (inline the 4-line logic) is acceptable for MVP.
