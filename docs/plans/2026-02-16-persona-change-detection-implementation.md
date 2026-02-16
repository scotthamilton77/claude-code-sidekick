# Persona Change Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate redundant `persona-changed` one-shot reminders by tracking what persona was last staged per session, distinguishing initialization from genuine mid-session changes.

**Architecture:** Add a `last-staged-persona.json` state file per session with three logical states (never-staged, staged, cleared). The `stagePersonaRemindersForSession` function gains awareness of prior state and decides whether to honor `includeChangedReminder` based on comparison. No other files change behavior.

**Tech Stack:** TypeScript, Zod schemas, Vitest

**Design doc:** `docs/plans/2026-02-16-persona-change-detection-design.md`

---

### Task 1: Add LastStagedPersonaSchema to @sidekick/types

**Files:**
- Modify: `packages/types/src/services/state.ts:97` (after SessionPersonaState)

**Step 1: Add the schema**

Add after `SessionPersonaState` type (line 97) in `packages/types/src/services/state.ts`:

```typescript
/**
 * Tracks which persona was last staged into reminders for change detection.
 * Three logical states:
 * - File absent: never staged (session initialization)
 * - { personaId: null }: explicitly cleared mid-session
 * - { personaId: "X" }: persona X was last staged
 *
 * Location: `.sidekick/sessions/{sessionId}/state/last-staged-persona.json`
 *
 * @see docs/plans/2026-02-16-persona-change-detection-design.md
 */
export const LastStagedPersonaSchema = z.object({
  /** Last staged persona ID, or null if explicitly cleared */
  personaId: z.string().nullable(),
})

export type LastStagedPersona = z.infer<typeof LastStagedPersonaSchema>
```

**Step 2: Verify build**

Run: `pnpm --filter @sidekick/types build`
Expected: SUCCESS

**Step 3: Commit**

```
git add packages/types/src/services/state.ts
git commit -m "feat(types): add LastStagedPersonaSchema for persona change detection"
```

---

### Task 2: Write failing tests for persona change detection

**Files:**
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

Add a new `describe` block inside the existing `registerStagePersonaReminders` describe (after the `restagePersonaRemindersForActiveSessions` block, around line 1617).

**Step 1: Write the failing tests**

Add before the closing `})` of the `registerStagePersonaReminders` describe block:

```typescript
    describe('persona change detection (last-staged tracking)', () => {
      const personaReminderYaml = {
        'reminders/remember-your-persona.yaml': `id: remember-your-persona
blocking: false
priority: 5
persistent: true
additionalContext: "Persona: {{persona_name}} - {{persona_tone}}"
`,
        'reminders/persona-changed.yaml': `id: persona-changed
blocking: false
priority: 8
persistent: false
additionalContext: "Your persona has changed to: {{persona_name}}"
`,
      }

      const personaB = {
        id: 'vader',
        display_name: 'Vader',
        theme: 'A Sith Lord',
        personality_traits: ['menacing', 'dramatic'],
        tone_traits: ['deep', 'commanding'],
        snarky_examples: ['I find your lack of faith disturbing.'],
      }

      function createCtxWithState(projectDir: string) {
        const stateService = new MockStateService(projectDir)
        const ctxWithState = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })
        assets.registerAll(personaReminderYaml)
        return { stateService, ctx: ctxWithState }
      }

      it('does NOT stage persona-changed on first staging (never_staged → persona)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-1')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        // Call with includeChangedReminder: true (as file watcher would)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        // Persistent reminder should be staged
        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(true)
        // One-shot should NOT be staged (initialization, not change)
        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'persona-changed')).toBe(false)
      })

      it('stages persona-changed when persona genuinely changes (A → B)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-2')

        // First staging: establish persona A
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Clear staged reminders to isolate second call
        await staging.deleteReminder('UserPromptSubmit', 'remember-your-persona')
        await staging.deleteReminder('SessionStart', 'remember-your-persona')

        // Second staging: switch to persona B
        setupPersonaState(stateService, 'vader')
        setupPersonaLoader('vader', personaB)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        // One-shot SHOULD be staged (genuine change)
        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'persona-changed')).toBe(true)
      })

      it('does NOT stage persona-changed when same persona is re-staged', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-3')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        // First staging
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Second staging with same persona (file watcher re-trigger)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        // One-shot should NOT be staged (same persona)
        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'persona-changed')).toBe(false)
      })

      it('stages persona-changed when going from cleared → persona mid-session', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-4')

        // First: establish persona A
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Second: clear persona (simulates persona clear command)
        const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
        stateService.clearStored(personaPath)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Clear staged reminders to isolate third call
        await staging.deleteReminder('UserPromptSubmit', 'remember-your-persona')
        await staging.deleteReminder('SessionStart', 'remember-your-persona')

        // Third: set persona B (going from cleared → B)
        setupPersonaState(stateService, 'vader')
        setupPersonaLoader('vader', personaB)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        // One-shot SHOULD be staged (cleared → new persona = genuine change)
        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'persona-changed')).toBe(true)
      })

      it('does NOT stage persona-changed on SessionStart path (no includeChangedReminder)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-5')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        // SessionStart path: no includeChangedReminder
        await stagePersonaRemindersForSession(testCtx, sessionId)

        expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'persona-changed')).toBe(false)
      })

      it('writes last-staged state after successful staging', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-6')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Verify state was written
        const lastStagedPath = stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
        const result = await stateService.read(lastStagedPath, LastStagedPersonaSchema, null)
        expect(result.data).toEqual({ personaId: 'skippy' })
      })

      it('writes null personaId to last-staged state when clearing', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-7')

        // First: establish persona
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Second: clear persona
        const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
        stateService.clearStored(personaPath)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Verify state records the clear
        const lastStagedPath = stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
        const result = await stateService.read(lastStagedPath, LastStagedPersonaSchema, null)
        expect(result.data).toEqual({ personaId: null })
      })
    })
```

