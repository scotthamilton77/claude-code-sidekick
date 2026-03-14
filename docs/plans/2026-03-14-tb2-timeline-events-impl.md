# TB2: Timeline with Real NDJSON Events — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse NDJSON log files server-side, filter by session, transform to `SidekickEvent[]`, and feed the existing Timeline component with real timeline data.

**Architecture:** New Vite server module (`timeline-api.ts`) reads `.sidekick/logs/cli.log` and `sidekickd.log`, parses NDJSON lines, filters by session ID and visibility, generates payload-aware labels, and returns `SidekickEvent[]` via a new API route. A `useTimeline()` React hook fetches events on session selection and passes them to the existing Timeline component (unchanged).

**Tech Stack:** TypeScript, Vite `configureServer` middleware, React hooks, Vitest (server tests), Playwright (e2e)

**Design doc:** `docs/plans/2026-03-14-tb2-timeline-events-design.md`
**Decision log:** `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` (D8-D12)
**Bead:** `claude-code-sidekick-dgt`

---

## Reference: Key Types

**`SidekickEventType` (16 UI-visible types, from `packages/sidekick-ui/src/types.ts`):**
```
reminder:staged, reminder:unstaged, reminder:consumed,
decision:recorded,
session-summary:start, session-summary:finish, session-title:changed, intent:changed,
snarky-message:start, snarky-message:finish, resume-message:start, resume-message:finish,
persona:selected, persona:changed,
statusline:rendered,
error:occurred
```

**`SidekickEvent` (UI type, from `packages/sidekick-ui/src/types.ts`):**
```typescript
interface SidekickEvent {
  id: string
  timestamp: number
  type: SidekickEventType
  label: string
  detail?: string
  transcriptLineId: string  // '' for TB2 (D9)
}
```

**NDJSON log line format (Pino + canonical event fields):**
```json
{"level":30,"time":1773498166559,"pid":352,"hostname":"...","name":"sidekick:cli","context":{"sessionId":"5526888f-..."},"type":"reminder:staged","source":"cli","payload":{"reminderName":"vc-build","reason":"tool_threshold"}}
```

**Testing pattern:** See `server/__tests__/sessions-api.test.ts` — uses `vi.mock()` factories with separate `vi.fn()` instances, `.mockClear()` in `beforeEach`, helper functions for common mock setups.

---

### Task 1: NDJSON Parser and Event Filter (server-side)

**Files:**
- Create: `packages/sidekick-ui/server/timeline-api.ts`
- Create: `packages/sidekick-ui/server/__tests__/timeline-api.test.ts`

**Step 1: Write the failing tests for `parseTimelineEvents`**

Create `packages/sidekick-ui/server/__tests__/timeline-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseTimelineEvents } from '../timeline-api.js'

// Mock node:fs/promises
const mockReadFile = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

// Mock node:crypto
vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}))

beforeEach(() => {
  mockReadFile.mockClear()
})

/** Helper: build a valid NDJSON log line */
function logLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1700000000000,
    pid: 1,
    hostname: 'test',
    name: 'sidekick:cli',
    type: 'reminder:staged',
    source: 'cli',
    context: { sessionId: 'session-1' },
    payload: { reminderName: 'vc-build', reason: 'tool_threshold' },
    ...overrides,
  })
}

describe('parseTimelineEvents', () => {
  it('parses valid NDJSON lines and returns SidekickEvent array', async () => {
    const content = logLine()
    mockReadFile.mockResolvedValue(content)

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'test-uuid-1234',
      timestamp: 1700000000000,
      type: 'reminder:staged',
      transcriptLineId: '',
    })
  })

  it('filters events by sessionId', async () => {
    const lines = [
      logLine({ context: { sessionId: 'session-1' } }),
      logLine({ context: { sessionId: 'session-2' } }),
      logLine({ context: { sessionId: 'session-1' }, time: 1700000001000 }),
    ].join('\n')
    mockReadFile.mockResolvedValue(lines)

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
  })

  it('excludes log-only event types', async () => {
    const lines = [
      logLine({ type: 'reminder:staged' }), // timeline visibility — include
      logLine({ type: 'daemon:started', time: 1700000001000 }), // log visibility — exclude
      logLine({ type: 'error:occurred', time: 1700000002000 }), // both visibility — include
    ].join('\n')
    mockReadFile.mockResolvedValue(lines)

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
    expect(events.map(e => e.type)).toEqual(['reminder:staged', 'error:occurred'])
  })

  it('skips malformed JSON lines without crashing', async () => {
    const lines = [
      logLine(),
      'not valid json {{{',
      logLine({ time: 1700000001000, type: 'decision:recorded', payload: { category: 'testing' } }),
    ].join('\n')
    mockReadFile.mockResolvedValue(lines)

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
  })

  it('skips lines without a type field', async () => {
    const lines = [
      logLine(),
      JSON.stringify({ level: 30, time: 1700000001000, msg: 'random log line' }),
    ].join('\n')
    mockReadFile.mockResolvedValue(lines)

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
  })

  it('merges events from both cli.log and sidekickd.log sorted by time', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes('cli.log')) {
        return Promise.resolve(logLine({ time: 1700000002000, type: 'reminder:consumed' }))
      }
      if (filePath.includes('sidekickd.log')) {
        return Promise.resolve(logLine({ time: 1700000001000, type: 'decision:recorded' }))
      }
      return Promise.reject(new Error('ENOENT'))
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('decision:recorded') // earlier timestamp first
    expect(events[1].type).toBe('reminder:consumed')
  })

  it('returns empty array when log files do not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toEqual([])
  })

  it('returns empty array when log files are empty', async () => {
    mockReadFile.mockResolvedValue('')

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/timeline-api.test.ts`
Expected: FAIL — `parseTimelineEvents` does not exist

