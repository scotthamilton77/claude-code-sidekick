# TB3: Transcript Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse Claude Code session transcripts from `~/.claude/projects/` and render them in the existing Transcript panel with real data.

**Architecture:** Vite dev server reads JSONL transcript files, parses line-by-line, maps to `TranscriptLine[]` via a new `transcript-api.ts` module. A new `useTranscript()` React hook fetches from a new API route. The existing `Transcript.tsx` and `TranscriptLine.tsx` components render the data — they already handle all needed line types.

**Tech Stack:** TypeScript, Vite dev server middleware, React hooks, `@sidekick/core` content extractors

**Reference Docs:**
- `docs/plans/2026-03-14-tb3-transcript-panel-design.md` — Design decisions D13-D19
- `docs/design/CLAUDE-CODE-TRANSCRIPT-FORMAT.md` — Full transcript format taxonomy
- `packages/sidekick-ui/server/timeline-api.ts` — Pattern to follow (TB2)
- `packages/sidekick-ui/src/hooks/useTimeline.ts` — Hook pattern to follow
- `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` — Decision log (update with D13-D19)

---

### Task 1: Add new TranscriptLine types to types.ts

**Files:**
- Modify: `packages/sidekick-ui/src/types.ts:27-33`

**Step 1: Update TranscriptLineType union**

Add three new types for system entries and metadata fields for new functionality:

```typescript
export type TranscriptLineType =
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'tool-result'
  | 'compaction'
  | 'turn-duration'    // NEW: system/turn_duration
  | 'api-error'        // NEW: system/api_error
  | 'pr-link'          // NEW: pr-link entry
  | SidekickEventType
```

Add new optional fields to the `TranscriptLine` interface:

```typescript
  // turn-duration
  durationMs?: number

  // api-error
  retryAttempt?: number
  maxRetries?: number

  // pr-link
  prUrl?: string
  prNumber?: number

  // metadata flags
  model?: string
  isSidechain?: boolean
  isCompactSummary?: boolean
  isMeta?: boolean
```

