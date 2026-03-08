# Pin Persona Through Context Clear — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the active persona across `/clear` boundaries so personality continuity is maintained within the same terminal flow.

**Architecture:** On SessionEnd with `reason="clear"`, the daemon caches the active persona ID in memory. On the subsequent SessionStart with `source="clear"`, it reuses that cached persona instead of re-rolling, controlled by a `persistThroughClear` config setting (default: true). The `pinnedPersona` config always takes precedence.

**Tech Stack:** TypeScript, Vitest, YAML config

**Issue:** sidekick-1b3d

---

### Task 1: Add `persistThroughClear` to config type and defaults

**Files:**
- Modify: `packages/feature-session-summary/src/types.ts:66-83` (SessionSummaryConfig.personas)
- Modify: `packages/feature-session-summary/src/types.ts:115-124` (DEFAULT_SESSION_SUMMARY_CONFIG.personas)
- Modify: `assets/sidekick/defaults/features/session-summary.defaults.yaml:79-114`

**Step 1: Add `persistThroughClear` to the `SessionSummaryConfig` interface**

In `packages/feature-session-summary/src/types.ts`, add to the `personas` interface:

```typescript
  personas?: {
    // ... existing fields ...
    /** Preserve persona across /clear instead of re-rolling (default: true) */
    persistThroughClear?: boolean
  }
```

**Step 2: Add default value in `DEFAULT_SESSION_SUMMARY_CONFIG`**

```typescript
  personas: {
    // ... existing defaults ...
    persistThroughClear: true,
  },
```

**Step 3: Add to YAML defaults**

In `assets/sidekick/defaults/features/session-summary.defaults.yaml`, add under `personas:`:

```yaml
    # Preserve persona across /clear instead of re-rolling
    # When true, /clear keeps the same persona. When false, a new persona is randomly selected.
    persistThroughClear: true
```

**Step 4: Commit**

```bash
git add packages/feature-session-summary/src/types.ts assets/sidekick/defaults/features/session-summary.defaults.yaml
git commit -m "feat(config): add persistThroughClear persona setting"
```

---

### Task 2: Add `lastClearedPersona` in-memory cache to daemon

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts:115-120` (private fields)
- Modify: `packages/sidekick-daemon/src/daemon.ts:823-841` (handleSessionEnd)

**Step 1: Write failing test**

Create: `packages/sidekick-daemon/src/__tests__/persona-clear-handoff.test.ts`

```typescript
/**
 * Tests for persona preservation across /clear boundaries.
 * @see docs/plans/2026-03-07-pin-persona-through-clear-design.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionEndHookEvent, SessionPersonaState } from '@sidekick/types'
import { createMockDaemonContext, MockLogger, MockStateService } from '@sidekick/testing-fixtures'

// We'll test the handler function directly once extracted
// For now, test the cache logic in isolation

describe('persona clear handoff', () => {
  describe('capturePersonaOnClear', () => {
    it('reads persona state and caches it when endReason is clear', async () => {
      // Will be filled in after implementation shape is clear
    })

    it('does not cache when endReason is not clear', async () => {
      // Will be filled in
    })

    it('does not cache when no persona state exists', async () => {
      // Will be filled in
    })
  })
})
```

This is a placeholder — the real tests come in Task 4 after we know the exact function signatures.

**Step 2: Add `lastClearedPersona` field to daemon**

In `packages/sidekick-daemon/src/daemon.ts`, after the `logCounters` field (~line 120):

```typescript
  /** Transient cache for persona handoff across /clear boundaries */
  private lastClearedPersona: { personaId: string; timestamp: number } | null = null
```

**Step 3: Add getter/setter methods to daemon**

Below the field, add accessor methods that the SessionEnd handler and SessionStart handler can use:

```typescript
  /** Cache persona for handoff on clear. Called by SessionEnd handler. */
  cachePersonaForClear(personaId: string): void {
    this.lastClearedPersona = { personaId, timestamp: Date.now() }
    this.logger.debug('Cached persona for clear handoff', { personaId })
  }

  /** Consume cached persona if fresh (< 5s). Called by persona selection on clear. Returns null if stale/absent. */
  consumeCachedPersona(): string | null {
    if (!this.lastClearedPersona) return null
    const age = Date.now() - this.lastClearedPersona.timestamp
    const HANDOFF_TTL_MS = 5000
    if (age > HANDOFF_TTL_MS) {
      this.logger.debug('Stale persona handoff ignored', { age, personaId: this.lastClearedPersona.personaId })
      this.lastClearedPersona = null
      return null
    }
    const personaId = this.lastClearedPersona.personaId
    this.lastClearedPersona = null
    this.logger.debug('Consumed persona from clear handoff', { personaId, age })
    return personaId
  }
