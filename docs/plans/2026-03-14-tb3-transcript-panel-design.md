# TB3: Transcript Panel with Real Data — Design

Tracer bullet 3 for the UI epic (`sidekick-43a8b12e`).

## Goal

Parse Claude Code session transcripts and render them in the existing Transcript panel, proving the full pipeline: JSONL file → Vite server parser → API route → React hook → component.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| D13 | Parent transcript only, no subagent drill-down | TB3 scope — subagent drill-down deferred to `claude-code-sidekick-0wf` |
| D14 | Import `@sidekick/core` for parsing | Reuse `normalizeEntry()` + content extractors; project will need chokidar/pino eventually |
| D15 | Include `isSidechain: true` entries | Sidechain contains Sidekick SessionStart activity worth showing |
| D16 | Defer Sidekick event interleaving | Pure conversation turns only; interleaving deferred to `claude-code-sidekick-mcs` |
| D17 | Deterministic line IDs: `transcript-{lineNumber}-{blockIndex}` | Stable IDs enable future scroll-sync with timeline |
| D18 | Read entire file, no streaming | Acceptable for TB3; pagination deferred to `claude-code-sidekick-bpo` |
| D19 | Skip `queue-operation` entries early | 99%+ of lines are queue noise; check type field before full parse |

## Data Flow

```
~/.claude/projects/{projectId}/{sessionId}.jsonl
        │
        ▼
  transcript-api.ts (Vite server)
  ┌─────────────────────────────────┐
  │ 1. Resolve file path (dir/bare) │
  │ 2. Read JSONL, split lines      │
  │ 3. Skip noise (queue-operation) │
  │ 4. normalizeEntry() from core   │
  │ 5. Map → TranscriptLine[]       │
  │ 6. Handle compaction boundaries │
  └─────────────────────────────────┘
        │
        ▼
  GET /api/projects/:id/sessions/:sid/transcript
        │
        ▼
  useTranscript() hook
        │
        ▼
  Transcript.tsx (existing component)
```

## File Resolution

Two transcript layouts exist:

```
# Directory layout (sessions with subagents)
~/.claude/projects/{projectId}/{sessionId}/{sessionId}.jsonl

# Simple layout (bare file)
~/.claude/projects/{projectId}/{sessionId}.jsonl
```

Try directory first, fall back to bare file, return 404 if neither exists.

## Entry Type Mapping

### Rendered as TranscriptLines

| Raw Entry | Condition | TranscriptLine.type | Display |
|-----------|-----------|-------------------|---------|
| `user` | text content | `user-message` | User prompt |
| `user` | nested `tool_result` blocks | `tool-result` | Tool output + error flag |
| `assistant` | text blocks | `assistant-message` | Response + collapsible thinking |
| `assistant` | `tool_use` blocks | `tool-use` | Tool name + input preview |
| `system` | `subtype: compact_boundary` | `compaction` | Compaction marker with preTokens |
| `system` | `subtype: turn_duration` | `turn-duration` | Elapsed time badge |
| `system` | `subtype: api_error` | `api-error` | Retry indicator |
| `pr-link` | — | `pr-link` | Clickable PR reference |

### Skipped

| Raw Entry | Reason |
|-----------|--------|
| `queue-operation` | 99%+ of entries, internal queuing |
| `file-history-snapshot` | Internal bookkeeping |
| `last-prompt` | Cache artifact |
| `progress` (all subtypes) | Hook/agent/bash streaming — covered elsewhere |
| `system/stop_hook_summary` | Internal hook timing |
| `system/local_command` | Usually empty markers |

### Metadata Captured (not rendered as lines)

| Field | Source | Use |
|-------|--------|-----|
| `model` | assistant entries | Show which model responded |
| `stop_reason` | assistant entries | Understand turn flow |
| `isCompactSummary` | any entry | Flag summarized messages |
| `isSidechain` | any entry | Visual sidechain indicator |
| `message.usage` | assistant entries | Token metrics |

## New Files

- `packages/sidekick-ui/server/transcript-api.ts` — Parser + transformer
- `packages/sidekick-ui/server/__tests__/transcript-api.test.ts` — Server tests
- `packages/sidekick-ui/src/hooks/useTranscript.ts` — React data hook

## Modified Files

- `packages/sidekick-ui/server/api-plugin.ts` — Add `/api/.../transcript` route
- `packages/sidekick-ui/src/App.tsx` — Wire `useTranscript()` to `Transcript` component
- `packages/sidekick-ui/src/types.ts` — Add new TranscriptLine types if needed
- `packages/sidekick-ui/package.json` — Add `@sidekick/core` dependency

## Edge Cases

| Case | Handling |
|------|----------|
| No transcript file | 404 → UI shows "No transcript available" |
| Very large file (47MB+) | Read entire for TB3; pagination deferred |
| Malformed JSON lines | Skip silently |
| `queue-operation` dominance | Skip early before full JSON parse |
| `isMeta: true` | Include, mark visually |
| `isCompactSummary: true` | Include, mark as summary |
| Empty transcript | 200 with `{ lines: [] }` |
| Active session race | Acceptable staleness; SSE deferred to `zq8` |

## Testing Strategy

Server tests (`transcript-api.test.ts`):
- Parses valid JSONL with all rendered entry types
- Skips noise entries (queue-operation, file-history-snapshot, progress)
- Handles compact_boundary → compaction marker
- Handles turn_duration → duration line
- Handles mixed content blocks (text + tool_use in one assistant entry)
- Skips malformed JSON lines
- Resolves directory layout vs. bare file
- Returns empty array when file missing
- Includes isSidechain entries with flag

## Deferred Work

- `claude-code-sidekick-mcs` — Interleave Sidekick events into transcript
- `claude-code-sidekick-0wf` — Subagent transcript drill-down
- `claude-code-sidekick-bpo` — Large file pagination/streaming
- `claude-code-sidekick-zq8` — SSE live updates

## Reference

- `docs/design/CLAUDE-CODE-TRANSCRIPT-FORMAT.md` — Full transcript format taxonomy
- `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` — Decision log (update with D13-D19)
