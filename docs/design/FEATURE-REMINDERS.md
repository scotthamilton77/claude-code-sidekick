# Feature: Reminders

## 1. Overview

The Reminders feature ensures the user and the LLM stay on track by injecting context-aware prompts at specific intervals or events, sometimes "blocking" a decision the agent may be taking. It implements rule-based (turn-based, tool-usage-based, dynamic condition evaluation-based) staging logic through a distributed handler architecture that aligns with the core event model defined in `docs/design/flow.md`.

**Key Principle**: There is no monolithic reminder system. Instead, individual handlers register for specific events (hook or transcript) and are responsible for staging or consuming reminders. Common functionality (template resolution, file I/O) is consolidated in a thin `ReminderUtils` module.

**Related Documents**:

- `docs/design/flow.md`: Event model, hook flows, handler registration
- `docs/design/TRANSCRIPT-PROCESSING.md`: TranscriptService as metrics owner (turn count, tool count, etc.)
- `docs/design/CORE-RUNTIME.md`: RuntimeContext, handler registration API

## 2. Scope

- **Cadence-based Reminders**: Inject reminders after N turns or M tool uses.
- **Event-based Reminders**: Inject reminders when specific patterns are detected (e.g., "stuck" detection, pre-completion verification).
- **Unstaging Pattern**: Clear non-persistent reminders on new user prompt.

## 3. Architecture

### 3.1 Handler-Based Design (Unified Event Model)

Per **docs/design/flow.md §2.3**, handlers register with filters to specify which events they process. Reminders use both hook events (for CLI response) and transcript events (for metrics-driven staging):

| Handler                           | Filter Type | Event(s)         | Priority | Responsibility                                              |
| --------------------------------- | ----------- | ---------------- | -------- | ----------------------------------------------------------- |
| `StageDefaultUserPromptReminder`  | hook        | SessionStart     | 50       | Stage initial turn-cadence reminder                         |
| `StagePauseAndReflect`            | transcript  | ToolCall         | 80       | Stage if `toolsThisTurn` ≥ threshold; unstages verify-completion |
| `StageStopReminders`              | transcript  | ToolCall         | 60       | Stage on source file edit (Write, Edit tools)               |
| `UnstageVerifyCompletion`         | hook        | UserPromptSubmit | 45       | Delete verify-completion reminder (new prompt = task done)  |
| `InjectUserPromptSubmitReminders` | hook        | UserPromptSubmit | 50       | Consume staged reminder, return in hook response            |
| `InjectPreToolUseReminders`       | hook        | PreToolUse       | 50       | Consume staged reminder, return blocking response           |
| `InjectPostToolUseReminders`      | hook        | PostToolUse      | 50       | Consume staged reminder, return in hook response            |
| `InjectStopReminders`             | hook        | Stop             | 50       | Consume staged reminder, return blocking response           |

**Note**: The `StagePauseAndReflect` handler watches `toolsThisTurn` and stages a reminder when the threshold is exceeded. The reminder's `priority` field determines consumption order when multiple are staged (higher wins).

**Dual-Registration via Event Routing**: This feature demonstrates **Pattern 2** from **docs/design/CORE-RUNTIME.md §6.10**. Role separation is achieved through event filter types rather than explicit context discrimination:

- **Staging handlers**: `{ kind: 'transcript', ... }` → Daemon (TranscriptService owner)
- **Consumption handlers**: `{ kind: 'hook', ... }` → CLI (synchronous hook responder)

This pattern is ideal when feature concerns naturally align with event types. For features requiring role-specific logic within the _same_ event type, use the **role discriminant pattern** instead.

**Registration Example**:

