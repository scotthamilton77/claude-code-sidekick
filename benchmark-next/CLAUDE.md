# benchmark-next/CLAUDE.md

**Status**: 🚧 EXPERIMENTAL - TypeScript rewrite in progress

This directory contains the Track 2 TypeScript rewrite of the benchmarking system.

## Project Purpose

Rewrite the Bash-based benchmarking system (`scripts/benchmark/`) in TypeScript for:
- Better maintainability (type safety, IDE support, clearer architecture)
- Improved async handling (native async/await vs subshells)
- Easier testing (Jest/Vitest vs Bash unit tests)
- More robust error handling and validation

## Architecture Goals

### Core Principles

1. **Type Safety First**: No `any` types - use Zod for runtime validation, TypeScript for compile-time safety
2. **Functional Behavioral Parity**: Must match Track 1 Bash output exactly (use shared test-data/ for validation)
3. **Idiomatic TypeScript**: Don't translate Bash patterns - use classes, async/await, dependency injection
4. **Pluggable Providers**: Abstract LLM provider interface (OpenAI, Anthropic, OpenRouter, custom)
5. **Simple Logging**: Use Pino directly via `createLogger()` factory - no wrappers, no abstraction

### Current Structure

```
src/
├── lib/                      # Shared foundation (future common package)
│   ├── providers/            # ✅ LLM provider abstraction (Phase 2.1)
│   │   ├── LLMProvider.ts    # Abstract base class
│   │   ├── ClaudeProvider.ts # Anthropic SDK implementation
│   │   ├── OpenAIProvider.ts # OpenAI SDK implementation
│   │   ├── OpenRouterProvider.ts # OpenRouter API implementation
│   │   ├── OpenAICompatibleProvider.ts # Base for OpenAI-compatible APIs
│   │   ├── types.ts          # Type definitions
│   │   └── schemas.ts        # Zod schemas
│   ├── utils/                # 🟡 Generic helpers (JSON extraction done)
│   │   └── json-extraction.ts # Extract JSON from LLM output
│   ├── config/               # ✅ Config cascade (Phase 2.4)
│   ├── logging/              # ✅ Pino logger factory (Phase 2.5)
│   └── paths/                # ⏳ Path utilities (Phase 2.6, planned)
└── benchmark/                # Benchmark-specific domain logic
    ├── core/                 # ⏳ Orchestration (planned)
    ├── scoring/              # ⏳ Scoring algorithms (planned)
    ├── consensus/            # ⏳ Consensus algorithms (planned)
    ├── preprocessing/        # ⏳ Data preprocessing (planned)
    ├── data/                 # ⏳ Data loading (planned)
    └── cli/                  # ⏳ CLI entry points (planned)
```

**Architecture Principle**: Code in `lib/` is designed for future extraction to a monorepo `packages/common/` when sidekick migration begins. See `src/lib/README.md` for extraction criteria.

## Development Workflow

### Adding New Features

1. **Check migration log**: Review `docs/benchmark-migration.md` for pending Track 1 requirements
2. **Write tests first**: Create Vitest tests with expected behavior (from Track 1 or new requirements)
3. **Implement**: Use TypeScript idioms, maintain type safety
4. **Validate against Track 1**: Run both implementations on shared test data, diff outputs
5. **Update migration log**: Mark requirement as complete, document any deviations

### Testing Strategy

**Unit Tests** (Vitest):
- Mock LLM providers (no API costs)
- Test scoring algorithms with known inputs/outputs
- Test consensus algorithms with predefined data sets
- Test config loading and validation

**Integration Tests**:
- Use real test-data/transcripts/
- Compare outputs to Track 1 Bash results
- Validate against test-data/references/

**E2E Tests** (expensive, run manually):
- Real LLM provider calls
- Full benchmark run on golden-set
- Performance benchmarks

### Validation Checklist

Before marking Track 2 as production-ready:
- [ ] All Track 1 functional requirements implemented (see migration log)
- [ ] All shared test-data/ tests pass
- [ ] Output format matches Track 1 exactly (JSON schema, field names, value ranges)
- [ ] Performance comparable or better than Track 1
- [ ] Full type coverage (no `any` types)
- [ ] Comprehensive error handling (timeouts, retries, circuit breaker)
- [ ] Documentation complete (README, API docs, examples)
- [ ] Migration guide written for users of Track 1

## Configuration

**Config Cascade** (match Track 1 Sidekick pattern):
1. Defaults (hardcoded in Config.ts)
2. User global (~/.claude/benchmark-next.conf or similar)
3. Project deployed (.benchmark-next/config.json)
4. Project versioned (.benchmark-next/config.local.json - gitignored)

**Key Settings**:
- LLM provider selection (claude-cli, openai-api, openrouter, custom)
- Model selection per provider
- Timeout/retry configuration
- Circuit breaker thresholds
- Logging level and output format
- Test data paths

## Dependencies

**Production**:
- `@anthropic-ai/sdk` - Claude API
- `openai` - OpenAI/Azure OpenAI
- `zod` - Runtime validation and type safety
- `pino` - Structured logging (use directly, no wrapper)
- `commander` - CLI framework

**Development**:
- `typescript` - Type checking
- `tsx` - TypeScript execution
- `vitest` - Testing framework
- `@types/node` - Node.js types
- `eslint` + `prettier` - Code quality

