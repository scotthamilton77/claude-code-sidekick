# LLM Benchmarking System

A comprehensive benchmarking framework for evaluating LLM models on topic extraction quality. Generates high-quality reference outputs from premium models and scores candidate models against them.

## Quick Start

### 1. Generate Reference Outputs

```bash
# Test with single transcript first
./scripts/benchmark/generate-reference.sh --test-id short-001

# Generate all 15 golden references
./scripts/benchmark/generate-reference.sh

# Dry-run to see what would happen
./scripts/benchmark/generate-reference.sh --dry-run
```

### 2. Run Benchmarks

```bash
# Quick smoke test (3 transcripts, 1 run, cheapest+default models)
./scripts/benchmark/run-benchmark.sh --mode smoke

# Standard benchmark (10 transcripts, 3 runs, cheap models)
./scripts/benchmark/run-benchmark.sh --mode quick --models cheap

# Full benchmark (all 15 transcripts, 5 runs, all models)
./scripts/benchmark/run-benchmark.sh --mode full

# Test specific models
./scripts/benchmark/run-benchmark.sh --mode quick --models "gemma-3-4b-it,gpt-5-nano"
```

### 3. Review Results

```bash
# View summary statistics
jq . test-data/results/TIMESTAMP/summary.json

# Examine individual model outputs
ls -la test-data/results/TIMESTAMP/raw/
```

## Versioning System

### Directory Structure

References are stored with semantic versioning and timestamps:

```
test-data/references/
  v1.0_2025-10-28_141530/           # Version + timestamp
    _metadata.json                   # Complete metadata snapshot
    _prompt-snapshot/
      topic.prompt.txt               # Exact prompt used
      topic.schema.json              # Exact schema used
      config-snapshot.sh             # Config vars snapshot
    short-001/
      grok-4.json                    # Individual model outputs
      gemini-2.5-pro.json
      gpt-5-chat.json
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
      "openrouter:x-ai/grok-4",
      "openrouter:google/gemini-2.5-pro",
      "openrouter:openai/gpt-5-chat"
    ],
    "judge": "openrouter:deepseek/deepseek-r1-distill-qwen-14b"
  },
  "prompts": {
    "topic_template": "topic.prompt.txt",
    "topic_template_sha256": "def456...",
    "schema": "topic.schema.json",
    "schema_sha256": "ghi789..."
  },
  "config": {
    "excerpt_lines": 80,
    "filter_tool_messages": true,
    "timeout_seconds": 60
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

2. **Modify Prompts**: Edit `src/sidekick/features/prompts/topic.prompt.txt`
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

## Benchmark Modes

The system supports four benchmark modes with different speed/cost/thoroughness trade-offs:

| Mode | Transcripts | Runs/Model | Models | Use Case |
|------|------------|------------|--------|----------|
| **smoke** | 3 | 1 | cheapest+default | Quick sanity check |
| **quick** | 10 | 3 | cheap | Development/iteration |
| **full** | all (15) | 5 | all | Complete evaluation |
| **statistical** | all (15) | 10 | all | High-confidence results |

**Transcript selection**: Based on `test-data/transcripts/golden-set.json` (5 short, 5 medium, 5 long)

**Model filters**:
- `all` - Test all configured models
- `cheap` - Models tagged as cheap (<$0.10 per M tokens)
- `default` - Default production models
- `"model1,model2"` - Comma-separated list of specific models

## Scoring System

Each model output is scored on three dimensions:

### Schema Compliance (30% weight, 0-100 points)
- Valid JSON structure (30 pts)
- Required fields present (30 pts)
- Correct field types and ranges (40 pts)

**Required fields**:
- `task_ids` (string or null)
- `initial_goal` (string, max 60 chars)
- `current_objective` (string, max 60 chars)
- `clarity_score` (int, 1-10)
- `confidence` (float, 0.0-1.0)
- `significant_change` (boolean)
- `high_clarity_snarky_comment` (string, max 120 chars)
- `low_clarity_snarky_comment` (string, max 120 chars)

### Technical Accuracy (50% weight, 0-100 points)
Compares output to reference using:
- `task_ids` exact match (15 pts)
- `initial_goal` semantic similarity (20 pts)
- `current_objective` semantic similarity (20 pts)
- `clarity_score` within ±1 (20 pts)
- `significant_change` match (15 pts)
- `confidence` within ±0.15 (10 pts)

### Content Quality (20% weight, 0-100 points)
Evaluates snarky comment quality:
- Comment present in appropriate field based on clarity (20 pts)
- Length within bounds 20-120 chars (20 pts)
- Relevance to transcript content via semantic similarity (60 pts)

**Overall Score**: Weighted average of three dimensions
```
overall = (schema × 0.30) + (technical × 0.50) + (content × 0.20)
```

## Production-Ready Criteria

Models must meet these thresholds for production use:

- **JSON Parse Rate**: ≥95% (valid JSON outputs)
- **Latency P95**: <10 seconds (95th percentile)
- **Technical Accuracy**: ≥70% average score
- **Cost**: <$1.00 per 1000 operations

**Early termination**: Models are skipped after 3 consecutive JSON failures or timeouts.

## Cost Tracking

### Reference Generation
- 3 reference models × 15 transcripts = 45 API calls
- Consensus semantic similarity: ~90 additional API calls (judge model)
- **Estimated total**: $5-15 per reference version (depends on model pricing)

### Benchmark Runs
Varies by mode and model selection:

| Mode | API Calls | Estimated Cost |
|------|-----------|----------------|
| smoke | 3 transcripts × models × 1 run | $0.10-0.50 |
| quick | 10 transcripts × models × 3 runs | $1-5 |
| full | 15 transcripts × models × 5 runs | $5-20 |
| statistical | 15 transcripts × models × 10 runs | $10-40 |

**Cost optimization**:
- Start with `--mode smoke` for quick validation
- Use `--models cheap` to test only low-cost models
- Test single transcripts: `--test-id short-001`
- Reuse existing references (version management)

## Architecture

### Components

#### Core Scripts
- **`run-benchmark.sh`** - Main benchmark orchestrator
  - Loads references and test transcripts
  - Executes models against transcripts
  - Scores outputs and generates summary statistics
  - Early termination for failing models

- **`generate-reference.sh`** - Reference generation
  - Invokes 3 premium models on golden set
  - Computes consensus using semantic similarity
  - Creates versioned directories with snapshots

- **`test-similarity.sh`** - Validation test suite
  - Tests semantic similarity function
  - Validates score ranges and consistency
  - Checks edge cases

- **`config.sh`** - Central configuration
  - Reference models (grok-4, gemini-2.5-pro, gpt-5-chat)
  - Judge model (deepseek-r1-distill-qwen-14b)
  - Benchmark models with pricing and tags
  - Timeout configuration via Sidekick config system

#### Library Modules

- **`lib/preprocessing.sh`** - Transcript preprocessing
  - `preprocess_transcript()` - Extract and clean excerpts
  - Matches Sidekick's topic extraction behavior
  - Configurable via `TOPIC_EXCERPT_LINES` and `TOPIC_FILTER_TOOL_MESSAGES`

- **`lib/similarity.sh`** - LLM-as-judge semantic similarity
  - `semantic_similarity()` - Score similarity 0.0-1.0
  - `llm_invoke_with_provider()` - Multi-provider LLM wrapper
  - Uses configured `JUDGE_MODEL`

- **`lib/consensus.sh`** - Consensus algorithms
  - `consensus_string_field()` - Most central text via semantic similarity
  - `consensus_numeric_field()` - Median of numeric values
  - `consensus_boolean_field()` - Majority vote
  - `consensus_array_field()` - Items appearing in 2+ outputs
  - `consensus_merge()` - Main orchestrator

- **`lib/scoring.sh`** - Output scoring
  - `score_schema_compliance()` - Validate JSON structure (0-100)
  - `score_technical_accuracy()` - Compare to reference (0-100)
  - `score_content_quality()` - Assess snarky comments (0-100)
  - `score_output()` - Weighted overall score

### Configuration

**Timeout settings** are managed via Sidekick config system:
- Global default: `LLM_TIMEOUT_SECONDS` (30s)
- Benchmark override: `LLM_BENCHMARK_TIMEOUT_SECONDS` (60s by default)
- Configure in `~/.claude/hooks/sidekick/sidekick.conf` or `.sidekick/sidekick.conf`

**Benchmark models** are defined in `config.sh` with format:
```bash
"provider:model_name|input_price|output_price|tags"
```

Example:
```bash
"openrouter:google/gemma-3-4b-it|0.02|0.07|cheap,fast"
```

**Scoring fallback** is available for the judge model:
- Primary judge: `JUDGE_MODEL` (deepseek-r1-distill-qwen-14b)
- Fallback judge: `BENCHMARK_SCORING_MODEL_FALLBACK` (openai-api:gpt-5-mini)
- Fallback is ONLY used for semantic similarity scoring (not model evaluation)
- When primary judge fails/times out, fallback is automatically used
- This ensures scoring continues even when the cheap judge model has issues
- Benchmark evaluation has NO fallback (to keep results clean)
