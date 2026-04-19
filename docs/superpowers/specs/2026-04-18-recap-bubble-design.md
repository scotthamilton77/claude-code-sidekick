# Recap Bubble: Surface away_summary and Compaction Summaries in UI Timeline

**Beads:** sidekick-9a1b031a, sidekick-810c  
**Date:** 2026-04-18  
**Status:** Approved

## Problem

Two JSONL entry types written by Claude Code carry useful session-state summaries that Sidekick currently discards silently:

| JSONL type | Subtype | Current fate | Problem |
|-----------|---------|-------------|---------|
| `system` | `away_summary` | Dropped at normalizer | Never reaches excerpt or UI |
| `summary` | — | Excerpt-only via raw path | No UI timeline representation |

`away_summary` is Claude Code's recap feature (added v2.1.108, April 2026): a one-line work-state + next-action summary generated when the terminal has been unfocused ≥3 minutes after a completed turn, or on demand via `/recap`. It is written to the JSONL transcript with `isMeta: false`.

`summary` (compaction) entries already reach the LLM excerpt as `[SESSION_HINT]` via the raw-entry path in `formatExcerptLine`, but are never normalized into canonical entries and therefore never appear in the UI timeline.

## Goal

- Surface both entry types as **Recap bubbles** in the UI timeline
- Include `away_summary` in the LLM excerpt (compaction summaries already work)
- Minimal blast radius: four existing files + one new UI component

## Data Model

`CanonicalTranscriptEntry.type` gains one new value:

```typescript
type: 'text' | 'tool_use' | 'tool_result' | 'recap'
```

When `type === 'recap'`:
- `role: 'system'` — infrastructure metadata, not a conversation turn
- `content: string` — plain-prose summary text
- `metadata.recapSource: 'compaction' | 'away'` — discriminates origin for UI labeling
- `metadata.leafUuid?: string` — preserved from compaction summary for future reference. Note: `knownUuids` filtering applies only to the existing raw-entry excerpt path (`case 'summary':` in `formatExcerptLine`), not to canonical entries. All compaction summaries appear in the UI timeline regardless of `leafUuid` validity.

## Pipeline Changes

### `packages/types/src/services/transcript.ts`

- Add `'recap'` to the `type` union on `CanonicalTranscriptEntry`
- Add `recapSource?: 'compaction' | 'away'` and `leafUuid?: string` to the metadata shape

### `packages/sidekick-core/src/transcript-normalizer.ts`

Extend `normalizeEntry()` before the early-return guard (`entryType !== 'user' && entryType !== 'assistant'`) to handle two new raw entry types:

**Compaction summary** (`type === 'summary'`):
```typescript
{
  id: uuid,
  timestamp,
  role: 'system',
  type: 'recap',
  content: rawEntry.summary ?? '',
  metadata: { provider: 'claude', lineNumber, source: 'compaction', leafUuid: rawEntry.leafUuid }
}
```

**Away summary** (`type === 'system'` + `subtype === 'away_summary'`):
```typescript
{
  id: uuid,
  timestamp,
  role: 'system',
  type: 'recap',
  content: rawEntry.content ?? '',
  metadata: { provider: 'claude', lineNumber, source: 'away' }
}
```

All other `system` subtypes continue to return `null` (unchanged behavior).

### `packages/sidekick-core/src/transcript-excerpt-builder.ts`

`formatExcerptLine` gains a `case 'system':` branch before `default`:

```typescript
case 'system': {
  const subtype = (entry as { subtype?: string }).subtype
  if (subtype === 'away_summary') {
    return `[SESSION_RECAP]: ${String((entry as { content?: string }).content ?? '')}`
  }
  return null
}
```

The existing `case 'summary':` (compaction → `[SESSION_HINT]`) is unchanged.

## UI Changes

### `packages/sidekick-ui/src/types.ts`

Add `'recap'` to `TranscriptLineType`.

### New component: `RecapBubble`

A timeline entry component for `type === 'recap'` canonical entries:

- Visually de-emphasized: muted background, lighter text weight — signals infrastructure metadata, not conversation content
- Label varies by `source`:
  - `'away'` → **"Recap"**
  - `'compaction'` → **"Compaction Summary"**
- No avatar or role indicator
- Full `content` text displayed without truncation (these are single-line by design)

The timeline renderer dispatches to `RecapBubble` when `entry.type === 'recap'`, passing `source` from metadata for the label variant.

No new events emitted to the Sidekick event bus — purely a display concern.

## Excerpt Annotation

| Entry type | Excerpt format |
|-----------|---------------|
| `summary` (compaction) | `[SESSION_HINT]: <summary>` — existing, unchanged |
| `system/away_summary` | `[SESSION_RECAP]: <content>` — new |

The LLM receives both as contextual hints with no special weighting. Prompt-engineering adjustments are deferred.

## Testing

**`transcript-normalizer.ts` unit tests:**
- Raw `summary` entry → `type: 'recap'`, `source: 'compaction'`, `leafUuid` preserved
- Raw `system/away_summary` entry → `type: 'recap'`, `source: 'away'`
- `system/compact_boundary` still returns `null` (regression guard)
- `system/turn_duration` still returns `null` (regression guard)

**`transcript-excerpt-builder.ts` unit tests:**
- `system/away_summary` raw entry → `[SESSION_RECAP]: <content>`
- Other `system` subtypes → `null` (regression guard)
- Existing `summary`/`[SESSION_HINT]` tests unchanged

**UI:**
- Snapshot or render test for `RecapBubble` with `source: 'away'` and `source: 'compaction'` variants

## Files Changed

| File | Change |
|------|--------|
| `packages/types/src/services/transcript.ts` | Add `'recap'` type, `source` + `leafUuid` to metadata |
| `packages/sidekick-core/src/transcript-normalizer.ts` | Handle `summary` and `system/away_summary` raw entries |
| `packages/sidekick-core/src/transcript-excerpt-builder.ts` | Add `case 'system':` for `away_summary` → `[SESSION_RECAP]` |
| `packages/sidekick-ui/src/types.ts` | Add `'recap'` to `TranscriptLineType` |
| `packages/sidekick-ui/src/components/RecapBubble.tsx` (new) | Recap bubble component |

## Acceptance Criteria

- `away_summary` entries in a real JSONL transcript appear as Recap bubbles in the UI timeline
- Compaction `summary` entries appear as Compaction Summary bubbles in the UI timeline
- `away_summary` content appears in the LLM excerpt as `[SESSION_RECAP]: ...`
- Existing `[SESSION_HINT]` behavior for compaction summaries is unchanged
- All other `system` subtypes continue to be silently dropped
- Build passes. Typecheck passes. Tests pass.
