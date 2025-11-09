# Benchmark Migration Log

**Purpose**: Track functional changes from Track 1 (Bash) that need to be ported to Track 2 (TypeScript).

**Sync Strategy**: Extract HIGH-LEVEL functional requirements from Track 1 debugging/improvements, implement idiomatically in Track 2.

---

## Migration Status

**Track 1** (scripts/benchmark/): Active development - debugging and improving
**Track 2** (benchmark-next/): Foundation setup - TypeScript rewrite in progress

---

## Functional Requirements Log

**Migration Approach**: Test-Driven Validation
- Extract Track 1 behavior as test cases (fixtures)
- Document behavioral requirements, not implementation details
- Track 2 implementation must pass all tests validating Track 1 behavior

### Template Entry

```markdown
### [YYYY-MM-DD] Feature/Fix Name

**Track 1 Behavior**: Description of observable behavior (inputs → outputs)

**Test Cases**:
- Happy path: [describe expected behavior]
- Edge case 1: [describe edge case]
- Error case: [describe error handling]

**Test Fixtures**:
- `test/fixtures/path/to/fixture.json` - [description]
- Location in Track 1: `scripts/benchmark/path/to/script.sh:line`

**Track 2 Requirements**:
- Behavioral requirement 1 (what, not how)
- Behavioral requirement 2
- Must match Track 1 output exactly for: [specify which outputs]

**Acceptance Criteria**:
- [ ] Test fixtures extracted from Track 1
- [ ] Tests written and failing
- [ ] Track 2 implementation passes all tests
- [ ] Output comparison validates parity (Track 1 vs Track 2)
- [ ] Component marked complete in ROADMAP.md

**Status**: ⏳ Not Started / 🧪 Tests Written / 🚧 Implementing / ✅ Complete

**Notes**: Any additional context, decisions, or deviations from Track 1
```

---

## Backlog

### [2025-11-09] Initial Requirements Baseline

**Track 1 Functionality to Port**:
- LLM provider abstraction (Claude CLI, OpenAI API, OpenRouter, custom)
- Timeout/retry logic with exponential backoff
- Circuit breaker with fallback provider
- Semantic similarity scoring (LLM-as-judge)
- Consensus algorithms (median, majority vote, semantic centrality)
- Schema validation and compliance scoring
- Technical accuracy assessment
- Content quality scoring
- Reference generation workflow
- Benchmark orchestration
- Structured logging with timestamps
- Configuration cascade (defaults → user → project)

**Status**: ⏳ Pending - Track 2 foundation setup in progress

---

## Completed Migrations

*(Empty - Track 2 just started)*

---

## Notes

- Focus on **behavioral parity**, not code translation
- TypeScript idioms > Bash patterns (use classes, async/await, type safety)
- Validate using shared test-data/ on both implementations
- Document decisions that differ from Track 1 approach

## Test-Driven Migration Workflow

When Track 1 changes or you're ready to implement a Track 2 component:

1. **Extract behavior** - Run Track 1 with known inputs, capture outputs
2. **Create fixtures** - Save input/output pairs in `benchmark-next/test/fixtures/`
3. **Document requirement** - Add entry to this log with test cases
4. **Write tests** - Create Vitest tests using fixtures (expect Track 2 to match Track 1)
5. **Implement Track 2** - Write TypeScript to pass tests
6. **Validate** - Run both implementations on shared test-data/, diff outputs
7. **Mark complete** - Update status in this log and ROADMAP.md

See `benchmark-next/test/fixtures/README.md` for fixture creation guidelines.
