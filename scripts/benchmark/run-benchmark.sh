#!/bin/bash
# ==============================================================================
# BENCHMARK RUNNER
# ==============================================================================
# Executes LLM models against test transcripts and measures performance
#
# Usage:
#   ./run-benchmark.sh [OPTIONS]
#
# Options:
#   --mode MODE          Benchmark mode: smoke|quick|full|statistical (default: quick)
#   --models MODELS      Models to test: all|cheap|expensive|MODEL1,MODEL2,... (default: all)
#   --reference-version  Reference version to use (default: latest)
#   --output-dir DIR     Output directory for results (default: test-data/results/TIMESTAMP)
#   --help               Show this help message
#
# Examples:
#   ./run-benchmark.sh --mode smoke
#   ./run-benchmark.sh --mode quick --models cheap
#   ./run-benchmark.sh --mode full --models "gemma-3-12b-it,gpt-5-nano"
# ==============================================================================

set -euo pipefail

# ==============================================================================
# SETUP
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source configuration and libraries
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/lib/preprocessing.sh"
source "$SCRIPT_DIR/lib/scoring.sh"

# Initialize Sidekick logging
export CLAUDE_PROJECT_DIR="$PROJECT_ROOT"
SIDEKICK_LIB="$PROJECT_ROOT/src/sidekick/lib"
source "$SIDEKICK_LIB/common.sh"
log_init

# ==============================================================================
# DEFAULT OPTIONS
# ==============================================================================

MODE="quick"
MODELS_FILTER="all"
REFERENCE_VERSION_FILTER="latest"
OUTPUT_DIR=""

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

show_help() {
    head -n 30 "$0" | grep "^#" | sed 's/^# \?//'
}

# ==============================================================================
# ARGUMENT PARSING
# ==============================================================================

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --models)
            MODELS_FILTER="$2"
            shift 2
            ;;
        --reference-version)
            REFERENCE_VERSION_FILTER="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# ==============================================================================
# VALIDATION
# ==============================================================================

# Validate mode
if [[ ! "${BENCHMARK_MODE_SAMPLES[$MODE]:-}" ]]; then
    log_error "Invalid mode: $MODE (valid: smoke, quick, full, statistical)"
    exit 1
fi

log_info "Starting benchmark in $MODE mode"
log_info "Models filter: $MODELS_FILTER"

# ==============================================================================
# SETUP OUTPUT DIRECTORY
# ==============================================================================

if [[ -z "$OUTPUT_DIR" ]]; then
    TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
    OUTPUT_DIR="${RESULTS_DIR}/${TIMESTAMP}"
fi

mkdir -p "$OUTPUT_DIR"
RAW_OUTPUT_DIR="$OUTPUT_DIR/raw"
mkdir -p "$RAW_OUTPUT_DIR"

log_info "Output directory: $OUTPUT_DIR"

# ==============================================================================
# LOAD REFERENCES
# ==============================================================================

log_info "Loading reference outputs..."

# Find reference directory
if [[ "$REFERENCE_VERSION_FILTER" == "latest" ]]; then
    REFERENCE_DIR=$(ls -1dt "$REFERENCES_DIR"/v* 2>/dev/null | head -1)
    if [[ -z "$REFERENCE_DIR" ]]; then
        log_error "No reference directory found in $REFERENCES_DIR"
        log_error "Run generate-reference.sh first to create references"
        exit 1
    fi
else
    # Find matching version
    REFERENCE_DIR=$(ls -1dt "$REFERENCES_DIR"/${REFERENCE_VERSION_FILTER}_* 2>/dev/null | head -1)
    if [[ -z "$REFERENCE_DIR" ]]; then
        log_error "No reference directory found for version: $REFERENCE_VERSION_FILTER"
        exit 1
    fi
fi

log_info "Using references from: $REFERENCE_DIR"

# ==============================================================================
# LOAD TEST TRANSCRIPTS
# ==============================================================================

log_info "Loading test transcripts..."

# Determine which transcripts to use based on mode
SAMPLE_COUNT="${BENCHMARK_MODE_SAMPLES[$MODE]}"
RUN_COUNT="${BENCHMARK_MODE_RUNS[$MODE]}"

# Load golden set
if [[ ! -f "$GOLDEN_SET_FILE" ]]; then
    log_error "Golden set file not found: $GOLDEN_SET_FILE"
    exit 1
fi

# Get transcript IDs from golden set
declare -a TRANSCRIPT_IDS
if [[ "$SAMPLE_COUNT" == "all" ]]; then
    # Load all transcripts from golden set
    mapfile -t TRANSCRIPT_IDS < <(jq -r '.golden_ids[]' "$GOLDEN_SET_FILE")