```typescript
// Staging handler: watches toolsThisTurn for pause-and-reflect condition
context.handlers.register({
  id: 'reminders:stage-pause-and-reflect',
  priority: 80, // Higher priority handler runs first
  filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
  handler: async (event, ctx) => {
    const metrics = ctx.transcript.getMetrics()
    if (metrics.toolsThisTurn >= ctx.config.reminders.pause_threshold) {
      const reminder = await ReminderUtils.resolveReminder('pause-and-reflect', {
        toolsThisTurn: metrics.toolsThisTurn,
      })
      await ReminderUtils.stageReminder(ctx, 'PreToolUse', reminder)
    }
  },
})

// Consumption handler: returns highest-priority staged reminder
context.handlers.register({
  id: 'reminders:inject-pre-tool-use',
  priority: 50,
  filter: { kind: 'hook', hooks: ['PreToolUse'] },
  handler: async (event, ctx) => {
    const reminder = await ReminderUtils.consumeReminder(ctx, 'PreToolUse')
    if (reminder) {
      return {
        response: {
          blocking: reminder.blocking,
          reason: reminder.reason,
          additionalContext: reminder.additionalContext,
        },
      }
    }
  },
})
```

### 3.2 Shared Utilities

A thin `ReminderUtils` module provides common functionality:

```typescript
// packages/feature-reminders/src/reminder-utils.ts
export const ReminderUtils = {
  // Load reminder definition (YAML), interpolate {{variables}}, return StagedReminder
  resolveReminder(reminderId: string, context: TemplateContext): StagedReminder

  // Stage a reminder file (idempotent - won't re-stage if already exists)
  stageReminder(ctx: RuntimeContext, hookName: string, reminder: StagedReminder): void

  // Consume highest-priority reminder
  consumeReminder(ctx: RuntimeContext, hookName: string): StagedReminder | null
}
```

### 3.3 Data Models

#### Staged Reminder File

**Location**: `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`

```typescript
interface StagedReminder {
  name: string // Unique identifier (e.g., "UserPromptSubmitReminder")
  blocking: boolean // Whether to block the action
  priority: number // Higher = consumed first
  persistent: boolean // If true, file is not deleted on consumption
  // Text fields (all optional, pre-interpolated from YAML template)
  userMessage?: string // Shown to user in chat
  additionalContext?: string // Injected as system context
  reason?: string // Used as blocking reason
}
```

#### Reminder Personalities

| Type           | Example                    | `persistent` | Behavior                           |
| -------------- | -------------------------- | ------------ | ---------------------------------- |
| **Persistent** | UserPromptSubmitReminder   | `true`       | Always fires, never deleted        |
| **One-shot**   | PauseAndReflectReminder    | `false`      | Fires once, deleted on consumption |
| **One-shot**   | VerifyCompletionReminder   | `false`      | Fires once, deleted on consumption |

**Note**: Reminders can also be unstaged (deleted before consumption) when context changes—for example, `VerifyCompletionReminder` is unstaged on UserPromptSubmit since a the UserPromptSubmit reminder will help
compensate for Claude Code forgetfulness.

## 4. State Management

### 4.1 Metrics (TranscriptService - Read Only)

Per **docs/design/TRANSCRIPT-PROCESSING.md**, metrics are owned by `TranscriptService`. Reminders handlers **consume** metrics but do not maintain their own counters (however they can still maintain their own state such as countdowns using the StateManager):

```typescript
// Handlers access metrics via context
const metrics = ctx.transcript.getMetrics()

interface TranscriptMetrics {
  turnCount: number // Total user prompts in session
  toolsThisTurn: number // Tools since last UserPrompt (auto-resets)
  toolCount: number // Total tool invocations
  // ... other metrics
}
```

**Key Change from Legacy**: Handlers no longer increment counters. TranscriptService derives metrics from transcript content, ensuring single source of truth.

### 4.2 No Reminder-Specific State

The reminders feature maintains **no persistent state** beyond staged files:

- **Counters**: Derived from `TranscriptService.getMetrics()` (§4.1)
- **"Has edit occurred?"**: Implicit in staged `VerifyCompletionReminder` existence

This stateless design simplifies testing and eliminates state synchronization issues.

### 4.3 Threshold Subscriptions

For efficiency, handlers can subscribe to threshold alerts instead of polling:

```typescript
// Subscribe to threshold crossing (e.g., "stuck" detection)
ctx.transcript.onThreshold('toolsThisTurn', config.stuck_threshold, async () => {
  await ReminderUtils.stageReminder(ctx, 'PreToolUse', {
    name: 'AreYouStuckReminder',
    blocking: true,
    persistent: false,
    priority: 80,
  })
})
```

This is more efficient than checking thresholds on every ToolCall event.

## 5. Workflows

