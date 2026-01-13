# lib/

**Purpose**: Shared foundation code - future candidates for extraction to `packages/common/` monorepo.

This directory contains reusable, domain-agnostic utilities that could be shared between multiple projects (benchmark, sidekick, etc.). Code here should have minimal dependencies on benchmark-specific logic.

## Architecture Principle

**Staged Extraction Strategy**:
- **Phase 1 (current)**: Keep shared code in `lib/` within benchmark-next, design with loose coupling
- **Phase 2 (when sidekick migration starts)**: Extract stabilized interfaces to monorepo `packages/common/`

## Subdirectories

### `providers/` - LLM Provider Abstraction
**Status**: ✅ Implemented (Phase 2.1)

Abstract interface for LLM invocation supporting multiple backends:
- Claude (Anthropic SDK)
- OpenAI (OpenAI SDK + compatible providers like Azure)
- OpenRouter (API)
- Custom command templates

**Shared Candidate**: High - sidekick needs identical provider system for topic extraction, resume generation, etc.

### `utils/` - Generic Helper Functions
**Status**: 🟡 Partial (JSON extraction implemented)

Generic utilities with no domain-specific dependencies:
- JSON extraction from LLM output (markdown unwrapping, etc.)
- String manipulation
- Data structure helpers

**Shared Candidate**: High - utilities are inherently reusable.

### `config/` - Configuration Management
**Status**: ⏳ Not Started (Phase 2.4)

Configuration cascade matching sidekick pattern:
1. Defaults (hardcoded)
2. User global (`~/.claude/benchmark-next.conf`)
3. Project deployed (`.claude/benchmark-next.conf`)
4. Project versioned (`.benchmark-next/config.json` - gitignored)

**Shared Candidate**: Very High - both systems need identical config behavior.

### `logging/` - Structured Logging
**Status**: ⏳ Not Started (Phase 2.5)

Structured logging with:
- Log levels (debug, info, warn, error)
- Dual logs (global + session-specific)
- Timestamp consistency with bash implementation
- Context enrichment

**Shared Candidate**: Very High - centralized logging critical for debugging.

### `paths/` - Path Utilities
**Status**: ⏳ Not Started (Phase 2.6)

Workspace and path management:
- Project root detection
- Session directory structure
- Config file location resolution
- Safe path operations

**Shared Candidate**: High - both systems operate on same workspace structure.

## Design Constraints

Code in `lib/` must:
- Have clear, documented interfaces
- Avoid tight coupling to `benchmark/` domain logic
- Be testable in isolation
- Document "shared candidate" status for future extraction

## When to Add Here vs `benchmark/`

**Add to `lib/`**:
- Reusable utilities with no benchmark domain knowledge
- Infrastructure (logging, config, paths)
- LLM provider abstraction

**Add to `benchmark/`**:
- Scoring algorithms (semantic similarity, technical accuracy)
- Consensus algorithms (median, semantic centrality)
- Benchmark orchestration
- CLI commands specific to benchmarking

When in doubt, start in `benchmark/` and refactor to `lib/` when reuse is proven.
