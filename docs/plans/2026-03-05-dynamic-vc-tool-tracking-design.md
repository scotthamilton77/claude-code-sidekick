# Dynamic VC Reminder with Tool-Use Tracking

**Bead**: sidekick-o8yv
**Status**: Design approved (pending research on existing VC staging rules)
**Date**: 2026-03-05

## Overview

Replace the monolithic verify-completion reminder with per-tool verification reminders that are intelligently staged and unstaged based on observed agent behavior. The system watches the transcript for file edits (staging trigger) and verification commands (unstaging trigger), with a configurable threshold to prevent nagging after minor edits.

## Decisions Made

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Detection in Daemon via transcript parsing | Keeps all metric tracking in one place; no new IPC paths |
| 2 | Configurable substring match on Bash commands | Simple, handles chained commands naturally, low false-positive risk |
| 3 | Fat defaults covering all major ecosystems | TS, Python, Java, Go, Rust, etc. — to be refined by sidekick-ipsh later |
| 4 | Each verification tool is its own staged reminder file | Leverages existing multi-reminder composition in consumption factory |
| 5 | Wrapper reminder (verify-completion.yaml) provides preamble | Only staged when at least one per-tool reminder is staged |
| 6 | Per-tool clearing_patterns control which edits trigger which tools | A .py edit stages vc-test but not vc-typecheck if typecheck patterns exclude .py |
| 7 | Threshold prevents re-staging after minor edits post-verification | N qualifying edits must accumulate before re-staging |
| 8 | Path scoping via project_dir from daemon context | Files outside project root are ignored; no exclusion list |
| 9 | Graceful degradation: no staging when all tools verified | Silence when everything is verified |

## State Machine (per verification tool)

```
                    file edit (within project_dir,
                    matching clearing_patterns)
                    +------------------------------+
                    |                              v
              +---------+                   +-----------+
              | VERIFIED |                   |  STAGED   |
              +---------+                   +-----------+
                    ^                              |
                    |    verification command       |
                    |    matching patterns          |
                    +------------------------------+

              +---------+   edit count < threshold
              |COOLDOWN |<---- file edit after VERIFIED
              +---------+
                    | edit count >= threshold
                    v
              +-----------+
              |  STAGED   |
              +-----------+
```

States:
- **STAGED** — verification needed, reminder file exists in `stage/Stop/`
- **VERIFIED** — verification command observed, reminder unstaged, edit counter reset to 0
- **COOLDOWN** — verified but subsequent edits accumulating, not yet at threshold

## Architecture

### New Handler: `track-verification-tools.ts`

Registered for `ToolCall` transcript events in the Daemon. On each event:

**File edit detection** (toolName = `Write` | `Edit` | `MultiEdit`):
- Extract `file_path` from `event.payload.entry.input`
- Guard: `file_path` must be under `project_dir` (from daemon context)
- For each verification tool config: if `picomatch.isMatch(file_path, tool.clearing_patterns)`:
  - If tool state is VERIFIED/COOLDOWN: increment edit counter
  - If edit counter >= `clearing_threshold`: stage the tool's reminder, transition to STAGED
  - If tool state is uninitialized: stage immediately (first edit of session)

**Verification command detection** (toolName = `Bash`):
- Extract `command` from `event.payload.entry.input`
- For each verification tool config: if any `tool.patterns` is a substring of `command`:
  - Unstage the tool's reminder file
  - Transition to VERIFIED, reset edit counter to 0

### State Storage

Per-session state file: `.sidekick/sessions/{id}/state/verification-tools.json`

```typescript
interface VerificationToolState {
  [toolId: string]: {
    status: 'staged' | 'verified' | 'cooldown'
    editsSinceVerified: number
    lastVerifiedAt: number | null      // timestamp
    lastStagedAt: number | null        // timestamp
  }
}
```

### Reminder Files

Each tool gets its own reminder YAML in `assets/sidekick/reminders/`:

- `vc-build.yaml`
- `vc-typecheck.yaml`
- `vc-test.yaml`
- `vc-lint.yaml`

Structure:
```yaml
id: vc-build
blocking: true
priority: 50
persistent: false

additionalContext: |
  <vc-build>
  You have modified source files but have not run a build step.
  Run the project's build command before claiming completion.
  </vc-build>

userMessage: "Verification needed: build not run since last code changes"
reason: "Source files modified without subsequent build verification"
```

### Wrapper Reminder

`verify-completion.yaml` becomes a header/preamble reminder (priority 51) that is only staged when at least one per-tool reminder is staged. It provides the "Evidence before assertions..." framing. Per-tool reminders are secondaries (priority 50) contributing `additionalContext`.

When all per-tool reminders are unstaged, the wrapper is also unstaged.

### Impact on Existing System

