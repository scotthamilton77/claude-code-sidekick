# UI Implementation Decisions

> **For agents:** Keep this document up to date. When you make a decision that affects the UI architecture,
> data flow, or deviates from the IMPLEMENTATION-SPEC, record it here. When a decision creates future work
> (undoing a shortcut, completing deferred work), create a bead with `discovered-from:<current-bead>` and
> add it as a child of epic `sidekick-43a8b12e`.

## Decision Format

Each decision follows this structure:
- **Decision:** What was decided
- **Context:** Why this came up
- **Alternatives considered:** What else was on the table
- **Rationale:** Why this option won
- **Deferred work:** What future work this creates (with bead ID if applicable)

---

## Decisions

### D1: Session list source — filesystem readdir (2026-03-14)

**Decision:** Session list comes from scanning `.sidekick/sessions/*/` directories on disk, not from NDJSON log parsing or a dedicated session index.

**Context:** TB1 (Session Selector tracer bullet) needs a session list before the NDJSON log parser exists (TB2).

**Alternatives considered:**
1. Parse NDJSON logs for unique `context.sessionId` values — requires log parser (TB2 dependency)
2. Dedicated session index file — doesn't exist, would need daemon changes
3. Filesystem `readdir` on `.sidekick/sessions/` — simple, no new dependencies

**Rationale:** Option 3 has zero dependencies on unbuilt infrastructure. Any session with state files on disk is a real session. Sufficient for the tracer bullet and likely sufficient long-term.

**Deferred work:** None — this is likely the permanent approach.

---

### D2: Multi-project support from day one (2026-03-14)

**Decision:** TB1 enumerates all projects from `~/.sidekick/projects/` registry, not just the current project.

**Context:** The `SessionSelector` UI groups sessions under project nodes. Could have started with single-project.

**Alternatives considered:**
1. Current project only — simpler, but the UI already expects `Project[]`
2. All registered projects — uses existing `ProjectRegistryService` registry data

**Rationale:** The project registry already exists and the UI was designed for multi-project. Building single-project only to expand later would mean ripping out assumptions. Marginal extra complexity for correct architecture from the start.

**Deferred work:** None.

---

### D3: Hardcoded `~/.sidekick/` path (2026-03-14)

**Decision:** The Vite middleware hardcodes `~/.sidekick/` as the user-scope sidekick home directory.

**Context:** The middleware needs to find the project registry and per-project session directories.

**Alternatives considered:**
1. Hardcode `~/.sidekick/` — simple, well-known path
2. `SIDEKICK_HOME` environment variable with default — more flexible
3. Thread path from `pnpm sidekick ui` CLI — decouples UI from path assumptions

**Rationale:** Single-user project, path is well-known and stable. YAGNI on configurability. If this ever needs to change, it's a one-line fix.

**Deferred work:** None — revisit only if deployment model changes.

---

### D4: Git branch via `child_process.exec` (2026-03-14)

**Decision:** Get current git branch per project by running `git branch --show-current` in each project's directory from the Vite middleware.

**Context:** `SessionSelector` displays the branch name per project. No state file stores this.

**Alternatives considered:**
1. `child_process.exec('git branch --show-current', { cwd: projectDir })` — simple, correct
2. Read `.git/HEAD` directly — faster, no process spawn, but fragile with worktrees
3. Omit branch for tracer bullet — leaves UI field empty

**Rationale:** Direct and correct. One process spawn per project is negligible for the expected project count (<10). Worktree-safe.

**Deferred work:** Cache git branch result to avoid repeated spawns on every API call. See bead `claude-code-sidekick-u28`.

---

### D5: Minimal Vite `configureServer` stub, not full middleware (2026-03-14)

**Decision:** TB1 adds routes directly in a `configureServer` callback, not a full middleware plugin architecture.

**Context:** The archived `.archive/server/` has a full `itty-router` + plugin architecture, but it predates the unified event contract.

**Alternatives considered:**
1. Resurrect and update archived middleware — fastest but inherits stale design
2. Fresh middleware with full plugin architecture — clean but over-engineered for 2 routes
3. Minimal `configureServer` handler — prove the pipeline, refactor when more routes needed

**Rationale:** YAGNI. Two routes don't need a router framework. When TB2 adds log routes, we can refactor into a proper plugin if the route count warrants it. The tracer bullet philosophy is minimum viable end-to-end slice.

**Deferred work:** Refactor into proper Vite plugin with router when route count exceeds ~4. See bead `claude-code-sidekick-qn3`.

---

### D6: `useSessions()` data hook pattern (2026-03-14)

**Decision:** Introduce a `useSessions()` React hook that fetches from the API and returns `{ projects, loading, error }`, rather than inlining fetch logic in `App.tsx`.

**Context:** `App.tsx` currently imports `mockProjects` directly. Need to swap to real data.

**Alternatives considered:**
1. Inline `fetch` in `App.tsx` `useEffect` — quick and dirty
2. `useSessions()` hook — clean separation, reusable pattern for future data domains

**Rationale:** Barely more work than option 1, establishes the pattern for TB2 (`useTimeline()`) and TB3 (`useSummary()`). One hook per data domain.

**Deferred work:** None — this is the permanent pattern.

---

### D7: Empty collections for unloaded data domains (2026-03-14)

**Decision:** `useSessions()` populates `Session` objects with empty `transcriptLines`, `sidekickEvents`, `ledStates`, and `stateSnapshots`. These are filled by later tracer bullets.

**Context:** The `Session` type requires these fields. TB1 only loads session metadata, not full session content.

**Alternatives considered:**
1. Make these fields optional on `Session` type — breaks existing component contracts
2. Return empty collections — satisfies types, components render empty states gracefully

**Rationale:** Changing the `Session` type would ripple through all components. Empty collections are truthful (we haven't loaded the data yet) and components handle empty arrays naturally.

**Deferred work:** TB2 populates `transcriptLines` and `sidekickEvents`. TB3+ populates `ledStates` and `stateSnapshots`.
