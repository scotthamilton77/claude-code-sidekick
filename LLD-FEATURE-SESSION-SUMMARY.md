# Feature: Session Summary

## Scope

Maintains a running summary of the current session to provide context to the user as to what the session is about and what the the most recent interactions have been. Intended to inject snarky, "personality-driven" commentary in order to keep the user engaged.

## Responsibilities

1.  Analyze new prompts/responses in the context of the existing session transcript and prior analysis.
2.  Update summary state.
3.  Provide summary to other tools.

## Outstanding Questions / Concerns

- **State Location**: Need agreement on where the running summary lives (`state/session-summary.json`, supervisor-owned store, etc.) so multiple hooks can read without race conditions.
- **LLM Invocation Path**: Expensive updates should route through the supervisor task queue; document batching strategy and backpressure when prompts arrive rapidly.
- **Personality Tuning**: Specify configuration surface (feature flags, prompt templates in `assets/sidekick`) to control tone/snark per user preferences.
- **Transcript Feed**: Define ingestion API from transcript processor—does the feature receive deltas, entire transcript snapshots, or normalized events?
