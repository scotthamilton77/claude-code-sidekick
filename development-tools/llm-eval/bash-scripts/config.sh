#!/bin/bash
# ==============================================================================
# BENCHMARK CONFIGURATION
# ==============================================================================
# Central configuration for LLM model benchmarking system
#
# This file defines:
# - Reference models for generating ground truth
# - Judge model for semantic similarity
# - Model definitions for benchmarking
# - Paths and thresholds
# ==============================================================================

set -euo pipefail

# ==============================================================================
# REFERENCE MODELS (for generating ground truth)
# ==============================================================================
# These high-quality models are used to generate consensus reference outputs
# that serve as the "golden standard" for scoring other models

REFERENCE_MODELS=(
    "openrouter:x-ai/grok-4"                        # Grok-4
    "openrouter:google/gemini-2.5-pro"              # Gemini 2.5 Pro
    "openrouter:openai/gpt-5-chat"                  # GPT-5 Chat
)

# ==============================================================================
# JUDGE MODEL (for semantic similarity scoring)
# ==============================================================================
# This model is used for LLM-as-judge semantic similarity comparisons
# IMPORTANT: Must not be one of the models being benchmarked (avoid circular logic)

JUDGE_MODEL="openrouter:deepseek/deepseek-r1-distill-qwen-14b"

# Fallback judge model for scoring when primary judge fails/times out
# This is ONLY used for semantic similarity scoring, not benchmark evaluation
# Leave empty to disable fallback
BENCHMARK_SCORING_MODEL_FALLBACK="openai-api:gpt-5-mini"

# ==============================================================================
# PATHS
# ==============================================================================

# Get project root (script is in scripts/benchmark/)
BENCHMARK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$BENCHMARK_ROOT/../.." && pwd)"

# Test data paths
GOLDEN_SET_FILE="${PROJECT_ROOT}/test-data/transcripts/golden-set.json"
METADATA_FILE="${PROJECT_ROOT}/test-data/transcripts/metadata.json"
TRANSCRIPTS_DIR="${PROJECT_ROOT}/test-data/transcripts"

# References output directory (versioned)
# Format: test-data/references/v{VERSION}_{TIMESTAMP}/
REFERENCES_DIR="${PROJECT_ROOT}/test-data/references"

# Reference version (semantic versioning)
# Update this when making significant prompt/schema changes:
# - MAJOR (v1.0 -> v2.0): Complete prompt rewrite, different schema
# - MINOR (v1.0 -> v1.1): Prompt tweaks, clarifications, field additions
# - PATCH (v1.0.0 -> v1.0.1): Typo fixes, formatting only
REFERENCE_VERSION="${REFERENCE_VERSION:-v1.0}"

# Results output directory
RESULTS_DIR="${PROJECT_ROOT}/test-data/results"

# Sidekick source directory (for prompts and schema)
# Note: This is in the repo root, not in development-tools/
SIDEKICK_SRC="${PROJECT_ROOT}/../src/sidekick"

# ==============================================================================
# BENCHMARK MODES
# ==============================================================================
# Different benchmark modes for different speed/cost/thoroughness trade-offs

declare -A BENCHMARK_MODE_SAMPLES=(
    [smoke]=3
    [quick]=10
    [full]="all"
    [statistical]="all"
)

declare -A BENCHMARK_MODE_RUNS=(
    [smoke]=1
    [quick]=3
    [full]=5
    [statistical]=10
)

declare -A BENCHMARK_MODE_MODELS=(
    [smoke]="cheapest,default"
    [quick]="cheap"
    [full]="all"
    [statistical]="all"
)

# ==============================================================================
# PRODUCTION-READY CRITERIA
# ==============================================================================

PRODUCTION_JSON_PARSE_RATE=0.95       # 95% valid JSON
PRODUCTION_MAX_LATENCY_P95=10.0       # 95th percentile < 10s
PRODUCTION_MIN_ACCURACY_SCORE=70      # Technical accuracy >= 70%
PRODUCTION_MAX_COST_PER_1K=1.00       # Cost < $1.00 per 1000 ops

# ==============================================================================
# BASELINE MODEL
# ==============================================================================
# Current production default for comparison

BASELINE_MODEL="google/gemma-3-12b-it"

# ==============================================================================
# SCORING WEIGHTS
# ==============================================================================

SCORE_WEIGHT_SCHEMA=0.30      # Schema compliance (30%)
SCORE_WEIGHT_ACCURACY=0.50    # Technical accuracy (50%)
SCORE_WEIGHT_CONTENT=0.20     # Content quality (20%)

# ==============================================================================
# EARLY TERMINATION RULES
# ==============================================================================

EARLY_TERM_JSON_FAILURES=3    # Skip model after 3 consecutive parse failures
EARLY_TERM_TIMEOUT_COUNT=3    # Skip model after 3 consecutive timeouts

# ==============================================================================
# LLM INVOCATION SETTINGS
# ==============================================================================
# Timeout configuration is now in src/sidekick/config.defaults:
#   LLM_TIMEOUT_SECONDS - Global default (30s)
#   LLM_BENCHMARK_TIMEOUT_SECONDS - Benchmark override (60s)
# Override in ~/.claude/hooks/sidekick/sidekick.conf or .sidekick/sidekick.conf

