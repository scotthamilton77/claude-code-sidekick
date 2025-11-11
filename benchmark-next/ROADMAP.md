# TypeScript Migration Roadmap

**Status**: 🏗️ Consensus Phase - Phase 5.3 Complete ✅
**Last Updated**: 2025-11-11
**Recent Activity**: Phase 5.3 complete (boolean consensus with majority vote, 24 passing tests, 401 total tests passing)
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

**Progress**: 21/34 components complete (62%) - 1 component skipped

---

## Architecture: Staged Extraction Strategy

**Date**: 2025-11-09 - Reorganized source structure to prepare for future monorepo extraction

**Rationale**: Both `benchmark-next/` and future `sidekick-next/` will need identical foundational capabilities (LLM providers, config cascade, logging, paths). To avoid duplication and enforce clean architecture, we've reorganized with future extraction in mind.

**Current Structure** (`src/`):

```
src/
├── lib/                      # Shared foundation (future common package)
│   ├── providers/            # ✅ LLM abstraction (Phase 2.1)
│   ├── utils/                # ✅ Generic helpers (Phase 2.3)
│   ├── config/               # ✅ Config cascade (Phase 2.4)
│   ├── logging/              # ✅ Structured logging (Phase 2.5)
│   ├── transcript/           # ✅ Transcript processing (Phase 3.1-3.2)
│   └── paths/                # ⏳ Path utilities (future phase)
└── benchmark/                # Benchmark-specific domain logic
    ├── core/                 # ⏳ Orchestration (Phase 6)
    ├── scoring/              # ⏳ Scoring algorithms (Phase 4)
    ├── consensus/            # ⏳ Consensus algorithms (Phase 5)
    ├── data/                 # ✅ Data loading (Phase 2.6)
    └── cli/                  # ⏳ CLI entry points (Phase 7)
```

**Future Structure** (when sidekick migration begins):

```
packages/
├── common/       # Extracted from benchmark-next/src/lib/
├── benchmark/    # Benchmark-specific
└── sidekick/     # Sidekick-specific
```

**Design Constraints for `lib/` Code**:

- Clear, documented interfaces
- No tight coupling to benchmark domain logic
- Testable in isolation
- All code marked as "shared candidate"

**Extraction Criteria**: Move from `lib/` to `packages/common/` when:

1. Interface has stabilized through real-world use
2. No benchmark-specific dependencies remain
3. Sidekick migration requires the capability
4. Full test coverage exists

See `src/lib/README.md` and `docs/benchmark-migration.md` for detailed guidelines.

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

**Dependencies**: @anthropic-ai/sdk, openai, zod, pino, commander, vitest

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

- ✅ `src/lib/providers/LLMProvider.ts` (abstract base class)
- ✅ `src/lib/providers/types.ts` (comprehensive type definitions)
- ✅ `src/lib/providers/schemas.ts` (Zod validation schemas)
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

- ✅ `src/lib/providers/ClaudeProvider.ts` (full implementation with retry logic)
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

- ✅ `src/lib/providers/OpenAIProvider.ts` (full implementation with retry logic)
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

## Phase 2: Infrastructure (3/5 Complete, 1 Skipped)

**Goal**: Complete LLM provider ecosystem and configuration management.

### 2.1 OpenRouterProvider Implementation ✅

**Maps to**: `llm.sh::_llm_invoke_openrouter()`
**Acceptance Criteria**:

- ✅ OpenAI SDK with custom baseURL (reuses battle-tested SDK, OpenRouter API is OpenAI-compatible)
- ✅ JSON schema support (via API parameters: json_schema and json_object modes)
- ✅ Timeout/retry handling (AbortController + exponential backoff)
- ✅ Comprehensive test suite (24 tests, all passing)

**Files Created**:

- ✅ `src/lib/providers/OpenRouterProvider.ts` (full implementation with retry logic, ~287 lines)
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

### 2.2 Timeout/Retry Decorator ⏭️ **SKIPPED - NOT NEEDED**

**Maps to**: `llm.sh` timeout logic + `LLM_TIMEOUT_MAX_RETRIES`

**Status**: ⏭️ Skipped - Retry logic already implemented directly in each provider

**Rationale**:
All providers (ClaudeProvider, OpenAIProvider, OpenRouterProvider) already implement timeout/retry logic using their respective official SDKs:

- **ClaudeProvider**: Uses `@anthropic-ai/sdk` timeout + custom retry loop with exponential backoff
- **OpenAIProvider**: Uses `openai` SDK timeout + custom retry loop with exponential backoff
- **OpenRouterProvider**: Uses `openai` SDK timeout + custom retry loop with exponential backoff

