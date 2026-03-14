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

**Deferred work:** TB2 populates `sidekickEvents`. TB3+ populates `transcriptLines`, `ledStates`, and `stateSnapshots`.

---

### D8: Fresh minimal NDJSON parser, not archived parser (2026-03-14)

**Decision:** Write a fresh ~50-line NDJSON parser for TB2 instead of resurrecting the archived `NdjsonStreamParser` from `.archive/src/lib/log-parser.ts`.

**Context:** TB2 needs to parse `.sidekick/logs/cli.log` and `sidekickd.log` to extract timeline events.

**Alternatives considered:**
1. Resurrect archived `NdjsonStreamParser` — already built, handles streaming and Pino metadata
2. Fresh minimal parser — purpose-built for current canonical event types

**Rationale:** The archived parser predates the 32 canonical event types and `CanonicalEvent<T>` type system. Adapting it would mean retrofitting legacy abstractions. A fresh parser that speaks the current type language is ~50 lines and trivially testable. When streaming is needed (SSE), revisit the `NdjsonStreamParser` pattern then.

**Deferred work:** None — streaming parser is a separate concern for SSE (see `claude-code-sidekick-zq8`).

---

### D9: `transcriptLineId` empty string placeholder (2026-03-14)

**Decision:** Set `transcriptLineId: ''` on all `SidekickEvent` objects in TB2. Scroll-sync between Timeline and Transcript does nothing.

**Context:** The `SidekickEvent` type has a required `transcriptLineId` field for scroll-sync. TB2 doesn't load transcript data.

**Alternatives considered:**
1. Empty string placeholder — sync dispatch fires, finds no match, nothing happens
2. Use event ID as transcriptLineId — semantically misleading
3. Make `transcriptLineId` optional — changes type contract for a temporary state

**Rationale:** Option 1 is simplest with zero type or component changes. The Timeline already handles the case where no transcript line matches. When transcript data is loaded in TB3+, replace the empty string with correlated line IDs.

**Deferred work:** Transcript line correlation for scroll-sync. See `claude-code-sidekick-sz6`.

---

### D10: Payload-aware label generator (2026-03-14)

**Decision:** Generate human-readable timeline labels by inspecting both event `type` and `payload`, not just the type string.

**Context:** The Timeline column is narrow. Each event needs a concise, informative `label`.

**Alternatives considered:**
1. Static type-to-label map (`'reminder:staged' → 'Reminder Staged'`) — simple but repetitive
2. Payload-aware generator (`'reminder:staged' + payload → 'Staged: vc-build'`) — richer, more useful

**Rationale:** A timeline full of identical "Reminder Staged" entries provides no value. Payload-aware labels like "Staged: vc-build" vs "Staged: pause-and-reflect" tell a meaningful story at a glance. ~40 lines with a switch on event type.

**Deferred work:** None.

---

### D11: Parser and transformer in server/ only (2026-03-14)

**Decision:** NDJSON parsing and event transformation live in `packages/sidekick-ui/server/`, not in a shared module or separate package.

**Context:** The client receives clean `SidekickEvent[]` from the API — it never touches raw NDJSON.

**Alternatives considered:**
1. Server-only — co-located with API route, simple
2. Shared `src/lib/` module — available to both server and client
3. Separate `@sidekick/log-parser` package — maximum reuse across monorepo

**Rationale:** TB2 is server-side parsing with a REST endpoint. No client-side parsing needed. A new monorepo package for ~50 lines is over-engineering. If SSE arrives and the client needs to parse raw event lines, extract to a shared module then.

**Deferred work:** Extract to shared module if/when client-side parsing is needed (SSE). See `claude-code-sidekick-zq8`.

---

### D12: Empty timeline shows "no events" message (2026-03-14)

**Decision:** When a session has no timeline events, display a "No events" message instead of an empty panel.

**Context:** Silent empty states confuse users — they can't tell if the timeline is loading, broken, or genuinely empty.

**Alternatives considered:**
1. Silent empty state — filter bar with nothing below
2. Explicit "No events" message

**Rationale:** Users need feedback. An empty panel looks like a bug. A brief message confirms the system is working, there's just nothing to show.

**Deferred work:** None.

---

### D13: Parent transcript only — no subagent drill-down (TB3)

**Decision:** TB3 renders only the parent session transcript. Subagent conversations (stored in `subagents/agent-{id}.jsonl`) are deferred to `claude-code-sidekick-0wf`. Agent tool_use/tool_result entries appear as regular tool calls in the parent transcript.

**Context:** Claude Code sessions can spawn subagent conversations stored in separate JSONL files. TB3 needs a scope decision.

**Alternatives considered:**
1. Parse and render subagent transcripts inline — complex, requires correlation logic
2. Parent transcript only — simpler, subagent activity still visible as tool_use entries

**Rationale:** Subagent drill-down is a significant feature requiring its own UX design. The parent transcript already shows Agent tool_use/tool_result entries, so no information is lost — just not expandable yet.

