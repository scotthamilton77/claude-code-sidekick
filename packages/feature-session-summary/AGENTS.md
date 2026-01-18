# AGENTS.md — @sidekick/feature-session-summary

## Role

LLM-based conversation analysis with persona selection and message generation.

## Architecture

```
SessionStart → PersonaSelection → LLM picks persona based on transcript
                     ↓
TranscriptEvent → UpdateSummary → LLM analyzes conversation
                     ↓
                SnarkyMessage / ResumeMessage → Template interpolation with persona
```

## Key Components

| File | Purpose |
|------|---------|
| `handlers/persona-selection.ts` | Selects persona on SessionStart via LLM |
| `handlers/update-summary.ts` | Analyzes transcript, generates snarky/resume messages |
| `handlers/create-first-summary.ts` | Initial summary on session start |
| `handlers/on-demand-generation.ts` | CLI command for persona testing |
| `state.ts` | Typed accessors for session-summary and session-persona state |
| `events.ts` | Structured logging event factories |

## Persona System

**Selection**: On SessionStart, LLM analyzes conversation opener to pick a fitting persona from `assets/sidekick/personas/`.

**Template Interpolation**: Prompts in `assets/sidekick/prompts/` support Handlebars-style templating:
- `{{persona.name}}`, `{{persona.personality}}`, `{{persona.restrictions}}`
- Nested conditionals: `{{#if persona}}...{{/if}}`

**State Files**:
- `session-persona.json` — selected persona ID + traits
- `session-summary.json` — title, intent, snarky message, resume message

## Constraints

- **LLM calls via @sidekick/shared-providers** — never raw SDK
- **State writes go through StateService** — daemon writes, CLI reads
- **Persona YAML schema validated** — see `@sidekick/types` PersonaProfile

## Reference

- `docs/design/FEATURE-SESSION-SUMMARY.md` for analysis flow
- `docs/design/PERSONA-PROFILES-DESIGN.md` for persona system design
- `assets/sidekick/personas/` for persona definitions