else
    # Load first N transcripts
    mapfile -t TRANSCRIPT_IDS < <(jq -r ".golden_ids[] | select(. != null)" "$GOLDEN_SET_FILE" | head -n "$SAMPLE_COUNT")
fi

log_info "Testing ${#TRANSCRIPT_IDS[@]} transcripts with $RUN_COUNT runs each"

# ==============================================================================
# LOAD MODELS
# ==============================================================================

log_info "Loading models to test..."

declare -a MODELS_TO_TEST=()

if [[ "$MODELS_FILTER" == "all" ]]; then
    # Test all models
    MODELS_TO_TEST=("${BENCHMARK_MODELS[@]}")
elif [[ "$MODELS_FILTER" == "cheap" ]]; then
    # Filter for cheap models
    for model_spec in "${BENCHMARK_MODELS[@]}"; do
        tags="${model_spec##*|}"
        if [[ "$tags" == *"cheap"* ]]; then
            MODELS_TO_TEST+=("$model_spec")
        fi
    done
elif [[ "$MODELS_FILTER" == "default" ]]; then
    # Filter for default models
    for model_spec in "${BENCHMARK_MODELS[@]}"; do
        tags="${model_spec##*|}"
        if [[ "$tags" == *"default"* ]]; then
            MODELS_TO_TEST+=("$model_spec")
        fi
    done
else
    # Comma-separated list of specific models
    IFS=',' read -ra MODEL_NAMES <<< "$MODELS_FILTER"
    for model_name in "${MODEL_NAMES[@]}"; do
        for model_spec in "${BENCHMARK_MODELS[@]}"; do
            provider_model="${model_spec%%|*}"
            model_only="${provider_model#*:}"
            # Match either full model name or short name (without namespace)
            model_short="${model_only##*/}"
            if [[ "$model_only" == "$model_name" || "$model_short" == "$model_name" ]]; then
                MODELS_TO_TEST+=("$model_spec")
                break
            fi
        done
    done
fi

