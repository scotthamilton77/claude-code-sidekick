# Claude Code Subagent & Hook Behavior Reference

Empirical reference for how Claude Code hooks behave during subagent and worktree operations. All findings verified against Claude Code 2.1.92 (2026-04-05) via the [claude-hook-probe](../../../claude-hook-probe) test harness.

This document states observed facts and their implications for Sidekick's architecture. It is the authoritative source — Anthropic's documentation has gaps and occasional contradictions on these topics.

---

## 1. Hook Event Lifecycle

### Which hooks fire where

| Hook Event | Main Agent | Subagent | Notes |
|---|:---:|:---:|---|
| PreToolUse | Yes | Yes | Every tool call in every context |
| PostToolUse | Yes | Yes | Every tool call in every context |
| SubagentStart | — | Yes | Fires in **parent's** hook stream when Agent tool invoked |
| SubagentStop | — | Yes | Fires in **parent's** hook stream when subagent completes |
| Stop | Yes | No | Parent session only; never fires for subagent completion |
| UserPromptSubmit | Yes | No | Parent session only |
| Notification | Yes | No | Parent session only |
| SessionStart | Yes | No | Parent session only |
| SessionEnd | Yes | No | Parent session only |

### Sidekick implications

- **SubagentStart/SubagentStop are reliable.** 13/13 in testing. Sidekick can depend on them for lifecycle tracking.
- **No ghost sessions.** Subagents produce zero SessionStart/SessionEnd/Stop events. Sidekick will never confuse a subagent finishing with a parent session ending.
- **Pre/PostToolUse fire inside subagents.** Every subagent tool call is visible to Sidekick's hooks. The `agent_id` field distinguishes them from parent events.

---

## 2. Identity & State Isolation

### Fields

| Field | On parent events | On subagent events |
|---|---|---|
| `session_id` | Parent UUID | Same parent UUID |
| `agent_id` | Absent | 17-char lowercase hex, stable across all hooks for the same subagent |
| `agent_type` | Absent | Verbatim `subagent_type` value from Agent tool call (e.g., `"env-probe"`, `"Explore"`) |

### Concurrent subagent hooks interleave

When multiple subagents run in parallel, their hook events arrive in wall-clock order, not batched per agent. Events from different agents are interleaved.

### Sidekick implications

- **State MUST be keyed on `(session_id, agent_id)`.** Using `session_id` alone will clobber state during concurrent subagent execution.
- **Detect subagent events** by checking for presence of `agent_id`. Absent = parent event. Present = subagent.
- **`agent_id` is safe as a map key.** It is stable from SubagentStart through SubagentStop, including all intermediate Pre/PostToolUse events.
- **`agent_type` is not normalized.** Custom agents use filename-without-extension (`env-probe`). Built-in agents preserve casing (`Explore`).

---

## 3. Environment Variables

### Execution context comparison

| Variable | Main Agent Bash | Subagent Bash | Hook Process |
|---|:---:|:---:|:---:|
| `CLAUDE_PROJECT_DIR` | Absent | Absent | **Present** (project root) |
| `CLAUDE_SESSION_ID` | Absent | Absent | Present but **empty string** |
| `CLAUDECODE` | `1` | `1` | Untested |
| `CLAUDE_CODE_ENTRYPOINT` | `cli` | `cli` | Untested |
| `CLAUDE_CODE_*` vars | Present | Present | Untested |
| API keys | Inherited | Inherited | Untested |

### Sidekick implications

- **`CLAUDE_PROJECT_DIR` is hook-only.** Not a Bash tool limitation specific to subagents — it's absent from ALL Bash contexts, including the main agent. Sidekick hooks have it; that's all that matters.
- **`CLAUDE_SESSION_ID` is useless.** Empty string in hooks. Use the `session_id` field from the hook JSON payload instead.
- **`CLAUDECODE=1` is the reliable detection mechanism** for "am I running inside Claude Code?" from a Bash script.
- **Subagents inherit the full parent shell environment** including all API keys. No env var isolation between parent and subagent.

