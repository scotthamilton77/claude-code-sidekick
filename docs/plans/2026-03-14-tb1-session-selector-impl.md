# TB1: Session Selector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the `SessionSelector` React component to real session data via a minimal Vite middleware API, proving the end-to-end filesystem-to-UI pipeline.

**Architecture:** Two `GET` API routes served via a Vite plugin's `configureServer` hook read the project registry (`~/.sidekick/projects/`) and per-project session directories (`.sidekick/sessions/`). A `useSessions()` React hook fetches from these routes and feeds the existing `SessionSelector` component. No router framework — minimal inline handler.

**Tech Stack:** Vite 7, React 18, TypeScript, Node `fs/promises`, `child_process.execFile`, vitest

**Design doc:** `docs/plans/2026-03-14-tb1-session-selector-design.md`
**Decision log:** `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md`
**Bead:** `claude-code-sidekick-6mx`

---

### Task 1: Create the sessions API server module

**Files:**
- Create: `packages/sidekick-ui/src/server/sessions-api.ts`
- Test: `packages/sidekick-ui/src/server/__tests__/sessions-api.test.ts`

**Step 1: Write the failing test for `listProjects()`**

Create file: `packages/sidekick-ui/src/server/__tests__/sessions-api.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listProjects } from '../sessions-api.js'

// Mock node:fs/promises
vi.mock('node:fs/promises')
// Mock node:child_process
vi.mock('node:child_process')

import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'

describe('listProjects', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return empty array when registry dir does not exist', async () => {
    const mockReaddir = vi.mocked(fs.readdir)
    mockReaddir.mockRejectedValue(new Error('ENOENT'))

    const result = await listProjects('/nonexistent/.sidekick/projects')
    expect(result).toEqual([])
  })

  it('should read registry entries and return project metadata', async () => {
    const mockReaddir = vi.mocked(fs.readdir)
    const mockReadFile = vi.mocked(fs.readFile)

    // Registry has one project directory
    mockReaddir.mockResolvedValue([
      { name: '-Users-scott-src-myproject', isDirectory: () => true, isFile: () => false } as any,
    ])

    // Registry entry JSON
    mockReadFile.mockResolvedValue(JSON.stringify({
      path: '/Users/scott/src/myproject',
      displayName: 'myproject',
      lastActive: new Date().toISOString(),
    }))

    // Mock git branch
    const mockExecFile = vi.mocked(execFile)
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, 'feat/cool-feature\n', '')
      return {} as any
    })

    const result = await listProjects('/home/.sidekick/projects')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'myproject',
      projectDir: '/Users/scott/src/myproject',
      branch: 'feat/cool-feature',
    })
    expect(result[0].id).toBeDefined()
    expect(typeof result[0].active).toBe('boolean')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/sessions-api.test.ts`
Expected: FAIL — `listProjects` does not exist

**Step 3: Write minimal implementation**

Create file: `packages/sidekick-ui/src/server/sessions-api.ts`

```typescript
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { basename, join } from 'node:path'

export interface ProjectInfo {
  id: string
  name: string
  projectDir: string
  branch: string
  active: boolean
}

export interface SessionInfo {
  id: string
  title: string
  date: string
  status: 'active' | 'completed'
  persona?: string
  intent?: string
  intentConfidence?: number
}

/**
 * How recent the heartbeat must be to consider a project "active".
 * Matches daemon heartbeat interval (5s) with generous buffer.
 */
const ACTIVE_THRESHOLD_MS = 15_000

/**
 * List all registered projects from the sidekick project registry.
 */
export async function listProjects(registryDir: string): Promise<ProjectInfo[]> {
  let dirents: Awaited<ReturnType<typeof fs.readdir>>
  try {
    dirents = await fs.readdir(registryDir, { withFileTypes: true })
  } catch {
    return []
  }

  const projects: ProjectInfo[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue

    const entryFile = join(registryDir, dirent.name, 'registry.json')
    try {
      const raw = await fs.readFile(entryFile, 'utf-8')
      const entry = JSON.parse(raw) as {
        path: string
        displayName: string
        lastActive: string
      }

      const branch = await getGitBranch(entry.path)
      const lastActiveMs = new Date(entry.lastActive).getTime()
      const active = Date.now() - lastActiveMs < ACTIVE_THRESHOLD_MS

      projects.push({
        id: dirent.name,
        name: entry.displayName,
        projectDir: entry.path,
        branch,
        active,
      })
    } catch {
      // Skip invalid entries
    }
  }

  return projects
}

/**
 * Get current git branch for a project directory.
 * Returns 'unknown' on failure.
 */
function getGitBranch(projectDir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['branch', '--show-current'], { cwd: projectDir }, (err, stdout) => {
      if (err) {
        resolve('unknown')
      } else {
        resolve(stdout.trim() || 'unknown')
      }
    })
  })
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/sessions-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-ui/src/server/sessions-api.ts packages/sidekick-ui/src/server/__tests__/sessions-api.test.ts
git commit -m "feat(ui): add listProjects server function for project registry"
```

