# AGENTS.md — llm-eval (formerly benchmark-next)

**STATUS: Development Tool - Use When Evaluating LLM Models**

LLM evaluation framework for benchmarking providers against reference outputs. Run infrequently when evaluating new models or major upgrades.

## Location

Relocated from `benchmark-next/` to `development-tools/llm-eval/` as part of phase 10.1 cleanup.

**Structure:**
- `src/` — TypeScript benchmark code
- `bash-scripts/` — Bash benchmark suite (from scripts/benchmark/)
- `reporting/` — Report generation (from scripts/reporting/)
- `../test-data/` — Sample transcripts (sibling directory)

## When to Use

- Evaluating new LLM models for cost/latency/quality tradeoffs
- Major model upgrades requiring re-evaluation
- Generating reference outputs from premium models

## Future Direction

When next exercised, refactor to use `@sidekick/*` packages:
- Replace `src/lib/providers/` with `@sidekick/shared-providers`
- Replace `src/lib/transcript/` with `@sidekick/sidekick-core` TranscriptService
- Replace `src/lib/config/` with `@sidekick/sidekick-core` config
- Keep benchmark-specific code: scoring, consensus, runner

## Salvageable Patterns

Reference these when building `packages/` equivalents:
- `src/lib/providers/CircuitBreakerProvider.ts` — Cockatiel-based circuit breaker with exponential backoff
- `src/lib/utils/json-extraction.ts` — Clean JSON extraction utility

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
