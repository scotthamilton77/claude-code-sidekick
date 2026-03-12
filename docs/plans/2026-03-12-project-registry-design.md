# Project Registry for UI Discovery

**Bead:** claude-code-sidekick-099
**Date:** 2026-03-12
**Status:** Approved

## Purpose

Enable the Sidekick Monitoring UI to discover which projects have been "sidekicked" without requiring a `--project-dir` argument. The UI reads `~/.sidekick/projects/` on startup to build a project selector.

## Registry Structure

```
~/.sidekick/projects/
├── -Users-scott-src-projects-claude-code-sidekick/
│   └── registry.json
├── -Users-scott-src-projects-newsletter-digest/
│   └── registry.json
```

**Path encoding:** Replace `/` with `-` (mirrors Claude Code's `~/.claude/projects/` convention). Leading slash becomes leading dash.

**`registry.json` schema:**

```json
{
  "path": "/Users/scott/src/projects/claude-code-sidekick",
  "displayName": "claude-code-sidekick",
  "lastActive": "2026-03-12T15:30:00.000Z"
}
```

## Lifecycle

| Event | Action |
|-------|--------|
| **Daemon starts** | Create/update `registry.json` with current timestamp |
| **Daemon heartbeat** (hourly) | Update `lastActive` timestamp |
| **UI startup** | Read all entries, prune stale ones |

## Pruning Rules (UI startup)

1. **Path missing** — project directory no longer exists → delete registry entry (rm dir)
2. **Age exceeded** — `lastActive` older than retention threshold → delete registry entry (rm dir)
3. **Retention default:** 30 days, configurable via `projects.retentionDays` in sidekick config

## Components Affected

- **`@sidekick/core`** — new `ProjectRegistryService` (encode/decode paths, read/write `registry.json`)
- **Daemon** — call registry service on startup + hourly interval
- **UI backend** — read registry on `/api/projects`, apply pruning

## Encoding/Decoding

```typescript
// encode: /Users/scott/src → -Users-scott-src
function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, '-');
}

// decode: -Users-scott-src → /Users/scott/src
function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}
```

## Design Decisions

1. **Daemon startup registration (not CLI bootstrap)** — the project isn't truly "using" sidekick until the daemon starts its work
2. **Directory-per-project (not single JSON file)** — mirrors Claude Code's `~/.claude/projects/` convention, human-readable, no encoding library needed
3. **Auto-prune on UI startup (not validate-only)** — keeps the registry clean, configurable retention window
4. **Hourly heartbeat** — daemon updates `lastActive` periodically so the UI has a reliable freshness signal

## Not In Scope

- UI components (separate implementation epic `sidekick-43a8b12e`)
- WebSocket/SSE for live project list updates
- Project "favorites" or manual ordering
