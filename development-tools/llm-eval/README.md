# llm-eval

**STATUS: Archived Development Tool**

LLM evaluation framework for benchmarking providers against reference outputs. Originally developed as `benchmark-next/`, a TypeScript rewrite of the Bash-based benchmarking system.

## Current State

This implementation is **91% complete** but was never validated against the original Bash implementation. The core functionality (providers, scoring, consensus, orchestration, CLI) is implemented, but Phase 9 (validation and E2E testing) was not completed.

**What exists:**
- LLM provider abstractions (Claude, OpenAI, OpenRouter)
- Circuit breaker with exponential backoff (Cockatiel-based)
- Transcript preprocessing and excerpt extraction
- Three-dimensional scoring (schema, technical, content)
- Consensus algorithms (string, numeric, boolean, array)
- Reference generation and benchmark runner
- CLI commands

**What's missing:**
- Output comparison tests (Track 1 vs Track 2)
- Performance benchmarking
- E2E tests with real LLM calls
- Migration guide documentation

## Before Resuming Work

This codebase duplicates functionality that now exists in the main `packages/` monorepo:

| llm-eval location | Main package equivalent |
|-------------------|------------------------|
| `src/lib/providers/` | `@sidekick/shared-providers` |
| `src/lib/transcript/` | `@sidekick/sidekick-core` TranscriptService |
| `src/lib/config/` | `@sidekick/sidekick-core` config |
| `src/lib/logging/` | `@sidekick/sidekick-core` logging |

**If this tool is needed again**, significant refactoring is required to:
1. Remove duplicated provider/config/logging code
2. Depend on `@sidekick/*` packages instead
3. Keep only benchmark-specific code (scoring, consensus, runner)

## Directory Structure

```
src/
├── lib/                 # Shared infrastructure (duplicates main packages)
│   ├── providers/       # LLM provider abstractions
│   ├── config/          # Configuration cascade
│   ├── logging/         # Structured logging (pino)
│   ├── transcript/      # Transcript processing
│   └── utils/           # JSON extraction, helpers
└── benchmark/           # Benchmark-specific domain logic
    ├── core/            # Orchestration (BenchmarkRunner, ReferenceGenerator)
    ├── scoring/         # Scoring algorithms
    ├── consensus/       # Consensus algorithms
    └── cli/             # CLI entry points

bash-scripts/            # Original Bash benchmark suite (from scripts/benchmark/)
reporting/               # Report generation tools
```

## Usage (if running as-is)

```bash
cd development-tools/llm-eval
pnpm install
pnpm build

# Benchmark a model against reference outputs
pnpm benchmark --provider openrouter --model google/gemini-flash-1.5

# Generate reference outputs (premium models)
pnpm generate-reference --transcript-id short-001
```

## History

- Originally created as `benchmark-next/` for TypeScript migration of Bash benchmarking
- Relocated to `development-tools/llm-eval/` during Phase 10 cleanup
- Development paused at 91% completion when main `packages/` architecture stabilized
- See `development-tools/docs/.archive/llm-eval-ROADMAP.md` for detailed phase history
