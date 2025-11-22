# Session Summary Redesign

## Overview

Redesigned session summary (formerly topic extraction) to better support the actual use case: helping users identify which terminal/session is which when multitasking across multiple Claude Code sessions.

## Core Concept

Extract two pieces of information:

1. **session_title**: High-level persistent summary of what the session is working on
2. **latest_intent**: What the user wanted in their most recent prompt (with context)

Both should be stable once confident, with dynamic re-analysis based on confidence levels.

## Schema (LLM Output)

```json
{
  "session_title": "Refactoring feature flag dependencies",
  "session_title_confidence": 0.92,
  "session_title_key_phrases": [
    "feature flag structure and dependencies",
    "refactor feature flags and dependencies",
    "dependency chain",
    "master switch pattern"
  ],
  "latest_intent": "Fix tracking-disabled test expectations and update documentation",
  "latest_intent_confidence": 0.95,
  "latest_intent_key_phrases": [
    "Fix the tracking-disabled test expectations",
    "proceed with documentation updates",
    "get the tests passing before updating the documentation"
  ]
}
```

### Field Definitions

**session_title**

- High-level, persistent summary of session focus
- Should evolve/refine over time (vague → specific)
- Only changes significantly on hard pivot (user switches to different task)
- Examples:
  - Initial: "Working on feature flags"
  - Refined: "Refactoring feature flag dependencies"
  - Hard pivot: "Debugging LLM provider integration"

**session_title_confidence** (0.0 - 1.0)

- How confident the LLM is about the session title
- Higher when: clear focus, consistent work, specific language
- Lower when: vague prompts, multiple possible interpretations

**session_title_key_phrases**

- Array of 3-7 key phrases from transcript that reinforce the title choice
- Helps explain confidence level
- Provides evidence for the LLM's interpretation

**latest_intent**

- What user wanted in their most recent prompt
- Uses conversation context to interpret vague prompts ("do it", "continue")
- Multi-instruction prompts: capture ALL instructions
  - Example: "Fix tests, update docs, commit" → all three captured
