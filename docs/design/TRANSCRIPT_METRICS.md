# Context Metrics Low-Level Design

This document describes the context-metrics module in `packages/sidekick-supervisor/src/context-metrics/`, which captures Claude Code's actual context window overhead for accurate statusline rendering.

**Related Documentation:**
- `docs/design/SUPERVISOR.md` §4.8: ContextMetricsService integration
- `docs/design/FEATURE-STATUSLINE.md` §6.4: Context bar calculation

## 1. Problem Statement

Sidekick's statusline displays context window utilization, but currently lacks visibility into Claude Code's actual token overhead:

- **System prompt**: ~3.2k tokens (Claude Code's base instructions)
- **System tools**: ~17.9k tokens (built-in tool definitions)
- **MCP tools**: Variable (project-specific MCP server tools)
- **Custom agents**: Variable (plugin-defined agents)
- **Memory files**: Variable (CLAUDE.md, AGENTS.md, etc.)
- **Autocompact buffer**: ~45k tokens (reserved for context management)

Without these values, the statusline cannot accurately calculate how much context is actually available for user messages. The current implementation either uses hardcoded estimates or shows incomplete utilization data.

## 2. Discovery

Through investigation of Claude Code's transcript files, we found:

1. **`/context` command output is captured in transcripts** - When a user runs `/context`, the output is stored in `<local-command-stdout>` blocks with a parseable markdown table.

2. **CLI mode produces clean output** - Running `claude --session-id={uuid} -p "/context"` produces clean markdown (no ANSI codes) that's easy to parse.

3. **Transcript location is predictable** - Files are stored at `~/.claude/projects/{encoded-project-path}/{sessionId}.jsonl`, and we already have `reconstructTranscriptPath()` utility.

## 3. Solution Overview

Add a `context-metrics` module to supervisor that:

1. **On startup**: Write default metrics immediately, then async-capture real values via CLI
2. **Ongoing**: Monitor transcripts for `/context` command output to capture project-specific values
3. **Expose**: Make metrics available to statusline for accurate context bar calculation

## 4. Success Criteria

1. **Statusline accuracy**: Context utilization reflects actual overhead (system prompt + tools + memory files)
2. **No blocking**: Default values available immediately; real capture happens async
3. **Project-specific**: MCP tools, custom agents, and memory files captured per-project
4. **Graceful degradation**: Failures use defaults; never crash supervisor

## 5. Module Structure

```
packages/sidekick-supervisor/src/context-metrics/
├── index.ts                    # Public exports
├── types.ts                    # Schemas and interfaces
├── context-metrics-service.ts  # Main service class
├── transcript-parser.ts        # Parse /context output
├── defaults.ts                 # Default token values
└── __tests__/
```

## 6. Implementation Details

### Step 1: Types and Defaults

**Create `types.ts`:**
```typescript
interface BaseTokenMetricsState {
  systemPromptTokens: number       // ~3.2k
  systemToolsTokens: number        // ~17.9k
  autocompactBufferTokens: number  // ~45k
  capturedAt: number
  capturedFrom: 'defaults' | 'context_command'
  sessionId?: string
}

interface ProjectContextMetrics {
  mcpToolsTokens: number
  customAgentsTokens: number
  memoryFilesTokens: number
  lastUpdatedAt: number
}
```

**Create `defaults.ts`:**
```typescript
export const DEFAULT_BASE_METRICS: BaseTokenMetricsState = {
  systemPromptTokens: 3200,
  systemToolsTokens: 17900,
  autocompactBufferTokens: 45000,
  capturedAt: 0,
  capturedFrom: 'defaults'
}
```

### Step 2: Transcript Parser

**Create `transcript-parser.ts`:**
- Parse markdown table from `/context` output in `<local-command-stdout>`
- Extract: System prompt, System tools, MCP tools, Custom agents, Memory files, Autocompact buffer
- Handle various number formats (e.g., "17.9k", "17,900", "17900")

Example input (from transcript):
```
<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 63.0k / 200.0k (32%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
| Messages | 8 | 0.0% |
...
</local-command-stdout>
```

### Step 3: Context Metrics Service

**Create `context-metrics-service.ts`:**

```typescript
class ContextMetricsService {
  async initialize(): Promise<void> {
    const exists = await this.baseMetricsFileExists()

    if (!exists) {
      // 1. Sync: Write defaults immediately (statusline can use these right away)
      await this.writeDefaultMetrics()

      // 2. Async: Capture real metrics (non-blocking)
      void this.captureBaseMetrics()
    }
  }

  private async captureBaseMetrics(): Promise<void> {
    const sessionId = crypto.randomUUID()
    const tempDir = '/tmp/sidekick/context-capture'

    // Execute: claude --session-id={uuid} -p "/context"
    // Wait for completion
    // Read transcript at reconstructTranscriptPath(tempDir, sessionId)
    // Parse and update state file
  }
}
```

### Step 4: Supervisor Integration

**Modify `supervisor.ts`:**
- Add `contextMetricsService` field
- Initialize in `start()` after StateManager
- Use existing `reconstructTranscriptPath` from `@sidekick/core`

### Step 5: Transcript Monitoring Handler

**Create handler for ongoing /context command detection.**

The `/context` command generates two transcript entries:
1. Command: `<command-name>/context</command-name>`
2. Output: `<local-command-stdout>## Context Usage...</local-command-stdout>`

We only need to watch for the **output message** - it's self-identifying by content:

```typescript
handler: async (event) => {
  const content = event.payload.content
  if (typeof content !== 'string') return

  // Look for context output (self-identifying by markers)
  if (!content.includes('<local-command-stdout>')) return
  if (!content.includes('System prompt') || !content.includes('System tools')) return

  // This is a /context output - parse it
  const metrics = parseContextTable(content)
  if (metrics) {
    await this.updateProjectMetrics(metrics)
  }
}
```

No state tracking between messages needed - we simply pattern-match on content.

**Project-specific handling:**
- Extract MCP tools, Custom agents, Memory files from the output
- Update project state file
- For Memory files: store the SMALLER value seen (establishes baseline minimum)

### Step 6: Augment Types

**Modify `packages/types/src/services/state.ts`:**
- Add optional `contextMetrics` field to `TranscriptMetricsStateSchema`
- Fields: `systemPromptTokens`, `systemToolsTokens`, `mcpToolsTokens`, `customAgentsTokens`, `memoryFilesTokens`, `autocompactBufferTokens`

### Step 7: Statusline Integration

**Modify `packages/feature-statusline/src/state-reader.ts`:**
- Add `getBaseTokenMetrics()` method
- Read from `~/.sidekick/state/baseline-user-context-token-metrics.json`

**Modify `packages/feature-statusline/src/statusline-service.ts`:**
- Use context metrics for accurate context bar calculation
- Calculate effective limit: `contextWindow - autocompact - systemOverhead`

## 7. State Architecture

### Two-Level State Model

Context metrics are stored at two levels with different lifecycles:

**Project-level state** (`.sidekick/state/`):
- Persists across sessions
- Represents baseline/minimum values for the project
- Updated infrequently (on first startup, when /context is observed)

**Session-level state** (`.sidekick/sessions/{id}/state/`):
- Scoped to a single Claude Code session
- Represents current session's context metrics
- Updated whenever /context output is observed in that session's transcript

### Why Two Levels?

Memory files can **grow dynamically** during a session. Claude might read additional files on demand (e.g., user asks "look at src/foo.ts"), increasing the memory files token count. However, the **baseline** for a project (just CLAUDE.md + AGENTS.md) is relatively stable.

By tracking both:
- **Session state** gives accurate current context for the active session
- **Project state** gives a conservative baseline for sessions where /context hasn't been run

### State Files

| File | Location | Contents | Updated When |
|------|----------|----------|--------------|
| `baseline-user-context-token-metrics.json` | `~/.sidekick/state/` | System prompt, system tools, autocompact buffer | Supervisor startup (async CLI capture) |
| `baseline-project-context-token-metrics.json` | `.sidekick/state/` | MCP tools, custom agents, memory files (minimum seen) | /context observed in any session |
| `context-metrics.json` | `.sidekick/sessions/{id}/state/` | Full context metrics for this session | /context observed in this session |

### Update Logic

When `/context` output is observed:

```typescript
// 1. Always update session state with current values
await this.writeSessionContextMetrics(sessionId, metrics)

// 2. Update project state, keeping MINIMUM memory files
const projectMetrics = await this.readProjectContextMetrics()
if (!projectMetrics || metrics.memoryFilesTokens < projectMetrics.memoryFilesTokens) {
  await this.writeProjectContextMetrics({
    ...metrics,
    memoryFilesTokens: Math.min(
      metrics.memoryFilesTokens,
      projectMetrics?.memoryFilesTokens ?? Infinity
    )
  })
}
```

### Statusline Read Priority

When statusline needs context metrics:
1. **Try session state** - Most accurate for active session
2. **Fall back to project state** - Conservative baseline
3. **Fall back to base defaults** - Always available

## 8. Critical Files

1. `packages/sidekick-supervisor/src/supervisor.ts` - Integration point
2. `packages/types/src/services/state.ts` - Schema extensions
3. `packages/feature-statusline/src/state-reader.ts` - Read context metrics
4. `packages/feature-statusline/src/statusline-service.ts` - Use metrics in calculations

## 9. Error Handling

- CLI execution failure → Log warning, keep defaults
- Parse failure → Return null, use defaults
- File write failure → Log error, don't crash
- 30-second timeout on CLI execution

## 10. Test Strategy

1. **Unit tests** for transcript parser (markdown table parsing, various number formats)
2. **Unit tests** for service (initialization, state transitions, file operations)
3. **Integration test** for full flow (supervisor startup → metrics available to statusline)
4. **Fixtures** in `packages/testing-fixtures/transcripts/` with sample /context outputs