Note: You will need to add `LastStagedPersonaSchema` to the imports from `@sidekick/types` at the top of the file, and `MockStateService` should already be imported from `@sidekick/testing-fixtures`. Also check if `MockStateService` has a `clearStored` method — if not, use `stateService.delete(path)` instead.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: FAIL — tests reference `LastStagedPersonaSchema` and expect behavior not yet implemented

**Step 3: Commit failing tests**

```
git add packages/feature-reminders/src/__tests__/staging-handlers.test.ts
git commit -m "test(reminders): add failing tests for persona change detection"
```

---

### Task 3: Implement three-state tracking in stagePersonaRemindersForSession

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts`

**Step 1: Add imports**

Add `LastStagedPersonaSchema` to the import from `@sidekick/types` on line 15:

```typescript
import { isDaemonContext, isHookEvent, isSessionStartEvent, SessionPersonaStateSchema, LastStagedPersonaSchema } from '@sidekick/types'
```

**Step 2: Add helper to read last-staged state**

Add after the `loadPersonaForSession` function (after line 98):

```typescript
/**
 * Read the last-staged persona state for change detection.
 * Returns null if no state file exists (never staged).
 */
async function readLastStagedPersona(ctx: DaemonContext, sessionId: string): Promise<{ personaId: string | null } | null> {
  const path = ctx.stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
  const result = await ctx.stateService.read(path, LastStagedPersonaSchema, null)
  return result.data
}

/**
 * Write last-staged persona state after staging.
 */
async function writeLastStagedPersona(ctx: DaemonContext, sessionId: string, personaId: string | null): Promise<void> {
  const path = ctx.stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
  await ctx.stateService.write(path, { personaId }, LastStagedPersonaSchema)
}
```

**Step 3: Update clearPersonaReminders to accept context for state tracking**

Change the `clearPersonaReminders` function signature and body to also write the cleared state:

```typescript
async function clearPersonaReminders(ctx: DaemonContext, sessionId: string): Promise<void> {
  for (const hook of PERSONA_REMINDER_HOOKS) {
    await ctx.staging.deleteReminder(hook, ReminderIds.REMEMBER_YOUR_PERSONA)
  }
  await ctx.staging.deleteReminder('UserPromptSubmit', ReminderIds.PERSONA_CHANGED)

  // Record that persona was explicitly cleared (distinguishes from never-staged)
  const lastStaged = await readLastStagedPersona(ctx, sessionId)
  if (lastStaged !== null) {
    // Only write cleared state if we previously had a staged persona
    await writeLastStagedPersona(ctx, sessionId, null)
  }
}
```

**Step 4: Update all callers of clearPersonaReminders**

The function is called in two places within `stagePersonaRemindersForSession`. Update both to pass `sessionId`:

Line ~123: `await clearPersonaReminders(ctx, sessionId)`
Line ~131: `await clearPersonaReminders(ctx, sessionId)`

**Step 5: Add change detection logic to stagePersonaRemindersForSession**

After the persistent reminder is staged (after line 154, before the `includeChangedReminder` check), add the change detection logic. Replace the existing one-shot block (lines 156-170) with:

```typescript
  // Determine if persona actually changed for one-shot decision
  if (options?.includeChangedReminder) {
    const lastStaged = await readLastStagedPersona(ctx, sessionId)
    const isGenuineChange =
      lastStaged !== null && // null = never staged (initialization) → skip
      lastStaged.personaId !== persona.id // different persona (including null→X for cleared→persona)

    if (isGenuineChange) {
      const changedReminder = resolveReminder(ReminderIds.PERSONA_CHANGED, {
        context: templateContext,
        assets: ctx.assets,
      })
      if (changedReminder) {
        await stageReminder(ctx, 'UserPromptSubmit', changedReminder)
      } else {
        ctx.logger.warn('Failed to resolve persona-changed reminder', {
          reminderId: ReminderIds.PERSONA_CHANGED,
          sessionId,
        })
      }
    } else {
      ctx.logger.debug('Skipping persona-changed one-shot', {
        sessionId,
        reason: lastStaged === null ? 'first staging (initialization)' : 'same persona',
        personaId: persona.id,
      })
    }
  }

  // Record what we just staged for future change detection
  await writeLastStagedPersona(ctx, sessionId, persona.id)
```

**Step 6: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```
git add packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts
git commit -m "feat(reminders): implement three-state persona change detection"
```

---

### Task 4: Build and typecheck

**Step 1: Full build**

Run: `pnpm build`
Expected: SUCCESS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: SUCCESS

**Step 3: Run full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Then: `pnpm --filter @sidekick/feature-reminders test`
Expected: ALL PASS

**Step 4: Commit if any adjustments were needed**

If any fixes were required, commit them:
```
git commit -m "fix(reminders): address build/type issues from persona change detection"
```

---

### Task 5: Update existing tests for clearPersonaReminders signature change

The `clearPersonaReminders` function signature changed to require `sessionId`. Since it's a private function only called within `stagePersonaRemindersForSession`, existing tests that call `stagePersonaRemindersForSession` should continue to work. However, verify that the cleanup test (line 1479) still passes since it calls `stagePersonaRemindersForSession` which internally calls `clearPersonaReminders`.

**Step 1: Run the specific existing tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts -t "cleans up existing persona reminders"`
Expected: PASS

**Step 2: Run all staging handler tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: ALL PASS

No commit needed if all pass without changes.
