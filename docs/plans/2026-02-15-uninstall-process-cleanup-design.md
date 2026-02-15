# Uninstall Process Cleanup Design

**Bead:** sidekick-b6nz
**Date:** 2026-02-15

## Problem

When uninstalling sidekick, tracked daemon processes are not killed before cleanup:

1. **Project uninstall**: Kills the project daemon via SIGKILL but skips graceful shutdown.
2. **User uninstall**: Removes `~/.sidekick/daemons/` directory without killing the processes first, leaving orphaned daemons.

## Design

### Change 1: User-scope daemon killing

When `userDetected` is true, call `killAllDaemons(logger)` before removing `~/.sidekick/daemons/`. Each killed daemon gets an individual `UninstallAction`:

```typescript
{ scope: 'user', artifact: 'Daemon (PID 1234)', path: '/path/to/project', action: 'removed' }
```

### Change 2: Graceful-then-force strategy for project daemon

Replace direct `DaemonClient.kill()` with:

1. Try `DaemonClient.stopAndWait(3000)` (graceful IPC shutdown, 3s timeout)
2. If graceful fails, fall back to `DaemonClient.kill()` (SIGKILL)

### Change 3: Graceful-then-force for killAllDaemons

Add a `graceful` option to `killAllDaemons()`:

- When `graceful: true`, attempt IPC `stop()` per daemon before SIGKILL
- Short timeout (3s) per daemon since we iterate multiple
- Falls back to SIGKILL if graceful fails

### Uninstall sequence (updated)

```
Step 1:  Uninstall plugin
Step 2:  Kill project daemon (graceful -> SIGKILL)
Step 2b: Kill ALL daemons (graceful -> SIGKILL) if user-scope  <- NEW
Step 3:  Settings surgery
Step 4:  Config removal
Step 5:  .env handling
Step 6:  Transient data removal (PID files cleaned up here, after daemons killed)
Step 7:  Gitignore cleanup
Step 8:  Report
```

### Files to modify

1. `packages/sidekick-cli/src/commands/uninstall.ts` — add user-scope daemon killing, graceful strategy
2. `packages/sidekick-core/src/daemon-client.ts` — add graceful option to `killAllDaemons()`
3. Tests for both files