```

**Step 4: Capture persona in `handleSessionEnd`**

In `packages/sidekick-daemon/src/daemon.ts`, modify `handleSessionEnd` to capture persona on clear:

```typescript
  private async handleSessionEnd(event: HookEvent, options?: { logger?: Logger }): Promise<void> {
    const log = options?.logger ?? this.logger
    const sessionId = event.context?.sessionId
    if (sessionId) {
      // Capture persona for clear handoff before shutting down services
      const payload = event.payload as { endReason?: string }
      if (payload.endReason === 'clear') {
        try {
          const summaryState = createSessionSummaryState(this.stateService)
          const result = await summaryState.sessionPersona.read(sessionId)
          if (result.data?.persona_id) {
            this.cachePersonaForClear(result.data.persona_id)
          }
        } catch (err) {
          log.warn('Failed to cache persona for clear handoff', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // ... existing shutdown logic (instrumented provider, log counters, serviceFactory) ...
```

Note: This requires importing `createSessionSummaryState` from `@sidekick/feature-session-summary` — check for circular dependency. If circular, read the state file directly via `stateService`. The daemon already imports from `@sidekick/feature-session-summary` (line 39-43), so this should be safe.

Actually — the daemon already has access to `this.serviceFactory` which can get the `StateService`. But `createSessionSummaryState` needs a `MinimalStateService`. Check what the daemon uses. The daemon has `StateService` via `this.stateService` (grep for it). If there's no `this.stateService` field, use `this.serviceFactory.getStateService(sessionId)` or equivalent.

**Important:** The state read MUST happen BEFORE `this.serviceFactory.shutdownSession(sessionId)` since shutdown may clean up the state service.

**Step 5: Commit**

```bash
git add packages/sidekick-daemon/src/daemon.ts packages/sidekick-daemon/src/__tests__/persona-clear-handoff.test.ts
git commit -m "feat(daemon): add persona clear handoff cache"
```

---

### Task 3: Thread `startType` and daemon reference to persona selection

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/create-first-summary.ts`
- Modify: `packages/feature-session-summary/src/handlers/persona-selection.ts`

**Step 1: Add `startType` parameter to `selectPersonaForSession`**

The current signature is:
```typescript
export async function selectPersonaForSession(
  sessionId: string,
  config: SessionSummaryConfig,
  ctx: DaemonContext
): Promise<string | null>
```

Add an options parameter:

```typescript
export interface PersonaSelectionOptions {
  /** How the session started (startup, clear, resume, compact) */
  startType?: 'startup' | 'clear' | 'resume' | 'compact'
  /** Callback to consume cached persona from clear handoff */
  consumeCachedPersona?: () => string | null
}

export async function selectPersonaForSession(
  sessionId: string,
  config: SessionSummaryConfig,
  ctx: DaemonContext,
  options?: PersonaSelectionOptions,
): Promise<string | null>
```

**Step 2: Add clear handoff logic after pinned persona check, before random selection**

In `selectPersonaForSession`, after the `pinnedPersona` block (~line 185) and before `parsePersonaList`:

```typescript
  // Check for persona preserved from /clear handoff
  const persistThroughClear = personaConfig.persistThroughClear ?? true
  if (
    persistThroughClear &&
    options?.startType === 'clear' &&
    options?.consumeCachedPersona
  ) {
    const cachedPersonaId = options.consumeCachedPersona()
    if (cachedPersonaId) {
      // Verify the cached persona still exists in discovered personas
      const cachedPersona = allPersonas.get(cachedPersonaId)
      if (cachedPersona) {
        const personaState: SessionPersonaState = {
          persona_id: cachedPersona.id,
          selected_from: [cachedPersona.id],
          timestamp: new Date().toISOString(),
        }
        const summaryState = createSessionSummaryState(ctx.stateService)
        await summaryState.sessionPersona.write(sessionId, personaState)

        ctx.logger.info('Preserved persona through clear', {
          sessionId,
          personaId: cachedPersona.id,
          personaName: cachedPersona.display_name,
        })
        return cachedPersona.id
      } else {
        ctx.logger.warn('Cached persona from clear not found in available personas, falling back to selection', {
          sessionId,
          cachedPersonaId,
        })
      }
    }
  }
```

**Step 3: Pass `startType` and `consumeCachedPersona` from `createFirstSessionSummary`**

In `create-first-summary.ts`, update the call to `selectPersonaForSession`:

```typescript
  // Select and persist persona for this session
  await selectPersonaForSession(sessionId, config, ctx, {
    startType,
    consumeCachedPersona: () => (ctx as any).daemon?.consumeCachedPersona?.() ?? null,
  })
```

Wait — this coupling is problematic. The `DaemonContext` doesn't expose the daemon instance. We need a clean way to pass the `consumeCachedPersona` callback.

**Better approach:** Add `consumeCachedPersona` to `DaemonContext` (or a sub-interface). Or, since the daemon already registers handlers via the handler registry, we can expose it through a service.

**Simplest approach:** Add the cache to `DaemonContext` as an optional service. The daemon sets it; the handler reads it.

Actually, the cleanest approach: The daemon's `handleSessionStart` already runs before handler dispatch (line 738-739). We can have the daemon set a transient property on the event context, or pass it via a well-known key.

**Revised approach:** Add an optional `personaClearCache` to the `DaemonContext` interface:

In `packages/types/src/services/daemon-context.ts` (or wherever `DaemonContext` is defined):

```typescript
export interface DaemonContext {
  // ... existing ...
  /** Optional persona clear handoff cache (set by daemon) */
  personaClearCache?: {
    consume(): string | null
  }
}
```

Then in the daemon constructor/init, set `ctx.personaClearCache = { consume: () => this.consumeCachedPersona() }`.

And in `selectPersonaForSession`:

```typescript
  if (persistThroughClear && options?.startType === 'clear' && ctx.personaClearCache) {
    const cachedPersonaId = ctx.personaClearCache.consume()
    // ...
  }
```

This keeps the function signature simpler — just pass `{ startType }` as options.

**Step 4: Update call site in `createFirstSessionSummary`**

```typescript
  await selectPersonaForSession(sessionId, config, ctx, { startType })
```

**Step 5: Commit**

```bash
git add packages/feature-session-summary/src/handlers/create-first-summary.ts packages/feature-session-summary/src/handlers/persona-selection.ts packages/types/src/...
git commit -m "feat(persona): thread startType and clear cache to selection logic"
```

---

### Task 4: Write comprehensive tests

**Files:**
- Modify: `packages/feature-session-summary/src/__tests__/persona-selection.test.ts`

**Step 1: Add tests for clear handoff in `selectPersonaForSession`**

Add a new `describe('persona persistence through clear')` block:

```typescript
describe('persona persistence through clear', () => {
  let mockLogger: MockLogger
  let mockStateService: MockStateService
  let mockCreatePersonaLoader: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockLogger = new MockLogger()
    mockStateService = new MockStateService()
    const coreMod = await import('@sidekick/core')
    mockCreatePersonaLoader = coreMod.createPersonaLoader as ReturnType<typeof vi.fn>
  })

  function setupMockLoader(personas: Map<string, PersonaDefinition>): void {
    mockCreatePersonaLoader.mockReturnValue({
      discover: () => personas,
      load: vi.fn(),
      loadFile: vi.fn(),
      resolver: {},
      cascadeLayers: [],
    })
  }

  it('preserves persona on clear when persistThroughClear is true and cache has valid entry', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: () => 'bones' },
    })

    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, persistThroughClear: true },
    }

    const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

    expect(result).toBe('bones')
    expect(mockLogger.wasLoggedAtLevel('Preserved persona through clear', 'info')).toBe(true)
  })

  it('re-selects randomly when persistThroughClear is false', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const consumeMock = vi.fn(() => 'skippy')
    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: consumeMock },
    })

    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, persistThroughClear: false },
    }

    await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

    // consume should NOT have been called
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('falls through to normal selection when no cached persona', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: () => null },
    })

    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, persistThroughClear: true },
    }

    const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

    expect(result).toBe('skippy') // falls through to random (only one available)
  })

  it('falls through when cached persona ID not found in discovered personas', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: () => 'deleted-persona' },
    })

    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, persistThroughClear: true },
    }

    const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

    expect(result).toBe('skippy')
    expect(mockLogger.wasLoggedAtLevel('Cached persona from clear not found in available personas, falling back to selection', 'warn')).toBe(true)
  })

  it('does not use cache on startup (only on clear)', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const consumeMock = vi.fn(() => 'skippy')
    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: consumeMock },
    })

    await selectPersonaForSession('new-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx, { startType: 'startup' })

    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('pinnedPersona takes precedence over clear cache', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const consumeMock = vi.fn(() => 'bones')
    const ctx = createMockDaemonContext({
      logger: mockLogger,
      stateService: mockStateService,
      personaClearCache: { consume: consumeMock },
    })

    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
        pinnedPersona: 'skippy',
        persistThroughClear: true,
      },
    }

    const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

    expect(result).toBe('skippy') // pinned wins
    expect(consumeMock).not.toHaveBeenCalled() // cache never consulted
  })
})
```

**Step 2: Run tests**

```bash
pnpm --filter @sidekick/feature-session-summary test -- --run persona-selection
```

Expected: All new tests FAIL (feature not implemented yet)

**Step 3: Commit test file**

```bash
git add packages/feature-session-summary/src/__tests__/persona-selection.test.ts
git commit -m "test(persona): add clear handoff preservation tests (red)"
```

---

### Task 5: Implement the feature

**Files:**
- Modify: `packages/feature-session-summary/src/types.ts`
- Modify: `assets/sidekick/defaults/features/session-summary.defaults.yaml`
- Modify: `packages/types/src/services/` (DaemonContext — find exact file)
- Modify: `packages/sidekick-daemon/src/daemon.ts`
- Modify: `packages/feature-session-summary/src/handlers/persona-selection.ts`
- Modify: `packages/feature-session-summary/src/handlers/create-first-summary.ts`
- Modify: `packages/testing-fixtures/` (createMockDaemonContext — add personaClearCache)

Follow the code changes described in Tasks 1-3 above. Implementation order:

1. Config type + defaults (Task 1)
2. DaemonContext type update (add `personaClearCache`)
3. Testing fixtures update (add `personaClearCache` to mock)
4. Daemon field + handleSessionEnd capture (Task 2)
5. Persona selection reuse path (Task 3)
6. Thread startType from createFirstSessionSummary (Task 3)

**Step: Run tests after implementation**

```bash
pnpm --filter @sidekick/feature-session-summary test -- --run persona-selection
```

Expected: All tests PASS

**Step: Run full quality gates**

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm --filter @sidekick/feature-session-summary test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/sidekick-daemon test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

**Step: Commit**

```bash
git add -A
git commit -m "feat(persona): preserve persona through context clear (sidekick-1b3d)"
```

---

### Task 6: Sync defaults to sidekick-dist

**Files:**
- Modify: `packages/sidekick-dist/assets/sidekick/defaults/features/session-summary.defaults.yaml`

The `sidekick-dist` package has its own copy of defaults. Sync the `persistThroughClear` addition.

```bash
cp assets/sidekick/defaults/features/session-summary.defaults.yaml packages/sidekick-dist/assets/sidekick/defaults/features/session-summary.defaults.yaml
git add packages/sidekick-dist/assets/sidekick/defaults/features/session-summary.defaults.yaml
git commit -m "chore: sync session-summary defaults to sidekick-dist"
```

---

### Task 7: Final verification and cleanup

**Step 1: Run full build and test suite**

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm --filter @sidekick/core test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/feature-session-summary test -- --run
pnpm --filter @sidekick/sidekick-daemon test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

**Step 2: Clean up any temp files**

```bash
# Check for stray files
git status
```

**Step 3: Delete placeholder test file if superseded**

If `packages/sidekick-daemon/src/__tests__/persona-clear-handoff.test.ts` was created as placeholder and all tests live in `persona-selection.test.ts`, delete it.

**Step 4: Final commit if needed, then ready for PR**
