# Persona Profiles for Snarky + Resume Outputs

## Summary

Introduce configurable persona profiles that shape the "snarky" session summary replacement and the resume message, while keeping deterministic analysis untouched. Personas are selected once per session at `SessionStart`, persisted in session state, and used to drive both LLM prompt tone and the statusline empty-message pool. The current behavior becomes the default `sidekick` persona.

## Goals

- Provide named persona profiles (theme + personality traits + tone traits) that can be added or overridden per project/user.
- Select a persona per session (true random) with an optional allow-list configured in `session-summary` feature settings.
- Apply personas only to creative outputs (snarky message + resume message) and never to deterministic analysis (temperature 0 outputs).
- Allow personas to define their own statusline empty messages, with a safe fallback to the `sidekick` persona list.

## Non-Goals

- Changing the summary/intent analysis flow or confidence logic.
- Altering the statusline layout or summary precedence rules.
- Backward compatibility with any existing persona system (none exists).

## Requirements

### Functional

- Persona definitions live in `assets/sidekick/personas/*.yaml` (defaults).
- Overrides load from `~/.sidekick/personas/` and `.sidekick/personas/` (project overrides).
- Persona selection occurs on `SessionStart` (per `docs/design/FEATURE-SESSION-SUMMARY.md §3.1`) and is persisted in session state.
- When the allow-list is empty or unset, selection is made from all available personas; when set, selection is constrained to those names.
- Persona data is injected into the snarky and resume prompts only (see `docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4` and `docs/design/FEATURE-RESUME.md §3.2`).
- Provide a built-in `sidekick` persona that preserves the current snarky/resume behavior and owns the existing empty-message list.
- Provide a built-in `disabled` persona that bypasses snarky generation and forces session summary and resume messaging to be (leveraging the non-snarky session summary analysis).
- Statusline empty-message selection uses the session's persona message set when available; otherwise, fall back to the `sidekick` persona list.
- When personas are disabled or no persona is selected, statusline uses `SESSION_SUMMARY_PLACEHOLDERS` instead of persona empty-message pools.

### Non-Functional

- Must respect the existing config cascade (`docs/ARCHITECTURE.md §3.6`).
- Persona asset discovery should follow a deterministic override cascade similar to asset resolution (`docs/design/CONFIG-SYSTEM.md §7`), but using the dedicated `personas/` roots noted above.
- All new configuration must be validated and logged clearly on errors.

## Current Touchpoints

- Snarky message generation: `packages/feature-session-summary/src/handlers/update-summary.ts`.
- Resume message generation: `packages/feature-session-summary/src/handlers/update-summary.ts`.
- Session start handler: `packages/feature-session-summary/src/handlers/create-first-summary.ts`.
- Statusline empty-message selection: `packages/feature-statusline/src/statusline-service.ts`.
- Defaults: `assets/sidekick/defaults/features/session-summary.defaults.yaml` and `assets/sidekick/personas/*.yaml`.

## Proposed Design

### Persona Asset Format

**File**: `assets/sidekick/personas/<name>.yaml`

```yaml
id: skippy
display_name: Skippy
theme: "Sci-fi snark with dry wit"
personality_traits:
  - sarcastic
  - impatient
  - clever
tone_traits:
  - snarky
  - playful
  - concise

# Optional: persona-specific empty-session messages (inline)
statusline_empty_messages:
  - "Let's get this over with."
```

**Notes**
- `id` must match the filename stem and is used for selection.
- `statusline_empty_messages` is optional; when present and non-empty, it is used directly.
- If missing or empty, fall back to the hard-coded defaults.
- The `sidekick` persona captures the current snarky/resume behavior and owns the existing empty-message list.
- The `disabled` persona is a special-case profile defined in defaults (see below).

### Persona Asset Cascade

Resolve persona definitions from highest to lowest priority:

1. `.sidekick/personas/`
2. `~/.sidekick/personas/`
3. `assets/sidekick/personas/`

When the same persona ID exists in multiple layers, the highest priority wins. This aligns with config override expectations while keeping personas separate from the normal `assets/` cascade (`docs/design/CONFIG-SYSTEM.md §7`).

### Configuration Settings

Add to `assets/sidekick/defaults/features/session-summary.defaults.yaml`:

```yaml
settings:
  personas:
    # Comma-separated allow-list (empty means all available personas)
    allowList: ""
```

**Parsing rule**:
- `allowList` is split on commas, trimmed, and filtered for non-empty tokens.
- If the resulting list is empty, consider it "unset" and allow all discovered personas.

### Session Persona State

Persist selected persona in session state:

**File**: `.sidekick/sessions/{session_id}/state/session-persona.json`

```json
{
  "persona_id": "skippy",
  "selected_from": ["skippy", "bones", "scotty"],
  "timestamp": "ISO-8601"
}
```

This state is created on `SessionStart` for `startup` and `clear` (same gating as `CreateFirstSessionSummary`, per `docs/design/FEATURE-SESSION-SUMMARY.md §3.1`).

### Selection Algorithm

1. Load persona definitions from cascade.
2. Parse `allowList`.
3. Determine selection pool:
   - If allow-list is empty: all personas.
   - If allow-list contains unknown names: log a warning and ignore unknown entries.