- Meta-requests: keep existing state (don't update for "what are we doing?")

**latest_intent_confidence** (0.0 - 1.0)

- How confident the LLM is about interpreting the latest intent
- Higher when: explicit instructions, clear context
- Lower when: vague references, ambiguous phrasing

**latest_intent_key_phrases**

- Array of 2-5 key phrases that support the interpretation
- Direct quotes from user messages preferred
- Shows evidence trail for confidence level

## Orchestration Logic (Outside LLM)

The bash script handles:

### 1. Analysis Trigger Logic

**Countdown-based triggering:**

Each field (title and intent) has an independent countdown counter that decrements on every tool call. When either counter reaches 0, we trigger a single LLM call that extracts both fields.

**Countdown reset values based on confidence:**

| Confidence Level | Reset Value | Meaning                               |
| ---------------- | ----------- | ------------------------------------- |
| < 0.6 (Low)      | 5           | Re-analyze in 5 tool calls            |
| 0.6-0.8 (Medium) | 20          | Re-analyze in 20 tool calls           |
| > 0.8 (High)     | 10000       | Effectively never on tool count alone |

**On each tool call:**

```bash
((SUMMARY_TITLE_COUNTDOWN--))
((SUMMARY_INTENT_COUNTDOWN--))

if [[ $SUMMARY_TITLE_COUNTDOWN -le 0 || $SUMMARY_INTENT_COUNTDOWN -le 0 ]]; then
  extract_both_title_and_intent()
  # Reset each countdown independently based on new confidence
fi
```

**Always analyze on:**

- UserPromptSubmit hook (regardless of countdown values)
- Session start (initial extraction)

**Failure Handling:**

- If LLM call fails or returns invalid JSON:
  - Keep previous state values
  - Reset countdowns to short interval (5) to retry soon
  - Do not update confidence (prevents bad data from settling)

**Trade-off:** When one field has low confidence and the other high, the low-confidence countdown will trigger analysis of both fields. This is accepted for consistency and because title/ask inform each other (ask interpretation needs title context, pivot detection needs both).

### 2. Hard Pivot Detection

**Integration:** Hard pivot detection is integrated into the main extraction prompt (not a separate LLM call). The LLM compares the previous session focus with the current work to determine if this is a refinement or a pivot.

**Action when pivot detected:**

- LLM sets `session_title_confidence` to **0.5 or lower**
- This triggers more frequent re-analysis (countdown resets to 5)
- New title likely very different from previous
- Follow-up context allows refinement and confidence increase

### 3. Meta-Request Handling

**Examples:** "what are we working on?", "/context", "show me the status"

**Action:**

- Keep existing `session_title` and `latest_intent` (don't update)
- Assume lower confidence in analysis
- Rationale: Meta-requests may indicate confusion, verify understanding more frequently

NOTE: this is currently tackled as part of the prompt instructions.

### 4. Multi-Instruction Capture

**Example user prompt:** "Fix the tests, update the docs, then commit the changes"

**LLM extraction:**

```json
{
  "latest_intent": "Fix tests, update documentation, and commit changes",
  "latest_intent_confidence": 0.95,
  "latest_intent_key_phrases": [
    "Fix the tests",
    "update the docs",
    "commit the changes"
  ]
}
```

All instructions captured, not just currently active one.

### 5. Initial Extraction Timing

**Trigger:** First user message in session

**Behavior:**

- Extract even if vague (e.g., "hello" or "help me with X")
- Initial confidence will be low (< 0.6)
- Triggers frequent re-analysis (every 5 tool calls)
- Refines quickly as conversation progresses

### 6. Multi-Session Continuity

**On session continuation:**

- Carry forward `session_title` and `latest_intent` from previous session
- Include in continuation summary passed to LLM
- Initial confidence for continued session: **0.7** (medium - we have context but it's summarized)
- Re-analyze immediately to verify accuracy

### 7. State Tracking (Outside Schema)

Script maintains countdown counters that decrement on each tool call:

```bash
# Per-session state file (.claude/sessions/{id}/session-summary-state.sh)
SUMMARY_TITLE_COUNTDOWN=15               # Analyze title in 15 tool calls (or when ≤0)
SUMMARY_INTENT_COUNTDOWN=3               # Analyze intent in 3 tool calls (or when ≤0)
```

**Countdown reset logic after extraction:**

```bash
# Based on new confidence from LLM
if (( $(bc <<< "$confidence < 0.6") )); then
  COUNTDOWN=5                          # Low confidence: frequent re-analysis
elif (( $(bc <<< "$confidence < 0.8") )); then
  COUNTDOWN=20                         # Medium confidence: periodic re-analysis
else
  COUNTDOWN=10000                      # High confidence: only on user prompt
fi
```

**Note:** No special number semantics. The value `10000` for high confidence is simply a practical threshold that won't be reached in normal sessions before UserPromptSubmit triggers.

### 8. Context Windowing and Bookmarking

**Optimization:** Track the transcript line number where we last achieved high confidence to enable efficient context windowing.

**Bookmark tracking:**

```bash
# In state file
SUMMARY_TITLE_CONFIDENCE_BOOKMARK=150    # Line where title reached ≥0.8 confidence
```

**When to set bookmark:**

- When `session_title_confidence` reaches ≥ 0.8 (high confidence)
- Or when confidence increases while already ≥ 0.8
- Store the current transcript line number

**When to reset bookmark (use full transcript):**

- Confidence drops below 0.7
- Meta-request detected (user might need full context)
- Manual reset via config flag

**When to USE bookmark (split transcript):**

- Whenever a valid bookmark exists (`bookmark_line > 0` and `current_line > bookmark_line`)
- Historical context (lines 1 to bookmark) gets aggressive filtering
- Recent activity (lines bookmark+1 to current) gets light filtering
- Note: May fall back to full mode if filtered result has insufficient context (safety check)

**Two-section prompt structure:**

Instead of truncating pre-bookmark context, we label it to guide LLM attention:

```
HISTORICAL CONTEXT (lines 1-150, led to previous analysis)
- More aggressively filtered (it's settled, just provides anchoring)
- Remove routine tool completions, collapse repetitive patterns
- Keep conversation structure and key decisions

RECENT ACTIVITY (lines 151-200, since last analysis)
- Less aggressively filtered (this is the active signal)
- Preserve user messages in full
- Keep assistant responses with context
- Retain tool use patterns
```

**Benefits:**

- LLM knows historical section is "decided" (confidence 0.85) - reduces random variance
- LLM focuses analysis on recent activity for refinement/pivot detection
- No context loss (unlike truncation) - can still refine based on full arc
- Tiered filtering optimizes token usage without sacrificing needed context
- Clear temporal structure prevents random flip-flopping

**Token savings:**

- Full transcript: 500 lines (~15k tokens filtered)
- With bookmarking: Historical (150 lines, heavily filtered ~2k) + Recent (100 lines, lightly filtered ~3k) = ~5k tokens
- **~65% reduction** for stable high-confidence sessions

## LLM Prompt Design

### Input Context

**Two-tiered transcript structure:**

When `session_title_confidence` ≥ 0.8 and bookmark exists, divide transcript into labeled sections:

**Historical Context (pre-bookmark):**

- Heavily filtered: Remove routine tool calls, collapse repetitive patterns
- Purpose: Provide anchoring context for the settled high-confidence title
- LLM instruction: Treat as decided background, don't randomly revisit

**Recent Activity (post-bookmark):**

- Lightly filtered: Preserve user messages, assistant responses, tool patterns
- **Crucial:** Retain tool outputs (errors, summaries) as they often drive pivots
- Purpose: Active signal for refinement/pivot detection
- LLM instruction: Focus analysis here for changes

**Always preserve regardless of bookmark:**

- Minimum last 5 user messages (critical for `last_ask` interpretation)
- Minimum last 50 transcript lines (safety net for vague references)

**When no bookmark (confidence < 0.8):**

- Use full transcript with standard filtering
- No section division needed

### Prompt Instructions

Single LLM call that extracts both title/intent and detects hard pivots.

**When bookmark exists (high confidence):**

```
Extract the session summary from this conversation transcript.

Previous analysis (line {bookmark_line}, confidence {previous_confidence}):
{
  "session_title": "{previous_title}",
  "session_title_confidence": {previous_confidence},
  "session_title_key_phrases": {previous_key_phrases},
  "latest_intent": "{previous_intent}",
  "latest_intent_confidence": {previous_intent_confidence}
}

════════════════════════════════════════════════════════
HISTORICAL CONTEXT (lines 1-{bookmark_line})
This context was analyzed to produce the previous high-confidence conclusion above.
Treat as settled background - only revisit if recent activity contradicts it.
════════════════════════════════════════════════════════

{historical_transcript}

════════════════════════════════════════════════════════
RECENT ACTIVITY (lines {bookmark_line+1}-{current_line})
New activity since last analysis. Focus here for refinement/pivot detection.
════════════════════════════════════════════════════════

{recent_transcript}

Output JSON with these fields:

1. session_title: High-level summary of what this session is working on
   - Should be persistent but can evolve/refine over time
   - Compare to previous title to determine if this is:
     * Unchanged: New information does not materially change the current session_title
     * Refinement: More specific/clearer direction on same topic (maintain/increase confidence)
     * Hard pivot: Completely different task (set confidence to 0.5 or lower)
   - Examples:
     * "Refactoring feature flags" → "Refactoring feature flag dependencies" = Refinement
     * "Refactoring feature flags" → "Debugging LLM providers" = Hard pivot (low confidence)

2. session_title_confidence: 0.0-1.0
   - Higher (>0.8): Clear, specific, consistent focus
   - Medium (0.6-0.8): Reasonably clear but some ambiguity
   - Lower (≤0.5): Hard pivot detected, vague direction, or multiple interpretations
   - Reset to ≤0.5 if hard pivot detected

3. session_title_key_phrases: Array of 3-7 key phrases supporting this title
   - Direct quotes from transcript that reinforce the title choice
   - Help explain the confidence level

4. latest_intent: What the user wanted in their most recent prompt
   - Use conversation context (including session_title) to interpret vague prompts ("do it", "yes", "continue")
   - If multi-instruction prompt, capture ALL instructions
   - Don't update for meta-requests ("what are we doing?", "/context")

5. latest_intent_confidence: 0.0-1.0
   - Higher: Explicit, clear instructions
   - Lower: Vague references, needs context interpretation

6. latest_intent_key_phrases: Array of 2-5 key phrases supporting interpretation
   - Direct quotes preferred
   - Show evidence for confidence level

Analysis instructions:
- The historical context resulted in the previous high-confidence analysis
- Focus on recent activity to determine if refinement or pivot is needed
- Only update session_title if recent activity shows clear evolution or hard pivot
- Use historical context to understand session arc, but weight recent activity more heavily
- Avoid randomly changing high-confidence fields based on noise
```

**When no bookmark (confidence < 0.8):**

```
Extract the session summary from this conversation transcript.

Previous analysis (confidence {previous_confidence}):
{
  "session_title": "{previous_title}",
  "session_title_key_phrases": {previous_key_phrases},
  "latest_intent": "{previous_intent}"
}

{filtered_transcript}

Output JSON with these fields:
[Same field definitions as above]
```

## Implementation Steps

1. **Update schema** (session-summary.json structure)

   - Remove: initial_goal, current_objective, significant_change, snarky comments
   - Add: session_title, latest_intent, confidence scores, key_phrases arrays
   - Keep state tracking external

2. **Rewrite LLM prompt** (session summary prompt file)

   - Focus on title + intent extraction
   - Add hard pivot detection guidance
   - Add multi-instruction capture guidance
   - Add meta-request handling note

3. **Update session-summary.sh**

   - Implement countdown-based triggering (separate counters for title vs intent)
   - Decrement both counters on each tool call
   - Trigger extraction when either countdown ≤ 0
   - Handle UserPromptSubmit always-analyze (regardless of countdowns)
   - Apply configurable meta-request penalty
   - Reset countdowns based on new confidence after extraction
   - **Bookmark tracking:**
     - Set bookmark when title confidence reaches ≥ 0.8
     - Reset bookmark when confidence drops below 0.7 or on meta-request
     - Use bookmark to divide transcript into historical/recent sections

4. **Update filtering** (implement tiered approach)

   - **Historical context (pre-bookmark, when confidence ≥ 0.8):**
     - More aggressive filtering: remove routine tool calls
     - Keep conversation structure and key decisions only
   - **Recent activity (post-bookmark, or full transcript when confidence < 0.8):**
     - Less aggressive filtering: preserve user messages, assistant responses, tool patterns
   - **Always preserve regardless of filtering tier:**
     - Minimum last 5 user messages (critical for latest_intent interpretation)
     - Minimum last 50 transcript lines (safety net)

5. **Update resume.sh**

   - Use session_title instead of initial_goal
   - Include latest_intent in continuation context
   - Carry forward to new session

6. **Add configuration options**

   ```bash
   # New config options
   SUMMARY_COUNTDOWN_LOW=5          # Countdown reset value when confidence < 0.6
   SUMMARY_COUNTDOWN_MED=20         # Countdown reset value when confidence 0.6-0.8
   SUMMARY_COUNTDOWN_HIGH=10000     # Countdown reset value when confidence > 0.8
   ```

7. **Test with existing transcripts**

   - ddebe53b-347a-45dd-b421-9e4b9790c367 (feature flag refactoring)
   - Verify refinement vs pivot detection
   - Verify confidence-based triggering
   - Verify multi-instruction capture
   - Verify meta-request handling

8. **Update documentation**
   - ARCH.md: New session summary model
   - README.md: Configuration options

## Benefits of This Approach

1. **Cost-efficient**: Only re-analyze when confidence is low, plus bookmark optimization reduces tokens by ~65% for stable sessions
2. **User-focused**: Captures actual intent (latest_intent) not just current state
3. **Stable**: High-confidence topics don't churn unnecessarily - labeled sections reduce random variance
4. **Explainable**: Key phrases show evidence for LLM's choices
5. **Flexible**: Separate tracking for title vs intent
6. **Simple**: LLM only extracts info, bash handles orchestration
7. **Smart context windowing**: Two-section prompts guide LLM attention without losing context

## Deferred Features

- Snarky comment generation (separate LLM call, later)
- Statusline display format (deferred)
- Multi-task tracking (future enhancement)

## Configuration Reference

```bash
# Session Summary Config
SESSION_SUMMARY_ENABLED=true

# Countdown reset values based on confidence
# Each field (title and intent) uses these values after extraction
SUMMARY_COUNTDOWN_LOW=5          # Reset value when confidence < 0.6 (frequent re-analysis)
SUMMARY_COUNTDOWN_MED=20         # Reset value when confidence 0.6-0.8 (periodic re-analysis)
SUMMARY_COUNTDOWN_HIGH=10000     # Reset value when confidence > 0.8 (effectively only on user prompt)

# Bookmark optimization (context windowing)
SUMMARY_BOOKMARK_CONFIDENCE_THRESHOLD=0.8    # Set bookmark when title reaches this confidence
SUMMARY_BOOKMARK_RESET_THRESHOLD=0.7         # Reset bookmark if confidence drops below this
SUMMARY_BOOKMARK_ENABLED=true                # Enable bookmark-based context windowing

# Initial extraction
SUMMARY_EXTRACT_ON_FIRST_MESSAGE=true   # Start extraction immediately

# Context preservation for LLM
SUMMARY_MIN_USER_MESSAGES=5             # Keep at least N user messages for context (critical for latest_intent)
SUMMARY_MIN_RECENT_LINES=50             # Keep at least N recent transcript lines (safety net)
```
