# Vite Middleware Plugin Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic `api-plugin.ts` into a proper Vite plugin architecture using itty-router v5, modular handlers, and extracted shared utilities — same 5 routes, same API contracts, better bones.

**Architecture:** itty-router v5 `Router` with `before`/`catch`/`finally` pipeline stages. Thin Vite plugin shell adapts between Node `IncomingMessage/ServerResponse` and Web `Request/Response`. Route handlers are domain-grouped files that call the existing data layer and return plain objects (auto-JSON'd by the pipeline).

**Tech Stack:** TypeScript, itty-router ^5.0.22, Vite 6.x, Vitest 4.x

**Spec:** `docs/plans/2026-03-21-vite-middleware-plugin-refactor-design.md`

**Bead:** `claude-code-sidekick-qn3`

**Branch policy:** All work on a feature branch (e.g., `refactor/vite-middleware-plugin`), merged via PR.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/types.ts` | **Create** | `ApiContext`, `ApiRequest` types |
| `server/utils.ts` | **Create** | Validation (`isValidPathSegment`, `validatePathParam`), domain helpers (`requireProject`, `requireSession`), adapters (`toRequest`, `writeResponse`), response pipeline (`toJsonResponse`, `handleError`) |
| `server/handlers/projects.ts` | **Create** | `handleListProjects`, `handleListSessions` |
| `server/handlers/timeline.ts` | **Create** | `handleGetTimeline` |
| `server/handlers/transcript.ts` | **Create** | `handleGetTranscript`, `handleGetSubagentTranscript` |
| `server/router.ts` | **Create** | `createRouter()` — route table with itty-router |
| `server/api-plugin.ts` | **Rewrite** | Thin Vite plugin shell: `sidekickApiPlugin()` |
| `vite.config.ts` | **Edit** | Rename import to `sidekickApiPlugin` |
| `server/__tests__/utils.test.ts` | **Create** | Tests for validation, adapters, helpers |
| `server/__tests__/handlers/projects.test.ts` | **Create** | Handler unit tests |
| `server/__tests__/handlers/timeline.test.ts` | **Create** | Handler unit tests |
| `server/__tests__/handlers/transcript.test.ts` | **Create** | Handler unit tests |
| `server/__tests__/api-plugin.test.ts` | **Rewrite** | Thin adapter integration tests |

**Unchanged:** `server/sessions-api.ts`, `server/timeline-api.ts`, `server/transcript-api.ts`, and their test files.

---

## Task 1: Create types.ts

**Files:**
- Create: `packages/sidekick-ui/server/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/sidekick-ui/server/types.ts
import type { IRequest } from 'itty-router'

/** Context injected into every API request via the router `before` stage. */
export interface ApiContext {
  /** Sidekick project registry root (e.g., ~/.sidekick/projects) */
  registryRoot: string
}

/**
 * Extended request type for itty-router handlers.
 *
 * Route params (`:projectId`, `:sessionId`, etc.) are spread as top-level
 * properties by `withParams` (e.g., `req.projectId`).
 *
 * URL search params are populated by `toRequest` and available via `req.query`.
 */
export interface ApiRequest extends IRequest {
  ctx: ApiContext
  query: Record<string, string | undefined>
  [key: string]: any
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd packages/sidekick-ui && npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/sidekick-ui/server/types.ts
git commit -m "refactor(ui): add ApiContext and ApiRequest types for middleware plugin"
```

---

## Task 2: Create utils.ts — validation and adapters

**Files:**
- Create: `packages/sidekick-ui/server/utils.ts`
- Create: `packages/sidekick-ui/server/__tests__/utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Migrate existing `isValidPathSegment` tests from `api-plugin.test.ts` and add new tests for `validatePathParam`, `requireProject`, `requireSession`, `toRequest`, `writeResponse`, `toJsonResponse`, `handleError`.

```typescript
// packages/sidekick-ui/server/__tests__/utils.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'

// Mock sessions-api for requireProject
const mockGetProjectById = vi.fn()
vi.mock('../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

// Mock node:fs/promises for requireSession
const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import {
  isValidPathSegment,
  validatePathParam,
  requireProject,
  requireSession,
  toRequest,
  writeResponse,
  toJsonResponse,
  handleError,
} from '../utils.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockAccess.mockClear()
})

describe('isValidPathSegment', () => {
  it('rejects empty string', () => {
    expect(isValidPathSegment('')).toBe(false)
  })

  it('rejects "."', () => {
    expect(isValidPathSegment('.')).toBe(false)
  })

  it('rejects ".."', () => {
    expect(isValidPathSegment('..')).toBe(false)
  })

  it('rejects strings with "/"', () => {
    expect(isValidPathSegment('../etc')).toBe(false)
    expect(isValidPathSegment('foo/bar')).toBe(false)
  })

  it('rejects strings with "\\"', () => {
    expect(isValidPathSegment('foo\\bar')).toBe(false)
  })

  it('accepts alphanumeric with dots, hyphens, underscores', () => {
    expect(isValidPathSegment('-Users-scott-myproject')).toBe(true)
    expect(isValidPathSegment('my.project_v2')).toBe(true)
    expect(isValidPathSegment('abc-123')).toBe(true)
  })
})

describe('validatePathParam', () => {
  it('returns decoded value for valid segment', () => {
    expect(validatePathParam('-Users-foo', 'project ID')).toBe('-Users-foo')
  })

  it('decodes URI-encoded values', () => {
    // %2D is a hyphen — decodes to 'hello-world' which passes isValidPathSegment
    expect(validatePathParam('hello%2Dworld', 'label')).toBe('hello-world')
  })

  it('throws StatusError(400) for invalid segment', () => {
    expect(() => validatePathParam('../etc', 'project ID')).toThrow(StatusError)
    try {
      validatePathParam('../etc', 'project ID')
    } catch (err) {
      expect((err as StatusError).status).toBe(400)
    }
  })

  it('throws StatusError(400) for empty string', () => {
    expect(() => validatePathParam('', 'test')).toThrow(StatusError)
  })
})

describe('requireProject', () => {
  it('returns project when found', async () => {
    const project = { id: 'p1', projectDir: '/foo', active: true }
    mockGetProjectById.mockResolvedValue(project)
    const result = await requireProject('/registry', 'p1')
    expect(result).toBe(project)
    expect(mockGetProjectById).toHaveBeenCalledWith('/registry', 'p1')
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)
    await expect(requireProject('/registry', 'missing')).rejects.toThrow(StatusError)
    try {
      await requireProject('/registry', 'missing')
    } catch (err) {
      expect((err as StatusError).status).toBe(404)
    }
  })
})

describe('requireSession', () => {
  it('succeeds when session directory exists', async () => {
    mockAccess.mockResolvedValue(undefined)
    await expect(requireSession('/project', 'sid-1')).resolves.toBeUndefined()
    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining('sid-1')
    )
  })

  it('throws StatusError(404) when session directory missing', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    await expect(requireSession('/project', 'missing')).rejects.toThrow(StatusError)
    try {
      await requireSession('/project', 'missing')
    } catch (err) {
      expect((err as StatusError).status).toBe(404)
    }
  })
})

describe('toRequest', () => {
  it('converts Node IncomingMessage to ApiRequest shape', () => {
    const nodeReq = {
      method: 'GET',
      url: '/api/projects?_t=123',
      headers: { host: 'localhost:5173' },
    }
    const ctx = { registryRoot: '/reg' }
    const result = toRequest(nodeReq as any, ctx)
    expect(result.method).toBe('GET')
    expect(result.url).toContain('/api/projects')
    expect(result.query._t).toBe('123')
    expect(result.ctx).toBe(ctx)
  })

  it('defaults to GET when method is undefined', () => {
    const nodeReq = { url: '/api/projects', headers: {} }
    const result = toRequest(nodeReq as any, { registryRoot: '/r' })
    expect(result.method).toBe('GET')
  })
})

describe('writeResponse', () => {
  it('writes status, headers, and body to Node ServerResponse', async () => {
    const webResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    }
    await writeResponse(webResponse, res as any)
    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json')
    expect(res.end).toHaveBeenCalledWith('{"ok":true}')
  })
})

describe('toJsonResponse', () => {
  it('converts a plain object to a JSON Response', () => {
    const result = toJsonResponse({ projects: [] })
    expect(result).toBeInstanceOf(Response)
  })

  it('passes through an existing Response', () => {
    const existing = new Response('already')
    const result = toJsonResponse(existing)
    expect(result).toBe(existing)
  })

  it('returns undefined if input is undefined (no route matched)', () => {
    const result = toJsonResponse(undefined)
    expect(result).toBeUndefined()
  })
})

describe('handleError', () => {
  it('converts StatusError to JSON response with correct status', () => {
    const result = handleError(new StatusError(404, 'Not found'))
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(404)
  })

  it('converts URIError to 400 response', () => {
    const result = handleError(new URIError('malformed'))
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(400)
  })

  it('converts unknown errors to 500 response', () => {
    const result = handleError(new Error('boom'))
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/utils.test.ts`
Expected: FAIL — `utils.js` does not exist yet

- [ ] **Step 3: Create utils.ts with all implementations**

```typescript
// packages/sidekick-ui/server/utils.ts
import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { StatusError } from 'itty-router'
import { getProjectById } from './sessions-api.js'
import type { ApiProject } from './sessions-api.js'
import type { ApiContext, ApiRequest } from './types.js'

/**
 * Validate that a string is a safe single path segment (no traversal).
 *
 * Rejects empty strings, `.`, `..`, strings containing path separators,
 * and strings where basename differs from the input. Only allows
 * alphanumeric characters, dots, hyphens, and underscores.
 */
export function isValidPathSegment(s: string): boolean {
  if (s === '') return false
  if (s === '.' || s === '..') return false
  if (s.includes('/') || s.includes('\\')) return false
  if (basename(s) !== s) return false
  return /^[a-zA-Z0-9._-]+$/.test(s)
}

/**
 * Decode a URI component and validate it as a safe path segment.
 * Throws StatusError(400) if invalid.
 * Throws URIError for malformed percent-encoding (caught by handleError as 400).
 */
export function validatePathParam(encoded: string, label: string): string {
  const decoded = decodeURIComponent(encoded)
  if (!isValidPathSegment(decoded)) {
    throw new StatusError(400, `Invalid ${label} format`)
  }
  return decoded
}

/**
 * Look up a project by ID. Throws StatusError(404) if not found.
 */
export async function requireProject(registryRoot: string, projectId: string): Promise<ApiProject> {
  const project = await getProjectById(registryRoot, projectId)
  if (!project) {
    throw new StatusError(404, `Project not found: ${projectId}`)
  }
  return project
}

/**
 * Verify that a session directory exists. Throws StatusError(404) if not found.
 */
export async function requireSession(projectDir: string, sessionId: string): Promise<void> {
  const sessionDir = join(projectDir, '.sidekick', 'sessions', sessionId)
  try {
    await access(sessionDir)
  } catch {
    throw new StatusError(404, `Session not found: ${sessionId}`)
  }
}

/**
 * Convert a Node IncomingMessage to an ApiRequest for itty-router.
 */
export function toRequest(req: IncomingMessage, ctx: ApiContext): ApiRequest {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((value, key) => { query[key] = value })
  return { method: req.method ?? 'GET', url: url.href, params: {}, query, ctx } as ApiRequest
}

/**
 * Write a Web Response to a Node ServerResponse.
 */
export async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => { res.setHeader(key, value) })
  res.end(await response.text())
}

/**
 * Router `finally` stage: converts plain objects to JSON Response.
 * Passes through existing Response objects unchanged.
 * Returns undefined as-is (no route matched).
 */
export function toJsonResponse(data: unknown): Response | undefined {
  if (data === undefined) return undefined
  if (data instanceof Response) return data
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Router `catch` stage: converts errors to JSON error Response.
 * - StatusError → uses error's status property
 * - URIError → 400 "Malformed URL encoding"
 * - Unknown → 500
 */
export function handleError(err: unknown): Response {
  if (err instanceof URIError) {
    return new Response(JSON.stringify({ error: 'Malformed URL encoding' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const status = err instanceof StatusError ? err.status : 500
  const message = err instanceof Error ? err.message : String(err)
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/utils.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Verify typecheck**

Run: `cd packages/sidekick-ui && npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-ui/server/utils.ts packages/sidekick-ui/server/__tests__/utils.test.ts
git commit -m "refactor(ui): extract validation, adapters, and response helpers into utils.ts"
```

---

## Task 3: Create handler files

**Files:**
- Create: `packages/sidekick-ui/server/handlers/projects.ts`
- Create: `packages/sidekick-ui/server/handlers/timeline.ts`
- Create: `packages/sidekick-ui/server/handlers/transcript.ts`
- Create: `packages/sidekick-ui/server/__tests__/handlers/projects.test.ts`
- Create: `packages/sidekick-ui/server/__tests__/handlers/timeline.test.ts`
- Create: `packages/sidekick-ui/server/__tests__/handlers/transcript.test.ts`

### Task 3a: Projects handler

- [ ] **Step 1: Write failing tests for projects handler**

```typescript
// packages/sidekick-ui/server/__tests__/handlers/projects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

// Mock data layer
const mockListProjects = vi.fn()
const mockGetProjectById = vi.fn()
const mockListSessions = vi.fn()

vi.mock('../../sessions-api.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}))

// Mock utils (requireProject calls getProjectById internally, but we import
// the real utils which will use the mocked sessions-api above)
import { handleListProjects, handleListSessions } from '../../handlers/projects.js'

const mockCtx = { registryRoot: '/test/.sidekick/projects' }

function fakeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: 'http://localhost/api/projects',
    params: {},
    query: {},
    ctx: mockCtx,
    ...overrides,
  } as ApiRequest
}

beforeEach(() => {
  mockListProjects.mockClear()
  mockGetProjectById.mockClear()
  mockListSessions.mockClear()
})

describe('handleListProjects', () => {
  it('returns all projects', async () => {
    const projects = [{ id: 'p1', name: 'proj', projectDir: '/p', branch: 'main', active: false }]
    mockListProjects.mockResolvedValue(projects)
    const result = await handleListProjects(fakeRequest())
    expect(result).toEqual({ projects })
    expect(mockListProjects).toHaveBeenCalledWith(mockCtx.registryRoot)
  })
})

describe('handleListSessions', () => {
  it('returns sessions for a valid project', async () => {
    const project = { id: '-Users-foo', name: 'foo', projectDir: '/Users/foo', branch: 'main', active: true }
    mockGetProjectById.mockResolvedValue(project)
    mockListSessions.mockResolvedValue([{ id: 's1', title: 'Test' }])
    const req = fakeRequest({ projectId: '-Users-foo' })
    const result = await handleListSessions(req)
    expect(result).toEqual({ sessions: [{ id: 's1', title: 'Test' }] })
    expect(mockListSessions).toHaveBeenCalledWith('/Users/foo', true)
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)
    const req = fakeRequest({ projectId: 'missing' })
    await expect(handleListSessions(req)).rejects.toThrow(StatusError)
  })

  it('throws StatusError(400) for invalid projectId format', async () => {
    const req = fakeRequest({ projectId: '../etc' })
    await expect(handleListSessions(req)).rejects.toThrow(StatusError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/projects.test.ts`
Expected: FAIL — handler file doesn't exist

- [ ] **Step 3: Create projects handler**

```typescript
// packages/sidekick-ui/server/handlers/projects.ts
import { listProjects, listSessions } from '../sessions-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject } from '../utils.js'

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/projects.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/handlers/projects.ts packages/sidekick-ui/server/__tests__/handlers/projects.test.ts
git commit -m "refactor(ui): extract projects handler with tests"
```

### Task 3b: Timeline handler

- [ ] **Step 1: Write failing tests for timeline handler**

```typescript
// packages/sidekick-ui/server/__tests__/handlers/timeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

const mockParseTimelineEvents = vi.fn()
vi.mock('../../timeline-api.js', () => ({
  parseTimelineEvents: (...args: unknown[]) => mockParseTimelineEvents(...args),
}))

const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { handleGetTimeline } from '../../handlers/timeline.js'

const mockCtx = { registryRoot: '/test/.sidekick/projects' }

function fakeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: 'http://localhost/api/projects/p1/sessions/s1/timeline',
    params: {},
    query: {},
    ctx: mockCtx,
    ...overrides,
  } as ApiRequest
}

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseTimelineEvents.mockClear()
  mockAccess.mockClear()
})

describe('handleGetTimeline', () => {
  it('returns timeline events for valid project and session', async () => {
    const project = { id: 'p1', projectDir: '/proj', active: true }
    mockGetProjectById.mockResolvedValue(project)
    mockAccess.mockResolvedValue(undefined)
    mockParseTimelineEvents.mockResolvedValue([{ id: 'e1', type: 'tool-use' }])

    const req = fakeRequest({ projectId: 'p1', sessionId: 's1' })
    const result = await handleGetTimeline(req)
    expect(result).toEqual({ events: [{ id: 'e1', type: 'tool-use' }] })
    expect(mockAccess).toHaveBeenCalledWith(expect.stringContaining('s1'))
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)
    const req = fakeRequest({ projectId: 'missing', sessionId: 's1' })
    await expect(handleGetTimeline(req)).rejects.toThrow(StatusError)
  })

  it('throws StatusError(404) when session directory missing', async () => {
    mockGetProjectById.mockResolvedValue({ id: 'p1', projectDir: '/proj', active: true })
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    const req = fakeRequest({ projectId: 'p1', sessionId: 'missing' })
    await expect(handleGetTimeline(req)).rejects.toThrow(StatusError)
  })

  it('throws StatusError(400) for invalid sessionId format', async () => {
    mockGetProjectById.mockResolvedValue({ id: 'p1', projectDir: '/proj', active: true })
    const req = fakeRequest({ projectId: 'p1', sessionId: '../etc' })
    await expect(handleGetTimeline(req)).rejects.toThrow(StatusError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/timeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Create timeline handler**

```typescript
// packages/sidekick-ui/server/handlers/timeline.ts
import { parseTimelineEvents } from '../timeline-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject, requireSession } from '../utils.js'

export async function handleGetTimeline(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  await requireSession(project.projectDir, sessionId)
  const events = await parseTimelineEvents(project.projectDir, sessionId)
  return { events }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/timeline.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/handlers/timeline.ts packages/sidekick-ui/server/__tests__/handlers/timeline.test.ts
git commit -m "refactor(ui): extract timeline handler with tests"
```

### Task 3c: Transcript handler

- [ ] **Step 1: Write failing tests for transcript handler**

```typescript
// packages/sidekick-ui/server/__tests__/handlers/transcript.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

const mockParseTranscriptLines = vi.fn()
const mockParseSubagentTranscript = vi.fn()
vi.mock('../../transcript-api.js', () => ({
  parseTranscriptLines: (...args: unknown[]) => mockParseTranscriptLines(...args),
  parseSubagentTranscript: (...args: unknown[]) => mockParseSubagentTranscript(...args),
}))

import { handleGetTranscript, handleGetSubagentTranscript } from '../../handlers/transcript.js'

const mockCtx = { registryRoot: '/test/.sidekick/projects' }

function fakeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: 'http://localhost/api/test',
    params: {},
    query: {},
    ctx: mockCtx,
    ...overrides,
  } as ApiRequest
}

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseTranscriptLines.mockClear()
  mockParseSubagentTranscript.mockClear()
})

describe('handleGetTranscript', () => {
  it('returns transcript lines with project dir for Sidekick interleaving', async () => {
    const mockLines = [{ id: '1', type: 'user-message', timestamp: 1000, content: 'hello' }]
    mockGetProjectById.mockResolvedValue({ id: '-Users-foo', projectDir: '/Users/foo', active: true })
    mockParseTranscriptLines.mockResolvedValue(mockLines)
    const req = fakeRequest({ projectId: '-Users-foo', sessionId: 'uuid-1' })
    const result = await handleGetTranscript(req)
    expect(result).toEqual({ lines: mockLines })
    expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
  })

  it('passes undefined projectDir when project not found (graceful degradation)', async () => {
    mockGetProjectById.mockResolvedValue(null)
    mockParseTranscriptLines.mockResolvedValue([])
    const req = fakeRequest({ projectId: '-Users-foo', sessionId: 'uuid-1' })
    const result = await handleGetTranscript(req)
    expect(result).toEqual({ lines: [] })
    expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', undefined)
  })

  it('throws StatusError(400) for invalid projectId format', async () => {
    const req = fakeRequest({ projectId: '../etc', sessionId: 'uuid-1' })
    await expect(handleGetTranscript(req)).rejects.toThrow(StatusError)
  })

  it('throws StatusError(400) for invalid sessionId format', async () => {
    const req = fakeRequest({ projectId: '-Users-foo', sessionId: '..%2Fetc' })
    await expect(handleGetTranscript(req)).rejects.toThrow(StatusError)
  })
})

describe('handleGetSubagentTranscript', () => {
  it('returns raw result (not wrapped) for valid subagent', async () => {
    const result = { lines: [{ id: '1' }], meta: { model: 'opus' } }
    mockParseSubagentTranscript.mockResolvedValue(result)
    const req = fakeRequest({ projectId: 'p1', sessionId: 's1', agentId: 'a1' })
    const handlerResult = await handleGetSubagentTranscript(req)
    // Result is returned directly, not wrapped in { lines: ... }
    expect(handlerResult).toBe(result)
  })

  it('throws StatusError(404) when subagent not found', async () => {
    mockParseSubagentTranscript.mockResolvedValue(null)
    const req = fakeRequest({ projectId: 'p1', sessionId: 's1', agentId: 'missing' })
    await expect(handleGetSubagentTranscript(req)).rejects.toThrow(StatusError)
    try {
      await handleGetSubagentTranscript(req)
    } catch (err) {
      expect((err as StatusError).status).toBe(404)
    }
  })

  it('throws StatusError(400) for invalid agentId format', async () => {
    const req = fakeRequest({ projectId: 'p1', sessionId: 's1', agentId: '../etc' })
    await expect(handleGetSubagentTranscript(req)).rejects.toThrow(StatusError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/transcript.test.ts`
Expected: FAIL

- [ ] **Step 3: Create transcript handler**

```typescript
// packages/sidekick-ui/server/handlers/transcript.ts
import { getProjectById } from '../sessions-api.js'
import { parseTranscriptLines, parseSubagentTranscript } from '../transcript-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam } from '../utils.js'
import { StatusError } from 'itty-router'

/**
 * GET /api/projects/:projectId/sessions/:sessionId/transcript
 *
 * NOTE: Uses optional project lookup (not requireProject).
 * Missing project means projectDir is undefined — the data layer
 * gracefully degrades (no Sidekick event interleaving).
 */
export async function handleGetTranscript(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await getProjectById(req.ctx.registryRoot, projectId)
  const lines = await parseTranscriptLines(projectId, sessionId, project?.projectDir)
  return { lines }
}

/**
 * GET /api/projects/:projectId/sessions/:sessionId/subagents/:agentId/transcript
 *
 * Returns the raw result ({lines, meta}) directly — not wrapped.
 */
export async function handleGetSubagentTranscript(req: ApiRequest) {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const agentId = validatePathParam(req.agentId, 'agent ID')
  const result = await parseSubagentTranscript(projectId, sessionId, agentId)
  if (!result) throw new StatusError(404, `Subagent not found: ${agentId}`)
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/handlers/transcript.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/handlers/transcript.ts packages/sidekick-ui/server/__tests__/handlers/transcript.test.ts
git commit -m "refactor(ui): extract transcript handler with tests"
```

---

## Task 4: Create router.ts

**Files:**
- Create: `packages/sidekick-ui/server/router.ts`

- [ ] **Step 1: Create the router module**

```typescript
// packages/sidekick-ui/server/router.ts
import { Router, withParams } from 'itty-router'
import type { RouterType } from 'itty-router'
import { handleListProjects, handleListSessions } from './handlers/projects.js'
import { handleGetTimeline } from './handlers/timeline.js'
import { handleGetTranscript, handleGetSubagentTranscript } from './handlers/transcript.js'
import type { ApiContext, ApiRequest } from './types.js'
import { toJsonResponse, handleError } from './utils.js'

/** Create a middleware function that injects ApiContext into the request. */
function injectContext(ctx: ApiContext) {
  return (req: ApiRequest) => {
    req.ctx = ctx
  }
}

/**
 * Create the itty-router instance with all API routes registered.
 *
 * Pipeline:
 * - before: withParams (spreads :params onto req), injectContext
 * - catch: handleError (StatusError/URIError → appropriate HTTP status)
 * - finally: toJsonResponse (plain objects → JSON Response)
 */
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

- [ ] **Step 2: Verify it typechecks**

Run: `cd packages/sidekick-ui && npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/sidekick-ui/server/router.ts
git commit -m "refactor(ui): create router.ts with itty-router route table"
```

---

## Task 5: Rewrite api-plugin.ts and vite.config.ts

**Files:**
- Rewrite: `packages/sidekick-ui/server/api-plugin.ts`
- Modify: `packages/sidekick-ui/vite.config.ts`

- [ ] **Step 1: Rewrite api-plugin.ts as thin Vite plugin shell**

```typescript
// packages/sidekick-ui/server/api-plugin.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { createRouter } from './router.js'
import type { ApiContext } from './types.js'
import { toRequest, writeResponse } from './utils.js'

/**
 * Vite plugin that serves Sidekick API routes via itty-router.
 *
 * Routes are registered in router.ts. This plugin is only responsible for:
 * 1. Creating the ApiContext and router
 * 2. Adapting between Node HTTP and Web Request/Response
 * 3. Passing non-API requests through to Vite
 */
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

// Re-export isValidPathSegment for backward compatibility with existing tests
// (until they're fully migrated — will be removed in Task 6)
export { isValidPathSegment } from './utils.js'
```

- [ ] **Step 2: Update vite.config.ts import**

Change `vite.config.ts`:
```typescript
// Before:
import { sessionsApiPlugin } from './server/api-plugin.js'
plugins: [react(), sessionsApiPlugin()],

// After:
import { sidekickApiPlugin } from './server/api-plugin.js'
plugins: [react(), sidekickApiPlugin()],
```

- [ ] **Step 3: Verify typecheck and build**

Run: `cd packages/sidekick-ui && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run all handler and utils tests**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/utils.test.ts server/__tests__/handlers/`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/api-plugin.ts packages/sidekick-ui/vite.config.ts
git commit -m "refactor(ui): rewrite api-plugin.ts as thin Vite plugin shell with itty-router"
```

---

## Task 6: Rewrite api-plugin.test.ts as adapter integration tests

**Files:**
- Rewrite: `packages/sidekick-ui/server/__tests__/api-plugin.test.ts`

This replaces the old monolithic test file. The handler-level tests (Tasks 3a-3c) cover all the route-specific logic. This file only needs to verify the Vite plugin shell wiring: middleware registration, non-API passthrough, `/api/` prefix detection, and the adapter plumbing.

- [ ] **Step 1: Write the adapter integration tests**

```typescript
// packages/sidekick-ui/server/__tests__/api-plugin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Mock all data layer modules (handlers will call through to these)
const mockListProjects = vi.fn()
const mockGetProjectById = vi.fn()
const mockListSessions = vi.fn()

vi.mock('../sessions-api.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}))

const mockParseTimelineEvents = vi.fn()
vi.mock('../timeline-api.js', () => ({
  parseTimelineEvents: (...args: unknown[]) => mockParseTimelineEvents(...args),
}))

const mockParseTranscriptLines = vi.fn()
const mockParseSubagentTranscript = vi.fn()
vi.mock('../transcript-api.js', () => ({
  parseTranscriptLines: (...args: unknown[]) => mockParseTranscriptLines(...args),
  parseSubagentTranscript: (...args: unknown[]) => mockParseSubagentTranscript(...args),
}))

const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { sidekickApiPlugin } from '../api-plugin.js'

type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>

function getMiddleware(): MiddlewareFn {
  let captured: MiddlewareFn | undefined
  const fakeServer = {
    middlewares: {
      use(fn: MiddlewareFn) { captured = fn },
    },
  }
  const plugin = sidekickApiPlugin()
  ;(plugin as unknown as { configureServer: (s: typeof fakeServer) => void }).configureServer(fakeServer)
  if (!captured) throw new Error('middleware not captured')
  return captured
}

interface MockRes {
  statusCode: number
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

function createMocks(method: string, url: string) {
  const req = { method, url, headers: { host: 'localhost:5173' } } as unknown as IncomingMessage
  const resBody: string[] = []
  const mockRes: MockRes = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => { if (chunk) resBody.push(chunk) }),
  }
  const res = mockRes as unknown as ServerResponse
  const next = vi.fn()
  return { req, res, mockRes, next, resBody }
}

beforeEach(() => {
  mockListProjects.mockClear()
  mockGetProjectById.mockClear()
  mockListSessions.mockClear()
  mockParseTimelineEvents.mockClear()
  mockParseTranscriptLines.mockClear()
  mockParseSubagentTranscript.mockClear()
  mockAccess.mockClear()
})

describe('sidekickApiPlugin adapter integration', () => {
  describe('passthrough', () => {
    it('calls next() for non-api URLs', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/index.html')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('calls next() for unknown /api/ routes', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/unknown')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('route wiring', () => {
    it('GET /api/projects reaches listProjects', async () => {
      const mw = getMiddleware()
      mockListProjects.mockResolvedValue([])
      const { req, res, mockRes, next, resBody } = createMocks('GET', '/api/projects')
      await mw(req, res, next)
      expect(mockListProjects).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      expect(JSON.parse(resBody[0])).toEqual({ projects: [] })
    })

    it('GET /api/projects/:id/sessions reaches listSessions', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-foo', name: 'foo', projectDir: '/Users/foo', branch: 'main', active: false,
      })
      mockListSessions.mockResolvedValue([])
      const { req, res, next, resBody } = createMocks('GET', '/api/projects/-Users-foo/sessions')
      await mw(req, res, next)
      expect(mockGetProjectById).toHaveBeenCalled()
      expect(mockListSessions).toHaveBeenCalled()
      expect(JSON.parse(resBody[0])).toEqual({ sessions: [] })
    })

    it('GET /api/projects/:pid/sessions/:sid/transcript reaches parseTranscriptLines', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({ id: '-Users-foo', projectDir: '/Users/foo', active: true })
      mockParseTranscriptLines.mockResolvedValue([])
      const { req, res, next, resBody } = createMocks(
        'GET', '/api/projects/-Users-foo/sessions/uuid-1/transcript'
      )
      await mw(req, res, next)
      expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
      expect(JSON.parse(resBody[0])).toEqual({ lines: [] })
    })
  })

  describe('error handling', () => {
    it('returns 400 for malformed percent-encoding', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks('GET', '/api/projects/%E0%A4%A/sessions')
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })

    it('returns 400 for path traversal attempt', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks('GET', '/api/projects/..%2Fetc/sessions')
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects?_t=123 handles query strings', async () => {
      const mw = getMiddleware()
      mockListProjects.mockResolvedValue([])
      const { req, res, next } = createMocks('GET', '/api/projects?_t=123')
      await mw(req, res, next)
      expect(mockListProjects).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects/:id/sessions?_t=123 handles query strings', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-foo', name: 'foo', projectDir: '/Users/foo', branch: 'main', active: false,
      })
      mockListSessions.mockResolvedValue([])
      const { req, res, next } = createMocks('GET', '/api/projects/-Users-foo/sessions?_t=123')
      await mw(req, res, next)
      expect(mockGetProjectById).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects/:pid/sessions/:sid/timeline?_t=123 handles query strings', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-foo', name: 'foo', projectDir: '/Users/foo', branch: 'main', active: false,
      })
      mockAccess.mockResolvedValue(undefined)
      mockParseTimelineEvents.mockResolvedValue([])
      const { req, res, next } = createMocks(
        'GET', '/api/projects/-Users-foo/sessions/uuid-1/timeline?_t=123'
      )
      await mw(req, res, next)
      expect(mockParseTimelineEvents).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('URL normalization (path traversal via percent-encoding)', () => {
    it('falls through when projectId %2E%2E is URL-normalized away in sessions route', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/%2E%2E/sessions')
      await mw(req, res, next)
      // new URL normalizes %2E%2E to ".." then resolves it, changing the pathname
      expect(next).toHaveBeenCalled()
    })

    it('falls through when projectId "." is URL-normalized away in sessions route', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/./sessions')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('falls through when projectId %2E%2E is URL-normalized away in timeline route', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks(
        'GET', '/api/projects/%2E%2E/sessions/abc-123/timeline'
      )
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Remove the old `isValidPathSegment` re-export from api-plugin.ts**

Now that tests no longer import from `api-plugin.js`, remove the backward-compat re-export added in Task 5.

- [ ] **Step 3: Run the full test suite for sidekick-ui**

Run: `cd packages/sidekick-ui && npx vitest run`
Expected: all tests PASS (utils, handlers, adapter, and data-layer tests)

- [ ] **Step 4: Commit**

```bash
git add packages/sidekick-ui/server/__tests__/api-plugin.test.ts packages/sidekick-ui/server/api-plugin.ts
git commit -m "refactor(ui): rewrite api-plugin tests as adapter integration tests"
```

---

## Task 7: Verify acceptance criteria

**Files:** None (verification only)

- [ ] **Step 1: Run build**

Run: `cd packages/sidekick-ui && pnpm build`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `cd packages/sidekick-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `cd packages/sidekick-ui && pnpm lint`
Expected: PASS (fix any lint errors)

- [ ] **Step 4: Run full test suite**

Run: `cd packages/sidekick-ui && pnpm test`
Expected: all tests PASS

- [ ] **Step 5: Verify all 5 routes return identical responses**

Manual smoke test — start the dev server and hit each route:
```bash
cd packages/sidekick-ui && pnpm dev &
curl -s http://localhost:5173/api/projects | jq .
curl -s http://localhost:5173/api/unknown  # should 404 from Vite, not the API
# (kill dev server after verification)
```

- [ ] **Step 6: Commit any lint/build fixes and push**

```bash
git push -u origin refactor/vite-middleware-plugin
```
