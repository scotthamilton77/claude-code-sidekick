# Context Metrics stdout Capture — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `captureBaseMetrics()` to parse `/context` output from CLI stdout instead of reading the transcript JSONL (which never contains the output for spawned sessions).

**Architecture:** Replace the transcript-reading path in `captureBaseMetrics()` with direct stdout parsing. Wrap raw stdout in `<local-command-stdout>` tags so existing `isContextCommandOutput()` + `parseContextTable()` work unchanged. Remove dead transcript-reading code.

**Tech Stack:** TypeScript, Vitest, @sidekick/shared-providers (spawnClaudeCli)

---

### Task 1: Update `captureBaseMetrics()` to parse stdout

**Files:**
- Modify: `packages/sidekick-daemon/src/context-metrics/context-metrics-service.ts:213-315`

**Step 1: Replace the capture body**

Replace `captureBaseMetrics()` (lines 213-315) with stdout-based parsing. The key change: after `spawnClaudeCli()` returns, wrap `result.stdout` in `<local-command-stdout>` tags and feed it to the existing `isContextCommandOutput()` + `parseContextTable()` pipeline.

```typescript
private async captureBaseMetrics(): Promise<void> {
  const sessionId = randomUUID()
  const tempDir = path.join('/tmp', 'sidekick', 'context-capture')

  this.logger.info('Capturing base metrics via CLI', {
    sessionId,
    tempDir,
    timeout: CLI_CAPTURE_TIMEOUT_MS,
  })

  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true })

    // Execute: claude --session-id={uuid} -p "/context"
    // Use temp directory as working directory to avoid project context
    const args = ['--session-id', sessionId, '-p', '/context']

    this.logger.debug('Spawning Claude CLI for /context capture', { args })

    const result = await spawnClaudeCli({
      args,
      cwd: tempDir,
      timeout: CLI_CAPTURE_TIMEOUT_MS,
      maxRetries: 1,
      logger: this.logger,
      providerId: 'context-metrics',
    })

    this.logger.debug('CLI process completed', {
      exitCode: result.exitCode,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    })

    // Parse /context output directly from stdout
    // Wrap in <local-command-stdout> tags so existing parser pipeline works
    const stdout = result.stdout.trim()

    if (!stdout) {
      const errorMessage = 'CLI stdout was empty — /context produced no output'
      this.logger.warn(errorMessage, { sessionId })
      await this.recordCaptureError(errorMessage)
      return
    }

    const wrappedOutput = `<local-command-stdout>${stdout}</local-command-stdout>`

    if (!isContextCommandOutput(wrappedOutput)) {
      const errorMessage = 'CLI stdout does not appear to be /context output'
      this.logger.warn(errorMessage, {
        stdoutLength: stdout.length,
        stdoutPreview: stdout.slice(0, 500),
      })
      await this.recordCaptureError(errorMessage)
      return
    }

    const parsed = parseContextTable(wrappedOutput)
    if (!parsed) {
      const errorMessage = 'Failed to parse /context table from CLI stdout'
      this.logger.warn(errorMessage, {
        stdoutLength: stdout.length,
        stdoutPreview: stdout.slice(0, 500),
      })
      await this.recordCaptureError(errorMessage)
      return
    }

    const metrics: BaseTokenMetricsState = {
      systemPromptTokens: parsed.systemPrompt,
      systemToolsTokens: parsed.systemTools,
      autocompactBufferTokens: parsed.autocompactBuffer,
      capturedAt: Date.now(),
      capturedFrom: 'context_command',
      sessionId,
      lastErrorAt: null,
      lastErrorMessage: null,
    }

    await this.writeBaseMetrics(metrics)
    this.logger.info('Base metrics captured successfully', {
      systemPromptTokens: metrics.systemPromptTokens,
      systemToolsTokens: metrics.systemToolsTokens,
      autocompactBufferTokens: metrics.autocompactBufferTokens,
      sessionId,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    this.logger.warn('CLI capture failed', {
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
    })
    await this.recordCaptureError(errorMessage)
  }
}
```

