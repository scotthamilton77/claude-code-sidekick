#!/bin/bash
# ==============================================================================
# CONSENSUS ALGORITHMS
# ==============================================================================
# Algorithms for generating consensus outputs from multiple model responses
#
# Functions:
#   consensus_string_field()  - Find most central text using semantic similarity
#   consensus_numeric_field() - Compute median of numeric values
#   consensus_boolean_field() - Majority vote for boolean values
#   consensus_array_field()   - Include items that appear in 2+ outputs
#   consensus_merge()         - Merge 3 model outputs into consensus JSON
#
# Dependencies: similarity.sh (for semantic similarity)
# ==============================================================================

set -euo pipefail

# Source dependencies
BENCHMARK_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${BENCHMARK_LIB_ROOT}/similarity.sh"

# ==============================================================================
# CONSENSUS ALGORITHMS
# ==============================================================================

#------------------------------------------------------------------------------
# consensus_string_field - Find most central string using semantic similarity
#
# Computes pairwise semantic similarity between all 3 strings and selects
# the one with highest average similarity to the other two (most "central").
#
# Arguments:
#   $1 - str1: First string
#   $2 - str2: Second string
#   $3 - str3: Third string
#
# Returns:
#   The most central string
#
# Example:
#   consensus=$(consensus_string_field \
#       "Fix authentication bug" \
#       "Resolve login issue" \
#       "Debug auth system")
#   # Output: "Fix authentication bug" (assuming it's most central)
#------------------------------------------------------------------------------
consensus_string_field() {
    local str1="$1"
    local str2="$2"
    local str3="$3"

    # Handle nulls
    local non_null_count=0
    local last_non_null=""

    [ "$str1" != "null" ] && [ -n "$str1" ] && { ((non_null_count++)); last_non_null="$str1"; }
    [ "$str2" != "null" ] && [ -n "$str2" ] && { ((non_null_count++)); last_non_null="$str2"; }
    [ "$str3" != "null" ] && [ -n "$str3" ] && { ((non_null_count++)); last_non_null="$str3"; }

    # If all null or empty, return null
    if [ $non_null_count -eq 0 ]; then
        echo "null"
        return 0
    fi

    # If only one non-null, return it
    if [ $non_null_count -eq 1 ]; then
        echo "$last_non_null"
        return 0
    fi

    # If two are identical, return that one
    if [ "$str1" = "$str2" ] && [ "$str1" != "null" ]; then
        echo "$str1"
        return 0
    elif [ "$str1" = "$str3" ] && [ "$str1" != "null" ]; then
        echo "$str1"
        return 0
    elif [ "$str2" = "$str3" ] && [ "$str2" != "null" ]; then
        echo "$str2"
        return 0
    fi

    # All three different - compute semantic similarity
    # Calculate average similarity for each string to the other two

    local sim_12 sim_13 sim_23
    sim_12=$(semantic_similarity "$str1" "$str2" 2>/dev/null || echo "0.0")
    sim_13=$(semantic_similarity "$str1" "$str3" 2>/dev/null || echo "0.0")
    sim_23=$(semantic_similarity "$str2" "$str3" 2>/dev/null || echo "0.0")

    # Validate similarity scores (ensure they're valid numbers)
    [[ -z "$sim_12" || ! "$sim_12" =~ ^[0-9]*\.?[0-9]+$ ]] && sim_12="0.0"
    [[ -z "$sim_13" || ! "$sim_13" =~ ^[0-9]*\.?[0-9]+$ ]] && sim_13="0.0"
    [[ -z "$sim_23" || ! "$sim_23" =~ ^[0-9]*\.?[0-9]+$ ]] && sim_23="0.0"

    # Average similarity for each string
    local avg1 avg2 avg3
    avg1=$(echo "scale=3; ($sim_12 + $sim_13) / 2" | bc 2>/dev/null || echo "0.0")
    avg2=$(echo "scale=3; ($sim_12 + $sim_23) / 2" | bc 2>/dev/null || echo "0.0")
    avg3=$(echo "scale=3; ($sim_13 + $sim_23) / 2" | bc 2>/dev/null || echo "0.0")

    # Validate averages
    [[ -z "$avg1" || ! "$avg1" =~ ^[0-9]*\.?[0-9]+$ ]] && avg1="0.0"
    [[ -z "$avg2" || ! "$avg2" =~ ^[0-9]*\.?[0-9]+$ ]] && avg2="0.0"
    [[ -z "$avg3" || ! "$avg3" =~ ^[0-9]*\.?[0-9]+$ ]] && avg3="0.0"

    # Find maximum average
    local max_avg="$avg1"
    local result="$str1"

    if (( $(echo "$avg2 > $max_avg" | bc -l 2>/dev/null || echo "0") )); then
        max_avg="$avg2"
        result="$str2"
    fi

    if (( $(echo "$avg3 > $max_avg" | bc -l 2>/dev/null || echo "0") )); then
        max_avg="$avg3"
        result="$str3"
    fi

    echo "$result"
}

