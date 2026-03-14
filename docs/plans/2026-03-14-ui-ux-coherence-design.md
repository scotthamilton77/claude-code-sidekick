# UI/UX Coherence Design

Comprehensive UX redesign addressing 11 open beads that affect the monitoring UI's
visual coherence, interaction model, and data completeness.

**Parent epic:** `sidekick-43a8b12e`

**Beads addressed:** `mcs`, `cxq`, `sz6`, `6iq`, `uyh`, `x6p`, `0wf`, `7cq`, `aqr`,
`je6`, `gtn`

---

## D20: Unified Stream Architecture

**Decision:** The transcript panel becomes the single chronological view of all session
activity. Sidekick events are interleaved into the transcript by timestamp alongside
Claude Code conversation turns.

**What changes:**
- The server-side transcript API merges Claude Code JSONL entries with Sidekick NDJSON
  log entries, correlating by sessionId and ordering by timestamp.
- The response is a single `TranscriptLine[]` containing both sources.
- The timeline panel remains Sidekick-event-only. It serves as a high-level navigation
  aid. Clicking a timeline event scrolls the transcript to the corresponding Sidekick
  event in the unified stream.

**What doesn't change:**
- Timeline panel purpose and data source (Sidekick NDJSON logs only).
- No cross-panel filter coupling. Filtering in the timeline affects only the timeline.
  Filtering in the transcript affects only the transcript.

**Rationale:** Interleaving gives the user a complete chronological narrative. Sidekick
events are not noise in the transcript — they are the explanation for LED state changes.
Seeing `reminder:staged(vcBuild)` appear between assistant messages, with the vcBuild LED
lighting up at that exact row, makes the gutter readable in a way that pure conversation
turns never could.

---

## D21: Filter System — Hide/Show Semantics

**Decision:** Both timeline and transcript use hide/show filter toggles. All categories
selected by default. Deselecting a category hides matching items entirely (not dims them).

**Transcript filter categories (5):**

| Category     | Types included                                                   |
|-------------|------------------------------------------------------------------|
| Conversation | `user-message`, `assistant-message`                              |
| Tools        | `tool-use`, `tool-result` (always toggled together)              |
| Thinking     | Assistant thinking blocks (filtered by presence of `thinking`)   |
| Sidekick     | All 16 `SidekickEventType` values                                |
| System       | `compaction`, `turn-duration`, `api-error`, `pr-link`            |

**Timeline filter categories (5, unchanged):** reminders, decisions, session-analysis,
statusline, errors.

**Behavior change from current timeline:** Currently, selecting a timeline filter
highlights matching items and dims unselected ones. The new behavior is: deselecting a
filter hides matching items entirely. This makes both panels consistent.

**Implementation:** Filter state lives in `NavigationState`. Filtering is client-side
only — the full dataset is fetched, filtering happens in the render path. Both filter bars
use the same component pattern (row of pill toggles).

---

## D22: Tool-Use / Tool-Result Pairing

**Decision:** Tool pairs are connected via gutter lines, in-bubble navigation links, and
hover highlighting. No nesting or reordering.

**Data:** The transcript API captures `toolUseId` from Claude Code's `tool_use` blocks
and the matching `tool_use_id` from `tool_result` blocks in user entries. This is the
correlation key.

**Gutter lines:** A thin vertical connecting line in the LED gutter column links each
tool-use to its corresponding tool-result. When multiple concurrent tools overlap, each
pair gets a distinct subtle hue from a cycling palette (4-5 colors).

**In-bubble navigation:** Each tool-use card shows a small "-> result" link; each
tool-result shows "<- call" link. Clicking jumps to the paired entry and briefly
highlights it.

**Hover highlight:** Hovering over either member of a pair highlights both cards and
the connecting gutter line, making the relationship unambiguous even when lines overlap.

**Edge cases:**
- Orphaned tool-result (no matching tool-use): render normally, no connection.
- Pending tool-use (no result yet, active session): dashed/incomplete gutter line.

**Rationale:** Nesting would break chronological order or create deeply interleaved
collapsibles when 3+ tools run in parallel. Gutter lines preserve chronology while
showing relationships visually.

---

## D23: LED Gutter State Machine

**Decision:** The LED gutter is a continuous downward-flowing state machine. Each row
inherits the LED state of the row above it. Sidekick events are the primary drivers of
LED state transitions.

**State derivation:** The server computes LED states by walking the unified transcript
top-to-bottom during the merge/sort pass. For each Sidekick event that maps to a LED
state change, update the running state. Every `TranscriptLine` in the response includes
its computed `LEDState`.

**Mapping:**
- `reminder:staged` with `reminderType` in payload -> corresponding LED turns on.
- `reminder:unstaged` or `reminder:consumed` -> LED turns off.
- `session-title:changed` with confidence payload -> `titleConfidence` LED level updates.
- All other events: no LED state mutation, inherit from above.