**Step 2: Remove `readContextOutputFromTranscript()` method**

Delete the entire method at lines 325-377. It is dead code after this change.

**Step 3: Remove unused imports**

Remove `homedir` from `import { homedir } from 'node:os'` (line 12). It was only used by the transcript reader. Also remove the unused `ParsedContextTable` type import if only the transcript method used it — check first. (It's used in the import at line 21 for `handleTranscriptContent` too, so keep it.)

Remove `path` import only if no other usage remains. (It's used in `tempDir` construction, so keep it.)

Remove `fs` import only if no other usage remains. (It's used for `fs.mkdir`, so keep it.)

**Step 4: Run typecheck**

Run: `pnpm --filter @sidekick/daemon typecheck`
Expected: PASS (no type errors)

**Step 5: Commit**

```bash
git add packages/sidekick-daemon/src/context-metrics/context-metrics-service.ts
git commit -m "fix(context-metrics): parse /context output from CLI stdout instead of transcript"
```

---

### Task 2: Rewrite CLI capture tests for stdout approach

**Files:**
- Modify: `packages/sidekick-daemon/src/context-metrics/__tests__/context-metrics-cli-capture.test.ts`

**Step 1: Remove unused imports**

Remove `homedir` import (line 11) — no longer needed since we don't test transcript file paths.

**Step 2: Remove integration test section that tests transcript reading**

The `describe.skipIf(!process.env.INTEGRATION_TESTS)('captureBaseMetrics() integration', ...)` block (lines 213-477) tests transcript file creation and reading. Replace entirely with stdout-based tests.

**Step 3: Write new integration tests for stdout capture**

Replace the integration test block with:

```typescript
describe.skipIf(!process.env.INTEGRATION_TESTS)('captureBaseMetrics() stdout capture', () => {
  it('should capture metrics from CLI stdout with visual format', async () => {
    // Mock stdout with real /context visual output (ANSI-stripped for simplicity)
    const contextStdout = ` Context Usage
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   claude-opus-4-6 · 63k/200k tokens (32%)

  System prompt: 3.6k tokens (1.8%)
  System tools: 18.9k tokens (9.5%)
  MCP tools: 1.1k tokens (0.5%)
  Custom agents: 319 tokens (0.2%)
  Memory files: 5.5k tokens (2.8%)
  Skills: 2k tokens (1.0%)
  Messages: 32.2k tokens (16.1%)
  Free space: 103k (51.7%)
  Autocompact buffer: 33k tokens (16.5%)`

    mockedSpawnClaudeCli.mockResolvedValue({
      exitCode: 0,
      stdout: contextStdout,
      stderr: '',
    })

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    // Wait for async capture
    await new Promise((r) => setTimeout(r, 500))

    expect(logger.wasLogged('Base metrics captured successfully')).toBe(true)

    const metrics = await service.readBaseMetrics()
    expect(metrics.capturedFrom).toBe('context_command')
    expect(metrics.systemPromptTokens).toBe(3600)
    expect(metrics.systemToolsTokens).toBe(18900)
    expect(metrics.autocompactBufferTokens).toBe(33000)
  })

  it('should capture metrics from CLI stdout with ANSI escape codes', async () => {
    // Real ANSI-encoded output from claude -p "/context"
    const ansiStdout = `\x1b[1mContext Usage\x1b[22m
\x1b[38;2;102;102;102mclaude-opus-4-6 · 25k/200k tokens (13%)\x1b[39m
\x1b[38;2;153;153;153m⛁\x1b[39m System prompt: \x1b[38;2;102;102;102m3.2k tokens (1.6%)\x1b[39m
\x1b[38;2;102;102;102m⛁\x1b[39m System tools: \x1b[38;2;102;102;102m17.9k tokens (9.0%)\x1b[39m
\x1b[38;2;102;102;102m⛝\x1b[39m Autocompact buffer: \x1b[38;2;102;102;102m45.0k tokens (22.5%)\x1b[39m`

    mockedSpawnClaudeCli.mockResolvedValue({
      exitCode: 0,
      stdout: ansiStdout,
      stderr: '',
    })

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    await new Promise((r) => setTimeout(r, 500))

    expect(logger.wasLogged('Base metrics captured successfully')).toBe(true)

    const metrics = await service.readBaseMetrics()
    expect(metrics.capturedFrom).toBe('context_command')
    expect(metrics.systemPromptTokens).toBe(3200)
    expect(metrics.systemToolsTokens).toBe(17900)
    expect(metrics.autocompactBufferTokens).toBe(45000)
  })

  it('should record error when stdout is empty', async () => {
    mockedSpawnClaudeCli.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    await new Promise((r) => setTimeout(r, 500))

    expect(logger.wasLoggedAtLevel('CLI stdout was empty', 'warn')).toBe(true)
  })

  it('should record error when stdout is not /context output', async () => {
    mockedSpawnClaudeCli.mockResolvedValue({
      exitCode: 0,
      stdout: 'Some random CLI output that is not /context',
      stderr: '',
    })

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    await new Promise((r) => setTimeout(r, 500))

    expect(logger.wasLoggedAtLevel('CLI stdout does not appear to be /context output', 'warn')).toBe(true)
  })

  it('should record error when stdout has context markers but unparseable table', async () => {
    // Has the markers but no valid token counts
    const badStdout = `Context Usage
System prompt: not-a-number tokens
System tools: also-not-a-number tokens`

    mockedSpawnClaudeCli.mockResolvedValue({
      exitCode: 0,
      stdout: badStdout,
      stderr: '',
    })

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    await new Promise((r) => setTimeout(r, 500))

    // Either "does not appear" (missing tag markers after wrap) or "Failed to parse"
    const hasError =
      logger.wasLoggedAtLevel('CLI stdout does not appear to be /context output', 'warn') ||
      logger.wasLoggedAtLevel('Failed to parse /context table from CLI stdout', 'warn')
    expect(hasError).toBe(true)
  })

  it('should handle CLI spawn error', async () => {
    mockedSpawnClaudeCli.mockRejectedValue(new Error('CLI spawn failed'))

    const service = new ContextMetricsService({
      projectDir,
      logger,
      projectStateService,
      userStateService,
      skipCliCapture: false,
    })

    await service.initialize()
    await new Promise((r) => setTimeout(r, 500))

    expect(logger.wasLoggedAtLevel('CLI capture failed', 'warn')).toBe(true)
  })
})
```

**Step 4: Run the tests**

Run: `pnpm --filter @sidekick/daemon test -- --testPathPattern='context-metrics-cli-capture' --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/sidekick-daemon/src/context-metrics/__tests__/context-metrics-cli-capture.test.ts
git commit -m "test(context-metrics): rewrite CLI capture tests for stdout parsing"
```

---

### Task 3: Update `isContextCommandOutput()` to handle wrapped stdout

**Files:**
- Modify: `packages/sidekick-daemon/src/context-metrics/transcript-parser.ts:73-83`

**Context:** The current `isContextCommandOutput()` requires `<local-command-stdout>` tags AND context markers. When we wrap stdout in tags, it will pass the tag check. However, the function should also handle the case where content is passed *without* tags (for robustness). This is a minor enhancement — add a check for context markers even without the tag wrapper.

**Step 1: Evaluate if change is needed**

After Task 1, the captureBaseMetrics wraps stdout in tags before calling `isContextCommandOutput()`. So the existing function works as-is. **Skip this task if Task 2 tests pass.**

If tests fail because `isContextCommandOutput()` rejects wrapped stdout, then debug: the issue is likely that wrapped stdout lacks "Context" as a substring (the third marker). The visual format uses "Context Usage" as a header, which contains "Context". Verify this.

---

### Task 4: Run full quality gates

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Run all context-metrics tests**

Run: `pnpm --filter @sidekick/daemon test -- --testPathPattern='context-metrics' --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: All pass

**Step 5: Run full daemon tests**

Run: `pnpm --filter @sidekick/daemon test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: All pass
