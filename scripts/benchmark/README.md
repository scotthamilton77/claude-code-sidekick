# LLM Benchmarking System

Phase 2 implementation: Reference generation with prompt versioning and snapshotting.

## Quick Start

### Generate References (v1.0)

```bash
# Test with single transcript first
./scripts/benchmark/generate-reference.sh --test-id short-001

# Generate all 15 golden references
./scripts/benchmark/generate-reference.sh

# Dry-run to see what would happen
./scripts/benchmark/generate-reference.sh --dry-run
```

## Versioning System

### Directory Structure

References are stored with semantic versioning and timestamps:

```
test-data/references/
  v1.0_2025-10-28_141530/           # Version + timestamp
    _metadata.json                   # Complete metadata snapshot
    _prompt-snapshot/
      topic-only.txt                 # Exact prompt used
      topic-schema.json              # Exact schema used
      config-snapshot.sh             # Config vars snapshot
    short-001/
      grok-beta.json                 # Individual model outputs
      gemini-2.0-flash-exp.json
      gpt-4o.json
      consensus.json                 # Consensus from 3 models
    short-002/
      ...
```

### Version Semantics

Update `REFERENCE_VERSION` in `config.sh` when making changes:

- **MAJOR (v1.0 → v2.0)**: Complete prompt rewrite, different schema
- **MINOR (v1.0 → v1.1)**: Prompt tweaks, clarifications, field additions
- **PATCH (v1.0.0 → v1.0.1)**: Typo fixes, formatting only

Example:
```bash
# Before changing prompts, update the version
export REFERENCE_VERSION=v1.1

# Then regenerate references
./scripts/benchmark/generate-reference.sh
```

### Metadata Contents

Each versioned directory includes `_metadata.json` with:

```json
{
  "reference_version": "v1.0",
  "description": "Reference generation for golden test set",
  "generated_at": "2025-10-28T14:15:30Z",
  "dataset": {
    "version": "1.0",
    "golden_set_sha256": "abc123...",
    "test_count": 15
  },
  "models": {
    "references": [
      "openrouter:x-ai/grok-beta",
      "openrouter:google/gemini-2.0-flash-exp:free",
      "openrouter:openai/gpt-4o"
    ],
    "judge": "openrouter:deepseek/deepseek-r1-distill-qwen-14b"
  },
  "prompts": {
    "topic_template": "topic-only.txt",
    "topic_template_sha256": "def456...",
    "schema": "topic-schema.json",
    "schema_sha256": "ghi789..."
  },
  "config": {
    "excerpt_lines": 80,
    "filter_tool_messages": true,
    "timeout_seconds": 30
  }
}
```

### Comparing Versions

**Future:** Compare two prompt versions to see impact on model performance:

```bash
# Compare v1.0 baseline vs v1.1 tweaked prompts
./scripts/benchmark/compare-references.sh v1.0_* v1.1_*

# Compare specific runs
./scripts/benchmark/compare-references.sh \
  v1.0_2025-10-28_141530 \
  v1.0_2025-10-28_153045
```

## Workflow: Testing Prompt Changes

1. **Baseline (v1.0)**: Generate references with current prompts
   ```bash
   # Current version is v1.0
   ./scripts/benchmark/generate-reference.sh
   ```

2. **Modify Prompts**: Edit `src/sidekick/features/prompts/topic-only.txt`
   - Add clarifications
   - Adjust examples
   - Tune instructions

3. **New Version (v1.1)**: Update version and regenerate
   ```bash
   # Update version in config.sh
   export REFERENCE_VERSION=v1.1

   # Regenerate with new prompts
   ./scripts/benchmark/generate-reference.sh
   ```

4. **Compare**: Analyze differences between v1.0 and v1.1
   ```bash
   # Manual comparison for now
   diff -u \
     test-data/references/v1.0_*/short-001/consensus.json \
     test-data/references/v1.1_*/short-001/consensus.json

   # Future: automated comparison tool
   ./scripts/benchmark/compare-references.sh v1.0_* v1.1_*
   ```

## Benefits

### Complete Reproducibility
- Exact prompt snapshot ensures you know what produced each reference
- SHA256 checksums detect any changes to prompts or dataset
- Config snapshot captures all relevant settings

### Historical Analysis
- Track how prompt evolution affects model outputs
- Compare different prompt strategies (v1.0 vs v2.0)
- Understand which changes improved quality

### A/B Testing
- Generate refs with prompt variant A (v1.0)
- Generate refs with prompt variant B (v1.1)
- Benchmark models against both to see which is better

### Safe Iteration
- Old references never overwritten
- Can always go back to compare
- Versioned directories keep everything organized

## Cost Tracking

Reference generation costs:
- 3 models × 15 transcripts = 45 API calls
- Consensus uses judge model: 15 transcripts × ~6 similarity checks = ~90 API calls
- Estimated total: ~$5-15 per reference version

Cost optimization:
- Reuse existing references (skip regeneration with proper version management)
- Test changes on single transcript first: `--test-id short-001`
- Use dry-run to validate before spending: `--dry-run`

## Architecture

See `QA-PLAN.md` Phase 2 for complete design documentation.

**Key Components:**
- `config.sh` - Configuration with version management
- `lib/similarity.sh` - LLM-as-judge semantic similarity
- `lib/consensus.sh` - Consensus algorithms (median, majority, semantic)
- `generate-reference.sh` - Main orchestrator with snapshotting