### 5.1 Turn-Based Reminder (UserPromptSubmit)

**Staging** (Daemon, SessionStart):

1. `StageDefaultUserPromptReminder` resolves `user-prompt-submit` template
2. Creates `.sidekick/sessions/{id}/stage/UserPromptSubmit/UserPromptSubmitReminder.json`
3. Sets `persistent: true`, `priority: 10`

**Consumption** (CLI, UserPromptSubmit):

1. `InjectUserPromptSubmitReminders` scans stage directory
2. Finds highest-priority pending reminder
3. Returns content in `hookSpecificOutput.additionalContext`
4. Does NOT delete (persistent reminder)

**Re-staging** (Daemon, PostToolUse):

1. If turn cadence met, re-stage with fresh content (summary update, etc.)

### 5.2 Tool-Based "Pause and Reflect" (Transcript → PreToolUse)

**Staging** (Daemon, TranscriptEvent: ToolCall):

1. `StagePauseAndReflect` receives ToolCall transcript event
2. Queries `ctx.transcript.getMetrics().toolsThisTurn`
3. If `toolsThisTurn >= pause_threshold`:
   - **Unstages `verify-completion`** if staged (prevents cascade—see rationale below)
   - Resolves `pause-and-reflect` reminder definition
   - Stages to `.sidekick/sessions/{id}/stage/PreToolUse/PauseAndReflectReminder.json`
   - Sets `blocking: true`, `persistent: false`, `priority: 80`

**Rationale for unstaging verify-completion**: When pause-and-reflect blocks the model, the Stop hook fires. If verify-completion were still staged, it would be consumed immediately—defeating the purpose of pausing to reflect mid-turn. By unstaging verify-completion, the model can reflect and continue working without triggering premature completion verification.

**Alternative**: Use threshold subscription (see §4.3) for more efficient detection.

**Consumption** (CLI, HookEvent: PreToolUse):

1. `InjectPreToolUseReminders` finds the staged reminder
2. Returns `{ blocking: true, reason: reminder.reason }`
3. Deletes file (one-shot)
4. Agent pauses to reflect

### 5.3 Pre-Completion Verification (Stop)

**Staging** (Daemon, TranscriptEvent: ToolCall):

1. `StageStopReminders` receives ToolCall event with tool name
2. Detects source file edit (Write, Edit, Multiedit on `.ts`, `.js`, `.py`, etc.) from `event.payload` (**note to claude**: we can also look at documentation-only updates, and stage a different reminder - when it's time to implement, let's discuss)
3. If `stage/Stop/VerifyCompletionReminder.json` doesn't exist (idempotent):
   - Resolves `verify-completion` reminder definition
   - Stages `.sidekick/sessions/{id}/stage/Stop/VerifyCompletionReminder.json`
   - Sets `blocking: true`, `persistent: false`, `priority: 50`

**Unstaging** (Daemon):

The verify-completion reminder is unstaged in two scenarios:

1. **UserPromptSubmit** (`UnstageVerifyCompletion` handler):
   - A new user prompt means the previous task is complete—no need to verify

2. **Pause-and-reflect staging** (`StagePauseAndReflect` handler):
   - Prevents cascade where blocking triggers Stop hook, which would consume verify-completion
   - See §5.2 for detailed rationale

**Consumption** (CLI, HookEvent: Stop):

1. `InjectStopReminders` finds pending reminder
2. **Smart Completion Detection** (see §5.6): Classifies the assistant's stopping intent
3. Based on classification, either blocks with verification checklist or allows with softer message
4. Renames file with timestamp suffix (preserves consumption history)
5. If consuming `verify-completion`:
   - Deletes any staged `pause-and-reflect` (prevents cascade)
   - Sends `reminder.consumed` IPC to Daemon (resets P&R baseline)

### 5.4 Reactivation Logic

Reminders track consumption history via timestamped files (e.g., `verify-completion.1736841830298.json`). This enables reactivation decisions:

**Verify-Completion (VC)**: Only fires **once per turn**. After consumption, additional file edits in the same turn do NOT re-stage VC. A new user prompt (new turn) resets this.

**Pause-and-Reflect (P&R)**: Uses a **baseline threshold** that resets after VC consumption:

| Scenario | P&R Threshold Calculation |
|----------|--------------------------|
| Normal (no VC consumed) | `toolsThisTurn >= pause_threshold` (default: 15) |
| After VC consumed | `toolsThisTurn - vcToolsThisTurn >= pause_threshold` |
| New turn | Baseline resets to 0 |

**Example**: If VC is consumed at tool 8 with threshold 15:
- Tool 15: P&R does NOT fire (15 - 8 = 7 < 15)
- Tool 23: P&R fires (23 - 8 = 15 ≥ 15)

### 5.5 P&R Baseline Reset (IPC)

When VC is consumed, the CLI sends `reminder.consumed` IPC to the Daemon:

```typescript
await ipc.send('reminder.consumed', {
  sessionId,
  reminderName: 'verify-completion',
  metrics: { turnCount, toolsThisTurn }
})
```

The Daemon stores the baseline in `.sidekick/sessions/{id}/state/pr-baseline.json`:

```typescript
interface PRBaselineState {
  turnCount: number      // Turn when VC was consumed
  toolsThisTurn: number  // Tools at consumption (new P&R baseline)
  timestamp: number      // Unix timestamp
}
```

The P&R staging handler reads this file and adjusts its threshold calculation accordingly. The baseline is cleared on `UserPromptSubmit` (new turn).

### 5.6 Smart Completion Detection

When the `verify-completion` reminder is consumed, the system uses an LLM to classify the assistant's stopping intent. This prevents unnecessary blocking when the assistant is asking a question or providing an informational answer rather than claiming task completion.

#### 5.6.1 Classification Categories

| Category | Behavior | Example Signals |
|----------|----------|-----------------|
| `CLAIMING_COMPLETION` | **Block** with verification checklist | "I've completed...", "All done!", "The fix is in place" |
| `ASKING_QUESTION` | **Silent** (no interruption) | "What would you prefer?", "Should I...", "Which approach?" |
| `ANSWERING_QUESTION` | **Silent** (no interruption) | Explaining code, describing architecture, providing analysis |
| `OTHER` | **Soft message**: "Agent's work may be incomplete" | Progress updates, presenting proposals, reporting blockers |

#### 5.6.2 Classification Flow

```
Stop hook fires with verify-completion staged
  → Extract last user prompt and assistant message from transcript
  → Filter out system-generated content (warmup, slash commands, meta entries)
  → Send to LLM with completion-classifier prompt
  → Parse JSON response { category, confidence, reasoning }
  → If category=CLAIMING_COMPLETION AND confidence >= threshold:
      → Block with verification checklist (existing behavior)
  → Else if category=OTHER:
      → Allow stop, show user message "Agent's work may be incomplete"
  → Else (ASKING_QUESTION, ANSWERING_QUESTION):
      → Allow stop silently (no interruption)
```

#### 5.6.3 Confidence Threshold

The classifier returns a confidence score (0.0-1.0). Only `CLAIMING_COMPLETION` classifications with confidence ≥ `confidence_threshold` (default: 0.7) trigger blocking behavior.

| Confidence | Interpretation |
|------------|----------------|
| > 0.8 | High confidence—clear, unambiguous signals |
| 0.5-0.8 | Medium confidence—some ambiguity but leans toward category |
| < 0.5 | Low confidence—highly ambiguous, could fit multiple categories |

**Conservative Default**: The classifier prompt instructs the LLM to be conservative—when ambiguous between `CLAIMING_COMPLETION` and another category, it should choose the other. This minimizes false-positive blocks.

#### 5.6.4 Fallback Behavior

If classification fails (LLM error, parse failure, disabled), the system defaults to **blocking**. This ensures safety—it's better to ask for verification when uncertain than to let incomplete work pass.

#### 5.6.5 Implementation

- **Classifier Module**: `packages/feature-reminders/src/completion-classifier.ts`
- **Prompt Template**: `assets/sidekick/prompts/completion-classifier.prompt.txt`
- **JSON Schema**: `assets/sidekick/schemas/completion-classifier.schema.json`
- **LLM Profile**: Uses `fast-lite` profile by default (cheap, fast models like `haiku`)

## 6. CLI Consumption Handler Factory

Consumption handlers follow a consistent pattern, implemented via `createConsumptionHandler()`:

```typescript
createConsumptionHandler(context, {
  id: 'reminders:inject-stop',
  hook: 'Stop',
  supportsBlocking: true,
  onConsume: async ({ reminder, reader, cliCtx, sessionId }) => {
    // Hook-specific logic here (optional)
  },
})
```

**Factory Flow**:
1. Guard: Only runs in CLI context
2. List staged reminders, sorted by priority (highest first)
3. Rename if not persistent (preserves consumption history for reactivation)
4. Call `onConsume` callback if provided (for hook-specific side effects)
5. Build and return `HookResponse`

### 6.1 The `onConsume` Callback

The optional `onConsume` callback allows hook-specific logic without duplicating the consumption flow:

```typescript
interface OnConsumeParams {
  reminder: StagedReminder    // The reminder being consumed
  reader: CLIStagingReader    // For additional staging operations
  cliCtx: CLIContext          // For IPC, logging, etc.
  sessionId: string           // Current session
}
```

**Example: Stop hook with VC cascade prevention**:

```typescript
onConsume: async ({ reminder, reader, cliCtx, sessionId }) => {
  if (reminder.name === 'verify-completion') {
    // Delete any staged P&R to prevent cascade
    reader.deleteReminder('PreToolUse', 'pause-and-reflect')

    // Send IPC to reset P&R baseline threshold
    const ipc = new IpcService(cliCtx.paths.projectDir, cliCtx.logger)
    await ipc.send('reminder.consumed', { sessionId, reminderName: reminder.name, metrics })
  }
}
```

### 6.2 Consumption Algorithm (Internal)

```typescript
function consumeReminder(ctx: RuntimeContext, hookName: string): HookResult {
  const stageDir = `.sidekick/sessions/${ctx.sessionId}/stage/${hookName}/`

  // Find all staged reminders, sort by priority descending
  const files = glob(`${stageDir}/*.json`)
  const reminders = files
    .map((f) => ({ path: f, ...JSON.parse(read(f)) }))
    .sort((a, b) => b.priority - a.priority)

  if (reminders.length === 0) return {}

  const reminder = reminders[0]

  // Rename if not persistent (preserves consumption history)
  if (!reminder.persistent) {
    rename(reminder.path, `${reminder.name}.${Date.now()}.json`)
  }

  // Log and return
  log({ type: 'ReminderConsumed', reminder: reminder.name, hook: hookName })

  // Build response from text fields
  const result: HookResult = {}
  if (reminder.blocking && reminder.reason) {
    result.blocking = true
    result.reason = reminder.reason
  }
  if (reminder.additionalContext) {
    result.additionalContext = reminder.additionalContext
  }
  if (reminder.userMessage) {
    result.userMessage = reminder.userMessage
  }
  return result
}
```

## 7. Logging Events

Aligned with `docs/design/flow.md` event taxonomy:

| Event              | Source     | When                              |
| ------------------ | ---------- | --------------------------------- |
| `ReminderStaged`   | Daemon | Reminder file created             |
| `ReminderUnstaged` | Daemon | Reminder file deleted (unstaging) |
| `ReminderConsumed` | CLI        | Reminder returned in hook         |

Event payloads include the reminder `name`, `hook`, and relevant context.

## 8. Configuration

Configuration cascades from defaults to user overrides:

| Key                          | Default | Description                                       |
| :--------------------------- | :------ | :------------------------------------------------ |
| `reminders.enabled`          | `true`  | Master switch for the feature                     |
| `reminders.pause_and_reflect_threshold`  | `40`    | Tools per turn before "pause and reflect" reminder |
| `reminders.source_code_patterns` | See §8.2 | Glob patterns for files that trigger verify-completion |
| `reminders.completion_detection.enabled` | `true` | Enable smart completion detection (LLM classification) |
| `reminders.completion_detection.confidence_threshold` | `0.7` | Minimum confidence to treat as claiming completion |
| `reminders.completion_detection.llm.profile` | `fast-lite` | LLM profile for classification |
| `reminders.completion_detection.llm.fallback_profile` | `cheap-fallback` | Fallback profile if primary fails |

### 8.1 Reminder Definitions (YAML)

Reminder definitions combine configuration and template text in YAML format. Resolved at staging time using the asset cascade:

1. `.sidekick/reminders/{id}.yaml` (project override)
2. `~/.sidekick/reminders/{id}.yaml` (user override)
3. `assets/sidekick/reminders/{id}.yaml` (built-in default)

**Schema**:

```yaml
# {reminder-id}.yaml
id: string              # Must match filename
blocking: boolean       # Whether to block the action
priority: number        # Higher = consumed first when multiple staged
persistent: boolean     # If true, not deleted on consumption

# Content fields (all optional, supports {{variable}} interpolation)
userMessage: |
  Multi-line text shown to user in chat UI

additionalContext: |
  Multi-line text injected as system context

reason: |
  Single-line text used as blocking reason
```

**Example** (`pause-and-reflect.yaml`):

```yaml
id: pause-and-reflect
blocking: true
priority: 80
persistent: false

additionalContext: |
  PAUSE AND REFLECT: You've used {{toolsThisTurn}} tools this turn.
  Before continuing, take a moment to:

  1. Summarize progress toward the goal
  2. Identify any blockers or issues
  3. Consider if user input would help

reason: Checkpoint - {{toolsThisTurn}} tools used this turn
```

**Available Reminder IDs**:

| ID                   | Default Priority | Typical Hook     |
| -------------------- | ---------------- | ---------------- |
| `user-prompt-submit` | 10               | UserPromptSubmit |
| `pause-and-reflect`  | 80               | PreToolUse       |
| `verify-completion`  | 50               | Stop             |

### 8.2 Source Code Patterns

The `source_code_patterns` configuration determines which file edits trigger the `verify-completion` reminder. Uses [picomatch](https://github.com/micromatch/picomatch) glob syntax.

**Default patterns** (defined in `assets/sidekick/defaults/features/reminders.defaults.yaml`):

```yaml
source_code_patterns:
  # TypeScript/JavaScript
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  # Python, Go, Rust, etc.
  - "**/*.py"
  - "**/*.go"
  - "**/*.rs"
  # Config files
  - "**/*.yaml"
  - "**/*.yml"
  - "**/package.json"
  - "**/Dockerfile"
  # ... and more (see defaults file for full list)
