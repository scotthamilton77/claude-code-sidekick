#!/bin/bash
# ==============================================================================
# REFERENCE GENERATION
# ==============================================================================
# Generate high-quality reference outputs from premium models for benchmarking
#
# This script:
# 1. Loads golden test set transcripts
# 2. Invokes 3 reference models on each transcript
# 3. Computes consensus output using semantic similarity
# 4. Stores individual outputs and consensus with provenance
#
# Usage:
#   ./generate-reference.sh [--test-id ID] [--force]
#
# Options:
#   --test-id ID    Generate reference for single test (e.g., "short-001")
#   --force         Overwrite existing references
#   --dry-run       Show what would be generated without calling LLMs
#
# Output:
#   test-data/references/{test-id}/
#     ├── grok-beta.json
#     ├── gemini-2.0-flash-exp.json
#     ├── gpt-4o.json
#     └── consensus.json
# ==============================================================================

set -euo pipefail

# ==============================================================================
# INITIALIZATION
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source configuration and libraries
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/preprocessing.sh"
source "${SCRIPT_DIR}/lib/similarity.sh"
source "${SCRIPT_DIR}/lib/consensus.sh"

# ==============================================================================
# CLI ARGUMENT PARSING
# ==============================================================================

FORCE_REGENERATE=false
DRY_RUN=false
SINGLE_TEST_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force)
            FORCE_REGENERATE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --test-id)
            SINGLE_TEST_ID="$2"
            shift 2
            ;;
        --help|-h)
            head -n 30 "$0" | grep '^#' | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
    esac
done

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

# Create versioned reference directory with prompt snapshots and metadata
create_versioned_reference_dir() {
    local output_dir="$1"
    local description="${2:-Reference generation for golden test set}"

    echo "[SNAPSHOT] Creating versioned reference directory: $output_dir"

    # Create directory structure
    mkdir -p "$output_dir/_prompt-snapshot"

    # Snapshot prompt files
    local prompt_file="${SIDEKICK_SRC}/features/prompts/topic-only.txt"
    local schema_file="${SIDEKICK_SRC}/features/prompts/topic-schema.json"

    if [ -f "$prompt_file" ]; then
        cp "$prompt_file" "$output_dir/_prompt-snapshot/"
        echo "  Snapshotted: topic-only.txt"
    else
        echo "  WARN: Prompt file not found: $prompt_file" >&2
    fi

    if [ -f "$schema_file" ]; then
        cp "$schema_file" "$output_dir/_prompt-snapshot/"
        echo "  Snapshotted: topic-schema.json"
    else
        echo "  WARN: Schema file not found: $schema_file" >&2
    fi

    # Create config snapshot
    cat > "$output_dir/_prompt-snapshot/config-snapshot.sh" <<EOF
# Configuration snapshot for reference generation
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

REFERENCE_VERSION="$REFERENCE_VERSION"
LLM_TIMEOUT_SECONDS=$LLM_TIMEOUT_SECONDS
TOPIC_EXCERPT_LINES=${TOPIC_EXCERPT_LINES:-80}
TOPIC_FILTER_TOOL_MESSAGES=${TOPIC_FILTER_TOOL_MESSAGES:-true}

# Reference models
REFERENCE_MODELS=(
$(for model in "${REFERENCE_MODELS[@]}"; do echo "    \"$model\""; done)
)

# Judge model
JUDGE_MODEL="$JUDGE_MODEL"
EOF
    echo "  Snapshotted: config-snapshot.sh"

    # Compute checksums
    local prompt_sha256=$(sha256sum "$output_dir/_prompt-snapshot/topic-only.txt" 2>/dev/null | cut -d' ' -f1 || echo "")
    local schema_sha256=$(sha256sum "$output_dir/_prompt-snapshot/topic-schema.json" 2>/dev/null | cut -d' ' -f1 || echo "")
    local golden_sha256=$(sha256sum "$GOLDEN_SET_FILE" 2>/dev/null | cut -d' ' -f1 || echo "")

    # Get test count
    local test_count=$(jq -r '.total_count // .golden_ids | length' "$GOLDEN_SET_FILE")
    local dataset_version=$(jq -r '.dataset_version // "unknown"' "$METADATA_FILE")

    # Create metadata
    jq -n \
        --arg ref_version "$REFERENCE_VERSION" \
        --arg description "$description" \
        --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --arg dataset_version "$dataset_version" \
        --arg golden_sha256 "$golden_sha256" \
        --argjson test_count "$test_count" \
        --argjson ref_models "$(printf '%s\n' "${REFERENCE_MODELS[@]}" | jq -R . | jq -s .)" \
        --arg judge_model "$JUDGE_MODEL" \
        --arg prompt_file "topic-only.txt" \
        --arg prompt_sha256 "$prompt_sha256" \
        --arg schema_file "topic-schema.json" \
        --arg schema_sha256 "$schema_sha256" \
        --argjson excerpt_lines "${TOPIC_EXCERPT_LINES:-80}" \
        --arg filter_tools "${TOPIC_FILTER_TOOL_MESSAGES:-true}" \
        --argjson timeout "$LLM_TIMEOUT_SECONDS" \
        '{
            reference_version: $ref_version,
            description: $description,
            generated_at: $generated_at,
            dataset: {
                version: $dataset_version,
                golden_set_sha256: $golden_sha256,
                test_count: $test_count
            },
            models: {
                references: $ref_models,
                judge: $judge_model
            },
            prompts: {
                topic_template: $prompt_file,
                topic_template_sha256: $prompt_sha256,
                schema: $schema_file,
                schema_sha256: $schema_sha256
            },
            config: {
                excerpt_lines: $excerpt_lines,
                filter_tool_messages: ($filter_tools == "true"),
                timeout_seconds: $timeout
            }
        }' > "$output_dir/_metadata.json"

    echo "  Created: _metadata.json"
    echo "[SNAPSHOT] Versioned reference directory ready"
}


