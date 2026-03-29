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
  | { status: 'skipped'; reason: 'persona_disabled' | 'prompt_not_found' }
  | { status: 'error'; error: Error }

type ResumeResult =
  | { status: 'success'; state: ResumeMessageState }
  | { status: 'deterministic'; state: ResumeMessageState }
  | { status: 'skipped'; reason: 'low_confidence' | 'no_summary' | 'prompt_not_found' }
  | { status: 'error'; error: Error }
```

**Note:** Null persona is not a skip reason — both handlers proceed with `buildPersonaContext(null)`, which yields `persona: false` and omits persona blocks from the prompt via `{{#if persona}}`.

**Core functions:**

- `generateSnarkyCore(params: SnarkyCoreParams): Promise<SnarkyResult>` — load persona, check disabled, load prompt, build context, interpolate, get LLM profile, call LLM, strip quotes, build state, write state, return result.
- `generateResumeCore(params: ResumeCoreParams): Promise<ResumeResult>` — same pipeline plus: load summary, confidence check, get excerpt, build key phrases.

**Parameter types:**

```typescript
interface SnarkyCoreParams {
  ctx: DaemonContext
  sessionId: string
  summaryState: SessionSummaryStateAccessors
  summary: SessionSummaryState       // current analysis result for prompt interpolation
  config: SessionSummaryConfig       // LLM profile selection, maxSnarkyWords, flags
  logger: Logger
}

interface ResumeCoreParams extends SnarkyCoreParams {
  excerptOptions: ExcerptOptions     // periodic: config-driven, on-demand: hard-coded
  transcript: TranscriptService      // for getExcerpt()
}
```

**Design rationale:** Core functions still depend on `ctx` for asset resolution (`ctx.assets.resolve()`), profile factory (`ctx.profileFactory`), and config access. They are not pure functions — they perform I/O (LLM calls, state writes). The value of extraction is deduplication and consistent behavior, not purity. Callers resolve caller-specific values (`summary`, `config`, `excerptOptions`) and pass them in explicitly.

**What moves into core:** The ~80% shared pipeline from persona load through state write.

**What stays with callers:**
- Periodic: structured `LogEvents.*()` calls, event emission, void return
- On-demand: return `GenerationResult` for CLI, `{ success: false }` on skip/error

### Section 2: performAnalysis Decomposition

The 257-LOC `performAnalysis` becomes a ~40-line orchestrator calling 6 named step functions. Each step is an **exported function in the same file** (specific to the periodic analysis flow, but exported for direct unit testing).

**Step functions:**

| Function | Responsibility | Input | Output |
|----------|---------------|-------|--------|
| `loadAnalysisInputs` | Load config, current summary, transcript excerpt (using countdown bookmark), prompt template, JSON schema, build previous context | ctx, summaryState, transcript, countdown | `{ config, currentSummary, excerpt, previousContext, prompt, schema }` |
| `callSummaryLLM` | Create provider, call LLM, parse and validate response | ctx, prompt, schema, config | `{ parsedResponse, tokenCount }` |
| `updateSummaryState` | Merge LLM response with current state, compute stats, persist | summaryState, parsedResponse, currentSummary | `updatedSummary` |
| `resetCountdown` | Apply confidence-based countdown thresholds, update bookmark (uses lineNumber for high-confidence, countdown.bookmark_line for medium), persist | summaryState, config, updatedSummary, lineNumber, countdown | void |
| `orchestrateSideEffects` | Conditionally spawn snarky + resume generation in parallel via core functions. Gated by: `hasSignificantChange()`, `isInitialAnalysis`, `config.snarkyMessages`, `resumeMessageExists()`, `pivot_detected` | ctx, eventContext, sessionId, summaryState, config, transcript, currentSummary, updatedSummary | void |
| `emitAnalysisEvents` | Emit title-changed, intent-changed, summary-finish events via EventContext | eventContext, currentSummary, updatedSummary, stats | void |

**Note:** `event: TranscriptEvent` flows through the orchestrator. It provides `event.context` (EventContext) for structured event emission and `event.payload.lineNumber` for bookmark updates.

**Orchestrator shape:**

```typescript
async function performAnalysis(event, ctx, summaryState, countdown, reason) {
  const { context: eventContext, payload } = event
  // Emit start event
  const inputs = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown)
  const llmResult = await callSummaryLLM(ctx, inputs.prompt, inputs.schema, inputs.config)
  const updated = await updateSummaryState(summaryState, llmResult.parsedResponse, inputs.currentSummary)
  await resetCountdown(summaryState, inputs.config, updated, payload.lineNumber, countdown)
  await orchestrateSideEffects(ctx, eventContext, sessionId, summaryState, inputs.config, ctx.transcript, inputs.currentSummary, updated)
  emitAnalysisEvents(eventContext, inputs.currentSummary, updated, { tokenCount: llmResult.tokenCount, ... })
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
    let succeeded = false
    try {
      await fn()
      succeeded = true
    } finally {
      const rerunPending = this.inflight.get(key)
      this.inflight.delete(key)
      if (rerunPending && succeeded) {
        // Fire-and-forget: matches current behavior where rerun is `void performAnalysis(...)`
        void this.run(key, fn)
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
- fn throws: guard cleans up, pending rerun is suppressed, next call works normally

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

- `generateSnarkyMessageOnDemand()` (96 LOC) becomes ~15 LOC thin wrapper calling `generateSnarkyCore()`, returning `{ success: false }` on skip/error
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