#------------------------------------------------------------------------------
# consensus_numeric_field - Compute median of numeric values
#
# Calculates the median (middle value) of three numbers. For three values,
# this is simply the middle value when sorted.
#
# Arguments:
#   $1 - num1: First number
#   $2 - num2: Second number
#   $3 - num3: Third number
#
# Returns:
#   The median value
#
# Example:
#   median=$(consensus_numeric_field 7 9 8)
#   # Output: 8
#------------------------------------------------------------------------------
consensus_numeric_field() {
    local num1="$1"
    local num2="$2"
    local num3="$3"

    # Handle nulls - use 0 as default
    [ "$num1" = "null" ] || [ -z "$num1" ] && num1=0
    [ "$num2" = "null" ] || [ -z "$num2" ] && num2=0
    [ "$num3" = "null" ] || [ -z "$num3" ] && num3=0

    # Use jq to sort and get median (middle value)
    echo "$num1" "$num2" "$num3" | jq -s 'sort | .[1]'
}

#------------------------------------------------------------------------------
# consensus_boolean_field - Majority vote for boolean values
#
# Implements simple majority voting: if 2 or more values are true, return true.
# Otherwise return false.
#
# Arguments:
#   $1 - bool1: First boolean (true/false)
#   $2 - bool2: Second boolean (true/false)
#   $3 - bool3: Third boolean (true/false)
#
# Returns:
#   "true" if 2+ values are true, "false" otherwise
#
# Example:
#   result=$(consensus_boolean_field true false true)
#   # Output: true
#------------------------------------------------------------------------------
consensus_boolean_field() {
    local bool1="$1"
    local bool2="$2"
    local bool3="$3"

    # Normalize to true/false
    [ "$bool1" = "true" ] && bool1=1 || bool1=0
    [ "$bool2" = "true" ] && bool2=1 || bool2=0
    [ "$bool3" = "true" ] && bool3=1 || bool3=0

    # Count trues
    local true_count=$((bool1 + bool2 + bool3))

    # Majority vote
    if [ $true_count -ge 2 ]; then
        echo "true"
    else
        echo "false"
    fi
}