Creating a separate decorator would require:

1. Extracting retry logic from all existing providers (breaking changes)
2. Wrapping SDK calls with decorator pattern (added complexity)
3. Maintaining consistency between decorator and SDK error types

**Decision**: Keep retry logic co-located with provider implementations. The pattern is consistent across providers (~80 lines each), well-tested (3-4 retry tests per provider), and leverages SDK-native error detection.

**Original Acceptance Criteria** (now implemented per-provider):

- ✅ Configurable timeout (AbortController-based) - in each provider
- ✅ Exponential backoff between retries - in each provider
- ✅ Max retry limit honored - in each provider
- ✅ Matches Track 1 retry behavior - validated in tests

**Files NOT Created** (intentionally):

- ~~`src/providers/RetryDecorator.ts`~~ - not needed
- ~~`test/providers/RetryDecorator.test.ts`~~ - covered by provider tests

---

### 2.3 JSON Extraction Utilities ✅

**Maps to**: `llm.sh::llm_extract_json()`
**Acceptance Criteria**:

- ✅ Handles code fences (`json ... `)
- ✅ Handles markdown json blocks
- ✅ Handles raw JSON
- ✅ Zod validation integration (ready for use by callers)
- ✅ Matches Track 1 extraction behavior

**Files Created**:

- ✅ `src/lib/utils/json-extraction.ts` (extractJSON, extractJSONFromMarkdown functions)
- ✅ `test/utils/json-extraction.test.ts` (16 tests, all passing)
- ✅ `test/fixtures/json-extraction/` (6 test fixtures)

**Key Features**:

- Markdown code fence extraction (`json ... `)
- Raw JSON passthrough
- Single-element array unwrapping (`[{...}]` → `{...}`)
- Multi-element array preservation
- Handles both objects ({}) and arrays ([])
- Edge case handling (text with embedded JSON, whitespace)

**Status**: Complete - all tests passing, behavioral parity with Track 1

**Completed**: 2025-11-09

---

### 2.4 Config System with Zod Schemas ✅

**Maps to**: `config.sh` + Sidekick config cascade
**Acceptance Criteria**:

- ✅ 4-level cascade: defaults → user global → project → local (gitignored)
- ✅ Type-safe config classes with TypeScript interfaces
- ✅ Zod validation with clear error messages
- ✅ Environment variable overrides (BENCHMARK\_\*, OPENAI_API_KEY, OPENROUTER_API_KEY)
- ✅ Timeout resolution cascade logic (benchmarkTimeoutSeconds → timeoutSeconds → 30s fallback)
- ✅ Comprehensive test suite (28 tests, all passing)

**Files Created**:

- ✅ `src/lib/config/Config.ts` (full implementation with 4-level cascade, deep merge)
- ✅ `src/lib/config/ConfigSchema.ts` (Zod schemas for all config sections)
- ✅ `test/unit/config/Config.test.ts` (28 tests covering defaults, cascade, env vars, validation)

**Config Sources**:

1. Hardcoded defaults (in Config.ts)
2. `~/.claude/benchmark-next.conf` (optional user global)
3. `.benchmark-next/config.json` (optional project)
4. `.benchmark-next/config.local.json` (gitignored, highest priority)

**Key Features**:

- Deep merge algorithm preserves nested object overrides
- Feature toggle checking (isFeatureEnabled())
- Timeout resolution with context (benchmark vs default)
- Test isolation via homeDir parameter
- Null support for benchmarkTimeoutSeconds to disable override

**Status**: Complete - all tests passing, behavioral parity with bash config cascade

**Completed**: 2025-11-09

---

### 2.5 Logger Setup (Structured Logging) ✅

**Maps to**: `sidekick/lib/common.sh::log_*()` functions
**Acceptance Criteria**:

- ✅ Structured logging (JSON format)
- ✅ Log levels (debug, info, warn, error)
- ✅ Timestamp precision (ISO format with milliseconds, exceeds Track 1 second precision)
- ✅ Configurable output (stdout, file, both)
- ✅ Directory creation and validation
- ✅ Pretty print mode for development

**Files Created**:

- ✅ `src/lib/logging/createLogger.ts` (~165 lines, factory function)
- ✅ `src/lib/logging/README.md` (updated to reflect simplified approach)

**Library Choice**: **Pino** (used directly, no wrapper)

**Design Philosophy**:
After code review, removed unnecessary Logger wrapper class (300 lines + 445 lines of tests). Replaced with simple factory function (~165 lines) that handles setup, then consumers use Pino's documented API directly. Benefits:

