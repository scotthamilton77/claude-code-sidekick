# Transcript Processing

## Scope

Utility functions for transcript processing. Knows how to interpret trascript events (Claude only to start), and de-noise the transcript and the individual events.

## Outstanding Questions / Concerns

- **Schema Alignment**: Need to document the exact event schema(s) and how they map onto `schema-contracts` outputs so Python tools and Node runtime stay in sync.
- **Provider Extensibility**: Plan for OpenAI/OpenRouter transcript formats even if Claude is first—define interface boundaries.
- **Denoising Rules**: Enumerate concrete heuristics (e.g., drop typing indicators, merge duplicate user prompts) and how they are tested.
- **Batch vs Stream**: Clarify whether processors run incrementally (event deltas) or rebuild clean transcripts each time; impacts supervisor workload.