if [[ ${#MODELS_TO_TEST[@]} -eq 0 ]]; then
    log_error "No models matched filter: $MODELS_FILTER"
    exit 1
fi

log_info "Testing ${#MODELS_TO_TEST[@]} models"

# ==============================================================================
# LOAD PROMPTS
# ==============================================================================

log_info "Loading prompts..."

TOPIC_PROMPT_FILE="$SIDEKICK_SRC/features/prompts/topic-only.txt"
TOPIC_SCHEMA_FILE="$SIDEKICK_SRC/features/prompts/topic-schema.json"

if [[ ! -f "$TOPIC_PROMPT_FILE" ]]; then
    log_error "Topic prompt not found: $TOPIC_PROMPT_FILE"
    exit 1
fi

if [[ ! -f "$TOPIC_SCHEMA_FILE" ]]; then
    log_error "Topic schema not found: $TOPIC_SCHEMA_FILE"
    exit 1
fi

TOPIC_PROMPT_TEMPLATE=$(cat "$TOPIC_PROMPT_FILE")
TOPIC_SCHEMA=$(cat "$TOPIC_SCHEMA_FILE")

# ==============================================================================
# BENCHMARK EXECUTION
# ==============================================================================

log_info "Starting benchmark execution..."

# Initialize results tracking
declare -A MODEL_RESULTS
declare -A MODEL_FAILURE_COUNTS

# Main benchmark loop
for model_spec in "${MODELS_TO_TEST[@]}"; do
    # Parse model specification
    IFS='|' read -r provider_model input_price output_price tags <<< "$model_spec"
    provider="${provider_model%%:*}"
    model="${provider_model#*:}"

    log_info "Testing model: $provider:$model"

    # Create model output directory
    MODEL_OUTPUT_DIR="$RAW_OUTPUT_DIR/${provider}_${model//\//_}"
    mkdir -p "$MODEL_OUTPUT_DIR"

    # Track failures for early termination
    consecutive_failures=0
    consecutive_timeouts=0
    model_terminated=false

    # Test each transcript
    for transcript_id in "${TRANSCRIPT_IDS[@]}"; do
        # Check for early termination
        if $model_terminated; then
            log_warn "Skipping remaining transcripts for $provider:$model (early termination)"
            break
        fi

        log_info "  Testing $transcript_id (run 1/$RUN_COUNT)"

        # Load transcript
        TRANSCRIPT_FILE="$TRANSCRIPTS_DIR/${transcript_id}.jsonl"
        if [[ ! -f "$TRANSCRIPT_FILE" ]]; then
            log_error "Transcript not found: $TRANSCRIPT_FILE"
            continue
        fi

        # Load reference
        REFERENCE_FILE="$REFERENCE_DIR/${transcript_id}/consensus.json"
        if [[ ! -f "$REFERENCE_FILE" ]]; then
            log_warn "Reference not found: $REFERENCE_FILE"
            continue
        fi

        REFERENCE=$(cat "$REFERENCE_FILE")

        # Preprocess transcript (same as Sidekick topic extraction)
        TRANSCRIPT=$(preprocess_transcript "$TRANSCRIPT_FILE")

        # Prepare prompt by substituting transcript
        PROMPT="${TOPIC_PROMPT_TEMPLATE//\{TRANSCRIPT\}/$TRANSCRIPT}"

        # Create test output directory
        TEST_OUTPUT_DIR="$MODEL_OUTPUT_DIR/$transcript_id"
        mkdir -p "$TEST_OUTPUT_DIR"

        # Run multiple iterations
        for ((run=1; run<=RUN_COUNT; run++)); do
            log_info "    Run $run/$RUN_COUNT..."

            # Output files for this run
            RAW_OUTPUT_FILE="$TEST_OUTPUT_DIR/run_${run}_raw.txt"
            OUTPUT_FILE="$TEST_OUTPUT_DIR/run_${run}.json"
            TIMING_FILE="$TEST_OUTPUT_DIR/run_${run}_timing.txt"
            ERROR_FILE="$TEST_OUTPUT_DIR/run_${run}_error.txt"
            SCORE_FILE="$TEST_OUTPUT_DIR/run_${run}_scores.json"

            # Measure latency and invoke model
            START_TIME=$(date +%s%N)

            if ! LLM_OUTPUT=$(llm_invoke_with_provider "$provider" "$model" "$PROMPT" "$LLM_TIMEOUT_SECONDS" "$TOPIC_SCHEMA" 2>"$ERROR_FILE"); then
                # Model invocation failed
                END_TIME=$(date +%s%N)
                LATENCY_MS=$(( (END_TIME - START_TIME) / 1000000 ))

                echo "$LATENCY_MS" > "$TIMING_FILE"

                # Save whatever output we got (if any)
                echo "$LLM_OUTPUT" > "$RAW_OUTPUT_FILE"
                echo '{"error": "LLM invocation failed"}' > "$OUTPUT_FILE"
                echo '{"schema_compliance": {"score": 0, "errors": ["LLM invocation failed"]}, "technical_accuracy": {"score": 0}, "content_quality": {"score": 0}, "overall_score": 0}' > "$SCORE_FILE"

                log_warn "    Run $run failed: LLM invocation error"
                consecutive_failures=$((consecutive_failures + 1))

                # Check for timeout
                if grep -q "timeout" "$ERROR_FILE" 2>/dev/null; then
                    consecutive_timeouts=$((consecutive_timeouts + 1))
                fi

                continue
            fi

            END_TIME=$(date +%s%N)
            LATENCY_MS=$(( (END_TIME - START_TIME) / 1000000 ))
            echo "$LATENCY_MS" > "$TIMING_FILE"

            # Save raw output BEFORE JSON extraction
            echo "$LLM_OUTPUT" > "$RAW_OUTPUT_FILE"

            # Extract JSON from output (handle markdown wrapping)
            # Capture both output and errors
            JSON_EXTRACT_ERRORS=$(mktemp)
            if ! JSON_OUTPUT=$(llm_extract_json "$LLM_OUTPUT" 2>"$JSON_EXTRACT_ERRORS"); then
                # JSON extraction failed, capture the error
                EXTRACT_ERROR=$(cat "$JSON_EXTRACT_ERRORS")
                rm -f "$JSON_EXTRACT_ERRORS"
                log_warn "    Run $run failed: JSON extraction error: $EXTRACT_ERROR"
                echo '{"schema_compliance": {"score": 0, "errors": ["JSON extraction failed: '"$EXTRACT_ERROR"'"]}, "technical_accuracy": {"score": 0}, "content_quality": {"score": 0}, "overall_score": 0}' > "$SCORE_FILE"
                consecutive_failures=$((consecutive_failures + 1))
                continue
            fi
            rm -f "$JSON_EXTRACT_ERRORS"

            # Save extracted JSON
            echo "$JSON_OUTPUT" > "$OUTPUT_FILE"

            # Validate JSON
            if ! echo "$JSON_OUTPUT" | jq empty 2>/dev/null; then
                log_warn "    Run $run failed: Invalid JSON output"
                echo '{"schema_compliance": {"score": 0, "errors": ["Invalid JSON"]}, "technical_accuracy": {"score": 0}, "content_quality": {"score": 0}, "overall_score": 0}' > "$SCORE_FILE"
                consecutive_failures=$((consecutive_failures + 1))
                continue
            fi

            # Success! Reset failure counters
            consecutive_failures=0
            consecutive_timeouts=0

            # Score the output
            log_info "    Scoring run $run..."
            SCORES=$(score_output "$JSON_OUTPUT" "$REFERENCE" "$TRANSCRIPT")
            echo "$SCORES" > "$SCORE_FILE"

            OVERALL_SCORE=$(echo "$SCORES" | jq -r '.overall_score')
            log_info "    Run $run complete: latency=${LATENCY_MS}ms, score=${OVERALL_SCORE}"
        done

        # Check for early termination after each transcript
        if ((consecutive_failures >= EARLY_TERM_JSON_FAILURES)); then
            log_warn "Model $provider:$model terminated: $consecutive_failures consecutive JSON failures"
            model_terminated=true
        elif ((consecutive_timeouts >= EARLY_TERM_TIMEOUT_COUNT)); then
            log_warn "Model $provider:$model terminated: $consecutive_timeouts consecutive timeouts"
            model_terminated=true
        fi
    done

    log_info "Completed testing $provider:$model"
done

# ==============================================================================
# GENERATE SUMMARY STATISTICS
# ==============================================================================

log_info "Generating summary statistics..."

# Create summary file
SUMMARY_FILE="$OUTPUT_DIR/summary.json"

# Build summary JSON
SUMMARY=$(cat <<EOF
{
  "benchmark_metadata": {
    "mode": "$MODE",
    "models_filter": "$MODELS_FILTER",
    "reference_version": "$(basename "$REFERENCE_DIR")",
    "transcript_count": ${#TRANSCRIPT_IDS[@]},
    "run_count": $RUN_COUNT,
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "output_dir": "$OUTPUT_DIR"
  },
  "models": []
}
EOF
)

# For each model, calculate statistics
for model_spec in "${MODELS_TO_TEST[@]}"; do
    IFS='|' read -r provider_model input_price output_price tags <<< "$model_spec"
    provider="${provider_model%%:*}"
    model="${provider_model#*:}"

    MODEL_OUTPUT_DIR="$RAW_OUTPUT_DIR/${provider}_${model//\//_}"

    # Calculate aggregate stats using jq
    LATENCIES=$(find "$MODEL_OUTPUT_DIR" -name "*_timing.txt" -exec cat {} \; 2>/dev/null || echo "")
    SCORES=$(find "$MODEL_OUTPUT_DIR" -name "*_scores.json" -exec cat {} \; 2>/dev/null | jq -s '.')

    if [[ -z "$LATENCIES" ]]; then
        log_warn "No results found for $provider:$model"
        continue
    fi

    # Calculate latency stats
    LATENCY_STATS=$(echo "$LATENCIES" | jq -Rs 'split("\n") | map(select(length > 0) | tonumber) | {
        min: min,
        max: max,
        avg: (add / length),
        count: length
    }')

    # Calculate score stats
    SCORE_STATS=$(echo "$SCORES" | jq '{
        schema_avg: (map(.schema_compliance.score) | add / length),
        technical_avg: (map(.technical_accuracy.score) | add / length),
        content_avg: (map(.content_quality.score) | add / length),
        overall_avg: (map(.overall_score) | add / length),
        count: length
    }')

    # Add model results to summary
    MODEL_SUMMARY=$(cat <<EOF
{
  "provider": "$provider",
  "model": "$model",
  "pricing": {
    "input_per_million": $input_price,
    "output_per_million": $output_price
  },
  "tags": "$tags",
  "latency": $LATENCY_STATS,
  "scores": $SCORE_STATS
}
EOF
)

    SUMMARY=$(echo "$SUMMARY" | jq ".models += [$MODEL_SUMMARY]")
done

# Save summary
echo "$SUMMARY" | jq . > "$SUMMARY_FILE"

log_info "Summary saved to: $SUMMARY_FILE"

# ==============================================================================
# COMPLETION
# ==============================================================================

log_info "Benchmark complete!"
log_info "Results directory: $OUTPUT_DIR"
log_info ""
log_info "Next steps:"
log_info "  1. Review summary: cat $SUMMARY_FILE"
log_info "  2. Generate reports: ./scripts/benchmark/generate-reports.sh $OUTPUT_DIR"
log_info ""

exit 0
