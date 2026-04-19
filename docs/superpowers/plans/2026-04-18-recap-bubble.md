# Recap Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `away_summary` and compaction `summary` JSONL entries as "Recap" bubbles in the UI timeline and as `[SESSION_RECAP]` annotations in the LLM excerpt.

**Architecture:** Two independent pipelines both need updating: (1) the daemon/LLM path via `transcript-normalizer.ts` + `transcript-excerpt-builder.ts`, and (2) the UI server path via `transcript-api.ts` + `TranscriptLine.tsx`. Task 1 lays shared type foundations; Tasks 2-3 handle the LLM path; Tasks 4-5 handle the UI path. All tasks are independent after Task 1.

**Spec deviation:** The spec proposed a new `RecapBubble.tsx` component, but the codebase pattern is to handle all transcript line types inline in `TranscriptLine.tsx`. This plan follows the existing pattern.

**Tech Stack:** TypeScript, React, Vitest, Tailwind CSS, lucide-react

---

### Task 1: Type Foundations

Add `'recap'` to all type systems. This must land first so subsequent tasks typecheck.

**Files:**
- Modify: `packages/types/src/services/transcript.ts`
- Modify: `packages/sidekick-ui/server/transcript-api.ts`
- Modify: `packages/sidekick-ui/src/types.ts`

- [ ] **Step 1: Update `CanonicalTranscriptEntry` in `packages/types/src/services/transcript.ts`**

  Change line 32 from:
  ```typescript
  type: 'text' | 'tool_use' | 'tool_result'
  ```
  To:
  ```typescript
  type: 'text' | 'tool_use' | 'tool_result' | 'recap'
  ```

  Also add `source` and `leafUuid` to the metadata index signature (the `[key: string]: unknown` already covers these at runtime, but add explicit optional fields for discoverability):
  ```typescript
  metadata: {
    provider: string
    originalId?: string
    lineNumber?: number
    source?: 'compaction' | 'away'
    leafUuid?: string
    [key: string]: unknown
  }
  ```

- [ ] **Step 2: Update `ApiTranscriptLineType` in `packages/sidekick-ui/server/transcript-api.ts`**

  Change line 14-23 by adding `'recap'` to the union:
  ```typescript
  export type ApiTranscriptLineType =
    | 'user-message'
    | 'assistant-message'
    | 'tool-use'
    | 'tool-result'
    | 'compaction'
    | 'recap'
    | 'turn-duration'
    | 'api-error'
    | 'pr-link'
    | TimelineSidekickEventType
  ```

  Add `recapSource` field to `ApiTranscriptLine` interface (after line 41, near the `compaction*` fields):
  ```typescript
  recapSource?: 'compaction' | 'away'
  ```

- [ ] **Step 3: Update `TranscriptLineType` and `TranscriptLine` in `packages/sidekick-ui/src/types.ts`**

  Add `'recap'` to `TranscriptLineType` (after `'compaction'`):
  ```typescript
  export type TranscriptLineType =
    | 'user-message'
    | 'assistant-message'
    | 'tool-use'
    | 'tool-result'
    | 'compaction'
    | 'recap'
    | 'turn-duration'
    | 'api-error'
    | 'pr-link'
    | SidekickEventType
  ```

  Add `recapSource` field to `TranscriptLine` interface (after `compactionTokensAfter`):
  ```typescript
  // recap
  recapSource?: 'compaction' | 'away'
  ```