**Step 3: Write minimal implementation**

Create `packages/sidekick-ui/server/timeline-api.ts`:

```typescript
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { SidekickEventType, SidekickEvent } from '../src/types.js'

/**
 * The 16 event types the UI timeline renders.
 * Must match SidekickEventType from src/types.ts.
 */
const TIMELINE_EVENT_TYPES = new Set<string>([
  'reminder:staged', 'reminder:unstaged', 'reminder:consumed',
  'decision:recorded',
  'session-summary:start', 'session-summary:finish', 'session-title:changed', 'intent:changed',
  'snarky-message:start', 'snarky-message:finish', 'resume-message:start', 'resume-message:finish',
  'persona:selected', 'persona:changed',
  'statusline:rendered',
  'error:occurred',
])

interface ParsedLine {
  type: string
  time: number
  context?: { sessionId?: string }
  payload?: Record<string, unknown>
}

/**
 * Read an NDJSON log file and return parsed lines.
 * Skips malformed lines and returns empty array if file doesn't exist.
 */
async function readLogFile(filePath: string): Promise<ParsedLine[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  const lines: ParsedLine[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ParsedLine
      if (parsed.type && parsed.time) {
        lines.push(parsed)
      }
    } catch {
      // Skip malformed JSON lines
    }
  }
  return lines
}

/**
 * Parse timeline events from NDJSON log files for a given session.
 *
 * Reads both cli.log and sidekickd.log, filters by sessionId and
 * timeline visibility, generates labels, and returns sorted SidekickEvent[].
 */
export async function parseTimelineEvents(
  projectDir: string,
  sessionId: string
): Promise<SidekickEvent[]> {
  const logsDir = join(projectDir, '.sidekick', 'logs')

  const [cliLines, daemonLines] = await Promise.all([
    readLogFile(join(logsDir, 'cli.log')),
    readLogFile(join(logsDir, 'sidekickd.log')),
  ])

  const allLines = [...cliLines, ...daemonLines]

  const filtered = allLines.filter(
    (line) =>
      line.context?.sessionId === sessionId &&
      TIMELINE_EVENT_TYPES.has(line.type)
  )

  filtered.sort((a, b) => a.time - b.time)

  return filtered.map((line) => {
    const { label, detail } = generateLabel(line.type as SidekickEventType, line.payload ?? {})
    return {
      id: randomUUID(),
      timestamp: line.time,
      type: line.type as SidekickEventType,
      label,
      detail,
      transcriptLineId: '', // D9: placeholder until transcript correlation (TB3+)
    }
  })
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/timeline-api.test.ts`
Expected: PASS (all 7 tests) — except `generateLabel` doesn't exist yet. This will fail at compile time. That's expected — Task 2 adds the label generator.

