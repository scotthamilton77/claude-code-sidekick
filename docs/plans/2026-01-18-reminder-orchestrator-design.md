# ReminderOrchestrator Design

**Date:** 2026-01-18
**Task:** 9.6.1 Design ReminderOrchestrator rule engine
**Status:** Design approved, pending implementation

## Overview

ReminderOrchestrator centralizes the 4 cross-reminder coordination rules currently scattered across handlers. It lives in `feature-reminders` and uses function-based rules with event-based triggers.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rule format | Function-based | Simple, testable, TypeScript-native |
| Invocation | Centralized hook points | Handlers call orchestrator after their action |
| Execution context | Shared definitions, context-specific execution | Rules defined once, executed where triggered |
| Async coordination | Rely on daemon task queue | No new coordination needed |
| API style | Event-based triggers | Clear methods: `onReminderStaged`, `onReminderConsumed`, `onUserPromptSubmit` |
| Dependencies | Constructor injection | Good for testability |
| Baseline state | Delegate to existing accessors | Orchestrator coordinates, `remindersState` does the work |
| Caching | Separate non-caching StateService for staging | Avoids cross-process cache staleness |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  feature-reminders               │
│  ┌─────────────────────────────────────────────┐│
│  │         ReminderOrchestrator                ││
│  │  - onReminderStaged(reminder, sessionId)    ││
│  │  - onReminderConsumed(reminder, sessionId)  ││
│  │  - onUserPromptSubmit(sessionId)            ││
│  │                                             ││
│  │  Rules 1-4 (private methods)                ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
         ▲                           ▲
         │                           │
    Daemon calls               CLI calls
    (staging, UPS)            (consumption)
```

## Caching Strategy

Two StateService instances in daemon to avoid cross-process cache staleness:

```typescript
// daemon.ts constructor
this.stateService = new StateService(projectDir, {
  cache: true,   // For metrics, config, non-contended state
  logger, config,
})

this.stagingStateService = new StateService(projectDir, {
  cache: false,  // For stage/ files - cross-process access
  logger, config,
})
```

**Usage:**
- `ServiceFactoryImpl` receives `stagingStateService` → all staging ops uncached
- `remindersState` accessors (pr-baseline, vc-unverified) use regular `stateService` (daemon-only writes)
- CLI creates its own non-caching StateService (already does this)

## Orchestrator API

```typescript
// packages/feature-reminders/src/orchestrator.ts

export interface ReminderOrchestratorDeps {
  staging: StagingService
  stateService: MinimalStateService  // For baseline via remindersState
  logger: Logger
}

export class ReminderOrchestrator {
  private readonly remindersState: RemindersStateAccessors

  constructor(private readonly deps: ReminderOrchestratorDeps) {
    this.remindersState = createRemindersState(deps.stateService)
  }

  /** Called after a reminder is staged (daemon context) */
  async onReminderStaged(
    reminder: { name: string; hook: HookName },
    sessionId: string
  ): Promise<void>

  /** Called after a reminder is consumed (CLI context) */
  async onReminderConsumed(
    reminder: { name: string; hook: HookName },
    sessionId: string,
    metrics: { turnCount: number; toolsThisTurn: number; toolCount: number }
  ): Promise<void>

  /** Called on UserPromptSubmit (daemon context) */
  async onUserPromptSubmit(sessionId: string): Promise<void>
}
```

## Rule Implementations

### Rule 1: P&R staged → unstage VC (cascade prevention)

**Trigger:** `onReminderStaged` with `pause-and-reflect`
**Effect:** Delete `Stop/verify-completion.json`
**Rationale:** When P&R blocks the model, Stop hook fires immediately. Without this rule, VC would be consumed, defeating P&R's purpose.

### Rule 2: UserPromptSubmit → unstage VC or re-stage if unverified

**Trigger:** `onUserPromptSubmit`
**Effect:** Complex logic checking vc-unverified state and cycle limits
**Note:** Stays in `unstage-verify-completion.ts` for now due to complexity. Orchestrator hook exists for future consolidation.

### Rule 3: VC consumed → reset P&R baseline

**Trigger:** `onReminderConsumed` with `verify-completion`
**Effect:** Write `pr-baseline.json` with current metrics
**Rationale:** P&R threshold adjusts relative to where VC was consumed.

### Rule 4: VC consumed → unstage P&R (prevent double block)

**Trigger:** `onReminderConsumed` with `verify-completion`
**Effect:** Delete `PreToolUse/pause-and-reflect.json`
**Rationale:** Prevents both VC and P&R blocking simultaneously.

```typescript
class ReminderOrchestrator {
  async onReminderStaged(reminder, sessionId): Promise<void> {
    // Rule 1
    if (reminder.name === ReminderIds.PAUSE_AND_REFLECT) {
      await this.deps.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      this.deps.logger.debug('Rule 1: Unstaged VC after P&R staged', { sessionId })
    }
  }

