# Generic Reminder Throttle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the one-off UPS throttle into a data-driven mechanism where any reminder opts into throttling via YAML, with per-reminder thresholds configurable through the config cascade.

**Architecture:** Reminders declare `throttle: true` in YAML. A single generic handler counts transcript messages per-reminder and re-stages from a cached `StagedReminder` when the threshold is met. Originating handlers (SessionStart, persona) cache the resolved reminder in throttle state on first staging, so the generic handler replays without needing template context knowledge.

**Tech Stack:** TypeScript, Zod schemas, Vitest, YAML config

---

### Task 1: Update Zod schemas and TypeScript types

**Files:**
- Modify: `packages/types/src/services/state.ts:356-373` (replace `UPSThrottleStateSchema`)
- Modify: `packages/feature-reminders/src/types.ts:182-312` (replace `user_prompt_submit_threshold`, add `throttle` to `ReminderDefinition`)

**Context:** The old `UPSThrottleState` is a flat `{ messagesSinceLastStaging }`. The new `ReminderThrottleState` is a `Record<string, ReminderThrottleEntry>` where each entry caches the resolved reminder for re-staging.

**Step 1: Replace UPSThrottleStateSchema in packages/types/src/services/state.ts**

Replace the section at lines 356-373:

```typescript
// ============================================================================
// Reminder Throttle State Schema
// ============================================================================

/**
 * Per-reminder throttle entry.
 * Stores counter, target hook, and cached resolved reminder for re-staging.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/reminder-throttle.json`
 *
 * @see docs/plans/2026-03-08-generic-reminder-throttle-design.md
 */
export const ReminderThrottleEntrySchema = z.object({
  /** Number of conversation messages since the reminder was last staged */
  messagesSinceLastStaging: z.number(),
  /** Hook to re-stage the reminder for */
  targetHook: z.string(),
  /** Cached resolved reminder content for re-staging */
  cachedReminder: z.object({
    name: z.string(),
    blocking: z.boolean(),
    priority: z.number(),
    persistent: z.boolean(),
    userMessage: z.string().optional(),
    additionalContext: z.string().optional(),
    reason: z.string().optional(),
  }),
})

export type ReminderThrottleEntry = z.infer<typeof ReminderThrottleEntrySchema>

/** Map of reminder ID → throttle entry */
export const ReminderThrottleStateSchema = z.record(z.string(), ReminderThrottleEntrySchema)

export type ReminderThrottleState = z.infer<typeof ReminderThrottleStateSchema>
```

**Step 2: Update RemindersSettings in packages/feature-reminders/src/types.ts**

In the `RemindersSettings` interface, replace:
```typescript
  /** Conversation messages between user-prompt-submit reminder injections (default: 10) */
  user_prompt_submit_threshold?: number
```
with:
```typescript
  /** Per-reminder throttle thresholds: reminder ID → message count between injections */
  reminder_thresholds?: Record<string, number>
```

In `DEFAULT_REMINDERS_SETTINGS`, replace:
```typescript
  user_prompt_submit_threshold: 10,
```
with:
```typescript
  reminder_thresholds: {
    'user-prompt-submit': 10,
    'remember-your-persona': 5,
  },
```

**Step 3: Add `throttle` to ReminderDefinition interface**

In the `ReminderDefinition` interface, add:
```typescript
  /** Whether this reminder participates in message-count throttling */
  throttle?: boolean
