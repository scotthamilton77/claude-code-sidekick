# UPS Throttle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Throttle the user-prompt-submit reminder so it only fires after 10+ conversation messages have elapsed since last injection, reducing noise in frequent exchanges.

**Architecture:** Daemon-side staging throttle. The reminder changes from `persistent: true` to `persistent: false`. A new daemon transcript handler counts UserPrompt + AssistantMessage events and re-stages the reminder when the count reaches the configurable threshold. SessionStart and BulkProcessingComplete reset the counter and stage the reminder for the first prompt.

**Tech Stack:** TypeScript, Zod, Vitest, YAML config

---

### Task 1: Add UPSThrottleState schema to @sidekick/types

**Files:**
- Modify: `packages/types/src/services/state.ts`

**Step 1: Add the Zod schema and type export**

At the end of the file (before any closing comments), add:

```typescript
// ============================================================================
// UPS Throttle State Schema
// ============================================================================

/**
 * Tracks conversation messages since the user-prompt-submit reminder was last staged.
 * Used by the daemon to throttle re-staging of the UPS reminder.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/ups-throttle.json`
 *
 * @see docs/plans/2026-03-08-ups-throttle-design.md
 */
export const UPSThrottleStateSchema = z.object({
  /** Number of conversation messages since the reminder was last staged */
  messagesSinceLastStaging: z.number(),
})

export type UPSThrottleState = z.infer<typeof UPSThrottleStateSchema>
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @sidekick/types typecheck`
Expected: PASS (no errors)

**Step 3: Commit**

```
feat(types): add UPSThrottleState schema for reminder throttling
```

---

### Task 2: Add `user_prompt_submit_threshold` to RemindersSettings and defaults

**Files:**
- Modify: `packages/feature-reminders/src/types.ts`
- Modify: `assets/sidekick/defaults/features/reminders.defaults.yaml`

**Step 1: Add the field to RemindersSettings interface**

In `packages/feature-reminders/src/types.ts`, add to `RemindersSettings`:

```typescript
export interface RemindersSettings {
  pause_and_reflect_threshold: number
  source_code_patterns: string[]
  completion_detection?: CompletionDetectionSettings
  max_verification_cycles?: number
  verification_tools?: VerificationToolsMap
  /** Conversation messages between user-prompt-submit reminder injections (default: 10) */
  user_prompt_submit_threshold?: number
}
```

**Step 2: Add to DEFAULT_REMINDERS_SETTINGS**

```typescript
export const DEFAULT_REMINDERS_SETTINGS: RemindersSettings = {
  pause_and_reflect_threshold: 60,
  source_code_patterns: DEFAULT_SOURCE_CODE_PATTERNS,
  max_verification_cycles: -1,
  verification_tools: DEFAULT_VERIFICATION_TOOLS,
  user_prompt_submit_threshold: 10,
}
```

**Step 3: Add to YAML defaults**

In `assets/sidekick/defaults/features/reminders.defaults.yaml`, add under `settings:` (after `pause_and_reflect_threshold`):

```yaml
  # Minimum number of conversation messages (user + assistant turns) between
  # user-prompt-submit reminder injections. The reminder always fires on the
  # first prompt of a session, then waits until this many messages have elapsed.
  user_prompt_submit_threshold: 10
```

**Step 4: Verify typecheck**

Run: `pnpm --filter @sidekick/feature-reminders typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(reminders): add user_prompt_submit_threshold config (default: 10)
```

---

### Task 3: Add upsThrottle state accessor

**Files:**
- Modify: `packages/feature-reminders/src/state.ts`

**Step 1: Add import for new schema**

Add `UPSThrottleState` and `UPSThrottleStateSchema` to the imports from `@sidekick/types`:

```typescript
import type { MinimalStateService, PRBaselineState, VCUnverifiedState, VerificationToolsState, UPSThrottleState } from '@sidekick/types'
import { PRBaselineStateSchema, VCUnverifiedStateSchema, VerificationToolsStateSchema, UPSThrottleStateSchema } from '@sidekick/types'
```

**Step 2: Add the descriptor**

After `VerificationToolsDescriptor`:

```typescript
/**
 * UPS Throttle state descriptor.
 * Tracks conversation messages since last user-prompt-submit staging.
 * Default: { messagesSinceLastStaging: 0 }
 * trackHistory: false — high-frequency updates, no need for history
 */
