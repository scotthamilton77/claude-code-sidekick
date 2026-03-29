# Session Summary Deduplication & Decomposition Design

**Bead:** osf
**Date:** 2026-03-29
**Status:** Approved

## Problem

Two issues in `@sidekick/feature-session-summary`:

1. **Duplication:** Snarky/resume message generation is ~80% identical between `update-summary.ts` (periodic) and `on-demand-generation.ts` (IPC). ~210 LOC of copy-pasted load-persona/check-disabled/load-prompt/build-context/call-LLM/write-state pattern.

2. **God function:** `performAnalysis` in `update-summary.ts` is 257 LOC with 19 sub-responsibilities, plus a hand-rolled coalescing guard using module-level mutable state.

## Design

### Section 1: message-generation-core.ts

**File:** `packages/feature-session-summary/src/handlers/message-generation-core.ts`

Extract shared snarky and resume generation into core functions that return discriminated results. Each caller wraps the result with its own policy (logging, error handling, return type).

**Result types:**

```typescript
type SnarkyResult =
  | { status: 'success'; state: SnarkyMessageState }
  | { status: 'skipped'; reason: 'persona_disabled' | 'no_persona' }
  | { status: 'error'; error: Error }

type ResumeResult =
  | { status: 'success'; state: ResumeMessageState }
  | { status: 'deterministic'; state: ResumeMessageState }
  | { status: 'skipped'; reason: 'low_confidence' | 'no_summary' | 'no_persona' }
  | { status: 'error'; error: Error }
```

**Core functions:**

- `generateSnarkyCore(params: SnarkyCoreParams): Promise<SnarkyResult>` — load persona, check disabled, load prompt, build context, interpolate, get LLM profile, call LLM, strip quotes, build state, write state, return result.
- `generateResumeCore(params: ResumeCoreParams): Promise<ResumeResult>` — same pipeline plus: load summary, confidence check, get excerpt, build key phrases.

**Parameter types:**

```typescript
interface SnarkyCoreParams {
  ctx: DaemonContext
  sessionId: string
  summaryState: SessionSummaryStateAccessors
  logger: Logger
}

interface ResumeCoreParams extends SnarkyCoreParams {
  excerptOptions: ExcerptOptions
  transcript: TranscriptService
}
```

**Design rationale:** The core functions take explicit values rather than reaching into `ctx` internally. Callers resolve config-driven vs hard-coded values and pass them in. This keeps the core functions pure-ish and testable without complex context mocking.

**What moves into core:** The ~80% shared pipeline from persona load through state write.

**What stays with callers:**
- Periodic: structured `LogEvents.*()` calls, event emission, void return
- On-demand: write error state on disabled persona, return `GenerationResult` for CLI

### Section 2: performAnalysis Decomposition

The 257-LOC `performAnalysis` becomes a ~40-line orchestrator calling 6 named step functions. Each step is an **exported function in the same file** (specific to the periodic analysis flow, but exported for direct unit testing).

**Step functions:**

| Function | Responsibility | Input | Output |
|----------|---------------|-------|--------|
| `loadAnalysisInputs` | Load config, current summary, transcript excerpt, prompt template, JSON schema, build previous context | ctx, summaryState, transcript | `{ currentSummary, excerpt, previousContext, prompt, schema }` |
| `callSummaryLLM` | Create provider, call LLM, parse and validate response | ctx, prompt, schema, config | `{ parsedResponse, tokenCount }` |
| `updateSummaryState` | Merge LLM response with current state, compute stats, persist | summaryState, parsedResponse, currentSummary | `updatedSummary` |
| `resetCountdown` | Apply confidence-based countdown thresholds, update bookmark, persist | summaryState, config, updatedSummary | void |
| `orchestrateSideEffects` | Spawn snarky + resume generation in parallel via core functions | ctx, sessionId, summaryState, config, transcript | void |
| `emitAnalysisEvents` | Emit title-changed, intent-changed, summary-finish events | ctx, previousSummary, updatedSummary, stats | void |

**Orchestrator shape:**

```typescript
async function performAnalysis(ctx, sessionId, summaryState, reason) {
  // Emit start event
  const inputs = await loadAnalysisInputs(...)
  const llmResult = await callSummaryLLM(...)
  const updated = await updateSummaryState(...)
  await resetCountdown(...)
  await orchestrateSideEffects(...)
  emitAnalysisEvents(...)
  // Emit finish event
}
```

The coalescing guard (Section 3) wraps the call to `performAnalysis`, not the function itself.

