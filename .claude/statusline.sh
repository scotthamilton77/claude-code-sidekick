#!/bin/bash
# Enhanced colorful statusline with human-readable formatting

# Configurable threshold (default: 160K tokens = 80% of 200K context)
THRESHOLD=${CLAUDE_AUTO_COMPACT_THRESHOLD:-160000}

# Parse command line arguments for transcript file override
TRANSCRIPT_OVERRIDE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --transcript-file)
            TRANSCRIPT_OVERRIDE="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Read JSON input from stdin
input=$(cat)

# Color definitions (using printf for consistent terminal compatibility)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# Helper functions for common extractions
get_model_name() { echo "$input" | jq -r '.model.display_name'; }
get_current_dir() { echo "$input" | jq -r '.workspace.current_dir'; }
get_project_dir() { echo "$input" | jq -r '.workspace.project_dir'; }
get_session_id() { echo "$input" | jq -r '.session_id'; }
get_version() { echo "$input" | jq -r '.version'; }
get_cost() { echo "$input" | jq -r '.cost.total_cost_usd // "0"'; }
get_duration() { echo "$input" | jq -r '.cost.total_duration_ms // "0"'; }
get_lines_added() { echo "$input" | jq -r '.cost.total_lines_added // "0"'; }
get_lines_removed() { echo "$input" | jq -r '.cost.total_lines_removed // "0"'; }

# Format cost in human-readable way
format_cost() {
    local cost="$1"
    if [[ "$cost" == "null" ]] || [[ -z "$cost" ]] || [[ "$cost" == "0" ]]; then
        printf "${DIM}--${RESET}"
        return
    fi
    
    # Convert to cents for easier handling
    local cents=$(printf "%.0f" "$(echo "$cost * 100" | bc -l 2>/dev/null || echo "0")")
    
    if [[ $cents -eq 0 ]]; then
        printf "${DIM}<1¢${RESET}"
    elif [[ $cents -lt 100 ]]; then
        printf "${YELLOW}%d¢${RESET}" "$cents"
    elif [[ $cents -lt 10000 ]]; then  # Less than $100
        printf "${YELLOW}\$%.2f${RESET}" "$(echo "scale=2; $cents/100" | bc -l)"
    else
        printf "${RED}\$%.2f${RESET}" "$(echo "scale=2; $cents/100" | bc -l)"
    fi
}

# Format duration in human-readable way
format_duration() {
    local ms="$1"
    if [[ "$ms" == "null" ]] || [[ -z "$ms" ]] || [[ "$ms" == "0" ]]; then
        printf "${DIM}--${RESET}"
        return
    fi
    
    local seconds=$(echo "scale=1; $ms/1000" | bc -l 2>/dev/null || echo "0")
    
    # Handle different time ranges with appropriate colors and units
    if (( $(echo "$seconds < 1" | bc -l) )); then
        printf "${GREEN}%dms${RESET}" "$ms"
    elif (( $(echo "$seconds < 60" | bc -l) )); then
        if (( $(echo "$seconds < 10" | bc -l) )); then
            printf "${GREEN}%.1fs${RESET}" "$seconds"
        else
            printf "${YELLOW}%.0fs${RESET}" "$seconds"
        fi
    elif (( $(echo "$seconds < 3600" | bc -l) )); then  # Less than 1 hour
        local minutes=$(echo "scale=1; $seconds/60" | bc -l)
        printf "${YELLOW}%.1fm${RESET}" "$minutes"
    else  # 1 hour or more
        local hours=$(echo "scale=1; $seconds/3600" | bc -l)
        printf "${RED}%.1fh${RESET}" "$hours"
    fi
}

# Calculate tokens from transcript
calculate_tokens() {
    local session_id="$1"
    local total_tokens=0

    if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
        local transcript_path
        if [ -n "$TRANSCRIPT_OVERRIDE" ]; then
            transcript_path="$TRANSCRIPT_OVERRIDE"
        else
            transcript_path=$(find ~/.claude/projects -name "${session_id}.jsonl" 2>/dev/null | head -1)
        fi

        if [ -f "$transcript_path" ]; then
            # Estimate tokens (rough approximation: 1 token per 4 characters)
            local total_chars=$(wc -c < "$transcript_path")
            total_tokens=$((total_chars / 4))
        fi
    fi

    echo "$total_tokens"
}

# Format token count with K notation and color
format_tokens() {
    local total_tokens="$1"
    local percentage="$2"

    if [ "$total_tokens" -eq 0 ]; then
        printf "${DIM}0${RESET}"
        return
    fi

    # Format with K notation
    local token_display
    if [ $total_tokens -ge 1000 ]; then
        token_display=$(echo "scale=1; $total_tokens / 1000" | bc)"K"
    else
        token_display="$total_tokens"
    fi

    # Color based on percentage
    if [ $percentage -ge 90 ]; then
        printf "${RED}🪙 %s${RESET}" "$token_display"
    elif [ $percentage -ge 70 ]; then
        printf "${YELLOW}🪙 %s${RESET}" "$token_display"
    else
        printf "${GREEN}🪙 %s${RESET}" "$token_display"
    fi
}

