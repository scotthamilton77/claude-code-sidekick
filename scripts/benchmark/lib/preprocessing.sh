#!/bin/bash
# ==============================================================================
# TRANSCRIPT PREPROCESSING
# ==============================================================================
# Shared preprocessing logic to match Sidekick's topic extraction behavior
#
# Functions:
#   preprocess_transcript() - Extract and clean transcript excerpt
#
# Dependencies: jq
# ==============================================================================

set -euo pipefail

#------------------------------------------------------------------------------
# preprocess_transcript - Extract and clean transcript excerpt
#
# Applies the same preprocessing as Sidekick's topic extraction:
#   - Takes last N lines (default: 80, configurable via TOPIC_EXCERPT_LINES)
#   - Filters out tool messages (tool_use, tool_result)
#   - Strips unnecessary metadata to reduce token count
#
# Arguments:
#   $1 - transcript_path: Path to .jsonl transcript file
#
# Returns:
#   JSON array of preprocessed messages to stdout
#   Exit code 0 on success, 1 on error
#
# Example:
#   preprocessed=$(preprocess_transcript "transcript.jsonl")
#   echo "$preprocessed" | jq .
#------------------------------------------------------------------------------
preprocess_transcript() {
    local transcript_path="$1"

    if [ ! -f "$transcript_path" ]; then
        echo "ERROR: Transcript file not found: $transcript_path" >&2
        echo "[]"
        return 1
    fi

    # Get line count from environment or use default
    # This matches Sidekick's TOPIC_EXCERPT_LINES config
    local line_count="${TOPIC_EXCERPT_LINES:-80}"

    # Get filter_tools flag from environment or use default
    # This matches Sidekick's TOPIC_FILTER_TOOL_MESSAGES config
    local filter_tools="${TOPIC_FILTER_TOOL_MESSAGES:-true}"

    # Build jq filter for preprocessing
    local jq_filter='.message | select(. != null)'

    # Optionally filter out tool messages (tool_use and tool_result)
    if [ "$filter_tools" = "true" ]; then
        jq_filter+=' | select((.content | if type == "array" then (.[0].type != "tool_use" and .[0].type != "tool_result") else true end))'
    fi

    # Strip unnecessary attributes to reduce token usage
    # This removes: model, id, type, stop_reason, stop_sequence, usage
    jq_filter+=' | del(.model, .id, .type, .stop_reason, .stop_sequence, .usage)'

    # Extract last N lines, preprocess each, wrap in JSON array
    tail -n "$line_count" "$transcript_path" | jq -c "$jq_filter" | jq -s '.'
}

echo "[PREPROCESSING] Transcript preprocessing module loaded" >&2