#------------------------------------------------------------------------------
# consensus_array_field - Include items appearing in 2+ outputs
#
# For array fields (like task_ids), include any item that appears in at least
# 2 of the 3 model outputs. Returns comma-delimited string or null.
#
# Arguments:
#   $1 - arr1: First array as comma-delimited string or null
#   $2 - arr2: Second array as comma-delimited string or null
#   $3 - arr3: Third array as comma-delimited string or null
#
# Returns:
#   Comma-delimited string of items appearing in 2+ arrays, or "null"
#
# Example:
#   result=$(consensus_array_field "T123,T456" "T123,T789" "T123,T999")
#   # Output: "T123" (appears in all 3)
#------------------------------------------------------------------------------
consensus_array_field() {
    local arr1="$1"
    local arr2="$2"
    local arr3="$3"

    # Handle nulls and empty strings
    [ "$arr1" = "null" ] || [ -z "$arr1" ] && arr1=""
    [ "$arr2" = "null" ] || [ -z "$arr2" ] && arr2=""
    [ "$arr3" = "null" ] || [ -z "$arr3" ] && arr3=""

    # If all empty, return null
    if [ -z "$arr1" ] && [ -z "$arr2" ] && [ -z "$arr3" ]; then
        echo "null"
        return 0
    fi

    # Convert comma-delimited strings to JSON arrays and merge
    local combined
    combined=$(jq -n \
        --arg a1 "$arr1" \
        --arg a2 "$arr2" \
        --arg a3 "$arr3" \
        '
        ($a1 | split(",") | map(select(length > 0))) +
        ($a2 | split(",") | map(select(length > 0))) +
        ($a3 | split(",") | map(select(length > 0))) |
        group_by(.) |
        map(select(length >= 2) | .[0]) |
        join(",")
        ')

    # Remove quotes from jq output
    combined="${combined//\"/}"

    # Return null if empty
    if [ -z "$combined" ]; then
        echo "null"
    else
        echo "$combined"
    fi
}

#------------------------------------------------------------------------------
# consensus_merge - Merge 3 model outputs into consensus JSON
#
# Takes 3 JSON outputs from reference models and generates a consensus output
# using appropriate algorithms for each field type:
# - Strings: semantic similarity (most central)
# - Numbers: median
# - Booleans: majority vote
# - Arrays: items in 2+ outputs
#
# Arguments:
#   $1 - json1: First model output (JSON)
#   $2 - json2: Second model output (JSON)
#   $3 - json3: Third model output (JSON)
#
# Returns:
#   Consensus JSON on stdout, exits 0 on success
#
# Example:
#   consensus=$(consensus_merge "$output1" "$output2" "$output3")
#------------------------------------------------------------------------------
consensus_merge() {
    local json1="$1"
    local json2="$2"
    local json3="$3"

    # Validate inputs
    if ! echo "$json1" | jq empty 2>/dev/null; then
        echo "ERROR: Invalid JSON in output 1" >&2
        return 1
    fi
    if ! echo "$json2" | jq empty 2>/dev/null; then
        echo "ERROR: Invalid JSON in output 2" >&2
        return 1
    fi
    if ! echo "$json3" | jq empty 2>/dev/null; then
        echo "ERROR: Invalid JSON in output 3" >&2
        return 1
    fi

    # Extract fields from each output
    local task_ids_1 task_ids_2 task_ids_3
    task_ids_1=$(echo "$json1" | jq -r '.task_ids // "null"')
    task_ids_2=$(echo "$json2" | jq -r '.task_ids // "null"')
    task_ids_3=$(echo "$json3" | jq -r '.task_ids // "null"')

    local initial_goal_1 initial_goal_2 initial_goal_3
    initial_goal_1=$(echo "$json1" | jq -r '.initial_goal // "null"')
    initial_goal_2=$(echo "$json2" | jq -r '.initial_goal // "null"')
    initial_goal_3=$(echo "$json3" | jq -r '.initial_goal // "null"')

    local current_obj_1 current_obj_2 current_obj_3
    current_obj_1=$(echo "$json1" | jq -r '.current_objective // "null"')
    current_obj_2=$(echo "$json2" | jq -r '.current_objective // "null"')
    current_obj_3=$(echo "$json3" | jq -r '.current_objective // "null"')

    local clarity_1 clarity_2 clarity_3
    clarity_1=$(echo "$json1" | jq -r '.clarity_score // 5')
    clarity_2=$(echo "$json2" | jq -r '.clarity_score // 5')
    clarity_3=$(echo "$json3" | jq -r '.clarity_score // 5')

    local confidence_1 confidence_2 confidence_3
    confidence_1=$(echo "$json1" | jq -r '.confidence // 0.5')
    confidence_2=$(echo "$json2" | jq -r '.confidence // 0.5')
    confidence_3=$(echo "$json3" | jq -r '.confidence // 0.5')

    local sig_change_1 sig_change_2 sig_change_3
    sig_change_1=$(echo "$json1" | jq -r '.significant_change // false')
    sig_change_2=$(echo "$json2" | jq -r '.significant_change // false')
    sig_change_3=$(echo "$json3" | jq -r '.significant_change // false')

    # Compute consensus for each field
    echo "[CONSENSUS] Computing consensus for task_ids..." >&2
    local consensus_task_ids
    consensus_task_ids=$(consensus_array_field "$task_ids_1" "$task_ids_2" "$task_ids_3")

    echo "[CONSENSUS] Computing consensus for initial_goal..." >&2
    local consensus_initial_goal
    consensus_initial_goal=$(consensus_string_field "$initial_goal_1" "$initial_goal_2" "$initial_goal_3")

    echo "[CONSENSUS] Computing consensus for current_objective..." >&2
    local consensus_current_objective
    consensus_current_objective=$(consensus_string_field "$current_obj_1" "$current_obj_2" "$current_obj_3")

    echo "[CONSENSUS] Computing consensus for clarity_score..." >&2
    local consensus_clarity
    consensus_clarity=$(consensus_numeric_field "$clarity_1" "$clarity_2" "$clarity_3")

    echo "[CONSENSUS] Computing consensus for confidence..." >&2
    local consensus_confidence
    consensus_confidence=$(consensus_numeric_field "$confidence_1" "$confidence_2" "$confidence_3")

    echo "[CONSENSUS] Computing consensus for significant_change..." >&2
    local consensus_sig_change
    consensus_sig_change=$(consensus_boolean_field "$sig_change_1" "$sig_change_2" "$sig_change_3")

    # Build consensus JSON
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    local consensus_json
    consensus_json=$(jq -n \
        --arg task_ids "$consensus_task_ids" \
        --arg initial_goal "$consensus_initial_goal" \
        --arg current_objective "$consensus_current_objective" \
        --argjson clarity "$consensus_clarity" \
        --argjson confidence "$consensus_confidence" \
        --arg sig_change "$consensus_sig_change" \
        --arg timestamp "$timestamp" \
        '{
            task_ids: (if $task_ids == "null" then null else $task_ids end),
            initial_goal: $initial_goal,
            current_objective: $current_objective,
            clarity_score: $clarity,
            confidence: $confidence,
            significant_change: ($sig_change == "true"),
            generated_at: $timestamp,
            consensus_method: "semantic_similarity_median_majority"
        }')

    echo "$consensus_json"
    return 0
}

echo "[CONSENSUS] Consensus algorithms module loaded" >&2
