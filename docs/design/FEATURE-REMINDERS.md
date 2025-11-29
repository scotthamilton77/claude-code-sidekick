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
- **Suppression Pattern**: Coordinate between reminders to avoid double-nagging (e.g., suppress Stop reminder after AreYouStuck fires).

## 3. Architecture

### 3.1 Handler-Based Design (Unified Event Model)

Per **docs/design/flow.md §2.3**, handlers register with filters to specify which events they process. Reminders use both hook events (for CLI response) and transcript events (for metrics-driven staging):

| Handler                           | Filter Type | Event(s)         | Priority | Responsibility                                              |
| --------------------------------- | ----------- | ---------------- | -------- | ----------------------------------------------------------- |
| `StageDefaultUserPromptReminder`  | hook        | SessionStart     | 50       | Stage initial turn-cadence reminder                         |
| `StageAreYouStuckReminder`        | transcript  | ToolCall         | 80       | Stage if `toolsThisTurn` ≥ `stuck_threshold` (default: 20)  |
| `StageTimeForUserUpdateReminder`  | transcript  | ToolCall         | 70       | Stage if `toolsThisTurn` ≥ `update_threshold` (default: 15) |
| `StageStopReminders`              | transcript  | ToolCall         | 60       | Stage on source file edit (Write, Edit tools)               |
| `InjectUserPromptSubmitReminders` | hook        | UserPromptSubmit | 50       | Consume staged reminder, return in hook response            |
| `InjectPreToolUseReminders`       | hook        | PreToolUse       | 50       | Consume staged reminder, return blocking response           |
| `InjectPostToolUseReminders`      | hook        | PostToolUse      | 50       | Consume staged reminder, return in hook response            |
| `InjectStopReminders`             | hook        | Stop             | 50       | Consume staged reminder, return blocking response           |

**Note**: Both `StageAreYouStuckReminder` and `StageTimeForUserUpdateReminder` watch `toolsThisTurn`. Since both can stage before CLI consumes, the staged reminder's `priority` field determines which is returned (higher wins). Stuck (priority 80) beats update (priority 70).

**Dual-Registration via Event Routing**: This feature demonstrates **Pattern 2** from **docs/design/CORE-RUNTIME.md §6.10**. Role separation is achieved through event filter types rather than explicit context discrimination:

- **Staging handlers**: `{ kind: 'transcript', ... }` → Supervisor (TranscriptService owner)
- **Consumption handlers**: `{ kind: 'hook', ... }` → CLI (synchronous hook responder)

This pattern is ideal when feature concerns naturally align with event types. For features requiring role-specific logic within the _same_ event type, use the **role discriminant pattern** instead.

**Registration Example**:

```typescript
// Staging handler: watches toolsThisTurn for "stuck" condition
context.handlers.register({
  id: 'reminders:are-you-stuck',
  priority: 80, // Higher priority handler runs first
  filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
  handler: async (event, ctx) => {
    const metrics = ctx.transcript.getMetrics()
    if (metrics.toolsThisTurn >= ctx.config.reminders.stuck_threshold) {
      const reminder = await ReminderUtils.resolveReminder('are-you-stuck', {
        toolsThisTurn: metrics.toolsThisTurn,
      })
      await ReminderUtils.stageReminder(ctx, 'PreToolUse', reminder)
      // Suppress Stop reminders to avoid double-nagging
      await ReminderUtils.suppressHook(ctx, 'Stop')
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
          reason: reminder.stopReason,
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

  // Consume highest-priority reminder (respects suppression marker)
  consumeReminder(ctx: RuntimeContext, hookName: string): StagedReminder | null

  // Suppress all reminders for a hook (creates .suppressed marker)
  suppressHook(ctx: RuntimeContext, hookName: string): void

  // Clear suppression for a hook (deletes .suppressed marker)
  clearSuppression(ctx: RuntimeContext, hookName: string): void
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
  stopReason?: string // Used as blocking reason
}
```

#### Suppression Marker

**Location**: `.sidekick/sessions/{session_id}/stage/{hook_name}/.suppressed`

Suppression is decoupled from individual reminder files. If `.suppressed` marker exists in a hook's stage directory:

- All reminders in that directory are considered suppressed
- CLI consumption returns empty and deletes the marker
- Next consumption proceeds normally

This avoids race conditions when multiple handlers stage reminders in the same PostToolUse context.

#### Reminder Personalities