```

**Step 4: Run typecheck to verify (will have errors — expected since consumers haven't been updated)**

Run: `pnpm --filter @sidekick/types build`
Expected: PASS (types package compiles independently)

**Step 5: Commit**

```
feat(types): replace UPSThrottleState with generic ReminderThrottleState
```

---

### Task 2: Update YAML files

**Files:**
- Modify: `assets/sidekick/reminders/user-prompt-submit.yaml`
- Modify: `assets/sidekick/reminders/remember-your-persona.yaml`
- Modify: `assets/sidekick/defaults/features/reminders.defaults.yaml:17`
- Modify: `packages/feature-reminders/src/reminder-utils.ts:24-32` (Zod schema for YAML parsing)

**Step 1: Add `throttle: true` to user-prompt-submit.yaml**

The file already has `persistent: false`. Add `throttle: true` after the `persistent` line:

```yaml
id: user-prompt-submit
blocking: false
priority: 10
persistent: false
throttle: true
```

**Step 2: Update remember-your-persona.yaml**

Change `persistent: true` to `persistent: false` and add `throttle: true`:

```yaml
id: remember-your-persona
blocking: false
priority: 5
persistent: false
throttle: true
```

**Step 3: Update reminders.defaults.yaml**

Replace line 17 (`user_prompt_submit_threshold: 10`) with:

```yaml
  # Per-reminder throttle thresholds.
  # Maps reminder ID to minimum conversation messages (user + assistant turns)
  # between injections. Only applies to reminders with throttle: true in YAML.
  reminder_thresholds:
    user-prompt-submit: 10
    remember-your-persona: 5
```

**Step 4: Update ReminderDefinitionSchema in reminder-utils.ts**

At line 24-32, add the `throttle` field to the Zod schema:

```typescript
const ReminderDefinitionSchema = z.object({
  id: z.string(),
  blocking: z.boolean(),
  priority: z.number(),
  persistent: z.boolean(),
  throttle: z.boolean().optional(),
  userMessage: z.string().optional(),
  additionalContext: z.string().optional(),
  reason: z.string().optional(),
})
```

**Step 5: Commit**

```
feat(reminders): add throttle opt-in to YAML definitions and config
```

---

### Task 3: Update state accessor

**Files:**
- Modify: `packages/feature-reminders/src/state.ts` (replace UPSThrottle with ReminderThrottle)

**Context:** The state accessor factory creates typed accessors for per-session JSON state files. Replace the UPS-specific accessor with a generic one backed by the new schema.

**Step 1: Update imports**

Replace:
```typescript
import type {
  MinimalStateService,
  PRBaselineState,
  UPSThrottleState,
  VCUnverifiedState,
  VerificationToolsState,
} from '@sidekick/types'
import {
  PRBaselineStateSchema,
  UPSThrottleStateSchema,
  VCUnverifiedStateSchema,
  VerificationToolsStateSchema,
} from '@sidekick/types'
```
with:
```typescript
import type {
  MinimalStateService,
  PRBaselineState,
  ReminderThrottleState,
  VCUnverifiedState,
  VerificationToolsState,
} from '@sidekick/types'
import {
  PRBaselineStateSchema,
  ReminderThrottleStateSchema,
  VCUnverifiedStateSchema,
  VerificationToolsStateSchema,
} from '@sidekick/types'
```

**Step 2: Replace UPSThrottleDescriptor**

Replace:
```typescript
const UPSThrottleDescriptor = sessionState('ups-throttle.json', UPSThrottleStateSchema, {
  defaultValue: { messagesSinceLastStaging: 0 },
  trackHistory: false,
})
```
with:
```typescript
/**
 * Reminder Throttle state descriptor.
 * Per-reminder counters and cached resolved reminders for re-staging.
 * Default: {} (empty — no throttled reminders until first staging)
 * trackHistory: false — high-frequency updates, no need for history
 */
const ReminderThrottleDescriptor = sessionState('reminder-throttle.json', ReminderThrottleStateSchema, {
  defaultValue: {},
  trackHistory: false,
})
```

**Step 3: Update RemindersStateAccessors interface**

Replace:
```typescript
  /** UPS throttle state (conversation message counter) */
  upsThrottle: SessionStateAccessor<UPSThrottleState, { messagesSinceLastStaging: number }>
```
with:
```typescript
  /** Reminder throttle state (per-reminder counters and cached reminders) */
  reminderThrottle: SessionStateAccessor<ReminderThrottleState, Record<string, never>>
```

**Step 4: Update createRemindersState factory**

Replace:
```typescript
    upsThrottle: new SessionStateAccessor(stateService, UPSThrottleDescriptor),
```
with:
```typescript
    reminderThrottle: new SessionStateAccessor(stateService, ReminderThrottleDescriptor),
```

**Step 5: Commit**

```
refactor(state): replace upsThrottle with generic reminderThrottle accessor
```

---

### Task 4: Refactor throttle handler to be generic

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts`