# Extract transcript excerpt for analysis (delegates to shared preprocessing)
extract_transcript_excerpt() {
    local transcript_file="$1"
    # Use shared preprocessing function from lib/preprocessing.sh
    preprocess_transcript "$transcript_file"
}

# Build prompt from transcript excerpt
build_prompt() {
    local transcript_json="$1"
    local prompt_template="${SIDEKICK_SRC}/features/prompts/topic-only.txt"

    if [ ! -f "$prompt_template" ]; then
        echo "ERROR: Prompt template not found: $prompt_template" >&2
        return 1
    fi

    local prompt
    prompt=$(cat "$prompt_template")

    # No previous topic for reference generation
    prompt="${prompt//\{PREVIOUS_TOPIC\}/}"
    prompt="${prompt//\{TRANSCRIPT\}/$transcript_json}"

    echo "$prompt"
}

# Invoke a reference model
invoke_reference_model() {
    local model_spec="$1"
    local prompt="$2"
    local test_id="$3"

    # Parse model spec (format: "provider:model")
    local provider="${model_spec%%:*}"
    local model="${model_spec#*:}"

    echo "[INVOKE] Calling $provider:$model for test $test_id..." >&2

    # Load JSON schema
    local schema_file="${SIDEKICK_SRC}/features/prompts/topic-schema.json"
    local json_schema=""

    if [ -f "$schema_file" ]; then
        json_schema=$(cat "$schema_file")
    else
        echo "WARN: Schema file not found: $schema_file" >&2
    fi

    # Invoke LLM
    local output
    local start_time=$(date +%s)

    if ! output=$(llm_invoke_with_provider "$provider" "$model" "$prompt" "$LLM_TIMEOUT_SECONDS" "$json_schema" 2>&1); then
        local end_time=$(date +%s)
        local latency=$((end_time - start_time))

        echo "ERROR: LLM invocation failed for $model_spec" >&2
        echo "{\"error\": \"LLM invocation failed\", \"latency_seconds\": $latency}" >&2
        return 1
    fi

    local end_time=$(date +%s)
    local latency=$((end_time - start_time))

    # Extract JSON from output (handle markdown wrapping)
    local json_output
    json_output=$(llm_extract_json "$output")

    # Validate JSON
    if ! echo "$json_output" | jq empty 2>/dev/null; then
        echo "ERROR: Invalid JSON from $model_spec" >&2
        echo "{\"error\": \"Invalid JSON\", \"latency_seconds\": $latency, \"raw_output\": \"$output\"}"
        return 1
    fi

    # Add metadata
    json_output=$(echo "$json_output" | jq \
        --arg model "$model_spec" \
        --arg test_id "$test_id" \
        --argjson latency "$latency" \
        --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        '. + {
            _metadata: {
                model: $model,
                test_id: $test_id,
                latency_seconds: $latency,
                generated_at: $timestamp
            }
        }')

    echo "$json_output"
    return 0
}