```

**Note**: Documentation files (`*.md`) are intentionally excluded to reduce noise when the assistant is only updating docs.

### 8.3 Smart Completion Detection Configuration

The `completion_detection` settings control the LLM-based classification of stopping intent (see §5.6):

```yaml
reminders:
  settings:
    completion_detection:
      # Disable to always block on verify-completion (pre-5.6 behavior)
      enabled: true

      # Higher = more conservative (blocks less often)
      # 0.7 means: only block if LLM is >70% confident it's CLAIMING_COMPLETION
      confidence_threshold: 0.7

      # LLM profile selection (fast, cheap models recommended)
      llm:
        profile: fast-lite          # Primary profile
        fallback_profile: cheap-fallback  # Used if primary fails
```

**When to adjust**:
- **Lower threshold** (0.5): Block more often—use if agents frequently skip verification
- **Higher threshold** (0.9): Block rarely—use if blocking feels intrusive
- **Disable**: Set `enabled: false` to always block on verify-completion (original behavior)

## 9. Integration Points

- **TranscriptService**: Provides `getMetrics()` for threshold evaluation, `onThreshold()` for efficient subscription
- **Asset Resolver**: Locates YAML reminder definitions in the cascade, performs `{{variable}}` interpolation
- **HandlerRegistry**: Unified registration with filters for hook events (`InjectXXX`, `UnstageXXX`) and transcript events (`StageXXX`)
- **File System**: Direct file operations for staging, unstaging, and consumption (no state manager needed)

## 10. Migration from Legacy

- **State**: Legacy counter files are ignored. Fresh start is acceptable.
- **Templates**: Legacy `.txt` templates in `~/.claude/hooks/sidekick/reminders/` should be converted to YAML format and placed in `~/.sidekick/reminders/`.
- **Config**: Legacy `.conf` variables (`USER_PROMPT_CADENCE`, `TOOL_CADENCE`, etc.) are migrated to JSON config by the migration utility. Note: `TOOL_CADENCE` (session-wide) is replaced by `update_threshold` (per-turn).