---

### Task 2: Add `listSessions()` to the server module

**Files:**
- Modify: `packages/sidekick-ui/src/server/sessions-api.ts`
- Modify: `packages/sidekick-ui/src/server/__tests__/sessions-api.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
import { listSessions } from '../sessions-api.js'

describe('listSessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return empty array when sessions dir does not exist', async () => {
    const mockReaddir = vi.mocked(fs.readdir)
    mockReaddir.mockRejectedValue(new Error('ENOENT'))

    const result = await listSessions('/nonexistent/project', false)
    expect(result).toEqual([])
  })

  it('should enumerate session directories with summary metadata', async () => {
    const mockReaddir = vi.mocked(fs.readdir)
    const mockReadFile = vi.mocked(fs.readFile)
    const mockStat = vi.mocked(fs.stat)

    // Session directories
    mockReaddir.mockResolvedValue([
      { name: 'abc-123', isDirectory: () => true, isFile: () => false } as any,
      { name: 'def-456', isDirectory: () => true, isFile: () => false } as any,
    ])

    // First session has summary, second doesn't
    mockReadFile.mockImplementation(async (filePath: any) => {
      if (String(filePath).includes('abc-123') && String(filePath).includes('session-summary.json')) {
        return JSON.stringify({
          session_id: 'abc-123',
          session_title: 'Fix daemon health',
          session_title_confidence: 0.85,
          latest_intent: 'Debugging daemon startup',
          latest_intent_confidence: 0.78,
          timestamp: '2026-03-14T10:00:00Z',
        })
      }
      if (String(filePath).includes('abc-123') && String(filePath).includes('session-persona.json')) {
        return JSON.stringify({
          persona_id: 'yoda',
          selected_from: ['yoda', 'bender'],
          timestamp: '2026-03-14T10:00:00Z',
        })
      }
      throw new Error('ENOENT')
    })

    // Directory mtime
    mockStat.mockResolvedValue({
      mtime: new Date('2026-03-14T10:00:00Z'),
    } as any)

    const result = await listSessions('/project', true)

    expect(result).toHaveLength(2)

    // First session: has summary
    expect(result[0]).toMatchObject({
      id: 'abc-123',
      title: 'Fix daemon health',
      intent: 'Debugging daemon startup',
      intentConfidence: 0.78,
      persona: 'yoda',
    })

    // Second session: no summary, fallback title
    expect(result[1]).toMatchObject({
      id: 'def-456',
    })
    expect(result[1].title).toContain('def-456') // fallback to ID
  })

  it('should derive session status from project active state', async () => {
    const mockReaddir = vi.mocked(fs.readdir)
    const mockReadFile = vi.mocked(fs.readFile)
    const mockStat = vi.mocked(fs.stat)

    mockReaddir.mockResolvedValue([
      { name: 'sess-1', isDirectory: () => true, isFile: () => false } as any,
    ])
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockStat.mockResolvedValue({ mtime: new Date() } as any)

    // Project is active
    const activeResult = await listSessions('/project', true)
    expect(activeResult[0].status).toBe('active')

    // Project is not active
    const inactiveResult = await listSessions('/project', false)
    expect(inactiveResult[0].status).toBe('completed')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/sessions-api.test.ts`
Expected: FAIL — `listSessions` does not exist

**Step 3: Implement `listSessions`**

Add to `packages/sidekick-ui/src/server/sessions-api.ts`:

```typescript
/**
 * List all sessions for a project by scanning its .sidekick/sessions/ directory.
 *
 * @param projectDir - Absolute path to the project root
 * @param projectActive - Whether the project's daemon is currently active
 */
export async function listSessions(projectDir: string, projectActive: boolean): Promise<SessionInfo[]> {
  const sessionsDir = join(projectDir, '.sidekick', 'sessions')

  let dirents: Awaited<ReturnType<typeof fs.readdir>>
  try {
    dirents = await fs.readdir(sessionsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const sessions: SessionInfo[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue

    const sessionId = dirent.name
    const sessionDir = join(sessionsDir, sessionId)

    // Read session summary state (optional)
    const summary = await readJsonSafe<{
      session_title?: string
      session_title_confidence?: number
      latest_intent?: string
      latest_intent_confidence?: number
    }>(join(sessionDir, 'state', 'session-summary.json'))

    // Read session persona state (optional)
    const persona = await readJsonSafe<{
      persona_id?: string
    }>(join(sessionDir, 'state', 'session-persona.json'))

    // Get directory mtime for date
    let date: string
    try {
      const stat = await fs.stat(sessionDir)
      date = stat.mtime.toISOString()
    } catch {
      date = new Date().toISOString()
    }

    sessions.push({
      id: sessionId,
      title: summary?.session_title ?? sessionId.slice(0, 8),
      date,
      status: projectActive ? 'active' : 'completed',
      persona: persona?.persona_id,
      intent: summary?.latest_intent,
      intentConfidence: summary?.latest_intent_confidence,
    })
  }

  // Sort by date descending (most recent first)
  sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return sessions
}

/**
 * Safely read and parse a JSON file. Returns null on any error.
 */
async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/sessions-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-ui/src/server/sessions-api.ts packages/sidekick-ui/src/server/__tests__/sessions-api.test.ts
git commit -m "feat(ui): add listSessions server function for session enumeration"
```

---

### Task 3: Create Vite plugin with `configureServer` hook

**Files:**
- Create: `packages/sidekick-ui/src/server/api-plugin.ts`
- Modify: `packages/sidekick-ui/vite.config.ts`
- Test: `packages/sidekick-ui/src/server/__tests__/api-plugin.test.ts`

**Step 1: Write the failing test**

Create file: `packages/sidekick-ui/src/server/__tests__/api-plugin.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSessionsApiPlugin } from '../api-plugin.js'

// We'll test the plugin structure and route matching, not the full HTTP layer
describe('createSessionsApiPlugin', () => {
  it('should return a Vite plugin with name and configureServer', () => {
    const plugin = createSessionsApiPlugin()

    expect(plugin.name).toBe('sidekick-sessions-api')
    expect(typeof plugin.configureServer).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/api-plugin.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the plugin**

Create file: `packages/sidekick-ui/src/server/api-plugin.ts`

```typescript
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { listProjects, listSessions } from './sessions-api.js'

const REGISTRY_DIR = join(homedir(), '.sidekick', 'projects')

/**
 * Minimal Vite plugin that serves session data from the sidekick filesystem.
 * Tracer bullet TB1 — will be refactored into proper middleware when route count grows.
 * See UI_IMPLEMENTATION_DECISIONS.md D5, bead claude-code-sidekick-qn3.
 */
export function createSessionsApiPlugin(): Plugin {
  return {
    name: 'sidekick-sessions-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        // GET /api/projects
        if (url === '/api/projects' && req.method === 'GET') {
          try {
            const projects = await listProjects(REGISTRY_DIR)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ projects }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // GET /api/projects/:id/sessions
        const sessionsMatch = url.match(/^\/api\/projects\/([^/]+)\/sessions$/)
        if (sessionsMatch && req.method === 'GET') {
          try {
            const projectId = decodeURIComponent(sessionsMatch[1])
            const projects = await listProjects(REGISTRY_DIR)
            const project = projects.find((p) => p.id === projectId)

            if (!project) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Project not found: ${projectId}` }))
              return
            }

            const sessions = await listSessions(project.projectDir, project.active)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ sessions }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // Not our route — pass to next middleware
        next()
      })
    },
  }
}
```

**Step 4: Wire plugin into `vite.config.ts`**

Modify `packages/sidekick-ui/vite.config.ts`:

```typescript
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { createSessionsApiPlugin } from './src/server/api-plugin.js'

export default defineConfig({
  plugins: [react(), createSessionsApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @sidekick/ui test -- --run src/server/__tests__/api-plugin.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/sidekick-ui/src/server/api-plugin.ts packages/sidekick-ui/src/server/__tests__/api-plugin.test.ts packages/sidekick-ui/vite.config.ts
git commit -m "feat(ui): create Vite plugin with sessions API routes"
```

---

### Task 4: Create `useSessions()` React hook

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useSessions.ts`
- Test: `packages/sidekick-ui/src/hooks/__tests__/useSessions.test.ts`

**Step 1: Write the failing test**

Create file: `packages/sidekick-ui/src/hooks/__tests__/useSessions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSessions } from '../useSessions.js'

// Note: @testing-library/react may need to be added as a devDependency.
// If not present, add it: pnpm --filter @sidekick/ui add -D @testing-library/react

describe('useSessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start in loading state', () => {
    // Mock fetch to never resolve
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSessions())

    expect(result.current.loading).toBe(true)
    expect(result.current.projects).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('should fetch projects and sessions and return mapped data', async () => {
    const mockProjects = {
      projects: [
        { id: 'proj-1', name: 'myproject', projectDir: '/path', branch: 'main', active: true },
      ],
    }
    const mockSessions = {
      sessions: [
        {
          id: 'sess-1',
          title: 'Fix daemon',
          date: '2026-03-14T10:00:00Z',
          status: 'active' as const,
          persona: 'yoda',
          intent: 'Debugging',
          intentConfidence: 0.8,
        },
      ],
    }

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockProjects) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSessions) })

    const { result } = renderHook(() => useSessions())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.projects).toHaveLength(1)
    expect(result.current.projects[0].name).toBe('myproject')
    expect(result.current.projects[0].sessions).toHaveLength(1)
    expect(result.current.projects[0].sessions[0].title).toBe('Fix daemon')
    expect(result.current.projects[0].sessions[0].branch).toBe('main')
    expect(result.current.projects[0].sessions[0].status).toBe('active')
  })

  it('should set error state on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSessions())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Network error')
    expect(result.current.projects).toEqual([])
  })
})
```

**Note:** Before running, check if `@testing-library/react` is in devDependencies. If not:
```bash
pnpm --filter @sidekick/ui add -D @testing-library/react
```

Also check if vitest config needs `environment: 'jsdom'` for React hook testing. Look at `packages/sidekick-ui/vitest.config.ts` or the vitest section of `vite.config.ts`. If no jsdom environment is configured, you may need to add `// @vitest-environment jsdom` at the top of the test file, or configure it in the vitest config.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run src/hooks/__tests__/useSessions.test.ts`
Expected: FAIL — `useSessions` does not exist