**Testing strategy:**
- **New unit tests** for each step function — tested in isolation with controlled inputs
- **Existing `performAnalysis` tests remain** — validate end-to-end orchestration as regression safety net

### Section 3: CoalescingGuard\<K\> Utility

**File:** `packages/sidekick-core/src/coalescing-guard.ts`
**Re-exported from:** `@sidekick/core` barrel

Generic utility replacing the hand-rolled `analysisInFlight` Map and `resetAnalysisGuard()` test helper.

**Behavior:** At most one execution per key at a time. If a second request arrives while one is in-flight, it's coalesced — the in-flight one finishes, then runs exactly once more. Third+ requests during that window are dropped (already have a pending rerun).

```typescript
class CoalescingGuard<K = string> {
  private inflight = new Map<K, boolean>()  // value = rerunPending

  async run(key: K, fn: () => Promise<void>): Promise<boolean> {
    if (this.inflight.has(key)) {
      this.inflight.set(key, true)
      return false
    }
    this.inflight.set(key, false)
    try {
      await fn()
    } finally {
      const rerunPending = this.inflight.get(key)
      this.inflight.delete(key)
      if (rerunPending) {
        await this.run(key, fn)
      }
    }
    return true
  }
}
```

**Tests:**
- Concurrent calls with same key: second coalesces, fn runs exactly twice
- Concurrent calls with different keys: both execute independently
- Three rapid calls: fn runs exactly twice (third coalesces into existing pending)
- fn throws: guard cleans up, next call works normally

**Usage in update-summary.ts:**

```typescript
const analysisGuard = new CoalescingGuard<string>()

// In updateSessionSummary:
await analysisGuard.run(sessionId, () => performAnalysis(...))
```

Eliminates: `analysisInFlight` Map, `resetAnalysisGuard()`, and finally-block rerun logic.

### Section 4: Integration — Caller Changes

**`update-summary.ts` (periodic):**

- `generateSnarkyMessage()` (87 LOC) becomes ~15 LOC thin wrapper calling `generateSnarkyCore()`, wrapping result with structured event logging
- `generateResumeMessage()` (155 LOC) becomes ~20 LOC thin wrapper calling `generateResumeCore()`, resolving excerpt options from config
- `performAnalysis()` (257 LOC) becomes ~40 LOC orchestrator calling 6 named steps
- `analysisInFlight` Map and `resetAnalysisGuard()` deleted
- `interpolateTemplate()` stays (already exported, already imported by on-demand)

**`on-demand-generation.ts`:**

- `generateSnarkyMessageOnDemand()` (96 LOC) becomes ~15 LOC thin wrapper calling `generateSnarkyCore()`, handling `skipped` by writing error state
- `generateResumeMessageOnDemand()` (125 LOC) becomes ~20 LOC thin wrapper calling `generateResumeCore()`, passing hard-coded excerpt options
- `setSessionPersona()` unchanged (no duplication, independent concern)

**Net LOC impact:**

| File | Before | After | Delta |
|------|--------|-------|-------|
| message-generation-core.ts (new) | 0 | ~180 | +180 |
| coalescing-guard.ts (new) | 0 | ~30 | +30 |
| update-summary.ts | 828 | ~450 | -378 |
| on-demand-generation.ts | 322 | ~140 | -182 |
| New test files | 0 | ~300 | +300 |
| **Net code** | 1,150 | ~800 | **-350** |

Duplication drops from ~210 LOC to zero. `performAnalysis` drops from 257 LOC to ~40. Each caller becomes a thin policy layer on top of shared mechanics.

## Execution Order

1. Extract `CoalescingGuard<K>` into `@sidekick/core` with tests
2. Extract `message-generation-core.ts` with `generateSnarkyCore` and `generateResumeCore`, with tests
3. Refactor `update-summary.ts`: decompose `performAnalysis` into 6 steps, replace snarky/resume with thin wrappers, replace `analysisInFlight` with `CoalescingGuard`
4. Refactor `on-demand-generation.ts`: replace snarky/resume with thin wrappers
5. Delete `analysisInFlight` Map and `resetAnalysisGuard()` test helper
6. Verify all existing tests pass

## Acceptance Criteria

- `CoalescingGuard<K>` in `@sidekick/core` with unit tests
- `message-generation-core.ts` with `generateSnarkyCore`/`generateResumeCore` and unit tests
- `performAnalysis` decomposed into 6 named step functions with unit tests
- Existing snarky/resume generation callers reduced to thin wrappers
- ~210 LOC of duplication eliminated
- All existing session-summary tests pass
- Build passes. Typecheck passes. Lint passes.