const UPSThrottleDescriptor = sessionState('ups-throttle.json', UPSThrottleStateSchema, {
  defaultValue: { messagesSinceLastStaging: 0 },
  trackHistory: false,
})
```

**Step 3: Add to the interface**

```typescript
export interface RemindersStateAccessors {
  prBaseline: SessionStateAccessor<PRBaselineState, null>
  vcUnverified: SessionStateAccessor<VCUnverifiedState, null>
  verificationTools: SessionStateAccessor<VerificationToolsState, Record<string, never>>
  /** UPS throttle state (conversation message counter) */
  upsThrottle: SessionStateAccessor<UPSThrottleState, { messagesSinceLastStaging: number }>
}
```

**Step 4: Add to the factory**

```typescript
export function createRemindersState(stateService: MinimalStateService): RemindersStateAccessors {
  return {
    prBaseline: new SessionStateAccessor(stateService, PRBaselineDescriptor),
    vcUnverified: new SessionStateAccessor(stateService, VCUnverifiedDescriptor),
    verificationTools: new SessionStateAccessor(stateService, VerificationToolsDescriptor),
    upsThrottle: new SessionStateAccessor(stateService, UPSThrottleDescriptor),
  }
}
```

**Step 5: Verify typecheck**

Run: `pnpm --filter @sidekick/feature-reminders typecheck`
Expected: PASS

**Step 6: Commit**

```
feat(reminders): add upsThrottle state accessor
```

---

### Task 4: Change user-prompt-submit.yaml to non-persistent

**Files:**
- Modify: `assets/sidekick/reminders/user-prompt-submit.yaml`

**Step 1: Change persistent flag**

Change `persistent: true` to `persistent: false` on line 6.

**Step 2: Commit**

```
feat(reminders): make user-prompt-submit non-persistent for throttle support
```

---

### Task 5: Write failing tests for the throttle handler

**Files:**
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Add test helper for conversation transcript events**

Near the existing `createTestTranscriptEvent` helper, add:

```typescript
function createConversationTranscriptEvent(
  eventType: 'UserPrompt' | 'AssistantMessage',
  sessionId: string = 'test-session',
  metrics?: Partial<TranscriptMetrics>
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType,
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 1,
      entry: {},
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...(metrics ?? {}) },
    },
  }
}
```

**Step 2: Write tests for the throttle handler**

Add new tests inside the existing `describe('registerStageDefaultUserPrompt', ...)` block:

```typescript
    describe('throttle re-staging (Handler 3)', () => {
      it('registers a transcript handler for UserPrompt and AssistantMessage events', () => {
        registerStageDefaultUserPrompt(ctx)

        const transcriptHandlers = handlers.getHandlersByKind('transcript')
        const throttleHandler = transcriptHandlers.find(
          (h) => h.id === 'reminders:ups-throttle-restage'
        )
        expect(throttleHandler).toBeDefined()
      })

      it('increments message counter on UserPrompt event', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')
        const event = createConversationTranscriptEvent('UserPrompt')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const state = await stateService.read('test-session', 'ups-throttle.json')
        expect(JSON.parse(state as string).messagesSinceLastStaging).toBe(1)
      })

      it('increments message counter on AssistantMessage event', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')
        const event = createConversationTranscriptEvent('AssistantMessage')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const state = await stateService.read('test-session', 'ups-throttle.json')
        expect(JSON.parse(state as string).messagesSinceLastStaging).toBe(1)
      })

      it('does not re-stage when below threshold', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')

        // Fire 9 events (below default threshold of 10)
        for (let i = 0; i < 9; i++) {
          await handler?.handler(
            createConversationTranscriptEvent(i % 2 === 0 ? 'UserPrompt' : 'AssistantMessage'),
            ctx as unknown as import('@sidekick/types').HandlerContext
          )
        }

        // Should NOT have re-staged the reminder
        // (SessionStart handler stages it once, but throttle should not add another)
        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.filter((r) => r.name === 'user-prompt-submit')).toHaveLength(0)
      })

      it('re-stages reminder when threshold is met', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')

        // Fire exactly 10 events (meets default threshold)
        for (let i = 0; i < 10; i++) {
          await handler?.handler(
            createConversationTranscriptEvent(i % 2 === 0 ? 'UserPrompt' : 'AssistantMessage'),
            ctx as unknown as import('@sidekick/types').HandlerContext
          )
        }

        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(true)
      })

      it('resets counter after re-staging', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')

        // Hit threshold
        for (let i = 0; i < 10; i++) {
          await handler?.handler(
            createConversationTranscriptEvent('UserPrompt'),
            ctx as unknown as import('@sidekick/types').HandlerContext
          )
        }

        // Counter should be reset
        const state = await stateService.read('test-session', 'ups-throttle.json')
        expect(JSON.parse(state as string).messagesSinceLastStaging).toBe(0)
      })

      it('skips bulk replay events', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:ups-throttle-restage')
        const event = createConversationTranscriptEvent('UserPrompt')
        // Mark as bulk processing
        ;(event as any).metadata.isBulkProcessing = true

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        // Counter should remain at default (0)
        const state = await stateService.read('test-session', 'ups-throttle.json')
        const parsed = state ? JSON.parse(state as string) : null
        // Either null (not written) or 0
        expect(parsed?.messagesSinceLastStaging ?? 0).toBe(0)
      })

      it('respects configurable threshold', async () => {
        // Override config to threshold of 3
        const configService = new MockConfigService({
          reminders: {
            enabled: true,
            settings: { user_prompt_submit_threshold: 3 },
          },
        })
        const customCtx = createMockDaemonContext({ configService })
        registerStageDefaultUserPrompt(customCtx)

        const customHandlers = customCtx.handlers as unknown as MockHandlerRegistry
        const handler = customHandlers.getHandler('reminders:ups-throttle-restage')
        const customStaging = customCtx.staging as unknown as MockStagingService

        for (let i = 0; i < 3; i++) {
          await handler?.handler(
            createConversationTranscriptEvent('UserPrompt', 'test-session'),
            customCtx as unknown as import('@sidekick/types').HandlerContext
          )
        }

        const reminders = customStaging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(true)
      })
    })