**Step 3: Implement the hook**

Create file: `packages/sidekick-ui/src/hooks/useSessions.ts`

```typescript
import { useState, useEffect } from 'react'
import type { Project, Session } from '../types'

interface ProjectApiResponse {
  projects: Array<{
    id: string
    name: string
    projectDir: string
    branch: string
    active: boolean
  }>
}

interface SessionApiResponse {
  sessions: Array<{
    id: string
    title: string
    date: string
    status: 'active' | 'completed'
    persona?: string
    intent?: string
    intentConfidence?: number
  }>
}

interface UseSessionsResult {
  projects: Project[]
  loading: boolean
  error: string | null
}

/**
 * Fetch real session data from the Vite middleware API.
 * Maps API responses into the existing Project/Session types.
 */
export function useSessions(): UseSessionsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      try {
        // Step 1: Get all projects
        const projectsRes = await fetch('/api/projects')
        if (!projectsRes.ok) throw new Error(`Projects API: ${projectsRes.status}`)
        const projectsData: ProjectApiResponse = await projectsRes.json()

        // Step 2: Get sessions for each project (parallel)
        const projectsWithSessions = await Promise.all(
          projectsData.projects.map(async (proj) => {
            const sessionsRes = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/sessions`)
            if (!sessionsRes.ok) return mapProject(proj, [])
            const sessionsData: SessionApiResponse = await sessionsRes.json()
            return mapProject(proj, sessionsData.sessions)
          })
        )

        if (!cancelled) {
          setProjects(projectsWithSessions)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [])

  return { projects, loading, error }
}

function mapProject(
  proj: ProjectApiResponse['projects'][0],
  sessions: SessionApiResponse['sessions']
): Project {
  return {
    id: proj.id,
    name: proj.name,
    sessions: sessions.map((s) => mapSession(s, proj.branch, proj.id)),
  }
}

