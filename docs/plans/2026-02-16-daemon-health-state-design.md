# Daemon Health State Tracking

**Issue**: sidekick-kt0 — Daemon startup race condition causes token-not-found warnings
**Date**: 2026-02-16

## Problem

Hooks firing before the daemon fully starts trigger repeated "Daemon token not found - daemon may not be running" warnings. The system recovers via graceful degradation but logs are noisy — one warning per hook invocation per session.

### Root Cause

`ensureDaemonForHook()` in `hook-command.ts:463` returns a boolean indicating whether the daemon started, but the return value is **ignored**. Hooks always proceed to create `IpcService` and call `send()`, which reads the token file, fails with ENOENT, and logs a warning. This repeats on every hook invocation.

## Solution

A new **daemon health state file** (`.sidekick/state/daemon-health.json`) tracks daemon availability as runtime state, separate from setup configuration. The CLI writes on state transitions only, the daemon self-reports on startup, and the statusline reads it for degraded-mode display.

## Schema

```typescript
// @sidekick/types
DaemonHealthSchema = z.object({
  status: z.enum(['unknown', 'healthy', 'failed']),
  lastCheckedAt: z.string(),  // ISO timestamp
  error: z.string().optional(),
})
```

File location: `.sidekick/state/daemon-health.json`

## Components

### 1. CLI — ensureDaemonForHook() (hook-command.ts)

- Read current daemon-health.json (default: `unknown` on ENOENT)
- On daemon start success: if status !== `healthy`, write `healthy` (INFO log)
- On daemon start failure: if status !== `failed`, write `failed` + error (ERROR log)
- Return `daemonAvailable` boolean (currently discarded)

### 2. CLI — handleHookCommand() (hook.ts)

- New `daemonAvailable` field on `HandleHookOptions`
- When `false`, skip `IpcService` creation and `send()` entirely
- CLI-side consumption handlers still fire regardless

### 3. Daemon self-report (daemon.ts)

- After successful startup (line 332), write `healthy` to daemon-health.json
- Uses StateService (already available in daemon) for atomic writes
- Clears any previous `failed` state from prior runs

### 4. Statusline integration (feature-statusline)

- Read daemon-health.json during health check
- If setup is `healthy` but daemon is `failed` → distinct degraded statusline message
- Lower priority than setup issues (setup problems are more fundamental)

## Data Flow

```
SessionStart hook fires
  → ensureDaemonForHook()
    → DaemonClient.start()
      → success: write {status:'healthy'} if changed, return true
      → failure: write {status:'failed', error} if changed, return false
  → daemonAvailable passed to handleHookCommand()
    → true: IpcService.send() as normal
    → false: skip IPC, CLI handlers still run
```

## State Transitions

| From | To | Log Level | When |
|------|----|-----------|------|
| unknown | healthy | INFO | First successful daemon start |
| unknown | failed | ERROR | First failed daemon start |
| healthy | failed | ERROR | Daemon stops starting |
| failed | healthy | INFO | Daemon recovers |
| healthy | healthy | — | No log (steady state) |
| failed | failed | — | No log (no spam) |

## Error Handling

- State file read failure → treat as `unknown`, proceed normally
- State file write failure → log warning, don't block hook execution
- Missing `.sidekick/state/` directory → create on write (StateService handles this)

## Why Not setup-status.json?

`setup-status.json` tracks **configuration** state — "has the user set things up correctly?" Daemon health is a **runtime** concern — config can be perfect but the daemon still fails (resource issue, socket conflict). These are different failure domains and belong in different files. The `.sidekick/state/` directory is purpose-built for runtime state via StateService.

## Testing

- Unit tests for state transitions and log-once behavior
- Unit tests for `daemonAvailable=false` skipping IPC
- Existing hook-command tests updated for new options flow
- Statusline tests for daemon-failed degraded display