# Generate reference for a single test
generate_reference_for_test() {
    local test_id="$1"
    local versioned_dir="$2"
    local transcript_file="${TRANSCRIPTS_DIR}/${test_id}.jsonl"

    echo ""
    echo "========================================"
    echo "Generating reference for: $test_id"
    echo "========================================"

    # Check if transcript exists
    if [ ! -f "$transcript_file" ]; then
        echo "ERROR: Transcript not found: $transcript_file" >&2
        return 1
    fi

    # Create output directory under versioned dir
    local output_dir="${versioned_dir}/${test_id}"
    mkdir -p "$output_dir"

    # Check if already exists
    if [ -f "${output_dir}/consensus.json" ] && [ "$FORCE_REGENERATE" != "true" ]; then
        echo "SKIP: Reference already exists for $test_id (use --force to regenerate)"
        return 0
    fi

    # Extract transcript excerpt
    echo "[EXTRACT] Extracting transcript excerpt..."
    local transcript_excerpt
    if ! transcript_excerpt=$(extract_transcript_excerpt "$transcript_file"); then
        echo "ERROR: Failed to extract transcript excerpt" >&2
        return 1
    fi

    # Build prompt
    echo "[PROMPT] Building prompt..."
    local prompt
    if ! prompt=$(build_prompt "$transcript_excerpt"); then
        echo "ERROR: Failed to build prompt" >&2
        return 1
    fi

    if [ "$DRY_RUN" = "true" ]; then
        echo "[DRY-RUN] Would generate references using ${#REFERENCE_MODELS[@]} models"
        return 0
    fi

    # Invoke reference models
    local outputs=()
    local model_names=()
    local failed_count=0

    for model_spec in "${REFERENCE_MODELS[@]}"; do
        # Get safe filename (remove special chars)
        local model_name="${model_spec#*:}"
        model_name="${model_name//\//-}"
        model_names+=("$model_name")

        local output_file="${output_dir}/${model_name}.json"

        echo ""
        echo "Invoking reference model: $model_spec"

        if ! model_output=$(invoke_reference_model "$model_spec" "$prompt" "$test_id"); then
            echo "ERROR: Failed to get output from $model_spec" >&2
            ((failed_count++))
            outputs+=("")
            continue
        fi

        # Save individual output
        echo "$model_output" > "$output_file"
        echo "Saved: $output_file"

        outputs+=("$model_output")
    done

    # Check if we have enough outputs for consensus
    local success_count=$((${#REFERENCE_MODELS[@]} - failed_count))
    if [ $success_count -lt 2 ]; then
        echo "ERROR: Need at least 2 successful model outputs for consensus (got $success_count)" >&2
        return 1
    fi

    # Generate consensus
    echo ""
    echo "[CONSENSUS] Computing consensus from $success_count model outputs..."

    local consensus_output
    if [ $success_count -eq 3 ]; then
        # All 3 models succeeded
        consensus_output=$(consensus_merge "${outputs[0]}" "${outputs[1]}" "${outputs[2]}")
    elif [ $success_count -eq 2 ]; then
        # Only 2 models succeeded - use the two that worked
        local output1="" output2=""
        for output in "${outputs[@]}"; do
            if [ -n "$output" ]; then
                if [ -z "$output1" ]; then
                    output1="$output"
                else
                    output2="$output"
                    break
                fi
            fi
        done

        # For 2 outputs, create a dummy third that matches the second
        # This makes consensus prefer agreement between the two
        consensus_output=$(consensus_merge "$output1" "$output2" "$output2")
    else
        echo "ERROR: Unexpected success count: $success_count" >&2
        return 1
    fi

    # Save consensus
    local consensus_file="${output_dir}/consensus.json"
    echo "$consensus_output" > "$consensus_file"
    echo "Saved consensus: $consensus_file"

    echo "✓ Reference generation complete for $test_id"
    return 0
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

main() {
    echo "===================================================================="
    echo "REFERENCE GENERATION"
    echo "===================================================================="
    echo "Reference version: $REFERENCE_VERSION"
    echo "Golden set: $GOLDEN_SET_FILE"
    echo "Reference models: ${#REFERENCE_MODELS[@]}"
    for model in "${REFERENCE_MODELS[@]}"; do
        echo "  - $model"
    done
    echo "Judge model: $JUDGE_MODEL"
    echo ""

    # Load golden set
    if [ ! -f "$GOLDEN_SET_FILE" ]; then
        echo "ERROR: Golden set not found: $GOLDEN_SET_FILE" >&2
        exit 1
    fi

    local golden_ids
    if [ -n "$SINGLE_TEST_ID" ]; then
        # Single test mode
        golden_ids=("$SINGLE_TEST_ID")
        echo "Mode: Single test ($SINGLE_TEST_ID)"
    else
        # All tests mode
        golden_ids=($(jq -r '.golden_ids[]' "$GOLDEN_SET_FILE"))
        echo "Mode: All tests (${#golden_ids[@]} transcripts)"
    fi

    # Create versioned output directory
    local versioned_dir=$(get_versioned_reference_dir)
    echo "Output dir: $versioned_dir"

    if [ "$DRY_RUN" = "true" ]; then
        echo ""
        echo "[DRY-RUN] Would create versioned directory with prompt snapshots"
        echo "[DRY-RUN] Would generate ${#golden_ids[@]} reference outputs"
        exit 0
    fi

    # Create versioned directory with snapshots
    create_versioned_reference_dir "$versioned_dir" "Reference generation for golden test set"

    echo ""
    echo "===================================================================="

    # Track statistics
    local total_count=${#golden_ids[@]}
    local success_count=0
    local skip_count=0
    local fail_count=0
    local start_time=$(date +%s)

    # Generate references for each test
    for test_id in "${golden_ids[@]}"; do
        if generate_reference_for_test "$test_id" "$versioned_dir"; then
            if [ -f "${versioned_dir}/${test_id}/consensus.json" ]; then
                success_count=$((success_count + 1))
            else
                skip_count=$((skip_count + 1))
            fi
        else
            fail_count=$((fail_count + 1))
        fi
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Print summary
    echo ""
    echo "===================================================================="
    echo "SUMMARY"
    echo "===================================================================="
    echo "Reference version: $REFERENCE_VERSION"
    echo "Output directory:  $versioned_dir"
    echo "Total tests:       $total_count"
    echo "Success:           $success_count"
    echo "Skipped:           $skip_count"
    echo "Failed:            $fail_count"
    echo "Duration:          ${duration}s"
    echo ""

    if [ $fail_count -gt 0 ]; then
        echo "⚠️  Some references failed to generate"
        echo ""
        echo "References stored in: $versioned_dir"
        exit 1
    elif [ $success_count -eq 0 ] && [ $skip_count -gt 0 ]; then
        echo "ℹ️  All references already exist"
        exit 0
    else
        echo "✓ Reference generation complete!"
        echo ""
        echo "References stored in: $versioned_dir"
        echo ""
        echo "Next steps:"
        echo "  - Review: ls -la $versioned_dir"
        echo "  - Check metadata: jq . $versioned_dir/_metadata.json"
        echo "  - Compare versions: ./scripts/benchmark/compare-references.sh $REFERENCE_VERSION <other-version>"
        exit 0
    fi
}

# Run main function
main