function mapSession(
  session: SessionApiResponse['sessions'][0],
  branch: string,
  projectId: string
): Session {
  return {
    id: session.id,
    title: session.title,
    date: new Date(session.date).toLocaleString(),
    branch,
    projectId,
    persona: session.persona,
    intent: session.intent,
    intentConfidence: session.intentConfidence,
    status: session.status,
    // Empty collections — populated by later tracer bullets (TB2+)
    transcriptLines: [],
    sidekickEvents: [],
    ledStates: new Map(),
    stateSnapshots: [],
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/ui test -- --run src/hooks/__tests__/useSessions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sidekick-ui/src/hooks/useSessions.ts packages/sidekick-ui/src/hooks/__tests__/useSessions.test.ts
git commit -m "feat(ui): add useSessions hook for fetching real session data"
```

---

### Task 5: Wire `App.tsx` to use real data

**Files:**
- Modify: `packages/sidekick-ui/src/App.tsx:8,14,53`

**Step 1: Write the failing test**

This is a wiring change — the component tests are structural. Add a simple render test:

Create file: `packages/sidekick-ui/src/__tests__/App.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.js'

// Mock useSessions to return controlled data
vi.mock('../hooks/useSessions', () => ({
  useSessions: vi.fn().mockReturnValue({
    projects: [],
    loading: false,
    error: null,
  }),
}))

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should render without crashing with empty projects', () => {
    const { useSessions } = require('../hooks/useSessions')
    useSessions.mockReturnValue({ projects: [], loading: false, error: null })

    render(<App />)
    // SessionSelector should still render
    expect(screen.getByText('Sessions')).toBeDefined()
  })

  it('should show loading state', () => {
    const { useSessions } = require('../hooks/useSessions')
    useSessions.mockReturnValue({ projects: [], loading: true, error: null })

    render(<App />)
    expect(screen.getByText(/loading/i)).toBeDefined()
  })

  it('should show error state', () => {
    const { useSessions } = require('../hooks/useSessions')
    useSessions.mockReturnValue({ projects: [], loading: false, error: 'Connection failed' })

    render(<App />)
    expect(screen.getByText(/connection failed/i)).toBeDefined()
  })
})
```

**Note:** This test may need `// @vitest-environment jsdom` or a vitest config with `environment: 'jsdom'` and `@testing-library/react` installed.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run src/__tests__/App.test.tsx`
Expected: FAIL — App still imports mockProjects

**Step 3: Modify `App.tsx`**

Replace the mock data import and usage with the hook. Changes to `packages/sidekick-ui/src/App.tsx`:

**3a.** Replace line 8:
```typescript
// BEFORE:
import { mockProjects } from './data/mock-data'

// AFTER:
import { useSessions } from './hooks/useSessions'
```

**3b.** Replace line 11 and add loading/error handling at the top of the `App` function:
```typescript
function App() {
  const [state, dispatch] = useReducer(navigationReducer, initialState)
  const { projects, loading, error } = useSessions()

  // Derive selected data from state
  const selectedProject = projects.find(p => p.id === state.selectedProjectId)
```

**3c.** Add loading and error states in the JSX return. Wrap the main content:
```typescript
  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      <div className={state.darkMode ? 'dark' : ''}>
        <div className="h-screen w-screen bg-slate-50 dark:bg-slate-950 flex overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center w-full">
              <span className="text-slate-400 text-sm">Loading sessions...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center w-full">
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          ) : (
            <>
              {/* Session Selector — compresses to label */}
              <div className={`panel-transition ${selectorWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
                <SessionSelector projects={projects} />
              </div>
              {/* ... rest of dashboard unchanged ... */}
```

**3d.** Update the `SessionSelector` prop on line 53:
```typescript
// BEFORE:
<SessionSelector projects={mockProjects} />

// AFTER:
<SessionSelector projects={projects} />
```

**Important:** Do NOT delete `mock-data.ts` — keep it for future use in tests and storybook (Decision D7).

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/ui test -- --run src/__tests__/App.test.tsx`
Expected: PASS

**Step 5: Run all UI tests**

Run: `pnpm --filter @sidekick/ui test`
Expected: All PASS

**Step 6: Commit**

```bash
git add packages/sidekick-ui/src/App.tsx packages/sidekick-ui/src/__tests__/App.test.tsx
git commit -m "feat(ui): wire App.tsx to useSessions hook for real data"
```

---

### Task 6: Final verification

**Step 1: Run full build**

Run: `pnpm build`
Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (fix any issues)

**Step 4: Run all UI package tests**

Run: `pnpm --filter @sidekick/ui test`
Expected: All PASS

**Step 5: Manual integration test**

Run: `pnpm sidekick ui` (or `pnpm --filter @sidekick/ui dev`)
Expected:
- UI launches in browser
- SessionSelector shows real projects from `~/.sidekick/projects/`
- Each project shows its sessions (from `.sidekick/sessions/` dirs)
- Session titles come from `session-summary.json` (or show truncated ID as fallback)
- Green/grey dots reflect active/completed status
- Branch names appear under each session
- Clicking a session selects it (dashboard area remains empty since TB2 hasn't populated transcript/events)

If `~/.sidekick/projects/` has no entries or the daemon hasn't run, the selector will show empty — this is correct behavior.

**Step 6: Commit any lint fixes**

```bash
git commit -m "chore: lint fixes for TB1 session selector"
```