**Step 2: Verify typecheck passes**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: PASS (new optional fields don't break existing code)

**Step 3: Commit**

```
git add packages/sidekick-ui/src/types.ts
git commit -m "feat(ui): add turn-duration, api-error, pr-link to TranscriptLineType"
```

---

### Task 2: Create transcript-api.ts server module — core parser

**Files:**
- Create: `packages/sidekick-ui/server/transcript-api.ts`
- Create: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`

This is the largest task. Follow TDD — write tests first, then implement.

**Step 1: Write failing tests for the parser**

Create `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`.

Mock `node:fs/promises` (same pattern as `timeline-api.test.ts`).

Tests to write:

```typescript
// Mock setup: mockReadFile, mockAccess, mockStat
// Import after mocks: { parseTranscriptLines, resolveTranscriptPath }

describe('resolveTranscriptPath', () => {
  // Returns directory-layout path when {sessionId}/{sessionId}.jsonl exists
  // Falls back to bare file {sessionId}.jsonl when directory doesn't exist
  // Returns null when neither exists
})

describe('parseTranscriptLines', () => {
  // Parses user text message → TranscriptLine with type 'user-message'
  // Parses assistant text message → 'assistant-message' with content
  // Parses assistant thinking block → 'assistant-message' with .thinking field
  // Parses assistant tool_use block → 'tool-use' with toolName and toolInput
  // Parses user tool_result block → 'tool-result' with toolOutput and toolSuccess
  // Parses system/compact_boundary → 'compaction' with compactionTokensBefore
  // Parses system/turn_duration → 'turn-duration' with durationMs
  // Parses system/api_error → 'api-error' with retryAttempt, maxRetries
  // Parses pr-link → 'pr-link' with prUrl, prNumber
  // Skips queue-operation entries
  // Skips file-history-snapshot entries
  // Skips progress entries
  // Skips last-prompt entries
  // Skips system/stop_hook_summary entries
  // Skips system/local_command entries
  // Skips malformed JSON lines without crashing
  // Returns empty array when file doesn't exist
  // Returns empty array when file is empty
  // Preserves isSidechain flag on entries
  // Preserves isMeta flag on entries
  // Preserves isCompactSummary flag on entries
  // Preserves model from assistant entries
  // Generates deterministic IDs: transcript-{lineNumber}-{blockIndex}
  // Returns lines sorted by timestamp (file order)
  // Handles mixed content blocks in one assistant entry (text + tool_use)
})
```

Each test should use helper functions to create JSONL entry strings:

```typescript
function makeUserEntry(content: string | unknown[], overrides?: Record<string, unknown>): string
function makeAssistantEntry(content: unknown[], overrides?: Record<string, unknown>): string
function makeSystemEntry(subtype: string, overrides?: Record<string, unknown>): string
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sidekick-ui && pnpm vitest run server/__tests__/transcript-api.test.ts`
Expected: FAIL (module doesn't exist yet)

**Step 3: Implement transcript-api.ts**

Create `packages/sidekick-ui/server/transcript-api.ts` with:

```typescript
import { readFile, access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { extractTextFromContent } from '@sidekick/core'
import type { TranscriptLine } from '../src/types'
// NOTE: Can't import src/types from server/ due to tsconfig split.
// Define a local TranscriptLineApi interface mirroring the shape, same as timeline-api.ts pattern.

// Types for raw JSONL entries
interface RawTranscriptEntry {
  type: string
  subtype?: string
  uuid?: string
  timestamp?: string
  message?: {
    role?: string
    content?: string | ContentBlock[]
    model?: string
    usage?: Record<string, unknown>
  }
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  compactMetadata?: { trigger?: string; preTokens?: number }
  durationMs?: number
  retryAttempt?: number
  maxRetries?: number
  error?: unknown
  prUrl?: string
  prNumber?: number
  prRepository?: string
}

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  signature?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

// Exported API response type (mirrors TranscriptLine from src/types.ts)
export interface ApiTranscriptLine { /* ... fields matching TranscriptLine ... */ }

// Set of entry types to skip entirely
const SKIP_TYPES = new Set([
  'queue-operation',
  'file-history-snapshot',
  'last-prompt',
  'progress',
])

// Set of system subtypes to skip
const SKIP_SYSTEM_SUBTYPES = new Set([
  'stop_hook_summary',
  'local_command',
])

export async function resolveTranscriptPath(projectId: string, sessionId: string): Promise<string | null>
export async function parseTranscriptLines(projectId: string, sessionId: string): Promise<ApiTranscriptLine[]>
```

Key implementation details:
- `resolveTranscriptPath`: Try `~/.claude/projects/{projectId}/{sessionId}/{sessionId}.jsonl` then `~/.claude/projects/{projectId}/{sessionId}.jsonl`
- Skip `queue-operation` BEFORE `JSON.parse` if possible (check for `"type":"queue-operation"` substring for speed, then parse)
- Actually: just parse and check `.type` — simpler, the string check optimization is premature
- For each non-skipped line: parse JSON, check type, map to ApiTranscriptLine
- For `user`/`assistant` entries: iterate content blocks, produce one ApiTranscriptLine per block
- For `system` entries: check subtype, map `compact_boundary` → compaction, `turn_duration` → turn-duration, `api_error` → api-error
- For `pr-link`: extract prUrl, prNumber
- ID format: `transcript-${lineNumber}-${blockIndex}` (0-indexed lineNumber, 0-indexed blockIndex within that line)
- Use `extractTextFromContent` from `@sidekick/core` for text extraction as a utility reference, but the actual mapping logic is custom

**Step 4: Run tests to verify they pass**

Run: `cd packages/sidekick-ui && pnpm vitest run server/__tests__/transcript-api.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add packages/sidekick-ui/server/transcript-api.ts packages/sidekick-ui/server/__tests__/transcript-api.test.ts
git commit -m "feat(ui): TB3 transcript parser with tests"
```

---

### Task 3: Add transcript API route to api-plugin.ts

**Files:**
- Modify: `packages/sidekick-ui/server/api-plugin.ts:84-131`
- Modify: `packages/sidekick-ui/server/__tests__/api-plugin.test.ts`

**Step 1: Write failing test**

Add to `api-plugin.test.ts`:

```typescript
describe('transcript route', () => {
  // GET /api/projects/:id/sessions/:sid/transcript returns transcript lines
  // GET /api/projects/:id/sessions/:sid/transcript?_t=123 handles query strings
  // Rejects invalid projectId in transcript route
  // Rejects invalid sessionId in transcript route
  // Returns 404 when transcript file not found
})
```

Mock `transcript-api.ts` module: `mockParseTranscriptLines`, `mockResolveTranscriptPath`.

**Step 2: Run test to verify it fails**

Run: `cd packages/sidekick-ui && pnpm vitest run server/__tests__/api-plugin.test.ts`
Expected: FAIL

**Step 3: Add route to api-plugin.ts**

Import `parseTranscriptLines` from `./transcript-api.js`.

Add new route matching AFTER the timeline route, BEFORE the `next()` fallthrough:

```typescript
// GET /api/projects/:projectId/sessions/:sessionId/transcript
const transcriptMatch = pathname.match(
  /^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/transcript$/
)
if (transcriptMatch && req.method === 'GET') {
  const projectId = decodeURIComponent(transcriptMatch[1])
  const sessionId = decodeURIComponent(transcriptMatch[2])

  if (!isValidPathSegment(projectId)) { /* 400 */ }
  if (!isValidPathSegment(sessionId)) { /* 400 */ }

  const lines = await parseTranscriptLines(projectId, sessionId)
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ lines }))
  return
}
```

Note: Unlike the timeline route, we don't need to look up the project from Sidekick's registry — the transcript lives in `~/.claude/projects/` keyed by projectId directly. We DO still validate the path segments.

**Step 4: Run tests**

Run: `cd packages/sidekick-ui && pnpm vitest run server/__tests__/api-plugin.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add packages/sidekick-ui/server/api-plugin.ts packages/sidekick-ui/server/__tests__/api-plugin.test.ts
git commit -m "feat(ui): add /api/.../transcript route to api-plugin"
```

---

### Task 4: Create useTranscript() React hook

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useTranscript.ts`

