# Feature: Session Summary

## 1. Overview

The **Session Summary** feature maintains a continuous, evolving understanding of the user's current session. It analyzes the transcript to extract a high-level **Session Title** (what is the user working on?) and the **Latest Intent** (what was the specific last request?).

This context is critical for:

1. **User Context**: Displaying the current task in the Statusline.
2. **System Context**: Providing "memory" for the Resume feature when a user returns to a session.
3. **Personality**: Generating snarky commentary and contextual messages based on session state.

### 1.1 Related Documents

- **LLD-flow.md**: Event model, hook flows, handler registration (source of truth for runtime behavior)
- **LLD-TRANSCRIPT-PROCESSING.md**: TranscriptService as metrics owner, event emission
- **LLD-CORE-RUNTIME.md**: Feature registration, handler patterns, RuntimeContext
- **LLD-STRUCTURED-LOGGING.md**: Event schema (`SidekickEvent`), logging architecture

## 2. Architecture

This feature registers handlers on both CLI and Supervisor per **LLD-CORE-RUNTIME.md §3.5**. The Supervisor performs async LLM analysis; the CLI reads staged state files.

### 2.1 Feature Manifest

```typescript
export const manifest: FeatureManifest = {
  id: 'session-summary',
  version: '1.0.0',
  description: 'Maintains session title and intent via LLM analysis',
  needs: [], // No dependencies on other features
};
```

### 2.2 Registered Handlers (Unified Event Model)

Per **LLD-flow.md §2.3**, handlers register with filters to specify which events they process:

| Filter Type  | Event(s)        | Handler                    | Priority | Description                                      |
| ------------ | --------------- | -------------------------- | -------- | ------------------------------------------------ |
| hook         | `SessionStart`  | `CreateFirstSessionSummary`| 80       | Create placeholder summary (first-prompt default)|
| transcript   | `UserPrompt`    | `UpdateSessionSummary`     | 80       | Force immediate analysis (new user intent)       |
| transcript   | `ToolCall`      | `UpdateSessionSummary`     | 70       | Conditional analysis (if cadence met)            |

**Key Change**: Summary updates are now triggered by transcript events rather than hook events. This ensures the feature reacts to actual transcript content changes rather than hook timing.

**Note**: CLI handlers for this feature are limited to reading the staged state file (via the Statusline integration). The summary state is consumed directly from disk, not via the reminder system.

### 2.3 State Files

| File                                                        | Owner      | Description                           |
| ----------------------------------------------------------- | ---------- | ------------------------------------- |
| `.sidekick/sessions/{session_id}/state/session-summary.json`| Supervisor | Current summary (title, intent, etc.) |

### 2.4 Data Flow

```
SessionStart (HookEvent)
  └─[Supervisor] CreateFirstSessionSummary
      └─ Write placeholder to state/session-summary.json

UserPrompt (TranscriptEvent)
  └─[Supervisor] UpdateSessionSummary (force=true)
      ├─ Query ctx.transcript.getMetrics() for turn count
      ├─ Extract transcript excerpt (bookmark strategy)
      ├─ Call LLM for analysis
      ├─ Update state/session-summary.json
      ├─ Generate snarky message if title or intent changed significantly (side-effect)
      └─ Generate resume message if title changed significantly (side-effect)

ToolCall (TranscriptEvent)
  └─[Supervisor] UpdateSessionSummary (force=false)
      ├─ Query ctx.transcript.getMetrics() for tool count
      ├─ Check countdown; skip if not zero
      ├─ (If countdown reached) Same flow as UserPrompt
      └─ Decrement countdown

Statusline (external)
  └─ Read state/session-summary.json synchronously
```

**Metrics Access**: Handlers use `ctx.transcript.getMetrics()` instead of maintaining their own counters. See **LLD-TRANSCRIPT-PROCESSING.md** for metrics API.

### 2.5 Dual-Registration Pattern

Per **LLD-CORE-RUNTIME.md §6.10**, this feature uses **Pattern 1: Role Discriminant** to register Supervisor-only handlers:

```typescript
export function register(context: RuntimeContext): void {
  if (context.role === 'supervisor') {
    // TypeScript narrows to SupervisorContext - ctx.llm, ctx.staging available
    context.handlers.register({
      id: 'session-summary:init',
      filter: { kind: 'hook', hooks: ['SessionStart'] },
      handler: createFirstSessionSummary,
      priority: 80
    });
    context.handlers.register({
      id: 'session-summary:update',
      filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
      handler: updateSessionSummary,
      priority: 80
    });
  }
  // CLI: No direct handlers (state consumed via Statusline)
}
```

