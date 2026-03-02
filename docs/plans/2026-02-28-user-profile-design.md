# User Profile for Persona Personalization

**Bead**: sidekick-q1z
**Date**: 2026-02-28
**Status**: Approved

## Summary

Add an optional user profile (`~/.sidekick/user.yaml`) that gives personas someone to talk to. The profile provides name, role, and interests — injected into snarky/resume LLM prompts and the Claude Code session start reminder.

## Constraints

- **Optional**: No default file. Missing file = no user context injected.
- **User-scope only**: `~/.sidekick/user.yaml` — no project-level override, no cascade.
- **Three fields**: `name` (string), `role` (string), `interests` (string array). All required if file exists.
- **Setup skill**: Updated to collect/confirm these details during `pnpm sidekick setup`.

## File Schema

```yaml
# ~/.sidekick/user.yaml
name: "Scott"
role: "Software Architect"
interests:
  - "Sci-Fi (Trek, Wars, Gate, BSG)"
  - "80s/90s sitcoms"
```

## Injection Points

### 1. Snarky & Resume Prompt Templates

Add an optional block to both `snarky-message.prompt.txt` and `resume-message.prompt.txt`:

```
{{#if user_name}}
You are speaking to {{user_name}}{{#if user_role}}, a {{user_role}}{{/if}}.
{{#if user_interests}}Their interests include: {{user_interests}}.{{/if}}
Use this to personalize your comment when it fits naturally.
{{/if}}
```

Template context includes `user_name`, `user_role`, `user_interests` (comma-joined string). Empty strings when no profile exists.

### 2. Session Start Reminder

New `assets/sidekick/reminders/user-profile.yaml`:

```yaml
id: user-profile
blocking: false
priority: 4
persistent: true

additionalContext: |
  This session is with {{user_name}}{{#if user_role}} ({{user_role}}){{/if}}.
  {{#if user_interests}}Interests: {{user_interests}}.{{/if}}
```

Staged by `stage-user-profile-reminders.ts` on `SessionStart` and `UserPromptSubmit`, same pattern as `stage-persona-reminders.ts`.

### 3. On-Demand Generation (`persona test`)

User profile context spread into template interpolation alongside persona context.

## Setup Skill Integration

During `pnpm sidekick setup`, after existing config steps:

- **No file exists**: Ask for name, role, interests. Write `~/.sidekick/user.yaml`.
- **File exists**: Show current values. Confirm or walk through updates.

New `user-profile-setup.ts` module called from main setup flow.

## New Files

| File | Purpose |
|------|---------|
| `packages/types/src/services/user-profile.ts` | `UserProfile` interface + Zod schema |
| `packages/sidekick-core/src/user-profile-loader.ts` | `loadUserProfile()` — read & validate |
| `packages/feature-reminders/src/handlers/staging/stage-user-profile-reminders.ts` | Stage reminder on SessionStart |
| `assets/sidekick/reminders/user-profile.yaml` | Reminder template |
| `packages/sidekick-cli/src/commands/setup/user-profile-setup.ts` | Setup flow module |

## Modified Files

| File | Change |
|------|--------|
| `packages/types/src/services/index.ts` | Export `UserProfile` |
| `packages/sidekick-core/src/index.ts` | Export `loadUserProfile` |
| `packages/feature-session-summary/src/handlers/persona-utils.ts` | Add `buildUserProfileContext()` |
| `packages/feature-session-summary/src/handlers/update-summary.ts` | Spread user profile context into snarky + resume |
| `packages/feature-session-summary/src/handlers/on-demand-generation.ts` | Same for on-demand |
| `assets/sidekick/prompts/snarky-message.prompt.txt` | Add `{{#if user_name}}` block |
| `assets/sidekick/prompts/resume-message.prompt.txt` | Same |
| `packages/feature-reminders/src/handlers/staging/index.ts` | Register user profile handler |
| `packages/sidekick-cli/src/commands/setup/index.ts` | Call user profile setup step |
| `packages/sidekick-plugin/skills/sidekick-setup/SKILL.md` | Mention user profile |

## Testing

- `loadUserProfile()`: file exists, missing, malformed YAML, missing fields
- `buildUserProfileContext()`: profile present, null
- Staging handler: profile present, missing
- Existing snarky/resume tests: cover user profile in template context