**Step 5: Add a stub `generateLabel` to unblock tests**

Add to bottom of `timeline-api.ts`:

```typescript
/**
 * Generate a human-readable label from event type and payload.
 * Stub — full implementation in Task 2.
 */
export function generateLabel(
  type: SidekickEventType,
  _payload: Record<string, unknown>
): { label: string; detail?: string } {
  // Humanize: 'reminder:staged' → 'Reminder Staged'
  const label = type
    .split(':')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
  return { label }
}
```

**Step 6: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/timeline-api.test.ts`
Expected: PASS (all 7 tests)

**Step 7: Commit**

```bash
git add packages/sidekick-ui/server/timeline-api.ts packages/sidekick-ui/server/__tests__/timeline-api.test.ts
git commit -m "feat(ui): add NDJSON parser and event filter for TB2 timeline"
```

---

### Task 2: Payload-Aware Label Generator

**Files:**
- Modify: `packages/sidekick-ui/server/timeline-api.ts` (replace stub `generateLabel`)
- Modify: `packages/sidekick-ui/server/__tests__/timeline-api.test.ts` (add label tests)

**Step 1: Write the failing tests for `generateLabel`**

Add to `timeline-api.test.ts`:

```typescript
import { parseTimelineEvents, generateLabel } from '../timeline-api.js'

// ... (existing tests above) ...