4. Pick a random persona from the pool (true randomness).
5. Persist selection to `session-persona.json`.

If the pool is empty (no personas found), disable persona injection and log a warning.

### Default Personas

- **sidekick**: The current behavior, including existing snarky prompt tone and resume snark. Owns the migrated empty-message list from `assets/sidekick/defaults/features/statusline-empty-messages.txt`.
- **disabled**: No snarky generation; resume output is deterministic and statusline uses placeholders.

### Disabled Persona Behavior

Define a default persona with `id: disabled` and enforce behavior overrides:

- **Snarky generation**: Skip entirely when `persona_id === "disabled"`.
- **Resume generation**: Bypass the LLM call and set:
  - `resume_message` to the session title (if exists, otherwise don't generate resume message).
  - `snarky_welcome` to the latest intent (if exists, otherwise don't generate resume message).

This makes the resume output deterministic and avoids creative text when a user chooses to disable persona effects.

### Prompt Injection

Add a persona block to snarky + resume prompts only:

**Snarky prompt** (`assets/sidekick/prompts/snarky-message.prompt.txt`):

```
<persona>
Name: {{persona_name}}
Theme: {{persona_theme}}
Personality: {{persona_personality}}
Tone: {{persona_tone}}
</persona>
```

**Resume prompt** (`assets/sidekick/prompts/resume-message.prompt.txt`):

```
<persona>
Name: {{persona_name}}
Theme: {{persona_theme}}
Personality: {{persona_personality}}
Tone: {{persona_tone}}
</persona>
```

**Rules**:
- Do not add persona context to the session summary analysis prompt.
- If no persona is selected, omit the block entirely (no placeholders remain).
- If `persona_id === "disabled"`, do not call the snarky LLM and do not inject persona blocks (resume is handled via deterministic copy).

### Statusline Empty Messages

On statusline service construction:

1. Read `session-persona.json` from the current session state.
2. Prefer `statusline_empty_messages` when present and non-empty.
3. If missing or empty, fall back to the `sidekick` persona message list.
4. If personas are disabled or no persona is selected, use `SESSION_SUMMARY_PLACEHOLDERS` values instead of any empty-message pool.

This keeps the statusline output logic unchanged while swapping the empty-message pool.

## Data Model Updates

Add schema/type for session persona state:

- `packages/types/src/services/state.ts`:
  - `SessionPersonaStateSchema`
  - `SessionPersonaState` type

Add persona definitions:

- `packages/types/src/services/persona.ts` (new):
  - `PersonaDefinitionSchema`
  - `PersonaDefinition` type

## Error Handling

- Missing persona file or parse errors: log warning and fall back to default empty messages and/or skip persona injection.
- Unknown persona names in allow-list: log warning and continue with the rest.
- Empty persona pool: proceed without persona injection and keep existing behavior.

## Files to Touch (Implementation Guidance)

- `assets/sidekick/defaults/features/session-summary.defaults.yaml` (add persona allow-list setting).
- `assets/sidekick/personas/*.yaml` (add default personas).
- `packages/feature-session-summary/src/handlers/create-first-summary.ts` (select and persist persona).
- `packages/feature-session-summary/src/handlers/update-summary.ts` (inject persona into snarky/resume prompts).
- `packages/feature-statusline/src/statusline-service.ts` + `packages/feature-statusline/src/state-reader.ts` (load persona state and persona messages).
- `packages/types/src/services/state.ts` (new session persona state).
- `packages/types/src/services/persona.ts` (persona definition schema).
- `packages/sidekick-core/src/assets.ts` or new resolver module (persona-specific cascade).

## Acceptance Tests

1. **SessionStart persona selection**  
   Given multiple personas and no allow-list, `session-persona.json` is created with one valid persona ID.

2. **Allow-list parsing**  
   Given `allowList: "skippy, bones, scotty"`, the selection pool is exactly `["skippy", "bones", "scotty"]`.

3. **Unknown allow-list entries**  
   Given `allowList: "skippy,unknown"`, selection ignores `unknown` and logs a warning.

4. **Empty allow-list**  
   Given `allowList: ""` or missing, all discovered personas are eligible.

5. **Persona persistence**  
   The same persona ID is used for snarky + resume generations within the same session.

6. **Prompt injection scope**  
   Persona block appears in snarky/resume prompts and does not appear in session-summary prompt.

7. **Statusline empty-message override**  
   When persona defines `statusline_empty_messages`, the statusline selects from that list; otherwise it uses the global default list.

8. **Missing persona assets**  
   When a selected persona has no statusline empty-message list, statusline falls back to default messages and does not error.

9. **No personas available**  
   With zero persona definitions, selection is skipped; snarky/resume prompts run without persona block; statusline uses `SESSION_SUMMARY_PLACEHOLDERS`.

10. **Dual-scope parity**  
    Persona overrides in `~/.sidekick/personas/` affect user-scope sessions and `.sidekick/personas/` affect project-scope sessions consistently (`docs/ARCHITECTURE.md §3.6`).

11. **Disabled persona behavior**  
    With `persona_id: "disabled"`, snarky message is not generated, resume message is derived deterministically from the most recent session summary, and statusline uses `SESSION_SUMMARY_PLACEHOLDERS` instead of persona empty messages.
