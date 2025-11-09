# Benchmark Migration Log

**Purpose**: Track functional changes from Track 1 (Bash) that need to be ported to Track 2 (TypeScript).

**Sync Strategy**: Extract HIGH-LEVEL functional requirements from Track 1 debugging/improvements, implement idiomatically in Track 2.

---

## Migration Status

**Track 1** (scripts/benchmark/): Active development - debugging and improving
**Track 2** (benchmark-next/): Foundation setup - TypeScript rewrite in progress

---

## Functional Requirements Log

### Template Entry

```markdown
### [YYYY-MM-DD] Feature/Fix Name
**Track 1 Change**: Brief description of what changed in Bash implementation
**Track 2 Requirement**:
- Specific behavioral requirement (not code)
- Acceptance criteria
- Edge cases to handle
**Status**: ⏳ Pending / 🚧 In Progress / ✅ Complete
**Notes**: Any additional context or decisions
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
