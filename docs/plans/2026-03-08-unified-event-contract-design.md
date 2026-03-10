# Unified Event Contract Design

> Design for sidekick-2d509e94: replaces the "event adapter mapping" approach with a unified event vocabulary.

## Problem

The codebase has two independent event vocabularies that evolved separately:

1. **28+ `LoggingEvent` types** in `@sidekick/types` (events.ts) — emitted by CLI and daemon for observability
2. **16 `SidekickEventType` values** in `packages/sidekick-ui/src/types.ts` — consumed by the UI for timeline display

These overlap conceptually but diverge in naming, structure, and coverage:

- 4 naming mismatches (PHASE2-AUDIT §2.5)
- UI expects start/finish pairs; daemon logs single completion events
- 10+ UI event types have no backend emitter at all
- Different payload schemas for the same concept (e.g., `ReminderStaged` vs `reminder-staged`)

The PHASE2-AUDIT recommended building an adapter layer (Option C). This design rejects that approach.

## Decision: No Adapter Layer

Instead of translating between two vocabularies, define **one canonical event vocabulary** in `@sidekick/types` and push requirements back to the CLI and daemon to emit events that the UI can consume directly.

Rationale:
- An adapter adds a translation layer that must be maintained as either side changes
- The mismatches represent real gaps in daemon observability, not a presentation problem
- The daemon already knows about these state transitions — it's just not announcing them

## Architecture

### Canonical Vocabulary

A single `SidekickEventType` union in `@sidekick/types` replaces both the current logging event types and the UI's local event types. Both the CLI/daemon (as writers) and the UI (as reader) import from the same source.

The current `LoggingEvent` types (`HookReceived`, `EventProcessed`, etc.) remain as-is for internal observability. The new canonical events are **in addition to** logging events — they represent user-visible state changes that the UI timeline needs.

### Event Visibility

Every canonical event carries a `visibility` field defined in the type contract:

| Value | Meaning | Example |
|-------|---------|---------|
| `'timeline'` | Main timeline — user-visible state changes | reminder staged, summary generated |
| `'log'` | Log viewer panel only (G-8) — internal machinery | daemon started, config watcher started |
| `'both'` | Both views | hook lifecycle, errors |

The visibility is part of the type definition, not UI filter logic.

### Start/Finish Pairs

The daemon emits real start/finish pairs for async operations. These are genuine state transitions the daemon already knows about:

| Operation | Start Event | Finish Event | Current Backend |
|-----------|------------|--------------|-----------------|
| Session summary | `session-summary:start` | `session-summary:finish` | Single `SummaryUpdated` |
| Snarky message | `snarky-message:start` | `snarky-message:finish` | No events |
| Resume message | `resume-message:start` | `resume-message:finish` | `ResumeGenerating` + `ResumeUpdated` (close, but different schema) |

### Phantom Event Validation

UI types with no backend emitter are validated against real state transitions:

| UI Event | Real Transition? | Resolution |
|----------|-----------------|------------|
| `reminder-unstaged` | Yes — reminder removed before consumption | Daemon emits |
| `decision` | Yes — decision recorded by hook handler | Daemon emits |
| `session-title-changed` | Yes — LLM summary produces new title | Daemon emits (currently buried in `SummaryUpdated`) |
| `intent-changed` | Yes — LLM classification changes intent | Daemon emits (currently buried in `SummaryUpdated`) |
| `persona-selected` | Yes — persona assigned on SessionStart | Daemon emits |
| `persona-changed` | Yes — persona changes mid-session | Daemon emits |

All validated as real state transitions. None are phantoms.

### Two-File Contract

- CLI writes canonical events to `cli.log`
- Daemon writes canonical events to `sidekickd.log`
- Both use identical NDJSON schema (same `SidekickEventType` discriminator)
- UI merges both files by timestamp (already does this per REQUIREMENTS.md F-2)
- No routing changes required

### Naming Resolution (PHASE2-AUDIT §2.5)

| # | Current Mismatch | Resolution | Canonical Name |
|---|-----------------|------------|----------------|
| 1 | UI: `session-summary-start/finish` vs Daemon: `SummaryUpdated` | Daemon emits start/finish pair | `session-summary:start`, `session-summary:finish` |
| 2 | UI: `persona-selected/changed` vs Daemon: nothing | Daemon emits new events | `persona:selected`, `persona:changed` |
| 3 | UI: `statusline-rendered` vs Daemon: nothing (CLI-only) | CLI already emits; already in shared log | `statusline:rendered` |
| 4 | UI: `reminder-staged` vs Daemon: `ReminderStaged` (different schema) | Align schema, use canonical name | `reminder:staged` |

## Deliverables

This design produces two outputs:

1. **IMPLEMENTATION-SPEC.md §2** — The canonical event table with every event type, its visibility, payload, emitter, and naming
2. **Requirements backlog** — New beads for CLI and daemon changes needed to emit the unified events

## Naming Convention

Adopt `category:action` format for canonical event names (e.g., `reminder:staged`, `session-summary:start`). This replaces the current kebab-case UI types (`reminder-staged`) and PascalCase logging types (`ReminderStaged`).

Categories: `reminder`, `session-summary`, `snarky-message`, `resume-message`, `persona`, `statusline`, `decision`, `daemon`, `hook`, `error`.

## What This Does NOT Change

- `HookEvent` types (from Claude Code) — unchanged, these are input events
- `TranscriptEvent` types (from file watching) — unchanged
- `LoggingEventBase` structure — internal logging events continue to exist for detailed observability
- Log file locations — `cli.log` and `sidekickd.log` stay where they are
- Pino log record format — the NDJSON structure is unchanged; canonical events are additional structured fields