  async onReminderConsumed(reminder, sessionId, metrics): Promise<void> {
    if (reminder.name === ReminderIds.VERIFY_COMPLETION) {
      // Rule 3
      await this.remindersState.prBaseline.write(sessionId, {
        setAt: {
          timestamp: Date.now(),
          turnCount: metrics.turnCount,
          toolsThisTurn: metrics.toolsThisTurn,
          toolCount: metrics.toolCount,
        },
      })
      this.deps.logger.debug('Rule 3: Reset P&R baseline after VC consumed', { sessionId })

      // Rule 4
      await this.deps.staging.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      this.deps.logger.debug('Rule 4: Unstaged P&R after VC consumed', { sessionId })
    }
  }

  async onUserPromptSubmit(sessionId): Promise<void> {
    // Rule 2 stays in unstage-verify-completion.ts for now
  }
}
```

## Handler Integration

### Daemon-side (staging handlers)

```typescript
// stage-pause-and-reflect.ts - AFTER
await ctx.staging.stageReminder('PreToolUse', reminder)

// Replace direct deleteReminder with orchestrator call
await ctx.orchestrator.onReminderStaged(
  { name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' },
  sessionId
)
```

### CLI-side (consumption handlers)

```typescript
// inject-stop.ts - AFTER
// Remove direct deleteReminder and IPC calls, replace with:
await orchestrator.onReminderConsumed(
  { name: reminder.name, hook: 'Stop' },
  sessionId,
  { turnCount, toolsThisTurn, toolCount }
)
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/feature-reminders/src/orchestrator.ts` | **New file** - ReminderOrchestrator class |
| `packages/sidekick-daemon/src/daemon.ts` | Add `stagingStateService`, create orchestrator, add to context |
| `packages/sidekick-core/src/service-factory.ts` | Accept separate stateService for staging |
| `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts` | Remove `deleteReminder`, call orchestrator |
| `packages/feature-reminders/src/handlers/consumption/inject-stop.ts` | Remove `deleteReminder` + IPC, call orchestrator |
| `packages/sidekick-types/src/context.ts` | Add `orchestrator` to DaemonContext |

## Error Handling

Orchestrator methods catch and log errors without throwing. A failed rule shouldn't break the handler's primary action.

```typescript
async onReminderStaged(reminder, sessionId): Promise<void> {
  try {
    if (reminder.name === ReminderIds.PAUSE_AND_REFLECT) {
      await this.deps.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
    }
  } catch (err) {
    this.deps.logger.warn('Rule 1 failed: unstage VC after P&R', {
      sessionId,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
```

## Testing Strategy

```typescript
describe('ReminderOrchestrator', () => {
  it('Rule 1: unstages VC when P&R staged', async () => {
    const staging = createMockStagingService()
    const orchestrator = new ReminderOrchestrator({ staging, stateService, logger })

    await orchestrator.onReminderStaged(
      { name: 'pause-and-reflect', hook: 'PreToolUse' },
      'session-123'
    )

    expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', 'verify-completion')
  })

  // Similar tests for Rules 3, 4
})
```

## Acceptance Criteria

- [ ] 4 cross-reminder rules in single declarative location (orchestrator.ts)
- [ ] Handlers have single responsibility (call orchestrator, don't implement rules)
- [ ] Adding new reminder type doesn't require modifying existing handlers
- [ ] Staging files use non-caching StateService
- [ ] Build passes. Typecheck passes. Tests pass.
