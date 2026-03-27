# Rename DecisionRecordedPayload.detail → subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `DecisionRecordedPayload.detail` to `subsystem`, make `title` required, and wire `subsystem` into the UI transcript parser so the field is actually consumed.

**Architecture:** Straightforward rename across the type definition, emission sites, transcript parser, and UI. Two interface layers: server-side `ApiTranscriptLine` and client-side `TranscriptLine` both need the new field. Old log entries use `detail`; parser falls back via `??`.

**Tech Stack:** TypeScript, Vitest, React (DecisionDetail component)

**Spec:** `docs/superpowers/specs/2026-03-26-rename-detail-to-subsystem-design.md`

---

### Task 1: Update type definition and type tests (TDD)

**Files:**
- Modify: `packages/types/src/events.ts:928-933`
- Modify: `packages/types/src/__tests__/canonical-events.test.ts:197-201`

- [ ] **Step 1: Update the type test to expect `subsystem` and required `title`**

```typescript
it('DecisionRecordedPayload has correct fields', () => {
  expectTypeOf<DecisionRecordedPayload>().toHaveProperty('decision')
  expectTypeOf<DecisionRecordedPayload>().toHaveProperty('reason')
  expectTypeOf<DecisionRecordedPayload>().toHaveProperty('subsystem')
  expectTypeOf<DecisionRecordedPayload>().toHaveProperty('title')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/types test -- --run canonical-events`
Expected: FAIL — `subsystem` does not exist on `DecisionRecordedPayload`

- [ ] **Step 3: Update the type definition**

In `packages/types/src/events.ts:928-933`, change:

```typescript
/** Payload for `decision:recorded` — an LLM decision was captured. */
export interface DecisionRecordedPayload {
  decision: string
  reason: string
  subsystem: string
  title: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/types test -- --run canonical-events`
Expected: PASS

- [ ] **Step 5: Run typecheck to see what breaks**

Run: `pnpm typecheck`
Expected: FAIL — compile errors at all 5 emission sites and 3 event factory tests (they still use `detail` and some omit `title`)

---

### Task 2: Update event factory tests and emission sites

**Files:**
- Modify: `packages/feature-session-summary/src/__tests__/events.test.ts:142-196`
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts:123-191` (5 sites)

- [ ] **Step 1: Update event factory test payloads**

In `events.test.ts`, update all three test cases to use `subsystem` and include `title`:

Test at line 145-149:
```typescript
{
  decision: 'calling',
  reason: 'UserPrompt event forces immediate analysis',
  subsystem: 'session-summary',
  title: 'Run session analysis',
}
```

Test at line 164-168:
```typescript
{
  decision: 'skipped',
  reason: 'countdown not reached (5 tool results remaining)',
  subsystem: 'session-summary',
  title: 'Defer session analysis',
}
```

Test at line 184-188:
```typescript
{
  decision: 'calling',
  reason: 'countdown reached zero',
  subsystem: 'session-summary',
  title: 'Run session analysis',
}
```

Also update assertion at line 158:
```typescript
expect(event.payload.subsystem).toBe('session-summary')
```

- [ ] **Step 2: Run event factory tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run events`
Expected: FAIL — `detail` no longer exists on the type

- [ ] **Step 3: Update all 5 emission sites in update-summary.ts**

Replace `detail: 'session-summary analysis'` with `subsystem: 'session-summary'` at lines 126, 138, 157, 172, 187.

- [ ] **Step 4: Run event factory tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run events`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(types): rename DecisionRecordedPayload.detail to subsystem, make title required
```

---

### Task 3: Update event emission tests

**Files:**
- Modify: `packages/feature-session-summary/src/__tests__/event-emission.test.ts:247,281`

- [ ] **Step 1: Update emission test assertions**

Line 247: `expect(decisionLogs[0].meta?.detail)` → `expect(decisionLogs[0].meta?.subsystem)`
Line 281: `expect(decisionLogs[0].meta?.detail)` → `expect(decisionLogs[0].meta?.subsystem)`

Both should assert `.toBe('session-summary')`.