describe('generateLabel', () => {
  it('generates payload-aware label for reminder:staged', () => {
    const result = generateLabel('reminder:staged', { reminderName: 'vc-build', reason: 'tool_threshold' })
    expect(result.label).toBe('Staged: vc-build')
    expect(result.detail).toBe('reason: tool_threshold')
  })

  it('generates label for reminder:unstaged', () => {
    const result = generateLabel('reminder:unstaged', { reminderName: 'vc-build', triggeredBy: 'tool_result' })
    expect(result.label).toBe('Unstaged: vc-build')
    expect(result.detail).toBe('triggeredBy: tool_result')
  })

  it('generates label for reminder:consumed', () => {
    const result = generateLabel('reminder:consumed', { reminderName: 'verify-completion' })
    expect(result.label).toBe('Consumed: verify-completion')
  })

  it('generates label for decision:recorded', () => {
    const result = generateLabel('decision:recorded', { category: 'testing', reasoning: 'tests already passed' })
    expect(result.label).toBe('Decision: testing')
    expect(result.detail).toBe('tests already passed')
  })

  it('generates label for session-title:changed', () => {
    const result = generateLabel('session-title:changed', { newValue: 'Fix auth bug', confidence: 0.85 })
    expect(result.label).toBe('Title → "Fix auth bug"')
    expect(result.detail).toBe('confidence: 0.85')
  })

  it('generates label for intent:changed', () => {
    const result = generateLabel('intent:changed', { newValue: 'refactoring', confidence: 0.72 })
    expect(result.label).toBe('Intent → "refactoring"')
    expect(result.detail).toBe('confidence: 0.72')
  })

  it('generates label for persona:selected', () => {
    const result = generateLabel('persona:selected', { personaTo: 'yoda' })
    expect(result.label).toBe('Persona: yoda')
  })

  it('generates label for persona:changed', () => {
    const result = generateLabel('persona:changed', { personaFrom: 'jarvis', personaTo: 'yoda' })
    expect(result.label).toBe('Persona: jarvis → yoda')
  })

  it('generates label for error:occurred', () => {
    const result = generateLabel('error:occurred', {
      errorMessage: 'ENOENT: no such file',
      errorStack: 'Error: ENOENT\n    at readFile...\n    at processTicksAndRejections...',
    })
    expect(result.label).toBe('Error: ENOENT: no such file')
    expect(result.detail).toBeDefined()
    expect(result.detail!.length).toBeLessThanOrEqual(120)
  })

  it('generates label for snarky-message:finish', () => {
    const msg = 'A very long snarky message that goes on and on and should be truncated at eighty characters for the detail field'
    const result = generateLabel('snarky-message:finish', { generatedMessage: msg })
    expect(result.label).toBe('Snarky Message')
    expect(result.detail).toBeDefined()
    expect(result.detail!.length).toBeLessThanOrEqual(80)
  })

  it('generates label for session-summary:start', () => {
    const result = generateLabel('session-summary:start', {})
    expect(result.label).toBe('Summary Started')
  })

  it('generates label for session-summary:finish', () => {
    const result = generateLabel('session-summary:finish', {})
    expect(result.label).toBe('Summary Complete')
  })

  it('generates label for resume-message:start', () => {
    const result = generateLabel('resume-message:start', {})
    expect(result.label).toBe('Resume Started')
  })

  it('generates label for resume-message:finish', () => {
    const msg = 'Welcome back! Last time we were working on...'
    const result = generateLabel('resume-message:finish', { generatedMessage: msg })
    expect(result.label).toBe('Resume Complete')
    expect(result.detail).toBeDefined()
  })

  it('generates label for statusline:rendered', () => {
    const result = generateLabel('statusline:rendered', { statuslineContent: '⚡ Building...' })
    expect(result.label).toBe('Statusline')
    expect(result.detail).toBe('⚡ Building...')
  })

  it('falls back to humanized type for missing payload fields', () => {
    const result = generateLabel('reminder:staged', {})
    expect(result.label).toBe('Staged: unknown')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/timeline-api.test.ts`
Expected: FAIL — stub `generateLabel` returns generic labels, not payload-aware ones

**Step 3: Replace the stub `generateLabel` with full implementation**

Replace the `generateLabel` function in `timeline-api.ts`:

```typescript
/**
 * Generate a human-readable label and optional detail from event type and payload.
 * Inspects payload fields to produce informative timeline labels (D10).
 */
export function generateLabel(
  type: SidekickEventType,
  payload: Record<string, unknown>
): { label: string; detail?: string } {
  switch (type) {
    // Reminder events
    case 'reminder:staged': {
      const name = (payload.reminderName as string) || 'unknown'
      const reason = payload.reason as string | undefined
      return { label: `Staged: ${name}`, detail: reason ? `reason: ${reason}` : undefined }
    }
    case 'reminder:unstaged': {
      const name = (payload.reminderName as string) || 'unknown'
      const trigger = payload.triggeredBy as string | undefined
      return { label: `Unstaged: ${name}`, detail: trigger ? `triggeredBy: ${trigger}` : undefined }
    }
    case 'reminder:consumed': {
      const name = (payload.reminderName as string) || 'unknown'
      return { label: `Consumed: ${name}` }
    }

    // Decision events
    case 'decision:recorded': {
      const category = (payload.category as string) || 'unknown'
      const reasoning = payload.reasoning as string | undefined
      return { label: `Decision: ${category}`, detail: reasoning }
    }

    // Session analysis
    case 'session-title:changed': {
      const newVal = payload.newValue as string | undefined
      const conf = payload.confidence as number | undefined
      return {
        label: newVal ? `Title → "${newVal}"` : 'Title Changed',
        detail: conf != null ? `confidence: ${conf}` : undefined,
      }
    }
    case 'intent:changed': {
      const newVal = payload.newValue as string | undefined
      const conf = payload.confidence as number | undefined
      return {
        label: newVal ? `Intent → "${newVal}"` : 'Intent Changed',
        detail: conf != null ? `confidence: ${conf}` : undefined,
      }
    }
    case 'session-summary:start':
      return { label: 'Summary Started' }
    case 'session-summary:finish':
      return { label: 'Summary Complete' }
    case 'snarky-message:start':
      return { label: 'Snarky Message…' }
    case 'snarky-message:finish': {
      const msg = payload.generatedMessage as string | undefined
      return { label: 'Snarky Message', detail: msg ? msg.slice(0, 80) : undefined }
    }
    case 'resume-message:start':
      return { label: 'Resume Started' }
    case 'resume-message:finish': {
      const msg = payload.generatedMessage as string | undefined
      return { label: 'Resume Complete', detail: msg ? msg.slice(0, 80) : undefined }
    }

    // Persona events
    case 'persona:selected': {
      const to = (payload.personaTo as string) || 'unknown'
      return { label: `Persona: ${to}` }
    }
    case 'persona:changed': {
      const from = (payload.personaFrom as string) || 'unknown'
      const to = (payload.personaTo as string) || 'unknown'
      return { label: `Persona: ${from} → ${to}` }
    }

    // Statusline
    case 'statusline:rendered': {
      const content = payload.statuslineContent as string | undefined
      return { label: 'Statusline', detail: content }
    }

    // Errors
    case 'error:occurred': {
      const errMsg = (payload.errorMessage as string) || 'Unknown error'
      const stack = payload.errorStack as string | undefined
      return { label: `Error: ${errMsg}`, detail: stack ? stack.slice(0, 120) : undefined }
    }

    default: {
      // Fallback: humanize type string
      const label = type
        .split(':')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ')
      return { label }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && npx vitest run server/__tests__/timeline-api.test.ts`
Expected: PASS (all tests including new label generator tests)

**Step 5: Commit**

```bash
git add packages/sidekick-ui/server/timeline-api.ts packages/sidekick-ui/server/__tests__/timeline-api.test.ts
git commit -m "feat(ui): add payload-aware label generator for timeline events"
```

---

### Task 3: Wire API Route in Vite Plugin

**Files:**
- Modify: `packages/sidekick-ui/server/api-plugin.ts`

**Step 1: Add the timeline route to the Vite plugin**

In `packages/sidekick-ui/server/api-plugin.ts`, add the import and route:

```typescript
import { listProjects, getProjectById, listSessions } from './sessions-api.js'
import { parseTimelineEvents } from './timeline-api.js'
```

Add a new route block inside the `server.middlewares.use` callback, after the sessions route and before the `// Unknown /api/ route` comment:

```typescript
          // GET /api/projects/:projectId/sessions/:sessionId/timeline
          const timelineMatch = req.url.match(
            /^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/timeline$/
          )
          if (timelineMatch && req.method === 'GET') {
            const projectId = decodeURIComponent(timelineMatch[1])
            const sessionId = decodeURIComponent(timelineMatch[2])

            const project = await getProjectById(REGISTRY_ROOT, projectId)
            if (!project) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Project not found: ${projectId}` }))
              return
            }

            // Verify session directory exists
            const sessionDir = join(project.projectDir, '.sidekick', 'sessions', sessionId)
            try {
              await access(sessionDir)
            } catch {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }))
              return
            }

            const events = await parseTimelineEvents(project.projectDir, sessionId)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ events }))
            return
          }