- No abstraction overhead (YAGNI - nobody swaps logger implementations)
- Use Pino's excellent documentation instead of custom API
- Reduced complexity (165 lines vs 745 lines)
- Removed unused winston dependency

**Key Features**:

- Factory function with directory creation (`mkdir -p`)
- Multi-stream support (stdout, file, both)
- Pretty print mode for development (pino-pretty)
- ISO 8601 timestamps with millisecond precision
- Consumers use Pino API directly (child loggers, dynamic levels, etc.)

**Status**: Complete - simplified, maintainable, no unnecessary abstraction

**Completed**: 2025-11-10

---

### 2.6 Test Data Loaders ✅

**Maps to**: Bash scripts that load `test-data/transcripts/`, `metadata.json`, etc.
**Acceptance Criteria**:

- ✅ Load golden set from `test-data/golden-set.json`
- ✅ Load metadata from `test-data/metadata.json`
- ✅ Load transcripts from `test-data/transcripts/*.jsonl`
- ✅ Load references from `test-data/references/{version}/`
- ✅ Type-safe transcript/metadata interfaces

**Files Created**:

- ✅ `src/benchmark/data/loaders.ts` (~241 lines, 9 loader functions)
- ✅ `src/benchmark/data/types.ts` (~177 lines, comprehensive type definitions)
- ✅ `test/unit/data/loaders.test.ts` (~301 lines, 29 tests, all passing)

**Key Features**:

- Loads golden set (15 transcripts) and full metadata (497 transcripts)
- JSONL transcript parsing with proper type safety
- Reference version discovery and loading (individual models + consensus)
- Parallel loading for golden set transcripts (performance optimization)
- Optional custom directory paths for testing flexibility
- Comprehensive test coverage validating all loaders

**Status**: Complete - all tests passing, full type coverage, behavioral validation

**Completed**: 2025-11-10

---

## Phase 3: Preprocessing (2/2 Complete) ✅

**Goal**: Transcript preprocessing matching Sidekick topic extraction behavior.

### 3.1 Transcript Excerpt Extraction ✅

**Maps to**: `lib/preprocessing.sh::preprocess_transcript()`
**Acceptance Criteria**:

- ✅ Extracts last N lines (configurable, default 80)
- ✅ Matches Track 1 output exactly (byte-for-byte)
- ✅ Handles edge cases (transcript shorter than N lines)

**Files Created**:

- ✅ `src/lib/transcript/excerpt.ts` (core extraction logic, ~185 lines)
- ✅ `src/lib/transcript/types.ts` (type definitions, ~40 lines)
- ✅ `src/lib/transcript/index.ts` (public API exports)
- ✅ `test/unit/transcript/excerpt.test.ts` (16 tests, all passing)
- ✅ `test/fixtures/transcript/` (4 test fixtures from Track 1)

**Design Decision**: Placed in `src/lib/transcript/` (not `src/benchmark/preprocessing/`) because transcript processing is shared infrastructure that will be needed by both benchmark and sidekick implementations.

**Test Coverage**: 16 tests covering line extraction, filtering, metadata stripping, edge cases, and file I/O

**Status**: Complete - all tests passing, behavioral parity with Track 1 validated

**Completed**: 2025-11-10

---

### 3.2 Message Filtering & Metadata Stripping ✅

**Maps to**: `lib/preprocessing.sh` (tool message removal, metadata deletion)
**Acceptance Criteria**:

- ✅ Filters `tool_use` and `tool_result` messages (when enabled)
- ✅ Strips `.model`, `.id`, `.type`, `.stop_reason`, `.stop_sequence`, `.usage`
- ✅ Output matches Track 1 exactly

**Implementation Note**: Implemented as part of 3.1 via `ExcerptOptions`:

- `filterToolMessages: boolean` (default: true)
- `stripMetadata: boolean` (default: true)

**Status**: Complete - integrated with excerpt extraction, fully tested

**Completed**: 2025-11-10

---

## Phase 4: Scoring (4/5 Complete)

**Goal**: Three-dimensional scoring system (schema, technical, content).

### 4.1 Schema Validator (Zod-based) ✅

**Maps to**: `lib/scoring.sh::score_schema_compliance()`
**Acceptance Criteria**:

- ✅ Validates JSON structure (30 points)
- ✅ Validates required fields (30 points proportional)
- ✅ Validates types/ranges (40 points, 8 checks × 5 points each)
- ✅ Produces same scores as Track 1 on test fixtures

**Files Created**:

- ✅ `src/benchmark/scoring/SchemaValidator.ts` (217 lines)
- ✅ `src/benchmark/scoring/schemas.ts` (Zod schemas for TopicAnalysis, SimilarityScore)
- ✅ `src/benchmark/scoring/types.ts` (TypeScript interfaces)
- ✅ `test/unit/scoring/SchemaValidator.test.ts` (23 tests, all passing)

**Key Features**:

- 3-tier scoring: JSON (30), required fields (30), type/range validation (40)
- Proportional field scoring (missing fields reduce score proportionally)
- Per-check type validation (5 points each: clarity_score range, confidence range, string lengths, etc.)
- Comprehensive validation: integers, numeric ranges, string max lengths, nullable unions

**Status**: Complete - all tests passing, behavioral parity with Track 1

**Completed**: 2025-11-10

---

### 4.2 Semantic Similarity (LLM-as-Judge) ✅

**Maps to**: `lib/similarity.sh::calculate_semantic_similarity()`
**Acceptance Criteria**:

- ✅ Uses judge model to score similarity (0.0-1.0)
- ✅ Fallback judge support with error aggregation
- ✅ Identical text optimization (return 1.0 without API call)
- ✅ Scores match Track 1 within ±0.05

**Files Created**:

- ✅ `src/benchmark/scoring/SemanticSimilarity.ts` (100 lines)
- ✅ `test/unit/scoring/SemanticSimilarity.test.ts` (16 tests, all passing)

**Key Features**:

- LLM-as-judge pattern with explicit scoring guidelines (1.0 = identical, 0.7-0.89 = similar, etc.)
- Primary/fallback judge provider cascade for resilience
- Identical text optimization (short-circuit to 1.0, zero API cost)
- Input validation (non-empty text enforcement)
- Prompt template with context-rich guidelines for consistency

**Status**: Complete - all tests passing, fallback scenarios validated

**Completed**: 2025-11-10

---

### 4.3 Technical Accuracy Scorer ✅

**Maps to**: `lib/scoring.sh::score_technical_accuracy()`
**Acceptance Criteria**:

- ✅ Task IDs exact match (15 pts)
- ✅ Initial goal semantic similarity (20 pts)
- ✅ Current objective semantic similarity (20 pts)
- ✅ Clarity score within ±1 (20 pts)
- ✅ Significant change match (15 pts)
- ✅ Confidence within ±0.15 (10 pts)
- ✅ Scores match Track 1 exactly

**Files Created**:

- ✅ `src/benchmark/scoring/TechnicalAccuracy.ts` (~120 lines)
- ✅ `test/unit/scoring/TechnicalAccuracy.test.ts` (26 tests, all passing)

**Key Features**:

- 6-component scoring: task_ids (15), initial_goal similarity (20), current_objective similarity (20), clarity tolerance (20), significant_change (15), confidence tolerance (10)
- Integrates semantic similarity via SemanticSimilarity module for text field comparison
- Tolerance-based scoring: clarity ±1, confidence ±0.15 with floating-point precision handling
- Graceful error handling: semantic similarity failures return 0.0 without throwing
- Comprehensive edge case coverage: boundary testing, rounding behavior, partial mismatches

**Status**: Complete - all tests passing, behavioral parity with Track 1

**Completed**: 2025-11-10

---

### 4.4 Content Quality Scorer ✅

**Maps to**: `lib/scoring.sh::score_content_quality()`
**Acceptance Criteria**:

- ✅ Snarky comment presence (20 pts)
- ✅ Length 20-120 chars (20 pts)
- ✅ Relevance to transcript (60 pts via semantic similarity)
- ✅ Field selection based on clarity_score (high/low comment)
- ✅ Uses first 500 chars of transcript for relevance
- ✅ Scores match Track 1 exactly

**Files Created**:

- ✅ `src/benchmark/scoring/ContentQuality.ts` (~92 lines)
- ✅ `test/unit/scoring/ContentQuality.test.ts` (23 tests, all passing)

**Key Features**:

- Field selection: clarity_score >= 7 → high_clarity_snarky_comment, else low_clarity_snarky_comment
- Three-dimensional scoring: presence (20), length 20-120 chars (20), relevance via semantic similarity (60)
- Transcript excerpt: uses first 500 characters for relevance comparison
- Graceful null handling: returns 0 scores without calling semantic similarity
- Comprehensive edge case coverage: boundary lengths, null comments, rounding behavior

**Status**: Complete - all tests passing, behavioral parity with Track 1

**Completed**: 2025-11-10

---

### 4.5 Weighted Score Aggregator ✅

