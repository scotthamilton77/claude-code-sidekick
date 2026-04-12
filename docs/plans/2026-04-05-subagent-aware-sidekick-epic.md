# Epic: Subagent-Aware Sidekick

## Context

Claude Code supports multi-agent, multi-worktree sessions — parent agents dispatch subagents via the Agent tool, optionally in isolated worktrees. Sidekick is currently blind to this: Zod schemas strip `agent_id`/`agent_type` from hook input, no SubagentStart/SubagentStop hooks are registered, all state is session-scoped, and features like reminders and verification fire without knowing whether the event came from the parent or a subagent.

The claude-hook-probe experiment (25 questions, 429 events) gave us empirical ground truth about how hooks, env vars, cwd, transcripts, and context injection behave in subagent/worktree contexts. Findings documented in `docs/CLAUDE-CODE-SUBAGENT-HOOK-BEHAVIOR.md`.

**Definition of Done:** Sidekick works flawlessly on multi-agent, multi-worktree sessions, and the UI properly supports and represents these aspects.

---

## Child Tasks

### 1. Hook Pipeline: Accept and Propagate Subagent Identity
_Foundation — everything else depends on this._

Sidekick's hook input schemas currently strip `agent_id` and `agent_type`. These fields need to flow through the full pipeline: Zod schemas → CLI parsing → IPC dispatch → daemon handlers → feature code. Also register for SubagentStart and SubagentStop events (confirmed reliable by probe).

**Existing bead:** `sidekick-z63.5` (partially covers this)

---

### 2. Reminders: Subagent-Aware Firing Rules
_Don't spam subagents with irrelevant reminders._

Sidekick currently injects reminders via UserPromptSubmit, PreToolUse, PostToolUse, and Stop hooks. All of these fire inside subagents (probe confirmed). But most reminders make no sense in subagent context — pause-and-reflect, verify-completion, persona reminders, and stuck-loop detection are parent-session concerns.

Decide per-reminder: should it fire in subagents, be suppressed, or be adapted? Implement filtering based on `agent_id` presence.

**Existing bead:** None

---

### 3. Verification Gates: Cross-Agent Verification Tracking
_Don't ask the parent to verify work the subagent already verified._

The stop hook currently fires verification reminders without knowing that a subagent already ran build/test/lint/typecheck in a worktree. This causes false "you haven't verified" warnings.

Track verification tool invocations across agents. When the parent's Stop hook fires, check whether delegated subagents already passed checks. Handle the worktree case: verification in a worktree is against the subagent's checkout, which may or may not be merged yet.

**Existing bead:** `claude-code-sidekick-42g` (P1 bug — the symptom of this gap)

---

### 4. Session Summary: Reflect Subagent Activity
_The session story should include what subagents did._

Session summary currently generates a title from transcript excerpts. With subagents, the summary should reflect delegated work ("Implemented auth system via 3 subagents") without being confused by interleaved subagent tool calls. Subagents are transient and don't need their own summaries, but the parent summary should capture the full picture.

**Existing bead:** None

---

### 5. Statusline: Subagent Activity Indicators
_Show the user what's happening across agents._

Statusline currently shows tokens, cost, branch, persona. With multi-agent sessions:
- Active subagent count or indicator
- Token/cost metrics should include (or at least not miss) subagent usage
- Branch display when in a worktree should reflect the worktree branch
- Potentially show which agent is currently active

**Existing bead:** None

---

### 6. Monitoring UI: Subagent Lifecycle & Transcript Visualization
_Make subagent work visible and inspectable in the UI._