**Context:** This file currently has 5 handlers. Handlers 1 and 2 (SessionStart/BulkProcessingComplete staging of the UPS reminder) stay as-is. Handlers 1b, 2b, and 3 (UPS-specific throttle reset and re-stage) get replaced with generic versions that operate on ALL throttled reminders.

**Important:** The generic handler needs a helper function `registerThrottledReminder()` that originating handlers call when they first stage a throttle-eligible reminder. This stores the counter + cached reminder in throttle state, so the generic handler can re-stage without knowing template context details.

**Step 1: Add a helper for registering throttled reminders**

Add this exported function (used by this file and by `stage-persona-reminders.ts`):

```typescript
import type { StagedReminder, HookName } from '@sidekick/types'

/**
 * Register a reminder in the throttle state.
 * Called by originating handlers when they first stage a throttle-eligible reminder.
 * Stores the counter (reset to 0) and caches the resolved reminder for re-staging.
 */
export async function registerThrottledReminder(
  ctx: DaemonContext,
  sessionId: string,
  reminderId: string,
  targetHook: HookName,
  resolvedReminder: StagedReminder
): Promise<void> {
  const remindersState = createRemindersState(ctx.stateService)
  const result = await remindersState.reminderThrottle.read(sessionId)
  const state = { ...result.data }
  state[reminderId] = {
    messagesSinceLastStaging: 0,
    targetHook,
    cachedReminder: {
      name: resolvedReminder.name,
      blocking: resolvedReminder.blocking,
      priority: resolvedReminder.priority,
      persistent: resolvedReminder.persistent,
      userMessage: resolvedReminder.userMessage,
      additionalContext: resolvedReminder.additionalContext,
      reason: resolvedReminder.reason,
    },
  }
  await remindersState.reminderThrottle.write(sessionId, state)
}
```

**Step 2: Update Handler 1 (SessionStart) to call registerThrottledReminder**

After staging the UPS reminder in the SessionStart handler, register it for throttling. Modify the `createStagingHandler` for `reminders:stage-default-user-prompt` to also register the reminder in throttle state. Since `createStagingHandler` doesn't expose the resolved reminder, convert this handler to use direct `context.handlers.register()` like the throttle handlers do.

Alternatively, add a separate handler that runs right after staging:

```typescript
// Handler 1c: Register UPS reminder in throttle state on SessionStart
if (isDaemonContext(context)) {
  const startCtx = context as unknown as DaemonContext
  context.handlers.register({
    id: 'reminders:throttle-register-ups-session-start',
    priority: 49, // After staging (50)
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      const sessionId = event.context.sessionId
      if (!sessionId) return

      const reminder = resolveReminder(ReminderIds.USER_PROMPT_SUBMIT, {
        context: { sessionId },
        assets: startCtx.assets,
      })
      if (reminder) {
        await registerThrottledReminder(startCtx, sessionId, ReminderIds.USER_PROMPT_SUBMIT, 'UserPromptSubmit', reminder)
      }
    },
  })
}
```

**Step 3: Replace Handler 1b (UPS-specific SessionStart reset) with generic reset**

Replace the `reminders:ups-throttle-reset-session-start` handler with:

```typescript
// Handler: Reset ALL throttle counters on SessionStart
if (isDaemonContext(context)) {
  const startCtx = context as unknown as DaemonContext
  context.handlers.register({
    id: 'reminders:throttle-reset-session-start',
    priority: 48, // After registration (49)
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      const sessionId = event.context.sessionId
      if (!sessionId) return
      const remindersState = createRemindersState(startCtx.stateService)
      const result = await remindersState.reminderThrottle.read(sessionId)
      const state = { ...result.data }
      for (const key of Object.keys(state)) {
        state[key] = { ...state[key], messagesSinceLastStaging: 0 }
      }
      await remindersState.reminderThrottle.write(sessionId, state)
    },
  })
}
```

**Step 4: Replace Handler 2b (UPS-specific BulkProcessingComplete reset) with generic reset**

Replace `reminders:ups-throttle-reset-bulk` with:

```typescript
// Handler: Reset ALL throttle counters on BulkProcessingComplete
if (isDaemonContext(context)) {
  const bulkCtx = context as unknown as DaemonContext
  context.handlers.register({
    id: 'reminders:throttle-reset-bulk',
    priority: 49,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    handler: async (event) => {
      if (!isTranscriptEvent(event)) return
      if (event.metadata.isBulkProcessing) return
      const sessionId = event.context?.sessionId
      if (!sessionId) return
      const remindersState = createRemindersState(bulkCtx.stateService)
      const result = await remindersState.reminderThrottle.read(sessionId)
      const state = { ...result.data }
      for (const key of Object.keys(state)) {
        state[key] = { ...state[key], messagesSinceLastStaging: 0 }
      }
      await remindersState.reminderThrottle.write(sessionId, state)
    },
  })
}
```

**Step 5: Replace Handler 3 (UPS-specific re-stage) with generic re-stage**

Replace `reminders:ups-throttle-restage` with:

```typescript
// Handler: Generic throttle re-staging for ALL throttled reminders
context.handlers.register({
  id: 'reminders:throttle-restage',
  priority: 50,
  filter: { kind: 'transcript', eventTypes: ['UserPrompt', 'AssistantMessage'] },
  handler: async (event, ctx) => {
    if (!isTranscriptEvent(event)) return
    if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
    if (event.metadata.isBulkProcessing) return

    const sessionId = event.context?.sessionId
    if (!sessionId) return

    const handlerCtx = ctx as unknown as DaemonContext
    const remindersState = createRemindersState(handlerCtx.stateService)

    // Read throttle state (all registered throttled reminders)
    const result = await remindersState.reminderThrottle.read(sessionId)
    const state = { ...result.data }

    if (Object.keys(state).length === 0) return

    // Read thresholds from config
    const featureConfig = handlerCtx.config.getFeature<RemindersSettings>('reminders')
    const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
    const thresholds = config.reminder_thresholds ?? {}

    let changed = false

    for (const [reminderId, entry] of Object.entries(state)) {
      const threshold = thresholds[reminderId]
      if (threshold === undefined) {
        // No threshold configured — skip (logged once at registration, not on every message)
        continue
      }

      const newCount = entry.messagesSinceLastStaging + 1

      if (newCount >= threshold) {
        // Re-stage from cached reminder
        await stageReminder(handlerCtx, entry.targetHook as HookName, entry.cachedReminder as StagedReminder)
        state[reminderId] = { ...entry, messagesSinceLastStaging: 0 }
        handlerCtx.logger.debug('Throttle: re-staged reminder', {
          sessionId,
          reminderId,
          messageCount: newCount,
          threshold,
        })
      } else {
        state[reminderId] = { ...entry, messagesSinceLastStaging: newCount }
      }
      changed = true
    }

    if (changed) {
      await remindersState.reminderThrottle.write(sessionId, state)
    }
  },
})
```

**Step 6: Remove old UPS-specific imports if no longer used**

Remove `UPSThrottleState`-related imports that are no longer referenced.

**Step 7: Run build**

Run: `pnpm build`
Expected: May have errors if persona integration isn't done yet. That's OK — Task 5 fixes it.

**Step 8: Commit**

```
refactor(reminders): replace UPS-specific throttle with generic handler
```

---

