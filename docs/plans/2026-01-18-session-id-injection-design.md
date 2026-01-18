# Session ID Injection Design

## Problem

Claude doesn't know its current sessionId, which is needed for CLI commands like `sidekick persona --session-id=<id>`.

## Solution

Inject sessionId into the UserPromptSubmit reminder template during staging. Uses existing infrastructure with minimal changes.

## Changes

### 1. Staging Handler (`packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts`)

Pass `sessionId` in templateContext for both entry points:

```typescript
// Handler 1: SessionStart
return {
  reminderId: ReminderIds.USER_PROMPT_SUBMIT,
  targetHook: 'UserPromptSubmit',
  skipIfExists: false,
  templateContext: { sessionId: event.context.sessionId },
}

// Handler 2: BulkProcessingComplete
return {
  reminderId: ReminderIds.USER_PROMPT_SUBMIT,
  targetHook: 'UserPromptSubmit',
  skipIfExists: true,
  templateContext: { sessionId: event.context?.sessionId ?? 'unknown' },
}
```

### 2. Reminder Template (`assets/sidekick/reminders/user-prompt-submit.yaml`)

Add structured session-info block at the end of additionalContext:

```yaml
additionalContext: |
  As you answer the user's questions, you can use the following context:
  # claudeMd
  ...existing content...

  <session-info>
  sessionId: {{sessionId}}
  </session-info>
```

## Format Rationale

- **Structured block**: `<session-info>` tags make it machine-parseable
- **Extensible**: Can add more fields later (startTime, transcriptPath, persona, etc.)
- **Bottom placement**: Session metadata doesn't clutter behavioral instructions

## Testing

1. Start a new session
2. Verify `<session-info>` block appears in context
3. Confirm sessionId matches the actual session directory name in `.sidekick/sessions/`