```

**Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run -t "throttle re-staging"`
Expected: FAIL (handler `reminders:ups-throttle-restage` not found)

**Step 4: Commit**

```
test(reminders): add failing tests for UPS throttle re-staging
```

---

### Task 6: Implement the throttle handler

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts`

**Step 1: Add imports**

```typescript
import type { RuntimeContext } from '@sidekick/core'
import { isDaemonContext, isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/types'
import type { DaemonContext } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { createRemindersState } from '../../state.js'
```

**Step 2: Add Handler 3 inside `registerStageDefaultUserPrompt`**

After the existing Handler 2, add:

```typescript
  // Handler 3: Throttle re-staging based on conversation message count
  // Counts UserPrompt + AssistantMessage transcript events.
  // When count >= threshold, re-stages the reminder for the next UserPromptSubmit.
  if (!isDaemonContext(context)) return

  const daemonCtx = context as unknown as DaemonContext

  context.handlers.register({
    id: 'reminders:ups-throttle-restage',
    priority: 50,
    filter: { kind: 'transcript', eventTypes: ['UserPrompt', 'AssistantMessage'] },
    handler: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      // Skip bulk replay
      if (event.metadata.isBulkProcessing) return

      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const handlerCtx = ctx as unknown as DaemonContext
      const remindersState = createRemindersState(handlerCtx.stateService)

      // Read current counter
      const result = await remindersState.upsThrottle.read(sessionId)
      const current = result.data.messagesSinceLastStaging

      // Read threshold from config
      const featureConfig = handlerCtx.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const threshold = config.user_prompt_submit_threshold ?? 10

      const newCount = current + 1

      if (newCount >= threshold) {
        // Re-stage the reminder
        const reminder = resolveReminder(ReminderIds.USER_PROMPT_SUBMIT, {
          context: { sessionId },
          assets: handlerCtx.assets,
        })

        if (reminder) {
          await stageReminder(handlerCtx, 'UserPromptSubmit', reminder)
          handlerCtx.logger.debug('UPS throttle: re-staged reminder', {
            sessionId,
            messageCount: newCount,
            threshold,
          })
        }

        // Reset counter
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
      } else {
        // Increment counter
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: newCount })
      }
    },
  })
