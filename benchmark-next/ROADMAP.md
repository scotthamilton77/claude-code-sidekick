# TypeScript Migration Roadmap

**Status**: 🏗️ Infrastructure Phase
**Last Updated**: 2025-11-09
**Recent Activity**: Phase 2.1 complete (OpenRouterProvider with HTTP client, 25 tests passing)
**Target**: Behavioral parity with Track 1 Bash implementation

---

## Overview

This roadmap tracks the component-level migration from Track 1 (Bash, `scripts/benchmark/`) to Track 2 (TypeScript, `benchmark-next/`). Each component must pass tests validating Track 1 behavior before being marked complete.

**Migration Approach**: Test-Driven Validation
- Extract Track 1 behavior as test cases (fixtures in `test/fixtures/`)
- Write failing tests first
- Implement TypeScript to pass tests
- Validate output parity with Track 1
- Mark component complete

**Progress**: 6/35 components complete (17%)

---

## Phase 1: Foundation (5/5 Complete) ✅

**Goal**: Establish TypeScript project infrastructure and core LLM provider abstractions.

### 1.1 TypeScript Project Setup ✅
**Maps to**: New infrastructure
**Acceptance Criteria**:
- ✅ `tsconfig.json` with strict mode enabled
- ✅ `package.json` with all required dependencies (optimized: stable infra pre-training, LLM SDKs current)
- ✅ ESLint + Prettier configured
- ✅ Build script verification (`pnpm run build` and `pnpm run typecheck` passing)

**Files Created**:
- ✅ `package.json`
- ✅ `tsconfig.json`
- ✅ `.eslintrc.cjs`
- ✅ `.prettierrc`
- ✅ `.gitignore`

**Dependencies**: @anthropic-ai/sdk, openai, zod, winston, commander, vitest

**Completed**: 2025-11-09

---

### 1.2 Vitest Test Infrastructure ✅
**Maps to**: `scripts/tests/` (Bash test framework replacement)
**Acceptance Criteria**:
- ✅ Vitest configured for TypeScript
- ✅ Mock LLM provider setup (zero API cost testing)
- ✅ Test fixtures loader utility created
- ✅ `pnpm test` verification (all 20 tests passing)

**Files Created**:
- ✅ `vitest.config.ts`
- ✅ `test/setup.ts`
- ✅ `test/utils/fixtures.ts`
- ✅ `test/__mocks__/LLMProvider.ts`
- ✅ `test/__mocks__/LLMProvider.test.ts`

**Test Coverage Target**: >80% line coverage for all components

**Status**: Complete - full test infrastructure in place with comprehensive mock provider

**Completed**: 2025-11-09

---

### 1.3 LLMProvider Interface + Types ✅
**Maps to**: `src/sidekick/lib/llm.sh` (abstraction layer)
**Acceptance Criteria**:
- ✅ Abstract `LLMProvider` interface defined
- ✅ TypeScript types for all LLM interactions
- ✅ Zod schemas for request/response validation
- ✅ Mock provider implementation for testing

**Files Created**:
- ✅ `src/providers/LLMProvider.ts` (abstract base class)
- ✅ `src/providers/types.ts` (comprehensive type definitions)
- ✅ `src/providers/schemas.ts` (Zod validation schemas)
- ✅ `test/providers/MockProvider.ts` (full mock implementation)
- ✅ `test/providers/MockProvider.test.ts` (32 tests passing)

**Key Methods**:
```typescript
abstract class LLMProvider {
  abstract invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse>
  extractJSON<T>(response: LLMResponse, schema?: ZodSchema<T>): T
  getProviderName(): string
  getModelName(): string
  getIdentifier(): string
  protected createError(type: LLMErrorType, message: string, ...): LLMError
}
```

**Status**: Complete - full type system with mock provider and comprehensive tests

**Completed**: 2025-11-09

---

### 1.4 ClaudeProvider Implementation ✅
**Maps to**: `llm.sh::_llm_invoke_claude_cli()`
**Acceptance Criteria**:
- ✅ Uses `@anthropic-ai/sdk` official SDK (v0.68.0)
- ✅ Timeout handling with `AbortController` (per-request timeout)
- ✅ Retry logic with exponential backoff (timeout and rate limit errors)
- ✅ Full metadata extraction (tokens, cost, timing)
- ✅ JSON extraction matches Track 1 behavior (inherited from LLMProvider)
- ✅ Comprehensive test suite (23 tests, all passing)