**Step 1: Implement hook**

Mirror `useTimeline.ts` exactly:

```typescript
import { useState, useEffect } from 'react'
import type { TranscriptLine } from '../types'

export interface UseTranscriptResult {
  lines: TranscriptLine[]
  loading: boolean
  error: string | null
}

export function useTranscript(
  projectId: string | null,
  sessionId: string | null
): UseTranscriptResult {
  // Same pattern as useTimeline:
  // - useState for lines, loading, error
  // - useEffect with cleanup (cancelled flag)
  // - Fetch GET /api/projects/{projectId}/sessions/{sessionId}/transcript
  // - Parse { lines } from response
  // - Handle errors
}
```

**Step 2: Verify typecheck**

Run: `cd packages/sidekick-ui && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
git add packages/sidekick-ui/src/hooks/useTranscript.ts
git commit -m "feat(ui): useTranscript() hook for transcript data fetching"
```

---

### Task 5: Wire useTranscript() into App.tsx

**Files:**
- Modify: `packages/sidekick-ui/src/App.tsx:1-10,15-18,86-91`

**Step 1: Add import and hook call**

```typescript
import { useTranscript } from './hooks/useTranscript'

// Inside App():
const { lines: transcriptLines, loading: transcriptLoading, error: transcriptError } = useTranscript(
  state.selectedProjectId,
  state.selectedSessionId
)
```

**Step 2: Pass to Transcript component**

