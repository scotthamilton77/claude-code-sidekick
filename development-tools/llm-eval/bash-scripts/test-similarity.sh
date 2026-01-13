#!/bin/bash
# ==============================================================================
# SEMANTIC SIMILARITY VALIDATION TEST
# ==============================================================================
# Tests Phase 4 success criteria:
# 1. Semantic similarity returns valid scores 0.0-1.0
# 2. Similar texts score >0.7
# 3. Dissimilar texts score <0.3
# 4. Consistency across multiple invocations
#
# Usage: ./test-similarity.sh
# ==============================================================================

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source required modules
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/lib/similarity.sh"

# ==============================================================================
# TEST FRAMEWORK
# ==============================================================================

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

test_start() {
    local test_name="$1"
    echo ""
    echo "============================================================"
    echo "TEST: $test_name"
    echo "============================================================"
    ((TESTS_RUN++))
}

test_pass() {
    local message="$1"
    echo "✅ PASS: $message"
    ((TESTS_PASSED++))
}

test_fail() {
    local message="$1"
    echo "❌ FAIL: $message"
    ((TESTS_FAILED++))
}

test_info() {
    local message="$1"
    echo "   $message"
}

test_summary() {
    echo ""
    echo "============================================================"
    echo "TEST SUMMARY"
    echo "============================================================"
    echo "Tests run:    $TESTS_RUN"
    echo "Tests passed: $TESTS_PASSED"
    echo "Tests failed: $TESTS_FAILED"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo "✅ ALL TESTS PASSED"
        return 0
    else
        echo "❌ SOME TESTS FAILED"
        return 1
    fi
}

# ==============================================================================
# VALIDATION HELPERS
# ==============================================================================

# Validate score is in range [0.0, 1.0]
validate_score_range() {
    local score="$1"
    local label="$2"

    # Check it's a valid number
    if ! [[ "$score" =~ ^[0-9]*\.?[0-9]+$ ]]; then
        test_fail "$label: Not a valid number: '$score'"
        return 1
    fi

    # Check range
    local in_range
    in_range=$(echo "$score >= 0.0 && $score <= 1.0" | bc -l)
    if [ "$in_range" != "1" ]; then
        test_fail "$label: Score out of range [0.0, 1.0]: $score"
        return 1
    fi

    test_pass "$label: Valid score in range: $score"
    return 0
}

# Validate score meets threshold
validate_threshold() {
    local score="$1"
    local threshold="$2"
    local operator="$3"  # ">" or "<"
    local label="$4"

    local result
    case "$operator" in
        ">")
            result=$(echo "$score > $threshold" | bc -l)
            if [ "$result" = "1" ]; then
                test_pass "$label: Score $score > $threshold ✓"
                return 0
            else
                test_fail "$label: Score $score NOT > $threshold (expected similar texts)"
                return 1
            fi
            ;;
        "<")
            result=$(echo "$score < $threshold" | bc -l)
            if [ "$result" = "1" ]; then
                test_pass "$label: Score $score < $threshold ✓"
                return 0
            else
                test_fail "$label: Score $score NOT < $threshold (expected dissimilar texts)"
                return 1
            fi
            ;;
        *)
            test_fail "$label: Unknown operator: $operator"
            return 1
            ;;
    esac
}