**Server-side computation:** LED state is computed server-side during the merge pass.
This avoids duplicating the state machine logic in the client and ensures the LED data
is always consistent with the interleaved event order.

---

## D24: User Message Subtypes

**Decision:** User messages are classified into subtypes with distinct visual rendering.

| Subtype           | Detection                                        | Rendering                                             |
|-------------------|--------------------------------------------------|-------------------------------------------------------|
| Real user prompt  | No `isMeta`, no XML tags                         | Full prominence, current styling                      |
| System injection  | `isMeta: true`, `<system-reminder>` tags         | Dimmed, collapsed by default, expandable. Gray border |
| Command invocation| Contains `<command-name>` tag                    | Terminal-style pill showing command name. Compact      |
| Skill content     | `isMeta: true`, path-like content                | Dimmed like system injections                         |
| Tool result       | `type: tool-result` within user content           | Already handled, no change                            |

**Detection:** Subtype classification happens server-side during transcript parsing. A new
`userSubtype` field is added to `ApiTranscriptLine` / `TranscriptLine`.

**Filter interaction:** All user subtypes are in the "Conversation" filter category.
Hiding Conversation hides all user subtypes and assistant messages together.

---

## D25: Subagent Transcript Drill-Down

**Decision:** Clicking a subagent (Agent) tool-use in the transcript opens a new
transcript panel to the right. The main transcript shrinks but remains visible. Panels
are scroll-locked by timestamp.

**Panel chain model:**

```
[Main Transcript] -> [Subagent A] -> [Subagent A's child] -> ...
```

**Panel behavior:**
- Each rightward panel is a pure Claude Code transcript (no LED gutter, no Sidekick
  events).
- Each panel except the rightmost shrinks. Any panel can be minimized to a compressed
  label (same pattern as session selector compression).
- All visible panels are scroll-locked by timestamp. Spacers are inserted on whichever
  side has fewer events in a time window to maintain horizontal temporal alignment.
- The purpose is to allow the user to understand concurrent activity across agents in a
  temporally consistent way.

**Navigation:**
- Clicking a different subagent in any panel replaces everything to its right
  (stack-pop-then-push). Only one child chain is visible at a time.
- No sibling subagent comparison (no side-by-side viewing of multiple children).

**Data source:** Subagent transcripts live at
`~/.claude/projects/{projectId}/{sessionId}/subagents/agent-{agentId}.jsonl` with
metadata at `.meta.json`. The linking chain is:
parent `tool_use` ID -> `agent_progress.data.agentId` -> subagent file.

**Scroll-lock implementation:** Both panels share a virtual scroll coordinator that maps
timestamps to vertical positions. When one panel scrolls, the coordinator computes the
corresponding timestamp and scrolls the other panel to match. Spacer elements are
inserted where one panel has events in a time window and the other doesn't, keeping
horizontal alignment.

---

## D26: Expand/Collapse for Large Content

**Decision:** All large content blocks (tool inputs, tool results, thinking blocks,
system injections) support expand/collapse. Collapsed by default with a preview.

**Behavior:**
- Tool inputs: show `formatToolInput()` preview (command, file_path, pattern, etc.).
  Click to expand full JSON.
- Tool results: show first ~3 lines. Click to expand full output.
- Thinking blocks: show first ~3 lines. Click to expand full thinking.
- System injections: fully collapsed by default. Click to expand.

**Syntax highlighting:** JSON content gets basic syntax highlighting. Code content
uses monospace with language detection where possible.

---

## D27: Session Selector Improvements

**Decision:** Sessions within each project are grouped by date.

**Date groups:** Today, Yesterday, This Week, This Month, Older. Each group header
shows session count. Groups collapsed by default except the most recent group.

**Error surfacing (`gtn`):** When a project's session fetch fails, show a yellow
warning badge on the project header with tooltip showing the error message.

---

## D28: Quick Fixes

**Compaction card (`aqr`):** Add `compactionTokensAfter` from
`compactMetadata.postTokens` to the API response. Render token delta as
"X k -> Y k" in the compaction card.

**PR link cards (`je6`):** Render `prUrl` as a clickable truncated link in pr-link
cards. Opens in new tab.

**Missing event type (`uyh`):** Add `reminder:cleared` to `SidekickEventType`,
`TIMELINE_EVENT_TYPES` set, and the timeline `generateLabel()` function.

---

## Beads Mapping

| Decision | Beads resolved |
|----------|---------------|
| D20      | `mcs` (interleave Sidekick events) |
| D21      | (new — filter system redesign) |
| D22      | `cxq` (tool-use/result linking) |
| D23      | (new — LED state machine) |
| D24      | `6iq` (user message subtypes) |
| D25      | `0wf` (subagent drill-down), `sz6` (scroll-sync) |
| D26      | `x6p` (expand/collapse) |
| D27      | `7cq` (session grouping), `gtn` (error surfacing) |
| D28      | `aqr` (compaction), `je6` (PR links), `uyh` (reminder:cleared) |