### Task 5: Persona integration

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts`

**Context:** The persona handler currently stages `remember-your-persona` as a persistent reminder on SessionStart. With the new system:
1. The reminder is now `persistent: false` (from Task 2 YAML change)
2. After staging, the persona handler must register the reminder in throttle state via `registerThrottledReminder()`
3. When persona changes mid-session (`restagePersonaRemindersForActiveSessions`), also update the cached reminder in throttle state

**Step 1: Import registerThrottledReminder**

Add to imports:
```typescript
import { registerThrottledReminder } from './stage-default-user-prompt.js'
```

**Step 2: Update stagePersonaRemindersForSession**

After the line `await stageReminder(ctx, targetHook, reminder)` inside the for-loop (around line 180), add registration for the throttle system. Only register for `UserPromptSubmit` hook (the `SessionStart` hook staging is always fresh):

```typescript
for (const targetHook of PERSONA_REMINDER_HOOKS) {
  await stageReminder(ctx, targetHook, reminder)
  // Register for throttle re-staging (UserPromptSubmit only)
  if (targetHook === 'UserPromptSubmit') {
    await registerThrottledReminder(ctx, sessionId, ReminderIds.REMEMBER_YOUR_PERSONA, 'UserPromptSubmit', reminder)
  }
}
```

**Step 3: Run build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```
feat(reminders): integrate persona reminder with generic throttle
```

---

### Task 6: Update and add tests

**Files:**
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Context:** The existing `describe('throttle re-staging')` block has 10 tests referencing `upsThrottle`, handler IDs like `reminders:ups-throttle-restage`, and `user_prompt_submit_threshold`. All must be updated to use the new generic names and verify multi-reminder behavior.

**Step 1: Update existing throttle tests**

Rename/update the following in the existing tests:

- Handler ID references: `reminders:ups-throttle-restage` → `reminders:throttle-restage`
- Handler ID references: `reminders:ups-throttle-reset-session-start` → `reminders:throttle-reset-session-start`
- Handler ID references: `reminders:ups-throttle-reset-bulk` → `reminders:throttle-reset-bulk`
- State accessor: `remindersState.upsThrottle` → `remindersState.reminderThrottle`
- Config key: `user_prompt_submit_threshold: 3` → `reminder_thresholds: { 'user-prompt-submit': 3 }`
- State assertions: `result.data.messagesSinceLastStaging` → `result.data['user-prompt-submit'].messagesSinceLastStaging`

**Important:** For the throttle tests to work, the throttle state must be pre-populated with a registered entry for `user-prompt-submit`. The `beforeEach` should seed the throttle state:

```typescript
beforeEach(async () => {
  // ... existing setup ...

  // Seed throttle state so the generic handler has a registered entry
  const remindersState = createRemindersState(stateService)
  await remindersState.reminderThrottle.write('test-session', {
    'user-prompt-submit': {
      messagesSinceLastStaging: 0,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'user-prompt-submit',
        blocking: false,
        priority: 10,
        persistent: false,
        additionalContext: 'Standard user prompt reminder',
      },
    },
  })
})
```

**Step 2: Add test for multi-reminder throttling**

```typescript
it('throttles multiple reminders independently', async () => {
  // Register both UPS and persona in throttle state
  const remindersState = createRemindersState(stateService)
  await remindersState.reminderThrottle.write('test-session', {
    'user-prompt-submit': {
      messagesSinceLastStaging: 0,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'user-prompt-submit',
        blocking: false,
        priority: 10,
        persistent: false,
        additionalContext: 'UPS content',
      },
    },
    'remember-your-persona': {
      messagesSinceLastStaging: 0,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'remember-your-persona',
        blocking: false,
        priority: 5,
        persistent: false,
        additionalContext: 'Persona content',
      },
    },
  })

  // Configure thresholds: persona=3, UPS=10
  const configWithThresholds = new MockConfigService()
  configWithThresholds.set({
    features: {
      reminders: {
        enabled: true,
        settings: {
          reminder_thresholds: {
            'user-prompt-submit': 10,
            'remember-your-persona': 3,
          },
        },
      },
    },
  })

  const customCtx = createMockDaemonContext({
    staging,
    logger,
    handlers,
    assets,
    stateService,
    config: configWithThresholds,
  })

  registerStageDefaultUserPrompt(customCtx)
  const handler = handlers.getHandler('reminders:throttle-restage')

  // Fire 3 events — persona should fire, UPS should not
  for (let i = 0; i < 3; i++) {
    const event = createConversationTranscriptEvent('UserPrompt')
    await handler?.handler(event, customCtx as unknown as import('@sidekick/types').HandlerContext)
  }

  const reminders = staging.getRemindersForHook('UserPromptSubmit')
  expect(reminders.some((r) => r.name === 'remember-your-persona')).toBe(true)
  expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(false)

  // Verify persona counter reset, UPS counter at 3
  const result = await remindersState.reminderThrottle.read('test-session')
  expect(result.data['remember-your-persona'].messagesSinceLastStaging).toBe(0)
  expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(3)
})
```

**Step 3: Add test for registerThrottledReminder helper**

```typescript
it('registerThrottledReminder caches reminder for re-staging', async () => {
  const { registerThrottledReminder } = await import('../handlers/staging/stage-default-user-prompt')

  await registerThrottledReminder(ctx, 'test-session', 'test-reminder', 'UserPromptSubmit', {
    name: 'test-reminder',
    blocking: false,
    priority: 10,
    persistent: false,
    additionalContext: 'Test content',
  })

  const remindersState = createRemindersState(stateService)
  const result = await remindersState.reminderThrottle.read('test-session')
  expect(result.data['test-reminder']).toBeDefined()
  expect(result.data['test-reminder'].messagesSinceLastStaging).toBe(0)
  expect(result.data['test-reminder'].cachedReminder.additionalContext).toBe('Test content')
})
```

**Step 4: Add test for persona reminder throttle integration**

```typescript
it('persona handler registers reminder in throttle state', async () => {
  // Set up persona mock
  mockCreatePersonaLoader.mockReturnValue({
    discover: () =>
      new Map([
        ['skippy', {
          id: 'skippy',
          display_name: 'Skippy',
          theme: 'Snarky AI beer can',
          tone_traits: ['condescending'],
          personality_traits: ['brilliant'],
          snarky_examples: ['Oh please'],
        }],
      ]),
  })

  // Set session persona state
  const personaStatePath = stateService.sessionStatePath('test-session', 'session-persona.json')
  await stateService.write(personaStatePath, { persona_id: 'skippy' }, SessionPersonaStateSchema)

  // Register persona YAML with throttle: true
  assets.registerAll({
    'reminders/remember-your-persona.yaml': `id: remember-your-persona
blocking: false
priority: 5
persistent: false
throttle: true
additionalContext: "You are {{persona_name}}"
`,
  })

  await stagePersonaRemindersForSession(ctx, 'test-session')

  // Check throttle state has cached entry
  const remindersState = createRemindersState(stateService)
  const result = await remindersState.reminderThrottle.read('test-session')
  expect(result.data['remember-your-persona']).toBeDefined()
  expect(result.data['remember-your-persona'].cachedReminder.additionalContext).toBe('You are Skippy')
})
```

**Step 5: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: All tests pass

**Step 6: Commit**

```
test(reminders): update throttle tests for generic multi-reminder support
```

---

### Task 7: Cleanup and verify

**Files:**
- Modify: `packages/types/src/services/state.ts` (remove old UPSThrottle exports if still present)
- Check: All references to `upsThrottle`, `UPSThrottle`, `user_prompt_submit_threshold` are removed

**Step 1: Search for stale references**

Run: `grep -r "upsThrottle\|UPSThrottle\|user_prompt_submit_threshold\|ups-throttle" packages/ assets/ --include='*.ts' --include='*.yaml' -l`

Fix any remaining references.

**Step 2: Update features.local.yaml (dev config)**

If `.sidekick/features.local.yaml` still has `user_prompt_submit_threshold`, update to:
```yaml
reminders:
  enabled: true
  settings:
    reminder_thresholds:
      user-prompt-submit: 10
      remember-your-persona: 5
```

**Step 3: Run full quality gates**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: All pass

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: All pass

**Step 4: Commit cleanup**

```
chore(reminders): remove stale UPS throttle references
```

---

### Summary of handler IDs (old → new)

| Old ID | New ID |
|--------|--------|
| `reminders:ups-throttle-reset-session-start` | `reminders:throttle-reset-session-start` |
| `reminders:ups-throttle-reset-bulk` | `reminders:throttle-reset-bulk` |
| `reminders:ups-throttle-restage` | `reminders:throttle-restage` |
| (new) | `reminders:throttle-register-ups-session-start` |

### Summary of state files (old → new)

| Old | New |
|-----|-----|
| `ups-throttle.json` | `reminder-throttle.json` |

### Summary of config keys (old → new)

| Old | New |
|-----|-----|
| `user_prompt_submit_threshold: 10` | `reminder_thresholds: { 'user-prompt-submit': 10, 'remember-your-persona': 5 }` |