**Files Created**:
- ✅ `src/providers/ClaudeProvider.ts` (full implementation with retry logic)
- ✅ `test/providers/ClaudeProvider.test.ts` (23 tests covering all scenarios)

**Key Features**:
- Configurable timeout (default: 30s)
- Automatic retry on timeout/rate limit (default: 3 retries, exponential backoff)
- Model-specific cost calculation (Sonnet 4, Haiku, Opus pricing)
- Error type mapping (timeout, rate limit, API, network, unknown)
- Multi-block text content handling

**Status**: Complete - all tests passing, type-safe implementation

**Completed**: 2025-11-09

---

### 1.5 OpenAIProvider Implementation ✅
**Maps to**: `llm.sh::_llm_invoke_openai_api()`
**Acceptance Criteria**:
- ✅ Uses `openai` official SDK (v6.8.1)
- ✅ Supports structured output (JSON schema enforcement via response_format)
- ✅ Timeout handling with `AbortController` (per-request timeout)
- ✅ Retry logic with exponential backoff (timeout and rate limit errors)
- ✅ Full metadata extraction (tokens, timing; cost omitted as OpenAI doesn't provide it)
- ✅ Comprehensive test suite (27 tests, all passing)

**Files Created**:
- ✅ `src/providers/OpenAIProvider.ts` (full implementation with retry logic)
- ✅ `test/providers/OpenAIProvider.test.ts` (27 tests covering all scenarios)

**Key Features**:
- Configurable timeout (default: 30s)
- Automatic retry on timeout/rate limit (default: 3 retries, exponential backoff)
- JSON schema support (response_format: json_schema or json_object)
- Tool call handling (extracts content from `<|constrain|>json` tool calls)
- Reasoning field extraction (for models that provide reasoning)
- Error type mapping (timeout, rate limit, API, network, unknown)

**Status**: Complete - all tests passing, type-safe implementation

**Completed**: 2025-11-09

---

## Phase 2: Infrastructure (1/6 Complete)

**Goal**: Complete LLM provider ecosystem and configuration management.

### 2.1 OpenRouterProvider Implementation ✅
**Maps to**: `llm.sh::_llm_invoke_openrouter()`
**Acceptance Criteria**:
- ✅ OpenAI SDK with custom baseURL (reuses battle-tested SDK, OpenRouter API is OpenAI-compatible)
- ✅ JSON schema support (via API parameters: json_schema and json_object modes)
- ✅ Timeout/retry handling (AbortController + exponential backoff)
- ✅ Comprehensive test suite (24 tests, all passing)

**Files Created**:
- ✅ `src/providers/OpenRouterProvider.ts` (full implementation with retry logic, ~287 lines)
- ✅ `test/providers/OpenRouterProvider.test.ts` (24 tests covering all scenarios)

**Key Features**:
- Uses OpenAI SDK with `baseURL: 'https://openrouter.ai/api/v1'` (no custom HTTP code)
- Configurable timeout (default: 30s)
- Automatic retry on timeout/rate limit (default: 3 retries, exponential backoff)
- JSON schema enforcement (response_format: json_schema or json_object)
- Tool call handling (extracts content from `<|constrain|>json` tool calls)
- Reasoning field extraction (for models that provide reasoning)
- Error type mapping (timeout, rate limit, API, network, unknown)
- Full metadata extraction (tokens, timing, HTTP status)

**Status**: Complete - all tests passing, type-safe implementation

**Completed**: 2025-11-09

---

### 2.2 Timeout/Retry Decorator ⏳
**Maps to**: `llm.sh` timeout logic + `LLM_TIMEOUT_MAX_RETRIES`
**Acceptance Criteria**:
- Configurable timeout (AbortController-based)
- Exponential backoff between retries
- Max retry limit honored
- Matches Track 1 retry behavior (timeout = curl exit 28)

**Files to Create**:
- `src/providers/RetryDecorator.ts`
- `test/providers/RetryDecorator.test.ts`

**Test Cases**:
- Immediate success (no retry)
- Timeout → retry → success
- Max retries exceeded → throw error
- Exponential backoff timing validation

---

### 2.3 JSON Extraction Utilities ⏳
**Maps to**: `llm.sh::llm_extract_json()`
**Acceptance Criteria**:
- Handles code fences (```json ... ```)
- Handles markdown json blocks
- Handles raw JSON
- Zod validation integration
- Matches Track 1 extraction behavior

**Files to Create**:
- `src/utils/json-extraction.ts`
- `test/utils/json-extraction.test.ts`

**Test Fixtures**: `test/fixtures/json-extraction/` (various formats from Track 1)

---

### 2.4 Config System with Zod Schemas ⏳
**Maps to**: `config.sh` + Sidekick config cascade
**Acceptance Criteria**:
- 4-level cascade: defaults → user global → project → versioned
- Type-safe config classes
- Zod validation with clear error messages
- Environment variable overrides
- Timeout resolution cascade logic

**Files to Create**:
- `src/core/Config.ts`
- `src/core/ConfigSchema.ts` (Zod schemas)
- `test/core/Config.test.ts`

**Config Sources**:
1. Hardcoded defaults (in Config.ts)
2. `~/.claude/benchmark-next.conf` (optional)
3. `.benchmark-next/config.json` (optional)
4. `.benchmark-next/config.local.json` (gitignored, highest priority)

---

### 2.5 Logger Setup (Structured Logging) ⏳
**Maps to**: `sidekick/lib/common.sh::log_*()` functions
**Acceptance Criteria**:
- Structured logging (JSON format)
- Log levels (debug, info, warn, error)
- Timestamp precision matches Track 1
- Configurable output (stdout, file, both)

**Files to Create**:
- `src/utils/logger.ts`
- `test/utils/logger.test.ts`

**Library Choice**: Winston or Pino (decide during implementation)

---

### 2.6 Test Data Loaders ⏳
**Maps to**: Bash scripts that load `test-data/transcripts/`, `metadata.json`, etc.
**Acceptance Criteria**:
- Load golden set from `test-data/golden-set.json`
- Load metadata from `test-data/metadata.json`
- Load transcripts from `test-data/transcripts/*.jsonl`
- Load references from `test-data/references/{version}/`
- Type-safe transcript/metadata interfaces

**Files to Create**:
- `src/data/loaders.ts`
- `src/data/types.ts` (transcript, metadata types)
- `test/data/loaders.test.ts`

---

## Phase 3: Preprocessing (0/2 Complete)

**Goal**: Transcript preprocessing matching Sidekick topic extraction behavior.

### 3.1 Transcript Excerpt Extraction ⏳
**Maps to**: `lib/preprocessing.sh::preprocess_transcript()`
**Acceptance Criteria**:
- Extracts last N lines (configurable, default 80)
- Matches Track 1 output exactly (byte-for-byte)
- Handles edge cases (transcript shorter than N lines)

**Files to Create**:
- `src/preprocessing/excerpt.ts`
- `test/preprocessing/excerpt.test.ts`

**Test Fixtures**: Sample transcripts from `test-data/transcripts/` with known excerpt outputs

---

### 3.2 Message Filtering & Metadata Stripping ⏳
**Maps to**: `lib/preprocessing.sh` (tool message removal, metadata deletion)
**Acceptance Criteria**:
- Filters `tool_use` and `tool_result` messages (when enabled)
- Strips `.model`, `.id`, `.type`, `.stop_reason`, `.stop_sequence`, `.usage`
- Output matches Track 1 exactly

**Files to Create**:
- `src/preprocessing/filter.ts`
- `test/preprocessing/filter.test.ts`

**Configuration**: `TOPIC_FILTER_TOOL_MESSAGES` (boolean)

---

## Phase 4: Scoring (0/5 Complete)

**Goal**: Three-dimensional scoring system (schema, technical, content).

### 4.1 Schema Validator (Zod-based) ⏳
**Maps to**: `lib/scoring.sh::score_schema_compliance()`
**Acceptance Criteria**:
- Validates JSON structure (30 points)
- Validates required fields (30 points)
- Validates types/ranges (40 points)
- Produces same scores as Track 1 on test fixtures

**Files to Create**:
- `src/scoring/SchemaValidator.ts`
- `src/scoring/schemas.ts` (topic extraction schema)
- `test/scoring/SchemaValidator.test.ts`

**Test Fixtures**: `test/fixtures/scoring/schema-*.json` (valid, invalid, edge cases)

---

### 4.2 Semantic Similarity (LLM-as-Judge) ⏳
**Maps to**: `lib/similarity.sh::calculate_semantic_similarity()`
**Acceptance Criteria**:
- Uses judge model to score similarity (0.0-1.0)
- Fallback judge support
- Identical text optimization (return 1.0 without API call)
- Scores match Track 1 within ±0.05

**Files to Create**:
- `src/scoring/SemanticSimilarity.ts`
- `test/scoring/SemanticSimilarity.test.ts`

**Test Fixtures**: String pairs with known similarity scores from Track 1

---

### 4.3 Technical Accuracy Scorer ⏳
**Maps to**: `lib/scoring.sh::score_technical_accuracy()`
**Acceptance Criteria**:
- Task IDs exact match (15 pts)
- Initial goal semantic similarity (20 pts)
- Current objective semantic similarity (20 pts)
- Clarity score within ±1 (20 pts)
- Significant change match (15 pts)
- Confidence within ±0.15 (10 pts)
- Scores match Track 1 exactly

**Files to Create**:
- `src/scoring/TechnicalAccuracy.ts`
- `test/scoring/TechnicalAccuracy.test.ts`

**Test Fixtures**: Reference outputs vs candidate outputs with known scores

---

### 4.4 Content Quality Scorer ⏳
**Maps to**: `lib/scoring.sh::score_content_quality()`
**Acceptance Criteria**:
- Snarky comment presence (20 pts)
- Length 20-120 chars (20 pts)
- Relevance to transcript (60 pts via semantic similarity)
- Scores match Track 1 exactly

**Files to Create**:
- `src/scoring/ContentQuality.ts`
- `test/scoring/ContentQuality.test.ts`

---

### 4.5 Weighted Score Aggregator ⏳
**Maps to**: `lib/scoring.sh::calculate_overall_score()`
**Acceptance Criteria**:
- Combines schema (30%), technical (50%), content (20%)
- Produces overall score (0-100)
- Matches Track 1 calculations exactly

**Files to Create**:
- `src/scoring/Aggregator.ts`
- `test/scoring/Aggregator.test.ts`

**Test Cases**: Various score combinations with known weighted results

---

## Phase 5: Consensus (0/4 Complete)

**Goal**: Multi-model consensus algorithms for reference generation.

### 5.1 String Consensus (Semantic Centrality) ⏳
**Maps to**: `lib/consensus.sh::compute_string_consensus()`
**Acceptance Criteria**:
- Pairwise similarity calculation
- Select most central string (highest average similarity)
- Identical string optimization
- Null handling
- Matches Track 1 selections

**Files to Create**:
- `src/consensus/StringConsensus.ts`
- `test/consensus/StringConsensus.test.ts`

**Test Fixtures**: 3-model output sets with known consensus from Track 1

---

### 5.2 Numeric Consensus (Median) ⏳
**Maps to**: `lib/consensus.sh::compute_numeric_consensus()`
**Acceptance Criteria**:
- Median calculation (3 or 2 values)
- Null filtering
- Matches Track 1 results

**Files to Create**:
- `src/consensus/NumericConsensus.ts`
- `test/consensus/NumericConsensus.test.ts`

---

### 5.3 Boolean Consensus (Majority Vote) ⏳
**Maps to**: `lib/consensus.sh::compute_boolean_consensus()`
**Acceptance Criteria**:
- Majority vote (2+ = true)
- Null handling
- Matches Track 1 decisions

**Files to Create**:
- `src/consensus/BooleanConsensus.ts`
- `test/consensus/BooleanConsensus.test.ts`

---

### 5.4 Array Consensus (Union) ⏳
**Maps to**: `lib/consensus.sh::compute_array_consensus()`
**Acceptance Criteria**:
- Union where item appears in 2+ arrays
- Deduplication
- Matches Track 1 unions

**Files to Create**:
- `src/consensus/ArrayConsensus.ts`
- `test/consensus/ArrayConsensus.test.ts`

**Test Fixtures**: Task ID arrays from 3-model outputs

---

## Phase 6: Orchestration (0/4 Complete)

**Goal**: Main benchmark and reference generation workflows.

### 6.1 Reference Generator (Versioning, Provenance) ⏳
**Maps to**: `generate-reference.sh`
**Acceptance Criteria**:
- Versioned directory creation (`{version}_{timestamp}/`)
- Provenance tracking (prompt, schema, config, checksums)
- Metadata generation
- 3-model invocation
- Consensus computation
- Output matches Track 1 structure

**Files to Create**:
- `src/core/ReferenceGenerator.ts`
- `test/core/ReferenceGenerator.test.ts`

**Test Strategy**: Mock LLM providers, validate directory structure and file contents

---

### 6.2 Benchmark Runner (Parallel Execution) ⏳
**Maps to**: `run-benchmark.sh`
**Acceptance Criteria**:
- Model selection (tags, explicit list)
- Transcript loading from golden set
- Parallel execution (N runs per transcript)
- Latency measurement (millisecond precision)
- Output organization (`results/{timestamp}/raw/{provider}_{model}/`)
- Matches Track 1 execution flow

**Files to Create**:
- `src/core/Benchmark.ts`
- `test/core/Benchmark.test.ts`

---

### 6.3 Failure Tracking & Early Termination ⏳
**Maps to**: `run-benchmark.sh` failure logic
**Acceptance Criteria**:
- Consecutive failure counting (JSON parse, timeout, API)
- Early termination thresholds (3 consecutive failures)
- Failure statistics in summary
- Matches Track 1 termination behavior

**Files to Create**:
- `src/core/FailureTracker.ts`
- `test/core/FailureTracker.test.ts`

---

### 6.4 Statistics Aggregation ⏳
**Maps to**: `run-benchmark.sh` summary generation
**Acceptance Criteria**:
- Aggregate scores (min/max/avg/median)
- Latency statistics
- Error rate calculations (API failures, timeouts, JSON parse failures)
- JSON output matches Track 1 schema

**Files to Create**:
- `src/core/Statistics.ts`
- `test/core/Statistics.test.ts`

---

## Phase 7: CLI (0/2 Complete)

**Goal**: Command-line interface for benchmark and reference generation.

### 7.1 Command Structure (Commander.js) ⏳
**Maps to**: Bash script argument parsing
**Acceptance Criteria**:
- `benchmark` command with options (--provider, --model, --mode, etc.)
- `generate-reference` command with options (--transcript-id, --force)
- Help text and examples
- Argument validation

**Files to Create**:
- `src/cli/benchmark.ts`
- `src/cli/generate-reference.ts`
- `src/cli/index.ts` (main entry point)

---

### 7.2 Output Formatting & Progress Tracking ⏳
**Maps to**: Track 1 stdout logging
**Acceptance Criteria**:
- Pretty tables for summary statistics
- Progress indicators for long-running operations
- JSON output option (--json flag)
- Matches Track 1 readability

**Files to Create**:
- `src/cli/formatters.ts`
- `test/cli/formatters.test.ts`

---

## Phase 8: Circuit Breaker (0/3 Complete)

**Goal**: Resilience pattern for flaky LLM providers.

### 8.1 State Machine Implementation ⏳
**Maps to**: Sidekick circuit breaker (CLOSED/OPEN/HALF_OPEN)
**Acceptance Criteria**:
- 3-state machine (CLOSED → OPEN → HALF_OPEN)
- Failure threshold trigger (3 consecutive)
- Success resets state
- State persistence (session-based JSON)

**Files to Create**:
- `src/providers/CircuitBreaker.ts`
- `test/providers/CircuitBreaker.test.ts`

**Test Cases**: State transitions, threshold counting, persistence

---

### 8.2 Exponential Backoff ⏳
**Maps to**: Sidekick `CIRCUIT_BREAKER_BACKOFF_*` config
**Acceptance Criteria**:
- Configurable initial backoff (default 60s)
- Multiplier (default 2x)
- Max backoff cap (default 3600s)
- Backoff expiry triggers HALF_OPEN state

**Files to Create**:
- Integrated into CircuitBreaker.ts
- Test cases for backoff calculation

---

### 8.3 Fallback Provider Integration ⏳
**Maps to**: Sidekick `LLM_FALLBACK_PROVIDER` config
**Acceptance Criteria**:
- Automatic provider switch when circuit opens
- Fallback model configuration
- Transparent to caller (same interface)
- Matches Track 1 fallback behavior

**Files to Create**:
- `src/providers/FallbackProvider.ts`
- `test/providers/FallbackProvider.test.ts`

---

## Phase 9: Validation (0/4 Complete)

**Goal**: Verify behavioral parity with Track 1 and production readiness.

### 9.1 Output Comparison Tests (Track 1 vs Track 2) ⏳
**Acceptance Criteria**:
- Run same inputs through both implementations
- Diff JSON outputs (ignore timestamp fields)
- Validate score equivalence (within ±1 point)
- Validate consensus selections match

**Files to Create**:
- `test/integration/track-comparison.test.ts`
- `scripts/compare-tracks.sh` (helper script)

**Test Data**: Use shared `test-data/transcripts/` for validation

---

### 9.2 Performance Benchmarking ⏳
**Acceptance Criteria**:
- Measure execution time for benchmark runs
- Compare to Track 1 baseline
- Verify within 20% performance target
- Identify optimization opportunities

**Files to Create**:
- `test/performance/benchmark-perf.test.ts`
- Performance report generator

---

### 9.3 E2E Tests with Real LLM Calls ⏳
**Acceptance Criteria**:
- Full benchmark run on golden set (expensive)
- Real API calls to all configured providers
- Output validation against Track 1
- Manual execution only (not in CI)

**Files to Create**:
- `test/e2e/full-benchmark.test.ts`
- `test/e2e/reference-generation.test.ts`

**⚠️ Warning**: These tests cost money (real API calls). Run manually.

---

### 9.4 Migration Guide Documentation ⏳
**Acceptance Criteria**:
- Complete API documentation
- Usage examples for all commands
- Migration guide from Track 1
- Configuration reference
- Troubleshooting guide

**Files to Create**:
- `benchmark-next/docs/API.md`
- `benchmark-next/docs/MIGRATION.md`
- `benchmark-next/docs/CONFIGURATION.md`
- `benchmark-next/docs/TROUBLESHOOTING.md`

---

## Legend

- ⏳ **Not Started** - No code written, no tests
- 🧪 **Tests Written** - Test suite created, implementation pending
- 🚧 **Implementing** - Code in progress, tests may be passing/failing
- ✅ **Complete** - Tests passing, validated against Track 1, documented

---

## Progress Tracking

Update this section after completing each component:

**Phase 1**: █████ 5/5 (100%) ✅
**Phase 2**: █░░░░░ 1/6 (17%)
**Phase 3**: ░░ 0/2 (0%)
**Phase 4**: ░░░░░ 0/5 (0%)
**Phase 5**: ░░░░ 0/4 (0%)
**Phase 6**: ░░░░ 0/4 (0%)
**Phase 7**: ░░ 0/2 (0%)
**Phase 8**: ░░░ 0/3 (0%)
**Phase 9**: ░░░░ 0/4 (0%)

**Overall**: ██████░░░░░░░░░░░░░░ 6/35 (17%)

---

## Notes

- **Test fixtures**: Extract from Track 1 outputs as components are implemented
- **TodoWrite**: Use during active sessions for granular subtask tracking
- **Behavioral parity**: Track 1 is the source of truth - when in doubt, match its behavior exactly
- **Type safety**: No `any` types allowed - use Zod for runtime validation where needed
- **Documentation**: Update this roadmap after each component completion (don't let it go stale!)

---

## Quick Start

Ready to start implementing? Pick a component and follow this workflow:

1. **Review Track 1 behavior** - Read corresponding Bash script, understand logic
2. **Write test first** - Create failing test based on Track 1 behavior
3. **Implement** - Write TypeScript to pass test
4. **Validate** - Run both Track 1 and Track 2 on same input, diff outputs
5. **Update roadmap** - Change component status from ⏳ → 🧪 → 🚧 → ✅
6. **Update progress bar** - Increment completion counter

**Recommended starting point**: Phase 1.1 (TypeScript Project Setup) - establishes foundation for all other work.
