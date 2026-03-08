# User-Prompt-Submit Reminder Throttle

## Problem

The `user-prompt-submit` reminder fires on every user prompt submission regardless of recency, adding noise when messages are frequent. In a rapid back-and-forth conversation, the same reminder content appears in every system-reminder injection.

## Solution

Throttle the reminder based on transcript message count. The daemon tracks conversation messages (user + assistant turns) since the last injection. The reminder is only re-staged when the count meets or exceeds a configurable threshold (default: 10).

## Design

### Architecture

The daemon owns the staging decision. The CLI consumption handler is unchanged -- it simply consumes whatever is staged.

- Change `user-prompt-submit.yaml` from `persistent: true` to `persistent: false`
- The daemon re-stages the reminder conditionally based on message count

### State: `ups-throttle.json`

```typescript
interface UPSThrottleState {
  messagesSinceLastStaging: number
}
```

Stored per-session at `.sidekick/sessions/{sessionId}/state/ups-throttle.json`.

### Handlers

Three staging handlers in `stage-default-user-prompt.ts`:

| Handler | Trigger | Action |
|---------|---------|--------|
| SessionStart (existing) | `SessionStart` hook | Stage reminder, reset counter to 0 |
| BulkProcessingComplete (existing) | `BulkProcessingComplete` transcript | Stage if not exists, reset counter to 0 |
| Throttle re-stage (new) | User/assistant transcript messages | Increment counter; if >= threshold, re-stage + reset |

The new handler:
1. Skips bulk replay (built-in `createStagingHandler` guard)
2. Filters to conversation message types only (user + assistant)
3. Increments `messagesSinceLastStaging`
4. When count >= `user_prompt_submit_threshold`: re-stages and resets counter to 0

### Configuration

In `reminders.defaults.yaml`:

```yaml
settings:
  user_prompt_submit_threshold: 10
```

Configurable via the existing config cascade (user-scope, project-scope, local override).

### Message Flow

```
Session start -> stage reminder, counter=0
Prompt 1 -> CLI consumes (renames file)
  Messages 1-9 -> daemon increments counter (1..9)
  Message 10 -> daemon: count=10 >= threshold, re-stage, reset to 0
Prompt 2 -> CLI consumes
  Messages 1-9 -> daemon increments counter
  Message 10 -> daemon re-stages
...
```

### Type Changes

- `RemindersSettings`: add `user_prompt_submit_threshold?: number`
- `DEFAULT_REMINDERS_SETTINGS`: add `user_prompt_submit_threshold: 10`
- New Zod schema `UPSThrottleStateSchema` in `@sidekick/types`
- New state accessor `upsThrottle` in `state.ts`

### Edge Cases

- **First prompt**: Always gets the reminder (staged on SessionStart)
- **Bulk replay (daemon restart)**: Counter resets to 0, reminder re-staged via BulkProcessingComplete handler
- **Context clear**: Fires SessionStart with `startType: 'clear'`, which re-stages and resets
- **Session resume**: Fires SessionStart with `startType: 'resume'`, same behavior

## Acceptance Criteria

- Build passes. Typecheck passes. Tests pass.
- Reminder is suppressed when message count since last staging is below threshold
- Reminder fires normally when threshold is met or exceeded
- First prompt of a session always receives the reminder
- Bulk replay resets counter and re-stages
- Threshold is configurable via the config cascade
