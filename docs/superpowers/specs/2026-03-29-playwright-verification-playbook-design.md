# Playwright Verification Playbook

Agent-driven verification procedures for recent bug fixes using Playwright MCP browser tools.

## Overview

This playbook enables an AI agent to verify 6 recent fixes by interacting with both
the sidekick system (triggering actions) and the sidekick web UI (observing results)
using Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, etc.).

The agent IS the test runner. Playwright is the observability instrument.

**Beads covered:**

| ID | Fix | Verification Type |
|----|-----|-------------------|
| `aox` | Command runner stripping in pattern matching | Behavioral + UI |
| `fzk` | Decision event filtering (non-decisions removed) | UI timeline |
| `u9c` | Summary analysis temporal ordering | UI timeline |
| `3pz` | Hook detail panel content (inputs/outputs/name) | UI detail panel |
| `eup` | Spurious unstaged events removed | UI timeline |
| `pkj` | Decision event labels (title vs subsystem) | UI detail panel |

**Execution order:** The scenarios are sequenced so that `aox` (behavioral) runs first,
generating the timeline events that `fzk`, `u9c`, `3pz`, `eup`, and `pkj` then verify
in the UI. One edit triggers all VC tools; different verification tools are used to test
different runner variants, avoiding clearing-threshold delays.

---

## Techniques Reference

### T0 — Session Bootstrap

Prerequisites for a fresh session. Run these before any verification scenario.

**Steps:**

1. **Capture sessionId** — available in the `<session-info>` system reminder tag,
   or query `pnpm sidekick sessions --format=json` to find the current session.

2. **Verify daemon is running:**
   ```bash
   pnpm sidekick daemon status
   ```
   If not running: `pnpm sidekick daemon start`

3. **Build the project** (required for dev-mode hooks):
   ```bash
   pnpm build
   ```

4. **Enable dev-mode** (activates sidekick hooks in this project):
   ```bash
   pnpm sidekick dev-mode enable
   ```

5. **Start the UI dev server** (background):
   ```bash
   pnpm --filter @sidekick/ui dev --port 5199 &
   ```
   Poll `http://localhost:5199` until it responds (or wait ~5 seconds).

6. **Verify Playwright MCP is available** — confirm the `browser_navigate` tool
   is accessible. If not, the Playwright plugin may need to be enabled in
   `.claude/settings.json`.

**Important:** Steps 2-5 may already be satisfied in an existing development
environment. Check before re-running.

---

### T1 — Launch Browser and Navigate to Session

Open the sidekick UI and select the target session.

**Steps:**

1. Navigate to the UI:
   ```
   browser_navigate → http://localhost:5199
   ```

2. Take a snapshot to see the Session Selector panel:
   ```
   browser_snapshot
   ```

3. In the Session Selector (left sidebar), find the current project by name
   (shown uppercase). Click the project header to expand if collapsed.

4. Under the project, find the current session by title or timestamp.
   Sessions are grouped by date ("Today", "Yesterday", etc.).

5. Click the session button. Verify it highlights with an indigo border
   (selected state).

6. Wait for the timeline panel (right of the selector, fixed `w-60` width)
   to populate with event buttons.

**Selectors:**
- Project header: `button:has-text("{PROJECT_NAME}")`
- Session: `button:has-text("{session_title}")` or match by timestamp
- Selected state: element has `border-indigo-300` class

---

### T2 — Filter Timeline

Narrow the timeline to a specific event category.

**Available filters:** All, Reminders, Decisions, Analysis, Statusline, Errors, Hooks

**Steps:**

1. Locate the filter bar at the top of the timeline panel.
2. Click the desired filter button:
   ```
   browser_click → text="Reminders"
   ```
3. Verify the filter is active (button gains ring styling and color change).
4. To reset: click `text="All"`.

**Selectors:**
- Filter button: `button:has-text("{FilterName}")`
- Active indicator: button has `ring-1 ring-slate-300` and `bg-slate-200` (uniform slate styling for all active filters)

---

### T3 — Inspect Detail Panel

Open and examine the detail panel for a specific event.

**Important: Timeline vs Transcript interaction model.**
The timeline panel is a *navigation aid*. Clicking a timeline event **scrolls
the transcript panel** to the corresponding line and highlights it — it does
NOT directly open the detail panel. To open the detail panel, click the
**transcript line** (the highlighted card in the main content area).

