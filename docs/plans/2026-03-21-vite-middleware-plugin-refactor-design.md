# Vite Middleware Plugin Refactor

**Bead:** `claude-code-sidekick-qn3`
**Date:** 2026-03-21
**Status:** Design
**Parent Epic:** `sidekick-43a8b12e` (UI Implementation)

## Problem

The current `api-plugin.ts` is a monolithic 200-line middleware with regex-based route matching and copy-pasted validation/error-handling blocks. It was an intentional tracer-bullet shortcut (Decision D5) that served its purpose, but the route count (5) has crossed the threshold where the pattern becomes a maintenance liability. Adding new routes means touching the monolith and duplicating boilerplate.

## Goal

Refactor into a proper Vite plugin architecture using itty-router (already in deps, v5.0.22) with modular handlers and extracted shared utilities. Same 5 routes, same API contracts, better bones. Adding a new route should require only a handler function and one line of route registration.

## Constraints

- **D14:** Cannot import `@sidekick/core` during Vite config loading (transitive dep resolution failures)
- **API contracts preserved:** All response shapes remain identical
- **Data layer untouched:** `sessions-api.ts`, `timeline-api.ts`, `transcript-api.ts` are not modified
- **itty-router ^5.0.22:** Already in `package.json` dependencies

## Architecture

### File Structure

```
packages/sidekick-ui/server/
  api-plugin.ts            # Vite plugin: thin shell, adapter middleware
  router.ts                # Route registration, createRouter() export
  handlers/
    projects.ts            # GET /api/projects, GET /api/projects/:id/sessions
    timeline.ts            # GET /api/projects/:pid/sessions/:sid/timeline
    transcript.ts          # GET /api/projects/:pid/sessions/:sid/transcript
                           # GET /api/projects/:pid/sessions/:sid/subagents/:aid/transcript
  utils.ts                 # Validation, response helpers, Node<>Web adapters
  types.ts                 # ApiContext, ApiRequest

  sessions-api.ts          # UNCHANGED (data layer)
  timeline-api.ts          # UNCHANGED (data layer)
  transcript-api.ts        # UNCHANGED (data layer)
```

### Layer Responsibilities

| Layer | Responsibility | Knows About |
|-------|---------------|-------------|
| `api-plugin.ts` | Vite plugin lifecycle, Node<>Web adapter | Vite, router, utils |
| `router.ts` | Route table, itty-router config | itty-router, handlers |
| `handlers/*` | Request validation, data-layer calls, response shaping | utils, data-layer modules |
| `utils.ts` | Validation, response helpers, adapters | Node http, Web Request/Response, itty-router StatusError |
| `types.ts` | Shared type definitions | itty-router IRequest |
| Data layer | File I/O, parsing, domain logic | Node fs, os, path |

### Router Design

Uses itty-router v5 `Router` with pipeline stages:

```typescript
import { Router, withParams, StatusError } from 'itty-router'
import type { RouterType } from 'itty-router'

export function createRouter(ctx: ApiContext): RouterType<ApiRequest> {
  return Router<ApiRequest>({
    base: '/api',
    before: [withParams, injectContext(ctx)],
    catch: handleError,
    finally: [toJsonResponse],
  })
    .get('/projects', handleListProjects)
    .get('/projects/:projectId/sessions', handleListSessions)
    .get('/projects/:projectId/sessions/:sessionId/timeline', handleGetTimeline)
    .get('/projects/:projectId/sessions/:sessionId/transcript', handleGetTranscript)
    .get('/projects/:projectId/sessions/:sessionId/subagents/:agentId/transcript', handleGetSubagentTranscript)
}
```

**No catch-all route.** When no route matches, `router.fetch()` returns `undefined`. The plugin shell handles this via `response ? writeResponse(response, res) : next()`, preserving the current passthrough behavior for unknown `/api/` routes.