- [ ] **Step 4: Verify build**

  ```bash
  cd /path/to/worktree && pnpm build 2>&1 | tail -20
  ```
  Expected: build succeeds (types alone don't break anything)

- [ ] **Step 5: Commit**

  ```bash
  git add packages/types/src/services/transcript.ts \
    packages/sidekick-ui/server/transcript-api.ts \
    packages/sidekick-ui/src/types.ts
  git commit -m "feat(types): add 'recap' type for away_summary and compaction summary entries"
  ```

---

### Task 2: Normalizer — Daemon/LLM Path

Extend `normalizeEntry()` to produce `type: 'recap'` canonical entries from raw `summary` and `system/away_summary` JSONL entries.

**Files:**
- Modify: `packages/sidekick-core/src/transcript-normalizer.ts`
- Modify: `packages/sidekick-core/src/__tests__/transcript-normalizer.test.ts`

- [ ] **Step 1: Write failing tests in `transcript-normalizer.test.ts`**

  Add a new `describe` block after the existing `normalizeEntry` tests:

  ```typescript
  describe('normalizeEntry — recap entries', () => {
    it('normalizes summary entry -> type recap, source compaction, preserves leafUuid', () => {
      const raw = {
        type: 'summary',
        uuid: 'sum-uuid-1',
        timestamp: '2026-04-15T10:00:00.000Z',
        summary: 'Working on gitignore migration. Next: choose execution mode.',
        leafUuid: 'leaf-abc-123',
      }
      const result = normalizeEntry(raw as TranscriptEntry, 5)
      expect(result).toHaveLength(1)
      const entry = result![0]
      expect(entry.type).toBe('recap')
      expect(entry.role).toBe('system')
      expect(entry.content).toBe('Working on gitignore migration. Next: choose execution mode.')
      expect(entry.metadata.source).toBe('compaction')
      expect(entry.metadata.leafUuid).toBe('leaf-abc-123')
      expect(entry.metadata.lineNumber).toBe(5)
    })

    it('normalizes system/away_summary entry -> type recap, source away', () => {
      const raw = {
        type: 'system',
        subtype: 'away_summary',
        uuid: 'away-uuid-1',
        timestamp: '2026-04-15T10:05:00.000Z',
        content: 'Waiting for user option choice before merging.',
        isMeta: false,
      }
      const result = normalizeEntry(raw as TranscriptEntry, 10)
      expect(result).toHaveLength(1)
      const entry = result![0]
      expect(entry.type).toBe('recap')
      expect(entry.role).toBe('system')
      expect(entry.content).toBe('Waiting for user option choice before merging.')
      expect(entry.metadata.source).toBe('away')
      expect(entry.metadata.lineNumber).toBe(10)
    })

    it('returns null for system/compact_boundary (regression guard)', () => {
      const raw = {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'cb-uuid-1',
        timestamp: '2026-04-15T10:00:00.000Z',
      }
      expect(normalizeEntry(raw as TranscriptEntry, 3)).toBeNull()
    })

    it('returns null for system/turn_duration (regression guard)', () => {
      const raw = {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td-uuid-1',
        timestamp: '2026-04-15T10:00:00.000Z',
        durationMs: 1234,
      }
      expect(normalizeEntry(raw as TranscriptEntry, 4)).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm --filter @sidekick/core test -- --reporter=verbose transcript-normalizer 2>&1 | tail -20
  ```
  Expected: 4 new tests FAIL

- [ ] **Step 3: Implement `normalizeEntry()` changes in `transcript-normalizer.ts`**

  Insert the following BEFORE the existing early-return guard on line 27 (`if (entryType !== 'user' && ...)`):

  ```typescript
  // Handle compaction summary entries (type: 'summary')
  if (entryType === 'summary') {
    const raw = rawEntry as { uuid?: string; timestamp?: string; summary?: unknown; leafUuid?: unknown }
    const uuid = raw.uuid ?? `line-${lineNumber}`
    const timestamp = new Date(raw.timestamp ?? Date.now())
    return [
      {
        id: uuid,
        timestamp,
        role: 'system',
        type: 'recap',
        content: String(raw.summary ?? ''),
        metadata: {
          provider: 'claude',
          lineNumber,
          source: 'compaction',
          leafUuid: raw.leafUuid as string | undefined,
        },
      },
    ]
  }

  // Handle away_summary system entries (type: 'system', subtype: 'away_summary')
  if (entryType === 'system') {
    const raw = rawEntry as { uuid?: string; timestamp?: string; subtype?: string; content?: unknown }
    if (raw.subtype === 'away_summary') {
      const uuid = raw.uuid ?? `line-${lineNumber}`
      const timestamp = new Date(raw.timestamp ?? Date.now())
      return [
        {
          id: uuid,
          timestamp,
          role: 'system',
          type: 'recap',
          content: String(raw.content ?? ''),
          metadata: {
            provider: 'claude',
            lineNumber,
            source: 'away',
          },
        },
      ]
    }
    return null
  }
  ```

  Also update the comment on the existing early-return guard to reflect the new list of skipped types:
  ```typescript
  // Skip remaining non-message types (file-history-snapshot, attachment, etc.)
  if (entryType !== 'user' && entryType !== 'assistant') {
    return null
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm --filter @sidekick/core test -- --reporter=verbose transcript-normalizer 2>&1 | tail -20
  ```
  Expected: all tests PASS including the 4 new ones

- [ ] **Step 5: Run full core tests (excluding IPC)**

  ```bash
  pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' 2>&1 | tail -10
  ```
  Expected: all pass

- [ ] **Step 6: Commit**

  ```bash
  git add packages/sidekick-core/src/transcript-normalizer.ts \
    packages/sidekick-core/src/__tests__/transcript-normalizer.test.ts
  git commit -m "feat(core): normalize summary and away_summary entries to recap canonical type"
  ```

---

### Task 3: Excerpt Builder — LLM Excerpt Annotation

Add `[SESSION_RECAP]` annotation for `away_summary` raw entries in the LLM excerpt. The existing `case 'summary':` (`[SESSION_HINT]`) is unchanged.

**Files:**
- Modify: `packages/sidekick-core/src/transcript-excerpt-builder.ts`
- Modify: `packages/sidekick-core/src/__tests__/transcript-excerpt-builder.test.ts`

- [ ] **Step 1: Write failing tests in `transcript-excerpt-builder.test.ts`**

  Add to the existing `describe('formatExcerptLine')` block:

  ```typescript
  it('formats system/away_summary as [SESSION_RECAP]', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      content: 'Waiting for user choice before merging.',
      uuid: 'away-1',
      timestamp: '2026-04-15T10:00:00.000Z',
      isMeta: false,
    })
    expect(formatExcerptLine(line, new Set(), {})).toBe(
      '[SESSION_RECAP]: Waiting for user choice before merging.'
    )
  })

  it('returns null for system/stop_hook_summary (regression guard)', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'stop_hook_summary',
      hookCount: 2,
      hookInfos: [],
    })
    expect(formatExcerptLine(line, new Set(), {})).toBeNull()
  })

  it('returns null for system/compact_boundary (regression guard)', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
    })
    expect(formatExcerptLine(line, new Set(), {})).toBeNull()
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm --filter @sidekick/core test -- --reporter=verbose transcript-excerpt-builder 2>&1 | tail -20
  ```
  Expected: 3 new tests FAIL (the regression guards will actually PASS since unknown types return null — verify the first test fails)

- [ ] **Step 3: Add `case 'system':` to `formatExcerptLine` in `transcript-excerpt-builder.ts`**

  Insert before the `default:` case in the `switch (entryType)` block:

  ```typescript
  case 'system': {
    const subtype = (entry as { subtype?: string }).subtype
    if (subtype === 'away_summary') {
      return `[SESSION_RECAP]: ${String((entry as { content?: string }).content ?? '')}`
    }
    return null
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm --filter @sidekick/core test -- --reporter=verbose transcript-excerpt-builder 2>&1 | tail -20
  ```
  Expected: all tests PASS including 3 new ones

- [ ] **Step 5: Commit**

  ```bash
  git add packages/sidekick-core/src/transcript-excerpt-builder.ts \
    packages/sidekick-core/src/__tests__/transcript-excerpt-builder.test.ts
  git commit -m "feat(core): annotate away_summary as [SESSION_RECAP] in LLM excerpt"
  ```

---

### Task 4: Transcript API — UI Server Path

Add `'recap'` line construction from `summary` and `system/away_summary` raw entries in the server API that feeds the UI.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts`
- Modify: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`

- [ ] **Step 1: Write failing tests in `transcript-api.test.ts`**

  Add to the `describe('parseTranscriptLines')` block:

  ```typescript
  it('parses summary entry -> recap with source compaction', async () => {
    setupTranscript(JSON.stringify({
      uuid: 'sum-uuid-1',
      type: 'summary',
      timestamp: DEFAULT_TIMESTAMP,
      sessionId: DEFAULT_SESSION_ID,
      summary: 'Working on gitignore migration.',
      leafUuid: 'leaf-abc',
    }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('recap')
    expect(lines[0].content).toBe('Working on gitignore migration.')
    expect(lines[0].recapSource).toBe('compaction')
  })

  it('parses system/away_summary -> recap with source away', async () => {
    setupTranscript(JSON.stringify({
      uuid: 'away-uuid-1',
      type: 'system',
      subtype: 'away_summary',
      timestamp: DEFAULT_TIMESTAMP,
      sessionId: DEFAULT_SESSION_ID,
      content: 'Waiting for user choice before merging.',
      isMeta: false,
    }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('recap')
    expect(lines[0].content).toBe('Waiting for user choice before merging.')
    expect(lines[0].recapSource).toBe('away')
  })

  it('skips system/stop_hook_summary (regression guard)', async () => {
    setupTranscript(JSON.stringify({
      type: 'system',
      subtype: 'stop_hook_summary',
      hookCount: 1,
      hookInfos: [],
    }))
    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(0)
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose transcript-api 2>&1 | tail -20
  ```
  Expected: first 2 new tests FAIL, regression guard PASS

- [ ] **Step 3: Handle `summary` entries in `parseJsonlContent` switch in `transcript-api.ts`**

  Add a `case 'summary':` to the switch in `parseJsonlContent` (before `default:`):

  ```typescript
  case 'summary':
    lines = [{
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'recap',
      content: String(entry.summary ?? ''),
      recapSource: 'compaction',
    }]
    break
  ```

- [ ] **Step 4: Handle `away_summary` in `processSystemEntry` in `transcript-api.ts`**

  Add a new `if` block in `processSystemEntry` before the final "Unknown system subtype — skip" return (after the `api_error` block):

  ```typescript
  if (subtype === 'away_summary') {
    return [
      {
        id: `transcript-${lineIndex}-0`,
        timestamp,
        type: 'recap',
        content: String(entry.content ?? ''),
        recapSource: 'away',
        ...meta,
      },
    ]
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  ```bash
  pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose transcript-api 2>&1 | tail -20
  ```
  Expected: all tests PASS including 3 new ones

- [ ] **Step 6: Commit**

  ```bash
  git add packages/sidekick-ui/server/transcript-api.ts \
    packages/sidekick-ui/server/__tests__/transcript-api.test.ts
  git commit -m "feat(ui): parse summary and away_summary entries as recap lines in transcript API"
  ```

---

### Task 5: UI Rendering — Recap Bubble in TranscriptLine

Add a `recap` early-return case to `TranscriptLineCard` in `TranscriptLine.tsx`. Import `FileText` and `RotateCcw` icons from lucide-react.

**Files:**
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx`
- Modify: `packages/sidekick-ui/src/components/transcript/__tests__/TranscriptLine.test.tsx`

- [ ] **Step 1: Write failing tests in `TranscriptLine.test.tsx`**

  Add a `describe('recap bubble')` block inside the existing `describe('TranscriptLineCard')`. Use `makeLine()` and `screen` from `@testing-library/react` (both already imported at the top of the test file):

  ```typescript
  describe('recap bubble', () => {
    it('renders away recap with "Recap" label and content', () => {
      const line = makeLine({
        type: 'recap',
        recapSource: 'away',
        content: 'Waiting for user choice.',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Recap')).toBeInTheDocument()
      expect(screen.getByText('Waiting for user choice.')).toBeInTheDocument()
    })

    it('renders compaction recap with "Compaction Summary" label and content', () => {
      const line = makeLine({
        type: 'recap',
        recapSource: 'compaction',
        content: 'Session compacted.',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Compaction Summary')).toBeInTheDocument()
      expect(screen.getByText('Session compacted.')).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose TranscriptLine 2>&1 | tail -20
  ```
  Expected: 2 new tests FAIL

- [ ] **Step 3: Update lucide-react import in `TranscriptLine.tsx`**

  Change the first import line from:
  ```typescript
  import { BookOpen, Scissors, ChevronDown, ChevronRight } from 'lucide-react'
  ```
  To:
  ```typescript
  import { BookOpen, FileText, RotateCcw, Scissors, ChevronDown, ChevronRight } from 'lucide-react'
  ```

- [ ] **Step 4: Add `recap` early-return case in `TranscriptLineCard`**

  Add the following AFTER the `compaction` early-return block (after line 62) and BEFORE the `skill-content` check:

  ```typescript
  // Recap bubble: centered, muted — signals infrastructure metadata, not conversation
  if (line.type === 'recap') {
    const isAway = line.recapSource === 'away'
    const Icon = isAway ? RotateCcw : FileText
    const label = isAway ? 'Recap' : 'Compaction Summary'
    return (
      <div
        onClick={onClick}
        className="flex justify-center px-4 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div className="w-[70%]">
          <div
            className={`rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 ${
              isSelected
                ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
                : isSynced
                  ? 'ring-2 ring-amber-400 dark:ring-amber-500'
                  : ''
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={10} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{label}</span>
              <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">
                {formatTime(line.timestamp)}
              </span>
            </div>
            {line.content && (
              <p className="text-[10px] italic text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                {line.content}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  ```bash
  pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose TranscriptLine 2>&1 | tail -20
  ```
  Expected: all tests PASS including 2 new ones

- [ ] **Step 6: Build and typecheck**

  ```bash
  pnpm build && pnpm typecheck 2>&1 | tail -20
  ```
  Expected: clean build, no type errors

- [ ] **Step 7: Run full test suite (excluding IPC)**

  ```bash
  pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' && pnpm --filter @sidekick/sidekick-ui test 2>&1 | tail -20
  ```
  Expected: all pass

- [ ] **Step 8: Commit**

  ```bash
  git add packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx \
    packages/sidekick-ui/src/components/transcript/__tests__/TranscriptLine.test.tsx
  git commit -m "feat(ui): render recap bubble for away_summary and compaction summary entries"
  ```

---

## Final Verification

After all tasks complete:

```bash
pnpm build && pnpm typecheck && pnpm lint
```

Expected output: zero errors.

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/sidekick-ui test
```

Expected: all tests green.

**Acceptance criteria from spec:**
- `away_summary` entries in a real JSONL transcript appear as Recap bubbles (label: "Recap") in the UI timeline ✓
- Compaction `summary` entries appear as Compaction Summary bubbles (label: "Compaction Summary") in the UI timeline ✓
- `away_summary` content appears in the LLM excerpt as `[SESSION_RECAP]: ...` ✓
- Existing `[SESSION_HINT]` behavior for compaction summaries is unchanged ✓
- All other `system` subtypes continue to be silently dropped ✓
- Build passes. Typecheck passes. Tests pass. ✓
