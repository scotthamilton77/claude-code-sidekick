# Feature: Reminders

NOTE: NOT YET REVIEWED

## 1. Overview

The Reminders feature ensures the user and the LLM stay on track by injecting context-aware prompts at specific intervals or events. It replicates the legacy "nudge" functionality (turn-based, tool-based, and pre-completion checks) while establishing a foundation for dynamic, user-defined, or AI-generated reminders in the future.

## 2. Scope

- **Cadence-based Reminders**: Inject reminders after $N$ turns or $M$ tool uses.
- **Event-based Reminders**: Inject reminders when specific patterns are detected (e.g., "stuck" detection, pre-completion verification).
- **Dynamic Reminders**: Support for ad-hoc reminders registered by other features or (future) user commands.
- **State Management**: Persist counters and flags across CLI invocations via the Supervisor.

## 3. Architecture

The feature is implemented as a standard Sidekick feature package (`packages/feature-reminders`).

### 3.1 Components

- **`ReminderService`**: The main entry point. Evaluates triggers and resolves templates.
- **`ReminderStore`**: Manages the state of counters and active dynamic reminders. Reads from the shared state file; writes via Supervisor IPC.
- **`TemplateResolver`**: Locates and loads reminder text from the asset cascade.
- **`TriggerEvaluator`**: Logic to determine if a reminder should fire based on current context (turn count, tool usage, etc.).

### 3.2 Data Models

#### Reminder Definition
```typescript
interface ReminderDefinition {
  id: string;
  type: 'static' | 'dynamic';
  trigger: TriggerDefinition;
  templateId: string; // e.g., 'user-prompt-submit', 'pre-completion'
  priority: number;
}
```

#### Trigger Definition
```typescript
type TriggerDefinition = 
  | { type: 'turn_cadence'; interval: number }
  | { type: 'tool_cadence'; interval: number }
  | { type: 'event'; eventName: string; condition?: (context: any) => boolean };
```

#### Reminder State
```typescript
interface ReminderState {
  counters: {
    turn_count: number;
    tool_count: number;
    tools_this_turn: number;
  };
  flags: {
    pre_completion_pending: boolean;
    stuck_reminder_fired: boolean;
  };
  dynamic_reminders: DynamicReminder[];
}
```

## 4. Workflows

### 4.1 Turn-Based Reminder (UserPromptSubmit)

1.  **Hook Invocation**: `UserPromptSubmit` hook is called.
2.  **State Read**: `ReminderService` reads the current `turn_count` from `ReminderStore` (mapped to `.sidekick/state/reminders.json`).
3.  **Evaluation**:
    -   Calculates `next_count = current_count - 1`.
    -   If `next_count <= 0`:
        -   **Action**: Resolve `user-prompt-submit` template.
        -   **State Update**: Send IPC message `reminders:reset_turn_count` to Supervisor.
        -   **Output**: Return reminder text in `hookSpecificOutput.additionalContext`.
    -   Else:
        -   **State Update**: Send IPC message `reminders:decrement_turn_count` to Supervisor.
        -   **Output**: None.
4.  **Tools Reset**: Send IPC message `reminders:reset_tools_this_turn` to Supervisor.

### 4.2 Tool-Based Reminder (PostToolUse)

1.  **Hook Invocation**: `PostToolUse` hook is called.
2.  **State Read**: Read `tool_count` and `tools_this_turn`.
3.  **Cadence Check**:
    -   Similar logic to Turn-Based: Decrement `tool_count`. If <= 0, fire `post-tool-use-cadence` reminder and reset.
4.  **Stuck Check**:
    -   Increment `tools_this_turn`.
    -   If `tools_this_turn > threshold`:
        -   Fire `post-tool-use-stuck` reminder.
        -   Set `stuck_reminder_fired` flag via IPC.
5.  **Pre-Completion Check**:
    -   Check if the tool used was a file modification tool (Write, Edit, etc.).
    -   If yes, send IPC `reminders:set_pre_completion_pending` to Supervisor.

### 4.3 Pre-Completion Verification (Stop)

1.  **Hook Invocation**: `Stop` hook is called.
2.  **State Read**: Check `pre_completion_pending` and `stuck_reminder_fired` flags.
3.  **Evaluation**:
    -   If `stuck_reminder_fired` is true:
        -   Suppress stop reminder (avoid double nagging).
        -   IPC: Clear both flags.
        -   Allow stop.
    -   If `pre_completion_pending` is true:
        -   **Action**: Resolve `pre-completion-reminder` template.
        -   **Output**: Return `decision: "block"`, `reason: <reminder_text>`.
        -   IPC: Clear `pre_completion_pending` flag (so next stop succeeds).
    -   Else:
        -   Allow stop.

## 5. Configuration

Configuration is managed via the standard `config` feature, cascading from defaults to user overrides.

| Key | Default | Description |
| :--- | :--- | :--- |
| `reminders.enabled` | `true` | Master switch for the feature. |
| `reminders.turn_cadence` | `4` | Number of user turns between prompts. |
| `reminders.tool_cadence` | `50` | Number of tool uses between prompts. |
| `reminders.stuck_threshold` | `20` | Max tool uses per turn before "stuck" warning. |
| `reminders.templates.user_prompt` | `user-prompt-submit-reminder.txt` | Template file for turn cadence. |
| `reminders.templates.tool_cadence` | `post-tool-use-cadence-reminder.txt` | Template file for tool cadence. |
| `reminders.templates.stuck` | `post-tool-use-stuck-reminder.txt` | Template file for stuck warning. |
| `reminders.templates.pre_completion` | `pre-completion-reminder.txt` | Template file for completion check. |

## 6. Integration Points

-   **Supervisor**: Acts as the single writer for `reminders.json` state file. Handles IPC messages:
    -   `reminders:decrement_turn_count`
    -   `reminders:reset_turn_count`
    -   `reminders:decrement_tool_count`
    -   `reminders:reset_tool_count`
    -   `reminders:increment_tools_this_turn`
    -   `reminders:reset_tools_this_turn`
    -   `reminders:set_pre_completion_pending`
    -   `reminders:clear_flags`
-   **Asset Resolver**: Used to find template files in the cascade (`assets/sidekick/reminders/` -> `~/.sidekick/reminders/` -> etc.).

## 7. Migration from Legacy

-   **State**: Legacy state files (individual counter files) will be ignored. A fresh start is acceptable for reminders.
-   **Templates**: Legacy templates in `~/.claude/hooks/sidekick/reminders/` should be detected and respected if possible, or users should be guided to move them to `~/.sidekick/reminders/`.
-   **Config**: Legacy `.conf` variables (`USER_PROMPT_CADENCE`, etc.) will be migrated to JSON config by the migration utility.

## 8. Outstanding Questions / Concerns Resolved

-   **Storage & Persistence**: Solved via Supervisor-managed `reminders.json` and IPC for updates.
-   **Scheduler Ownership**: Opportunistic evaluation during hooks (UserPromptSubmit, PostToolUse, Stop) is sufficient and matches legacy behavior.
-   **Templating**: Uses text files loaded via `AssetResolver`, preserving the simple and effective legacy approach.
-   **Plugin API**: `ReminderService` can expose methods for other features to register dynamic triggers in the future, but for now, the scope is limited to parity.
