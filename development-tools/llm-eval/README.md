# benchmark-next

🚧 **STATUS: EXPERIMENTAL - FOUNDATION SETUP IN PROGRESS** 🚧

TypeScript rewrite of the Bash-based benchmarking system.

## ⚠️ Important

**This is Track 2 of a dual-track development effort.**

- **Track 1** (`scripts/benchmark/`): Production Bash implementation - active debugging/improvements
- **Track 2** (`benchmark-next/`): TypeScript rewrite - architectural foundation being established

**Do NOT use this code yet.** It's under active development and not production-ready.

## Current Status

- [x] Directory structure created
- [ ] TypeScript configuration (tsconfig.json, package.json)
- [ ] Core architecture design
- [ ] LLM provider abstraction
- [ ] Scoring algorithms
- [ ] Consensus algorithms
- [ ] CLI interface
- [ ] Test suite
- [ ] Documentation
- [ ] Validation against Track 1 outputs
- [ ] Performance benchmarking

## Goals

### Why Rewrite?

The Bash implementation (`scripts/benchmark/`) is ~3,000 LOC and growing unwieldy:
- Complex async orchestration using subshells and background processes
- Limited type safety (runtime errors from typos, missing vars)
- Statistical operations awkward in Bash (jq for everything)
- Test coverage difficult to achieve comprehensively
- Maintenance burden increasing

### What We're Building

A maintainable TypeScript implementation with:
- **Type Safety**: Full TypeScript strict mode, Zod for runtime validation
- **Better Async**: Native async/await vs Bash background jobs
- **Modern Testing**: Vitest with comprehensive coverage
- **Cleaner Architecture**: Classes, interfaces, dependency injection
- **Same Behavior**: Must produce identical outputs to Track 1

## Migration Strategy

**NOT a direct Bash → TypeScript translation.**

Instead:
1. Track 1 improvements → extract functional requirements → document in `docs/benchmark-migration.md`
2. Implement requirements idiomatically in TypeScript (use language strengths)
3. Validate: both tracks process same test data → compare outputs → ensure behavioral parity

## Architecture

See `CLAUDE.md` for complete architectural guidance.

**Planned Structure**:
```
src/
├── core/          # Main orchestration (Benchmark, ReferenceGenerator, Config)
├── providers/     # LLM provider abstractions (Claude, OpenAI, OpenRouter, CircuitBreaker)
├── scoring/       # Scoring algorithms (SchemaValidator, SemanticSimilarity, etc.)
├── consensus/     # Consensus algorithms (Median, Majority, SemanticCentrality)
└── cli/           # CLI entry points
```

## Development Workflow

### Setup (when ready)

```bash
cd benchmark-next
pnpm install
pnpm build
pnpm test
```

### Running (when ready)

```bash
# Benchmark a model against reference outputs
pnpm benchmark --provider openrouter --model google/gemini-flash-1.5

# Generate reference outputs (premium models)
pnpm generate-reference --transcript-id short-001
```

### Testing

```bash
# Unit tests (mocked LLM providers, fast)
pnpm test

# Integration tests (use real test data)
pnpm test:integration

# E2E tests (expensive, real LLM calls)
pnpm test:e2e
```

## Validation

Before marking Track 2 as production-ready:

1. **Functional Parity**: All Track 1 features implemented
2. **Output Equivalence**: Same test data → identical outputs (JSON schema, values, structure)
3. **Performance**: Within 20% of Track 1 execution time
4. **Type Coverage**: 100% (no `any` types)
5. **Test Coverage**: >80% line coverage, all critical paths tested
6. **Documentation**: Complete API docs, examples, migration guide

## Contributing

Track 2 is not yet ready for general use. If you need benchmarking functionality, use Track 1 (`scripts/benchmark/`).

For questions about the migration strategy or architecture, see:
- `CLAUDE.md` - Development guidance for this codebase
- `docs/benchmark-migration.md` - Track 1 → Track 2 requirement sync log
- `/workspaces/claude-config/CLAUDE.md` - Project-wide architecture overview

## Timeline

**Open-ended.** Track 2 is done when it achieves production-ready status (see validation checklist above). In the meantime, Track 1 remains the working implementation.