**Pipeline stages:**
- `before: [withParams, injectContext(ctx)]` — extracts route params as top-level request properties (e.g., `req.projectId`), attaches ApiContext as `req.ctx`
- `catch: handleError` — converts `StatusError` and `URIError` to appropriate status codes (400 for URIError, error's status for StatusError), unknown errors to 500
- `finally: [toJsonResponse]` — converts plain objects to JSON Response, passes through existing Response objects

### ApiContext

```typescript
export interface ApiContext {
  registryRoot: string  // ~/.sidekick/projects
}
```

Simpler than the archived version. The current data layer resolves paths internally from `registryRoot` — no need for `logsPath`/`sessionsPath`/`statePath`.

### ApiRequest

```typescript
export interface ApiRequest extends IRequest {
  ctx: ApiContext
  query: Record<string, string | undefined>
  [key: string]: any  // withParams spreads route params as top-level properties
}
```

**Parameter provenance:** Route params (`:projectId`, `:sessionId`, etc.) are spread as top-level request properties by `withParams` (e.g., `req.projectId`). URL search params are populated by `toRequest` and available via `req.query` (e.g., `req.query._t`).

### Error Handling

Uses itty-router's `StatusError` (not a custom error class) for typed HTTP errors:

```typescript
import { StatusError } from 'itty-router'
throw new StatusError(400, 'Invalid project ID format')
throw new StatusError(404, 'Project not found: foo')
```

The `handleError` catch stage maps error types:
- `StatusError` → uses error's `status` property
- `URIError` (from `decodeURIComponent`) → 400 "Malformed URL encoding"
- Unknown errors → 500

### Handler Pattern

Handlers receive the enriched request and return plain objects (auto-JSON'd by `finally` stage) or throw `StatusError`:

```typescript
// handlers/projects.ts
export async function handleListProjects(req: ApiRequest) {
  const projects = await listProjects(req.ctx.registryRoot)
  return { projects }
}

export async function handleListSessions(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  const sessions = await listSessions(project.projectDir, project.active)
  return { sessions }
}

// handlers/timeline.ts
export async function handleGetTimeline(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  await requireSession(project.projectDir, sessionId)  // fs.access check
  const events = await parseTimelineEvents(project.projectDir, sessionId)
  return { events }
}

// handlers/transcript.ts — NOTE: does NOT require project (graceful degradation)
export async function handleGetTranscript(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  // Optional project lookup — missing project means no Sidekick event interleaving
  const project = await getProjectById(req.ctx.registryRoot, projectId)
  const lines = await parseTranscriptLines(projectId, sessionId, project?.projectDir)
  return { lines }
}

// handlers/transcript.ts — subagent returns raw result (not wrapped)
export async function handleGetSubagentTranscript(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const agentId = validatePathParam(req.agentId, 'agent ID')
  const result = await parseSubagentTranscript(projectId, sessionId, agentId)
  if (!result) throw new StatusError(404, `Subagent not found: ${agentId}`)
  return result  // {lines, meta} — returned directly, not wrapped
}
```

**Shared helpers** used across handlers:
- `validatePathParam(value, label)` — decodes URI component, validates as safe path segment, throws StatusError(400) on failure
- `requireProject(registryRoot, projectId)` — looks up project, throws StatusError(404) if not found
- `requireSession(projectDir, sessionId)` — verifies session directory exists via `fs.access`, throws StatusError(404) if not found

**Important behavioral notes:**
- **Timeline handler** verifies session directory existence before calling the data layer (matching current behavior)
- **Transcript handler** uses optional project lookup (`getProjectById` + optional chaining), NOT `requireProject`. Missing project means `projectDir` is `undefined`, and the data layer gracefully degrades (no Sidekick event interleaving). This matches current behavior.
- **Subagent transcript handler** returns the raw `result` object directly (contains `{lines, meta}`), not wrapped in another object. The `toJsonResponse` finally stage serializes it as-is.

### Validation Utilities

Migrated from current `api-plugin.ts` to `utils.ts`:

| Function | Source | Purpose |
|----------|--------|---------|
| `isValidPathSegment(s)` | Current code | Rejects traversal, special chars |
| `validatePathParam(value, label)` | New (replaces repeated pattern) | Decode + validate + throw StatusError(400) |
| `requireProject(registryRoot, id)` | New (replaces repeated pattern) | Lookup + throw StatusError(404) |
| `requireSession(projectDir, sid)` | New (from current timeline logic) | `fs.access` check + throw StatusError(404) |
| `jsonResponse(data, status?)` | Archive | Create JSON web Response |
| `errorResponse(message, status?)` | Archive | Create error web Response |
| `toRequest(req, ctx)` | Archive (adapted) | Node IncomingMessage to ApiRequest |
| `writeResponse(response, res)` | Archive (adapted) | Web Response to Node ServerResponse |

### Node<>Web Adapters

Adapted from archived `api-plugin.ts`:

```typescript
export function toRequest(req: IncomingMessage, ctx: ApiContext): ApiRequest {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((value, key) => { query[key] = value })
  return { method: req.method ?? 'GET', url: url.href, params: {}, query, ctx } as ApiRequest
}

export async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => { res.setHeader(key, value) })
  res.end(await response.text())
}
```

### Vite Plugin (Thin Shell)

```typescript
export function sidekickApiPlugin(): Plugin {
  return {
    name: 'sidekick-api',
    configureServer(server: ViteDevServer) {
      const ctx: ApiContext = {
        registryRoot: join(homedir(), '.sidekick', 'projects'),
      }
      const router = createRouter(ctx)

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }

        // Return the promise so Vite's Connect middleware (and tests) can await it
        return router.fetch(toRequest(req, ctx))
          .then(response => {
            if (response) {
              return writeResponse(response, res)
            }
            next()
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Internal error: ${msg}` }))
          })
      })
    },
  }
}
```

### vite.config.ts Change

```typescript
// Before:
import { sessionsApiPlugin } from './server/api-plugin.js'
plugins: [react(), sessionsApiPlugin()]

