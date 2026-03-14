# TB1: Session Selector with Real Data — Design

**Bead:** `claude-code-sidekick-6mx`
**Parent epic:** `sidekick-43a8b12e`
**Decision log:** `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` (D1-D7)

## Goal

First tracer bullet: wire the `SessionSelector` React component to real session data via a minimal Vite middleware API layer. Proves the end-to-end data pipeline from filesystem to UI.

## Architecture

```
~/.sidekick/projects/            .sidekick/sessions/*/
  (project registry)              (session dirs per project)
        |                              |
        +----------+    +-------------+
                   v    v
       Vite configureServer handler
        GET /api/projects
        GET /api/projects/:id/sessions
                   |
                   v
           useSessions() hook
        fetch -> { projects, loading, error }
                   |
                   v
        SessionSelector (existing, unchanged)
        App.tsx (swap mockProjects -> useSessions())
```

## API Routes

### `GET /api/projects`

**Source:** `~/.sidekick/projects/` registry directory. Each entry is a JSON file with project metadata.

**Per project:**
- Read registry entry for `projectDir`, heartbeat timestamp
- Run `git branch --show-current` in `projectDir` (see Decision D4)
- Derive `active` from heartbeat recency (5s threshold matches daemon)

**Response:**
```typescript
{
  projects: Array<{
    id: string           // registry filename (hash)
    name: string         // basename of projectDir
    projectDir: string   // absolute path
    branch: string       // current git branch
    active: boolean      // heartbeat within 5s
  }>
}
```

### `GET /api/projects/:id/sessions`

**Source:** `<projectDir>/.sidekick/sessions/` directory listing.

**Per session directory:**
- `id` from directory name
- Read `state/session-summary.json` if exists -> `title`, `intent`, `intentConfidence`
- Read `state/session-persona.json` if exists -> `persona`
- `date` from directory mtime (`fs.stat`)
- `status` derived from: project is active AND session has recent state file modification

**Response:**
```typescript
{
  sessions: Array<{
    id: string
    title: string        // from session-summary or fallback to truncated ID
    date: string         // ISO string from dir mtime
    status: 'active' | 'completed'
    persona?: string
    intent?: string
    intentConfidence?: number
  }>
}
```

## React Data Layer

### `useSessions()` hook

New file: `packages/sidekick-ui/src/hooks/useSessions.ts`

```typescript
interface UseSessionsResult {
  projects: Project[]
  loading: boolean
  error: string | null
}

function useSessions(): UseSessionsResult
```

- On mount: fetch `/api/projects`, then `/api/projects/${id}/sessions` for each project
- Maps API responses into existing `Project`/`Session` types
- `Session.transcriptLines` = `[]` (TB2)
- `Session.sidekickEvents` = `[]` (TB2)
- `Session.ledStates` = `new Map()` (TB3+)
- `Session.stateSnapshots` = `[]` (TB3+)
- `Session.branch` comes from the project-level API response

### `App.tsx` changes

- Remove `import { mockProjects }`
- Add `const { projects, loading, error } = useSessions()`
- Render loading spinner and error state
- Pass `projects` to `SessionSelector` unchanged

## Vite Middleware

### Location

New file: `packages/sidekick-ui/src/server/sessions-api.ts`

Wired in `vite.config.ts` via:
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    // ... existing config
  },
  configureServer(server) {
    // import and register route handler
  }
})
```

Note: `configureServer` is a Vite plugin hook, not a top-level config key. It must be inside a plugin object.

### Implementation approach

Minimal inline handler — no router framework. Pattern match on `req.url` for the two routes. Return JSON responses. This is a stub that will be refactored into a proper plugin when route count grows (see Decision D5, bead `claude-code-sidekick-qn3`).

### Error handling

- Missing session-summary.json: use truncated session ID as title fallback
- Missing project registry: return empty projects array
- Git branch failure: return `'unknown'` as branch
- Filesystem errors: 500 with error message in JSON response

## What Changes vs What Stays

| Component | Change? | Notes |
|-----------|---------|-------|
| `SessionSelector.tsx` | No change | Already renders `Project[]` correctly |
| `App.tsx` | Minimal | Swap data source, add loading/error |
| `useSessions.ts` | New (~40 lines) | Fetch + map to existing types |
| `vite.config.ts` | Minimal | Add plugin with configureServer hook |
| `sessions-api.ts` | New (~80 lines) | Two route handlers, readdir + readFile |
| `types.ts` | No change | Existing types work |
| `mock-data.ts` | Keep (not deleted) | Useful for tests, storybook |

## What This Proves

- Vite middleware can serve data from the sidekick filesystem
- React can fetch and render real session state
- Multi-project session enumeration works end-to-end
- The `Project`/`Session` type contract is viable for real data
- Foundation for TB2 (timeline events) to add routes and hooks

## What This Defers

- NDJSON log parsing -> TB2
- Real-time updates (SSE/polling) -> TB3 or Phase 3
- File watching / cache invalidation -> Phase 3
- `transcriptLines`, `sidekickEvents`, `ledStates` -> TB2
- Git branch caching -> `claude-code-sidekick-u28`
- Middleware plugin refactor -> `claude-code-sidekick-qn3`

## Testing Strategy

- **Server routes:** Unit tests with mock filesystem (memfs or vi.mock('fs'))
- **useSessions hook:** Test with msw (Mock Service Worker) or vi.mock fetch
- **Integration:** Manual verification — launch `pnpm sidekick ui`, see real sessions
- **Existing tests:** Must continue to pass (mock data preserved)