```

Also add the `access` import at the top:

```typescript
import { access } from 'node:fs/promises'
import { join } from 'node:path'
```

**Step 2: Verify build**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add packages/sidekick-ui/server/api-plugin.ts
git commit -m "feat(ui): add timeline API route to Vite plugin"
```

---

### Task 4: `useTimeline()` React Hook

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useTimeline.ts`

**Step 1: Write the hook**

Create `packages/sidekick-ui/src/hooks/useTimeline.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { SidekickEvent } from '../types'

export interface UseTimelineResult {
  events: SidekickEvent[]
  loading: boolean
  error: string | null
}

/**
 * Fetch timeline events for a selected session.
 * Re-fetches when projectId or sessionId changes.
 * Returns empty events when either ID is null.
 */
export function useTimeline(
  projectId: string | null,
  sessionId: string | null
): UseTimelineResult {
  const [events, setEvents] = useState<SidekickEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !sessionId) {
      setEvents([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchTimeline() {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId!)}/sessions/${encodeURIComponent(sessionId!)}/timeline`
        )
        if (!res.ok) {
          throw new Error(`Failed to fetch timeline: ${res.status}`)
        }
        const { events: apiEvents } = (await res.json()) as { events: SidekickEvent[] }
        if (!cancelled) {
          setEvents(apiEvents)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setEvents([])
          setLoading(false)
        }
      }
    }

    fetchTimeline()

    return () => {
      cancelled = true
    }
  }, [projectId, sessionId])

  return { events, loading, error }
}
```

**Step 2: Verify typecheck**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add packages/sidekick-ui/src/hooks/useTimeline.ts
git commit -m "feat(ui): add useTimeline hook for fetching timeline events"
```

---

### Task 5: Wire `useTimeline()` into App and add Timeline empty state

**Files:**
- Modify: `packages/sidekick-ui/src/App.tsx`
- Modify: `packages/sidekick-ui/src/components/timeline/Timeline.tsx`

**Step 1: Update `App.tsx` to use `useTimeline()`**

Add import:

```typescript
import { useTimeline } from './hooks/useTimeline'
```

After the existing `useSessions()` call and the derived state variables, add:

```typescript
  const { events: timelineEvents, loading: timelineLoading } = useTimeline(
    state.selectedProjectId,
    state.selectedSessionId
  )
```

Replace the Timeline JSX (the `<Timeline events={selectedSession.sidekickEvents} />` line) with:

```typescript
                  <Timeline events={timelineEvents} loading={timelineLoading} />
```

**Step 2: Update `Timeline.tsx` to accept `loading` prop and show empty state**

Update the props interface and component:

```typescript
interface TimelineProps {
  events: SidekickEvent[]
  loading?: boolean
}

export function Timeline({ events, loading }: TimelineProps) {
  const { state, dispatch } = useNavigation()

  const isEventDimmed = useCallback(
    (event: SidekickEvent): boolean => {
      if (state.timelineFilters.size === 0) return false
      const filter = SIDEKICK_EVENT_TO_FILTER[event.type]
      return !state.timelineFilters.has(filter)
    },
    [state.timelineFilters]
  )

  return (
    <div className="h-full flex flex-col">
      <TimelineFilterBar />
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">
            No events
          </div>
        ) : (
          events.map(event => (
            <TimelineEventItem
              key={event.id}
              event={event}
              isSynced={state.syncedTranscriptLineId === event.transcriptLineId}
              isDimmed={isEventDimmed(event)}
              onClick={() => dispatch({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: event.transcriptLineId })}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

**Step 3: Verify typecheck and build**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add packages/sidekick-ui/src/App.tsx packages/sidekick-ui/src/components/timeline/Timeline.tsx
git commit -m "feat(ui): wire useTimeline to App and add Timeline empty state"
```

---

### Task 6: Playwright E2E Tests

**Files:**
- Create: `packages/sidekick-ui/e2e/timeline.spec.ts`

**Important context:** The Playwright tests run against the live dev server (port 5199) with real filesystem data. Tests must handle the case where no real log data exists (empty timeline). See `e2e/session-selector.spec.ts` for patterns — uses `test.skip()` when preconditions aren't met.

**Step 1: Write e2e tests**

Create `packages/sidekick-ui/e2e/timeline.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('TB2 Timeline — API routes', () => {
  test('GET /api/projects/:id/sessions/:sid/timeline returns JSON with events array', async ({
    request,
  }) => {
    // Find a real project and session to test against
    const projectsRes = await request.get('/api/projects')
    const { projects } = await projectsRes.json()
    if (projects.length === 0) {
      test.skip()
      return
    }

    let targetProject = null
    let targetSessionId = null
    for (const project of projects) {
      const sessionsRes = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsRes.json()
      if (sessions.length > 0) {
        targetProject = project
        targetSessionId = sessions[0].id
        break
      }
    }

    if (!targetProject || !targetSessionId) {
      test.skip()
      return
    }

    const response = await request.get(
      `/api/projects/${encodeURIComponent(targetProject.id)}/sessions/${encodeURIComponent(targetSessionId)}/timeline`
    )
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('events')
    expect(Array.isArray(body.events)).toBe(true)
  })

  test('GET /api/.../timeline returns 404 for unknown project', async ({ request }) => {
    const response = await request.get('/api/projects/nonexistent/sessions/fake-session/timeline')
    expect(response.status()).toBe(404)
  })

  test('GET /api/.../timeline returns 404 for unknown session', async ({ request }) => {
    const projectsRes = await request.get('/api/projects')
    const { projects } = await projectsRes.json()
    if (projects.length === 0) {
      test.skip()
      return
    }

    const response = await request.get(
      `/api/projects/${encodeURIComponent(projects[0].id)}/sessions/nonexistent-session-id/timeline`
    )
    expect(response.status()).toBe(404)
  })
})

test.describe('TB2 Timeline — UI rendering', () => {
  test('shows "No events" when session has no timeline data', async ({ page, request }) => {
    // Find a project with sessions
    const projectsRes = await request.get('/api/projects')
    const { projects } = await projectsRes.json()
    if (projects.length === 0) {
      test.skip()
      return
    }

    let targetProject = null
    let targetSessions: Array<{ id: string; title: string }> = []
    for (const project of projects) {
      const sessionsRes = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsRes.json()
      if (sessions.length > 0) {
        targetProject = project
        targetSessions = sessions
        break
      }
    }

    if (!targetProject) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Click a session to select it
    const sessionTitle = targetSessions[0].title
    await page.getByText(sessionTitle).click()

    // Timeline panel should be visible — either with events or "No events" message
    // We can't guarantee events exist, so just check the timeline area is rendered
    const timelineArea = page.locator('.w-60')
    await expect(timelineArea).toBeVisible()
  })

  test('timeline renders events for session with log data', async ({ page, request }) => {
    // Find a session that actually has timeline events
    const projectsRes = await request.get('/api/projects')
    const { projects } = await projectsRes.json()

    let targetProject = null
    let targetSession = null
    for (const project of projects) {
      const sessionsRes = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsRes.json()
      for (const session of sessions) {
        const timelineRes = await request.get(
          `/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(session.id)}/timeline`
        )
        const { events } = await timelineRes.json()
        if (events.length > 0) {
          targetProject = project
          targetSession = session
          break
        }
      }
      if (targetSession) break
    }

    if (!targetSession) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Click the session
    await page.getByText(targetSession.title).click()

    // Wait for timeline events to load — look for event items in the timeline
    // Events have HH:MM:SS timestamps in the timeline
    const timelineEvents = page.locator('.w-60 button')
    await expect(timelineEvents.first()).toBeVisible({ timeout: 10_000 })
  })

  test('switching sessions reloads timeline with new data', async ({ page, request }) => {
    // Need at least one project with at least 2 sessions
    const projectsRes = await request.get('/api/projects')
    const { projects } = await projectsRes.json()

    let targetProject = null
    let targetSessions: Array<{ id: string; title: string }> = []
    for (const project of projects) {
      const sessionsRes = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsRes.json()
      if (sessions.length >= 2) {
        targetProject = project
        targetSessions = sessions
        break
      }
    }

    if (!targetProject || targetSessions.length < 2) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Select first session
    await page.getByText(targetSessions[0].title).click()

    // Wait for timeline to load (either events or "No events")
    const timelineArea = page.locator('.w-60')
    await expect(timelineArea).toBeVisible()

    // Go back to selector (click the compressed label to re-expand)
    const compressedButton = page.locator('button[title]').first()
    await compressedButton.click()

    // Wait for session list to be visible again
    await expect(page.getByText('Sessions')).toBeVisible()

    // Select second session
    await page.getByText(targetSessions[1].title).click()

    // Timeline should be visible again with new session's data
    await expect(timelineArea).toBeVisible()
  })
})
```

**Step 2: Run e2e tests**

Run: `cd packages/sidekick-ui && npx playwright test e2e/timeline.spec.ts`
Expected: PASS (or skip if no real data exists)

**Step 3: Commit**

```bash
git add packages/sidekick-ui/e2e/timeline.spec.ts
git commit -m "test(ui): add Playwright e2e tests for TB2 timeline"
```

---

### Task 7: Verification and Final Cleanup

**Step 1: Run full typecheck**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: No errors

**Step 2: Run full lint**

Run: `cd packages/sidekick-ui && npx eslint .`
Expected: No errors (or only pre-existing warnings)

**Step 3: Run all unit tests**

Run: `cd packages/sidekick-ui && npx vitest run`
Expected: All tests pass

**Step 4: Run e2e tests**

Run: `cd packages/sidekick-ui && npx playwright test`
Expected: All tests pass

**Step 5: Manual verification**

Run: `cd packages/sidekick-ui && npx vite --port 5199`

1. Open http://localhost:5199
2. Select a project and session
3. Verify the Timeline panel shows real events (or "No events" if the session has no log data)
4. Check that event labels are payload-aware (e.g., "Staged: vc-build" not "Reminder Staged")
5. Check filter toggles dim/show events correctly
6. Switch sessions and verify timeline reloads

**Step 6: Update UI_IMPLEMENTATION_DECISIONS.md if needed**

If any decisions changed during implementation, update the decision log.

**Step 7: Create PR**

```bash
git push -u origin feat/tb2-timeline-events
gh pr create --title "feat(ui): TB2 — timeline with real NDJSON events" --body "..."
```
