# Command Runner-Aware Pattern Matching

**Date:** 2026-03-29
**Status:** Draft
**Bead:** claude-code-sidekick-aox

## Problem

The tool-pattern-matcher uses anchored first-token matching: the first token of a
command segment must exactly equal the first token of the pattern. This fails when
commands are invoked through package runners like `uv run mypy`, `npx jest`, or
`poetry run pytest` — the first token is the runner (`uv`, `npx`, `poetry`), not
the tool (`mypy`, `jest`, `pytest`).

**Triggering example:**

```
cd /path && uv run mypy tests/test_feedback_server.py --ignore-missing-imports
```

Segments after shell-operator split:

1. `cd /path`
2. `uv run mypy tests/test_feedback_server.py --ignore-missing-imports`

Segment 2: first token is `uv`, pattern is `mypy` — anchor check fails, no match.

## Solution

Add a configurable list of command runner prefixes. When a command segment starts
with a known runner prefix, switch from **anchored** to **unanchored** token
subsequence matching — the existing algorithm minus the first-token anchor.

This avoids:

- Enumerating every runner+tool combination as explicit patterns
- Stripping runner prefixes and dealing with runner flags (e.g., `uv run --python 3.11 mypy`)
- Changing the matching algorithm itself — only the anchor enforcement changes

### Why unanchored subsequence (not raw string includes)

Token-level equality prevents false positives from substrings:

| Command | Pattern | String includes | Token match |
|---------|---------|-----------------|-------------|
| `uv run mypy --strict` | `mypy` | match | match |
| `uv run sometool --formatter=mypy` | `mypy` | match (BAD) | no match |
| `uv run sometool mypy123` | `mypy` | match (BAD) | no match |

### Runner flags are handled naturally

The subsequence scan skips non-matching tokens, so runner flags between the prefix
and the tool are ignored without any special stripping logic:

```
Segment: "uv run --python 3.11 mypy --strict"
Runner prefix "uv run" detected -> drop anchor

Tokens: ["uv", "run", "--python", "3.11", "mypy", "--strict"]
Pattern: ["mypy"]

Scan from any position -> finds "mypy" at index 4 -> match
```

Multi-token patterns work, including wildcards (`*`):

```
Segment: "uv run --python 3.11 python -m pytest tests/ -v"
Runner prefix "uv run" detected -> drop anchor

Tokens: ["uv", "run", "--python", "3.11", "python", "-m", "pytest", "tests/", "-v"]
Pattern: ["python", "-m", "pytest"]

Scan -> "python" at 4, "-m" at 5, "pytest" at 6 -> match
```

Wildcard patterns through runners:

```
Segment: "npx pnpm --filter @scope/pkg build"
Runner prefix "npx" detected -> drop anchor

Tokens: ["npx", "pnpm", "--filter", "@scope/pkg", "build"]
Pattern: ["pnpm", "--filter", "*", "build"]

Scan -> "pnpm" at 1, "--filter" at 2, "*" matches "@scope/pkg" at 3, "build" at 4 -> match
```

## Configuration

New `command_runners` section in `reminders.defaults.yaml` under `settings`,
sibling to `verification_tools`. Shared across all tool categories — runners are
ecosystem-level concerns, not tool-category concerns.

```yaml
settings:
  command_runners:
    # Python
    - prefix: "uv run"
    - prefix: "poetry run"
    - prefix: "pipx run"
    - prefix: "pdm run"
    - prefix: "hatch run"
    - prefix: "conda run"
    # Node.js
    - prefix: "npx"
    - prefix: "pnpx"
    - prefix: "bunx"
    - prefix: "pnpm dlx"
    - prefix: "pnpm exec"
    - prefix: "bun run"
    - prefix: "yarn dlx"
    - prefix: "yarn exec"
    - prefix: "npm exec"
    # Ruby
    - prefix: "bundle exec"
    # .NET
    - prefix: "dotnet tool run"
```

Each entry is an object with a `prefix` field rather than a bare string, leaving
room for future metadata (e.g., ecosystem tag) without a breaking schema change.

### Excluded runners (and why)

- `node` — runs scripts, not tool binaries
- `go run` — runs source files; `go test`/`go vet` are already first-token patterns
- `cargo run` — runs project binary; `cargo test`/`cargo clippy` already handled
- `pnpm run`/`npm run`/`yarn run` — run package.json scripts; script names don't
  match tool patterns. `pnpm test` etc. are already their own patterns.
- `./mvnw`, `./gradlew` — project wrappers that ARE the first token; already have
  their own patterns

### Override semantics

Follows the existing config cascade (YAML defaults -> user -> project).
**Array merge strategy: replace.** If a user or project config defines
`command_runners`, it **replaces** the defaults entirely (same as
`source_code_patterns`). This keeps behavior predictable — no surprise
interactions between default and custom runners.

To extend defaults, copy the default list and add entries:

