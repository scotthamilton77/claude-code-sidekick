# Session Title Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent session title drift when users issue procedural instructions (git ops, PR creation, pushing) by adding prompt guidance to `session-summary.prompt.txt`.

**Architecture:** Single prompt section (`<title_stability>`) added inside `<session_title_rules>` after `<outcome_vs_approach>`. No code, schema, or config changes. Title resists procedural drift; `latest_intent` freely reflects current action.

**Tech Stack:** Prompt engineering (Mustache template)

**Issue:** sidekick-z56w
**Date:** 2026-03-06
**Status:** Approved

## Problem

The session title LLM prompt treats all user messages with equal weight. Procedural instructions like "create a PR," "push it," or "merge to main" override the established session topic, causing title drift from the real work to transient mechanics.

## Decision

Prompt-only fix using Approach A: a single `<title_stability>` section added to `session-summary.prompt.txt` inside `<session_title_rules>`, after the existing `<outcome_vs_approach>` block.

Combines three concerns:
1. **Procedural awareness** - Classify git/PR/deploy/housekeeping as session-ending mechanics, not session-defining work
2. **Stability bias** - Title change threshold scales with previous confidence
3. **Asymmetric treatment** - Title resists drift; `latest_intent` freely reflects current action

## Design

### New Prompt Section: `<title_stability>`

```xml
<title_stability>
CRITICAL: The session title is an ANCHOR, not a weather vane.

When previousConfidence is >0.8, the title has been validated. It should only change
if the user genuinely pivots to a different task — not because they issued a
procedural or mechanical instruction.

  <procedural_instructions>
    These are session-ending mechanics, NOT session-defining work:
    - Git operations: commit, push, pull, rebase, merge, stash, checkout, branch
    - PR/review: create PR, open PR, merge PR, request review, approve
    - Deployment: deploy, publish, release, push to remote
    - Housekeeping: clean up, close issues, update status, run linters

    When the most recent user message is procedural:
    - session_title: KEEP the established title (do not change)
    - latest_intent: Freely reflect the procedural action
    - pivot_detected: false
  </procedural_instructions>

  <stability_bias>
    Title change threshold scales with confidence:
    - previousConfidence >0.8: Only change on genuine task pivot (new domain, new goal)
    - previousConfidence 0.6-0.8: Refine freely (more specific on same topic),
      but only pivot if the new direction is clearly unrelated
    - previousConfidence <=0.5: Change freely — direction is still forming

    Ask: "If someone reviewed this session tomorrow, would they say the user
    switched projects — or just finished up their current one?"
  </stability_bias>

  <edge_cases>
    - "Set up CI/CD pipeline" after working on a feature -> IS a pivot (new goal)
    - "Push it" after working on a feature -> NOT a pivot (finishing current work)
    - "Now let's work on the auth bug" -> IS a pivot (explicitly new task)
    - "Create a PR for this" -> NOT a pivot (shipping current work)
  </edge_cases>
</title_stability>
```

### What Changes

- **One file:** `assets/sidekick/prompts/session-summary.prompt.txt`
- **One section added:** `<title_stability>` inside `<session_title_rules>`, after `<outcome_vs_approach>`

### What Does NOT Change

- **Schema** - no changes to `session-summary.schema.json`
- **Handler code** - no changes to `update-summary.ts`
- **Defaults** - no changes to config YAML
- **`latest_intent` behavior** - freely reflects current action, including procedural
- **`pivot_detected` logic** - existing guidance stays, this reinforces it

## Alternatives Considered

- **Approach B (Distributed):** Scatter guidance across existing sections. Rejected: harder for LLM to connect the dots.
- **Approach C (Classification Taxonomy):** Full message taxonomy (substantive/procedural/meta/exploratory). Rejected: over-engineered, YAGNI.
- **Hard filtering:** Completely ignore procedural messages for title. Rejected: loses ability to detect genuine pivots that start with procedural language (e.g., "Set up CI/CD").

---

## Implementation Tasks

### Task 1: Create feature branch in worktree