```

**Step 3: Add counter reset to Handler 1 (SessionStart)**

Modify Handler 1's execute to also reset the counter. Since `createStagingHandler` doesn't support side effects, we need to register a separate handler or add the reset after staging. The cleanest approach: register an additional SessionStart handler that resets the counter.

Add after Handler 1:

```typescript
  // Handler 1b: Reset UPS throttle counter on SessionStart
  if (isDaemonContext(context)) {
    const startCtx = context as unknown as DaemonContext
    context.handlers.register({
      id: 'reminders:ups-throttle-reset-session-start',
      priority: 49, // Just before Handler 1 (50)
      filter: { kind: 'hook', hooks: ['SessionStart'] },
      handler: async (event) => {
        if (!isHookEvent(event) || !isSessionStartEvent(event)) return
        const sessionId = event.context.sessionId
        if (!sessionId) return
        const remindersState = createRemindersState(startCtx.stateService)
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
      },
    })
  }
```

**Step 4: Add counter reset to Handler 2 (BulkProcessingComplete)**

Similarly, add a reset handler for bulk processing complete:

```typescript
  // Handler 2b: Reset UPS throttle counter on BulkProcessingComplete
  if (isDaemonContext(context)) {
    const bulkCtx = context as unknown as DaemonContext
    context.handlers.register({
      id: 'reminders:ups-throttle-reset-bulk',
      priority: 49,
      filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
      handler: async (event) => {
        if (!isTranscriptEvent(event)) return
        if (event.metadata.isBulkProcessing) return
        const sessionId = event.context?.sessionId
        if (!sessionId) return
        const remindersState = createRemindersState(bulkCtx.stateService)
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
      },
    })
  }
```

**Step 5: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run -t "throttle re-staging"`
Expected: PASS

**Step 6: Commit**

```
feat(reminders): implement daemon-side UPS throttle re-staging
```

---

### Task 7: Update existing tests for persistent: false

**Files:**
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Update the mock YAML in test setup**

Find the test YAML string for `user-prompt-submit.yaml` and change `persistent: true` to `persistent: false`:

```yaml
'reminders/user-prompt-submit.yaml': `id: user-prompt-submit
blocking: false
priority: 10
persistent: false
...`
```

**Step 2: Update the assertion**

Find the test `'stages persistent reminder on SessionStart'` and update:
- Rename test to `'stages non-persistent reminder on SessionStart'`
- Change assertion: `expect(reminders[0].persistent).toBe(false)`

**Step 3: Run full test suite for staging handlers**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run -t "registerStageDefaultUserPrompt"`
Expected: PASS

**Step 4: Commit**

```
test(reminders): update tests for non-persistent user-prompt-submit
```

---

### Task 8: Build and typecheck full project

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

Run: `pnpm --filter @sidekick/feature-reminders test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

**Step 5: Commit (if any fixes needed)**

```
fix(reminders): address build/lint issues from UPS throttle
```

---

### Task 9: Final verification

**Step 1: Verify the design doc is accurate**

Re-read `docs/plans/2026-03-08-ups-throttle-design.md` and confirm implementation matches.

**Step 2: Verify acceptance criteria**

- [ ] Build passes
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Reminder suppressed when below threshold
- [ ] Reminder fires when threshold met
- [ ] First prompt always gets reminder
- [ ] Bulk replay resets counter
- [ ] Threshold configurable via config cascade
