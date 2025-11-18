# Topic Extraction Redesign

## Overview

Redesigned topic extraction to better support the actual use case: helping users identify which terminal/session is which when multitasking across multiple Claude Code sessions.

## Core Concept

Extract two pieces of information:
1. **session_title**: High-level persistent summary of what the session is working on
2. **last_ask**: What the user wanted in their most recent prompt (with context)

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
  "last_ask": "Fix tracking-disabled test expectations and update documentation",
  "last_ask_confidence": 0.95,
  "last_ask_key_phrases": [
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

**last_ask**
- What user wanted in their most recent prompt
- Uses conversation context to interpret vague prompts ("do it", "continue")
- Multi-instruction prompts: capture ALL instructions
  - Example: "Fix tests, update docs, commit" → all three captured
- Meta-requests: keep existing state (don't update for "what are we doing?")

**last_ask_confidence** (0.0 - 1.0)
- How confident the LLM is about interpreting the last ask
- Higher when: explicit instructions, clear context
- Lower when: vague references, ambiguous phrasing

**last_ask_key_phrases**
- Array of 2-5 key phrases that support the interpretation
- Direct quotes from user messages preferred
- Shows evidence trail for confidence level

## Orchestration Logic (Outside LLM)

The bash script handles:

### 1. Analysis Trigger Logic

**Separate thresholds for title vs ask:**

| Title Confidence | Re-analyze Title |
|-----------------|------------------|
| < 0.6 | Every 5 tool calls OR user prompt |
| 0.6-0.8 | Every 20 tool calls OR user prompt |
| > 0.8 | Only on user prompt |

| Ask Confidence | Re-analyze Ask |
|----------------|----------------|
| < 0.6 | Every 5 tool calls OR user prompt |
| 0.6-0.8 | Every 20 tool calls OR user prompt |
| > 0.8 | Only on user prompt |

**Always analyze on:**
- UserPromptSubmit hook (regardless of tool counts)
- Session start (initial extraction)

### 2. Hard Pivot Detection

**Trigger:** LLM determines semantic distance between current and new session focus

**Action when detected:**
- Reset `session_title_confidence` to **0.5 or lower**
- Allow follow-up transcript context to raise and refine
- New title likely very different from previous

### 3. Meta-Request Handling

**Examples:** "what are we working on?", "/context", "show me the status"

**Action:**
- Keep existing `session_title` and `last_ask` (don't update)
- Apply **configurable confidence penalty** (default: -0.2)
  - Example: 0.85 → 0.65
- Rationale: Meta-requests may indicate confusion, verify understanding more frequently

**Configuration:**
```bash
# In config
META_REQUEST_CONFIDENCE_PENALTY=0.2  # Subtracted from both confidences
```

### 4. Multi-Instruction Capture

**Example user prompt:** "Fix the tests, update the docs, then commit the changes"

**LLM extraction:**
```json
{
  "last_ask": "Fix tests, update documentation, and commit changes",
  "last_ask_confidence": 0.95,
  "last_ask_key_phrases": [
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
- Carry forward `session_title` and `last_ask` from previous session
- Include in continuation summary passed to LLM
- Initial confidence for continued session: **0.7** (medium - we have context but it's summarized)
- Re-analyze immediately to verify accuracy

### 7. State Tracking (Outside Schema)

Script maintains:
```bash
# Per-session state file (.claude/sessions/{id}/topic-state.sh)
TOPIC_TOOL_COUNT=47                    # Current tool count
TOPIC_TITLE_NEXT_ANALYSIS=52           # Analyze title at tool count 52
TOPIC_ASK_NEXT_ANALYSIS="user_prompt"  # Analyze ask only on next user prompt
TOPIC_LAST_USER_PROMPT_COUNT=3         # Number of user prompts so far
```

## LLM Prompt Design

### Input Context

**Required for accurate extraction:**
- Last 3-5 user messages (minimum) for `last_ask` context
- Assistant responses to understand work progression
- Current tool use patterns (if available)

### Prompt Instructions

```
Extract the session topic from this conversation transcript.

Output JSON with these fields:

1. session_title: High-level summary of what this session is working on
   - Should be persistent but can evolve/refine over time
   - Detect hard pivots (completely different task) vs refinements
   - Examples: "Refactoring feature flags" → "Refactoring feature flag dependencies" (refinement)
   - Hard pivot: "Refactoring feature flags" → "Debugging LLM providers" (reset confidence)

2. session_title_confidence: 0.0-1.0
   - Higher (>0.8): Clear, specific, consistent focus
   - Medium (0.6-0.8): Reasonably clear but some ambiguity
   - Lower (<0.6): Vague, multiple interpretations, unclear direction

3. session_title_key_phrases: Array of 3-7 key phrases supporting this title
   - Direct quotes from transcript that reinforce the title choice
   - Help explain the confidence level

4. last_ask: What the user wanted in their most recent prompt
   - Use conversation context to interpret vague prompts ("do it", "yes", "continue")
   - If multi-instruction prompt, capture ALL instructions
   - Don't update for meta-requests ("what are we doing?", "/context")

5. last_ask_confidence: 0.0-1.0
   - Higher: Explicit, clear instructions
   - Lower: Vague references, needs context interpretation

6. last_ask_key_phrases: Array of 2-5 key phrases supporting interpretation
   - Direct quotes preferred
   - Show evidence for confidence level

{PREVIOUS_TOPIC_CONTEXT}  # If continuing session, include previous title/ask
```

### Hard Pivot Detection Prompt

```
Compare the current session focus to the new user request.

Is this:
A) A refinement of the same topic (more specific, clearer direction)
B) A hard pivot to a completely different task

If B (hard pivot), set session_title_confidence to 0.5 or lower.

Examples:
- "working on X" → "implementing X with Y approach" = Refinement (keep/increase confidence)
- "working on X" → "forget that, help with Z" = Hard pivot (reset to 0.5)
```

## Implementation Steps

1. **Update schema** (topic.json structure)
   - Remove: initial_goal, current_objective, significant_change, snarky comments
   - Add: session_title, last_ask, confidence scores, key_phrases arrays
   - Keep state tracking external

2. **Rewrite LLM prompt** (topic extraction prompt file)
   - Focus on title + ask extraction
   - Add hard pivot detection guidance
   - Add multi-instruction capture guidance
   - Add meta-request handling note

3. **Update topic-extraction.sh**
   - Implement separate confidence-based triggering (title vs ask)
   - Track tool counts independently
   - Handle UserPromptSubmit always-analyze
   - Apply configurable meta-request penalty
   - Detect hard pivots and reset confidence

4. **Update filtering** (if needed)
   - Ensure 3-5 user messages preserved for context
   - Keep enough history for "do it" interpretation

5. **Update resume.sh**
   - Use session_title instead of initial_goal
   - Include last_ask in continuation context
   - Carry forward to new session

6. **Add configuration options**
   ```bash
   # New config options
   META_REQUEST_CONFIDENCE_PENALTY=0.2
   HARD_PIVOT_CONFIDENCE_RESET=0.5
   TOPIC_TITLE_TRIGGER_LOW=5      # Tool calls when confidence < 0.6
   TOPIC_TITLE_TRIGGER_MED=20     # Tool calls when confidence 0.6-0.8
   TOPIC_ASK_TRIGGER_LOW=5
   TOPIC_ASK_TRIGGER_MED=20
   ```

7. **Test with existing transcripts**
   - ddebe53b-347a-45dd-b421-9e4b9790c367 (feature flag refactoring)
   - Verify refinement vs pivot detection
   - Verify confidence-based triggering
   - Verify multi-instruction capture
   - Verify meta-request handling

8. **Update documentation**
   - ARCH.md: New topic extraction model
   - README.md: Configuration options

## Benefits of This Approach

1. **Cost-efficient**: Only re-analyze when confidence is low
2. **User-focused**: Captures actual intent (last_ask) not just current state
3. **Stable**: High-confidence topics don't churn unnecessarily
4. **Explainable**: Key phrases show evidence for LLM's choices
5. **Flexible**: Separate tracking for title vs ask
6. **Simple**: LLM only extracts info, bash handles orchestration

## Deferred Features

- Snarky comment generation (separate LLM call, later)
- Statusline display format (deferred)
- Multi-task tracking (future enhancement)

## Configuration Reference

```bash
# Topic Extraction Config
TOPIC_EXTRACTION_ENABLED=true

# Confidence thresholds for re-analysis
TOPIC_TITLE_TRIGGER_LOW=5       # Tool calls when confidence < 0.6
TOPIC_TITLE_TRIGGER_MED=20      # Tool calls when confidence 0.6-0.8
TOPIC_ASK_TRIGGER_LOW=5
TOPIC_ASK_TRIGGER_MED=20

# Confidence adjustments
META_REQUEST_CONFIDENCE_PENALTY=0.2   # Subtract when user asks meta-questions
HARD_PIVOT_CONFIDENCE_RESET=0.5       # Reset to this on hard pivot detection

# Initial extraction
TOPIC_EXTRACT_ON_FIRST_MESSAGE=true   # Start extraction immediately

# Context preservation for LLM
TOPIC_MIN_USER_MESSAGES=3             # Keep at least N user messages for context
```