**Steps:**

1. Click an event button in the **timeline panel**. This syncs the
   **transcript panel** — it scrolls to and highlights the matching line.

2. Click the **highlighted transcript line** in the main content area.
   The detail panel opens on the right side of the screen.

3. Verify the detail header shows:
   - Type badge (e.g., `decision:recorded`, `reminder:unstaged`) in a
     `span` with `bg-slate-100 text-slate-400` styling
   - Title text in `h2` element

4. **Navigate between transcript lines:**
   - Previous: `button[title="Previous line"]`
   - Next: `button[title="Next line"]`
   - Index display: `{current} / {total}` in monospace
   - **Note:** These navigate ALL transcript lines (user messages, tool
     calls, sidekick events, etc.), not just filtered event types. To
     find a specific event type, use the timeline filter (T2) and click
     the desired event there instead.

5. Switch tabs:
   - `button:has-text("Details")` — event-specific content
   - `button:has-text("State")` — state snapshot viewer

6. Expand collapsible sections:
   - Click `button:has-text("Raw Input JSON")` or similar
   - Check `aria-expanded="true"` to confirm expansion
   - Content appears in `pre.font-mono` element

7. Close panel: `button` with X icon in header row.

---

### T4 — Trigger VC Reminder Staging

Create conditions that cause verification-checklist reminders to stage.

**Mechanics:**
- Editing a `.ts` file triggers `track-verification-tools` handler
- On first edit (no prior state): ALL verification tools stage immediately
  (`vc-build`, `vc-typecheck`, `vc-test`, `vc-lint` + wrapper `verify-completion`)
- After a tool is verified: requires `clearing_threshold` additional edits
  before re-staging (3 for build/typecheck/test, 5 for lint)

**Steps:**

1. Make a trivial edit to a `.ts` file. A safe approach is adding/removing
   a trailing comment in a non-critical file:
   ```
   Edit → packages/types/src/index.ts
   Add comment: // playwright-verification-marker
   ```

2. Wait for event propagation (T6).

3. Verify staging via timeline (filter to Reminders) or via the timeline API.

**For re-staging after verification:**
- Make 3+ additional `.ts` file edits (for build/typecheck/test tools)
- Or target a different, not-yet-verified tool

**Cleanup:** Revert edits after verification (T7).

---

### T5 — Take Snapshot and Assert

Capture the current browser state and check for expected/unexpected content.

**Steps:**

1. Take a snapshot:
   ```
   browser_snapshot
   ```

2. **Presence assertion:** Search the snapshot text for expected content
   (event labels, badge text, field values).

3. **Absence assertion:** Confirm that specific text does NOT appear
   in the snapshot. This is critical for `eup` (no spurious unstaged)
   and `fzk` (no non-decision events).

4. **Count assertion:** Count occurrences of a specific event type
   to verify expected quantities.

---

### T6 — Wait for Event Propagation

After performing an action, wait for the daemon to process and events to appear.

**Option A — API polling (preferred):**

Query the timeline API endpoint until the expected event appears:
```
GET http://localhost:5199/api/projects/{projectId}/sessions/{sessionId}/timeline
```
Parse the JSON response, check the `events` array for the expected event type.
Poll every 1-2 seconds, timeout after 10 seconds.

**Option B — Fixed delay:**

Wait 3 seconds. Less reliable but simpler for non-critical checks.

**Option C — Browser refresh + check:**

If the browser is already open on the session:
1. Refresh: `browser_navigate → http://localhost:5199` (or re-click session)
2. Take snapshot (T5)
3. Check for expected event

---

### T7 — Teardown

Clean up after verification to leave the workspace pristine.

**Steps:**

1. Revert ALL file edits made during verification:
   ```bash
   git checkout -- packages/types/src/index.ts  # list all files edited during S1
   ```
   If multiple files were edited (e.g., to meet clearing thresholds), revert
   each one. Use `git diff --name-only` to find modified files.

2. Optionally stop the UI dev server if it was started for this playbook.

3. Optionally close the Playwright browser:
   ```
   browser_close
   ```

---

## Verification Scenarios

### Execution Sequence

