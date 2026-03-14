# UI Implementation Epic: Design & Decomposition

**Epic:** `sidekick-43a8b12e`
**Date:** 2026-03-13
**Status:** Approved

## Philosophy

Plan directionally long-term, concretely short-term, revisit after each iteration.

## Current State

The canonical event contract is complete: 31 `UIEventType` values defined in `@sidekick/types` with payloads, visibility mapping, and type-safe discriminated unions. The UI prototype (v1 skeleton) exists with mock data. The daemon/CLI emit ~70% of required events but with gaps and payload misalignment.

### Architecture Stack (bottom-up)

```
React Frontend (19 components)         -- Can't test without API
REST API + SSE (Vite Middleware)       -- Can't serve without events
File Watching + Caching + Validation   -- Can't validate without schemas
Daemon/CLI Event Emission              -- ~70% complete, 6/8 requirements pending
Canonical Event Types (@sidekick/types) -- Complete (31 events)
```

## Phased Approach

### Phase 1: Event Emission Alignment (Concrete)

Fix daemon/CLI to emit all canonical events with correct payloads. Four beads, all children of `sidekick-43a8b12e`:

#### Bead A: Align existing event payloads with canonical contract

Scope: R2 (start/finish payload alignment), R5 (`reminder:unstaged` emission at unstage points), R7 (`ReminderStaged` field naming harmonization), R8 (`error:occurred` visibility/payload review).

These are small alignment tasks that share the concern of "make existing events match the canonical contract."

Parallelizable: Yes.

#### Bead B: Emit `persona:changed` event on mid-session persona switch

Scope: R3. New detection logic in the daemon to distinguish initial persona selection (`persona:selected`, already emitted) from mid-session changes (`persona:changed`, new event with `personaFrom`/`personaTo`/`reason` payload).

Parallelizable: Yes.

#### Bead C: Design and emit `decision:recorded` structured events

Scope: R4. Currently decisions are logged as unstructured `info` messages. Requires brainstorming to define what constitutes a "decision" in the Sidekick context, what payload fields capture useful forensic data, and where in the daemon code to emit these events.

Parallelizable: Yes, after design pass (brainstorming within bead).

#### Bead D: Emit discrete `session-title:changed` and `intent:changed` events

Scope: R6. Extract state transition events from session summary processing. When a summary update changes the title or intent, emit a discrete event with `previousValue`/`newValue`/`confidence` payload rather than relying on consumers to diff state files.

Parallelizable: Yes.

**Note:** R1 (define `UIEventType` in `@sidekick/types`) is already complete.

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
Phase 1 (A, B, C, D in parallel)
    |
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
