# Transcript Processing LLD

## 1. Overview

The Transcript Processing subsystem is responsible for reading, parsing, normalizing, and managing the conversation history between the user and the LLM. It serves as the "memory" access layer for Sidekick, allowing features like Session Summary, Resume, Reminders, and Statusline to understand the current state of the conversation.

**Key Responsibilities:**

1. **Transcript Parsing**: Reading and normalizing transcript files into canonical events
2. **Metrics Ownership**: Single source of truth for transcript-derived metrics (turn count, tool count, tokens)
3. **Event Emission**: Emitting transcript events into the unified event queue (see **docs/design/flow.md**)
4. **Compaction History**: Managing pre-compact snapshots for Monitoring UI time-travel

This subsystem resides within `sidekick-core` and exposes a high-level API for interacting with transcripts, abstracting away the underlying file formats and provider-specific idiosyncrasies.

### 1.1 Related Documents

- **docs/design/flow.md**: Defines `TranscriptEvent` schema and event dispatch model
- **docs/design/SUPERVISOR.md**: TranscriptService integration with Supervisor
- **packages/sidekick-ui/docs/MONITORING-UI.md**: Compaction timeline visualization

## 2. Architecture

The processing pipeline follows a linear transformation flow:

`Raw File` -> **Parser** -> `Raw JSON Objects` -> **Raw Filter** -> **Normalizer (Extraction)** -> `Canonical Events` -> **Scrubber** -> `Clean Transcript`

### 2.1 Data Models

We define two distinct data models to separate storage format from runtime logic.

#### 2.1.1 Raw Event Model (`RawTranscriptEvent`)

Represents the raw data structure found in the underlying transcript files. To ensure resilience against upstream changes (e.g., Anthropic changing their format), this model is **not strictly schema-enforced**. It is treated as a loose collection of fields.

```typescript
// Flexible definition to allow for upstream schema drift
type RawTranscriptEvent = Record<string, unknown>
```

**Claude Code Transcript Structure (observed):**

Real Claude Code transcripts use these top-level entry types:

- `user` - User messages (may contain nested `tool_result` blocks in `message.content[]`)
- `assistant` - Assistant responses (may contain nested `tool_use` blocks in `message.content[]`)
- `summary` - Conversation summaries
- `file-history-snapshot` - File state snapshots

Tool interactions are **nested**, not top-level:

- `tool_use` → `assistant.message.content[{type: 'tool_use', name, id, input}]`
- `tool_result` → `user.message.content[{type: 'tool_result', tool_use_id, content}]`

#### 2.1.2 Canonical Event Model (`TranscriptEvent`)

The internal, standardized representation used by Sidekick features. This model is provider-agnostic.

```typescript
interface TranscriptEvent {
  id: string // Unique ID (UUID or hash)
  timestamp: Date // Normalized timestamp
  role: 'user' | 'assistant' | 'system'
  type: 'text' | 'tool_use' | 'tool_result'
  content: string | object
  metadata: {
    provider: string // e.g., 'claude', 'openai'
    originalId?: string // ID from the provider if available
    [key: string]: any
  }
}
```

#### 2.1.3 Transcript Object

A wrapper around the list of events providing utility methods.

```typescript
class Transcript {
  events: TranscriptEvent[]
  metadata: TranscriptMetadata

  get lastUserMessage(): TranscriptEvent | undefined
  get lastAssistantMessage(): TranscriptEvent | undefined
  toString(): string // Renders the transcript as a readable string
  filter(predicate: (e: TranscriptEvent) => boolean): Transcript
}
```

### 2.2 Components

#### 2.2.1 TranscriptParser

Responsible for reading the raw file from disk and converting it into generic JSON objects.

- **Input**: File path.
- **Output**: `RawTranscriptEvent[]` (loose objects).
- **Responsibilities**:
  - Handling file encoding (UTF-8).
  - Parsing JSON/JSONL.
  - Handling partial reads (resilient parsing).
  - **No strict validation**: It does not reject unknown fields.

#### 2.2.2 RawEventFilter (Preliminary Filtering)

A lightweight filter that runs _before_ normalization to discard irrelevant events early.

