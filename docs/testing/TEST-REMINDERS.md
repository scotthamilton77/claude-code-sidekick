# Testing P&R and VC Reminder Behaviors

## Overview

This document describes manual integration tests for the **pause-and-reflect (P&R)** and **verify-completion (VC)** reminder system in Sidekick. These tests verify the interaction between the two reminder types and their threshold/reset behaviors.

## Configuration

Before testing, ensure:
- **Daemon is running** (watches transcript, stages reminders)
- **CLI hooks are installed** (consume staged reminders)
- **`pause_and_reflect_threshold: 5`** in the reminders config

## Key Behaviors Under Test

| # | Behavior | Description |
|---|----------|-------------|
| 1 | P&R threshold timing | Staged after 5th tool, consumed before 6th |
| 2 | VC resets P&R baseline | After VC consumption, need 5 MORE tools for P&R |
| 3 | P&R staging unstages VC | Prevents cascade where P&R blocks then VC fires |
| 4 | VC single-fire per turn | VC only consumed once between UserPromptSubmit hooks |
| 5 | UserPromptSubmit clears all | New prompt unstages both reminders, resets counters |

---

## Scenario 1: Basic P&R Threshold Timing

**Goal**: Verify P&R appears on the 6th tool use (staged after 5th, consumed before 6th).

**Steps**:
1. Start a fresh session (new user prompt)
2. Perform 5 Read operations on different files
3. **Observe**: No P&R reminder yet (staged but not consumed)
4. Perform 6th Read operation
5. **Expected**: P&R reminder appears as `<system-reminder>` before 6th tool

**Pass Criteria**: P&R reminder injected before 6th tool executes.

---

## Scenario 2: VC Consumption Resets P&R Baseline

**Goal**: After VC consumption, P&R counter resets - need 5 more tools.

**Steps**:
1. Start fresh turn
2. Perform 3-4 Read operations (under threshold)
3. Create a test source file to trigger VC staging:
   ```
   Write: /tmp/claude/test-vc-scenario2.ts
   Content: export const test = 'scenario2'
   ```
4. Stop (or let Claude naturally stop) → VC reminder appears
5. User confirms, Claude continues
6. Perform 5 more Read operations (tools 1-5 relative to VC)
7. **Expected**: No P&R yet
8. Perform 6th Read after VC
9. **Expected**: P&R reminder appears

**Pass Criteria**: P&R triggers 6 tools after VC consumption, not 6 from turn start.

---

## Scenario 3: P&R Staging Unstages VC

**Goal**: When P&R is staged, pending VC is removed.

**Steps**:
1. Start fresh turn
2. Create test source file early (tool 1-2):
   ```
   Write: /tmp/claude/test-vc-scenario3.ts
   Content: export const test = 'scenario3'
   ```
3. Verify VC staged: `ls .sidekick/sessions/*/stage/Stop/`
4. Perform 4 more Read operations (tools 3-6)
5. On tool 6: P&R threshold met → P&R staged, VC deleted
6. Verify VC unstaged: `ls .sidekick/sessions/*/stage/Stop/`
7. Attempt to stop
8. **Expected**: No VC reminder

**Pass Criteria**: VC not present when stopping after P&R was staged.

---

## Scenario 4: VC Single-Consumption Per Turn

**Goal**: VC only fires once per turn.

**Steps**:
1. Start fresh turn
2. Create test file A:
   ```
   Write: /tmp/claude/test-vc-scenario4a.ts
   Content: export const a = 1
   ```
3. Stop → VC consumed
4. User confirms, Claude continues
5. Create test file B:
   ```
   Write: /tmp/claude/test-vc-scenario4b.ts
   Content: export const b = 2
   ```
6. **Expected**: VC NOT re-staged (same turn)
7. Stop again
8. **Expected**: No VC reminder

**Pass Criteria**: Second stop does not trigger VC.

---

## Scenario 5: UserPromptSubmit Unstages Both

**Goal**: New user prompt clears staged reminders.

**Steps**:
1. Create test source file (stages VC)
2. Perform 4 more Reads (P&R almost triggered)
3. Verify: VC staged, P&R close to threshold
4. User submits NEW prompt
5. **Expected**: VC unstaged, P&R baseline reset (toolsThisTurn = 0)

**Pass Criteria**: After new prompt, counters reset and VC cleared.

---

## Verification Commands

```bash
# Check staged P&R
ls -la .sidekick/sessions/*/stage/PreToolUse/

# Check staged VC
ls -la .sidekick/sessions/*/stage/Stop/

# Check P&R baseline state
cat .sidekick/sessions/*/state/pr-baseline.json

# Watch daemon logs
tail -f .sidekick/sessions/*/sidekickd.log
```

## Cleanup

```bash
rm -f /tmp/claude/test-vc-*.ts
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| No reminders | Is daemon running? Check `.sidekick/sessions/` exists |
| P&R wrong timing | Verify threshold=5, check if VC reset baseline |
| VC not staging | Only triggers for source files (.ts, .js, .py, etc.) |
