# AGENTS.md — @sidekick/sidekick-daemon

## Role

Long-running background process for single-writer state management, task execution, and IPC.

## Architecture

```
CLI ──IPC──► Daemon
              │
              ├── StateService (atomic writes, caching)
              ├── TaskEngine (priority queue, worker pool)
              ├── HandlerRegistry (transcript + hook handlers)
              ├── ConfigWatcher (hot-reload on YAML changes)
              ├── ContextMetricsService (token tracking)
              └── ReminderOrchestrator (cross-reminder coordination)
```

## Key Components

| File | Purpose |
|------|---------|
| `daemon.ts` | Main class: lifecycle, IPC server, service wiring |
| `task-engine.ts` | Priority task queue with configurable workers |
| `task-registry.ts` | Active task tracking, orphan prevention |
| `task-handlers.ts` | Standard task handler registration |
| `config-watcher.ts` | File watcher for config hot-reload |
| `state-descriptors.ts` | Daemon-specific state schemas |
| `context-metrics/` | Token usage aggregation and reporting |

## Daemon Responsibilities

1. **Single-writer pattern** — only Daemon writes to shared state files
2. **Background tasks** — heavy compute offloaded from CLI (LLM calls, analysis)
3. **IPC server** — Unix socket for CLI communication
4. **Heartbeat** — writes daemon-status.json every 5s for health monitoring
5. **Idle shutdown** — auto-terminates after configurable inactivity

## IPC Messages

| Message | Handler |
|---------|---------|
| `hook` | Dispatch hook event to registered handlers |
| `transcript-event` | Process transcript line (summary, reminders) |
| `reminder-consumed` | Notify orchestrator of consumption |
| `vc-unverified-set/clear` | Track unverified completion state |
| `classify-completion` | LLM classification of completion claims |
| `persona-test` | On-demand snarky/resume message generation |

## Constraints

- **58KB daemon.ts** — large but cohesive; wires all services together
- **State writes only here** — CLI reads state, never writes
- **Feature handlers registered** — imports from `@sidekick/feature-*` packages
- **Orchestrator lives here** — ReminderOrchestrator instantiated and wired

## Reference

- `docs/design/DAEMON.md` for architecture and IPC protocol
- `docs/design/TASK-ENGINE.md` for task scheduling semantics
