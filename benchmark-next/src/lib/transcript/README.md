# Transcript Processing Module

**Status**: ✅ Complete (Phase 3.1-3.2)

Utilities for extracting and preprocessing Claude Code transcripts.

## Purpose

Provides reusable transcript processing functionality for:

- **Benchmark**: Preprocessing transcripts before topic extraction
- **Sidekick** (future): Topic extraction and session analysis

## API

### `extractExcerpt(transcript, options?)`

Extracts and preprocesses an excerpt from a loaded transcript.

```typescript
import { extractExcerpt } from './lib/transcript'
import type { TranscriptMessage } from './benchmark/data/types'

const transcript: TranscriptMessage[] = loadTranscript('session.jsonl')
const result = extractExcerpt(transcript, {
  lineCount: 80, // default: 80 - extract last N lines
  filterToolMessages: true, // default: true - remove tool_use/tool_result
  stripMetadata: true, // default: true - keep only role & content
})

console.log(`Extracted ${result.messageCount} messages from ${result.linesExtracted} lines`)
```

**Parameters**:

- `transcript: TranscriptMessage[]` - Pre-loaded transcript (array of JSONL lines)
- `options?: ExcerptOptions` - Extraction configuration

**Returns**: `ExcerptResult`

- `messages: ProcessedMessage[]` - Preprocessed messages
- `linesExtracted: number` - Number of lines processed from end of transcript
- `messageCount: number` - Number of messages after filtering

### `extractExcerptFromFile(filePath, options?)`

Convenience function that loads a transcript file and extracts an excerpt.

```typescript
import { extractExcerptFromFile } from './lib/transcript'

const result = extractExcerptFromFile('transcript.jsonl', {
  lineCount: 100,
  filterToolMessages: false, // keep tool messages
})
```

**Parameters**:

- `filePath: string` - Path to transcript JSONL file
- `options?: ExcerptOptions` - Extraction configuration

**Returns**: `ExcerptResult`

**Throws**: Error if file doesn't exist or contains invalid JSON

## Options

### `ExcerptOptions`

```typescript
interface ExcerptOptions {
  /** Number of lines to extract from end of transcript (default: 80) */
  lineCount?: number

  /** Filter out tool_use and tool_result messages (default: true) */
  filterToolMessages?: boolean

  /** Strip metadata fields: model, id, type, stop_reason, stop_sequence, usage (default: true) */
  stripMetadata?: boolean
}
```

## Types

### `ProcessedMessage`

Message after preprocessing (metadata stripped).

```typescript
interface ProcessedMessage {
  role: string
  content: string | object[]
}
```

### `ExcerptResult`

Result of excerpt extraction with metadata.

```typescript
interface ExcerptResult {
  messages: ProcessedMessage[]
  linesExtracted: number
  messageCount: number
}
```

## Behavioral Parity

Matches Track 1 (`scripts/benchmark/lib/preprocessing.sh::preprocess_transcript()`):

- Extracts last N lines (default 80, configurable via `TOPIC_EXCERPT_LINES`)
- Filters tool messages (configurable via `TOPIC_FILTER_TOOL_MESSAGES`)
- Strips metadata fields: `.model`, `.id`, `.type`, `.stop_reason`, `.stop_sequence`, `.usage`
- Returns JSON array of preprocessed messages

## Edge Cases

- **Empty transcript**: Returns empty result
- **Transcript shorter than lineCount**: Extracts all lines
- **lineCount = 0**: Returns empty result
- **No messages** (only summaries/metadata): Returns empty messages array
- **File not found**: Throws error with clear message

## Test Coverage

16 tests covering:

- Line extraction (default 80, custom count, shorter than count)
- Message filtering (with/without tool messages)
- Metadata stripping (with/without)
- Edge cases (empty, no messages, zero count, excessive count)
- Content preservation (string, array)
- File loading (success, options, error)

All tests validate byte-for-byte parity with Track 1 output.

## Design for Reusability

### Placement: `src/lib/transcript/`

**Why not `src/benchmark/preprocessing/`?**

Transcript processing is **shared infrastructure**, not benchmark-specific:

- Benchmark uses it for preprocessing before topic extraction
- Sidekick (future) will use it for topic extraction and session analysis
- Both need identical behavior (line extraction, filtering, metadata stripping)

### Future Extraction

When sidekick migration begins, this module will be extracted to `packages/common/transcript/` as part of the shared library, alongside providers, config, and logging.

**Extraction readiness checklist**:

- ✅ No benchmark-specific dependencies
- ✅ Clear, documented interface
- ✅ Comprehensive test coverage
- ✅ Behavioral parity with Track 1 validated

## Example: Benchmark Usage

```typescript
import { extractExcerptFromFile } from './lib/transcript'
import { generateTopicExtraction } from './benchmark/topic'

// Load and preprocess transcript
const excerpt = extractExcerptFromFile('test-data/transcripts/long-001.jsonl', {
  lineCount: 80, // last 80 lines
  filterToolMessages: true, // remove tool noise
  stripMetadata: true, // reduce token count
})

// Send to LLM for topic extraction
const topic = await generateTopicExtraction(excerpt.messages)
```

## Example: Sidekick Usage (Future)

```typescript
import { extractExcerpt } from '@claude-config/common/transcript'
import { getCurrentSession } from './sidekick/session'

// Get current session transcript
const transcript = await getCurrentSession()

// Extract recent context
const excerpt = extractExcerpt(transcript, {
  lineCount: 50, // last 50 lines (more recent context)
  filterToolMessages: false, // keep tool messages for context
  stripMetadata: true,
})

// Analyze session state
const analysis = await analyzeSession(excerpt.messages)
```