| Type           | Example                    | `persistent` | Behavior                           |
| -------------- | -------------------------- | ------------ | ---------------------------------- |
| **Persistent** | UserPromptSubmitReminder   | `true`       | Always fires, never deleted        |
| **One-shot**   | AreYouStuckReminder        | `false`      | Fires once, deleted on consumption |
| **One-shot**   | VerifyCompletionReminder   | `false`      | Fires once, deleted on consumption |
| **One-shot**   | TimeForUserUpdateReminder  | `false`      | Fires once, deleted on consumption |

**Note**: Suppression is orthogonal to personality—any hook's reminders can be suppressed via the `.suppressed` marker.

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
- **Suppression**: Managed via `.suppressed` marker files (§3.3)
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

**Staging** (Supervisor, SessionStart):

1. `StageDefaultUserPromptReminder` resolves `user-prompt-submit` template
2. Creates `.sidekick/sessions/{id}/stage/UserPromptSubmit/UserPromptSubmitReminder.json`
3. Sets `persistent: true`, `priority: 10`

**Consumption** (CLI, UserPromptSubmit):

1. `InjectUserPromptSubmitReminders` scans stage directory
2. Finds highest-priority pending reminder
3. Returns content in `hookSpecificOutput.additionalContext`
4. Does NOT delete (persistent reminder)

**Re-staging** (Supervisor, PostToolUse):

1. If turn cadence met, re-stage with fresh content (summary update, etc.)

### 5.2 Tool-Based "Are You Stuck?" (Transcript → PreToolUse)

**Staging** (Supervisor, TranscriptEvent: ToolCall):

1. `StageAreYouStuckReminder` receives ToolCall transcript event
2. Queries `ctx.transcript.getMetrics().toolsThisTurn`
3. If `toolsThisTurn >= stuck_threshold`:
   - Resolves `are-you-stuck` reminder definition
   - Stages to `.sidekick/sessions/{id}/stage/PreToolUse/AreYouStuckReminder.json`
   - Sets `blocking: true`, `persistent: false`, `priority: 80`
   - Creates `.sidekick/sessions/{id}/stage/Stop/.suppressed` marker

**Alternative**: Use threshold subscription (see §4.3) for more efficient detection.

**Consumption** (CLI, HookEvent: PreToolUse):

1. `InjectPreToolUseReminders` finds the staged reminder
2. Returns `{ blocking: true, reason: reminder.stopReason }`
3. Deletes file (one-shot)
4. Agent stops

**Stop Hook** (CLI, HookEvent: Stop):

1. `InjectStopReminders` checks for `.suppressed` marker
2. If marker exists: deletes marker, returns empty (allows stop)
3. If no marker: proceeds with normal consumption

### 5.3 Pre-Completion Verification (Stop)

**Staging** (Supervisor, TranscriptEvent: ToolCall):

1. `StageStopReminders` receives ToolCall event with tool name
2. Detects source file edit (Write, Edit, Multiedit on `.ts`, `.js`, `.py`, etc.) from `event.payload` (**note to claude**: we can also look at documentation-only updates, and stage a different reminder - when it's time to implement, let's discuss)
3. If `stage/Stop/VerifyCompletionReminder.json` doesn't exist (idempotent):
   - Resolves `verify-completion` reminder definition
   - Stages `.sidekick/sessions/{id}/stage/Stop/VerifyCompletionReminder.json`
   - Sets `blocking: true`, `persistent: false`, `priority: 50`

**Consumption** (CLI, HookEvent: Stop):

1. `InjectStopReminders` checks for `.suppressed` marker first
2. If suppressed: deletes marker, returns empty
3. If not suppressed: finds pending reminder, returns `{ blocking: true, reason: reminder.stopReason }`
4. Deletes file (one-shot, so next stop succeeds)

### 5.4 Time For User Update (Transcript → PreToolUse)

**Staging** (Supervisor, TranscriptEvent: ToolCall):

1. `StageTimeForUserUpdateReminder` receives ToolCall event
2. Queries `ctx.transcript.getMetrics().toolsThisTurn`
3. If `toolsThisTurn >= update_threshold` (and not already staged):
   - Resolves `time-for-user-update` reminder definition
   - Stages to `.sidekick/sessions/{id}/stage/PreToolUse/TimeForUserUpdateReminder.json`
   - Sets `blocking: true`, `persistent: false`, `priority: 70`

**Note**: Since `stuck_threshold > update_threshold` and stuck has higher priority (80 vs 70), if both thresholds are met, the stuck reminder will be consumed first.