Replace the current `lines={selectedSession.transcriptLines}` with the hook data.

The `Transcript` component already accepts `lines: TranscriptLine[]`. Add loading/error props if not already present (check `Transcript.tsx` interface — it currently doesn't have loading/error props, so add them like Timeline does):

```tsx
<Transcript
  lines={transcriptLines}
  loading={transcriptLoading}
  error={transcriptError}
  ledStates={selectedSession?.ledStates ?? new Map()}
  scrollToLineId={state.syncedTranscriptLineId}
/>
```

**Step 3: Update Transcript component to handle loading/error**

Add `loading?: boolean` and `error?: string | null` to `TranscriptProps`. Render loading spinner and error state (same pattern as `Timeline.tsx`).

**Step 4: Verify build**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
git add packages/sidekick-ui/src/App.tsx packages/sidekick-ui/src/components/transcript/Transcript.tsx
git commit -m "feat(ui): wire useTranscript() into App and Transcript component"
```

---

### Task 6: Add TranscriptLine renderers for new types

**Files:**
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx:120-124,200-236`

**Step 1: Add new type handlers to getLineStyles()**

Add cases for `turn-duration`, `api-error`, `pr-link`:

```typescript
case 'turn-duration':
  return { bg: 'bg-slate-50 dark:bg-slate-800/50', border: 'border border-slate-200 dark:border-slate-700',
    Icon: Clock, iconColor: 'text-slate-400', label: `Turn: ${formatDuration(line.durationMs)}`,
    labelColor: 'text-slate-500 dark:text-slate-400' }
case 'api-error':
  return { bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border border-orange-200 dark:border-orange-800/50',
    Icon: AlertTriangle, iconColor: 'text-orange-500', label: 'API Retry',
    labelColor: 'text-orange-600 dark:text-orange-400' }
case 'pr-link':
  return { bg: 'bg-indigo-50 dark:bg-indigo-950/20', border: 'border border-indigo-200 dark:border-indigo-800/50',
    Icon: GitPullRequest, iconColor: 'text-indigo-500', label: `PR #${line.prNumber ?? '?'}`,
    labelColor: 'text-indigo-600 dark:text-indigo-400' }
```

Import `Clock` and `GitPullRequest` from lucide-react. Add `formatDuration` helper:

```typescript
function formatDuration(ms?: number): string {
  if (ms == null) return '?'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
```

**Step 2: Update isSidekickEventType() to exclude new types**

```typescript
function isSidekickEventType(type: TranscriptLineType): boolean {
  return ![
    'user-message', 'assistant-message', 'tool-use', 'tool-result',
    'compaction', 'turn-duration', 'api-error', 'pr-link',
  ].includes(type)
}
```

**Step 3: Add sidechain visual indicator**

In `TranscriptLineCard`, if `line.isSidechain`, add a small badge or left border accent:

```tsx
// After the header div, before content
{line.isSidechain && (
  <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1 rounded ml-1">
    sidechain
  </span>
)}
```

**Step 4: Verify build**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
git add packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx
git commit -m "feat(ui): add turn-duration, api-error, pr-link renderers and sidechain badge"
```

---

### Task 7: Update decision log and final verification

**Files:**
- Modify: `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md`

**Step 1: Add decisions D13-D19**

Append to the decision log following the existing format. Reference the design doc.

**Step 2: Run full verification**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: PASS

Run: `cd packages/sidekick-ui && pnpm vitest run`
Expected: All tests pass (existing + new)

**Step 3: Manual smoke test**

Run: `cd packages/sidekick-ui && pnpm dev`
- Open browser to localhost
- Select a project and session
- Verify transcript panel shows real conversation data
- Verify user messages, assistant messages, tool calls, tool results render
- Verify compaction markers appear
- Verify sidechain entries show with badge

**Step 4: Commit and push**

```
git add packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md
git commit -m "docs: update decision log with D13-D19 for TB3"
git push -u origin feat/tb3-transcript-panel
```
