# Feature: Reminders

## Scope

Manages static reminders and dynamic (generated) reminders. Reminders are registered into this as a pluggable architecture, and are defined as type (static or dynamic), which hook they are designed to present on, and when they are due.

## Responsibilities

1.  Define the contracts for reminders.
2.  Register reminders.
3.  Return the appropriate reminder(s) based on the context.

## Outstanding Questions / Concerns

- **Storage & Persistence**: Need clarity on where dynamic reminders live (state files vs supervisor memory) and retention policy between sessions.
- **Scheduler Ownership**: Determine whether reminders trigger via supervisor cron-like tasks or are evaluated opportunistically during hook execution.
- **Templating & Localization**: Define how reminder copy is parameterized (prompt templates in `assets/sidekick`?) and how user overrides hook in.
- **Plugin API**: Document how third-party reminder providers register themselves and declare dependencies on other features (e.g., session summary context).
