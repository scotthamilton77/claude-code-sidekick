# Session Summary Dedup & Decompose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~210 LOC of duplicated snarky/resume generation between `update-summary.ts` and `on-demand-generation.ts`, decompose `performAnalysis` (257 LOC) into 6 named step functions, and extract a reusable `CoalescingGuard<K>` utility.

**Architecture:** Extract shared generation pipelines into `message-generation-core.ts` with discriminated result types. Core functions return results; callers wrap with their own policy (logging, error handling). Extract hand-rolled coalescing pattern into a generic `CoalescingGuard<K>` class in `@sidekick/core`.

**Tech Stack:** TypeScript, Vitest 4.x, `@sidekick/testing-fixtures` for mock context

**Spec:** `docs/superpowers/specs/2026-03-29-session-summary-dedup-decompose-design.md`

**Bead:** osf

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/sidekick-core/src/coalescing-guard.ts` | Generic CoalescingGuard<K> utility |
| Create | `packages/sidekick-core/src/__tests__/coalescing-guard.test.ts` | CoalescingGuard unit tests |
| Modify | `packages/sidekick-core/src/index.ts` | Re-export CoalescingGuard |
| Create | `packages/feature-session-summary/src/handlers/message-generation-core.ts` | Shared generateSnarkyCore / generateResumeCore |
| Create | `packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts` | Core function unit tests |
| Modify | `packages/feature-session-summary/src/handlers/update-summary.ts` | Thin wrappers + decomposed performAnalysis |
| Modify | `packages/feature-session-summary/src/handlers/on-demand-generation.ts` | Thin wrappers calling core |
| Modify | `packages/feature-session-summary/src/handlers/__tests__/update-summary.test.ts` | Update resetAnalysisGuard → CoalescingGuard |
| Create | `packages/feature-session-summary/src/handlers/__tests__/analysis-steps.test.ts` | Unit tests for decomposed step functions |

---

## Task 1: CoalescingGuard<K> — TDD

**Files:**
- Create: `packages/sidekick-core/src/coalescing-guard.ts`
- Create: `packages/sidekick-core/src/__tests__/coalescing-guard.test.ts`
- Modify: `packages/sidekick-core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/sidekick-core/src/__tests__/coalescing-guard.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CoalescingGuard } from '../coalescing-guard.js'