**Consumption** (CLI, HookEvent: PreToolUse):

1. Same pattern as AreYouStuck—highest priority wins

## 6. CLI Consumption Algorithm

When a hook fires, the CLI consumption handler:

```typescript
function consumeReminder(ctx: RuntimeContext, hookName: string): HookResult {
  const stageDir = `.sidekick/sessions/${ctx.sessionId}/stage/${hookName}/`

  // Check suppression marker first
  const suppressedMarker = `${stageDir}.suppressed`
  if (exists(suppressedMarker)) {
    unlink(suppressedMarker)
    log({ type: 'SuppressionCleared', hook: hookName })
    return {}
  }

  // Find all staged reminders, sort by priority descending
  const files = glob(`${stageDir}/*.json`)
  const reminders = files
    .map((f) => ({ path: f, ...JSON.parse(read(f)) }))
    .sort((a, b) => b.priority - a.priority)

  if (reminders.length === 0) return {}

  const reminder = reminders[0]

  // Delete if not persistent
  if (!reminder.persistent) {
    unlink(reminder.path)
  }

  // Log and return
  log({ type: 'ReminderConsumed', reminder: reminder.name, hook: hookName })

  // Build response from text fields
  const result: HookResult = {}
  if (reminder.blocking && reminder.stopReason) {
    result.blocking = true
    result.reason = reminder.stopReason
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

| Event                | Source     | When                              |
| -------------------- | ---------- | --------------------------------- |
| `ReminderStaged`     | Supervisor | Reminder file created             |
| `ReminderConsumed`   | CLI        | Reminder returned in hook         |
| `SuppressionCreated` | Supervisor | `.suppressed` marker created      |
| `SuppressionCleared` | CLI        | `.suppressed` marker deleted      |

Event payloads include the reminder `name`, `hook`, and relevant context.

## 8. Configuration

Configuration cascades from defaults to user overrides:

| Key                          | Default | Description                                       |
| :--------------------------- | :------ | :------------------------------------------------ |
| `reminders.enabled`          | `true`  | Master switch for the feature                     |
| `reminders.turn_cadence`     | `4`     | Number of user turns between prompts              |
| `reminders.update_threshold` | `15`    | Tools per turn before "time for update" reminder  |
| `reminders.stuck_threshold`  | `20`    | Tools per turn before "stuck" warning             |

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

stopReason: |
  Single-line text used as blocking reason
```

**Example** (`are-you-stuck.yaml`):

```yaml
id: are-you-stuck
blocking: true
priority: 80
persistent: false

additionalContext: |
  <system-reminder>
  STOP AND RECONSIDER: You've used {{toolsThisTurn}} tools this turn without
  completing. This often indicates you're stuck in a loop or approaching
  the problem incorrectly.

  Before continuing:
  1. Summarize what you've tried and why it hasn't worked
  2. Consider alternative approaches
  3. Ask the user for clarification if needed
  </system-reminder>

stopReason: Agent may be stuck - {{toolsThisTurn}} tools used this turn
```

**Available Reminder IDs**:

| ID                     | Default Priority | Typical Hook   |
| ---------------------- | ---------------- | -------------- |
| `user-prompt-submit`   | 10               | UserPromptSubmit |
| `are-you-stuck`        | 80               | PreToolUse     |
| `time-for-user-update` | 70               | PreToolUse     |
| `verify-completion`    | 50               | Stop           |

## 9. Integration Points

- **TranscriptService**: Provides `getMetrics()` for threshold evaluation, `onThreshold()` for efficient subscription
- **Asset Resolver**: Locates YAML reminder definitions in the cascade, performs `{{variable}}` interpolation
- **HandlerRegistry**: Unified registration with filters for hook events (`InjectXXX`) and transcript events (`StageXXX`)
- **File System**: Direct file operations for staging, consumption, and suppression markers (no state manager needed)

## 10. Migration from Legacy

- **State**: Legacy counter files are ignored. Fresh start is acceptable.
- **Templates**: Legacy `.txt` templates in `~/.claude/hooks/sidekick/reminders/` should be converted to YAML format and placed in `~/.sidekick/reminders/`.
- **Config**: Legacy `.conf` variables (`USER_PROMPT_CADENCE`, `TOOL_CADENCE`, etc.) are migrated to JSON config by the migration utility. Note: `TOOL_CADENCE` (session-wide) is replaced by `update_threshold` (per-turn).
