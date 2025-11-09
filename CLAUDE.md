# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Need | Location |
|------|----------|
| **Run tests** | `cd benchmark-next && npm test` |
| **Architecture** | `benchmark-next/CLAUDE.md` (TypeScript), `ARCH.md` (legacy Bash) |
| **Migration status** | `docs/benchmark-migration.md` |
| **Test data** | `test-data/` (shared by both implementations) |
| **Legacy bash** | `src/sidekick/`, `scripts/benchmark/` (reference only) |

## Project Purpose

This repository is the **experimental proving ground** for Claude Code configuration development—a system for enhancing Claude Code conversations with hooks, agents, skills, and other capabilities.

**Strategic Direction**: Migrating from Bash to TypeScript for maintainability, type safety, and testability. Starting with the benchmark system (`benchmark-next/`), with plans to eventually migrate all components.

**Critical Design Principle**: All capabilities must work identically in both:
- **Project scope**: `.claude/` within this repository (testing)
- **User scope**: `~/.claude/` global directory (production deployment)

## Architecture Overview

### Active Development: TypeScript Track (`benchmark-next/`)

**Primary focus** for all new development. Modern stack with type safety and comprehensive testing.

**Stack**: TypeScript + Node.js + Vitest + Zod
**Documentation**: See `benchmark-next/CLAUDE.md` for detailed architecture
**Status**: 🏗️ Foundation complete, migrating core features from bash implementation

**Key Components**:
- LLM provider abstraction (Claude, OpenAI, OpenRouter, custom)
- Timeout/retry with exponential backoff and circuit breaker
- Semantic similarity scoring (LLM-as-judge)
- Reference generation and benchmark orchestration
- Structured logging and configuration management

### Legacy: Bash Track (`src/sidekick/`, `scripts/`)

**Production system** currently in use, but being phased out. Reference for functional behavior only.

**Key Locations** (minimal detail—see `ARCH.md` for complete docs):
- `src/sidekick/` - Hook system (topic extraction, resume, statusline, tracking, cleanup)
- `scripts/benchmark/` - Original benchmark implementation (3K LOC Bash)
- `scripts/tests/` - Bash test infrastructure

**If you need to**:
- Install legacy hooks: `./scripts/install.sh --user` → `claude --continue`
- Run legacy tests: `./scripts/tests/run-unit-tests.sh`
- Find bash implementation details: See `ARCH.md` and `PLAN.md`

### Shared Test Data (`test-data/`)

Canonical dataset used by **both** implementations for validation and behavioral parity testing.

**Structure**:
- `test-data/transcripts/` - 497 Claude Code transcripts with metadata
  - `metadata.json` - Master index (length classification, task IDs)
  - `golden-set.json` - 15 reference transcripts for benchmarking
  - `*.jsonl` - Raw transcript files
- `test-data/references/` - High-quality LLM outputs for scoring ground truth
- `test-data/projects/` - Original source (for repopulating if needed)
- `test-data/sessions/` - Legacy Sidekick analysis results

**Distribution**: 36% short (179), 22% medium (110), 42% long (208) transcripts

## Development Workflow

### Working on TypeScript Track (Recommended)

```bash
cd benchmark-next
npm install
npm test          # Run all tests
npm test:watch    # TDD mode
```

See `benchmark-next/CLAUDE.md` for architecture, patterns, and migration checklist.

### Working on Legacy Bash (Maintenance Only)

Only modify bash code for:
- Critical production bugs
- Extracting behavioral requirements for TypeScript migration

After any bash changes, extract requirements to `docs/benchmark-migration.md` for eventual TypeScript implementation.

### Migration Workflow

See `docs/benchmark-migration.md` for the test-driven migration process:
1. Extract behavior from Bash (inputs → outputs)
2. Create test fixtures in `benchmark-next/test/fixtures/`
3. Write failing TypeScript tests
4. Implement TypeScript to pass tests
5. Validate parity using shared `test-data/`

## MCP Servers

- **context7** (SSE) - Post-cutoff documentation lookup
- **sequential-thinking** (NPX) - Enhanced reasoning
- **memory** (NPX) - Session knowledge persistence

## Critical Constraints

- Never modify files outside project directory without authorization
- Hooks require permission in `settings.json` before execution
- Dual-scope testing required before deploying to `~/.claude/`
- Timestamp preservation critical for sync correctness
- **NEVER install/uninstall without explicit user authorization**

## Current Status

**TypeScript Track** (`benchmark-next/`): 🏗️ Foundation setup complete, implementing Phase 2 core utilities

**Bash Track** (`src/sidekick/`, `scripts/`): ✅ Production-stable, maintenance mode only

See `docs/benchmark-migration.md` for migration progress.