**Modified:**
- `stage-stop-reminders.ts` — refactored to stage per-tool reminders instead of monolithic verify-completion
- `verify-completion.yaml` — becomes the wrapper/preamble reminder
- `reminders.defaults.yaml` — gains `verification_tools` section
- Types — new `VerificationToolConfig` and `VerificationToolState` types
- `unstage-verify-completion.ts` — unstages all vc-* reminders on UserPromptSubmit (new turn)

**Unchanged:**
- `inject-stop.ts` — consumption handler works as-is (reads all staged reminders, composes them)
- `consumption-handler-factory.ts` — multi-reminder composition unchanged
- `completion-classifier.ts` — still classifies whether agent is claiming completion
- `orchestrator.ts` — P&R/VC coordination unchanged (wrapper retains verify-completion ID)

## Configuration

In `reminders.defaults.yaml`, add `verification_tools` section:

```yaml
settings:
  verification_tools:
    build:
      enabled: true
      patterns:
        # JavaScript/TypeScript
        - "pnpm build"
        - "npm run build"
        - "yarn build"
        - "tsc"
        - "esbuild"
        # Python
        - "python setup.py build"
        - "pip install"
        - "poetry build"
        # JVM
        - "mvn compile"
        - "mvn package"
        - "gradle build"
        - "gradlew build"
        # Go
        - "go build"
        # Rust
        - "cargo build"
        # General
        - "make build"
        - "cmake --build"
        - "docker build"
      clearing_threshold: 3
      clearing_patterns:
        - "**/*.ts"
        - "**/*.tsx"
        - "**/*.js"
        - "**/*.jsx"
        - "**/*.py"
        - "**/*.java"
        - "**/*.kt"
        - "**/*.go"
        - "**/*.rs"
        - "**/*.c"
        - "**/*.cpp"
        - "**/*.cs"
    typecheck:
      enabled: true
      patterns:
        - "pnpm typecheck"
        - "tsc --noEmit"
        - "mypy"
        - "pyright"
        - "pytype"
        - "go vet"
      clearing_threshold: 3
      clearing_patterns:
        - "**/*.ts"
        - "**/*.tsx"
        - "**/*.py"
        - "**/*.go"
    test:
      enabled: true
      patterns:
        - "pnpm test"
        - "npm test"
        - "yarn test"
        - "vitest"
        - "jest"
        - "pytest"
        - "python -m pytest"
        - "go test"
        - "cargo test"
        - "mvn test"
        - "gradle test"
        - "gradlew test"
        - "dotnet test"
        - "make test"
      clearing_threshold: 3
      clearing_patterns:
        - "**/*.ts"
        - "**/*.tsx"
        - "**/*.js"
        - "**/*.jsx"
        - "**/*.py"
        - "**/*.java"
        - "**/*.kt"
        - "**/*.go"
        - "**/*.rs"
        - "**/*.test.*"
        - "**/*.spec.*"
        - "**/test_*"
    lint:
      enabled: true
      patterns:
        - "pnpm lint"
        - "npm run lint"
        - "yarn lint"
        - "eslint"
        - "ruff check"
        - "flake8"
        - "pylint"
        - "golangci-lint"
        - "cargo clippy"
        - "ktlint"
        - "dotnet format"
      clearing_threshold: 5
      clearing_patterns:
        - "**/*.ts"
        - "**/*.tsx"
        - "**/*.js"
        - "**/*.jsx"
        - "**/*.py"
        - "**/*.java"
        - "**/*.kt"
        - "**/*.go"
        - "**/*.rs"
```

## Testing Strategy

- Unit tests for `track-verification-tools.ts`: staging on file edit, unstaging on command, threshold counting, project_dir scoping
- Unit tests for state transitions: STAGED -> VERIFIED -> COOLDOWN -> STAGED
- Integration test: full cycle with mocked transcript events
- Edge cases: chained commands (`pnpm build && pnpm test` unstages both), edits outside project_dir ignored, session restart resets state

## Open Research

> **IMPORTANT**: Before implementation, investigate the existing VC staging rules in detail. The current `stage-stop-reminders.ts` and `orchestrator.ts` have complex coordination logic (P&R/VC cascade prevention, baseline resets, unverified state tracking) that must be understood and preserved or adapted. This research should happen at the start of the implementation session.

Key areas to investigate:
- How `orchestrator.ts` coordinates P&R and VC staging/unstaging — does per-tool VC change these rules?
- How `vc-unverified` state interacts with the new per-tool state machine
- Whether the wrapper reminder (retaining the `verify-completion` ID) preserves orchestrator compatibility
- Impact on `max_verification_cycles` setting

## Related Issues

- **sidekick-ipsh**: Codebase-specific reminder extensions — will refine fat defaults into ecosystem-specific extension packs. Note added to ipsh to revisit verification_tools config when landing.
- **sidekick-kyl.3**: Reminder smartification — reassess once this bead is complete. AI-based evaluation may be unnecessary if deterministic tracking covers enough.
- **sidekick-da5**: Closed as superseded by this design.