# Validate consistency (scores within +/- tolerance)
validate_consistency() {
    local -n scores_arr=$1  # Pass array by reference
    local tolerance="$2"
    local label="$3"

    # Need at least 2 scores
    if [ ${#scores_arr[@]} -lt 2 ]; then
        test_fail "$label: Need at least 2 scores for consistency check"
        return 1
    fi

    # Calculate mean
    local sum=0
    local count=${#scores_arr[@]}
    for score in "${scores_arr[@]}"; do
        sum=$(echo "$sum + $score" | bc -l)
    done
    local mean=$(echo "scale=4; $sum / $count" | bc -l)

    # Calculate max deviation from mean
    local max_dev=0
    for score in "${scores_arr[@]}"; do
        local dev=$(echo "scale=4; $score - $mean" | bc -l | awk '{print ($1<0)?-$1:$1}')
        local is_greater=$(echo "$dev > $max_dev" | bc -l)
        if [ "$is_greater" = "1" ]; then
            max_dev=$dev
        fi
    done

    test_info "Scores: ${scores_arr[*]}"
    test_info "Mean: $mean, Max deviation: $max_dev, Tolerance: $tolerance"

    # Check if max deviation is within tolerance
    local within_tolerance=$(echo "$max_dev <= $tolerance" | bc -l)
    if [ "$within_tolerance" = "1" ]; then
        test_pass "$label: Consistent (max dev $max_dev <= $tolerance)"
        return 0
    else
        test_fail "$label: Inconsistent (max dev $max_dev > $tolerance)"
        return 1
    fi
}

# ==============================================================================
# TEST CASES
# ==============================================================================

# Test 1: Identical texts should score 1.0
test_identical_texts() {
    test_start "Identical texts should score 1.0"

    local text="Fix authentication bug in login flow"
    local score

    test_info "Text: '$text'"

    score=$(semantic_similarity "$text" "$text")
    test_info "Score: $score"

    validate_score_range "$score" "Identical texts"

    # Check exact match (optimization should return 1.0)
    if [ "$score" = "1.0" ]; then
        test_pass "Identical texts: Exact match returns 1.0"
    else
        test_fail "Identical texts: Expected 1.0, got $score"
    fi
}

# Test 2: Highly similar texts should score >0.7
test_similar_texts() {
    test_start "Similar texts should score >0.7"

    local pairs=(
        "Fix auth bug|Resolve login issue"
        "Add dark mode toggle|Implement dark theme switcher"
        "Refactor database connection|Clean up DB connection code"
        "Update README documentation|Improve README docs"
    )

    for pair in "${pairs[@]}"; do
        local text1="${pair%%|*}"
        local text2="${pair#*|}"

        test_info ""
        test_info "Pair: '$text1' vs '$text2'"

        local score
        score=$(semantic_similarity "$text1" "$text2")
        test_info "Score: $score"

        validate_score_range "$score" "Similar pair" || continue
        validate_threshold "$score" "0.7" ">" "Similar pair"
    done
}

# Test 3: Dissimilar texts should score <0.3
test_dissimilar_texts() {
    test_start "Dissimilar texts should score <0.3"

    local pairs=(
        "Fix authentication bug|Write unit tests"
        "Add dark mode feature|Delete unused dependencies"
        "Update documentation|Optimize database queries"
        "Refactor code structure|Deploy to production"
    )

    for pair in "${pairs[@]}"; do
        local text1="${pair%%|*}"
        local text2="${pair#*|}"

        test_info ""
        test_info "Pair: '$text1' vs '$text2'"

        local score
        score=$(semantic_similarity "$text1" "$text2")
        test_info "Score: $score"

        validate_score_range "$score" "Dissimilar pair" || continue
        validate_threshold "$score" "0.3" "<" "Dissimilar pair"
    done
}

# Test 4: Consistency across multiple invocations
test_consistency() {
    test_start "Consistency across multiple invocations"

    local text1="Fix authentication bug in user login"
    local text2="Resolve login authentication issue"
    local runs=3
    local tolerance=0.15  # Allow +/- 0.15 variance due to LLM non-determinism

    test_info "Pair: '$text1' vs '$text2'"
    test_info "Runs: $runs"
    test_info "Tolerance: +/- $tolerance"

    local scores=()
    for ((i=1; i<=runs; i++)); do
        test_info ""
        test_info "Run $i/$runs..."
        local score
        score=$(semantic_similarity "$text1" "$text2")
        scores+=("$score")
        test_info "  Score: $score"

        validate_score_range "$score" "Run $i" || continue
    done

    # Check consistency
    validate_consistency scores "$tolerance" "Multiple invocations"
}

# Test 5: Edge cases
test_edge_cases() {
    test_start "Edge cases"

    # Empty strings (should fail gracefully)
    test_info ""
    test_info "Testing empty string handling..."
    local score
    if score=$(semantic_similarity "" "test" 2>/dev/null); then
        test_fail "Empty string: Should have failed, but got score: $score"
    else
        test_pass "Empty string: Correctly rejected"
    fi

    # Very short texts
    test_info ""
    test_info "Testing very short texts..."
    score=$(semantic_similarity "Bug" "Fix")
    test_info "Score: $score"
    validate_score_range "$score" "Very short texts"

    # Very long texts (truncated for display)
    test_info ""
    test_info "Testing very long texts..."
    local long_text1="This is a very long text that describes a complex bug in the authentication system involving multiple components including the login handler session management token validation middleware database connection pooling and various edge cases related to concurrent user sessions"
    local long_text2="This is another very long text discussing the same authentication bug but with different wording and additional details about how it affects user experience and potential security implications"
    score=$(semantic_similarity "$long_text1" "$long_text2")
    test_info "Score: $score (long texts truncated for display)"
    validate_score_range "$score" "Very long texts"
}

# ==============================================================================
# MAIN
# ==============================================================================

main() {
    local skip_prompt=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-prompt)
                skip_prompt=true
                shift
                ;;
            *)
                echo "Unknown option: $1" >&2
                echo "Usage: $0 [--no-prompt]" >&2
                exit 1
                ;;
        esac
    done

    echo "============================================================"
    echo "PHASE 4: SEMANTIC SIMILARITY VALIDATION"
    echo "============================================================"
    echo "Judge model: $JUDGE_MODEL"
    echo "Cost estimate: ~$0.10-0.20 for full test suite"
    echo ""

    if [ "$skip_prompt" = false ]; then
        read -p "Press Enter to start tests (this will make real API calls)..."
    fi

    # Run all tests
    test_identical_texts
    test_similar_texts
    test_dissimilar_texts
    test_consistency
    test_edge_cases

    # Print summary
    test_summary
}

main "$@"