**Deferred work:** Subagent drill-down UI. See `claude-code-sidekick-0wf`.

---

### D14: Self-contained transcript parser (no @sidekick/core import)

**Decision:** Keep transcript-api.ts self-contained with inline parsing logic, matching the timeline-api.ts pattern. Avoids cross-tsconfig import issues and keeps the server module independent. The @sidekick/core dependency exists in package.json for future SSE/live features but is not imported by the parser.

**Context:** Transcript parsing requires extracting text content from Claude Code JSONL entries. @sidekick/core already has utilities for this.

**Alternatives considered:**
1. Duplicate extraction logic in sidekick-ui — no cross-package dependency
2. Import from @sidekick/core — reuse existing, tested code

**Rationale:** The server/ directory uses tsconfig.node.json while @sidekick/core uses its own tsconfig. Cross-tsconfig imports create build complexity. The parsing logic is ~50 lines and self-contained, matching the pattern already established by timeline-api.ts. The @sidekick/core dependency remains in package.json for future SSE/chokidar/pino needs.

**Deferred work:** None.

---

### D15: Include isSidechain entries in transcript

**Decision:** Sidechain entries contain Sidekick SessionStart hook activity (bd ready, hook execution). Filtering them would hide part of the story. They render with a "sidechain" badge for visual distinction.

**Context:** Claude Code JSONL entries can have `isSidechain: true`, indicating they ran outside the main conversation flow (e.g., Sidekick hook processing).

**Alternatives considered:**
1. Filter out sidechain entries — cleaner transcript, but hides hook activity
2. Include with visual badge — complete picture with clear distinction

**Rationale:** Users monitoring Sidekick want to see what hooks did. Filtering them defeats the purpose of a monitoring UI. A badge provides the visual cue that these are "behind the scenes" operations.

**Deferred work:** None.

---

### D16: Defer Sidekick event interleaving

**Decision:** TB3 shows pure Claude Code conversation turns only. Interleaving Sidekick events (reminders, decisions) by timestamp is deferred to `claude-code-sidekick-mcs`.

**Context:** The full monitoring UI should show Sidekick events (from NDJSON logs) interleaved with transcript entries by timestamp.

**Alternatives considered:**
1. Interleave now — requires timestamp correlation between two data sources
2. Defer — TB3 focuses on transcript rendering correctness

**Rationale:** Interleaving requires solving timestamp correlation, visual design for mixed entry types, and scroll-sync. Each is non-trivial. TB3's job is to prove transcript parsing and rendering work correctly.

**Deferred work:** Sidekick event interleaving. See `claude-code-sidekick-mcs`.

---

### D17: Deterministic transcript line IDs

**Decision:** Format: `transcript-{lineNumber}-{blockIndex}` (both 0-indexed). Stable IDs enable future scroll-sync with timeline events (`claude-code-sidekick-sz6`).

**Context:** Each `TranscriptLine` needs a unique, stable ID for React keys and future scroll-sync.

**Alternatives considered:**
1. Random UUIDs — unique but not stable across re-parses
2. Content hash — stable but expensive and collides on duplicate content
3. Line number + block index — stable, deterministic, zero-cost

**Rationale:** Line number and block index are inherently stable for a given file state. They're free to compute and naturally unique. When the file changes (live updates), IDs shift but that's expected — React reconciliation handles it.

**Deferred work:** None — IDs are ready for scroll-sync when needed.

---

### D18: Read entire file, no streaming

**Decision:** Acceptable for TB3. A 47MB transcript with 99% queue-operation entries parses quickly since noise entries are skipped before full processing. Streaming/pagination deferred to `claude-code-sidekick-bpo`.

**Context:** Claude Code transcript files can be very large (tens of MB). Need to decide whether to stream or read all at once.

**Alternatives considered:**
1. Read entire file — simple, works for TB3
2. Stream with backpressure — handles arbitrarily large files
3. Paginate — load chunks on demand

**Rationale:** The vast majority of transcript lines are `queue-operation` entries that are skipped immediately after JSON.parse. The actual rendered content is typically <1% of the file. Full-file read with early filtering is fast enough for TB3 and avoids streaming complexity.

**Deferred work:** Streaming/pagination for very large transcripts. See `claude-code-sidekick-bpo`.

---

### D19: Skip queue-operation entries early

**Decision:** queue-operation entries are 99%+ of transcript lines. They are skipped immediately after JSON.parse by checking the `type` field, avoiding any further processing overhead.

**Context:** Claude Code JSONL files contain massive numbers of `queue-operation` entries that have no user-visible meaning.

**Alternatives considered:**
1. Process all entries, filter at render time — wastes memory and CPU
2. Skip early after type check — minimal overhead per skipped line

**Rationale:** In a 47MB transcript, queue-operation entries dominate. Skipping them immediately after identifying the type field avoids allocating TranscriptLine objects, running content extraction, or any other processing. This is the critical optimization that makes full-file reads viable.

**Deferred work:** None.