```yaml
features:
  reminders:
    settings:
      command_runners:
        # Include defaults you want to keep...
        - prefix: "uv run"
        - prefix: "npx"
        # ...plus your additions
        - prefix: "mise exec"
```

To remove a problematic runner from a project, override without it.

### Out of scope: `env`, `sudo`, and shell wrappers

Prefixes like `sudo uv run mypy` or `env UV_PYTHON=3.11 uv run mypy` are not
handled. These are shell-level wrappers that could appear before any command, not
just runners. Handling them would require a recursive prefix-stripping approach
that is out of scope for this change. If needed, it can be addressed separately.

## Schema Changes

In `types.ts`:

```typescript
export const CommandRunnerSchema = z.object({
  prefix: z.string().min(1),
})

export type CommandRunner = z.infer<typeof CommandRunnerSchema>
```

Added to the `RemindersSettings` interface:

```typescript
export interface RemindersSettings {
  // ...existing fields...
  /** Command runner prefixes that trigger unanchored pattern matching */
  command_runners?: CommandRunner[]
}
```

Defaults defined in `DEFAULT_REMINDERS_SETTINGS` (the TypeScript constant that
provides fallback values when config is not set).

## Matcher Changes

`matchesToolPattern()` gains an optional `runners` parameter:

```typescript
export function matchesToolPattern(
  command: string,
  pattern: string,
  runners?: CommandRunner[]
): boolean
```

Per-segment logic becomes:

1. Check if segment starts with any runner prefix via **token-level prefix matching**:
   - Split segment into tokens (whitespace)
   - Split each runner prefix into tokens (whitespace)
   - A runner matches if the first N segment tokens exactly equal the N prefix tokens
   - When multiple runners match, the one with the most tokens wins (e.g., `pnpm dlx`
     beats `pnpm` for segment `pnpm dlx jest`). Ties are irrelevant — any match
     triggers the same boolean effect (unanchored mode).
2. If runner detected: **unanchored** subsequence match — scan for the first pattern
   token starting from any position, then continue with existing subsequence logic
   (including wildcard `*` support). The unanchored scan is the same algorithm as
   today with the first-token anchor removed.
3. If no runner: existing **anchored** first-token match (unchanged behavior)

`findMatchingPattern()` also takes the optional `runners` parameter:

```typescript
export function findMatchingPattern(
  command: string,
  patterns: ToolPattern[],
  runners?: CommandRunner[]
): ToolPattern | null
```

### Backward compatibility

When `runners` is omitted or empty, behavior is identical to today — anchored
matching only. All existing tests pass without modification.

## Handler Integration

`track-verification-tools.ts` loads `command_runners` from the merged reminders
config alongside `verification_tools` and passes it to `findMatchingPattern()`.
Single integration point.

```typescript
const runners = config.command_runners ?? []
const match = findMatchingPattern(command, toolConfig.patterns, runners)
```

## Testing Strategy

### Matcher tests (tool-pattern-matcher.test.ts)

New test cases:

- Runner prefix detection triggers unanchored matching
- Single-token tool through runner (`uv run mypy`)
- Multi-token tool through runner (`uv run python -m pytest`)
- Runner flags between prefix and tool (`uv run --python 3.11 mypy`)
- Longest prefix wins (`pnpm dlx jest` matches `pnpm dlx`, not `pnpm`)
- No false positives: tool name as substring (`--formatter=mypy`) or partial token (`mypy123`)
- No runner = existing anchored behavior (existing tests unchanged)
- Chained commands with runners (`uv run mypy && uv run pytest`)
- Empty/undefined runners parameter = anchored behavior

### Handler tests (track-verification-tools.test.ts)

New test cases:

- Runner-wrapped command unstages the correct per-tool reminder
- Config with custom runners is respected

## Files Changed

| File | Change |
|------|--------|
| `packages/feature-reminders/src/types.ts` | Add `CommandRunnerSchema`, update `RemindersSettingsSchema` and defaults |
| `packages/feature-reminders/src/tool-pattern-matcher.ts` | Add runner prefix detection, conditional unanchored matching |
| `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` | Load `command_runners` config, pass to matcher |
| `assets/sidekick/defaults/features/reminders.defaults.yaml` | Add `command_runners` section |
| `packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts` | Runner matching tests |
| `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts` | Handler integration tests |

## False Positive Analysis

The only theoretical false positive: a tool name appears as a standalone
whitespace-delimited token in a runner command where it is NOT the tool being run.
For example, `uv run sometool mypy` where `mypy` is a positional argument to
`sometool`. This is vanishingly unlikely given the distinctive names of the tools
in our pattern list (`mypy`, `pytest`, `jest`, `eslint`, `pyright`, `vitest`, etc.).

Cross-ecosystem matching (e.g., `npx mypy`) produces a harmless false positive —
the typecheck reminder unstages even though the command is nonsensical.

## Performance

Runner prefix checking adds O(runners * prefix_tokens) per segment. With ~17
runners averaging ~2 tokens each and typically 1-3 segments per command, this is
negligible — a few dozen string comparisons per Bash tool call.