LLM_MAX_RETRIES=2             # Max retries on transient failures

# ==============================================================================
# BENCHMARK MODELS
# ==============================================================================
# Models to test, with provider, pricing, and tags
# Format: "provider:model_name|input_price|output_price|tags"
# Tags: cheap, expensive, fast, slow, default, baseline

# Models taken out of benchmark for now:
# 
# "openrouter:openai/gpt-oss-20b|0.03|0.14|cheap,slow" -- high latency, unreliable
# "openai-api:gpt-5-nano|0.05|0.40|" -- no good responses; API may not support features we're trying to use such as response_format
# "claude-cli:haiku|0.25|1.25|default,expensive"
# "claude-cli:sonnet|0.75|3.75|expensive"

BENCHMARK_MODELS=(
    # OpenRouter models
    "openrouter:google/gemma-3-12b-it|0.03|0.10|cheap,default,baseline"
    "openrouter:google/gemma-3-4b-it|0.02|0.07|cheap,fast"
    "openrouter:google/gemini-2.0-flash-lite-001|0.08|0.30|,fast"
    "openrouter:google/gemma-3-27b-it|0.09|0.16|"
)

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

# Check if config is loaded
config_is_loaded() {
    [[ -n "${REFERENCE_MODELS:-}" ]]
}

# Validate configuration
config_validate() {
    local errors=0

    # Check required files
    if [ ! -f "$GOLDEN_SET_FILE" ]; then
        echo "ERROR: Golden set file not found: $GOLDEN_SET_FILE" >&2
        ((errors++))
    fi

    if [ ! -f "$METADATA_FILE" ]; then
        echo "ERROR: Metadata file not found: $METADATA_FILE" >&2
        ((errors++))
    fi

    if [ ! -d "$SIDEKICK_SRC" ]; then
        echo "ERROR: Sidekick source directory not found: $SIDEKICK_SRC" >&2
        ((errors++))
    fi

    # Create output directories if needed
    mkdir -p "$REFERENCES_DIR"
    mkdir -p "$RESULTS_DIR"

    return $errors
}

# Get versioned reference directory path
# Returns: path like "test-data/references/v1.0_2025-10-28_141530"
get_versioned_reference_dir() {
    local timestamp=$(date +"%Y-%m-%d_%H%M%S")
    echo "${REFERENCES_DIR}/${REFERENCE_VERSION}_${timestamp}"
}

# Resolve timeout with cascading logic using sidekick config system
# Priority: LLM_BENCHMARK_TIMEOUT_SECONDS → LLM_TIMEOUT_SECONDS → 30 (hardcoded fallback)
_resolve_timeout() {
    # NOTE: config_load is now called in config_export (not here in subshell)
    # This function assumes config_get is available

    # Try benchmark-specific timeout first
    local timeout
    timeout=$(config_get "LLM_BENCHMARK_TIMEOUT_SECONDS")

    # Fall back to global timeout
    if [ -z "$timeout" ]; then
        timeout=$(config_get "LLM_TIMEOUT_SECONDS")
    fi

    # Final hardcoded fallback
    echo "${timeout:-30}"
}

# Export all configuration for subprocesses
config_export() {
    # Load sidekick config if not already loaded
    if ! command -v config_get &>/dev/null; then
        # shellcheck source=../../src/sidekick/lib/common.sh
        source "$SIDEKICK_SRC/lib/common.sh"
        config_load
    fi

    # Resolve final timeout value for benchmarks
    LLM_TIMEOUT_SECONDS=$(_resolve_timeout)

    export BENCHMARK_ROOT PROJECT_ROOT
    export GOLDEN_SET_FILE METADATA_FILE TRANSCRIPTS_DIR
    export REFERENCES_DIR RESULTS_DIR SIDEKICK_SRC
    export REFERENCE_VERSION
    export JUDGE_MODEL BENCHMARK_SCORING_MODEL_FALLBACK BASELINE_MODEL
    export PRODUCTION_JSON_PARSE_RATE PRODUCTION_MAX_LATENCY_P95
    export PRODUCTION_MIN_ACCURACY_SCORE PRODUCTION_MAX_COST_PER_1K
    export SCORE_WEIGHT_SCHEMA SCORE_WEIGHT_ACCURACY SCORE_WEIGHT_CONTENT
    export EARLY_TERM_JSON_FAILURES EARLY_TERM_TIMEOUT_COUNT
    export LLM_TIMEOUT_SECONDS LLM_MAX_RETRIES

    # Export LLM debug settings (loaded via config_load above)
    export LLM_DEBUG_DUMP_ENABLED CIRCUIT_BREAKER_ENABLED LLM_FALLBACK_PROVIDER
}

# ==============================================================================
# INITIALIZATION
# ==============================================================================

# Validate on load
if ! config_validate; then
    echo "ERROR: Configuration validation failed" >&2
    exit 1
fi

# Export configuration
config_export

echo "[CONFIG] Benchmark configuration loaded successfully" >&2
