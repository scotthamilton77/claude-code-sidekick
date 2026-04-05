# Claude Hook Probe — Test Harness Design Spec

**Date:** 2026-04-05
**Issue:** claude-code-sidekick-a85
**Purpose:** Empirically capture and document every field Claude Code sends to hooks during subagent operations, with and without worktree isolation, to inform Sidekick's worktree/subagent architecture.

---

## Background

Sidekick's worktree and subagent handling was designed under assumptions that turned out to be wrong:
- We assumed subagents don't fire hooks (they do — per Anthropic docs)
- We assumed subagents have separate session IDs (they share the parent's — per docs)
- We hypothesize `agent_id`/`agent_type` fields are sent but stripped by our Zod schemas (unverified)
- We never registered for `SubagentStart`/`SubagentStop` hooks

Before designing Sidekick's worktree architecture, we need ground truth about what Claude Code actually sends. This test harness captures that ground truth.

**Caveat:** Several claims above come from Anthropic's documentation, not from observed behavior. This test exists precisely because docs and reality may diverge. All claims are hypotheses until empirically verified.

## Questions to Answer

### Hook Behavior

| # | Question | Why It Matters |
|---|----------|---------------|
| Q1 | Do SubagentStart/SubagentStop hooks fire for settings.json-registered hooks? | If they don't fire reliably (known bug #33049), we can't depend on them for lifecycle tracking. It's also unverified whether these are valid registration keys in settings.json. |
| Q2 | What fields appear on SubagentStart input? (agent_id, agent_type, cwd, transcript_path, etc.) | Determines what metadata we can capture when a subagent launches |
| Q3 | What fields appear on SubagentStop input? (agent_transcript_path, last_assistant_message, etc.) | Determines what we learn when a subagent finishes |
| Q4 | Do PreToolUse/PostToolUse hooks fire INSIDE a subagent? With what fields? | If they fire with the parent's session_id + agent_id, we need to handle state isolation |
| Q5 | When multiple subagents run concurrently, do their hooks interleave? In what order? | Determines whether state clobbering is a real problem vs theoretical |
| Q6 | Does `Stop` fire inside a subagent when it finishes? | We register for Stop — may get unexpected fires from subagent completion |
| Q7 | Do `SessionStart`/`SessionEnd` fire for subagents? | Could confuse Sidekick into thinking the parent session started/ended |
| Q8 | Does hook response `additionalContext` get injected into a subagent's conversation? | If so, Sidekick reminders would leak into subagents |

### Environment & Paths

| # | Question | Why It Matters |
|---|----------|---------------|
| Q9 | What is `$CLAUDE_PROJECT_DIR` inside a normal subagent? Same as parent? | Determines if Sidekick's daemon receives hooks from subagents at all |
| Q10 | What is `$CLAUDE_PROJECT_DIR` inside a worktree subagent? | If it points to the worktree, Sidekick would try to start a second daemon there |
| Q11 | What is `cwd` in hook input for a normal subagent vs a worktree subagent? Does it match `$CLAUDE_PROJECT_DIR`? | Determines where git operations resolve |
| Q12 | What is `transcript_path` for a subagent? Does it use the parent's path encoding? | Determines if Sidekick's transcript resolution works for subagents |
| Q13 | What env vars does a subagent inherit? Are there subagent-specific ones? (`$CLAUDE_SESSION_ID` may or may not exist) | Documents the full environment contract |

### Session Identity

| # | Question | Why It Matters |
|---|----------|---------------|
| Q14 | Do subagent hooks carry the same `session_id` as the parent? | Confirmed by docs but needs empirical verification |
| Q15 | What is `agent_id` format? Is it stable across hooks for the same subagent? | Determines if we can use it as a key for per-agent state |
| Q16 | What is `agent_type` for built-in vs custom subagents? | Determines how to filter/route subagent events |
| Q17 | What is `permission_mode` inside a subagent? Same as parent or different? | Affects Sidekick's hook response logic |

### Context & Configuration

| # | Question | Why It Matters |
|---|----------|---------------|
| Q18 | Does the subagent see the project's CLAUDE.md? Can it confirm? | Docs say yes via "normal message flow" — verify empirically |

---

## Project Setup

**Location:** `~/src/projects/claude-hook-probe`

Must be a git repository (worktree isolation requires git).

### Directory Structure

```
claude-hook-probe/
├── CLAUDE.md                    # Research brief + test protocol for the agent
├── setup.sh                     # Project initialization script
├── analyze.sh                   # Post-test analysis script
├── dummy-file.txt               # Seed file for git operations
├── .gitignore                   # Ignore results/
├── .claude/
│   ├── settings.json            # Hook registrations for ALL events
│   └── agents/
│       ├── env-probe.md         # Subagent: dumps environment (no worktree)
│       └── file-writer.md       # Subagent: dumps environment + makes changes (worktree)
├── hooks/
│   └── capture-hook.sh          # Universal stdin logger
└── results/                     # Created by setup.sh (gitignored)
    ├── hooks/                   # Raw JSONL per hook event
    │   ├── all-events.jsonl     # Unified timeline (merged from per-PID files)
    │   ├── raw/                 # Per-PID capture files (avoids write races)
    │   └── {EventName}.jsonl    # Per-event files
    ├── env/                     # Environment captures from inside subagents
    └── report.md                # Analysis output
```

---

## Component Designs

### 1. Universal Hook Logger (`hooks/capture-hook.sh`)

A single bash script registered for every hook event. Zero processing, zero filtering — just capture.

**Behavior:**
1. Read raw JSON from stdin (with 5-second timeout to avoid blocking on empty pipes)
2. Extract `hook_event_name` via `jq`
3. Enrich the JSON with captured metadata:
   - `_captured_at`: high-precision timestamp via `python3 -c 'import time; print(time.time())'` (macOS `date` lacks nanoseconds)
   - `_CLAUDE_PROJECT_DIR`: from process environment (`$CLAUDE_PROJECT_DIR`)
   - `_CLAUDE_SESSION_ID`: from process environment (may be empty — that's data too)
   - `_PID`: process ID of this hook invocation
   - `_PWD`: working directory of this hook process
4. Write to per-PID file: `results/hooks/raw/{PID}-{timestamp}.jsonl` (avoids write races)
5. Also append to `results/hooks/{hook_event_name}.jsonl` (best-effort for easy browsing)
6. Output `{}` to stdout (no blocking, no interference)

**Key design decisions:**
- **Per-PID files avoid race conditions.** Phase 4 (concurrent subagents) would corrupt shared files. The `analyze.sh` script merges per-PID files into `all-events.jsonl` sorted by timestamp.
- **Absolute path in settings.json.** Hook commands use `$CLAUDE_PROJECT_DIR/hooks/capture-hook.sh` to survive cwd changes in worktree subagents.
- **`mkdir -p` at script start.** Creates `results/hooks/raw/` and `results/env/` if they don't exist.
- **Non-blocking.** Always returns `{}` regardless of hook type. Never blocks, never injects context.
- **Graceful degradation.** If `jq` is missing, falls back to raw `cat >> results/hooks/raw/$$.jsonl` without enrichment.

### 2. Hook Registration (`.claude/settings.json`)

Registers for every known hook event:
- `SessionStart`, `SessionEnd`
- `UserPromptSubmit`
- `PreToolUse`, `PostToolUse`
- `Stop`
- `PreCompact`
- `Notification`
- `SubagentStart`, `SubagentStop`

Each registration invokes `bash "$CLAUDE_PROJECT_DIR/hooks/capture-hook.sh"`. No matchers/filters — capture everything.

**Note:** `SubagentStart` and `SubagentStop` may not be valid registration keys in settings.json. If Claude Code silently ignores them, that's a valid finding (Q1 answered as "no"). The remaining hooks still provide subagent data via `agent_id`/`agent_type` fields on standard events.

### 3. Environment Probe Agent (`.claude/agents/env-probe.md`)

A custom subagent whose sole job is to report its internal environment. Spawned WITHOUT worktree isolation.

**Frontmatter:**
```yaml
name: env-probe
description: Probes and reports its environment details for testing
tools: Bash, Read, Glob, Grep
```

**What it captures via Bash tool:**
- `$CLAUDE_PROJECT_DIR`, `$CLAUDE_SESSION_ID` (may be empty), `$PWD`, `$HOME`
- All `CLAUDE_*` env vars (`env | grep -i claude | sort`)
- All env vars (`env | sort`) — for comprehensive Q13 answer
- `git rev-parse --show-toplevel` (git root)
- `git rev-parse --git-common-dir` (detects worktree vs main repo)
- `git worktree list` (sees all worktrees)
- `ls -la .claude/ 2>/dev/null` (what does .claude/ look like from here?)
- `ls -la results/ 2>/dev/null` (can it see the results dir?)
- `head -5 CLAUDE.md 2>/dev/null || echo "CLAUDE.md not visible"` (Q18: does the subagent's filesystem see CLAUDE.md?)

Writes all output to `results/env/probe-{timestamp}.txt` and returns a full summary.

### 4. File Writer Agent (`.claude/agents/file-writer.md`)

Same environment probing as env-probe, plus file modifications. **Does NOT specify `isolation: worktree` in frontmatter** — instead, the CLAUDE.md instructs the parent agent to pass `isolation: "worktree"` when spawning this agent via the Agent tool. This avoids depending on frontmatter support for isolation (which may not work).

**Frontmatter:**
```yaml
name: file-writer
description: Makes file changes to test worktree behavior
tools: Bash, Read, Write, Edit, Glob, Grep
```

**Additional steps beyond env-probe:**
- Creates `worktree-test-{timestamp}.txt` to confirm write access
- Runs `git status` to show worktree state
- Reports relationship between `pwd`, `$CLAUDE_PROJECT_DIR`, and `git rev-parse --show-toplevel`

### 5. CLAUDE.md (Research Brief + Test Protocol)

The CLAUDE.md serves as both research context AND test instructions. It contains:

**Section 1 — Research Context:**
The full list of 18 questions (Q1-Q18) with WHY each matters. This gives the agent full understanding so it can reason about observations and probe deeper when something unexpected appears.

**Section 2 — Test Phases:**

| Phase | What It Does | Questions Targeted | Completion Marker |
|-------|-------------|-------------------|-------------------|
| 0. Preflight | Verify `jq` installed, `results/` dirs exist, git repo initialized | Prerequisites | "PHASE 0 COMPLETE" |
| 1. Baseline | Simple tool calls (echo, read) with no subagents | Establishes parent-only hook baseline | "PHASE 1 COMPLETE" |
| 2. Normal subagent | Spawn `env-probe` (no worktree) | Q1-Q6, Q9, Q11-Q18 | "PHASE 2 COMPLETE" |
| 3. Worktree subagent | Spawn `file-writer` with `isolation: "worktree"` on the Agent tool call | Q10, Q11 specifically | "PHASE 3 COMPLETE" |
| 4. Concurrent subagents | Spawn two `env-probe` agents in a SINGLE message using two parallel Agent tool calls | Q5 (interleaving) | "PHASE 4 COMPLETE" |
| 5. Built-in subagent | Spawn a built-in Explore agent (not a custom agent) | Q16 (agent_type for built-in vs custom) | "PHASE 5 COMPLETE" |
| 6. Data collection | List captured hook files, count events, read and analyze results | All questions | "PHASE 6 COMPLETE" |

**Section 3 — Reporting Instructions:**
After all phases, the agent should:
1. Read `results/hooks/raw/` files and provide a timeline summary
2. For each question Q1-Q18, state: what the data shows, with evidence (quoted JSON)
3. Flag any unexpected fields, missing events, or surprising behavior
4. Note any discrepancies between Anthropic's docs and observed reality
5. Explicitly note which questions could NOT be answered and why

**Section 4 — Decision Tree (Early Exit):**
- If Phase 2 produces zero hook events beyond the parent's Agent tool PostToolUse, the fundamental assumption that subagents fire hooks is wrong. Report this finding and skip Phases 3-5.
- If `SubagentStart.jsonl` is empty after Phase 2, note it but continue — the remaining hooks still provide value.

### 6. Setup Script (`setup.sh`)

Creates the project structure and initializes git:

1. Check prerequisites (`jq`, `git`, `python3`)
2. Create directory structure (`results/hooks/raw/`, `results/env/`)
3. `git init` if not already a repo
4. Create `dummy-file.txt` with seed content
5. `git add . && git commit -m "Initial commit for hook probe test"` (worktree requires at least one commit)
6. Set `chmod +x` on hook scripts and setup/analyze scripts
7. Print success message with next steps

### 7. Analysis Script (`analyze.sh`)

Post-test automation. Runs after the Claude session to produce a structured report.

1. **Merge per-PID files:** Sort `results/hooks/raw/*.jsonl` by `_captured_at` → write `results/hooks/all-events.jsonl`
2. **Split by event type:** From merged file, write per-event-type `.jsonl` files
3. **Field inventory:** For each hook event type, list every JSON field present (using `jq keys`)
4. **Agent identity matrix:** Table of `session_id`, `agent_id`, `agent_type`, `cwd`, `transcript_path`, `_CLAUDE_PROJECT_DIR`, `_PWD` across all events
5. **SubagentStart/Stop check:** Were they captured? What fields did they contain?
6. **Session boundary check:** Did `SessionStart`/`SessionEnd` fire with subagent context?
7. **Concurrent analysis:** For Phase 4, show event timestamps to reveal interleaving patterns
8. **Field diff:** Fields present in subagent events but not parent events (and vice versa)
9. **Cross-reference:** Correlate `results/env/probe-*.txt` with hook data for the same agent

Output goes to `results/report.md`.

---

## Prerequisites

- `jq` installed (`brew install jq` on macOS — NOT available by default)
- `python3` available (for high-precision timestamps; pre-installed on macOS)
- Git initialized with at least one commit
- Claude Code CLI available

## Running the Test

```bash
# 1. Set up the project
cd ~/src/projects/claude-hook-probe
./setup.sh

# 2. Launch Claude Code in the project
claude

# 3. Claude reads CLAUDE.md, executes test phases, reports findings
# (Watch for "PHASE N COMPLETE" markers to track progress)

# 4. After Claude exits, run analysis
./analyze.sh
cat results/report.md
```

## Expected Outputs

1. `results/hooks/all-events.jsonl` — Complete timeline of every hook invocation (merged, sorted)
2. `results/hooks/{EventName}.jsonl` — Per-event-type captures
3. `results/hooks/raw/*.jsonl` — Raw per-PID captures (race-free source of truth)
4. `results/env/probe-*.txt` — Environment dumps from inside subagents
5. `results/report.md` — Structured analysis answering Q1-Q18

## Success Criteria

The test is successful if we have empirical answers (with evidence) for all 18 questions. "The event didn't fire" is a valid answer — it tells us the feature isn't reliable for our use case and we need fallbacks.

## Known Risks

1. **SubagentStart/SubagentStop may not be registrable** in settings.json. The test degrades gracefully — other hooks still capture subagent data via `agent_id`/`agent_type` fields.
2. **`isolation: worktree` in frontmatter may not work** for custom agents. The CLAUDE.md instructs the parent to pass it via the Agent tool invocation as a fallback.
3. **Phase 4 concurrency depends on Claude** choosing to invoke two Agent tools in parallel. The CLAUDE.md explicitly requests this but can't force it.
4. **Hook response injection (Q8) is not directly testable** with a passive logger that returns `{}`. A follow-up test could return `additionalContext` from a subagent hook to observe whether it appears in the subagent's conversation. Noted as out of scope for v1.