This feature registers handlers on **Supervisor only**. The CLI consumes the session summary state file directly via the Statusline integration, without needing dedicated handlers.

## 3. Detailed Design

### 3.1 Handler: `CreateFirstSessionSummary`

**Hook**: `SessionStart` | **Priority**: 80

Creates a placeholder summary when a session begins, ensuring the Statusline always has content to display.

```typescript
async function createFirstSessionSummary(
  event: SessionStartHookEvent,
  ctx: SupervisorContext
): Promise<void> {
  const { sessionId } = event.context;
  const { startType } = event.payload;

  if (startType === 'startup' || startType === 'clear') {
    // Fresh session: write placeholder
    await ctx.staging.writeState(sessionId, 'session-summary.json', {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      session_title: 'New Session',
      session_title_confidence: 0,
      latest_intent: 'Awaiting first prompt...',
      latest_intent_confidence: 0,
    });
  }
  // resume/compact: preserve existing summary
}
```

### 3.2 Handler: `UpdateSessionSummary`

**Hook**: `UserPromptSubmit`, `PostToolUse` | **Priority**: 80

Performs LLM-based transcript analysis to update the session summary. Uses confidence-based throttling to minimize costs.

#### 3.2.1 Trigger Logic & Throttling

| Trigger (Event)          | Behavior                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `UserPrompt` (transcript)| **Force** analysis (user intent likely changed)                          |
| `ToolCall` (transcript)  | **Conditional**: only if countdown reached zero                          |

**Key Change**: Triggers are now based on transcript events rather than hook events. This decouples summary updates from hook timing and allows reaction to actual transcript content.

**Countdown Logic** (stored in session state):

- **State Variables**: `title_confidence`, `intent_confidence`, `countdown`
- **Reset**: After successful analysis, `countdown` is reset based on confidence:
  - **High Confidence (>0.8)**: Reset to **20** (check again after 20 tool uses)
  - **Medium Confidence (0.6-0.8)**: Reset to **5**
  - **Low Confidence (<0.6)**: Reset to **1** (check almost immediately)
- **Decrement**: Every `PostToolUse` decrements the counter
- **Fire**: When `countdown <= 0`, analysis is triggered

#### 3.2.2 Transcript Extraction (The "Bookmark" System)

To handle long sessions without hitting token limits, we use a **Tiered Extraction Strategy**:

1. **Bookmark Line**: Track `bookmark_line`—the point where we last had High Confidence in the session title.
2. **Historical Context** (Line 1 → `bookmark_line`):
   - Filtering: Aggressive. Remove tool outputs, verbose logs. Keep only high-level user/assistant exchanges.
3. **Recent Context** (`bookmark_line` → End):
   - Filtering: Light. Keep more detail to capture the immediate context of the latest request.
4. **Fallback**: If bookmark strategy yields insufficient context, fall back to a standard "tail" of the last N lines.

**Compaction Behavior**: The bookmark line is a line number in the transcript file. When compaction occurs:
- The transcript file is truncated/rewritten
- **Bookmark must be reset to 0** (start of file)
- **Immediate re-analysis is required** to re-establish confidence on the compacted transcript
- The `SessionStart` hook with `type: 'compact'` triggers this reset via `CreateFirstSessionSummary` (which preserves the summary but resets internal bookmark state)

#### 3.2.3 LLM Interaction

**Provider Configuration**: Each LLM task has its own provider/model configuration with fallback:

| Task               | Config Key                     | Default Provider | Default Model                     | Fallback Provider | Fallback Model  |
| ------------------ | ------------------------------ | ---------------- | --------------------------------- | ----------------- | --------------- |
| **Summary**        | `llm.summary.*`                | `openrouter`     | `google/gemini-2.0-flash-lite-001`| `openai-api`      | `gpt-5-nano`    |
| **Snarky Message** | `llm.snarkyComment.*`          | `openrouter`     | `qwen/qwen3-235b-a22b-2507`       | `openai-api`      | `gpt-5-nano`    |
| **Resume Message** | `llm.resume.*`                 | `openrouter`     | `qwen/qwen3-235b-a22b-2507`       | `openai-api`      | `gpt-5-nano`    |

**Prompt Templates** (in `assets/sidekick/prompts/`):
- `session-summary.prompt.txt`: Standard full analysis
- `session-summary-bookmark.prompt.txt`: Tiered analysis (Historical + Recent)
- `snarky-comment.prompt.txt`: Snarky commentary generation
- `resume-message.prompt.txt`: Resume message generation