The UI already has partial subagent support (SubagentTranscript component, transcript API can resolve subagent files). Still needed:
- SubagentStart/SubagentStop events in the timeline panel
- Subagent transcript drill-down from agent_progress entries (bead 0wf)
- Per-subagent LED states (did this subagent's tests pass?)
- Worktree context display (which worktree is the subagent in?)
- Transcript API test gaps for subagent paths (bead zuro)

**Existing beads:** `claude-code-sidekick-0wf` (drill-down feature), `claude-code-sidekick-zuro` (transcript API test gaps)

---

### 7. State Management: Agent-Scoped vs Session-Scoped State
_Some state is per-session, some needs per-agent isolation._

Currently all state lives at `.sidekick/sessions/{sessionId}/state/`. With concurrent subagents, some state gets clobbered:
- **Session-scoped (shared):** Persona, session summary, compaction history
- **Agent-scoped (needs isolation):** Verification tool tracking, reminder throttle state, potentially PR baseline metrics
- **Concurrent access:** Parallel subagents generate interleaved hook events. State writes keyed on `session_id` alone will race.

Design the state isolation model and implement it.

**Existing bead:** None

---

### 8. Worktree: Correct Behavior in Multi-Worktree Sessions
_Sidekick doesn't get confused by worktree paths._

Known issues:
- LSP shows false errors when worktree files exist (bead 73t)
- Daemon must not spawn a second instance when cwd is a worktree
- Git operations should resolve against the correct repo root
- Path resolution for .sidekick/ state should use canonical project root, not worktree path

Probe findings to apply: worktree detection via `cwd != CLAUDE_PROJECT_DIR` in hooks; transcript stays at project root; `.claude/worktrees/` naming varies by creation method.

**Existing bead:** `claude-code-sidekick-73t` (LSP false errors)

---

### 9. SubagentStart Context Injection
_Sidekick can prime subagents at launch time._

The probe proved that SubagentStart `additionalContext` injects into the subagent as a `<system-reminder>` before task instructions. This is the mechanism for Sidekick to:
- Inject relevant project context into subagents
- Establish behavioral contracts (e.g., "report verification results in this format")
- Potentially inject a lightweight persona or session awareness

Design what (if anything) Sidekick should inject, and implement the SubagentStart hook handler.

**Existing bead:** None

---

### 10. End-to-End Testing: Multi-Agent, Multi-Worktree Scenarios
_Prove the definition of done is met._

Integration test scenarios covering:
- Single subagent session (hooks fire, reminders suppressed, verification tracked)
- Concurrent subagents (state isolation, no clobbering)
- Worktree subagent (cwd detection, path resolution, transcript stability)
- Subagent that runs verification tools (parent doesn't re-verify)
- UI rendering of subagent timeline and transcript drill-down

**Existing bead:** None

---

## Existing Bead Mapping

| Bead | Current Priority | Maps to Child | Action |
|------|:---:|---|---|
| `sidekick-z63.5` | P3 | #1 Hook Pipeline | Re-parent under new epic, bump to P1 |
| `claude-code-sidekick-42g` | P1 | #3 Verification Gates | Re-parent under new epic, add dep on #1 |
| `claude-code-sidekick-0wf` | P3 | #6 Monitoring UI | Re-parent under new epic (currently blocked by UI epic) |
| `claude-code-sidekick-zuro` | P3 | #6 Monitoring UI | Re-parent under new epic |
| `claude-code-sidekick-73t` | P3 | #8 Worktree | Re-parent under new epic |

## New Beads Needed

| Child | Type | Priority | Notes |
|---|---|:---:|---|
| #2 Reminders: Subagent-Aware Firing | task | P2 | Depends on #1 |
| #4 Session Summary: Agent Activity | task | P3 | Depends on #1 |
| #5 Statusline: Subagent Indicators | task | P3 | Depends on #1 |
| #7 State Management: Agent Scoping | task | P2 | Depends on #1 |
| #9 SubagentStart Context Injection | feature | P3 | Depends on #1 |
| #10 E2E Testing | task | P2 | Depends on all others |

## Dependency Graph

```
[EPIC: Subagent-Aware Sidekick]
  │
  ├── #1 Hook Pipeline (P1) ← FOUNDATION, do first
  │     ├── #2 Reminders Filtering (P2) ← depends on #1
  │     ├── #3 Verification Gates (P2) ← depends on #1, #7
  │     ├── #4 Session Summary (P3) ← depends on #1
  │     ├── #5 Statusline Indicators (P3) ← depends on #1
  │     ├── #6 Monitoring UI (P2) ← depends on #1
  │     ├── #7 State Management (P2) ← depends on #1
  │     ├── #8 Worktree Correctness (P2) ← partially independent
  │     └── #9 Context Injection (P3) ← depends on #1
  │
  └── #10 E2E Testing (P2) ← depends on all above
```