```
T0: Bootstrap (daemon, build, dev-mode, UI server, sessionId)
 │
 ▼
S1: aox — Command runner pattern matching (behavioral)
 │  ├─ Edits .ts files → stages VC reminders
 │  ├─ Runs commands through runners → unstages reminders
 │  └─ Generates: hook events, analysis events, reminder events, decision events
 │
 ▼
T1: Open browser, navigate to session
 │
 ├──▶ S3: u9c — Analysis ordering (fires on first prompt, check early timeline)
 ├──▶ S5: eup — Spurious unstaged check (scan early timeline for absence)
 ├──▶ S4: 3pz — Hook detail content (hooks fired on every action)
 ├──▶ S2: fzk — Decision filtering (decisions generated by staging/unstaging)
 └──▶ S6: pkj — Decision labels (same decision events as S2)
 │
 ▼
T7: Teardown (revert edits, close browser)
```

**Note:** S2-S6 can run in any order after S1 completes and the browser is
open. The arrows indicate independence (parallelizable), not sequence.
The suggested order above groups related checks (S2/S6 both inspect decisions).

---

### S1 — `aox`: Command Runner Pattern Matching

**Goal:** Verify that bash commands invoked through runners (npx, uv run, etc.)
correctly unstage VC reminders, and that non-matching commands do not.

**Configured patterns (subset relevant to this test):**

| Tool | Pattern | Used For |
|------|---------|----------|
| build | `pnpm build` | Direct command test |
| typecheck | `tsc --noEmit` | Runner test (npx) |
| test | `jest` | Runner test (npx) |
| lint | `eslint` | Negative baseline |

**Steps:**

1. **Stage all VC tools** — edit a `.ts` file (T4). This stages `vc-build`,
   `vc-typecheck`, `vc-test`, `vc-lint`, and `verify-completion` simultaneously.

2. **Positive — direct command:**
   ```bash
   pnpm build
   ```
   Wait for propagation (T6). Query the timeline API or check `.sidekick/sessions/`
   state. Verify `vc-build` transitioned to `verified` status. A `reminder:unstaged`
   event should appear for `vc-build`.

3. **Positive — Node runner (npx):**
   ```bash
   npx tsc --noEmit
   ```
   Wait for propagation. Verify `vc-typecheck` transitioned to `verified`.
   The runner prefix `npx` should be stripped, matching the `tsc --noEmit` pattern.
   A `reminder:unstaged` event should appear for `vc-typecheck`.

4. **Positive — another runner variant:**
   ```bash
   npx jest --passWithNoTests
   ```
   Wait for propagation. Verify `vc-test` transitioned to `verified`.
   The `npx` prefix is stripped, `jest` matches the test tool pattern.

5. **Negative — non-matching command through runner:**
   ```bash
   npx cowsay "moo"
   ```
   Wait briefly. Verify NO new `reminder:unstaged` event appears.
   `vc-lint` should remain staged (its patterns are `eslint`, `pnpm lint`, etc. —
   `cowsay` matches nothing).

6. **Verify in UI (after opening browser in next phase):**
   Filter timeline to Reminders (T2). Confirm:
   - `reminder:staged` events for all VC tools near the edit
   - `reminder:unstaged` events for build, typecheck, test (but NOT lint)
   - For each unstaged event: click it in the timeline to sync transcript,
     then click the transcript line to open detail panel (T3). Verify the
     reminder ID matches the expected VC tool.

**Pass criteria:**
- Direct command: unstages correctly
- Runner-prefixed commands: unstage correctly (runner stripped)
- Non-matching runner command: no false unstage
- `vc-lint` remains staged throughout (never matched)

---

### S2 — `fzk`: Decision Event Filtering

**Goal:** Verify that unconditional actions don't appear as decision events,
and real conditional decisions (staging/unstaging threshold evaluations) do.

**Prerequisite:** S1 generated decision events during staging/unstaging activity.

**Steps:**

1. Filter timeline to Decisions (T2).

2. **Absence check — no non-decisions:**
   Take snapshot (T5). Verify NONE of these appear as decision event labels:
   - "UserPrompt forces immediate analysis"
   - "Immediate analysis" (or similar unconditional action labels)

   These were removed in the `fzk` fix. If they appear, the fix has regressed.

3. **Presence check — real decisions exist:**
   Verify that decision events DO appear for conditional logic, such as:
   - Reminder staging threshold evaluations
   - Reminder unstaging after tool verification
   - Staging/unstaging coordination decisions