# Extract session topic from LLM-generated analytics JSON
get_session_topic() {
    local session_id="$1"

    if [ -z "$session_id" ] || [ "$session_id" == "null" ]; then
        printf "${DIM}--${RESET}"
        return
    fi

    # Determine tmp directory based on script location (dual-scope compatible)
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local tmp_dir="${script_dir}/hooks/reminders/tmp"
    local analytics_file="${tmp_dir}/${session_id}_topic.json"

    # Check for JSON analytics file
    if [ ! -f "$analytics_file" ]; then
        printf "${DIM}--${RESET}"
        return
    fi

    # Parse JSON fields
    local task_ids=$(jq -r '.task_ids // empty' "$analytics_file" 2>/dev/null)
    local initial_goal=$(jq -r '.initial_goal // empty' "$analytics_file" 2>/dev/null)
    local current_objective=$(jq -r '.current_objective // empty' "$analytics_file" 2>/dev/null)
    local clarity_score=$(jq -r '.clarity_score // 5' "$analytics_file" 2>/dev/null)

    # Choose snarky comment based on clarity score (7+ = high clarity)
    local snarky_comment
    if [ "$clarity_score" -ge 7 ] 2>/dev/null; then
        snarky_comment=$(jq -r '.high_clarity_snarky_comment // empty' "$analytics_file" 2>/dev/null)
    else
        snarky_comment=$(jq -r '.low_clarity_snarky_comment // empty' "$analytics_file" 2>/dev/null)
    fi

    # Build output: [$tasks]: $initial_goal / $current_objective\n$snarky_comment
    local output=""

    # Add task IDs prefix if present
    if [ -n "$task_ids" ]; then
        output="${CYAN}[${task_ids}]${RESET}: "
    fi

    # Add goals with separator
    if [ -n "$initial_goal" ]; then
        output="${output}${MAGENTA}${initial_goal}${RESET}"
    fi
    if [ -n "$current_objective" ]; then
        if [ -n "$initial_goal" ]; then
            output="${output} ${DIM}/${RESET} ${MAGENTA}${current_objective}${RESET}"
        else
            output="${output}${MAGENTA}${current_objective}${RESET}"
        fi
    fi

    # Add snarky comment on new line
    if [ -n "$snarky_comment" ]; then
        output="${output}\n${YELLOW}${snarky_comment}${RESET}"
    fi

    # Output or fallback to default
    if [ -n "$output" ]; then
        printf "$output"
    else
        printf "${DIM}--${RESET}"
    fi
}

# Use the helpers
MODEL=$(get_model_name)
DIR=$(get_current_dir)
SESSION_ID=$(get_session_id)
RAW_DURATION=$(get_duration)

# Calculate token information
TOTAL_TOKENS=$(calculate_tokens "$SESSION_ID")
PERCENTAGE=$((TOTAL_TOKENS * 100 / THRESHOLD))
if [ $PERCENTAGE -gt 100 ]; then
    PERCENTAGE=100
fi

# Format the values
DURATION_FORMATTED=$(format_duration "$RAW_DURATION")
TOKENS_FORMATTED=$(format_tokens "$TOTAL_TOKENS" "$PERCENTAGE")
TOPIC_FORMATTED=$(get_session_topic "$SESSION_ID")

# Show git branch if in a git repo with enhanced formatting
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    if [ -n "$BRANCH" ]; then
        # Color branch based on name patterns
        if [[ "$BRANCH" == "main" ]] || [[ "$BRANCH" == "master" ]]; then
            GIT_BRANCH=" ${DIM}|${RESET} ${GREEN}⎇ ${BRANCH}${RESET}"
        elif [[ "$BRANCH" == feature/* ]] || [[ "$BRANCH" == feat/* ]]; then
            GIT_BRANCH=" ${DIM}|${RESET} ${BLUE}⎇ ${BRANCH}${RESET}"
        elif [[ "$BRANCH" == hotfix/* ]] || [[ "$BRANCH" == fix/* ]]; then
            GIT_BRANCH=" ${DIM}|${RESET} ${RED}⎇ ${BRANCH}${RESET}"
        else
            GIT_BRANCH=" ${DIM}|${RESET} ${MAGENTA}⎇ ${BRANCH}${RESET}"
        fi
    fi
fi

# Build the final statusline with consistent spacing and colors
printf "${BOLD}${BLUE}[${MODEL}]${RESET} ${DIM}|${RESET} ${TOKENS_FORMATTED} ${DIM}|${RESET} ${CYAN}%d%%${RESET} ${DIM}|${RESET} ${CYAN}📁 ${DIR##*/}${RESET}${GIT_BRANCH} ${DIM}|${RESET} ${DURATION_FORMATTED} ${DIM}|${RESET} ${TOPIC_FORMATTED}\n" "$PERCENTAGE"

