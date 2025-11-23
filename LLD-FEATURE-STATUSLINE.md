# Feature: Statusline

## Scope

Composes a string containing the real-time system state to the user. String is formatted using a configurable template and may include the current model name, current working folder, current branch, and a composition from the session summary analysis.

## Responsibilities

1.  Read state from `state/*.json` (Shared State).
2.  Format output (Text/JSON).
3.  Execute in <50ms.

## Outstanding Questions / Concerns

- **Template Engine**: Need to pick/rendering approach (e.g., Handlebars-lite vs string interpolation) and document custom helper support for session summary/reminders.
- **Stale State Handling**: Define behavior when state files lag behind supervisor updates (e.g., fallback values, warning indicators).
- **Hook Contract**: Capture exact output schema per hook invocation so CLI knows when to emit JSON vs plaintext.
- **Refresh Cadence**: Decide whether statusline polls supervisor/state files on an interval or only recomputes when triggered by CLI hook calls.
