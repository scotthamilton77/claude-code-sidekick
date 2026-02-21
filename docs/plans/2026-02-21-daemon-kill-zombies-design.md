# Daemon Kill-Zombies & Doctor Zombie Detection

**Date:** 2026-02-21
**Bead:** sidekick-ct2k
**Status:** Approved

## Problem

Daemon processes can become orphaned ("zombies") when sessions crash or shut down uncleanly. These processes are NOT tracked in the `~/.sidekick/daemons/` PID registry, so `daemon kill-all` (which only operates on registered PIDs) cannot clean them up.

## Solution

Add zombie detection and cleanup via two entry points:

1. `sidekick daemon kill-zombies` — new CLI subcommand
2. `sidekick doctor --only=zombies` — new doctor check (with `--fix` support)

## Design

### Process Detection

Zombie identification uses `ps -eo pid,args` filtered for lines containing both `sidekick` and `daemon`. This matches both daemon path variants:

| Mode | Process command line |
|------|---------------------|
| Production | `node .../sidekick/dist/daemon.js /project/path` |
| Dev | `node .../sidekick-daemon/dist/index.js /project/path` |

Registered PIDs are read from `~/.sidekick/daemons/*.pid` files. Any OS process matching the daemon pattern whose PID is NOT in the registry is classified as a zombie.

### Core Functions (daemon-client.ts)

```typescript
interface ZombieProcess {
  pid: number
  command: string  // full command line from ps
}

async function findZombieDaemons(logger: Logger): Promise<ZombieProcess[]>
// 1. exec('ps -eo pid,args') and filter for sidekick daemon lines
// 2. Read all *.pid files from ~/.sidekick/daemons/ to get registered PID set
// 3. Return processes whose PID is not in the registry

async function killZombieDaemons(logger: Logger): Promise<KillResult[]>
// 1. Call findZombieDaemons()
// 2. SIGKILL each zombie (no graceful shutdown — these are untracked)
// 3. Return KillResult[] with projectDir='unknown'
```

### CLI Subcommand (daemon.ts)

Add `kill-zombies` case to the existing daemon subcommand switch. Calls `killZombieDaemons()` and prints results.

### Doctor Check (setup/index.ts)

Add `'zombies'` to `DOCTOR_CHECK_NAMES`. The check calls `findZombieDaemons()` and reports count. In `--fix` mode, calls `killZombieDaemons()`.

### Files Changed

| File | Change |
|------|--------|
| `packages/sidekick-core/src/daemon-client.ts` | Add `findZombieDaemons()`, `killZombieDaemons()`, exports |
| `packages/sidekick-cli/src/commands/daemon.ts` | Add `kill-zombies` subcommand |
| `packages/sidekick-cli/src/commands/setup/index.ts` | Add `zombies` doctor check + fix |
| `packages/sidekick-core/src/__tests__/daemon-client.test.ts` | Unit tests for zombie detection/killing |

### Platform Support

*nix only (Linux, macOS). No Windows support.
