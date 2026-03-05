# Context Metrics: Fix CLI Capture via stdout Parsing

**Date**: 2026-03-04
**Bead**: sidekick-peba
**Status**: Approved

## Problem

`captureBaseMetrics()` spawns `claude --session-id {uuid} -p "/context"` and reads the resulting transcript JSONL looking for `<local-command-stdout>` output. This never succeeds because `/context` is a local CLI command — in spawned non-interactive sessions, the output doesn't reliably appear in the transcript before the process exits.

The result: `DEFAULT_BASE_METRICS` hardcoded values (systemPromptTokens: 3200, systemToolsTokens: 17900, autocompactBufferTokens: 45000) are never replaced with real values.

## Investigation Findings

1. **Interactive sessions**: `/context` output DOES appear in transcripts as `<local-command-stdout>` in `type: "user"` entries. The existing `registerHandlers()` transcript handler works for live sessions.
2. **Spawned sessions**: `spawnClaudeCli()` captures stdout/stderr, but `captureBaseMetrics()` ignores stdout entirely and reads the transcript instead.
3. **`claude -p "/context"`**: Confirmed to produce stdout output in terminal execution.

## Fix

Parse `result.stdout` from `spawnClaudeCli()` directly using the existing `isContextCommandOutput()` + `parseContextTable()` pipeline. Remove the transcript-reading approach.

### Changes

**`context-metrics-service.ts`**:
1. After `spawnClaudeCli()` returns, use `result.stdout` as the capture source
2. Strip ANSI codes from stdout before parsing (terminal output includes color escapes)
3. Check with `isContextCommandOutput()`, parse with `parseContextTable()`
4. Remove `readContextOutputFromTranscript()` method (dead code)
5. Remove unused `homedir` import
6. Keep error handling, retry logic, and timeout unchanged

**`context-metrics-cli-capture.test.ts`**:
1. Update mocked `spawnClaudeCli` to return stdout with context table data
2. Remove transcript file reading tests
3. Add tests: stdout has context output -> metrics captured successfully
4. Add tests: stdout empty -> error recorded
5. Add tests: stdout has unrecognizable output -> error recorded
6. Add tests: stdout with ANSI codes -> stripped and parsed correctly

### Data Flow (After Fix)

```
daemon startup
  -> captureBaseMetrics()
    -> spawnClaudeCli(['--session-id', uuid, '-p', '/context'])
    -> strip ANSI from result.stdout
    -> isContextCommandOutput(stripped) -> true
    -> parseContextTable(stripped) -> ParsedContextTable
    -> writeBaseMetrics(metrics)
```

### ANSI Stripping

The `/context` output includes ANSI escape codes (colors, bold, etc.). The existing `parseContextTable()` handles the "visual format" with ANSI codes, but adding explicit ANSI stripping before parsing is more robust. A simple regex: `/\x1b\[[0-9;]*m/g`.

### Fallback Behavior

If stdout is empty or unparseable, the error is recorded and defaults continue. The 1-hour retry interval prevents hammering. The transcript handler still captures metrics opportunistically from live sessions.

## Out of Scope

- Hook-triggered capture (Approach B) — follow-up if stdout approach proves insufficient
- Changes to the transcript handler or project/session metrics
- Changes to `spawnClaudeCli()` itself