**Response Schema** (in `assets/sidekick/schemas/`):
- `session-summary.schema.json`: Summary response with pivot detection flag
- `snarky-comment.schema.json`: Snarky message response
- `resume-message.schema.json`: Resume message response

#### 3.2.4 Side Effects

After successful summary generation, `UpdateSessionSummary` triggers **separate LLM calls** for side-effects:

| Side Effect              | Condition                                    | LLM Call | Output                               |
| ------------------------ | -------------------------------------------- | -------- | ------------------------------------ |
| **Snarky Message**       | Title or intent changed significantly        | Separate | `state/snarky-message.txt`           |
| **Resume Message**       | `pivot_detected: true` in summary response   | Separate | `state/resume-message.txt`           |

**Important**: Each side-effect is a **separate LLM call** with its own provider/model configuration (see §3.2.3). This allows:
- Different models optimized for each task (summary = fast/cheap, snarky = creative/larger)
- Independent fallback behavior
- Parallel execution when both are triggered

**Pivot Detection**: The summary LLM response includes a `pivot_detected: boolean` field. When `true`, the resume message is regenerated. This replaces heuristic distance calculations with LLM judgment.

These outputs are consumed by other features (Statusline, Resume) but generated as part of this feature's handler to ensure consistency between summary and messages.

### 3.3 State Schema (`state/session-summary.json`)

```json
{
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "session_title": "Refactoring the Login Flow",
  "session_title_confidence": 0.95,
  "session_title_key_phrases": ["login.ts", "auth provider", "oauth"],
  "latest_intent": "Fixing the token expiration bug",
  "latest_intent_confidence": 0.88,
  "latest_intent_key_phrases": ["token", "expire", "401 error"],
  "pivot_detected": false,
  "previous_title": "Setting up the OAuth flow",
  "previous_intent": "Configuring OAuth provider",
  "stats": {
    "total_tokens": 1234,
    "processing_time_ms": 450
  }
}
```

**Note**: `pivot_detected` is returned by the summary LLM and triggers resume message generation. `previous_title` and `previous_intent` are preserved for debugging and Monitoring UI display.

### 3.4 Monitoring UI Integration

The Session Summary feature emits `SidekickEvent` events (per **LLD-flow.md §3.2**) to the Supervisor log. The Monitoring UI aggregates these for time-travel debugging.

**Event Types**:

| Event Type       | When                                | Logged By   |
| ---------------- | ----------------------------------- | ----------- |
| `SummaryUpdated` | Summary recalculated successfully   | Supervisor  |
| `SummarySkipped` | Countdown active, analysis deferred | Supervisor  |

**Example Events** (conforming to `SidekickEvent` schema):

```json
// Analysis triggered (user prompt or countdown reached zero)
{
  "type": "SummaryUpdated",
  "time": 1732819200000,
  "source": "supervisor",
  "context": {
    "session_id": "sess-001",
    "scope": "project",
    "correlation_id": "cli-invoke-123",
    "trace_id": "req-123",
    "hook": "UserPromptSubmit",
    "task_id": "task-analyze-001"
  },
  "payload": {
    "state": {
      "session_title": "Working on OAuth integration",
      "session_title_confidence": 0.95,
      "latest_intent": "Fixing the token expiration bug",
      "latest_intent_confidence": 0.88
    },
    "metadata": {
      "countdown_reset_to": 20,
      "tokens_used": 1234,
      "processing_time_ms": 450,
      "pivot_detected": false,
      "old_title": "Working on OAuth integration",
      "old_intent": "Setting up the OAuth flow"
    },
    "reason": "user_prompt_forced"
  }
}

// Analysis skipped (countdown still active)
{
  "type": "SummarySkipped",
  "time": 1732819250000,
  "source": "supervisor",
  "context": {
    "session_id": "sess-001",
    "scope": "project",
    "correlation_id": "cli-invoke-124",
    "hook": "PostToolUse"
  },
  "payload": {
    "metadata": {
      "countdown": 5,
      "countdown_threshold": 0
    },
    "reason": "countdown_active"
  }
}
```

The `payload.state` field contains the current summary state, enabling full reconstruction in the Monitoring UI without reading the state file.

## 4. Configuration

This feature defines the `sessionSummary` configuration domain. Defaults are defined in the feature package; users may override in their config files.

### 4.1 Feature Settings

