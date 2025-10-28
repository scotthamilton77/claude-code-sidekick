# LLM Model Benchmarking System - Quality Assurance Plan

## Executive Summary

This document outlines a comprehensive benchmarking framework for evaluating and comparing LLM models used in the Sidekick hook system. The framework will enable data-driven model selection by measuring performance across three critical dimensions: latency, JSON output quality, and analysis accuracy.

## Table of Contents

1. [Motivation & Goals](#motivation--goals)
2. [Success Criteria](#success-criteria)
3. [Architecture Overview](#architecture-overview)
4. [Technical Approach](#technical-approach)
5. [Implementation Phases](#implementation-phases)
6. [Test Data Strategy](#test-data-strategy)
7. [Scoring Methodology](#scoring-methodology)
8. [Reporting & Visualization](#reporting--visualization)
9. [Cost Management](#cost-management)
10. [Future Enhancements](#future-enhancements)

---

## Motivation & Goals

### Why Build This?

**Problem Statement:**
The Sidekick system currently supports multiple LLM providers (Claude CLI, OpenAI, GROQ, OpenRouter) with dozens of model options documented in `config.defaults`. However, we lack empirical data to answer critical questions:

- Which models provide the fastest response times?
- Which models reliably produce valid JSON output?
- Which models deliver accurate topic extraction and resume generation?
- What are the cost/performance trade-offs between models?

**Business Impact:**
- **User Experience**: Faster models reduce hook latency, improving session responsiveness
- **Cost Optimization**: Identify cheapest models that meet quality thresholds
- **Reliability**: Avoid models with high JSON error rates
- **Informed Defaults**: Set optimal default models in `config.defaults`

### Primary Goals

1. **Quantify Latency**: Measure end-to-end response time for topic extraction and resume generation across all models
2. **Assess JSON Quality**: Evaluate schema compliance, field presence, and structural correctness
3. **Validate Analysis Accuracy**: Compare model outputs against high-quality reference standards
4. **Enable Model Selection**: Provide actionable recommendations based on use case (speed vs. cost vs. quality)
5. **Support Continuous Evaluation**: Build reusable framework for testing new models as they emerge

### Non-Goals

- Training or fine-tuning models (we benchmark existing APIs as-is)
- Real-time monitoring in production (this is offline benchmarking)
- Testing non-JSON use cases (focused on Sidekick's structured output needs)

---

## Success Criteria

### Functional Requirements

**Must Have:**
- ✅ Benchmark all models listed in `config.defaults` (Claude, OpenAI, GROQ, OpenRouter)
- ✅ Test both topic extraction and resume generation prompts
- ✅ Generate reference outputs from 3 high-quality models (Grok-4, Gemini 2.5 Pro, GPT-5 Chat)
- ✅ Score outputs across 3 dimensions: schema compliance, technical accuracy, content quality
- ✅ Produce HTML dashboard, Markdown report, and JSON data files
- ✅ Track latency statistics (min/avg/max across multiple runs)
- ✅ Calculate cost per operation for each model

**Should Have:**
- ✅ Interactive HTML dashboard with sortable tables and charts
- ✅ Semantic similarity scoring for text fields
- ✅ Test data diversity (short/long transcripts, various intent categories)
- ✅ Helper script for curating test data from `~/.claude/sessions/`
- ✅ Graceful handling of timeouts, rate limits, and API errors

**Nice to Have:**
- Parallel execution of independent model tests
- Caching of reference outputs to avoid regeneration
- Configurable scoring weights via CLI
- Comparison reports between benchmark runs

### Quality Thresholds

**Production-Ready Criteria:**

Models must meet ALL of the following criteria to be considered production-ready:

```python
PRODUCTION_READY_CRITERIA = {
    "json_parse_rate": 0.95,      # 95% valid JSON across all test cases
    "max_latency_p95": 10.0,      # 95th percentile latency under 10 seconds
    "min_accuracy_score": 70,      # Technical accuracy ≥70% vs. reference
    "max_cost_per_1k": 1.00       # Cost under $1.00 per 1000 operations
}
```

**How Criteria Are Applied:**
- Models meeting all 4 criteria receive "✅ Production Ready" badge in reports
- Models failing any criterion show which specific requirement(s) failed
- Reports highlight best model in each category (fastest, cheapest, most accurate)
- Color coding: Green = pass, Red = fail, Yellow = marginal (within 10% of threshold)

**Baseline Comparison:**
- Current production default: `google/gemma-3-12b-it` (configured in `BASELINE_MODEL`)
- All results show Δ (delta) vs. baseline: `+5.2%` (improvement) or `-12.3%` (regression)
- Executive summary highlights models that outperform baseline on key metrics
- Regression warnings for models worse than current production default

---

## Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│  Sidekick Hook System                                           │
│  ┌──────────────┐    ┌─────────────────────────────────┐       │
│  │ topic-       │───▶│ LLM Provider Abstraction Layer  │       │
│  │ extraction.sh│    │ (lib/llm.sh)                    │       │
│  └──────────────┘    └─────────────────────────────────┘       │
│                               │                                  │
│                               ▼                                  │
│                ┌──────────────────────────────────────┐         │
│                │  Provider-Specific Implementations   │         │
│                │  - Claude CLI                        │         │
│                │  - OpenAI API                        │         │
│                │  - GROQ API                          │         │
│                │  - OpenRouter API                    │         │
│                └──────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Benchmarking System (NEW)                                      │
│                                                                  │
│  ┌────────────────┐      ┌─────────────────┐                   │
│  │ Test Data      │      │ Reference        │                   │
│  │ Collection     │      │ Generation       │                   │
│  │ (bash script)  │      │ (Python)         │                   │
│  └────────────────┘      └─────────────────┘                   │
│           │                       │                              │
│           ▼                       ▼                              │
│  ┌──────────────────────────────────────────┐                   │
│  │ Benchmark Runner (Python)                │                   │
│  │ - Async execution                        │                   │
│  │ - Latency measurement                    │                   │
│  │ - Error handling                         │                   │
│  └──────────────────────────────────────────┘                   │
│                    │                                             │
│                    ▼                                             │
│  ┌──────────────────────────────────────────┐                   │
│  │ Scoring Engine (Python)                  │                   │
│  │ - Schema validation                      │                   │
│  │ - Accuracy comparison                    │                   │
│  │ - Content quality assessment             │                   │
│  └──────────────────────────────────────────┘                   │
│                    │                                             │
│                    ▼                                             │
│  ┌──────────────────────────────────────────┐                   │
│  │ Report Generator (Python)                │                   │
│  │ - HTML dashboard                         │                   │
│  │ - Markdown summary                       │                   │
│  │ - JSON data export                       │                   │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Language | Key Tools |
|-----------|---------------|----------|-----------|
| **Test Data Collection** | Curate diverse transcript samples with metadata | Bash | jq, find, LLM (for descriptions) |
| **Reference Generation** | Generate consensus outputs from high-quality models | Bash | lib/llm.sh, jq, parallel jobs |
| **Benchmark Runner** | Execute models, measure latency, capture outputs | Bash | lib/llm.sh, time, background jobs |
| **Scoring Engine** | Validate and score outputs vs. references | Bash | jq, bc, LLM-as-judge (similarity) |
| **Report Generator** | Create multi-format reports with visualizations | Bash | heredocs, jq, HTML/Markdown templates |

---

## Technical Approach

### Language Choice: Bash (with Minimal Dependencies)

**Rationale:**

1. **Leverage Existing Infrastructure**: Reuses `lib/llm.sh` provider abstraction directly
2. **Parallel Execution**: Bash background jobs + wait provides sufficient concurrency
3. **JSON Processing**: `jq` handles all JSON manipulation, validation, and aggregation
4. **Simplicity**: No additional language/runtime dependencies beyond what we already have
5. **Maintainability**: Consistent with existing Sidekick codebase architecture

**Semantic Similarity Approach:** LLM-as-Judge
- Use `deepseek/deepseek-r1-distill-qwen-14b` as fixed judge model
- Reuses existing LLM infrastructure (no new dependencies)
- Cost: ~$5-10 for full benchmark run
- Avoids circular logic (judge model is not one being benchmarked)

**Alternative Considered:** Python with sentence-transformers
- **Rejected**: Requires Python + PyTorch (~2GB install), adds complexity, embeddings approach overkill for our needs

### Integration with Existing System

**Leverage Existing Infrastructure:**
- Reuse `lib/llm.sh` provider abstraction via subprocess calls
- Use existing prompt templates from `src/sidekick/features/prompts/`
- Load configuration from `src/sidekick/config.defaults`
- Store test data alongside existing test infrastructure

**Clean Separation:**
- Benchmarking code lives in dedicated `benchmark/` directory
- No modifications to production Sidekick code
- Results stored in `test-data/` (gitignored by default)

### Tiered Benchmark Modes

To balance speed, cost, and thoroughness, the system supports four benchmark modes:

```python
BENCHMARK_MODES = {
    "smoke": {
        "samples": 3,                    # 3 test transcripts only
        "models": ["cheapest", "default"],  # 2 models
        "runs": 1,                       # Single run per test
        "purpose": "Quick validation during development",
        "estimated_time": "2-3 minutes",
        "estimated_cost": "$0.10-0.50"
    },
    "quick": {
        "samples": 10,                   # 10 test transcripts
        "models": "cheap",               # Models <$0.10/1k ops
        "runs": 3,                       # 3 runs for basic stats
        "purpose": "Fast iteration on scoring changes",
        "estimated_time": "10-15 minutes",
        "estimated_cost": "$2-5"
    },
    "full": {
        "samples": "all",                # All collected transcripts
        "models": "all",                 # All documented models
        "runs": 5,                       # 5 runs for confidence
        "purpose": "Comprehensive model comparison",
        "estimated_time": "20-30 minutes",
        "estimated_cost": "$100-300"
    },
    "statistical": {
        "samples": "all",
        "models": "all",
        "runs": 10,                      # 10 runs for high confidence
        "purpose": "High-confidence benchmarking for critical decisions",
        "estimated_time": "40-60 minutes",
        "estimated_cost": "$200-600"
    }
}
```

**CLI Usage:**
```bash
# Quick smoke test during development
python -m benchmark.main run --mode smoke

# Test cheap models only
python -m benchmark.main run --mode quick

# Full production benchmark
python -m benchmark.main run --mode full

# High-confidence statistical analysis
python -m benchmark.main run --mode statistical

# Custom: test specific model with cached references
python -m benchmark.main run \
    --models "google/gemini-2.5-flash-lite" \
    --use-cached-references \
    --mode quick
```

### Data Flow

```
1. Test Data Collection (Manual)
   ├─ Scan ~/.claude/sessions/*/transcript.jsonl
   ├─ Classify by length & type
   ├─ Copy to test-data/transcripts/
   └─ Generate metadata.json

2. Reference Generation (One-time, Expensive)
   ├─ Load test transcripts
   ├─ Run 3 high-quality models (Grok-4, Gemini 2.5 Pro, GPT-5 Chat)
   ├─ Compute consensus via voting/averaging
   └─ Store in test-data/references/

3. Benchmark Execution (Repeatable)
   ├─ Load test transcripts
   ├─ For each model:
   │  ├─ Run 5 times (measure latency)
   │  ├─ Capture JSON output
   │  ├─ Early termination if first 3 fail
   │  └─ Handle errors/timeouts
   └─ Store raw outputs in results/YYYY-MM-DD_HHMMSS/raw/

4. Scoring (Automated)
   ├─ Load model outputs & references
   ├─ Compute 3 scores per output:
   │  ├─ Schema compliance (0-100)
   │  ├─ Technical accuracy (0-100)
   │  └─ Content quality (0-100)
   └─ Calculate weighted overall score

5. Report Generation (Automated)
   ├─ Generate HTML dashboard (interactive)
   ├─ Generate Markdown summary (readable)
   └─ Export JSON data (machine-readable)
```

---

## Implementation Phases

### Phase 1: Foundation & Data Collection ✅ **COMPLETE**

**Objective:** Establish test data infrastructure and metadata format

**Deliverables (Actual):**
1. ✅ `scripts/collect-test-data.sh` - Automated test data collection script
   - Scans `~/.claude/projects/` for transcripts (not sessions dir)
   - Supports both interactive mode and automated test-data mode
   - Displays stats: line count, conversation preview, existing topic metadata
   - **AI-powered**: Uses LLM to auto-generate concise descriptions
   - Copies selected transcripts to `test-data/transcripts/`
   - Generates `test-data/transcripts/metadata.json` with classification
   - Auto-classifies by length: <50 lines (short), 50-150 (medium), >150 (long)

2. ✅ `scripts/bulk-topic-extraction.sh` - NEW: Bulk topic analysis script
   - Pre-analyzes all transcripts using Sidekick topic extraction
   - Populates `.sidekick/sessions/<session-id>/topic.json`
   - Extracts initial_goal and clarity_score metadata
   - Makes curation easier by providing AI-generated context
   - Supports --provider, --model, --force, --limit flags

3. ✅ Metadata Schema (Actual):
   ```json
   {
     "dataset_version": "1.0",
     "generated_at": "2025-10-28T09:35:48Z",
     "test_count": 497,
     "distribution": {
       "short": 179,
       "medium": 110,
       "long": 208
     },
     "transcripts": [
       {
         "id": "medium-001",
         "file": "medium-001.jsonl",
         "source_session": "7fb61bfe-c741-4649-829a-1585d63da38c",
         "length_category": "medium",
         "line_count": 53,
         "description": "Clean up project files related to a removed tool",
         "collected_at": "2025-10-28T09:35:41Z"
       }
     ]
   }
   ```

4. ✅ Test data collection: **497 transcripts** (exceeded 20-30 target!)
   - Distribution: 36% short (179), 22% medium (110), 42% long (208)
   - **Note**: Distribution slightly imbalanced (more long transcripts than target 33/33/33)

**Success Criteria:**
- ✅ Script successfully scans and classifies transcripts (automated via AI)
- ✅ Metadata JSON is valid and complete (497 entries with all fields)
- ⚠️  Balanced distribution: 36%/22%/42% vs target 33%/33%/33% (acceptable variance)
- ✅ AI-generated descriptions provide semantic context for each transcript

**Actual Effort:** ~3-4 hours (includes AI-powered automation features)

**Key Deviations from Original Plan:**
- **Automated instead of manual**: Used AI to generate descriptions rather than asking human to describe 497 transcripts
- **Much larger dataset**: 497 transcripts vs 20-30 target (better for statistical validity)
- **Additional tooling**: Created bulk-topic-extraction.sh for batch analysis
- **Test-data mode**: Added special mode for working with pre-collected test data

---

### Phase 2: Reference Generation

**Objective:** Generate high-quality reference outputs for comparison

**Deliverables:**
1. `scripts/benchmark/config.sh` - Model definitions and configuration
   ```bash
   # Reference models for generating ground truth
   REFERENCE_MODELS=(
       "openrouter:x-ai/grok-4"
       "openrouter:google/gemini-2.5-pro"
       "openrouter:openai/gpt-5-chat"
   )

   # Judge model for semantic similarity
   JUDGE_MODEL="openrouter:deepseek/deepseek-r1-distill-qwen-14b"

   # Paths
   GOLDEN_SET_FILE="test-data/transcripts/golden-set.json"
   REFERENCES_DIR="test-data/references"
   ```

2. `scripts/benchmark/lib/similarity.sh` - LLM-as-judge semantic similarity
   - `semantic_similarity()` - Invokes judge model to rate similarity (0.0-1.0)
   - Reuses existing `lib/llm.sh` infrastructure
   - Error handling & validation

3. `scripts/benchmark/lib/consensus.sh` - Consensus algorithms
   - `consensus_string_field()` - Find most central text using semantic similarity
   - `consensus_numeric_field()` - Compute median of 3 values
   - `consensus_boolean_field()` - Majority vote
   - `consensus_array_field()` - Include if 2+ models agree

4. `scripts/benchmark/generate-reference.sh` - Main orchestrator
   ```bash
   ./scripts/benchmark/generate-reference.sh
   ```

**Consensus Algorithm:**
```bash
# Example for clarity_score (numeric)
consensus_clarity=$(echo "$score1 $score2 $score3" | \
    jq -s 'sort | .[1]')  # median

# Example for task_ids (array)
# Include ID if appears in 2+ model outputs
consensus_ids=$(jq -n --argjson arr1 "$ids1" \
    --argjson arr2 "$ids2" --argjson arr3 "$ids3" \
    '[$arr1[], $arr2[], $arr3[]] | group_by(.) |
     map(select(length >= 2) | .[0])')

# Example for initial_goal (string with semantic similarity)
# Compute pairwise similarity, select most central
# (highest average similarity to the other two)
```

**Success Criteria:**
- Reference generation completes for all test transcripts
- Consensus outputs are valid JSON with all required fields
- Total cost tracked and reported (expect $5-15 for 30 transcripts)
- References stored with provenance metadata

**Estimated Effort:** 3-4 hours

---

### Phase 3: Benchmark Runner & Core Scoring

**Objective:** Execute models and compute basic scores

**Deliverables:**
1. `scripts/benchmark/run-benchmark.sh` - Benchmark execution orchestrator
   - Load test transcripts and model definitions
   - For each model × transcript combination:
     - Run 5 iterations in background (measure latency with `time`)
     - Capture stdout, stderr, exit code
     - Track timeouts and failures
   - Early termination: Skip model if first 3 test cases fail JSON parsing or timeout
   - Store raw outputs in `results/{timestamp}/raw/{model}/{test_id}/`
   - Generate summary stats: min/avg/max/p95/stddev latency per model using `jq`

   **Early Termination Rules:**
   ```bash
   EARLY_TERMINATION_RULES=(
       json_parse_failures=3  # Skip after 3 consecutive parse failures
       timeout_threshold=3    # Skip after 3 consecutive timeouts
   )
   # Saves time and API costs on obviously unsuitable models
   ```

2. `scripts/benchmark/lib/scoring.sh` - Scoring implementation

   **A. Schema Compliance Score (0-100 points):**
   ```bash
   score_schema_compliance() {
       local output="$1"
       local score=0

       # Valid JSON structure (30 pts)
       if ! echo "$output" | jq empty 2>/dev/null; then
           echo '{"score": 0, "errors": ["Invalid JSON"]}'
           return
       fi
       score=$((score + 30))

       # Required fields present (30 pts)
       local required_fields="session_id timestamp task_ids initial_goal current_objective"
       local present=$(echo "$output" | jq -r \
           "[$required_fields] | map(select(. != null)) | length")
       local required_count=$(echo "$required_fields" | wc -w)
       score=$((score + (present * 30 / required_count)))

       # Correct field types & ranges (40 pts)
       # Check clarity_score is int 1-10
       local clarity=$(echo "$output" | jq '.clarity_score')
       if [[ "$clarity" =~ ^[0-9]+$ ]] && ((clarity >= 1 && clarity <= 10)); then
           score=$((score + 10))
       fi
       # ... similar checks for other fields

       echo "{\"score\": $score}"
   }
   ```

   **B. Technical Accuracy Score (0-100 points):**
   ```bash
   score_technical_accuracy() {
       local output="$1"
       local reference="$2"
       local score=0

       # task_ids exact match (15 pts)
       local output_ids=$(echo "$output" | jq -c '.task_ids | sort')
       local ref_ids=$(echo "$reference" | jq -c '.task_ids | sort')
       if [[ "$output_ids" == "$ref_ids" ]]; then
           score=$((score + 15))
       fi

       # initial_goal semantic similarity (20 pts)
       local goal_out=$(echo "$output" | jq -r '.initial_goal')
       local goal_ref=$(echo "$reference" | jq -r '.initial_goal')
       local similarity=$(semantic_similarity "$goal_out" "$goal_ref")
       score=$((score + $(echo "$similarity * 20" | bc -l | cut -d. -f1)))

       # current_objective semantic similarity (20 pts)
       local obj_out=$(echo "$output" | jq -r '.current_objective')
       local obj_ref=$(echo "$reference" | jq -r '.current_objective')
       similarity=$(semantic_similarity "$obj_out" "$obj_ref")
       score=$((score + $(echo "$similarity * 20" | bc -l | cut -d. -f1)))

       # intent_category exact match (15 pts)
       if [[ "$(echo "$output" | jq -r '.intent_category')" == \
             "$(echo "$reference" | jq -r '.intent_category')" ]]; then
           score=$((score + 15))
       fi

       # clarity_score within ±1 (15 pts)
       local clarity_out=$(echo "$output" | jq '.clarity_score')
       local clarity_ref=$(echo "$reference" | jq '.clarity_score')
       if (($(echo "$clarity_out - $clarity_ref" | bc -l | awk '{print ($1<0)?-$1:$1}') <= 1)); then
           score=$((score + 15))
       fi

       # significant_change match (15 pts)
       if [[ "$(echo "$output" | jq '.significant_change')" == \
             "$(echo "$reference" | jq '.significant_change')" ]]; then
           score=$((score + 15))
       fi

       echo "{\"score\": $score}"
   }
   ```

   **C. Content Quality Score (0-100 points):**
   ```bash
   score_content_quality() {
       local output="$1"
       local reference="$2"
       local transcript="$3"
       local score=0

       # Determine which snarky comment field to evaluate
       local clarity=$(echo "$output" | jq '.clarity_score')
       local comment_field="low_clarity_snarky_comment"
       if ((clarity >= 7)); then
           comment_field="high_clarity_snarky_comment"
       fi
       local comment=$(echo "$output" | jq -r ".$comment_field // \"\"")

       # Snarky comment present (20 pts)
       if [[ -n "$comment" && "$comment" != "null" ]]; then
           score=$((score + 20))
       fi

       # Length within bounds (20 pts)
       local len=${#comment}
       if ((len >= 20 && len <= 120)); then
           score=$((score + 20))
       fi

       # Relevance to transcript (60 pts)
       # NOTE: Style/tone preferences (e.g., SciFi references) are
       # configurable and should not be baked into scoring.
       # Focus on semantic accuracy: does the comment accurately
       # reflect the conversation content?
       local relevance=$(semantic_similarity "$comment" "$transcript")
       score=$((score + $(echo "$relevance * 60" | bc -l | cut -d. -f1)))

       echo "{\"score\": $score}"
   }
   ```

   **Overall Score:**
   ```bash
   overall=$(echo "scale=2; ($schema * 0.30) + ($accuracy * 0.50) + ($content * 0.20)" | bc)
   ```

3. Integration & CLI
   ```bash
   ./scripts/benchmark/run-benchmark.sh --models all
   ./scripts/benchmark/run-benchmark.sh --models cheap
   ./scripts/benchmark/run-benchmark.sh --models "gemma-3-12b-it,gpt-5-nano"
   ```

**Success Criteria:**
- All models execute successfully (or fail gracefully)
- Latency measurements are consistent across runs
- Scores computed for all valid outputs
- Invalid JSON outputs score 0 on schema compliance
- Results stored with full provenance (timestamp, model, version)

**Estimated Effort:** 4-5 hours

---

### Phase 4: Semantic Similarity Integration

**Objective:** Integrate LLM-as-judge semantic similarity into scoring

**Deliverables:**
1. `scripts/benchmark/lib/similarity.sh` - Semantic similarity implementation
   ```bash
   semantic_similarity() {
       local text1="$1"
       local text2="$2"

       # Use DeepSeek R1 as judge model
       local prompt="Rate semantic similarity between these texts (0.0-1.0).
   Output ONLY a decimal number, no explanation.

   Text A: $text1
   Text B: $text2"

       # Invoke judge model via existing LLM infrastructure
       local score=$(echo "$prompt" | llm_invoke "$JUDGE_MODEL" | \
           grep -oP '0\.\d+|1\.0' | head -1)

       echo "${score:-0.0}"
   }
   ```

2. Integration into `scripts/benchmark/lib/scoring.sh`
   - Already integrated in `score_technical_accuracy()` for goal/objective fields
   - Already integrated in `score_content_quality()` for relevance check
   - Validate output is numeric 0.0-1.0, default to 0.0 on error

3. Testing & Validation
   - Test with known-similar texts (e.g., "Fix auth bug" vs "Resolve login issue")
   - Test with known-dissimilar texts (e.g., "Fix bug" vs "Add feature")
   - Validate consistency across multiple invocations

**Success Criteria:**
- Semantic similarity returns valid scores 0.0-1.0
- Similar texts score >0.7, dissimilar texts score <0.3
- Judge model cost stays under budget (~$5-10 for full benchmark)

**Estimated Effort:** 2-3 hours

---

### Phase 5: HTML Dashboard

**Objective:** Create interactive visualization of benchmark results

**Deliverables:**
1. `benchmark/templates/dashboard.html` - Jinja2 template
   - Bootstrap CSS for styling
   - DataTables.js for sortable tables
   - Chart.js for visualizations

2. Dashboard Sections:
   - **Executive Summary**: Top 3 models by category (speed, cost, quality)
   - **Latency Charts**: Bar chart of avg latency by model
   - **Score Heatmap**: Model × Score dimension heatmap
   - **Model Comparison Table**: Sortable table with all metrics
   - **Cost Analysis**: Cost per 1000 ops, monthly estimates
   - **Detailed Results**: Expandable rows with per-transcript breakdowns

3. Interactive Features:
   - Sort tables by any column
   - Filter models by provider
   - Hover tooltips on charts
   - Expand/collapse detailed results

4. Example Layout:
   ```
   ┌─────────────────────────────────────────────────────┐
   │ LLM Benchmark Results - 2025-10-27                  │
   ├─────────────────────────────────────────────────────┤
   │ EXECUTIVE SUMMARY                                   │
   │ 🏆 Fastest: gemma-3n-e4b-it (2.1s avg)            │
   │ 💰 Cheapest: gemma-3n-e4b-it ($0.12 / 1000 ops)   │
   │ ⭐ Highest Quality: gpt-5-chat (87.3 overall)      │
   ├─────────────────────────────────────────────────────┤
   │ LATENCY COMPARISON                                  │
   │ [Bar Chart: Model vs. Avg Latency]                 │
   ├─────────────────────────────────────────────────────┤
   │ SCORE HEATMAP                                       │
   │ [Heatmap: Model × Score Dimension]                 │
   ├─────────────────────────────────────────────────────┤
   │ MODEL COMPARISON                                    │
   │ [Sortable Table: Model | Schema | Accuracy |       │
   │  Content | Overall | Latency | Cost]               │
   └─────────────────────────────────────────────────────┘
   ```

**Success Criteria:**
- HTML renders correctly in modern browsers
- Tables are sortable and filterable
- Charts are legible and informative
- Dashboard is self-contained (no external dependencies)

**Estimated Effort:** 3-4 hours

---

### Phase 6: Markdown & JSON Reports

**Objective:** Generate additional output formats

**Deliverables:**
1. `benchmark/templates/report.md.j2` - Markdown template
   ```markdown
   # LLM Benchmark Results

   **Generated:** {{ timestamp }}
   **Test Cases:** {{ test_count }}
   **Models Tested:** {{ model_count }}

   ## Executive Summary

   | Category | Winner | Score/Metric |
   |----------|--------|--------------|
   | Fastest | {{ fastest.model }} | {{ fastest.latency_avg }}s |
   | Cheapest | {{ cheapest.model }} | ${{ cheapest.cost_per_1k }} |
   | Highest Quality | {{ best_quality.model }} | {{ best_quality.score }} |

   ## Leaderboard

   ### By Overall Score

   | Rank | Model | Overall | Schema | Accuracy | Content | Latency |
   |------|-------|---------|--------|----------|---------|---------|
   {% for model in leaderboard_overall %}
   | {{ loop.index }} | {{ model.name }} | {{ model.overall }} | ... |
   {% endfor %}

   ### By Latency (Fastest)

   ...

   ### By Cost (Cheapest)

   ...

   ## Detailed Results

   {% for model in models %}
   ### {{ model.name }} ({{ model.provider }})

   - **Overall Score:** {{ model.scores.overall }}
   - **Schema Compliance:** {{ model.scores.schema }}
   - **Technical Accuracy:** {{ model.scores.accuracy }}
   - **Content Quality:** {{ model.scores.content }}
   - **Latency:** {{ model.latency.avg }}s (min: {{ model.latency.min }}s, max: {{ model.latency.max }}s)
   - **Cost per 1000 ops:** ${{ model.cost_per_1k }}

   {% endfor %}
   ```

2. JSON Export (`results/{timestamp}/results.json`)
   ```json
   {
     "metadata": {
       "generated_at": "2025-10-27T10:00:00Z",
       "test_count": 30,
       "model_count": 15,
       "version": "1.0.0"
     },
     "models": [
       {
         "name": "gemma-3-12b-it",
         "provider": "openrouter",
         "scores": {
           "overall": 85.3,
           "schema": 98.0,
           "accuracy": 82.1,
           "content": 76.5
         },
         "latency": {
           "min": 1.8,
           "avg": 2.3,
           "max": 3.1,
           "p95": 2.9
         },
         "cost_per_1k": 0.15,
         "test_results": [...]
       }
     ],
     "leaderboards": {...},
     "raw_results": [...]
   }
   ```

**Success Criteria:**
- Markdown is readable in terminal and GitHub
- JSON is valid and parseable
- All key metrics are present in both formats

**Estimated Effort:** 2-3 hours

---

### Phase 7: Cost Analysis & Documentation

**Objective:** Complete cost tracking and write usage documentation

**Deliverables:**
1. Cost Calculation in `benchmark/models.py`
   ```python
   def calculate_cost(input_tokens: int, output_tokens: int,
                      pricing: dict) -> float:
       """Calculate cost in USD per API call"""
       input_cost = (input_tokens / 1_000_000) * pricing["input"]
       output_cost = (output_tokens / 1_000_000) * pricing["output"]
       return input_cost + output_cost
   ```

2. Token Estimation
   - Use `tiktoken` or similar for rough estimates
   - Track actual token usage from API responses where available

3. Cost Analysis Section in Reports
   - Cost per operation (single topic extraction or resume)
   - Cost per 1000 operations
   - Monthly cost estimates (assuming 10k/50k/100k ops)
   - Total benchmark cost

4. Documentation: `benchmark/README.md`
   ```markdown
   # LLM Benchmarking System

   ## Quick Start

   ### 1. Collect Test Data
   ...

   ### 2. Generate References
   ...

   ### 3. Run Benchmarks
   ...

   ### 4. View Reports
   ...

   ## Architecture
   ...

   ## Scoring Methodology
   ...

   ## Interpreting Results
   ...

   ## Adding New Models
   ...
   ```

**Success Criteria:**
- Cost calculations match pricing documentation
- README provides clear usage instructions
- New team members can run benchmarks without assistance

**Estimated Effort:** 2-3 hours

---

### Phase 8: Polish & Validation

**Objective:** Test end-to-end, fix bugs, optimize

**Deliverables:**
1. End-to-end test run
   - Collect fresh test data
   - Generate references
   - Run full benchmark suite
   - Verify all reports generate correctly

2. Edge Case Handling
   - Empty transcripts
   - Malformed JSON from models
   - API rate limits and timeouts
   - Missing reference data

3. Performance Optimization
   - Parallel model execution where possible
   - Caching of embeddings for semantic similarity
   - Progress bars for long-running operations

4. Code Quality
   - Type hints throughout
   - Docstrings on all public functions
   - Basic unit tests for scoring functions
   - Format with `black`, lint with `ruff`

**Success Criteria:**
- No crashes on valid inputs
- Graceful degradation on errors
- Performance acceptable (full run < 30 min for 30 transcripts × 15 models)
- Code passes linting

**Estimated Effort:** 3-4 hours

---

## Test Data Strategy

### Diversity Requirements

**Length Categories:**
- **Short** (<50 lines): Quick questions, simple tasks
  - Example: "Fix this syntax error"
  - Goal: Test responsiveness to minimal context
- **Medium** (50-150 lines): Typical debugging or feature work
  - Example: Multi-step debugging session
  - Goal: Test handling of moderate conversation flow
- **Long** (>150 lines): Complex implementation or investigation
  - Example: Full feature implementation with multiple files
  - Goal: Test robustness with extensive context

**Intent Categories:**
- **development**: Writing new code, implementing features
- **debugging**: Investigating and fixing bugs
- **research**: Exploring codebase, understanding architecture
- **planning**: Designing solutions, creating task lists
- **conversation**: Q&A, discussions, clarifications
- **unclear**: Vague or meandering conversations

**Target Distribution:**
- 30% short, 40% medium, 30% long
- At least 3 examples per intent category
- Mix of high-clarity (score 8+) and low-clarity (score 4-) sessions

### Collection Process

**Script Flow (`scripts/collect-test-data.sh`):**
```bash
#!/bin/bash
# Interactive test data collection

SESSIONS_DIR="$HOME/.claude/sessions"
OUTPUT_DIR="test-data/transcripts"

echo "Scanning Claude sessions..."
for session_dir in "$SESSIONS_DIR"/*; do
    transcript="$session_dir/transcript.jsonl"
    [ -f "$transcript" ] || continue

    # Display stats
    lines=$(wc -l < "$transcript")
    topic=$(jq -r '.initial_goal // "unknown"' "$session_dir/topic.json" 2>/dev/null)

    echo ""
    echo "Session: $(basename "$session_dir")"
    echo "Lines: $lines"
    echo "Goal: $topic"

    # Prompt user
    read -p "Include this transcript? [y/N] " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        # Copy and add to metadata
        ...
    fi
done
```

**Manual Review:**
- User inspects each transcript before inclusion
- Ensures no sensitive data (API keys, personal info)
- Verifies transcript is representative of real usage

### Golden Test Set

A core set of 5-10 critical test cases that represent the most important scenarios:

**Purpose:**
- Quick smoke testing during development (`--mode smoke` always uses golden set)
- Regression detection (all models must pass golden set)
- Baseline for "must work" scenarios

**Golden Set Composition:**
1. **Edge Case: Minimal Context** (short, <20 lines)
   - Tests model's ability to extract meaning from minimal conversation
   - Example: Quick one-off question like "What's the syntax for X?"

2. **Common Case: Simple Debugging** (medium, 50-80 lines)
   - Most frequent use case in real Sidekick usage
   - Example: User asks for help fixing a bug, iterates with assistant

3. **Complex Case: Feature Implementation** (long, 150-200 lines)
   - Stress test for handling extensive context
   - Example: Multi-file feature with planning, implementation, testing

4. **High Clarity Session** (clarity score 9-10)
   - User with clear, specific requirements
   - Tests model's ability to extract precise goals

5. **Low Clarity Session** (clarity score 2-4)
   - Vague, meandering conversation
   - Tests model's ability to detect and report low clarity

6. **Edge Case: Empty/Malformed** (synthetic)
   - Tests graceful degradation
   - Example: Empty transcript, truncated JSON, missing fields

**Requirement:** Production-ready models must achieve:
- 100% valid JSON on golden set
- ≥80% average accuracy score on golden set
- No timeouts on golden set

### Dataset Versioning

To ensure reproducibility and fair comparison across benchmark runs:

**Checksum Tracking:**
```json
{
  "dataset_version": "1.0",
  "generated_at": "2025-10-27T10:00:00Z",
  "transcripts": [
    {
      "id": "short-simple-001",
      "file": "db7aa76a-3bb9-4f41-80f5-0f25d2aafb84.jsonl",
      "sha256": "a3f8b2c9d1e4f6a7b8c9d0e1f2a3b4c5...",
      "is_golden": true
    }
  ]
}
```

**Version Management:**
- Each test data collection generates a new dataset version
- Benchmark results include dataset version in metadata
- Comparisons only valid between runs on same dataset version
- Warning displayed if comparing results across different datasets

**Commands:**
```bash
# Verify dataset integrity before run
python -m benchmark.main verify-dataset

# Compare two benchmark runs (checks dataset versions match)
python -m benchmark.main compare \
    results/2025-10-27_100000/results.json \
    results/2025-10-28_143000/results.json
```

---

## Scoring Methodology

### Detailed Breakdown

#### Schema Compliance (30% weight)

**Philosophy:** Valid JSON structure is prerequisite for any analysis

**Components:**
1. **JSON Parsability** (30/100 pts): Can the output be parsed as JSON?
2. **Required Fields** (30/100 pts): Are all mandatory fields present?
   - Partial credit: `(present_fields / required_fields) * 30`
3. **Type Correctness** (20/100 pts): Do fields have correct types?
   - Check: `clarity_score` is int, `confidence` is float, etc.
4. **Value Ranges** (20/100 pts): Are values within valid bounds?
   - Check: `clarity_score` in 1-10, `confidence` in 0.0-1.0

**Interpretation:**
- **90-100**: Production-ready JSON output
- **70-89**: Mostly valid, occasional type issues
- **50-69**: Frequent structural problems
- **<50**: Unreliable JSON generation

#### Technical Accuracy (50% weight)

**Philosophy:** Model must extract correct information from transcript

**Components:**
1. **task_ids Match** (15/100 pts): Exact match of task ID set
   - Binary: either correct or not
2. **initial_goal Similarity** (20/100 pts): Semantic similarity to reference
   - Use sentence-transformers cosine similarity (0.0-1.0)
   - Multiply by 20 for score
3. **current_objective Similarity** (20/100 pts): Same as initial_goal
4. **intent_category Match** (15/100 pts): Exact category match
   - Binary: either correct or not
5. **clarity_score Proximity** (15/100 pts): Within ±1 of reference
   - Full credit if within 1, zero otherwise
6. **significant_change Match** (15/100 pts): Boolean agreement
   - Binary: either correct or not

**Interpretation:**
- **80-100**: Highly accurate analysis
- **60-79**: Generally accurate, some misinterpretations
- **40-59**: Frequent errors in key fields
- **<40**: Poor understanding of transcript

#### Content Quality (20% weight)

**Philosophy:** Accurate, relevant commentary that reflects conversation content

**Components:**
1. **Presence** (20/100 pts): Non-empty snarky comment in appropriate field
2. **Length Compliance** (20/100 pts): Within 20-120 character bounds
3. **Relevance** (60/100 pts): Semantic similarity to transcript content
   - Embed both comment and transcript excerpt
   - Compute cosine similarity
   - Multiply by 60 for score
   - **Note:** Style/tone preferences (e.g., SciFi references) are configurable
     and should not be baked into scoring. Focus on semantic accuracy: does
     the comment accurately reflect the conversation content?

**Interpretation:**
- **80-100**: Highly relevant, accurately reflects conversation
- **60-79**: Adequate relevance, generally on-topic
- **40-59**: Present but weak connection to transcript
- **<40**: Missing, irrelevant, or inaccurate

---

## Reporting & Visualization

### Report Structure

#### HTML Dashboard

**Page Layout:**
```
┌────────────────────────────────────────────────┐
│ Header                                         │
│ - Title, timestamp, test summary               │
├────────────────────────────────────────────────┤
│ Executive Summary (Cards)                      │
│ ┌──────┐ ┌──────┐ ┌──────┐                    │
│ │ 🏆   │ │ 💰   │ │ ⭐   │                    │
│ │ Fast │ │ Cheap│ │ Best │                    │
│ └──────┘ └──────┘ └──────┘                    │
├────────────────────────────────────────────────┤
│ Visualizations                                 │
│ ┌─────────────────┐ ┌─────────────────┐       │
│ │ Latency Chart   │ │ Score Heatmap   │       │
│ │ (Bar)           │ │ (Color Grid)    │       │
│ └─────────────────┘ └─────────────────┘       │
├────────────────────────────────────────────────┤
│ Model Comparison Table (Sortable)             │
│ | Model | Provider | Overall | ... | Cost |   │
│ |-------|----------|---------|-----|------|   │
│ | ...   | ...      | ...     | ... | ...  |   │
├────────────────────────────────────────────────┤
│ Detailed Results (Expandable Rows)            │
│ ▼ gemma-3-12b-it                              │
│   Per-transcript scores, error logs, ...      │
└────────────────────────────────────────────────┘
```

**JavaScript Libraries:**
- Bootstrap 5 (layout, styling)
- DataTables (sortable tables)
- Chart.js (bar charts, heatmaps)

#### Markdown Report

**Structure:**
1. Metadata (timestamp, counts)
2. Executive summary (top models)
3. Leaderboards (by overall, latency, cost)
4. Detailed per-model results
5. Methodology appendix

**Formatting:**
- Tables for tabular data
- Code blocks for JSON examples
- Emoji for visual interest (🏆, 💰, ⭐)

#### JSON Export

**Use Cases:**
- Import into BI tools (Tableau, Looker)
- Programmatic analysis (Python, R)
- Archival for historical comparison
- CI/CD integration

**Schema:**
```json
{
  "metadata": { "generated_at", "version", "test_count", ... },
  "models": [ { "name", "provider", "scores", "latency", ... } ],
  "leaderboards": { "overall", "latency", "cost" },
  "raw_results": [ { "model", "test_id", "output", "scores" } ]
}
```

---

## Cost Management

### Budget Planning

**Reference Generation:**
- 3 models × 30 transcripts × 2 prompts (topic + resume) = 180 API calls
- Estimated cost: $0.30-0.50 per call for high-quality models
- **Total: ~$54-90** (one-time cost)

**Benchmark Execution:**
- 15 models × 30 transcripts × 2 prompts × 3 runs = 2700 API calls
- Mix of cheap ($0.01/call) and expensive ($0.30/call) models
- **Estimated: $100-300 per full run**

**Optimization Strategies:**
1. **Reference Caching**: Generate once, reuse across runs
2. **Selective Testing**: Test only changed models
3. **Sampling**: Use subset of transcripts for quick validation
4. **Rate Limit Awareness**: Batch requests to avoid overages

### Cost Tracking

**Per-Call Tracking:**
```python
@dataclass
class APICall:
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    cost_usd: float
```

**Aggregate Reporting:**
- Total cost per model
- Cost per test case
- Cost per dimension (topic extraction vs. resume)
- Comparison to budget

---

## Future Enhancements

### Short-Term (Next 1-2 Months)

1. **Regression Testing**: Compare benchmark runs to detect degradation
2. **Custom Models**: Add support for locally-hosted models (Ollama, etc.)
3. **Prompt Variants**: Test different prompt templates
4. **Streaming Support**: Measure time-to-first-token for streaming responses

### Medium-Term (3-6 Months)

5. **A/B Testing**: Compare model versions (e.g., GPT-5 vs. GPT-5.1)
6. **User Feedback**: Collect ratings from Sidekick users, correlate with scores
7. **Automated Benchmarking**: Weekly CI job to test new models
8. **Cost Optimization**: Automatically select cheapest model meeting quality threshold

### Long-Term (6+ Months)

9. **Multi-Language**: Extend to non-English transcripts
10. **Fine-Tuning**: Use benchmark data to fine-tune smaller models
11. **Adaptive Selection**: Runtime model selection based on transcript characteristics
12. **Production Monitoring**: Track model performance in live Sidekick usage

---

## Appendix: File Structure

```
scripts/benchmark/
├── config.sh                  # Model definitions, thresholds, configuration
├── generate-reference.sh      # Reference generation orchestrator
├── run-benchmark.sh           # Benchmark execution orchestrator
├── generate-reports.sh        # Report generation (HTML, MD, JSON)
├── lib/
│   ├── common.sh             # Shared utilities, logging
│   ├── similarity.sh         # LLM-as-judge semantic similarity
│   ├── consensus.sh          # Consensus algorithms (voting, averaging)
│   ├── scoring.sh            # Schema, accuracy, content quality scoring
│   ├── llm-wrapper.sh        # Wrapper around src/sidekick/lib/llm.sh
│   └── reporting.sh          # Report generation helpers
├── templates/
│   ├── dashboard.html        # HTML template (heredoc-based)
│   └── report.md             # Markdown template (heredoc-based)
└── README.md                  # Usage documentation

scripts/
└── collect-test-data.sh       # Interactive transcript collection (existing)

test-data/
├── transcripts/               # Curated test transcripts
│   ├── *.jsonl                # Transcript files
│   ├── metadata.json          # Test case metadata
│   └── golden-set.json        # Golden test set (15 transcripts)
├── references/                # Golden standard outputs
│   └── {test_id}/
│       ├── grok-4.json
│       ├── gemini-2.5-pro.json
│       ├── gpt-5-chat.json
│       └── consensus.json
└── results/                   # Benchmark run outputs
    └── YYYY-MM-DD_HHMMSS/
        ├── report.html
        ├── report.md
        ├── results.json
        └── raw/               # Per-model outputs
            └── {model}/
                └── {test_id}/
                    ├── topic_run1.json
                    ├── topic_run2.json
                    └── ...
```

---

## Dependencies

**System Requirements:**
```bash
# Bash 4.0+ (for associative arrays)
bash --version

# jq (JSON processing)
jq --version  # >= 1.6

# bc (floating point arithmetic)
bc --version

# Standard POSIX utilities (sort, uniq, grep, awk, sed)
```

**Sidekick Infrastructure:**
- `src/sidekick/lib/llm.sh` - LLM provider abstraction (already exists)
- OpenRouter API key (for reference models + judge model)
- OR other configured LLM providers (Claude CLI, OpenAI, GROQ)

**LLM Models Used:**
- **Reference Models**: `x-ai/grok-4`, `google/gemini-2.5-pro`, `openai/gpt-5-chat`
- **Judge Model**: `deepseek/deepseek-r1-distill-qwen-14b` (for semantic similarity)

**No Python required!**

---

## Success Metrics

**Quantitative:**
- ✅ All documented models tested (15+ models)
- ✅ ≥20 diverse test transcripts collected
- ✅ Reference generation cost <$100
- ✅ Full benchmark run completes in <30 minutes
- ✅ 100% of models scored (or fail gracefully)
- ✅ Reports generated in all 3 formats

**Qualitative:**
- ✅ Results are actionable (clear winner in each category)
- ✅ Scoring methodology is defensible and documented
- ✅ System is reusable (easy to add new models/tests)
- ✅ Reports are readable by non-technical stakeholders

---

## Timeline

| Phase | Deliverable | Estimated Hours | Dependencies |
|-------|-------------|-----------------|--------------|
| 1 | Test data collection | 1-2h | None |
| 1.5 | Golden test set curation | 1h | Phase 1 |
| 2 | Reference generation | 3-4h | Phase 1.5 |
| 3 | Benchmark runner + scoring + modes | 5-6h | Phase 2 |
| 4 | Content quality scoring | 2-3h | Phase 3 |
| 5 | HTML dashboard + baseline comparison | 4-5h | Phase 3 |
| 6 | Markdown/JSON reports | 2-3h | Phase 3 |
| 7 | Cost analysis + docs | 2-3h | Phases 3-6 |
| 8 | Polish & validation | 3-4h | All phases |
| **Total** | **Full system** | **23-32h** | - |

**Suggested Schedule:**
- Week 1: Phases 1-3 (foundation + core + tiered modes)
- Week 2: Phases 4-6 (scoring + reporting + baseline comparison)
- Week 3: Phases 7-8 (polish + validation)

**Key Additions from Feedback:**
- Golden test set curation (+1h)
- Tiered benchmark modes (+1h in Phase 3)
- Early termination logic (included in Phase 3)
- Production-ready criteria (included in Phase 3)
- Baseline comparison (+1h in Phase 5)
- Dataset versioning (included in Phase 1)

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| API rate limits | Benchmark fails mid-run | Medium | Implement retry with exponential backoff, batch requests |
| High reference cost | Budget overrun | Medium | Use smaller transcript samples, cache results |
| Semantic similarity inaccuracy | Poor scoring validity | Low | Manual validation of sample scores, adjust thresholds |
| Model timeout/errors | Incomplete results | High | Graceful error handling, mark as failed, continue |
| Token counting mismatch | Incorrect cost estimates | Low | Use provider-reported usage when available |

---

## Open Questions

1. **Consensus Algorithm:** Should we weight reference models differently (e.g., trust GPT-5 more than Gemini)?
   - **Decision:** Equal weighting initially, revisit if one model is clearly superior

2. **Semantic Similarity Threshold:** What cosine similarity score indicates "good enough" match?
   - **Decision:** >0.7 = good, 0.5-0.7 = acceptable, <0.5 = poor (tune empirically)

3. **Test Data Refresh:** How often should we update test transcripts?
   - **Decision:** Quarterly or when Sidekick prompt templates change significantly

4. **Model Version Tracking:** How to handle model updates (e.g., GPT-5 vs. GPT-5.1)?
   - **Decision:** Treat as separate models, benchmark both, compare results

---

## Updates & Revisions

### Version 1.2 (2025-10-28) - Bash-First Architecture

**Major Change:** Pivot from Python to pure Bash implementation

**Rationale:**
After discussion with user, determined Python adds unnecessary complexity and dependencies when bash+jq+existing LLM infrastructure can handle all requirements.

**Key Changes:**
1. **Language**: Python → Bash throughout all phases
2. **Semantic Similarity**: sentence-transformers → LLM-as-judge using `deepseek/deepseek-r1-distill-qwen-14b`
3. **Dependencies**: Removed ~2GB Python+PyTorch requirement, only need bash 4.0+, jq, bc
4. **Integration**: Direct reuse of `src/sidekick/lib/llm.sh` (no subprocess wrapper needed)
5. **File Structure**: `benchmark/*.py` → `scripts/benchmark/*.sh` with modular lib/ directory

**Benefits:**
- ✅ Zero new dependencies (uses existing infrastructure)
- ✅ Consistent with Sidekick codebase architecture
- ✅ LLM-as-judge cost: ~$5-10 per benchmark run (acceptable)
- ✅ Simpler maintenance and debugging
- ✅ Bash background jobs provide sufficient parallelism

**Trade-offs:**
- ⚠️ LLM-as-judge is non-deterministic (same inputs may vary slightly)
- ⚠️ Semantic similarity adds API cost vs. local embeddings (but minimal)

**Timeline Impact:**
- Unchanged: 23-32 hours (bash is comparable complexity to Python for this use case)

---

### Version 1.1 (2025-10-27) - Feedback Integration

**Changes Made Based on Opus 4.1 Feedback:**

✅ **Accepted & Implemented:**
1. **Tiered Benchmark Modes** - Added 4 modes (smoke/quick/full/statistical) for different speed/cost trade-offs
2. **Production-Ready Criteria** - Added pass/fail thresholds with clear badges in reports
3. **Early Termination** - Skip models after 3 consecutive failures to save API costs
4. **Baseline Comparison** - All results show Δ vs. current production default (`gemma-3-12b-it`)
5. **Golden Test Set** - 5-10 critical test cases for smoke testing and regression detection
6. **Dataset Versioning** - SHA256 checksums and version tracking for reproducibility
7. **Incremental Mode** - Test new models without full re-run via `--use-cached-references`
8. **Statistical Rigor** - Increased from 3 to 5 runs, added standard deviation (rejected bootstrap/p-values as overkill)

✅ **Modified & Implemented:**
9. **Content Quality Scoring** - Removed SciFi reference scoring (style is configurable), redistributed 20 pts to relevance (now 60 pts total). Focus on semantic accuracy, not style preferences.

❌ **Rejected:**
- **SciFi Reference Requirement** (Original Assessment) - Initially defended as documented requirement, but accepted user's override: style/tone will become configurable, so shouldn't be in core scoring
- **Bootstrap Sampling / P-Values** - Rejected as academic overkill for practical tool selection

**Rationale for SciFi Removal:**
While SciFi references are currently specified in prompts, the user correctly identified that style/tone preferences will become configurable in the future. Baking a temporary style requirement into scoring would make benchmarks invalid when configuration changes. The focus should be on permanent semantic accuracy, not transient style preferences.

**Timeline Impact:**
- Original estimate: 20-28 hours
- Updated estimate: 23-32 hours (+3-4 hours for enhancements)

---

## Conclusion

This benchmarking system will provide empirical, data-driven guidance for LLM model selection in Sidekick. By measuring latency, JSON quality, and analysis accuracy across all documented models, we'll be able to:

1. Set optimal defaults in `config.defaults`
2. Recommend models for different use cases (speed, cost, quality)
3. Identify unreliable models to avoid
4. Track model performance over time
5. Make informed decisions about new model adoption

The system is designed to be:
- **Repeatable**: Easy to re-run as new models emerge
- **Extensible**: Simple to add new models, prompts, or scoring dimensions
- **Transparent**: Clear methodology, open-source-friendly
- **Cost-Conscious**: Budget tracking, optimization strategies

**Next Steps:** Begin Phase 1 implementation.
