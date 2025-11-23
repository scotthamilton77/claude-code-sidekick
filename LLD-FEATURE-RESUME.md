# Feature: Resume Generation

## Scope

Placeholder for the resume feature low-level design. This feature produces resumable context ("what were we doing?") leveraging supervisor-managed transcripts and LLM providers.

## To Be Defined

- Responsibilities and data flow between CLI hook, supervisor task queue, and shared state files.
- Schema for persisted resume artifacts and how they interact with `schema-contracts`.
- Performance targets, caching strategy, and relationship with session summary.