// After:
import { sidekickApiPlugin } from './server/api-plugin.js'
plugins: [react(), sidekickApiPlugin()]
```

## Test Strategy

### Handler-Level Unit Tests

Each handler file gets a corresponding test file in `__tests__/handlers/`:

```
server/__tests__/
  handlers/
    projects.test.ts     # handleListProjects, handleListSessions
    timeline.test.ts     # handleGetTimeline
    transcript.test.ts   # handleGetTranscript, handleGetSubagentTranscript
  utils.test.ts          # isValidPathSegment, validatePathParam (migrated)
  api-plugin.test.ts     # Adapter integration tests (thin)
```

Handler tests mock only the data layer (sessions-api, timeline-api, transcript-api) and call handlers directly with constructed ApiRequest objects. No Vite server mocking needed.

### Adapter Integration Tests

`api-plugin.test.ts` retains a small set of tests verifying the Node<>Web adapter wiring: non-API URLs pass through, /api/ routes reach the router, URIError handling works.

### Migrated Tests

All existing test scenarios (path traversal, query string handling, transcript routes, passthrough) are preserved — they move to the appropriate handler or utils test file.

## What Changes

| File | Action |
|------|--------|
| `server/api-plugin.ts` | **Rewrite** — thin Vite plugin shell (~35 lines) |
| `server/router.ts` | **New** — route registration (~25 lines) |
| `server/handlers/projects.ts` | **New** — 2 handlers (~35 lines) |
| `server/handlers/timeline.ts` | **New** — 1 handler (~25 lines) |
| `server/handlers/transcript.ts` | **New** — 2 handlers (~40 lines) |
| `server/utils.ts` | **New** — validation, adapters, helpers (~80 lines) |
| `server/types.ts` | **New** — types (~25 lines) |
| `server/__tests__/api-plugin.test.ts` | **Rewrite** — thin adapter tests |
| `server/__tests__/handlers/projects.test.ts` | **New** — handler unit tests |
| `server/__tests__/handlers/timeline.test.ts` | **New** — handler unit tests |
| `server/__tests__/handlers/transcript.test.ts` | **New** — handler unit tests |
| `server/__tests__/utils.test.ts` | **New** — validation tests (migrated) |
| `vite.config.ts` | **Edit** — rename import |

## What Does NOT Change

- `server/sessions-api.ts` — data layer
- `server/timeline-api.ts` — data layer
- `server/transcript-api.ts` — data layer
- `server/__tests__/sessions-api.test.ts` — data layer tests
- `server/__tests__/timeline-api.test.ts` — data layer tests
- `server/__tests__/transcript-api.test.ts` — data layer tests
- All API response contracts (types and shapes)

## Acceptance Criteria

- All 5 existing API routes return identical responses
- `pnpm build` passes
- `pnpm typecheck` passes
- `pnpm lint` passes
- All existing test scenarios pass (migrated to new locations)
- Adding a new route requires: 1 handler function + 1 line in router.ts