### Post-Training Dependencies (Released After January 2025)

**⚠️ CRITICAL: Use context7 MCP tools when debugging these libraries**

The following dependencies are newer than Claude's training cutoff (January 2025). When working with their APIs, ALWAYS use context7 to fetch current documentation:

#### @anthropic-ai/sdk 0.68.0 (Released ~October 2025)
**Version in use**: 0.68.0 (intentionally kept current)
**Reason**: Latest API features and bug fixes (models are strings, SDK version-agnostic)

**Critical SDK changes since training cutoff**:
- ✅ **No breaking changes** - backwards compatible with v0.30+ (training cutoff range)
- **Tool helpers**: `betaZodTool()` for Zod-based structured outputs (v0.68)
- **Context management**: API for managing conversation context (v0.65+)
- **Agent skills**: Dynamic skill loading support (v0.67+)
- **Code execution tools**: Built-in code execution capabilities (v0.61+)

**Core API patterns** (stable across versions):
- **Timeout config**: `timeout` in milliseconds (not seconds) - multiply by 1000
- **No native JSON schema** - must use `tool_choice` pattern for structured outputs
- **Error types**: `APIConnectionTimeoutError`, `RateLimitError` (includes `retry-after` header)
- **Token usage**: Always in `message.usage`, content is array of blocks
- **Streaming abort**: Use `stream.controller.abort()`, not external AbortController

**Key TypeScript types**: `Message`, `MessageCreateParams`, `ContentBlock`, `APIError` hierarchy

**Implementation gotchas**:
- Default timeout is 10 minutes - set explicit `timeout` for benchmarking
- `maxRetries: 0` disables retries (default is 2)
- Second parameter to `create()` allows per-request timeout/retry overrides
- `message.content` is always an array, even for single text responses

#### openai 6.8.1 (Released November 2025)
**Version in use**: 6.8.1 (intentionally kept current)
**Reason**: Latest SDK features and API capabilities (models are strings, SDK version-agnostic)

**Critical SDK changes since training cutoff** (v4.85 → v6.8):
- 🚨 **Breaking changes in v5**: Assistants API removed, `runFunctions()` removed, "function" helpers renamed to "tools"
- 🚨 **Breaking changes in v6**: Function call outputs changed from `string` to `string | Array<...>` - needs type guards
- **Structured outputs**: `parse()` method with `zodResponseFormat()` for type-safe JSON extraction
- **Realtime API**: WebSocket-based real-time communication (v6.1+)
- **Reasoning token tracking**: `completion_tokens_details.reasoning_tokens` field for reasoning models
- **Zod v4 support**: Compatible with Zod 4.x schemas (v6.7.0+)
- **Audio enhancements**: Transcription with diarization support (v6.4.0)

**Core API patterns** (stable across versions):
- **Timeout config**: `timeout` in milliseconds, default 10 minutes
- **Retry behavior**: Automatic retries on 429/5xx with exponential backoff
- **Error types**: `APIConnectionTimeoutError`, `RateLimitError`
- **Reasoning models**: Use `max_completion_tokens` (not `max_tokens`), optional `reasoning_effort` parameter

**Key TypeScript types**: `ChatCompletion`, `ParsedChatCompletion<T>`, `CompletionUsage`, `CompletionTokensDetails`

**Implementation gotchas**:
- Default timeout is 10 minutes - set explicit `timeout` for benchmarking
- `maxRetries: 0` recommended for predictable benchmark timing
- `parse()` throws `LengthFinishReasonError` on truncation (cleaner error handling than manual JSON.parse)
- Reasoning tokens don't appear in message content, only in usage stats
- AbortController cancellation may have edge case issues - test thoroughly

**When to use context7 for these libraries**:
- Writing provider integration code (`src/providers/ClaudeProvider.ts`, `OpenAIProvider.ts`)
- Debugging API call failures or unexpected responses
- Implementing timeout/retry logic with AbortController
- Handling structured outputs or JSON schemas (especially Anthropic's tool_choice pattern)
- Working with streaming responses
- Implementing reasoning model support (o1/o3 token tracking)
- Troubleshooting error handling edge cases

## Migration from Track 1

**DO NOT simply translate Bash to TypeScript**. Instead:

1. **Understand the requirement**: What does Track 1 do? Why? What are edge cases?
2. **Design TypeScript solution**: Use classes, interfaces, async/await idiomatically
3. **Validate behavior**: Same inputs → same outputs as Track 1
4. **Document differences**: If TypeScript approach differs, explain why in migration log

**Example - Timeout Handling**:
- **Track 1**: `timeout` command + retry loop in Bash
- **Track 2**: `AbortController` + Promise.race() + retry decorator pattern
- **Same behavior**: 3 retries, exponential backoff, same error messages

## Critical Constraints

- **Behavioral parity with Track 1**: Output must be identical for same inputs
- **Type safety**: All public APIs must have complete type definitions
- **No breaking changes to test data**: Use existing test-data/ structure as-is
- **Performance**: Must not be significantly slower than Track 1 (within 20%)

## Success Metrics

Track 2 is production-ready when:
1. ✅ Passes all Track 1 validation tests
2. ✅ Full type coverage (tsc --strict with no errors)
3. ✅ Performance within 20% of Track 1
4. ✅ Documentation complete
5. ✅ User migration guide written
6. ✅ At least one real-world benchmark run matches Track 1 output exactly