**Step 1: Create worktree from main**

Run: `git worktree add ../claude-code-sidekick-title-stability fix/session-title-stability main`

Expected: New worktree created at `../claude-code-sidekick-title-stability` on branch `fix/session-title-stability`

### Task 2: Add `<title_stability>` section to prompt

**Files:**
- Modify: `assets/sidekick/prompts/session-summary.prompt.txt:128` (after `</outcome_vs_approach>`)

**Step 1: Add the new section**

Insert after line 128 (`</outcome_vs_approach>`), before line 129 (`</session_title_rules>`):

```xml
<title_stability>
CRITICAL: The session title is an ANCHOR, not a weather vane.

When previousConfidence is >0.8, the title has been validated. It should only change
if the user genuinely pivots to a different task — not because they issued a
procedural or mechanical instruction.

  <procedural_instructions>
    These are session-ending mechanics, NOT session-defining work:
    - Git operations: commit, push, pull, rebase, merge, stash, checkout, branch
    - PR/review: create PR, open PR, merge PR, request review, approve
    - Deployment: deploy, publish, release, push to remote
    - Housekeeping: clean up, close issues, update status, run linters

    When the most recent user message is procedural:
    - session_title: KEEP the established title (do not change)
    - latest_intent: Freely reflect the procedural action
    - pivot_detected: false
  </procedural_instructions>

  <stability_bias>
    Title change threshold scales with confidence:
    - previousConfidence >0.8: Only change on genuine task pivot (new domain, new goal)
    - previousConfidence 0.6-0.8: Refine freely (more specific on same topic),
      but only pivot if the new direction is clearly unrelated
    - previousConfidence <=0.5: Change freely — direction is still forming

    Ask: "If someone reviewed this session tomorrow, would they say the user
    switched projects — or just finished up their current one?"
  </stability_bias>

  <edge_cases>
    - "Set up CI/CD pipeline" after working on a feature -> IS a pivot (new goal)
    - "Push it" after working on a feature -> NOT a pivot (finishing current work)
    - "Now let's work on the auth bug" -> IS a pivot (explicitly new task)
    - "Create a PR for this" -> NOT a pivot (shipping current work)
  </edge_cases>
</title_stability>
```

**Step 2: Verify the prompt file is well-formed**

Run: `head -n 170 assets/sidekick/prompts/session-summary.prompt.txt` (from worktree)

Expected: `<title_stability>` appears between `</outcome_vs_approach>` and `</session_title_rules>`

**Step 3: Commit**

```bash
git add assets/sidekick/prompts/session-summary.prompt.txt
git commit -m "fix(session-summary): add title stability bias to prevent procedural drift"
```

### Task 3: Verify build passes

**Step 1: Run build and typecheck**

Run: `pnpm build && pnpm typecheck`

Expected: PASS (prompt-only change, no TS impact)

**Step 2: Run lint**

Run: `pnpm lint`

Expected: PASS

**Step 3: Run session-summary tests**

Run: `pnpm --filter @sidekick/feature-session-summary test`

Expected: PASS (no test logic changed)

### Task 4: Open PR

**Step 1: Push branch**

Run: `git push -u origin fix/session-title-stability`

**Step 2: Create PR**

```bash
gh pr create --title "fix(session-summary): prevent title drift on procedural instructions" --body "$(cat <<'EOF'
## Summary

- Adds `<title_stability>` section to the session summary prompt template
- Teaches the LLM to treat git/PR/deploy/housekeeping as session-ending mechanics, not session-defining work
- Title change threshold scales with previous confidence (high = resist, low = allow)
- `latest_intent` continues to freely reflect current action (asymmetric treatment)

Fixes sidekick-z56w

## Test plan

- [ ] Build passes (`pnpm build && pnpm typecheck && pnpm lint`)
- [ ] Existing session-summary tests pass
- [ ] Manual: Start session, work on a feature, then say "create a PR" — title should stay anchored
- [ ] Manual: Start session, work on a feature, then say "now let's fix the auth bug" — title should pivot
EOF
)"
```
