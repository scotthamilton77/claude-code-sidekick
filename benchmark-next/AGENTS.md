# AGENTS.md — benchmark-next

**⚠️ STATUS: STALE / SUPERSEDED ⚠️**

Early TypeScript exploration—largely untested, out of sync with current tools.

## Don't Use This

**Use instead**:
- `scripts/analyze-session-at-line.sh` — surgical session summary extraction
- `scripts/simulate-session.py` — session analysis simulator

**Future direction**: `packages/` workspace per `docs/ARCHITECTURE.md`

## Salvageable Patterns

Reference these when building `packages/` equivalents:
- `src/lib/providers/` — LLM provider abstraction (OpenAI, Claude, OpenRouter)
- `src/lib/config/` — config cascade pattern
- `src/lib/transcript/` — transcript processing types

## Post-Training SDK Notes [PRESERVE]

Use context7 for current docs on these post-cutoff dependencies:

**@anthropic-ai/sdk 0.68.0**:
- Timeout in milliseconds (not seconds)
- `message.content` always array
- `maxRetries: 0` disables retries
- Streaming abort: `stream.controller.abort()`

**openai 6.8.1** (v5/v6 breaking changes):
- v5: Assistants API removed, `runFunctions()` removed
- v6: Function outputs changed `string` → `string | Array<...>`
- Reasoning models: use `max_completion_tokens` not `max_tokens`
- `parse()` throws `LengthFinishReasonError` on truncation

## Disposition

- **Short term**: Reference patterns only, don't extend
- **Long term**: Archive/delete when `packages/` complete