```yaml
# .sidekick/features.yaml (sessionSummary section)
features:
  sessionSummary:
    enabled: true                     # Master toggle
    excerptLines: 80                  # Transcript lines to analyze (≈3-5 messages)
    filterToolMessages: true          # Remove tool_use/tool_result from analysis
    keepHistory: false                # Keep backup of previous summary files
    maxTitleWords: 8                  # Maximum words for session_title
    maxIntentWords: 12                # Maximum words for latest_intent
    snarkyMessages: true              # Generate snarky commentary on changes

    # Countdown-based throttling (tool uses before re-analysis)
    countdown:
      lowConfidence: 5                # confidence < 0.6
      mediumConfidence: 20            # confidence 0.6-0.8
      highConfidence: 10000           # confidence > 0.8 (effectively user-prompt only)

    # Bookmark optimization thresholds
    bookmark:
      confidenceThreshold: 0.8        # Set bookmark when title reaches this confidence
      resetThreshold: 0.7             # Reset bookmark if confidence drops below this

    # Filtering safety nets
    minUserMessages: 5                # Preserve at least N user messages
    minRecentLines: 50                # Preserve at least N recent transcript lines
```

### 4.2 LLM Configuration

Each LLM task has dedicated provider/model settings with fallback chain: (**NOTE TO CLAUDE** when it comes time for implementation, note that these are examples, but `LLD-LLM-PROVIDERS.md` should be the source of truth for this!)

```yaml
# .sidekick/llm.yaml (task-specific settings)
llm:
  # Session summary analysis
  summary:
    provider: openrouter
    model: google/gemini-2.0-flash-lite-001
    fallbackProvider: openai-api
    fallbackModel: gpt-5-nano
    timeout: 10
    temperature: 0.3                  # Low temperature for consistent extraction

  # Snarky comment generation (separate LLM call)
  snarkyComment:
    provider: openrouter
    model: qwen/qwen3-235b-a22b-2507
    fallbackProvider: openai-api
    fallbackModel: gpt-5-nano
    timeout: 15
    temperature: 1.2                  # High temperature for creative snark

  # Resume message generation (separate LLM call)
  resume:
    provider: openrouter
    model: qwen/qwen3-235b-a22b-2507
    fallbackProvider: openai-api
    fallbackModel: gpt-5-nano
    timeout: 30
    temperature: 1.2                  # High temperature for natural messages
    minConfidence: 0.7                # Only generate if both confidences >= this
```

## 5. Implementation Plan

### 5.1 Phase 1: Feature Structure

- [ ] Create `packages/feature-session-summary/` package
- [ ] Define feature manifest and `register()` function
- [ ] Implement `CreateFirstSessionSummary` handler (SessionStart)
- [ ] Implement placeholder state file writing

### 5.2 Phase 2: Core Analysis Logic

- [ ] Port `_session_summary_extract_excerpt` logic to TypeScript
- [ ] Implement the "Bookmark" extraction strategy
- [ ] Implement confidence-based countdown logic
- [ ] Implement `UpdateSessionSummary` handler (UserPromptSubmit, PostToolUse)

### 5.3 Phase 3: LLM Integration

- [ ] Create prompt templates in `assets/sidekick/prompts/`
- [ ] Define response schema in `packages/schema-contracts/`
- [ ] Wire up LLM calls via `shared-providers`
- [ ] Implement snarky message generation (side-effect)
- [ ] Implement resume message generation (side-effect)

### 5.4 Phase 4: Testing & Integration

- [ ] Unit tests for extraction logic (mocked LLM)
- [ ] Integration tests with supervisor harness
- [ ] Verify Statusline reads state file correctly

## 6. Resolved Questions

| Question | Resolution |
| -------- | ---------- |
| Snarky commentary: separate feature? | **No**. Side-effect of `UpdateSessionSummary`. Config toggle: `snarkyMessages`. |
| Sleeper process? | **Removed**. Supervisor handles scheduled/delayed tasks if needed. |
| Dual-Registration Pattern | Per **LLD-CORE-RUNTIME.md §6.10**: Use role discriminant (`context.role === 'supervisor'`). See §2.5. |
| Resume message trigger | **LLM-based pivot detection**. Summary LLM returns `pivot_detected: boolean`. Replaces heuristic distance calculations. See §3.2.4. |
| Snarky message: single or separate LLM call? | **Separate LLM call** with its own provider/model/temperature config. Allows creative model for snark, fast model for summary. See §3.2.3, §3.2.4. |
