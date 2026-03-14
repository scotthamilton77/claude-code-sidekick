# UI Implementation Epic: Design & Decomposition

**Epic:** `sidekick-43a8b12e`
**Date:** 2026-03-13
**Status:** Approved

## Philosophy

Plan directionally long-term, concretely short-term, revisit after each iteration.

## Current State

The canonical event contract is complete: 31 `UIEventType` values defined in `@sidekick/types` with payloads, visibility mapping, and type-safe discriminated unions. The UI prototype (v1 skeleton) exists with mock data. All 20 state files are implemented and written. The daemon/CLI emit all 31 canonical events (wiring completed via PR #69). The project registry (`claude-code-sidekick-099`) is implemented.

### Architecture Stack (bottom-up)

```
React Frontend (19 components)         -- Can't test without API
REST API + SSE (Vite Middleware)       -- Can't serve without events
File Watching + Caching + Validation   -- Can't validate without schemas
Daemon/CLI Event Emission              -- Complete (31 events + PR #69)
Canonical Event Types (@sidekick/types) -- Complete (31 events, expanding to 32)
```

## Phased Approach

### Phase 1: Event Enrichment (Concrete)

Original R1-R8 requirements are closed. Remaining Phase 1 work focuses on forensic enrichment of reminder events for the UI's debugging use case.

#### Phase 1a: Wire factory-only events (PR #69 — in review)

6 canonical events had factories but no `logEvent()` calls. Now wired:
daemon:starting, daemon:started, ipc:started, config:watcher-started,
session:eviction-started, transcript:emitted. (hook:received, hook:completed,
transcript:pre-compact were already wired.)

#### Phase 1b: New event type — `reminder:not-staged`

**Rationale:** When the daemon evaluates whether to stage a reminder and decides NOT to, no event fires. This "negative space" is critical for forensic debugging ("why WASN'T this reminder shown?") but has no existing event to piggyback on.

**New event (#32):**
- Type: `reminder:not-staged`
- Visibility: `log` (high-frequency, not shown on timeline)
- Payload:
  ```
  reminderName: string        — e.g., 'vc-build', 'pause-and-reflect'
  hookName: HookName          — which hook triggered the evaluation
  reason: string              — 'below_threshold', 'same_turn', 'feature_disabled', etc.
  threshold?: number          — e.g., clearing_threshold: 3
  currentValue?: number       — e.g., editsSinceVerified: 2
  triggeredBy?: string        — 'file_edit', 'bash_command', 'tool_result'
  ```

**Key emission points** (58 decision points identified, instrument the high-forensic-value ones):
- VC tool edit counter below threshold (track-verification-tools.ts)
- P&R reactivation skipped — same turn (stage-pause-and-reflect.ts)
- P&R tools below threshold (stage-pause-and-reflect.ts)
- Bash VC reactivation skipped — same turn (stage-stop-bash-changes.ts)
- File pattern match rejection (track-verification-tools.ts)
- Persona injection disabled (stage-persona-reminders.ts)

#### Phase 1c: Enrich existing reminder event payloads

Add optional fields to existing events — backward compatible, no breaking changes:

**`reminder:staged`** — add:
- `reason?: string` — 'initial', 're-staged', 'threshold_reached', 'cascade'
- `triggeredBy?: string` — 'file_edit', 'bash_command', 'tool_result', 'session_start'
- `thresholdState?: { current: number, threshold: number }`

**`reminder:unstaged`** — add:
- `triggeredBy?: string` — 'cascade_from_pause_and_reflect', 'verification_passed', 'cycle_limit'
- `toolState?: { status: string, editsSinceVerified: number }`

**`reminder:consumed`** — add:
- `classificationResult?: { category: string, confidence: number, shouldBlock: boolean }`

**`decision:recorded`** — no changes. Keeps its narrow scope (LLM operation gating).

### Phase 2: Tracer Bullets (Directional)

After Phase 1, pick 2-3 representative end-to-end slices that exercise the full stack:

**daemon emits event -> NDJSON log -> backend reads/parses -> API serves -> UI renders**

Candidate slices (to be refined after Phase 1):

- **Reminder lifecycle** -- high-frequency events, well-understood flow, exercises timeline panel + LED gutter component
- **Session summary** -- exercises state file reads + detail panel + summary strip, validates the file-watching/caching layer
- **Persona selection** -- simple slice, exercises session selector + timeline, good for proving SSE notifications

Each tracer bullet builds the minimum of every layer needed for that slice. Architecture is proven before investing in breadth.

### Phase 3: Gap Closure (Directional -- defer decomposition)

Layer-by-layer completion after tracer bullets validate the architecture:

- Remaining backend API routes + Zod schemas for all 20 state files
- Remaining UI components (v2 rewrites of 19 components)
- SSE real-time update infrastructure
- Log parsing with byte-offset pagination for incremental reads

Decompose into beads after Phase 2 reveals the actual work.

### Phase 4: Polish (Directional -- defer)

- Virtual scrolling (TanStack Virtual at 200+ event threshold)
- Performance budget verification (16ms/frame rendering, <1s initial load)
- Memory budget verification (256MB browser heap max)
- Integration tests with real log fixtures

## Dependency Graph

```
Phase 1a (PR #69 — in review)
Phase 1b (reminder:not-staged) ──┐
Phase 1c (payload enrichment) ───┤ parallelizable
                                 │
                                 v
Phase 2 (tracer bullets -- sequential slices)
    |
    v
Phase 3 (gap closure -- parallel by layer)
    |
    v
Phase 4 (polish)
```

## Process Requirements

All work follows:
- TDD (red-green-refactor)
- Isolated git worktrees
- Parallel execution where possible
- `/ralf-it` with code-simplifier and code-review before PR
- PRs in coherent, reviewable units

## Key Specs

- `docs/specs/ui/IMPLEMENTATION-SPEC.md` -- master spec (sections 1-6)
- `docs/plans/2026-03-08-unified-event-contract-design.md` -- event contract
- `docs/plans/2026-03-09-api-layer-architecture-design.md` -- API layer
- `docs/plans/2026-03-13-component-type-wiring-design.md` -- component wiring
- `docs/plans/2026-03-13-performance-requirements-design.md` -- performance budgets