- **Input**: `RawTranscriptEvent[]`.
- **Output**: `RawTranscriptEvent[]`.
- **Responsibilities**:
  - Inspecting top-level fields (e.g., `type`) using simple checks.
  - Discarding known noise (e.g., `type: 'typing'`) before expensive processing.

#### 2.2.3 TranscriptNormalizer (Extraction)

Converts loose `RawTranscriptEvent`s into strict `CanonicalTranscriptEvent`s using a "cherry-picking" strategy.

- **Input**: `RawTranscriptEvent[]`.
- **Output**: `TranscriptEvent[]`.
- **Responsibilities**:
  - **Safe Extraction**: Using JSON-path style accessors (e.g., `lodash.get`) to pull required fields.
  - **Resilience**: If non-critical fields are missing, it defaults them rather than crashing.
  - **Mapping**: Converting provider-specific values to canonical enums.
  - Normalizing timestamps.

#### 2.2.4 TranscriptScrubber (Denoising)

Cleans the transcript to make it suitable for context window insertion or analysis.

- **Input**: `TranscriptEvent[]`.
- **Output**: `TranscriptEvent[]`.
- **Responsibilities**:
  - **Coalescing**: Merging contiguous messages from the same role (optional, config-driven).
  - **Noise Reduction**: Removing specific known noise patterns or empty messages that survived the raw filter.
  - **Redaction**: (Future) Masking PII using the shared `Redactor` logic.

#### 2.2.5 TranscriptService

The main entry point in `sidekick-core`. TranscriptService is the **single source of truth** for transcript-derived metrics and emits transcript events into the unified event queue.

**Lifecycle Methods**:

- `initialize(sessionId: string, transcriptPath: string): Promise<void>` — Start watching transcript
- `shutdown(): Promise<void>` — Stop watching, flush state

**Shutdown Requirements**:

- The file watcher must NOT prevent Supervisor process shutdown (chokidar doesn't expose `unref()`, so we rely on `watcher.close()` in `shutdown()` — Supervisor must call `shutdown()` before exit)
- TranscriptService stops watching automatically on `SessionEnd` event (reason: `clear` | `logout` | `prompt_input_exit` | `other`)

**Transcript Access**:

- `getTranscript(): Transcript` — Get current normalized transcript
- `getExcerpt(options: ExcerptOptions): TranscriptExcerpt` — Get windowed excerpt for LLM context

**Metrics Access** (see §3 for schema):

- `getMetrics(): TranscriptMetrics` — Synchronous getter for current metrics
- `getMetric<K extends keyof TranscriptMetrics>(key: K): TranscriptMetrics[K]` — Get single metric

**Observable API**:

- `onMetricsChange(callback: MetricsChangeCallback): () => void` — Subscribe to metrics updates
- `onThreshold(metric: keyof TranscriptMetrics, threshold: number, callback: ThresholdCallback): () => void` — Alert when threshold crossed

**Compaction Management** (see §4):

- `capturePreCompactState(snapshotPath: string): Promise<void>` — Called by PreCompact handler
- `getCompactionHistory(): CompactionEntry[]` — Get timeline of compaction points

## 3. Metrics System

TranscriptService owns all transcript-derived metrics as derived state. Features consume metrics via `getMetrics()` or subscribe to changes.

### 3.1 Metrics Schema

```typescript
interface TranscriptMetrics {
  // Turn-level metrics
  turnCount: number // Total user prompts in session
  toolsThisTurn: number // Tool invocations in current turn (reset on UserPrompt)

  // Session-level metrics
  toolCount: number // Total tool invocations across session
  messageCount: number // Total messages (user + assistant + system)

  // Token metrics (extracted from native transcript metadata)
  tokenUsage: TokenUsageMetrics

  // Derived ratios
  toolsPerTurn: number // Average tools per turn (toolCount / turnCount)

  // Watermarks
  lastProcessedLine: number // Line number of last processed transcript entry
  lastUpdatedAt: number // Timestamp of last metrics update (Unix ms)
}

interface TokenUsageMetrics {
  // Cumulative totals across session
  inputTokens: number // Sum of usage.input_tokens
  outputTokens: number // Sum of usage.output_tokens
  totalTokens: number // inputTokens + outputTokens

  // Cache metrics (critical for cost analysis)
  cacheCreationInputTokens: number // Sum of cache_creation_input_tokens
  cacheReadInputTokens: number // Sum of cache_read_input_tokens (cache hits)

  // Cache tier breakdown
  cacheTiers: {
    ephemeral5mInputTokens: number // cache_creation.ephemeral_5m_input_tokens
    ephemeral1hInputTokens: number // cache_creation.ephemeral_1h_input_tokens
  }

  // Service tier tracking (for cost/performance analysis)
  serviceTierCounts: Record<string, number> // e.g., { "standard": 42 }

  // Per-model breakdown (sessions may span model switches)
  byModel: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      requestCount: number
    }
  >
}
```

### 3.2 Computation Strategy

**Normal Operation (Incremental)**:

1. TranscriptService watches transcript file via `chokidar` with debouncing (100ms default)
2. On change, reads only new lines (from `lastProcessedLine` watermark)
3. For each new entry, emits `TranscriptEvent` and updates metrics incrementally
4. Persists metrics snapshot to StateManager for durability

**Startup/Resume (Gap Recovery)**:

1. Load persisted metrics from StateManager
2. Compare `lastProcessedLine` with current transcript length
3. If gap exists (crash recovery), scan missing lines and update metrics
4. If transcript is shorter (compaction detected), trigger full recompute

**Compact Detection (Full Recompute)**:

1. Detect `currentLineCount < lastProcessedLine` OR (better?) currentFileLength < lastFileLenth (faster, no need to count lines)
2. DOES NOT reset all metrics to zero; the post-compaction transcript is additive to the pre-compaction metrics
3. Full scan of truncated transcript
4. Emit `MetricsChangeEvent` with `trigger: 'compact'`

### 3.3 Turn Boundary Inference

TranscriptService infers turn boundaries from the transcript content itself:

- **UserPrompt entry detected** → Increment `turnCount`, reset `toolsThisTurn` to 0
- **ToolResult entry detected** → Increment `toolCount` and `toolsThisTurn`

This keeps the single-source-of-truth principle intact—the transcript IS the source of truth for when turns begin, not hook events.

### 3.4 Token Counting

Token metrics are extracted directly from the native `usage` metadata in Claude Code transcript entries. Each assistant message includes a `message.usage` object with authoritative token counts from the API response.

**Native Metadata Extraction**:

```typescript
interface RawUsageMetadata {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  service_tier?: string
}

function extractTokenUsage(entry: RawTranscriptEvent): Partial<TokenUsageMetrics> | null {
  const usage = entry.message?.usage as RawUsageMetadata | undefined
  if (!usage) return null

  const model = entry.message?.model as string | undefined

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheTiers: {
      ephemeral5mInputTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      ephemeral1hInputTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    },
    serviceTier: usage.service_tier,
    model,
  }
}
```

Token counts are accumulated incrementally as new entries arrive. Each assistant response's usage metadata is added to the running totals.

**Future Enhancement**: For transcripts that lack native `usage` metadata (e.g., imported from other providers, or older transcript formats), tiktoken estimation can be added as a fallback:

```typescript
// Future: Fallback for transcripts without native usage metadata
// import { encoding_for_model } from 'tiktoken';
// const encoder = encoding_for_model('claude-3-sonnet-20240229');
// function estimateTokens(text: string): number { return encoder.encode(text).length; }
```

### 3.5 Metrics Persistence

**File Location**: `.sidekick/sessions/{session_id}/state/transcript-metrics.json`
Defined in `packages/types/src/services/state.ts` via `SessionMetricsStateSchema`.

```typescript
interface PersistedTranscriptState {
  sessionId: string
  metrics: TranscriptMetrics
  persistedAt: number
}
```

**Persistence Triggers**:
| Trigger | Action |
|---------|--------|
| Metrics change | Debounced write (100ms) |
| Shutdown | Immediate write |
| Periodic | Every 30s as safety net |

## 4. Compaction History

TranscriptService manages compaction history for the Monitoring UI's time-travel debugging feature.

### 4.1 Pre-Compact Capture

When `capturePreCompactState(snapshotPath)` is called (by the Supervisor's PreCompact handler):

1. Snapshot current metrics
2. Record compaction point metadata
3. Append to `compaction-history.json`

### 4.2 Compaction Entry Schema

```typescript
interface CompactionEntry {
  compactedAt: number // Unix timestamp (ms)
  transcriptSnapshotPath: string // Path to pre-compact transcript copy
  metricsAtCompaction: TranscriptMetrics
  postCompactLineCount: number // Lines remaining after compaction (filled later)
}
```

**File Location**: `.sidekick/sessions/{session_id}/state/compaction-history.json`

### 4.3 File Structure

```
.sidekick/sessions/{session_id}/
├── transcripts/
│   ├── pre-compact-1699999999999.jsonl  # Full transcript before first compaction
│   └── pre-compact-1700000000000.jsonl  # Full transcript before second compaction
└── state/
    ├── transcript-metrics.json          # Current metrics
    └── compaction-history.json          # Timeline of compaction points
```

## 5. Event Emission

TranscriptService emits transcript events into the Supervisor's unified event queue (per **docs/design/flow.md §3.2**).

### 5.1 Event Types Emitted

| Entry Type          | Event Type         | Metrics Updated                                    |
| ------------------- | ------------------ | -------------------------------------------------- |
| User message        | `UserPrompt`       | `messageCount++`, `turnCount++`, `toolsThisTurn=0` |
| Assistant message   | `AssistantMessage` | `messageCount++`                                   |
| Tool call           | `ToolCall`         | (none—tool not yet executed)                       |
| Tool result         | `ToolResult`       | `toolCount++`, `toolsThisTurn++`                   |
| Compaction detected | `Compact`          | Full recompute                                     |

### 5.2 Dispatcher Integration

**Important**: TranscriptService updates its internal state BEFORE emitting events, ensuring the embedded metrics snapshot reflects the current state including this event.

```typescript
// TranscriptService emits events to the EventDispatcher
private emitTranscriptEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): void {
  // Note: Metrics are already updated before this call
  const event: TranscriptEvent = {
    kind: 'transcript',
    eventType,
    context: {
      sessionId: this.sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber,
      entry,
      content: entry.content,
      toolName: entry.tool_name,
    },
    metadata: {
      transcriptPath: this.transcriptPath,
      metrics: this.getMetrics(),  // Snapshot of current metrics (after this event)
    }
  };

  this.dispatcher.dispatchTranscript(event);
}
```

Handlers registered for transcript events (via `filter: { kind: 'transcript', eventTypes: [...] }`) are invoked concurrently.

## 6. Implementation Details

### 6.1 File Watching & Updates

TranscriptService watches the Claude Code transcript file for changes:

- **Library**: Use `chokidar` for cross-platform file watching
- **Debouncing**: 100ms debounce to batch rapid writes (configurable via `transcript.debounceMs`)
- **Incremental Processing**: Use `lastProcessedLine` watermark to process only new lines
- **Full File Read**: Read entire file but skip already-processed lines
  - _Rationale_: Transcripts are typically small (< 10MB). Complexity of streaming outweighs benefits for V1.

**File Watching Flow**:

```
transcript file changed
  → debounce (100ms)
  → read file from line 0
  → skip lines <= lastProcessedLine
  → for each new line:
      → parse JSON entry
      → emit TranscriptEvent
      → update metrics
  → update lastProcessedLine
  → persist metrics (debounced 100ms)
```

- **Persistence**: TranscriptService writes normalized transcript to `.sidekick/sessions/{session_id}/transcript.json` for the Monitoring UI and downstream consumers.

### 6.2 Schema Contracts

The `packages/types` package will host:

1.  `CanonicalTranscriptSchema`: The strict Zod schema for our internal `TranscriptEvent`.
2.  `TranscriptMetricsSchema`: Schema for metrics persistence.
3.  `CompactionHistorySchema`: Schema for compaction timeline.

Note: We explicitly **do not** maintain a strict Zod schema for the raw input file to avoid brittleness.

### 6.3 Error Handling

- **Corrupt File**: If the transcript is invalid JSON (e.g., incomplete write), the parser should:
  - Attempt to recover (if JSONL).
  - Or return the last known good state.
  - Log a warning.
- **Missing File**: Return an empty transcript, initialize metrics to zero.

### 6.4 Monitoring UI Integration

The `TranscriptScrubber` emits **Entity-Lifecycle events** (see `docs/design/STRUCTURED-LOGGING.md`) for the `transcript` entity:

```json
// Initial normalization complete
{
  "source": "sidekick-supervisor",
  "pid": 12345,
  "context": {
    "session_id": "sess-001",
    "task_id": "task-001"
  },
  "entity": "transcript",
  "entity_id": "tx-001",
  "lifecycle": "normalized",
  "state": { "message_count": 42, "token_estimate": 15000 }
}

// Context pruned (token limit reached)
{
  "source": "sidekick-supervisor",
  "pid": 12345,
  "context": {
    "session_id": "sess-001",
    "task_id": "task-001"
  },
  "entity": "transcript",
  "entity_id": "tx-001",
  "lifecycle": "pruned",
  "reason": "token_limit",
  "metadata": { "removed_lines": 50, "original_tokens": 25000, "pruned_tokens": 15000 }
}

// Tool output truncated
{
  "source": "sidekick-supervisor",
  "pid": 12345,
  "context": {
    "session_id": "sess-001",
    "task_id": "task-001"
  },
  "entity": "transcript",
  "entity_id": "tx-001",
  "lifecycle": "pruned",
  "reason": "tool_output_truncation",
  "metadata": { "tool": "Read", "original_size": 50000, "truncated_size": 5000 }
}
```

These events explain _why_ context was modified, enabling the Monitoring UI to show pruning decisions in the timeline.

## 7. Denoising Rules

The `TranscriptScrubber` implements the following default rules:

1.  **Empty Message Removal**: Drop events with empty `content` unless they are tool calls.
2.  **Known Noise Removal**: Drop events with known noise patterns (e.g., commands such as "/clear" and "/context").
3.  **System Message Hiding**: By default, hide system prompts unless explicitly requested (they consume context but rarely affect flow analysis).
4.  **Tool Output Truncation**: (Configurable) Truncate massive tool outputs (e.g., `cat` of a large file) in the _in-memory_ model to save memory, while keeping a reference to the full content if needed.

## 8. Open Questions & Recommendations

### 8.1 Schema Alignment

**Question**: How do we ensure our extraction logic matches what Claude actually outputs?
**Recommendation**: We maintain a `testing/fixtures/transcripts` directory with real Claude transcripts. We write tests that run the **Extraction/Normalization** logic against these fixtures and verify the output matches expected `CanonicalTranscript` snapshots. This tests the _logic_, not the _schema_.

### 8.2 Provider Extensibility

**Question**: How to support OpenAI/OpenRouter later?
**Recommendation**: The `TranscriptNormalizer` should be a factory or strategy pattern.

- `getNormalizer(provider: string): Normalizer`
- We detect the provider from metadata or config, then instantiate the correct normalizer (e.g., `ClaudeNormalizer`, `OpenAINormalizer`). The rest of the system (Scrubber, Service) only sees `CanonicalTranscript`. (For v1 we only support ClaudeNormalizer.)

### 8.3 Batch vs Stream

**Question**: Should we stream events?
**Recommendation**: **No, use Batch for V1.**

- **Reasoning**: Node.js can easily handle 10MB JSON objects in memory. Streaming JSON parsers (like `stream-json`) add significant complexity. We can revisit if transcripts grow >100MB.

### 8.4 Partial Writes

**Question**: How to handle reading a file while Claude is writing to it?
**Recommendation**:

- If JSONL: It's easy, just read valid lines.
- If JSON Array: This is harder. If the file ends abruptly, `JSON.parse` fails.
- **Solution**: Use a "resilient parser" that attempts to fix the closing bracket if `JSON.parse` fails with an "Unexpected end of input" error. Or, simpler: catch the error, wait 100ms, retry (up to 3 times). If still failing, treat as "file locked" and skip update.

### 8.5 Metrics Drift (Resolved)

**Question**: What if hook-based counters drift from transcript reality?
**Resolution**: This is no longer a concern. TranscriptService is now the single source of truth for metrics, derived from the transcript itself. There are no hook-based counters to drift.
