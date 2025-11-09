# benchmark-next/CLAUDE.md

**Status**: 🚧 EXPERIMENTAL - TypeScript rewrite in progress

## What This Is (Task Context)

Track 2 TypeScript rewrite of Track 1 Bash benchmarking system (`scripts/benchmark/`). Both systems share `test-data/` for validation.

**Critical Constraint**: **Functional behavioral parity** - identical outputs for identical inputs. Track 1 is production reference; Track 2 must match exactly before replacing it.

## Why TypeScript (Strategic Context)

Bash (Track 1) enables rapid scoring algorithm iteration but sacrifices:
- Maintainability (subshell complexity, implicit types)
- Testability (mocking LLM providers requires complex trap/redirect patterns)
- Error handling (exit codes vs structured exceptions)

TypeScript provides type safety and async patterns without sacrificing iteration speed once infrastructure is built.

## Architecture (Mandatory Context)

```
src/
├── core/
│   ├── Benchmark.ts          # Main orchestrator
│   ├── ReferenceGenerator.ts # Phase 2 consensus generation
│   └── Config.ts             # Cascade: defaults → user → project → local
├── providers/
│   ├── LLMProvider.ts        # Abstract interface (matches Sidekick lib/llm.sh)
│   ├── ClaudeProvider.ts     # Anthropic SDK
│   ├── OpenAIProvider.ts     # OpenAI SDK
│   ├── OpenRouterProvider.ts # OpenRouter API
│   └── CircuitBreaker.ts     # Resilience (matches Sidekick circuit-breaker.sh)
├── scoring/
│   ├── SchemaValidator.ts    # JSON compliance
│   ├── SemanticSimilarity.ts # LLM-as-judge
│   ├── TechnicalAccuracy.ts  # Correctness checks
│   └── ContentQuality.ts     # Quality assessment
└── consensus/
    ├── NumericConsensus.ts   # Median/mean (Phase 2)
    ├── StringConsensus.ts    # Semantic centrality
    ├── BooleanConsensus.ts   # Majority vote
    └── ArrayConsensus.ts     # Union/intersection
```

## How to Migrate Features from Track 1 (Procedures)

**DO NOT translate Bash → TypeScript line-by-line**. Extract requirements, implement idiomatically:

1. **Understand**: Read Track 1 code + tests → identify behavior + edge cases
2. **Design**: Classes/interfaces/async patterns (not subshells/pipes/process substitution)
3. **TDD**: Write tests first (test-driven-design), then implement to get tests passing
4. **Validate**: `diff <(track1-output) <(track2-output)` on shared test-data/
5. **Document**: Update `docs/benchmark-migration.md` with deviations + rationale

**Example Pattern Translation**:
| Track 1 (Bash) | Track 2 (TypeScript) | Same Behavior |
|----------------|----------------------|---------------|
| `timeout` + retry loop | `AbortController` + retry decorator | 3 attempts, exponential backoff, identical errors |
| `jq -r '.field'` pipe | Zod schema + direct access | Runtime validation + type safety |
| Process substitution | Async generators | Streaming JSON processing |

## Migration Validation Checklist

**Before marking any feature complete**:
- [ ] Output diff vs Track 1 is empty (or documented in migration log)
- [ ] Edge cases from Track 1 tests reproduced
- [ ] Performance within 20% of Track 1 (measure with `hyperfine`)
- [ ] No `any` types (run `tsc --strict --noImplicitAny`)

**Production-Ready Criteria** (entire system):
- [ ] All `docs/benchmark-migration.md` requirements implemented
- [ ] Full golden-set run matches Track 1 output exactly
- [ ] Migration guide written for Track 1 users

## Dependencies (Track 2 Specific)

**Production**: `@anthropic-ai/sdk`, `openai`, `zod`, `winston`|`pino`, `commander`
**Development**: `typescript`, `tsx`, `vitest`, `@types/node`

**Rationale**: Zod provides runtime validation matching Bash's `jq` schema checks. Winston/Pino replicates Sidekick's structured logging.