describe('CoalescingGuard', () => {
  it('executes fn and returns true for a single call', async () => {
    const guard = new CoalescingGuard<string>()
    const fn = vi.fn().mockResolvedValue(undefined)
    const result = await guard.run('key1', fn)
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent calls with same key — fn runs exactly twice', async () => {
    const guard = new CoalescingGuard<string>()
    let resolveFirst!: () => void
    const barrier = new Promise<void>((r) => { resolveFirst = r })
    let callCount = 0
    const fn = vi.fn(async () => {
      callCount++
      if (callCount === 1) await barrier // block first call
    })

    const p1 = guard.run('key1', fn)
    const coalesced = await guard.run('key1', fn)
    expect(coalesced).toBe(false) // second call was coalesced

    resolveFirst() // unblock first call
    await p1
    // Wait for fire-and-forget rerun to settle
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('executes independently for different keys', async () => {
    const guard = new CoalescingGuard<string>()
    const fn1 = vi.fn().mockResolvedValue(undefined)
    const fn2 = vi.fn().mockResolvedValue(undefined)

    const [r1, r2] = await Promise.all([
      guard.run('key1', fn1),
      guard.run('key2', fn2),
    ])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })

  it('three rapid calls — fn runs exactly twice (third coalesces into pending)', async () => {
    const guard = new CoalescingGuard<string>()
    let resolveFirst!: () => void
    const barrier = new Promise<void>((r) => { resolveFirst = r })
    let callCount = 0
    const fn = vi.fn(async () => {
      callCount++
      if (callCount === 1) await barrier
    })

    const p1 = guard.run('key1', fn)
    const r2 = await guard.run('key1', fn)
    const r3 = await guard.run('key1', fn)
    expect(r2).toBe(false)
    expect(r3).toBe(false)

    resolveFirst()
    await p1
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(fn).toHaveBeenCalledTimes(2) // not 3
  })

  it('cleans up on error — suppresses pending rerun, next call works', async () => {
    const guard = new CoalescingGuard<string>()
    const error = new Error('boom')
    let callCount = 0
    const failingFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw error
    })

    // First call throws, second is coalesced
    const p1 = guard.run('key1', failingFn)
    const coalesced = await guard.run('key1', failingFn)
    expect(coalesced).toBe(false)

    await expect(p1).rejects.toThrow('boom')
    await new Promise<void>((r) => setTimeout(r, 10))
    // Rerun was suppressed because first call failed
    expect(failingFn).toHaveBeenCalledTimes(1)

    // Guard is clean — next call works normally
    const successFn = vi.fn().mockResolvedValue(undefined)
    const result = await guard.run('key1', successFn)
    expect(result).toBe(true)
    expect(successFn).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- coalescing-guard`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoalescingGuard**

```typescript
// packages/sidekick-core/src/coalescing-guard.ts

/**
 * Coalescing concurrency guard: at most one execution per key at a time.
 * If a second request arrives while one is in-flight, it marks a pending rerun.
 * Third+ requests during that window are dropped (already have a pending rerun).
 * On success, pending rerun fires as fire-and-forget. On error, rerun is suppressed.
 */
export class CoalescingGuard<K = string> {
  private inflight = new Map<K, boolean>()

  /** Reset all in-flight state. For use in test teardown. */
  clear(): void {
    this.inflight.clear()
  }

  /** Run fn with coalescing. Returns true if executed, false if coalesced into pending. */
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
        void this.run(key, fn)
      }
    }
    return true
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- coalescing-guard`
Expected: All 5 tests PASS

- [ ] **Step 5: Add re-export to barrel**

Modify `packages/sidekick-core/src/index.ts` — add after the last export line:

```typescript
export { CoalescingGuard } from './coalescing-guard'
```

- [ ] **Step 6: Verify build**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/sidekick-core/src/coalescing-guard.ts \
       packages/sidekick-core/src/__tests__/coalescing-guard.test.ts \
       packages/sidekick-core/src/index.ts
git commit -m "feat(core): add CoalescingGuard<K> utility for concurrent request coalescing"
```

---

## Task 2: message-generation-core.ts — Types & Snarky Core (TDD)

**Files:**
- Create: `packages/feature-session-summary/src/handlers/message-generation-core.ts`
- Create: `packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts`

**Reference files to read first:**
- `packages/feature-session-summary/src/handlers/update-summary.ts:573-659` (generateSnarkyMessage)
- `packages/feature-session-summary/src/handlers/on-demand-generation.ts:97-192` (generateSnarkyMessageOnDemand)
- `packages/feature-session-summary/src/handlers/persona-utils.ts` (shared utils)
- `packages/feature-session-summary/src/types.ts` (SessionSummaryConfig, GenerationResult)
- `packages/feature-session-summary/src/handlers/__tests__/on-demand-generation.test.ts` (mock patterns)

- [ ] **Step 1: Create types and generateSnarkyCore skeleton**

Create `packages/feature-session-summary/src/handlers/message-generation-core.ts` with:
- `SnarkyResult` discriminated union type (success | skipped | error)
- `ResumeResult` discriminated union type (success | deterministic | skipped | error)
- `SnarkyCoreParams` interface (ctx, sessionId, summaryState, summary, config, logger)
- `ResumeCoreParams` interface extending SnarkyCoreParams (+ excerptOptions, transcript)
- `generateSnarkyCore()` function — extract the shared pipeline from `update-summary.ts:573-659`:
  1. `loadSessionPersona()` from persona-utils
  2. Check persona disabled → return `{ status: 'skipped', reason: 'persona_disabled' }`
  3. Load prompt template via `ctx.assets.resolve('prompts/snarky-message.prompt.txt')`
     - If null → return `{ status: 'skipped', reason: 'prompt_not_found' }`
  4. `buildPersonaContext()` + `loadUserProfileContext()`
  5. `interpolateTemplate()` (import from `./update-summary.js`)
  6. `getEffectiveProfile()` for LLM profile resolution
  7. Create provider via `ctx.profileFactory.createForProfile()`
  8. Call `provider.complete()` with interpolated prompt
  9. `stripSurroundingQuotes()` on response
  10. Build `SnarkyMessageState` object
  11. Write via `summaryState.snarkyMessage.write()`
  12. Return `{ status: 'success', state }`
  13. Catch errors → return `{ status: 'error', error }`

**Event emission in core vs callers:** The `SessionSummaryEvents.snarkyMessageStart()` and `snarkyMessageFinish()` events are identical in both callers — move these INTO `generateSnarkyCore` to avoid re-duplicating them. Only caller-specific events stay with callers: periodic does `ctx.logger.debug()` after success, on-demand has no additional events.

**Profile error handling:** When `getEffectiveProfile()` returns `{ errorMessage }`, the core should return `{ status: 'error', error: new Error(errorMessage) }`. The periodic wrapper can then write the error as snarky state if desired; the on-demand wrapper returns `{ success: false }`.

- [ ] **Step 2: Write failing test for generateSnarkyCore**

Create `packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts`:
- Use `@sidekick/testing-fixtures` mocks (same pattern as on-demand-generation.test.ts)
- Test: success path — persona enabled, prompt found, LLM returns text → result is `{ status: 'success', state }` with state written
- Test: skipped — persona disabled → `{ status: 'skipped', reason: 'persona_disabled' }`
- Test: skipped — prompt not found → `{ status: 'skipped', reason: 'prompt_not_found' }`
- Test: error — LLM throws → `{ status: 'error', error }`
- Test: error — invalid LLM profile (getEffectiveProfile returns errorMessage) → `{ status: 'error', error }`
- Test: null persona proceeds (buildPersonaContext(null) is valid, not a skip)

Use `@sidekick/testing-fixtures` mocks: `createMockDaemonContext`, `MockLogger`, `MockLLMService`, `MockAssetResolver`, `MockStateService`, `MockTranscriptService`, `MockProfileProviderFactory`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-session-summary test -- message-generation-core`
Expected: FAIL — function returns wrong/no result

- [ ] **Step 4: Implement generateSnarkyCore**

Fill in the function body by extracting the shared logic from `update-summary.ts:573-659` and `on-demand-generation.ts:97-192`. Both files follow the same sequence — take the common parts, parameterize the differences.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-session-summary test -- message-generation-core`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/feature-session-summary/src/handlers/message-generation-core.ts \
       packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts
git commit -m "feat(session-summary): add generateSnarkyCore with discriminated result types"
```

---

## Task 3: generateResumeCore (TDD)

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/message-generation-core.ts`
- Modify: `packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts`

**Reference files to read first:**
- `packages/feature-session-summary/src/handlers/update-summary.ts:674-828` (generateResumeMessage)
- `packages/feature-session-summary/src/handlers/on-demand-generation.ts:198-322` (generateResumeMessageOnDemand)

- [ ] **Step 1: Write failing tests for generateResumeCore**

Add to `message-generation-core.test.ts`:
- Test: success path — summary with sufficient confidence, persona enabled, LLM returns text → `{ status: 'success', state }` with persona_id/persona_display_name in state
- Test: deterministic — persona disabled → uses title + intent as message, returns `{ status: 'deterministic', state }`
- Test: skipped — low confidence → `{ status: 'skipped', reason: 'low_confidence' }`
- Test: skipped — prompt not found → `{ status: 'skipped', reason: 'prompt_not_found' }`
- Test: error — LLM throws → `{ status: 'error', error }`
- Test: key phrases built from `summary.session_title_key_phrases` (joined with ', ')

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-session-summary test -- message-generation-core`
Expected: New tests FAIL

- [ ] **Step 3: Implement generateResumeCore**

Add to `message-generation-core.ts`. Extract shared logic from `update-summary.ts:674-828` and `on-demand-generation.ts:198-322`.

**Event emission:** The resume path has NO `SessionSummaryEvents` — only `LogEvents.resumeGenerating()`/`resumeUpdated()`/`resumeSkipped()`, which are periodic-only (on-demand doesn't emit them). All resume `LogEvents` stay in the periodic wrapper.

**Transcript excerpt note:** The core calls `transcript.getExcerpt(excerptOptions)` directly. This is a behavior change from the periodic path, which previously reused the excerpt already extracted for the main analysis. The periodic wrapper now passes config-driven options that produce an equivalent excerpt.

1. Check `summary.session_title_confidence < RESUME_MIN_CONFIDENCE || summary.latest_intent_confidence < RESUME_MIN_CONFIDENCE` → return `{ status: 'skipped', reason: 'low_confidence' }` (note: uses OR on individual fields, NOT an average)
2. `loadSessionPersona()`
3. If persona disabled → build deterministic message from `summary.session_title` + `summary.latest_intent`, write state, return `{ status: 'deterministic', state }`
4. Load prompt template, build persona context, user profile context
5. Get transcript excerpt via `params.transcript.getExcerpt(params.excerptOptions)`
6. Build key phrases from summary
7. `interpolateTemplate()` with all variables
8. `getEffectiveProfile()` for resume message profile
9. Create provider, call LLM, strip quotes
10. Build `ResumeMessageState` with `persona_id` and `persona_display_name`
11. Write state, return `{ status: 'success', state }`
12. Catch errors → return `{ status: 'error', error }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-session-summary test -- message-generation-core`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/feature-session-summary/src/handlers/message-generation-core.ts \
       packages/feature-session-summary/src/handlers/__tests__/message-generation-core.test.ts
git commit -m "feat(session-summary): add generateResumeCore with confidence checks and deterministic fallback"
```

---

## Task 4: Decompose performAnalysis into Step Functions

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts`
- Create: `packages/feature-session-summary/src/handlers/__tests__/analysis-steps.test.ts`

**Reference:** Read `update-summary.ts:263-519` (performAnalysis) carefully before starting.

- [ ] **Step 1: Write tests for step functions**

Create `analysis-steps.test.ts` with tests for each exported step:

**`loadAnalysisInputs`:**
- Test: loads config, summary, excerpt, prompt template, schema, builds previousContext JSON string
- Test: passes countdown.bookmark_line to excerpt options
- Test: returns null prompt when asset not found (caller handles)

**`updateSummaryState`:**
- Test: merges LLM response fields into existing summary
- Test: computes stats (analysis_count increment, tokens_used accumulation)
- Test: persists updated summary via summaryState.summary.write()

**`resetCountdown`:**
- Test: high confidence → sets bookmark_line to lineNumber, resets countdown to highConfidence config
- Test: low confidence → resets bookmark_line to 0, sets countdown to lowConfidence config
- Test: medium confidence → preserves existing bookmark_line, sets countdown to mediumConfidence config

**`emitAnalysisEvents`:**
- Test: emits title-changed when title differs from previous
- Test: emits intent-changed when intent differs from previous
- Test: does not emit change events when unchanged
- Test: always emits summary-finish with stats

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-session-summary test -- analysis-steps`
Expected: FAIL — functions not found

- [ ] **Step 3: Extract step functions from performAnalysis**

In `update-summary.ts`, extract from `performAnalysis` (lines 263-519):

1. **`loadAnalysisInputs()`** — extract lines ~304-356 (config loading, summary loading, excerpt, prompt, schema, previous context)
2. **`callSummaryLLM()`** — extract lines ~359-380 (provider creation, LLM call, response parsing)
3. **`updateSummaryState()`** — extract lines ~383-402 (merge response, compute stats, persist)
4. **`resetCountdown()`** — extract lines ~405-431 (confidence thresholds, bookmark logic, persist)
5. **`orchestrateSideEffects()`** — extract lines ~435-456 (gating checks, parallel snarky/resume generation)
6. **`emitAnalysisEvents()`** — extract lines ~459-493 (title-changed, intent-changed, summary-finish events)

Export all 6 functions for direct testing. Keep them in the same file — they are specific to the periodic analysis flow.

Rewrite `performAnalysis` as a ~40-line orchestrator calling these steps in sequence. The function signature stays the same: `performAnalysis(event, ctx, summaryState, countdown, reason)`.

**Critical:** Do NOT change the existing `updateSessionSummary()` function yet — that happens in Task 5. This task only decomposes `performAnalysis` internals.

- [ ] **Step 4: Run step function tests**

Run: `pnpm --filter @sidekick/feature-session-summary test -- analysis-steps`
Expected: All new tests PASS

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: All tests PASS (including existing update-summary.test.ts)

- [ ] **Step 6: Commit**

```bash
git add packages/feature-session-summary/src/handlers/update-summary.ts \
       packages/feature-session-summary/src/handlers/__tests__/analysis-steps.test.ts
git commit -m "refactor(session-summary): decompose performAnalysis into 6 named step functions"
```

---

## Task 5: Wire update-summary.ts — Core Functions + CoalescingGuard

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts`
- Modify: `packages/feature-session-summary/src/handlers/__tests__/update-summary.test.ts`

**This is the integration task for the periodic path.**

- [ ] **Step 1: Replace generateSnarkyMessage with thin wrapper**

Replace `generateSnarkyMessage()` (lines 573-659) with ~15 LOC wrapper:
1. Import `generateSnarkyCore` from `./message-generation-core.js`
2. Call `generateSnarkyCore({ ctx, sessionId, summaryState, summary, config, logger })`
3. Switch on `result.status`:
   - `'success'` → `ctx.logger.debug('Snarky message generated', { sessionId, message: state.message.slice(0, 50) })`
   - `'skipped'` → log debug skip reason
   - `'error'` → write error message as snarky state (preserves existing behavior where profile errors show as snarky messages), log warning

- [ ] **Step 2: Replace generateResumeMessage with thin wrapper**

Replace `generateResumeMessage()` (lines 674-828) with ~20 LOC wrapper:
1. Import `generateResumeCore` from `./message-generation-core.js`
2. Build `excerptOptions` from config (excerptLines, includeToolMessages, etc.)
3. Call `generateResumeCore({ ctx, sessionId, summaryState, summary, config, logger, excerptOptions, transcript: ctx.transcript })`
4. Switch on `result.status`:
Before calling `generateResumeCore()`, emit `LogEvents.resumeGenerating()` (this fires BEFORE the LLM call, so it must be emitted before entering core).
   - `'success'` → emit `LogEvents.resumeUpdated()` with persona/message details
   - `'deterministic'` → emit `LogEvents.resumeUpdated()` with deterministic output
   - `'skipped'` → emit `LogEvents.resumeSkipped()`
   - `'error'` → log warning

- [ ] **Step 3: Replace analysisInFlight with CoalescingGuard**

1. Import `CoalescingGuard` from `@sidekick/core`
2. Replace `const analysisInFlight = new Map<string, boolean>()` (line 43) with `const analysisGuard = new CoalescingGuard<string>()`
3. Delete `resetAnalysisGuard()` (lines 74-76)
4. In `updateSessionSummary()`, replace the `void performAnalysis(...)` calls with `void analysisGuard.run(sessionId, () => performAnalysis(...))`
5. Remove the coalescing guard logic from inside `performAnalysis` (the try/finally rerun block) — it's now handled by `CoalescingGuard`
6. Export `analysisGuard` for test reset: `export { analysisGuard }` (tests call `analysisGuard.clear()` in beforeEach)

- [ ] **Step 4: Update existing test imports**

In `update-summary.test.ts` (line 24):
- Replace `import { updateSessionSummary, resetAnalysisGuard }` with `import { updateSessionSummary, analysisGuard }`
- Replace `resetAnalysisGuard()` calls in `beforeEach` with `analysisGuard.clear()`

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/feature-session-summary/src/handlers/update-summary.ts \
       packages/feature-session-summary/src/handlers/__tests__/update-summary.test.ts
git commit -m "refactor(session-summary): wire update-summary to core functions + CoalescingGuard"
```

---

## Task 6: Wire on-demand-generation.ts — Core Functions

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/on-demand-generation.ts`

- [ ] **Step 1: Replace generateSnarkyMessageOnDemand with thin wrapper**

Replace `generateSnarkyMessageOnDemand()` (lines 97-192) with ~15 LOC wrapper:
1. Import `generateSnarkyCore` from `./message-generation-core.js`
2. Load config + summary needed for params
3. Call `generateSnarkyCore({ ctx, sessionId, summaryState, summary, config, logger: ctx.logger })`
4. Map result to `GenerationResult`:
   - `'success'` → `{ success: true }`
   - `'skipped'` → `{ success: false, error: result.reason }`
   - `'error'` → `{ success: false, error: result.error.message }`

- [ ] **Step 2: Replace generateResumeMessageOnDemand with thin wrapper**

Replace `generateResumeMessageOnDemand()` (lines 198-322) with ~20 LOC wrapper:
1. Import `generateResumeCore` from `./message-generation-core.js`
2. Load summary from state — if null, return `{ success: false, error: 'No summary available' }` (this check stays in wrapper, not core)
3. Build hard-coded excerptOptions: `{ maxLines: 50, includeToolMessages: true, includeToolOutputs: false, includeAssistantThinking: false }`
4. Call `generateResumeCore({ ..., excerptOptions, transcript: ctx.transcript })`
5. Map result to `GenerationResult` (same pattern as snarky)

- [ ] **Step 3: Clean up unused imports**

Remove imports that were only used by the old generation implementations:
- `interpolateTemplate` from `./update-summary.js` (now used internally by core)
- `buildPersonaContext`, `getEffectiveProfile`, `loadSessionPersona`, `loadUserProfileContext`, `stripSurroundingQuotes` from `./persona-utils.js` (if no longer used directly — verify `setSessionPersona()` doesn't need any)
- Any type imports that are no longer referenced

**Keep:** `createPersonaLoader`, `getDefaultPersonasDir` — still used by `setSessionPersona()` (lines 58-59)

**Important:** Update both the import AND usage in one atomic edit to avoid linter hook rejecting unused imports (see memory x43).

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: All tests PASS (including on-demand-generation.test.ts)

- [ ] **Step 5: Commit**

```bash
git add packages/feature-session-summary/src/handlers/on-demand-generation.ts
git commit -m "refactor(session-summary): wire on-demand-generation to core functions"
```

---

## Task 7: Final Verification & Cleanup

**Files:** All modified files from Tasks 1-6

- [ ] **Step 1: Run full build pipeline**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: All PASS

- [ ] **Step 2: Run all session-summary tests**

Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: All PASS

- [ ] **Step 3: Run core tests (CoalescingGuard)**

Run: `pnpm --filter @sidekick/core test -- coalescing-guard`
Expected: All PASS

- [ ] **Step 4: Verify LOC reduction**

Run: `wc -l packages/feature-session-summary/src/handlers/update-summary.ts packages/feature-session-summary/src/handlers/on-demand-generation.ts packages/feature-session-summary/src/handlers/message-generation-core.ts`
Expected: update-summary.ts ~450, on-demand-generation.ts ~140, message-generation-core.ts ~180

- [ ] **Step 5: Check for dead code**

Verify these are deleted/unused:
- `analysisInFlight` map (was line 43 of update-summary.ts)
- `resetAnalysisGuard()` export (was lines 74-76)
- The coalescing try/finally block inside performAnalysis
- Duplicated snarky/resume pipeline code in both files

- [ ] **Step 6: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(session-summary): remove dead code from dedup refactor"
```

- [ ] **Step 7: Push branch and create PR**

```bash
git push -u origin <branch-name>
gh pr create --title "refactor(session-summary): deduplicate and decompose generation pipeline" \
  --body "$(cat <<'EOF'
## Summary
- Extract shared snarky/resume generation into message-generation-core.ts (~210 LOC dedup eliminated)
- Decompose performAnalysis (257 LOC) into 6 named step functions
- Extract CoalescingGuard<K> utility into @sidekick/core

Closes bead osf

## Test plan
- [ ] CoalescingGuard unit tests pass (concurrent calls, coalescing, error cleanup)
- [ ] message-generation-core unit tests pass (snarky + resume success/skip/error paths)
- [ ] analysis-steps unit tests pass (loadAnalysisInputs, resetCountdown, emitAnalysisEvents)
- [ ] Existing update-summary.test.ts passes (regression safety net)
- [ ] Existing on-demand-generation.test.ts passes (regression safety net)
- [ ] pnpm build && pnpm typecheck && pnpm lint all pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