4. **Detail inspection:**
   Click a decision event in the timeline to sync transcript, then click
   the highlighted transcript line to open the detail panel (T3). Verify:
   - A meaningful title (not just a subsystem tag)
   - A category badge (amber colored) — only renders when both title
     AND category are populated
   - A subsystem badge (slate colored, separate from title) — only
     renders when `decisionSubsystem` is populated
   - Reasoning text explaining why the decision was made

   If category or subsystem badges are absent, this may indicate the
   backend isn't populating those fields — flag as a potential issue.

**Pass criteria:**
- Zero non-decision events in timeline
- At least one real conditional decision present
- Detail panel fields are populated and meaningful

---

### S3 — `u9c`: Summary Analysis Temporal Ordering

**Goal:** Verify that `intent:changed` and `session-title:changed` events appear
in correct temporal order relative to the analysis that produced them.

**Prerequisite:** Session analysis runs automatically on first prompt, so the
current session should already have these events.

**Steps:**

1. Filter timeline to Analysis (T2).

2. **Locate analysis lifecycle events:**
   Take snapshot (T5). Identify:
   - `session-summary:start` event
   - `session-summary:finish` event
   - `intent:changed` event
   - `session-title:changed` event

3. **Ordering check:**
   Verify temporal ordering in the timeline (events are listed chronologically):
   - `session-summary:start` appears FIRST
   - `session-summary:finish` appears AFTER start
   - `intent:changed` appears AFTER `session-summary:finish`
     (or as part of the same logical group)
   - `session-title:changed` appears AFTER `session-summary:finish`
     (or as part of the same logical group)

4. **No orphaned results:**
   Verify that intent/title events are NOT floating ABOVE (before) the
   `session-summary:start` event. This was the bug — results appearing
   before the analysis that produced them.

**Pass criteria:**
- Analysis start → finish → derived values (intent, title) ordering is logical
- No derived values appear before their parent analysis

---

### S4 — `3pz`: Hook Detail Panel Content

**Goal:** Verify hook events display name, inputs, and return values in the
detail panel.

**Prerequisite:** Every interaction in the session fires hooks (UserPromptSubmit,
Stop, etc.), so hook events should be abundant.

**Steps:**

1. Filter timeline to Hooks (T2).

2. **Click a hook:received event** — click it in the timeline to sync
   the transcript, then click the highlighted transcript line to open
   the detail panel (T3). Any hook will do, but `UserPromptSubmit`
   hooks are common.

3. **Verify hook name:**
   Confirm a sky-colored badge displays the hook name (e.g.,
   "UserPromptSubmit", "Stop", "Notification"). Light mode: `bg-sky-100
   text-sky-700`. Dark mode: `bg-sky-900/30 text-sky-400`.

4. **Verify input section:**
   In the Details tab, confirm an "Input" heading exists (`h3` element)
   with key-value data below it. The input should contain meaningful
   data (session context, hook parameters), not be empty.

5. **Navigate to paired hook:completed event:**
   Find the corresponding `hook:completed` event in the **timeline**
   panel (it should be nearby in the Hooks filter view). Click it to
   sync the transcript, then click the highlighted transcript line to
   open its detail panel. This is the finish event for the same hook
   invocation.

6. **Verify return value:**
   Confirm a "Return Value" heading exists with data. For hooks that
   return content (e.g., UserPromptSubmit returns reminder text), this
   should show the returned payload.

7. **Expand collapsibles:**
   Click "Raw Input JSON" button. Verify:
   - `aria-expanded` changes to `"true"`
   - JSON content appears in a `pre` element with monospace font
   Click "Raw Return JSON" button. Same verification.

8. **Verify duration:**
   Confirm a duration value is displayed (e.g., "150ms") in tabular-nums
   monospace style.

**Pass criteria:**
- Hook name badge is visible and correctly labeled
- Input section has data
- Return value section has data (on completed events)
- Collapsible sections expand and show valid JSON
- Duration is displayed

---

### S5 — `eup`: No Spurious Unstaged Events

**Goal:** Verify that `reminder:unstaged` events only appear when a reminder
was genuinely removed, not as phantom events at session start.

**Steps:**

1. Filter timeline to Reminders (T2).

2. **Scan early timeline:**
   Navigate to the EARLIEST events in the timeline (top of the list,
   right after session start). Take snapshot (T5).

3. **Absence check at session start:**
   In the first few events after session start, verify there are ZERO
   `reminder:unstaged` events that appear without a preceding
   `reminder:staged` event. The bug was: unstaged events fired at
   session start when nothing had been staged yet.

