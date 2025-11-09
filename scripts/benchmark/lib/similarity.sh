#!/bin/bash
# ==============================================================================
# SEMANTIC SIMILARITY (LLM-as-Judge)
# ==============================================================================
# Uses an LLM judge model to rate semantic similarity between two texts
#
# Functions:
#   semantic_similarity() - Calculate similarity score (0.0-1.0)
#
# Dependencies: ../../../src/sidekick/lib/llm.sh (via sourcing)
# ==============================================================================

set -euo pipefail

# Source the Sidekick LLM infrastructure
BENCHMARK_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDEKICK_LIB="${BENCHMARK_LIB_ROOT}/../../../src/sidekick/lib"

if [ ! -f "${SIDEKICK_LIB}/llm.sh" ]; then
    echo "ERROR: Sidekick LLM library not found: ${SIDEKICK_LIB}/llm.sh" >&2
    exit 1
fi

# Set CLAUDE_PROJECT_DIR for Sidekick logging (required before sourcing)
export CLAUDE_PROJECT_DIR="${BENCHMARK_LIB_ROOT}/../../.."

# Source required Sidekick libraries
source "${SIDEKICK_LIB}/common.sh"

# NOTE: Do NOT call config_load here - this is a library, not an entry point
# Parent scripts (run-benchmark.sh, etc.) handle config_load and config_export
# Calling config_load here would overwrite exported values like LLM_TIMEOUT_SECONDS

# Initialize logging subsystem (only if not already initialized)
if [ -z "${_SIDEKICK_LOG_INITIALIZED:-}" ]; then
    log_init
fi

# ==============================================================================
# SEMANTIC SIMILARITY
# ==============================================================================

#------------------------------------------------------------------------------
# semantic_similarity - Calculate semantic similarity between two texts
#
# Uses LLM-as-judge approach with configured JUDGE_MODEL to rate how similar
# two texts are in meaning. Returns a score from 0.0 (completely different)
# to 1.0 (essentially identical in meaning).
#
# Arguments:
#   $1 - text1: First text to compare
#   $2 - text2: Second text to compare
#
# Returns:
#   Exits 0 on success with score printed to stdout
#   Exits 1 on error
#
# Output:
#   A single decimal number from 0.0 to 1.0
#
# Example:
#   score=$(semantic_similarity "Fix auth bug" "Resolve login issue")
#   # Output: 0.85
#------------------------------------------------------------------------------
semantic_similarity() {
    local text1="$1"
    local text2="$2"

    # Check for empty inputs
    if [ -z "$text1" ] || [ -z "$text2" ]; then
        echo "ERROR: Both text1 and text2 must be non-empty" >&2
        echo "0.0"
        return 1
    fi

    # Handle identical texts (optimization)
    if [ "$text1" = "$text2" ]; then
        echo "1.0"
        return 0
    fi

    # Check if JUDGE_MODEL is configured
    if [ -z "${JUDGE_MODEL:-}" ]; then
        echo "ERROR: JUDGE_MODEL not configured" >&2
        echo "0.0"
        return 1
    fi

    # Build prompt for judge model
    local prompt
    prompt=$(cat <<'EOF'
Rate the semantic similarity between these two texts on a scale from 0.0 to 1.0.

Scoring guidelines:
- 1.0: Identical or nearly identical in meaning
- 0.9-0.99: Same core meaning with minor wording differences
- 0.7-0.89: Similar meaning but different phrasing or details
- 0.5-0.69: Related but with notable differences in focus or specifics
- 0.3-0.49: Loosely related or tangentially connected
- 0.0-0.29: Completely different topics or meanings

Return your response as JSON matching the provided schema.

Text A: {TEXT1}

Text B: {TEXT2}
EOF
)

    # Substitute texts into prompt
    prompt="${prompt//\{TEXT1\}/$text1}"
    prompt="${prompt//\{TEXT2\}/$text2}"

    # Create JSON schema for structured output
    local json_schema
    json_schema=$(cat <<'EOF'
{
  "name": "similarity_score",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "score": {
        "type": "number",
        "minimum": 0.0,
        "maximum": 1.0,
        "description": "Semantic similarity score"
      }
    },
    "required": ["score"],
    "additionalProperties": false
  }
}
EOF
)

    # Parse model specification (format: "provider:model")
    local provider="${JUDGE_MODEL%%:*}"
    local model="${JUDGE_MODEL#*:}"

    # Invoke judge model with schema
    # Use empty string for timeout to respect LLM_TIMEOUT_SECONDS from config (set to 60s for benchmarks)
    local llm_output
    if ! llm_output=$(llm_invoke_with_provider "$provider" "$model" "$prompt" "" "$json_schema" 2>&1); then
        # Primary judge model failed - try fallback if configured
        if [ -n "${BENCHMARK_SCORING_MODEL_FALLBACK:-}" ]; then
            echo "WARN: Primary judge model ($JUDGE_MODEL) failed, trying fallback ($BENCHMARK_SCORING_MODEL_FALLBACK)" >&2

            local fallback_provider="${BENCHMARK_SCORING_MODEL_FALLBACK%%:*}"
            local fallback_model="${BENCHMARK_SCORING_MODEL_FALLBACK#*:}"

            if ! llm_output=$(llm_invoke_with_provider "$fallback_provider" "$fallback_model" "$prompt" "" "$json_schema" 2>&1); then
                echo "ERROR: Both primary and fallback judge models failed for semantic similarity" >&2
                echo "0.0"
                return 1
            fi

            echo "INFO: Successfully used fallback judge model for semantic similarity" >&2
        else
            echo "ERROR: LLM invocation failed for semantic similarity (no fallback configured)" >&2
            echo "0.0"
            return 1
        fi
    fi

    # Extract JSON from output (handle markdown wrapping)
    local json_output
    json_output=$(llm_extract_json "$llm_output")

    # Validate JSON
    if ! echo "$json_output" | jq empty 2>/dev/null; then
        echo "ERROR: Invalid JSON from judge model: $llm_output" >&2
        echo "0.0"
        return 1
    fi

    # Extract score from JSON
    local score
    score=$(echo "$json_output" | jq -r '.score // empty')

    # Validate score exists
    if [ -z "$score" ]; then
        echo "ERROR: No score field in JSON output: $json_output" >&2
        echo "0.0"
        return 1
    fi

    # Validate score is a number in range
    if ! [[ "$score" =~ ^[0-9]*\.?[0-9]+$ ]]; then
        echo "ERROR: Score is not a valid number: $score" >&2
        echo "0.0"
        return 1
    fi

    # Validate range (0.0-1.0)
    local score_check
    score_check=$(echo "$score >= 0.0 && $score <= 1.0" | bc -l 2>/dev/null || echo "0")
    if [ "$score_check" != "1" ]; then
        echo "ERROR: Score out of range [0.0-1.0]: $score" >&2
        echo "0.0"
        return 1
    fi

    # Return score
    echo "$score"
    return 0
}