---

## 4. Working Directory Behavior

### Two different cwd concepts

| Action | Changes subagent cwd? | Why |
|---|:---:|---|
| `cd /tmp` via Bash tool | No | Bash shell cwd is ephemeral — resets each tool call |
| `EnterWorktree` tool | Yes | Changes the session's canonical cwd, inherited by Agent tool |
| `isolation: "worktree"` on Agent tool | Yes (subagent only) | Creates a new worktree for that subagent |

### Worktree path patterns

| Creation method | Path |
|---|---|
| `isolation: "worktree"` on Agent tool | `.claude/worktrees/agent-{id_prefix}/` |
| `EnterWorktree(name: "foo")` | `.claude/worktrees/foo/` |
| `EnterWorktree()` (no name) | `.claude/worktrees/{random}/` |

### Worktree detection

- **In hooks:** Compare `cwd` to `_CLAUDE_PROJECT_DIR`. If they differ, the event is from a worktree context.
- **In Bash:** `git rev-parse --git-common-dir` returns absolute path to original `.git` in a worktree, relative `.git` in the main repo.
- **Do NOT parse path patterns.** The naming convention varies by creation method and is not guaranteed stable.

### Sidekick implications

- **Subagent `cwd` on hook events is reliable.** It reflects the session's canonical directory, not stale shell state.
- **Worktree detection in hooks is simple:** `cwd != _CLAUDE_PROJECT_DIR`.
- **Sidekick must NOT start a second daemon** when it sees a worktree `cwd`. The worktree is the same project, just a different checkout.

---

## 5. Transcript Paths

### Two transcript path fields

| Field | Present on | Points to |
|---|---|---|
| `transcript_path` | All hook events | **Parent session** transcript: `~/.claude/projects/{slug}/{session_id}.jsonl` |
| `agent_transcript_path` | SubagentStop only | **Subagent's** transcript: `~/.claude/projects/{slug}/{session_id}/subagents/agent-{agent_id}.jsonl` |

### Transcript stability during worktree sessions

The parent session transcript file **does not move** when the session enters a worktree. It continues growing at its original project-root slug path throughout worktree entry and exit.

However, when a **subagent is launched from within a worktree**, the `transcript_path` on that subagent's hook events uses a worktree-derived slug:
```
Original: .../projects/-Users-scott-src-projects-myproject/session.jsonl
From WT:  .../projects/-Users-scott-src-projects-myproject--claude-worktrees-name/session.jsonl
```

This slug directory is created by Claude Code when processing the subagent's hooks. The actual transcript file content remains at the original path.

### Sidekick implications

- **Use `transcript_path` from hook events directly.** Don't derive it from project dir + session ID — the slug can mutate.
- **The `transcript_path` values Sidekick receives from hooks are always valid file paths** that can be read and watched.
- **`agent_transcript_path` on SubagentStop** is the only way to access a subagent's full conversation. Sidekick should capture it at SubagentStop time if needed.
- **Sidekick's `resolveTranscriptPath()` function** should prefer the hook-provided path over reconstruction. If reconstruction is needed as a fallback, it must account for the worktree slug variation.

---

## 6. Context Injection via Hooks

### additionalContext injection

When a hook returns `additionalContext` in `hookSpecificOutput`, it is injected into the agent's conversation as a `<system-reminder>` tag. This applies to both SubagentStart (injected into the subagent) and PreToolUse (injected per-tool-call).

The `systemMessage` top-level field also injects via the same `<system-reminder>` mechanism. There is no privilege distinction between the two injection pathways.

### Supported hook events

The following hook events support `additionalContext` in their response:

| Event | additionalContext | Can block/deny |
|---|:---:|:---:|
| SessionStart | Yes | No |
| UserPromptSubmit | Yes | Yes (`decision: "block"`) |
| PreToolUse | Yes | Yes (`permissionDecision: "deny"`) |
| PostToolUse | Yes | Yes (`decision: "block"`) |
| SubagentStart | Yes | No |
| SubagentStop | No | Yes (`decision: "block"`) |
| Notification | Yes | No |

