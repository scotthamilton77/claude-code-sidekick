# AGENTS.md — @sidekick/feature-reminders

## Role

Context-aware reminder system using staging/consumption pattern with cross-reminder coordination.

## Architecture

```
Daemon (staging)              CLI (consumption)
      │                              │
TranscriptEvent ──────────► StagingService.stageReminder()
      │                              │
      ├── stage-pause-and-reflect    │
      └── stage-verify-completion    │
                                     │
                           HookEvent ◄── UserPromptSubmit/Stop
                                     │
                           consume-staged-reminder.ts
                                     │
                           ReminderOrchestrator ◄── cross-reminder rules
```

## Key Components

| File | Purpose |
|------|---------|
| `orchestrator.ts` | Cross-reminder coordination rules (4 rules) |
| `handlers/staging/` | Daemon handlers: stage P&R, stage VC |
| `handlers/consumption/` | CLI handlers: consume reminders, inject stop |
| `handlers/ipc/` | IPC message handlers: reminder-consumed, vc-unverified |
| `completion-classifier.ts` | Classifies if assistant response is a completion claim |
| `state.ts` | Typed accessors for P&R baseline, VC state |

## Orchestrator Rules

The `ReminderOrchestrator` centralizes 4 cross-reminder coordination rules:

| # | Trigger | Action |
|---|---------|--------|
| 1 | P&R staged | Unstage VC (cascade prevention) |
| 2 | UserPromptSubmit | Unstage VC or re-stage if unverified (in handler) |
| 3 | VC consumed | Reset P&R baseline |
| 4 | VC consumed | Unstage P&R (prevent double block) |

## Reminder Types

| ID | Hook | Purpose |
|----|------|---------|
| `pause-and-reflect` | PreToolUse | Cadence-based "are you on track?" prompt |
| `verify-completion` | Stop | Verify claims of completion before ending |

## Constraints

- **Staging in Daemon, consumption in CLI** — separation of concerns
- **Orchestrator catches errors** — failed rules don't break primary action
- **IPC handlers exported** — daemon imports and wires them to IPC messages
- **State via typed accessors** — `createRemindersState()` returns typed read/write/delete

## Reference

- `docs/design/FEATURE-REMINDERS.md` for staging/consumption flow
- `docs/plans/2026-01-18-reminder-orchestrator-design.md` for orchestrator design
