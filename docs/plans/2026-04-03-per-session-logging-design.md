# Per-Session Logging Design

**Date:** 2026-04-03
**Status:** Approved
**Bead:** claude-code-sidekick-ht7

## Problem

The timeline API reads aggregate log files (`.sidekick/logs/sidekickd.log`, `sidekick.log`) and filters by `sessionId` in memory — an O(n) scan across all events from all sessions. As logs accumulate over weeks/months, this degrades timeline load performance. Manual log cleanup should not be necessary.

## Decision

**Approach C: Per-Session Primary + Ephemeral Aggregate**

Per-session log files become the source of truth. Aggregate logs are demoted to an ephemeral debug window with aggressive rotation. Timeline API reads per-session files directly — O(1) lookup by session.

### Why not the alternatives

- **Dual-write (symmetric):** Full duplication with identical retention is wasteful. The aggregate only needs to be a small rolling window for live debugging.
- **Per-session only (no aggregate):** Eliminates `tail -f` cross-session debugging without building aggregation tooling to replace it. Solves a problem we don't have.

## Architecture

### Write Path

Two destinations, different purposes:

#### Per-Session Logs (NEW — source of truth)

- **Path:** `.sidekick/sessions/{sessionId}/logs/sidekickd.log` and `sidekick.log`
- **Content:** All events for that session, NDJSON format (same as current format)
- **Rotation:** None — sessions are bounded in time, files stay small
- **Handle lifecycle:** Lazy-open on first event for a sessionId, close on session-end event or configurable idle timeout (30 min default)

#### Aggregate Logs (EXISTING — demoted to debug window)

- **Path:** `.sidekick/logs/sidekickd.log` (unchanged)
- **Rotation:** Aggressive — 2MB max file size, 2 rotated files (4MB total cap, down from current 50MB)
- **Purpose:** `tail -f` debugging only — data loss is expected and acceptable

### Daemon Changes

New `SessionLogWriter` class manages per-session file handles:

- Routes events by `context.sessionId` (already present on every event)
- Lightweight async append (`fs.appendFile` or SonicBoom), NOT a full Pino instance per session
- Max concurrent handles capped (10 default) with LRU eviction
- Creates session log directory on first write (`mkdir -p` equivalent)

### CLI Changes

Same pattern — CLI events written to per-session files. CLI already knows its `sessionId` at startup.

### Read Path

Timeline API (`packages/sidekick-ui/server/timeline-api.ts`):

1. **Primary:** Read from `.sidekick/sessions/{sessionId}/logs/`
2. Merge `sidekickd.log` + `sidekick.log` from the session directory (same merge logic as today, different path)
3. Filter by `TIMELINE_EVENT_TYPES` at read time (19 types — trivial cost on a single session's data)
4. **Fallback:** If per-session logs don't exist (pre-migration sessions), fall back to current aggregate scan

## Directory Structure

```
.sidekick/
├── logs/                              # Ephemeral aggregate (debug window)
│   ├── sidekickd.log                  # 2MB max, 2 files
│   └── sidekick.log
└── sessions/
    └── {sessionId}/
        ├── logs/                      # Per-session logs (source of truth)
        │   ├── sidekickd.log          # All daemon events for this session
        │   └── sidekick.log           # All CLI events for this session
        └── state/                     # Existing session state (unchanged)
            └── ...
```

## Cleanup & Retention

- **Session deletion = log deletion.** Deleting `.sidekick/sessions/{sessionId}/` removes all data for that session.
- **Aggregate is self-managing** via aggressive rotation.
- **Optional future retention policy:** Configurable max age for session directories (e.g., 30 days). Could be a `sidekick doctor` check or daemon background task. Not required for v1.
- **No manual log cleanup needed.**

## Migration

- **Zero migration required.** Per-session logs simply don't exist for old sessions.
- Timeline API falls back to aggregate scan when per-session logs are absent.
- New sessions get per-session logs automatically.
- Over time, as aggregate rotation purges old data, old sessions lose their timeline data naturally (acceptable).

## Error Handling

- If per-session log write fails (disk full, permissions), log a warning to aggregate and continue — do not crash the daemon.
- If per-session directory doesn't exist at write time, create it.
- File handle errors trigger handle eviction and lazy re-open on next event.

## Scope Exclusions

Intentionally NOT included:

- **Per-session rotation:** Sessions are time-bounded; not worth the complexity.
- **Background aggregation process:** Aggregate is still written directly via existing Pino logger.
- **Index files or databases:** NDJSON is sufficient at per-session scale.
- **Session retention policy:** Future work — not required for initial implementation.

## Key Files

| File | Role |
|------|------|
| `packages/sidekick-core/src/structured-logging.ts` | Log manager, BufferedRotatingStream |
| `packages/sidekick-core/src/log-events.ts` | Event factories, `logEvent()` function |
| `packages/sidekick-core/src/state/path-resolver.ts` | Session directory path resolution |
| `packages/sidekick-daemon/src/daemon.ts` | Daemon logger initialization |
| `packages/sidekick-cli/src/runtime.ts` | CLI logger initialization |
| `packages/sidekick-ui/server/timeline-api.ts` | Timeline event parsing and read path |
| `packages/sidekick-ui/server/handlers/timeline.ts` | Timeline API handler |
| `packages/types/src/logging-events.ts` | Event type definitions |