4. **Paired verification:**
   For ANY `reminder:unstaged` event in the entire timeline:
   - Click it in the timeline to sync transcript, then click the
     highlighted transcript line to open the detail panel (T3)
   - Note the reminder ID shown in the detail panel
   - Scan the timeline (with Reminders filter active) for a prior
     `reminder:staged` event. Click it to verify the same reminder ID.
   - Every unstaged MUST have a prior staged with the same ID
   - **Note:** Do NOT use Prev/Next buttons for this — they navigate
     all transcript lines, not just reminder events. Use the timeline
     panel to jump between filtered events instead.

5. **Count sanity check:**
   The number of `reminder:unstaged` events should be ≤ the number of
   `reminder:staged` events. Take snapshots and count if needed.

**Pass criteria:**
- Zero orphaned unstaged events at session start
- Every unstaged event has a matching prior staged event
- Unstaged count ≤ staged count

---

### S6 — `pkj`: Decision Event Labels

**Goal:** Verify decision events display human-readable titles (not raw
subsystem tags) and that subsystem is shown separately.

**Prerequisite:** Decision events exist from S1 activity (also verified in S2).

**Steps:**

1. Filter timeline to Decisions (T2).

2. **Click a decision event** — click it in the timeline to sync
   transcript, then click the highlighted transcript line to open
   the detail panel (T3).

3. **Title check:**
   In the detail panel, verify the title (`p` element with `text-xs font-medium`)
   contains a human-readable description — NOT a raw subsystem string like
   "session-summary analysis" or "feature-reminders staging".

   Good titles describe what was decided: e.g., "Stage vc-build reminder",
   "Unstage vc-typecheck after verification".

   **Note:** If `decisionTitle` is missing, the UI falls back to displaying
   `decisionCategory`, which is a raw category string. If you see this
   fallback, the backend may not be populating titles for that event.

4. **Subsystem is separate:**
   Verify a subsystem badge exists as a distinct `span` element with
   slate background (`bg-slate-100`). The subsystem (e.g.,
   "feature-reminders") should be in this badge, NOT in the title.
   This badge only renders when `decisionSubsystem` is populated.

5. **Category badge:**
   Verify an amber-colored category badge exists showing the decision
   category (e.g., "staged", "unstaged", "skipped"). This badge only
   renders when BOTH `decisionTitle` AND `decisionCategory` are present.

6. **Consistency across multiple decisions:**
   Return to the timeline panel (Decisions filter) and click 2-3
   additional decision events, opening each in the detail panel via
   the transcript. Verify all of them follow the same pattern:
   - Title: human-readable description
   - Subsystem: separate slate badge
   - Category: separate amber badge
   - No title field is empty or contains only a subsystem tag

**Pass criteria:**
- Titles are human-readable descriptions, not subsystem identifiers
- Subsystem displayed in its own badge, separate from title
- Category badge is present
- Pattern is consistent across multiple events

---

## Appendix: Configured Verification Tool Patterns

Reference for S1 negative/positive test case design.

### Build (clearing_threshold: 3)
`tsc`, `esbuild`, `pnpm build`, `pnpm --filter * build`, `npm run build`,
`yarn build`, `go build`, `cargo build`, `make`, `docker build`, and others.

### Typecheck (clearing_threshold: 3)
`tsc --noEmit`, `pnpm typecheck`, `pnpm --filter * typecheck`, `npm run typecheck`,
`mypy`, `pyright`, `pytype`, `go vet`.

### Test (clearing_threshold: 3)
`vitest`, `jest`, `pnpm test`, `pnpm --filter * test`, `npm test`, `pytest`,
`python -m pytest`, `go test`, `cargo test`, and others.

### Lint (clearing_threshold: 5)
`eslint`, `pnpm lint`, `pnpm --filter * lint`, `npm run lint`, `ruff`,
`flake8`, `pylint`, `golangci-lint`, `cargo clippy`, and others.

### Command Runners (prefix stripped before matching)
**Node.js:** `npx`, `pnpx`, `bunx`, `pnpm dlx`, `pnpm exec`, `bun run`,
`yarn dlx`, `yarn exec`, `npm exec`
**Python:** `uv run`, `poetry run`, `pipx run`, `pdm run`, `hatch run`, `conda run`
**Ruby:** `bundle exec`
**.NET:** `dotnet tool run`
