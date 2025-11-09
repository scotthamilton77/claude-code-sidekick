#!/bin/bash
# ==============================================================================
# SCORING ENGINE
# ==============================================================================
# Validates and scores LLM outputs against reference outputs
#
# Functions:
#   score_schema_compliance() - Validate JSON structure and field types (0-100)
#   score_technical_accuracy() - Compare output fields to reference (0-100)
#   score_content_quality() - Assess snarky comment relevance (0-100)
#   score_output() - Main orchestrator returning all scores
#
# Dependencies:
#   - similarity.sh (semantic_similarity function)
#   - jq, bc (for JSON and arithmetic)
# ==============================================================================

set -euo pipefail

# Source similarity module (for semantic comparisons)
SCORING_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCORING_LIB_ROOT}/similarity.sh"

# ==============================================================================
# SCHEMA COMPLIANCE SCORING (0-100 points)
# ==============================================================================

#------------------------------------------------------------------------------
# score_schema_compliance - Validate JSON structure and field types
#
# Evaluates output against topic-schema.json requirements:
#   - Valid JSON structure (30 pts)
#   - Required fields present (30 pts)
#   - Correct field types & ranges (40 pts)
#
# Arguments:
#   $1 - output: JSON output to validate
#
# Returns:
#   JSON object: {"score": <0-100>, "errors": [...]}
#------------------------------------------------------------------------------
score_schema_compliance() {
    local output="$1"
    local score=0
    local errors=()

    # Valid JSON structure (30 pts)
    if ! echo "$output" | jq empty 2>/dev/null; then
        echo "{\"score\": 0, \"errors\": [\"Invalid JSON\"]}" | jq .
        return 0
    fi
    score=$((score + 30))

    # Required fields present (30 pts)
    local required_fields=(
        "task_ids"
        "initial_goal"
        "current_objective"
        "clarity_score"
        "confidence"
        "high_clarity_snarky_comment"
        "low_clarity_snarky_comment"
        "significant_change"
    )

    local present_count=0
    for field in "${required_fields[@]}"; do
        if echo "$output" | jq -e "has(\"$field\")" >/dev/null 2>&1; then
            present_count=$((present_count + 1))
        else
            errors+=("Missing field: $field")
        fi
    done

    local required_count=${#required_fields[@]}
    score=$((score + (present_count * 30 / required_count)))

    # Correct field types & ranges (40 pts total, 5 pts per check)
    local type_errors=0

    # Check clarity_score is int 1-10 (5 pts)
    local clarity
    clarity=$(echo "$output" | jq -r '.clarity_score // "null"')
    if [[ "$clarity" == "null" ]]; then
        errors+=("clarity_score missing")
        type_errors=$((type_errors + 1))
    elif ! [[ "$clarity" =~ ^[0-9]+$ ]]; then
        errors+=("clarity_score not an integer: $clarity")
        type_errors=$((type_errors + 1))
    elif ((clarity < 1 || clarity > 10)); then
        errors+=("clarity_score out of range [1-10]: $clarity")
        type_errors=$((type_errors + 1))
    fi

    # Check confidence is float 0.0-1.0 (5 pts)
    local confidence
    confidence=$(echo "$output" | jq -r '.confidence // "null"')
    if [[ "$confidence" == "null" ]]; then
        errors+=("confidence missing")
        type_errors=$((type_errors + 1))
    elif ! [[ "$confidence" =~ ^[0-9]*\.?[0-9]+$ ]]; then
        errors+=("confidence not a number: $confidence")
        type_errors=$((type_errors + 1))
    else
        local conf_check
        conf_check=$(echo "$confidence >= 0.0 && $confidence <= 1.0" | bc -l 2>/dev/null || echo "0")
        if [[ "$conf_check" != "1" ]]; then
            errors+=("confidence out of range [0.0-1.0]: $confidence")
            type_errors=$((type_errors + 1))
        fi
    fi

    # Check significant_change is boolean (5 pts)
    local sig_change
    sig_change=$(echo "$output" | jq -r '.significant_change // "null"')
    if [[ "$sig_change" == "null" ]]; then
        errors+=("significant_change missing")
        type_errors=$((type_errors + 1))
    elif [[ "$sig_change" != "true" && "$sig_change" != "false" ]]; then
        errors+=("significant_change not a boolean: $sig_change")
        type_errors=$((type_errors + 1))
    fi

    # Check initial_goal is string with maxLength 60 (5 pts)
    local initial_goal
    initial_goal=$(echo "$output" | jq -r '.initial_goal // "null"')
    if [[ "$initial_goal" == "null" ]]; then
        errors+=("initial_goal missing")
        type_errors=$((type_errors + 1))
    elif [[ ${#initial_goal} -gt 60 ]]; then
        errors+=("initial_goal exceeds maxLength 60: ${#initial_goal} chars")
        type_errors=$((type_errors + 1))
    fi

    # Check current_objective is string with maxLength 60 (5 pts)
    local current_obj
    current_obj=$(echo "$output" | jq -r '.current_objective // "null"')
    if [[ "$current_obj" == "null" ]]; then
        errors+=("current_objective missing")
        type_errors=$((type_errors + 1))
    elif [[ ${#current_obj} -gt 60 ]]; then
        errors+=("current_objective exceeds maxLength 60: ${#current_obj} chars")
        type_errors=$((type_errors + 1))
    fi

    # Check task_ids is string or null (5 pts)
    local task_ids_type
    task_ids_type=$(echo "$output" | jq -r '.task_ids | type')
    if [[ "$task_ids_type" != "string" && "$task_ids_type" != "null" ]]; then
        errors+=("task_ids wrong type (expected string or null): $task_ids_type")
        type_errors=$((type_errors + 1))
    fi

    # Check snarky comments are strings or null with maxLength 120 (2 x 5 pts = 10 pts)
    for field in "high_clarity_snarky_comment" "low_clarity_snarky_comment"; do
        local comment_type
        comment_type=$(echo "$output" | jq -r ".$field | type")
        if [[ "$comment_type" != "string" && "$comment_type" != "null" ]]; then
            errors+=("$field wrong type: $comment_type")
            type_errors=$((type_errors + 1))
        else
            local comment
            comment=$(echo "$output" | jq -r ".$field // \"\"")
            if [[ -n "$comment" && ${#comment} -gt 120 ]]; then
                errors+=("$field exceeds maxLength 120: ${#comment} chars")
                type_errors=$((type_errors + 1))
            fi
        fi
    done

    # Calculate type score (40 pts max, 5 pts per check, 8 checks total)
    score=$((score + (40 - (type_errors * 5))))

    # Build error array JSON
    local error_json="[]"
    if [ ${#errors[@]} -gt 0 ]; then
        error_json=$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)
    fi

    # Return result
    echo "{\"score\": $score, \"errors\": $error_json}" | jq .
}

# ==============================================================================
# TECHNICAL ACCURACY SCORING (0-100 points)
# ==============================================================================

#------------------------------------------------------------------------------
# score_technical_accuracy - Compare output fields to reference
#
# Evaluates how accurately the model extracted information from the transcript:
#   - task_ids exact match (15 pts)
#   - initial_goal semantic similarity (20 pts)
#   - current_objective semantic similarity (20 pts)
#   - clarity_score within ±1 (20 pts)
#   - significant_change match (15 pts)
#   - confidence within ±0.15 (10 pts)
#
# Arguments:
#   $1 - output: JSON output to evaluate
#   $2 - reference: Reference JSON (consensus from high-quality models)
#
# Returns:
#   JSON object: {"score": <0-100>, "details": {...}}
#------------------------------------------------------------------------------
score_technical_accuracy() {
    local output="$1"
    local reference="$2"
    local score=0

    # Validate both are valid JSON
    if ! echo "$output" | jq empty 2>/dev/null; then
        echo "{\"score\": 0, \"details\": {\"error\": \"Invalid output JSON\"}}" | jq .
        return 0
    fi
    if ! echo "$reference" | jq empty 2>/dev/null; then
        echo "{\"score\": 0, \"details\": {\"error\": \"Invalid reference JSON\"}}" | jq .
        return 0
    fi

    # task_ids exact match (15 pts)
    local output_task_ids reference_task_ids
    output_task_ids=$(echo "$output" | jq -r '.task_ids // ""')
    reference_task_ids=$(echo "$reference" | jq -r '.task_ids // ""')

    local task_ids_match="false"
    local task_ids_score=0
    if [[ "$output_task_ids" == "$reference_task_ids" ]]; then
        score=$((score + 15))
        task_ids_score=15
        task_ids_match="true"
    fi

    # initial_goal semantic similarity (20 pts)
    local goal_out goal_ref goal_similarity goal_score
    goal_out=$(echo "$output" | jq -r '.initial_goal // ""')
    goal_ref=$(echo "$reference" | jq -r '.initial_goal // ""')

    if [[ -z "$goal_out" || -z "$goal_ref" ]]; then
        goal_similarity="0.0"
        goal_score=0
    else
        # semantic_similarity already outputs "0.0" on error, so no need for || echo "0.0"
        goal_similarity=$(semantic_similarity "$goal_out" "$goal_ref" 2>/dev/null)
        # Defensive: strip whitespace and ensure single value (in case of multiline output)
        goal_similarity=$(echo "$goal_similarity" | tr -d '\n' | awk '{print $1}')
        goal_score=$(echo "$goal_similarity * 20" | bc -l | awk '{printf "%.0f", $1}')
        score=$((score + goal_score))
    fi

    # current_objective semantic similarity (20 pts)
    local obj_out obj_ref obj_similarity obj_score
    obj_out=$(echo "$output" | jq -r '.current_objective // ""')
    obj_ref=$(echo "$reference" | jq -r '.current_objective // ""')

    if [[ -z "$obj_out" || -z "$obj_ref" ]]; then
        obj_similarity="0.0"
        obj_score=0
    else
        # semantic_similarity already outputs "0.0" on error, so no need for || echo "0.0"
        obj_similarity=$(semantic_similarity "$obj_out" "$obj_ref" 2>/dev/null)
        # Defensive: strip whitespace and ensure single value (in case of multiline output)
        obj_similarity=$(echo "$obj_similarity" | tr -d '\n' | awk '{print $1}')
        obj_score=$(echo "$obj_similarity * 20" | bc -l | awk '{printf "%.0f", $1}')
        score=$((score + obj_score))
    fi

    # clarity_score within ±1 (20 pts)
    local clarity_out clarity_ref clarity_diff clarity_match clarity_score
    clarity_out=$(echo "$output" | jq -r '.clarity_score // "null"')
    clarity_ref=$(echo "$reference" | jq -r '.clarity_score // "null"')

    clarity_match="false"
    clarity_score=0
    if [[ "$clarity_out" != "null" && "$clarity_ref" != "null" ]]; then
        clarity_diff=$(echo "$clarity_out - $clarity_ref" | bc -l | awk '{print ($1<0)?-$1:$1}')
        if (( $(echo "$clarity_diff <= 1" | bc -l) )); then
            score=$((score + 20))
            clarity_score=20
            clarity_match="true"
        fi
    fi

    # significant_change match (15 pts)
    local sig_change_out sig_change_ref sig_change_match sig_change_score
    sig_change_out=$(echo "$output" | jq -r '.significant_change // "null"')
    sig_change_ref=$(echo "$reference" | jq -r '.significant_change // "null"')

    sig_change_match="false"
    sig_change_score=0
    if [[ "$sig_change_out" == "$sig_change_ref" ]]; then
        score=$((score + 15))
        sig_change_score=15
        sig_change_match="true"
    fi

    # confidence within ±0.15 (10 pts)
    local conf_out conf_ref conf_diff conf_match conf_score
    conf_out=$(echo "$output" | jq -r '.confidence // "null"')
    conf_ref=$(echo "$reference" | jq -r '.confidence // "null"')

    conf_match="false"
    conf_score=0
    if [[ "$conf_out" != "null" && "$conf_ref" != "null" ]]; then
        conf_diff=$(echo "$conf_out - $conf_ref" | bc -l | awk '{print ($1<0)?-$1:$1}')
        if (( $(echo "$conf_diff <= 0.15" | bc -l) )); then
            score=$((score + 10))
            conf_score=10
            conf_match="true"
        fi
    fi

    # Build details JSON using jq to properly escape and validate values
    local details
    details=$(jq -n \
        --argjson task_ids_match "$task_ids_match" \
        --argjson task_ids_score "$task_ids_score" \
        --arg goal_similarity "$goal_similarity" \
        --argjson goal_score "$goal_score" \
        --arg obj_similarity "$obj_similarity" \
        --argjson obj_score "$obj_score" \
        --argjson clarity_match "$clarity_match" \
        --argjson clarity_score "$clarity_score" \
        --argjson sig_change_match "$sig_change_match" \
        --argjson sig_change_score "$sig_change_score" \
        --argjson conf_match "$conf_match" \
        --argjson conf_score "$conf_score" \
        '{
            task_ids_match: $task_ids_match,
            task_ids_score: $task_ids_score,
            initial_goal_similarity: ($goal_similarity | tonumber),
            initial_goal_score: $goal_score,
            current_objective_similarity: ($obj_similarity | tonumber),
            current_objective_score: $obj_score,
            clarity_match: $clarity_match,
            clarity_score: $clarity_score,
            significant_change_match: $sig_change_match,
            significant_change_score: $sig_change_score,
            confidence_match: $conf_match,
            confidence_score: $conf_score
        }')

    # Return result using jq to construct final JSON
    jq -n \
        --argjson score "$score" \
        --argjson details "$details" \
        '{score: $score, details: $details}'
}

# ==============================================================================
# CONTENT QUALITY SCORING (0-100 points)
# ==============================================================================

#------------------------------------------------------------------------------
# score_content_quality - Assess snarky comment relevance and appropriateness
#
# Evaluates the quality of the snarky comment:
#   - Comment present in appropriate field based on clarity (20 pts)
#   - Length within bounds 20-120 chars (20 pts)
#   - Relevance to transcript content (60 pts)
#
# Arguments:
#   $1 - output: JSON output to evaluate
#   $2 - transcript: Full transcript text for relevance check
#
# Returns:
#   JSON object: {"score": <0-100>, "details": {...}}
#------------------------------------------------------------------------------
score_content_quality() {
    local output="$1"
    local transcript="$2"
    local score=0

    # Validate output is valid JSON
    if ! echo "$output" | jq empty 2>/dev/null; then
        echo "{\"score\": 0, \"details\": {\"error\": \"Invalid output JSON\"}}" | jq .
        return 0
    fi

    # Determine which snarky comment field to evaluate based on clarity
    local clarity
    clarity=$(echo "$output" | jq -r '.clarity_score // "null"')

    local comment_field="low_clarity_snarky_comment"
    if [[ "$clarity" != "null" ]] && ((clarity >= 7)); then
        comment_field="high_clarity_snarky_comment"
    fi

    local comment
    comment=$(echo "$output" | jq -r ".$comment_field // \"\"")

    # Comment present (20 pts)
    local present_score=0
    if [[ -n "$comment" && "$comment" != "null" ]]; then
        score=$((score + 20))
        present_score=20
    fi

    # Length within bounds 20-120 chars (20 pts)
    local len=${#comment}
    local length_score=0
    if ((len >= 20 && len <= 120)); then
        score=$((score + 20))
        length_score=20
    fi

    # Relevance to transcript (60 pts)
    # Extract first 500 characters of transcript as sample for comparison
    local transcript_excerpt="${transcript:0:500}"

    local relevance_similarity relevance_score
    if [[ -z "$comment" || "$comment" == "null" ]]; then
        relevance_similarity="0.0"
        relevance_score=0
    else
        # semantic_similarity already outputs "0.0" on error, so no need for || echo "0.0"
        relevance_similarity=$(semantic_similarity "$comment" "$transcript_excerpt" 2>/dev/null)
        # Defensive: strip whitespace and ensure single value (in case of multiline output)
        relevance_similarity=$(echo "$relevance_similarity" | tr -d '\n' | awk '{print $1}')
        relevance_score=$(echo "$relevance_similarity * 60" | bc -l | awk '{printf "%.0f", $1}')
        score=$((score + relevance_score))
    fi

    # Build details JSON using jq to properly escape and validate values
    local details
    details=$(jq -n \
        --arg field_used "$comment_field" \
        --argjson comment_length "$len" \
        --argjson present_score "$present_score" \
        --argjson length_score "$length_score" \
        --arg relevance_similarity "$relevance_similarity" \
        --argjson relevance_score "$relevance_score" \
        '{
            field_used: $field_used,
            comment_length: $comment_length,
            present_score: $present_score,
            length_score: $length_score,
            relevance_similarity: ($relevance_similarity | tonumber),
            relevance_score: $relevance_score
        }')

    # Return result using jq to construct final JSON
    jq -n \
        --argjson score "$score" \
        --argjson details "$details" \
        '{score: $score, details: $details}'
}

# ==============================================================================
# MAIN SCORING ORCHESTRATOR
# ==============================================================================

#------------------------------------------------------------------------------
# score_output - Main scoring function that calls all three scoring dimensions
#
# Arguments:
#   $1 - output: JSON output to evaluate
#   $2 - reference: Reference JSON (for technical accuracy)
#   $3 - transcript: Full transcript text (for content quality)
#
# Returns:
#   JSON object with all scores and overall weighted score:
#   {
#     "schema_compliance": {"score": X, "errors": [...]},
#     "technical_accuracy": {"score": Y, "details": {...}},
#     "content_quality": {"score": Z, "details": {...}},
#     "overall_score": W,  // weighted: 30% schema + 50% accuracy + 20% content
#     "timestamp": "..."
#   }
#------------------------------------------------------------------------------
score_output() {
    local output="$1"
    local reference="$2"
    local transcript="$3"

    # Get individual scores
    local schema_result technical_result content_result
    schema_result=$(score_schema_compliance "$output")
    technical_result=$(score_technical_accuracy "$output" "$reference")
    content_result=$(score_content_quality "$output" "$transcript")

    # Extract scores
    local schema_score technical_score content_score
    schema_score=$(echo "$schema_result" | jq -r '.score')
    technical_score=$(echo "$technical_result" | jq -r '.score')
    content_score=$(echo "$content_result" | jq -r '.score')

    # Calculate weighted overall score
    # Weights: schema 30%, technical 50%, content 20%
    local overall_score
    overall_score=$(echo "scale=2; ($schema_score * 0.30) + ($technical_score * 0.50) + ($content_score * 0.20)" | bc)

    # Build final result using jq to properly combine JSON objects
    jq -n \
        --argjson schema_compliance "$schema_result" \
        --argjson technical_accuracy "$technical_result" \
        --argjson content_quality "$content_result" \
        --arg overall_score "$overall_score" \
        --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        '{
            schema_compliance: $schema_compliance,
            technical_accuracy: $technical_accuracy,
            content_quality: $content_quality,
            overall_score: ($overall_score | tonumber),
            timestamp: $timestamp
        }'
}

echo "[SCORING] Scoring module loaded" >&2
