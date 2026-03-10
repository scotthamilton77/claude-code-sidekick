# API Layer Architecture Design

> Design for sidekick-4385facb: how the UI reads backend data from `.sidekick/` files.

## Problem

The Sidekick UI needs to read state files and logs from `.sidekick/` directories. The daemon is IPC-only (Unix socket, JSON-RPC 2.0) — there is no HTTP server. The UI needs a backend that reads files and serves JSON to the React frontend, with near-real-time updates when files change.

## Decisions

### D1: Backend Architecture — Vite Dev Proxy

The UI backend runs as a Vite middleware plugin during development. No standalone server.

**Rationale:**
- Single-user local tool — no production deployment scenario
- Archived `.archive/server/api-plugin.ts` already demonstrates this pattern (itty-router over Vite middleware)
- Fewer processes to manage; handlers are portable if a standalone server is needed later
- YAGNI — standalone server adds complexity with no current use case

### D2: File Read Strategy — `fs.watch` with Event-Driven Cache

The backend watches `.sidekick/` directories recursively using `fs.watch` and maintains an in-memory cache of file contents. File changes trigger cache invalidation and re-reads, which propagate to the frontend via SSE.

**Architecture layers:**

1. **FileWatcher** — Watches directories recursively via `fs.watch`. Emits typed events: `file:changed`, `file:created`, `file:deleted` with the affected path. Handles macOS FSEvents quirks (debouncing duplicate notifications). Watchers are **lazy** — they attach only when the user selects a session (see D4).

2. **FileCache** — Holds last-read content of state files in memory. Listens to FileWatcher events to invalidate and re-read. API handlers serve from cache for fast responses. Cache entries include file mtime for staleness detection.

3. **SSE EventBus** — Pushes file change notifications to the frontend over a Server-Sent Events connection. One SSE connection at a time, scoped to the active session. When the user switches sessions, the backend tears down old watchers and spins up new ones.

**Why `fs.watch` over polling:**
- Near-instant UI updates when state files change
- No wasted reads on unchanged files
- macOS FSEvents is reliable for directory-level watching with debouncing
- Polling would require tuning intervals per file type and wastes I/O

**Why SSE over WebSocket:**
- REQUIREMENTS.md §7 prohibits WebSocket
- SSE is one-directional (server→client), which matches file change notifications exactly
- SSE is plain HTTP — works through the Vite dev proxy with no additional infrastructure
- Auto-reconnection is built into the browser's `EventSource` API

### D3: Error Handling

| Scenario | Strategy |
|----------|----------|
| **Missing file** | Normal state (session just started). Return `data: null` in response envelope. Frontend shows placeholder. |
| **Locked/busy file** | Daemon uses atomic write-to-temp-then-rename, so true locks are rare. On `EACCES`/`EBUSY`: retry once after short delay, then serve stale cached data with `stale: true`. |
| **Corrupt JSON** | `JSON.parse` failure or Zod validation failure. Log the error, return `data: null` with error field in response. Don't crash the server. |
| **Log rotation mid-read** | Track byte offsets per log file. If file size < last offset, rotation detected — reset offset to zero, re-read from top. Include `rotationDetected` flag so frontend clears its buffer. |
| **Watcher errors** | `fs.watch` can emit errors (permissions, too many watchers, unmounted volumes). Log error, attempt to re-establish watch with exponential backoff. If re-establishment fails after retries, fall back to polling for that specific path. |

### D4: Scope Resolution — Navigation Funnel

The UI is not a flat "watch everything" tool. It follows a navigation funnel:

1. **Start** → Read `~/.sidekick/` to discover known projects (project registry — see `claude-code-sidekick-099`)
2. **Pick a project** → Read that project's `.sidekick/sessions/` to list sessions
3. **Pick a session** → Attach watchers + cache + SSE to that project's `.sidekick/` and the selected session's state directory

**Key properties:**
- Watchers are lazy — only attach when user selects a session
- `~/.sidekick/` provides global navigation data (project registry, user config/prefs)
- Project `.sidekick/` provides session discovery
- Session `.sidekick/sessions/{id}/` is the active workspace with full watcher coverage
- No `scope` tag needed on responses — the API routes naturally separate by concern

### D5: Project IDs — Dash-Encoded Path (Claude Code Convention)

Project identifiers use the same convention as Claude Code's `~/.claude/projects/` directory: the absolute project path with `/` replaced by `-`.

Example: `/Users/scott/src/projects/claude-code-sidekick` → `-Users-scott-src-projects-claude-code-sidekick`

**Rationale:**
- Deterministic, reversible, URL-safe
- No registry or hashing infrastructure needed
- Consistent with the existing Claude Code ecosystem

### D6: API Route Design — Three Tiers

Routes follow the navigation funnel: global → project → session.

#### Tier 1: Global (reads from `~/.sidekick/`)

| Route | Purpose |
|-------|---------|
| `GET /api/projects` | List known projects from registry |
| `GET /api/config` | User-level config/preferences (deferred — §3.8) |

#### Tier 2: Project (reads from `{projectPath}/.sidekick/`)

| Route | Purpose |
|-------|---------|
| `GET /api/projects/:projectId/sessions` | List sessions for a project |
| `GET /api/projects/:projectId/daemon/status` | Daemon health (30s offline threshold) |

#### Tier 3: Session (active workspace — watchers attach here)

| Route | Purpose |
|-------|---------|
| `GET /api/projects/:projectId/sessions/:sessionId/state` | All state files aggregated (`SessionStateSnapshot`) |
| `GET /api/projects/:projectId/sessions/:sessionId/state/:filename` | Individual state file (`StateFileResponse<T>`) |
| `GET /api/projects/:projectId/sessions/:sessionId/logs/:type` | Log stream with offset pagination |
| `GET /api/projects/:projectId/sessions/:sessionId/compaction-history` | Compaction timeline |
| `GET /api/projects/:projectId/sessions/:sessionId/pre-compact/:timestamp` | Pre-compaction snapshot |
| `GET /api/projects/:projectId/sessions/:sessionId/reminders/staged` | Staged reminders across all hooks |

#### SSE Endpoint

| Route | Purpose |
|-------|---------|
| `GET /api/events` | SSE stream — file change notifications for active session |

**SSE event format:**

```typescript
/** SSE event pushed to the frontend when a watched file changes. */
interface FileChangeEvent {
  /** Event type */
  type: 'file:changed' | 'file:created' | 'file:deleted'
  /** Relative path within the .sidekick/ directory */
  path: string
  /** Unix ms timestamp of the change */
  timestamp: number
}
```

The frontend receives these events and re-fetches the affected resource via the REST API. This keeps the SSE payload minimal (notification only, not data) and avoids duplicating the validation/transformation logic.

**`:projectId` encoding:** Dash-encoded absolute path per D5. The backend decodes by replacing leading `-` with `/` and internal `-` with `/` using the same algorithm Claude Code uses.

**Log endpoint pagination:** Uses byte offsets (not line numbers) for efficient incremental reads. See §3.4 `LogStreamRequest`/`LogStreamResponse` contracts.

## Dependencies

- `claude-code-sidekick-099`: Project registry feature in `~/.sidekick/` (P1, blocked by this spec)
- Sections 2-3 of IMPLEMENTATION-SPEC.md define the event and data contracts this API layer serves

## Non-Goals

- Standalone production server (Vite-only for now)
- Daemon modification (backend reads files directly)
- Multi-user access or authentication
- Write operations (UI is read-only)
