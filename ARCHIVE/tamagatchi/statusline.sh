#!/bin/bash
# Enhanced colorful statusline with human-readable formatting

# Configurable threshold (default: 400K tokens = 80% of 500K context)
THRESHOLD=${CLAUDE_AUTO_COMPACT_THRESHOLD:-400000}

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
        local transcript_path=$(find ~/.claude/projects -name "${session_id}.jsonl" 2>/dev/null | head -1)
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

# Use the helpers
MODEL=$(get_model_name)
DIR=$(get_current_dir)
SESSION_ID=$(get_session_id)
RAW_COST=$(get_cost)
RAW_DURATION=$(get_duration)

# Calculate token information
TOTAL_TOKENS=$(calculate_tokens "$SESSION_ID")
PERCENTAGE=$((TOTAL_TOKENS * 100 / THRESHOLD))
if [ $PERCENTAGE -gt 100 ]; then
    PERCENTAGE=100
fi

# Format the values
COST_FORMATTED=$(format_cost "$RAW_COST")
DURATION_FORMATTED=$(format_duration "$RAW_DURATION")
TOKENS_FORMATTED=$(format_tokens "$TOTAL_TOKENS" "$PERCENTAGE")

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

# Pet detection logic - try local dev first, then global install
get_pet_status() {
    local LOCAL_PATH="/home/scott/projects/oss/claude-code-tamagotchi"
    local GLOBAL_BIN=$(which claude-code-tamagotchi 2>/dev/null)
    
    if [ -d "$LOCAL_PATH" ] && [ -f "$LOCAL_PATH/src/index.ts" ]; then
        # Local development checkout
        cd "$LOCAL_PATH" && echo "$input" | env \
            PET_SHOW_PET=false \
            PET_SHOW_STATS=false \
            PET_HUNGER_DECAY=0 \
            PET_THOUGHT_WEIGHT_NEEDS=0 \
            PET_THOUGHT_WEIGHT_CODING=50 \
            PET_THOUGHT_WEIGHT_RANDOM=30 \
            PET_THOUGHT_WEIGHT_MOOD=20 \
            PET_FEEDBACK_ENABLED=true \
            PET_GROQ_API_KEY="${GROQ_API_KEY:-}" \
            PET_FEEDBACK_DEBUG=true \
            PET_FEEDBACK_LOG_DIR="$HOME/.claude/pets/logs" \
            PET_VIOLATION_CHECK_ENABLED=true \
         bun run --silent src/index.ts 2>/dev/null
    elif [ -n "$GLOBAL_BIN" ]; then
        # Global npm/bun install with custom env vars for enhanced features
        echo "$input" | env \
            PET_SHOW_PET=false \
            PET_SHOW_STATS=false \
            PET_HUNGER_DECAY=0 \
            PET_THOUGHT_WEIGHT_NEEDS=0 \
            PET_THOUGHT_WEIGHT_CODING=50 \
            PET_THOUGHT_WEIGHT_RANDOM=30 \
            PET_THOUGHT_WEIGHT_MOOD=20 \
            PET_FEEDBACK_ENABLED=true \
            PET_GROQ_API_KEY="${GROQ_API_KEY:-}" \
            PET_FEEDBACK_DEBUG=true \
            PET_FEEDBACK_LOG_DIR="$HOME/.claude/pets/logs" \
            PET_VIOLATION_CHECK_ENABLED=true \
            claude-code-tamagotchi 2>/dev/null
    else
        # No pet available
        echo ""
    fi
}

# Get pet status
PET_STATUS=$(get_pet_status)

# Build the final statusline with pet (if available)
if [ -n "$PET_STATUS" ]; then
    echo "$PET_STATUS"
else
    # Fallback without pet
    printf "${BOLD}${BLUE}[${MODEL}]${RESET} ${DIM}|${RESET} ${TOKENS_FORMATTED} ${DIM}|${RESET} ${CYAN}%d%%${RESET} ${DIM}|${RESET} ${CYAN}📁 ${DIR##*/}${RESET}${GIT_BRANCH} ${DIM}|${RESET} ${COST_FORMATTED} ${DIM}|${RESET} ${DURATION_FORMATTED}\n" "$PERCENTAGE"
fi

