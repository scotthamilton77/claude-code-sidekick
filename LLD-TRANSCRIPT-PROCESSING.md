# Transcript Processing LLD

## 1. Overview

The Transcript Processing subsystem is responsible for reading, parsing, normalizing, and managing the conversation history between the user and the LLM. It serves as the "memory" access layer for Sidekick, allowing features like Session Summary, Resume, and Statusline to understand the current state of the conversation.

This subsystem resides within `sidekick-core` and exposes a high-level API for interacting with transcripts, abstracting away the underlying file formats and provider-specific idiosyncrasies.

## 2. Architecture

The processing pipeline follows a linear transformation flow:

`Raw File` -> **Parser** -> `Raw JSON Objects` -> **Raw Filter** -> **Normalizer (Extraction)** -> `Canonical Events` -> **Scrubber** -> `Clean Transcript`

### 2.1 Data Models

We define two distinct data models to separate storage format from runtime logic.

#### 2.1.1 Raw Event Model (`RawTranscriptEvent`)
Represents the raw data structure found in the underlying transcript files. To ensure resilience against upstream changes (e.g., Anthropic changing their format), this model is **not strictly schema-enforced**. It is treated as a loose collection of fields.

```typescript
// Flexible definition to allow for upstream schema drift
type RawTranscriptEvent = Record<string, unknown>;
```

#### 2.1.2 Canonical Event Model (`TranscriptEvent`)
The internal, standardized representation used by Sidekick features. This model is provider-agnostic.

```typescript
interface TranscriptEvent {
  id: string;              // Unique ID (UUID or hash)
  timestamp: Date;         // Normalized timestamp
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'tool_use' | 'tool_result';
  content: string | object;
  metadata: {
    provider: string;      // e.g., 'claude', 'openai'
    originalId?: string;   // ID from the provider if available
    [key: string]: any;
  };
}
```

#### 2.1.3 Transcript Object
A wrapper around the list of events providing utility methods.

```typescript
class Transcript {
  events: TranscriptEvent[];
  metadata: TranscriptMetadata;

  get lastUserMessage(): TranscriptEvent | undefined;
  get lastAssistantMessage(): TranscriptEvent | undefined;
  toString(): string; // Renders the transcript as a readable string
  filter(predicate: (e: TranscriptEvent) => boolean): Transcript;
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
A lightweight filter that runs *before* normalization to discard irrelevant events early.
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
The main entry point in `sidekick-core`.
- **Methods**:
  - `load(path: string): Promise<Transcript>`
  - `save(path: string, transcript: Transcript): Promise<void>` (if we support modifying transcripts)
  - `watch(path: string, callback: (t: Transcript) => void): () => void`

## 3. Implementation Details

### 3.1 File Watching & Updates
For the **Supervisor**, we need to react to changes in the transcript.
- **Strategy**: Use `fs.watch` (or `chokidar` if already a dependency) to detect changes.
- **Debouncing**: Debounce updates (e.g., 500ms for user text messages, 5000ms for tool and assistant messages) to avoid thrashing during rapid output generation.
- **Full Read**: On change, re-read the entire file, we can process efficiently using a watermark to avoid processing the same events multiple times.
  - *Rationale*: Transcripts are typically small (< 10MB). Complexity of implementing "tail" logic for JSON arrays outweighs the performance cost of full reads for V1.
- **Persistence**: The Supervisor hosts the `TranscriptScrubber` and writes normalized output to `.sidekick/sessions/{session_id}/transcript.json`. This serves as the stable data source for the Monitoring UI and other downstream consumers.

### 3.2 Schema Contracts
The `packages/schema-contracts` package will host:
1.  `CanonicalTranscriptSchema`: The strict Zod schema for our internal `TranscriptEvent`.
2.  `RawExtractionRules`: (Optional) Definitions of paths/rules used to extract data from raw events, potentially shared with Python tools.

Note: We explicitly **do not** maintain a strict Zod schema for the raw input file to avoid brittleness.

### 3.3 Error Handling
- **Corrupt File**: If the transcript is invalid JSON (e.g., incomplete write), the parser should:
  - Attempt to recover (if JSONL).
  - Or return the last known good state.
  - Log a warning.
- **Missing File**: Return an empty transcript.

### 3.4 Monitoring UI Integration

The `TranscriptScrubber` emits **Entity-Lifecycle events** (see `LLD-STRUCTURED-LOGGING.md`) for the `transcript` entity:

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

These events explain *why* context was modified, enabling the Monitoring UI to show pruning decisions in the timeline.

## 4. Denoising Rules

The `TranscriptScrubber` implements the following default rules:

1.  **Empty Message Removal**: Drop events with empty `content` unless they are tool calls.
2.  **Known Noise Removal**: Drop events with known noise patterns (e.g., commands such as "/clear" and "/context").
3.  **System Message Hiding**: By default, hide system prompts unless explicitly requested (they consume context but rarely affect flow analysis).
4.  **Tool Output Truncation**: (Configurable) Truncate massive tool outputs (e.g., `cat` of a large file) in the *in-memory* model to save memory, while keeping a reference to the full content if needed.

## 5. Open Questions & Recommendations

### 5.1 Schema Alignment
**Question**: How do we ensure our extraction logic matches what Claude actually outputs?
**Recommendation**: We maintain a `testing/fixtures/transcripts` directory with real Claude transcripts. We write tests that run the **Extraction/Normalization** logic against these fixtures and verify the output matches expected `CanonicalTranscript` snapshots. This tests the *logic*, not the *schema*.

### 5.2 Provider Extensibility
**Question**: How to support OpenAI/OpenRouter later?
**Recommendation**: The `TranscriptNormalizer` should be a factory or strategy pattern.
- `getNormalizer(provider: string): Normalizer`
- We detect the provider from metadata or config, then instantiate the correct normalizer (e.g., `ClaudeNormalizer`, `OpenAINormalizer`). The rest of the system (Scrubber, Service) only sees `CanonicalTranscript`.  (For v1 we only support ClaudeNormalizer.)

### 5.3 Batch vs Stream
**Question**: Should we stream events?
**Recommendation**: **No, use Batch for V1.**
- **Reasoning**: Node.js can easily handle 10MB JSON objects in memory. Streaming JSON parsers (like `stream-json`) add significant complexity. We can revisit if transcripts grow >100MB.

### 5.4 Partial Writes
**Question**: How to handle reading a file while Claude is writing to it?
**Recommendation**:
- If JSONL: It's easy, just read valid lines.
- If JSON Array: This is harder. If the file ends abruptly, `JSON.parse` fails.
- **Solution**: Use a "resilient parser" that attempts to fix the closing bracket if `JSON.parse` fails with an "Unexpected end of input" error. Or, simpler: catch the error, wait 100ms, retry (up to 3 times). If still failing, treat as "file locked" and skip update.