Note: PreToolUse uses `permissionDecision: "deny"` (inside `hookSpecificOutput`), NOT the top-level `decision: "block"` used by other events.

### Sidekick implications

- **Sidekick CAN inject context into subagents** via SubagentStart hooks returning `additionalContext`. This is the mechanism for Sidekick reminders reaching subagent conversations.
- **The injection appears as `<system-reminder>` tags**, the same mechanism Sidekick already uses for context injection in parent sessions.
- **CLAUDE.md is also visible to subagents** (confirmed). Sidekick instructions in CLAUDE.md will be seen by subagents — this may or may not be desirable.

---

## 7. Subagent Control via Hooks

### The authority hierarchy

```
1. Task prompt (Agent tool's prompt field)     — highest authority
2. SubagentStart additionalContext             — can establish behavioral contracts
3. PreToolUse deny + systemMessage             — can trigger contracts from (2)
4. continue:false, quota notices               — ignored inside subagents
```

### What works and what doesn't

| Mechanism | Stops a subagent? | Notes |
|---|:---:|---|
| `permissionDecision: "deny"` alone | No | Subagent pivots to other tools |
| `additionalContext` hard-stop directive | No | Task prompt overrides |
| `continue: false` | No | Silently ignored in subagent context |
| Top-level `systemMessage` alone | No | Same authority as additionalContext |
| **SubagentStart contract + PreToolUse trigger** | **Yes** | Only reliable pattern |

### The two-phase control pattern

To reliably stop or redirect a subagent mid-flight:

1. **At launch (SubagentStart):** Inject a behavioral contract via `additionalContext`: *"If you receive a denial with reason X, cease tool calls and return a summary."*
2. **At trigger time (PreToolUse):** Return `permissionDecision: "deny"` with the matching reason string.

The contract must be established before the task prompt lands. Without the priming step, nothing in PreToolUse can override the task prompt.

### Sidekick implications

- **Sidekick cannot retrofit stop signals mid-flight.** The control contract must be injected at SubagentStart time.
- **If Sidekick needs a subagent kill switch**, the SubagentStart hook must inject the behavioral contract into every subagent, and the PreToolUse hook must be able to trigger it.
- **Design for this upfront.** The SubagentStart hook is the only window to establish authority. Once the subagent starts executing its task prompt, the task prompt is king.

---

## 8. Permission Mode

`permission_mode` is inherited from the parent session. It appears on SubagentStop, PreToolUse, and PostToolUse, but is absent from SubagentStart.

All testing was done under `bypassPermissions`. Behavior under `default` or `acceptEdits` modes is untested but the inheritance mechanism is confirmed.

### Sidekick implications

- **Sidekick can read `permission_mode` from any Pre/PostToolUse event** to know the session's permission level.
- **Subagents don't change permission mode.** Whatever the parent session uses, subagents inherit.

---

## 9. stop_hook_active

The `stop_hook_active` field exists in the SubagentStop schema but was never populated (always absent) in testing. It indicates whether the subagent has its own Stop hook configured.

When `true`, it signals that the subagent's own Stop hook is handling completion logic, and the parent's SubagentStop handler may want to skip duplicate processing.

### Sidekick implications

- **Future risk.** If a plugin or custom agent defines a Stop hook, Sidekick's SubagentStop handler could duplicate work. Sidekick should check `stop_hook_active` and adjust processing accordingly.
- **Tracked as:** `claude-hook-probe-wgz` (P3 task).

---

## Appendix: Hook Response Format

All hook responses that include `additionalContext` or `permissionDecision` must use the `hookSpecificOutput` wrapper:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Text injected into agent context"
  }
}
```

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Reason shown to agent",
    "additionalContext": "Additional context for agent"
  }
}
```

Bare `{"additionalContext": "..."}` without the wrapper is silently ignored.
