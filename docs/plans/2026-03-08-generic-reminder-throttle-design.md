# Generic Reminder Throttle

## Problem

The UPS throttle (merged in PR #31) is a one-off mechanism that throttles `user-prompt-submit` reminder injection based on transcript message count. The `remember-your-persona` reminder currently fires on every prompt (`persistent: true`), adding noise. Duplicating the throttle pattern per-reminder creates code bloat.

## Solution

Generalize the throttle into a data-driven mechanism. Reminders opt in via a YAML flag (`throttle: true`). Thresholds are configured per-reminder in the config cascade. One generic handler manages all throttled reminders.

## Design

### YAML: Throttle opt-in

Reminders opt in by setting `throttle: true` and `persistent: false`:

```yaml
# user-prompt-submit.yaml
persistent: false
throttle: true

# remember-your-persona.yaml
persistent: false
throttle: true
```

The `throttle` field is added to `ReminderDefinition`. Reminders without it (or `throttle: false`) behave as today.

### Config: Per-reminder thresholds

Replace `user_prompt_submit_threshold` with a map in `RemindersSettings`:

```typescript
interface RemindersSettings {
  // ... existing fields ...
  reminder_thresholds?: Record<string, number>
  // user_prompt_submit_threshold removed
}
```

Defaults in `reminders.defaults.yaml`:

```yaml
settings:
  reminder_thresholds:
    user-prompt-submit: 10
    remember-your-persona: 5
```

Default in code (`DEFAULT_REMINDERS_SETTINGS`):

```typescript
reminder_thresholds: {
  'user-prompt-submit': 10,
  'remember-your-persona': 5,
}
```

### State: Shared file, independent counters

Replace `ups-throttle.json` with `reminder-throttle.json`:

```typescript
export const ReminderThrottleStateSchema = z.record(
  z.string(),
  z.object({ messagesSinceLastStaging: z.number() })
)
export type ReminderThrottleState = z.infer<typeof ReminderThrottleStateSchema>
```

Each throttle-enabled reminder gets its own counter entry. Counters increment independently and reset independently when their threshold is met.

State accessor replaces `upsThrottle` with `reminderThrottle`.

### Handler: One generic handler

Replaces the three UPS-specific handlers (1b, 2b, 3) with generic equivalents:

| Handler | Trigger | Action |
|---------|---------|--------|
| `reminders:throttle-reset-session-start` | SessionStart | Reset all throttle counters to 0 |
| `reminders:throttle-reset-bulk` | BulkProcessingComplete | Reset all throttle counters to 0 |
| `reminders:throttle-restage` | UserPrompt, AssistantMessage | Increment all counters; for each that meets threshold, re-stage + reset |

The restage handler discovers throttle-eligible reminders by reading YAML definitions and checking `throttle: true`. It looks up each reminder's threshold from the config cascade (`reminder_thresholds[reminderId]`). If no threshold is configured, the reminder is skipped (no default fallback — must be explicit).

### Template context for re-staging

Each throttled reminder may need different template context when re-staged. The handler needs to resolve the correct context per reminder:

- `user-prompt-submit`: needs `{ sessionId }`
- `remember-your-persona`: needs persona template vars (name, theme, tone)

The handler reads the reminder's YAML and resolves it through the existing `resolveReminder()` pipeline. For persona-specific context, the handler reads the session's active persona state to build the template context.

### Persona integration

`stage-persona-reminders.ts` changes:
- `remember-your-persona.yaml` changes from `persistent: true` to `persistent: false`
- SessionStart staging logic remains (first prompt always gets the persona reminder)
- The generic throttle handler handles re-staging after consumption
- Mid-session persona changes still work: `restagePersonaRemindersForActiveSessions()` re-stages immediately

### Edge Cases

- **First prompt**: Always gets all reminders (staged on SessionStart)
- **Bulk replay**: All counters reset to 0, reminders re-staged via BulkProcessingComplete
- **Context clear / resume**: SessionStart fires, resets all counters
- **Persona change mid-session**: `persona-changed` one-shot fires immediately; `remember-your-persona` is re-staged by the persona handler, counter resets
- **No threshold configured**: Reminder with `throttle: true` but no entry in `reminder_thresholds` is not re-staged (logged as warning)
- **New throttled reminder added**: Just add `throttle: true` to YAML and a threshold to config — no code changes needed

## Acceptance Criteria

- Build passes. Typecheck passes. Tests pass.
- UPS throttle behavior unchanged (threshold=10 by default)
- Persona reminder throttled at threshold=5 by default
- First prompt of session always receives all reminders
- Bulk replay resets all counters
- Thresholds configurable per-reminder via config cascade
- Adding a new throttled reminder requires only YAML + config changes, no code
