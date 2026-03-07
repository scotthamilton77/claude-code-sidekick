# Structured VC Tool Patterns

**Date:** 2026-03-07
**Bead:** sidekick-xcd5
**Status:** Approved

## Problem

The `track-verification-tools` handler uses `command.includes(pattern)` to detect verification commands. This fails when pnpm/npm workspace flags appear between the package manager and the subcommand:

```
pnpm --filter @sidekick/core test -- --exclude '...'
```

does NOT match pattern `"pnpm test"` because `--filter @sidekick/core` sits between `pnpm` and `test`.

## Design

### 1. Structured Pattern Objects

Replace flat string patterns with keyed tuples that capture tool identity, matching pattern, and scope:

```yaml
patterns:
  - tool_id: pnpm-test
    tool: "pnpm test"
    scope: project
  - tool_id: pnpm-filter-test
    tool: "pnpm --filter * test"
    scope: package
```

**Fields:**
- `tool_id` — stable key for override/removal by project or user config
- `tool` — token pattern for matching (see algorithm below). `null` = disabled
- `scope` — metadata: `project`, `package`, or `file`. Not used in matching logic today but stored in state for future use

### 2. Matching Algorithm

Anchored token subsequence matching replaces `command.includes()`:

1. Split command on shell operators (`&&`, `||`, `;`, `|`) into segments
2. Tokenize each segment and the pattern by whitespace
3. **First token must match exactly** (anchored to command start — the executable)
4. Remaining pattern tokens match as a subsequence, skipping unrecognized command tokens
5. `*` in a pattern matches exactly one command token (any value)
6. All pattern tokens must be consumed; extra trailing command tokens are fine

```typescript
function matchesToolPattern(command: string, pattern: string): boolean {
  const segments = command.split(/\s*(?:&&|\|\||[;|])\s*/)
  const patternTokens = pattern.split(/\s+/)

  return segments.some(segment => {
    const cmdTokens = segment.trim().split(/\s+/)
    if (cmdTokens.length === 0 || patternTokens.length === 0) return false

    // First token must match exactly (anchored to command start)
    if (cmdTokens[0] !== patternTokens[0]) return false

    // Remaining pattern tokens: subsequence match
    let pi = 1
    for (let ci = 1; ci < cmdTokens.length && pi < patternTokens.length; ci++) {
      if (patternTokens[pi] === '*' || patternTokens[pi] === cmdTokens[ci]) {
        pi++
      }
    }
    return pi === patternTokens.length
  })
}
```

**Examples:**

| Command | Pattern | Match? | Why |
|---------|---------|--------|-----|
| `pnpm --filter foo build` | `pnpm build` | Yes | Anchored on `pnpm`, skips flags, finds `build` |
| `pnpm --filter foo build` | `pnpm --filter * build` | Yes | Wildcard matches `foo` |
| `this contains pnpm and build` | `pnpm build` | No | First token `this` != `pnpm` |
| `echo pnpm build` | `pnpm build` | No | First token `echo` != `pnpm` |
| `pnpm build && pnpm test` | `pnpm test` | Yes | Second segment matches |
| `vitest src/foo.test.ts` | `vitest` | Yes | Bare tool, trailing ignored |

### 3. Override Semantics

Project/user config merges patterns by `tool_id`:

- **Same `tool_id`** in override: merge attributes (override wins)
- **`tool: null`** in override: disables that pattern
- **New `tool_id`** in override: appended to list

```yaml
# Project override example
verification_tools:
  build:
    patterns:
      - tool_id: pnpm-build
        tool: "turbo build"       # Replace matching pattern
      - tool_id: esbuild
        tool: null                # Disable this pattern
      - tool_id: turbo-build
        tool: "turbo run build"   # Add new pattern
        scope: project
```

### 4. Schema Changes

**Config schema** (`packages/feature-reminders/src/types.ts`):

```typescript
export const ToolPatternSchema = z.object({
  tool_id: z.string(),
  tool: z.string().nullable(),
  scope: z.enum(['project', 'package', 'file']).default('project'),
})

export const VerificationToolConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(ToolPatternSchema).min(1),
  clearing_threshold: z.number().int().positive(),
  clearing_patterns: z.array(z.string()).min(1),
})
```

**State schema** (`packages/types/src/services/state.ts`):

```typescript
export const VerificationToolStatusSchema = z.object({
  status: z.enum(['staged', 'verified', 'cooldown']),
  editsSinceVerified: z.number(),
  lastVerifiedAt: z.number().nullable(),
  lastStagedAt: z.number().nullable(),
  lastMatchedToolId: z.string().nullable().optional(),
  lastMatchedScope: z.enum(['project', 'package', 'file']).nullable().optional(),
})
```

### 5. Files Changed

| File | Change |
|------|--------|
| `packages/feature-reminders/src/types.ts` | New `ToolPatternSchema`, update config schema, update `DEFAULT_VERIFICATION_TOOLS` |
| `packages/types/src/services/state.ts` | Add `lastMatchedToolId`, `lastMatchedScope` |
| `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` | New `matchesToolPattern()`, update `handleBashCommand()` |
| `assets/sidekick/defaults/features/reminders.defaults.yaml` | Full structured patterns for all platforms |
| Tests | New matching function tests, update handler tests |

### 6. Full Platform Config

See `reminders.defaults.yaml` for the complete pattern set covering TypeScript/JavaScript, Python, JVM, Go, Rust, and C/C++ ecosystems. Key decisions:

- `lint` uses `clearing_threshold: 5` (less aggressive re-staging)
- `./gradlew` with dot-slash (standard convention; bare `gradlew` via project override)
- No `npx`/`bunx` wrappers (project override if needed)
- `make` (bare) included for C/C++ default build entry point
