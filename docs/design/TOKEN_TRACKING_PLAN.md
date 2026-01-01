# Bug: Compaction Detection & Token Calculation Overhaul

## Problem Statement

The `currentContextTokens` field in `transcript-metrics.json` is designed to track tokens in the **current context window** and reset on compaction, while `tokenUsage` tracks **cumulative session totals**. However, compaction detection is broken - `currentContextTokens` never resets, making it identical to `tokenUsage`.

## Why This Matters

- **User-facing impact**: Statusline shows incorrect context size after compaction
- **Design intent violated**: The two fields exist specifically to diverge at compaction:
  - `tokenUsage`: "How many tokens has this session consumed?" (billing/cost)
  - `currentContextTokens`: "How many tokens are in the current context window?" (context management)

## Investigation Findings

### 1. File-Based Detection Doesn't Work

The current code in `transcript-service.ts` attempts to detect compaction by watching for file size shrinkage. **This never triggers** because Claude Code's transcript is an **append-only log**:

- Compaction appends a `compact_boundary` entry
- Compaction appends an `isCompactSummary` user message with the summary
- Old entries are NOT removed from the `.jsonl` file
- File always grows, never shrinks

### 2. SessionStart Hook Not Fired

We expected `SessionStart` with `startType: "compact"` but **never received it**. Logs show only `startType: "clear"` events. Claude Code doesn't fire this hook on `/compact`.

### 3. What Compaction Actually Looks Like

**compact_boundary entry:**
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "manual",
    "preTokens": 119754
  }
}
```

**Summary injection (next user entry):**
```json
{
  "type": "user",
  "isCompactSummary": true,
  "isVisibleInTranscriptOnly": true,
  "message": {
    "content": "This session is being continued from a previous conversation..."
  }
}
```

### 4. Shadow Content Discovery

Claude Code injects content into the API request that is **NOT logged to the transcript**. After compaction, Claude sees:

```
[System prompt - tools, identity, CLAUDE.md]
[Messages array]:
  ├── <system-reminder> Read tool result: file1.md (full content)    ← NOT in transcript
  ├── <system-reminder> Read tool result: file2.ts (full content)    ← NOT in transcript
  ├── <system-reminder> Read tool result: file3.ts (truncated note)  ← NOT in transcript
  ├── <system-reminder> SessionStart hook                            ← NOT in transcript
  ├── user [isCompactSummary]: "This session is being continued..."  ← In transcript
  ├── user: "hi"                                                     ← In transcript
  └── assistant: [response]                                          ← In transcript
```

**Evidence:** After compaction, `cache_creation_input_tokens: 44,846` on first response, but transcript content is nowhere near that. Claude's thinking block references system-reminders about files that don't appear in transcript.

### 5. Token Accounting Discovery

The usage block in assistant entries provides accurate token counts:

| Field | Meaning | Includes System Prompt? |
|-------|---------|------------------------|
| `input_tokens` | Non-cached input | No |
| `cache_creation_input_tokens` | New content being cached | No |
| `cache_read_input_tokens` | Previously cached content | No |
| `output_tokens` | Model response | N/A |

**Key insight:** `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` = actual context window size (excluding system prompt).

The system prompt (~3.1k tokens) is constant overhead handled separately by the API.

## Proposed Solution

### Token Calculation (Revised)

**Current context window:**
```typescript
// Excludes system prompt - that's added at display time
currentContextTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

**Cumulative usage (all tokens sent to model):**
```typescript
tokenUsage.inputTokens = Σ(input_tokens + cache_creation_input_tokens + cache_read_input_tokens)
tokenUsage.outputTokens = Σ(output_tokens)
```

### State Machine

| State | Trigger | `currentContextTokens` | `tokenUsage` |
|-------|---------|------------------------|--------------|
| **New session** | SessionStart, no usage yet | `null` (use baseline estimate) | 0 |
| **Active** | Each assistant usage block | `input + cache_creation + cache_read` | Accumulating |
| **Post-compact indeterminate** | `compact_boundary` detected | `null` (show placeholder) | Static (no usage blocks yet) |
| **Active again** | First usage block after compact | Recalculate from usage | Resume accumulating |

### Data Model

```typescript
// transcript-metrics.json
{
  // Cumulative (never resets, excludes system prompt)
  tokenUsage: {
    inputTokens: number,   // Σ(input_tokens + cache_creation_input_tokens)
    outputTokens: number   // Σ(output_tokens)
  },

  // Current context window (excludes system prompt)
  currentContextTokens: number | null,

  // State flag
  isPostCompactIndeterminate: boolean  // true = show placeholder until next usage
}
```

### Status Line Logic

```typescript
function getDisplayTokens(metrics, baselineSystemPrompt): string {
  if (metrics.isPostCompactIndeterminate) {
    return "⟳ compacted"  // or similar placeholder
  } else if (metrics.currentContextTokens === null) {
    return baselineTotal  // new session estimate from /context capture
  } else {
    return baselineSystemPrompt + metrics.currentContextTokens
  }
}
```

### Detection Strategy

1. **Watch for `compact_boundary`** entries while parsing transcript
   - Match: `type === "system" && subtype === "compact_boundary"`

2. **Set `isPostCompactIndeterminate: true`** and `currentContextTokens: null`

3. **On next assistant entry with usage block:**
   - Set `currentContextTokens = input_tokens + cache_creation + cache_read`
   - Set `isPostCompactIndeterminate: false`
   - Resume normal accumulation

### Files to Modify

- `packages/sidekick-core/src/transcript-service.ts`
  - Add detection for `compact_boundary` entries
  - Implement new token calculation logic
  - Add `isPostCompactIndeterminate` state flag
  - Remove old file-size-based detection

## Success Criteria

1. After `/compact`, statusline shows placeholder during indeterminate state
2. After first post-compact response, statusline shows accurate context size
3. `tokenUsage` continues accumulating correctly across compaction
4. `currentContextTokens` reflects actual context window (from usage metrics)
5. Tests verify compaction detection, state transitions, and token calculation

## Reference Files

- **Transcript file with compaction**: `~/.claude/projects/-Users-scott-src-projects-claude-config/05e289e3-a996-4f2b-b25e-06a5b9285904.jsonl`
- **Sidekick metrics**: `.sidekick/sessions/05e289e3-a996-4f2b-b25e-06a5b9285904/state/transcript-metrics.json`
- **TranscriptService**: `packages/sidekick-core/src/transcript-service.ts`
- **Baseline metrics**: `~/.sidekick/state/baseline-user-context-token-metrics.json`