#------------------------------------------------------------------------------
# llm_invoke_with_provider - Invoke LLM with explicit provider
#
# Wrapper around llm_invoke that temporarily sets LLM_PROVIDER and model
# for a single invocation.
#
# Arguments:
#   $1 - provider: LLM provider (openrouter, claude-cli, openai-api)
#   $2 - model: Model identifier
#   $3 - prompt: Prompt text
#   $4 - timeout: Timeout in seconds (optional, default 30)
#   $5 - json_schema: JSON schema for structured output (optional)
#
# Returns:
#   Exits 0 on success with LLM output to stdout
#   Exits 1 on error
#------------------------------------------------------------------------------
llm_invoke_with_provider() {
    local provider="$1"
    local model="$2"
    local prompt="$3"
    local timeout="${4:-}"  # Default to empty, let llm_invoke use config
    local json_schema="${5:-}"

    # Save current provider settings
    local orig_provider="${LLM_PROVIDER:-}"
    local orig_model=""

    case "$provider" in
        openrouter)
            orig_model="${LLM_OPENROUTER_MODEL:-}"
            export LLM_PROVIDER="openrouter"
            export LLM_OPENROUTER_MODEL="$model"
            ;;
        claude-cli)
            orig_model="${LLM_CLAUDE_MODEL:-}"
            export LLM_PROVIDER="claude-cli"
            export LLM_CLAUDE_MODEL="$model"
            ;;
        openai-api)
            orig_model="${LLM_OPENAI_MODEL:-}"
            export LLM_PROVIDER="openai-api"
            export LLM_OPENAI_MODEL="$model"
            ;;
        *)
            echo "ERROR: Unknown provider: $provider" >&2
            return 1
            ;;
    esac

    # Invoke LLM
    # Capture both stdout and stderr separately to preserve error details
    local result_file=$(mktemp)
    local error_file=$(mktemp)

    # Use set +e pattern to reliably capture exit code
    set +e
    llm_invoke "$model" "$prompt" "$timeout" "$json_schema" >"$result_file" 2>"$error_file"
    local exit_code=$?
    set -e

    result=$(cat "$result_file")
    local errors=$(cat "$error_file")
    rm -f "$result_file" "$error_file"

    # Restore original settings
    if [ -n "$orig_provider" ]; then
        export LLM_PROVIDER="$orig_provider"
    else
        unset LLM_PROVIDER
    fi

    case "$provider" in
        openrouter)
            if [ -n "$orig_model" ]; then
                export LLM_OPENROUTER_MODEL="$orig_model"
            else
                unset LLM_OPENROUTER_MODEL
            fi
            ;;
        claude-cli)
            if [ -n "$orig_model" ]; then
                export LLM_CLAUDE_MODEL="$orig_model"
            else
                unset LLM_CLAUDE_MODEL
            fi
            ;;
        openai-api)
            if [ -n "$orig_model" ]; then
                export LLM_OPENAI_MODEL="$orig_model"
            else
                unset LLM_OPENAI_MODEL
            fi
            ;;
    esac

    # Return result
    if [ $exit_code -eq 0 ]; then
        echo "$result"
        # Also output any errors/warnings that were logged during successful execution
        if [ -n "$errors" ]; then
            echo "$errors" >&2
        fi
        return 0
    else
        # On error: output all error information to stderr
        echo "=== LLM INVOCATION FAILED ===" >&2
        echo "Provider: $provider" >&2
        echo "Model: $model" >&2
        echo "Exit code: $exit_code" >&2
        if [ -n "$result" ]; then
            echo "Partial output: $result" >&2
        fi

        # Send detailed errors to stderr
        if [ -n "$errors" ]; then
            echo "$errors" >&2
        else
            log_error "LLM invocation failed for provider '$provider' model '$model' (no error details available)"
        fi
        return 1
    fi
}

echo "[SIMILARITY] Semantic similarity module loaded" >&2