**Maps to**: `lib/scoring.sh::calculate_overall_score()`
**Acceptance Criteria**:

- ✅ Combines schema (30%), technical (50%), content (20%)
- ✅ Produces overall score (0-100)
- ✅ Matches Track 1 calculations exactly

**Files Created**:

- ✅ `src/benchmark/scoring/Aggregator.ts` (~60 lines, calculateOverallScore function)
- ✅ `test/unit/scoring/Aggregator.test.ts` (17 tests, all passing)

**Key Features**:

- Weighted average calculation: (schema _ 0.30) + (technical _ 0.50) + (content \* 0.20)
- Rounds to 2 decimal places to match Track 1's bc scale=2 behavior
- Comprehensive test coverage: edge cases, realistic scenarios, validation against bash calculations
- Pure function with no side effects (stateless, deterministic)

**Status**: Complete - all tests passing, behavioral parity with Track 1 validated

**Completed**: 2025-11-10

---

## Phase 5: Consensus (1/4 Complete)

**Goal**: Multi-model consensus algorithms for reference generation.

### 5.1 String Consensus (Semantic Centrality) ✅

**Maps to**: `lib/consensus.sh::compute_string_consensus()`
**Acceptance Criteria**:

- ✅ Pairwise similarity calculation
- ✅ Select most central string (highest average similarity)
- ✅ Identical string optimization
- ✅ Null handling
- ✅ Matches Track 1 selections

**Files Created**:

- ✅ `src/benchmark/consensus/StringConsensus.ts` (~198 lines, semantic centrality algorithm)
- ✅ `test/unit/consensus/StringConsensus.test.ts` (27 tests, all passing)

**Key Features**:

- Pairwise semantic similarity calculation for 3 inputs
- Selects string with highest average similarity (most "central")
- Optimization: identical strings return immediately (no API calls)
- Graceful null/empty handling (returns null if all empty, single value if only one non-null)
- Error resilience: failed similarity calculations use 0.0 and continue
- Debug mode: optionally returns averages, pairwise scores, selected index

**Status**: Complete - all tests passing, behavioral parity with Track 1 validated

**Completed**: 2025-11-10

---

### 5.2 Numeric Consensus (Median) ✅

**Maps to**: `lib/consensus.sh::consensus_numeric_field()`
**Acceptance Criteria**:

- ✅ Median calculation (3 values, middle when sorted)
- ✅ Null filtering (null/undefined → 0)
- ✅ Matches Track 1 results

**Files Created**:

- ✅ `src/benchmark/consensus/NumericConsensus.ts` (~54 lines)
- ✅ `test/unit/consensus/NumericConsensus.test.ts` (24 tests, all passing)

**Key Features**:

- Simple median calculation (sort and take middle value)
- Null/undefined handling (treated as 0, matches bash default)
- Supports integers, floats, negative numbers
- Robust to outliers (median property)
- Pure function with no side effects

**Status**: Complete - all tests passing, behavioral parity with Track 1 validated

**Completed**: 2025-11-10

---

### 5.3 Boolean Consensus (Majority Vote) ✅

**Maps to**: `lib/consensus.sh::consensus_boolean_field()`
**Acceptance Criteria**:

- ✅ Majority vote (2+ = true)
- ✅ Null handling (null/undefined treated as false)
- ✅ Matches Track 1 decisions

**Files Created**:

- ✅ `src/benchmark/consensus/BooleanConsensus.ts` (~52 lines)
- ✅ `test/unit/consensus/BooleanConsensus.test.ts` (24 tests, all passing)

**Key Features**:

- Simple majority voting: returns true if 2 or more values are true
- Null/undefined handling (treated as false, matches bash default)
- Normalization: only explicit true is treated as true, everything else becomes false
- Pure function with no side effects
- Comprehensive edge case coverage (all 27 input combinations tested)

**Status**: Complete - all tests passing, behavioral parity with Track 1 validated

**Completed**: 2025-11-11

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
**Phase 2**: █████⏭️ 5/5 complete, 1 skipped (100%) ✅
**Phase 3**: ██ 2/2 (100%) ✅
**Phase 4**: █████ 5/5 (100%) ✅
**Phase 5**: ███░ 3/4 (75%)
**Phase 6**: ░░░░ 0/4 (0%)
**Phase 7**: ░░ 0/2 (0%)
**Phase 8**: ░░░ 0/3 (0%)
**Phase 9**: ░░░░ 0/4 (0%)

**Overall**: ████████████████████⏭️░░ 21/34 complete, 1 skipped (62%)

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
