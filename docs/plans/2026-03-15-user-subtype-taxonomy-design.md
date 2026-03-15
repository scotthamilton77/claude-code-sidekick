# User Message Subtype Taxonomy — Design

**Bead**: claude-code-sidekick-6iq
**Date**: 2026-03-15
**Status**: Complete

## Problem

`classifyUserSubtype()` produces only 3 of the 4 defined `UserSubtype` values. The `'skill-content'` type exists in the type definition but is never detected — all skill injections fall through to `'system-injection'`. Both render identically as a gray "System injection" collapsible, making it impossible to distinguish skill content from system reminders at a glance.

## Design

### Subtype Taxonomy (4 subtypes, unchanged type definition)

| Subtype | Detection | Rendering |
|---------|-----------|-----------|
| `'prompt'` | Default fallback | Right-aligned chat bubble (unchanged) |
| `'command'` | `<command-name>` tag present | Green terminal pill (unchanged) |
| `'skill-content'` | isMeta + `"Base directory for this skill:"` | Purple collapsed pill: "Skill: {name}" with BookOpen icon |
| `'system-injection'` | isMeta or `<system-reminder>` (catch-all) | Gray collapsed with context-aware label |

### Detection Changes (`classifyUserSubtype`)

Add skill-content check between command and system-injection in the isMeta branch:

```
isMeta + <command-name>  → 'command'
isMeta + skill marker    → 'skill-content'
isMeta (catch-all)       → 'system-injection'
<system-reminder>        → 'system-injection'
<command-name>           → 'command'
default                  → 'prompt'
```

Skill marker: `"Base directory for this skill:"` — present in every skill invocation response from Claude Code.

### Rendering Changes (`TranscriptLine.tsx`)

**Skill content** — new rendering branch:
- Purple-tinted collapsed pill (distinct from gray system-injection)
- BookOpen icon from lucide-react
- Label: "Skill: {name}" extracted from `Base directory for this skill: .../skills/{name}`
- Collapsed by default, expandable to show full content
- Same 60% centered layout as system-injection

**System injection** — context-aware label refinement:
- Contains `<system-reminder>` → label: "System reminder"
- Contains `SessionStart` → label: "Session start hook"
- Contains `UserPromptSubmit` → label: "Prompt hook"
- Default → label: "System injection" (existing)

### Filter Category

Both `'skill-content'` and `'system-injection'` remain in the `'system'` filter category (unchanged).

### Scope Exclusions

- No new `UserSubtype` values added (type definition unchanged)
- `local-command-caveat` stays classified as `'command'` (always co-occurs with `<command-name>`)
- Tool-result-only messages already handled in `processUserEntry` (separate code path)