- [ ] **Step 2: Run emission tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --run event-emission`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(session-summary): update emission tests for detail→subsystem rename
```

---

### Task 4: Wire subsystem into transcript parser (TDD)

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts:69-73` (ApiTranscriptLine type)
- Modify: `packages/sidekick-ui/server/transcript-api.ts:400-402` (parser logic)
- Modify: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts:715-761`

- [ ] **Step 1: Add `decisionSubsystem` test assertion to existing test**

In the test at line 715 ("maps decision:recorded with title to decisionTitle"), add `subsystem` to the mock payload and assert it:

```typescript
payload: { title: 'Skip session analysis', decision: 'skipped', reason: 'no user turns', subsystem: 'session-summary' },
```

After line 736, add:
```typescript
expect(decisionLine!.decisionSubsystem).toBe('session-summary')
```

- [ ] **Step 2: Add test for old log fallback (detail → subsystem)**

Add a new test after the existing decision tests:

```typescript
it('maps decision:recorded with legacy detail field to decisionSubsystem', async () => {
  setupTranscript(makeUserEntry('Hello'))

  mockFindLogFiles.mockImplementation((dir: string, prefix: string) => {
    if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
    return Promise.resolve([])
  })
  mockReadLogFile.mockResolvedValue([
    {
      time: new Date('2025-01-15T10:30:01.000Z').getTime(),
      type: 'decision:recorded',
      context: { sessionId: 'session-1' },
      payload: { title: 'Skip session analysis', decision: 'skipped', reason: 'no user turns', detail: 'session-summary analysis' },
    },
  ])

  const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
  const decisionLine = lines.find((l) => l.type === 'decision:recorded')
  expect(decisionLine!.decisionSubsystem).toBe('session-summary analysis')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/ui test -- --run transcript-api`
Expected: FAIL — `decisionSubsystem` not defined on type, not set by parser

- [ ] **Step 4: Add `decisionSubsystem` to `ApiTranscriptLine` type**

In `transcript-api.ts` after line 73 (`decisionReasoning`), add:

```typescript
decisionSubsystem?: string
```

- [ ] **Step 5: Add parser extraction with fallback**

In `transcript-api.ts` after line 402 (`decisionReasoning` extraction), add:

```typescript
line.decisionSubsystem = (payload.subsystem ?? payload.detail) as string | undefined
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/ui test -- --run transcript-api`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat(ui): wire decisionSubsystem into transcript parser with legacy fallback
```

---

### Task 5: Add `decisionSubsystem` to client-side types and UI

**Files:**
- Modify: `packages/sidekick-ui/src/types.ts:84-87`
- Modify: `packages/sidekick-ui/src/components/detail/DecisionDetail.tsx`
- Modify: `packages/sidekick-ui/src/data/mock-data.ts` (6 decision entries)

- [ ] **Step 1: Add `decisionSubsystem` to client-side `TranscriptLine` type**

In `packages/sidekick-ui/src/types.ts`, after line 87 (`decisionReasoning`), add:

```typescript
decisionSubsystem?: string
```

- [ ] **Step 2: Add subsystem badge to DecisionDetail component**

In `DecisionDetail.tsx`, add a subsystem badge after the existing category badge block (after line 23):

```tsx
{line.decisionSubsystem && (
  <div>
    <h3 className="text-[10px] font-medium text-slate-500 mb-1">Subsystem</h3>
    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded font-medium">
      {line.decisionSubsystem}
    </span>
  </div>
)}
```

- [ ] **Step 3: Add `decisionSubsystem` to mock data**

Add `decisionSubsystem: 'session-summary'` to each of the 6 decision entries in `mock-data.ts` (lines 103, 297, 401, 589, 740, 903).

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(ui): display decisionSubsystem badge in DecisionDetail panel
```

---

### Task 6: Full verification

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run full lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Run all tests (excluding IPC)**

Run: `pnpm --filter @sidekick/types test -- --run && pnpm --filter @sidekick/feature-session-summary test -- --run && pnpm --filter @sidekick/ui test -- --run`
Expected: All PASS

- [ ] **Step 5: Final commit if any lint fixes needed, then push branch and open PR**
