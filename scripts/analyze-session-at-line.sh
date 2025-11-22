#!/bin/bash
###############################################################################
# analyze-session-at-line.sh
#
# Surgical session summary tool - analyzes transcript up to a specific line
# and saves all intermediate artifacts (excerpt, prompt, summary).
# Maintains summary continuity by finding and using the previous summary analysis
# for significance change detection.
#
# Usage:
#   ./scripts/analyze-session-at-line.sh <session-id-or-path> --to-line N [OPTIONS]
#
# Arguments:
#   <session-id-or-path>   Session ID (looks in ~/.claude/projects/) or
#                          path to transcript.jsonl file
#
# Required Options:
#   --to-line N                Analyze transcript up to and including line N
#
# Optional:
#   --output-dir DIR           Output directory (default: test-data/session-analysis/)
#   --provider PROVIDER        LLM provider (default: openrouter)
#   --model MODEL              Model name (default: google/gemini-2.5-flash-lite)
#   --use-revised              Use ####-prompt-revised.txt instead of building prompt,
#                              outputs to ####-session-revised.json
#
# Output:
#   <output-dir>/<session-id>/
#     ├── 0100-transcript.jsonl          # Raw transcript lines 1-100
#     ├── 0100-excerpt.json              # Preprocessed (tiered or full, what LLM sees)
#     ├── 0100-prompt.txt                # Complete prompt sent to LLM (bookmark or basic)
#     ├── 0100-json-schema.json          # JSON schema passed to LLM
#     ├── 0100-session-summary.json      # Extracted session result
#     ├── 0100-state.sh                  # State file (bookmark, countdowns) for next analysis
#     ├── 0100-prompt-revised.txt        # Optional: manually edited prompt
#     ├── 0100-json-schema-revised.json  # Optional: manually edited schema
#     └── 0100-session-revised.json      # Result from revised prompt/schema (--use-revised)
#
# Session Continuity & Tiered Extraction:
#   Before analysis, scans output directory for previous session files
#   (####-session-summary.json where #### < target line) and uses the highest one.
#   Loads previous state file (####-state.sh) to get bookmark from confidence scores.
#
#   If bookmark > 0:
#     - Uses tiered extraction (historical + recent with different filtering)
#     - Loads session-summary-bookmark.prompt.txt
#   Otherwise:
#     - Uses full extraction with standard filtering
#     - Loads session-summary.prompt.txt
#
#   After analysis, writes new state file with:
#     - SUMMARY_TITLE_CONFIDENCE_BOOKMARK (set if confidence >= 0.8)
#     - SUMMARY_TITLE_COUNTDOWN (5/20/10000 based on confidence)
#     - SUMMARY_INTENT_COUNTDOWN (5/20/10000 based on confidence)
#
# Examples:
#   # First analysis - no previous
#   ./scripts/analyze-session-at-line.sh abc123 --to-line 100
#
#   # Second analysis - uses 0100-session-summary.json as previous
#   ./scripts/analyze-session-at-line.sh abc123 --to-line 200
#
#   # Works out of order - uses 0100-session-summary.json (highest < 150)
#   ./scripts/analyze-session-at-line.sh abc123 --to-line 150
#
#   # Test revised prompt - edit 0100-prompt.txt, save as 0100-prompt-revised.txt
#   ./scripts/analyze-session-at-line.sh abc123 --to-line 100 --use-revised
###############################################################################

set -euo pipefail

# Check for help first (before parsing positional args)
if [ $# -eq 0 ] || [[ "${1:-}" =~ ^(-h|--help)$ ]]; then
    # Extract documentation header (lines 2-54, skip shebang)
    sed -n '2,54p' "$0" | sed 's/^# *//' | sed 's/^#$//'
    exit 0
fi

# Parse arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <session-id-or-path> --to-line N [OPTIONS]"
    echo "Run with --help for details"
    exit 1
fi

INPUT="$1"
shift

# Default configuration
PROVIDER="openrouter"
MODEL="google/gemini-2.5-flash-lite"
OUTPUT_DIR="test-data/session-analysis"
TO_LINE=-1  # Required
USE_REVISED=false  # Use revised prompt instead of building

# Parse options
while [[ $# -gt 0 ]]; do
    case "$1" in
        --to-line)
            TO_LINE="$2"
            shift 2
            ;;
        --provider)
            PROVIDER="$2"
            shift 2
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --use-revised)
            USE_REVISED=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ "$TO_LINE" -le 0 ]; then
    echo "ERROR: --to-line is required and must be > 0"
    echo "Run with --help for usage"
    exit 1
fi

###############################################################################
# Setup
###############################################################################

echo "=============================================="
echo "Surgical Session Summary"
echo "=============================================="
echo ""
echo "Input:            $INPUT"
echo "Target line:      $TO_LINE"
echo "Provider:         $PROVIDER"
echo "Model:            $MODEL"
echo "Output dir:       $OUTPUT_DIR"
echo ""

# Determine transcript path
if [ -f "$INPUT" ]; then
    # Direct path to transcript
    TRANSCRIPT_PATH="$INPUT"
    SESSION_ID=$(basename "$INPUT" .jsonl)
elif [[ "$INPUT" == *.jsonl ]]; then
    # Looks like a filename, search in projects
    TRANSCRIPT_PATH="${HOME}/.claude/projects/*/${INPUT}"
    TRANSCRIPT_PATH=$(ls $TRANSCRIPT_PATH 2>/dev/null | head -1 || echo "")
    SESSION_ID=$(basename "$INPUT" .jsonl)
else
    # Session ID - search for matching transcript
    TRANSCRIPT_PATH="${HOME}/.claude/projects/*/${INPUT}.jsonl"
    TRANSCRIPT_PATH=$(ls $TRANSCRIPT_PATH 2>/dev/null | head -1 || echo "")
    SESSION_ID="$INPUT"
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    echo "ERROR: Transcript not found: $INPUT"
    echo ""
    echo "Searched:"
    echo "  - Direct path: $INPUT"
    echo "  - Session ID: ~/.claude/projects/*/${INPUT}.jsonl"
    exit 1
fi

echo "Transcript:       $TRANSCRIPT_PATH"
TOTAL_LINES=$(wc -l < "$TRANSCRIPT_PATH")
echo "Total messages:   $TOTAL_LINES"

# Validate TO_LINE is within bounds
if [ "$TO_LINE" -gt "$TOTAL_LINES" ]; then
    echo "ERROR: --to-line $TO_LINE exceeds transcript length ($TOTAL_LINES lines)"
    exit 1
fi

echo ""

# Load .env for API keys
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
    echo "[INFO] Loaded .env file"
fi

# Verify Sidekick source
SIDEKICK_ROOT="src/sidekick"
if [ ! -d "$SIDEKICK_ROOT" ]; then
    echo "ERROR: Sidekick source not found: $SIDEKICK_ROOT"
    exit 1
fi

# Set project directory for path resolution
export CLAUDE_PROJECT_DIR="$PWD"

# Load Sidekick libraries
export SIDEKICK_ROOT_OVERRIDE="$PWD/$SIDEKICK_ROOT"
source "$SIDEKICK_ROOT/lib/common.sh"

# Load transcript library for filtering functions
if [ ! -f "$SIDEKICK_ROOT/lib/transcript.sh" ]; then
    echo "ERROR: transcript.sh not found"
    exit 1
fi
source "$SIDEKICK_ROOT/lib/transcript.sh"

# Initialize logging
log_init "analyze-${SESSION_ID}-line${TO_LINE}"

# Helper: Resolve path with source tree fallback (for development use)
_resolve_path_with_source_fallback() {
    local relative_path="$1"
    local result

    # Try installed locations first
    if result=$(path_resolve_cascade "$relative_path" "$CLAUDE_PROJECT_DIR" 2>/dev/null); then
        echo "$result"
        return 0
    fi

    # Fallback: Check source tree (for development)
    local source_path="${CLAUDE_PROJECT_DIR}/${SIDEKICK_ROOT}/${relative_path}"
    if [ -f "$source_path" ]; then
        echo "$source_path"
        return 0
    fi

    # Not found
    return 1
}

# Write state file with bookmark calculation (matches production logic)
_write_state_file() {
    local output_dir="$1"
    local line_num="$2"
    local session_summary_json="$3"
    local previous_bookmark="${4:-0}"

    local file_prefix=$(printf '%04d' "$line_num")
    local state_file="${output_dir}/${file_prefix}-state.sh"

    # Extract confidence scores
    local title_conf=$(echo "$session_summary_json" | jq -r '.session_title_confidence // 0')
    local intent_conf=$(echo "$session_summary_json" | jq -r '.latest_intent_confidence // 0')

    # Calculate countdowns (same logic as production, lines 229-253)
    local low_reset=${SUMMARY_COUNTDOWN_LOW:-5}
    local med_reset=${SUMMARY_COUNTDOWN_MED:-20}
    local high_reset=${SUMMARY_COUNTDOWN_HIGH:-10000}

    local title_countdown=$low_reset
    if [ $(awk "BEGIN {print ($title_conf < 0.6)}") -eq 1 ]; then
        title_countdown=$low_reset
    elif [ $(awk "BEGIN {print ($title_conf < 0.8)}") -eq 1 ]; then
        title_countdown=$med_reset
    else
        title_countdown=$high_reset
    fi

    local intent_countdown=$low_reset
    if [ $(awk "BEGIN {print ($intent_conf < 0.6)}") -eq 1 ]; then
        intent_countdown=$low_reset
    elif [ $(awk "BEGIN {print ($intent_conf < 0.8)}") -eq 1 ]; then
        intent_countdown=$med_reset
    else
        intent_countdown=$high_reset
    fi

    # Bookmark logic (same as production, lines 256-272)
    local bookmark_enabled=${SUMMARY_BOOKMARK_ENABLED:-true}
    local new_bookmark=$previous_bookmark

    if [ "$bookmark_enabled" = "true" ]; then
        local bookmark_threshold=${SUMMARY_BOOKMARK_CONFIDENCE_THRESHOLD:-0.8}
        local reset_threshold=${SUMMARY_BOOKMARK_RESET_THRESHOLD:-0.7}

        # Set bookmark if title confidence >= threshold
        if [ $(awk "BEGIN {print ($title_conf >= $bookmark_threshold)}") -eq 1 ]; then
            new_bookmark=$line_num
        elif [ $(awk "BEGIN {print ($title_conf < $reset_threshold)}") -eq 1 ]; then
            # Reset if drops below reset threshold
            new_bookmark=0
        fi
    fi

    # Write state file
    cat <<STATE > "$state_file"
SUMMARY_TITLE_COUNTDOWN=$title_countdown
SUMMARY_INTENT_COUNTDOWN=$intent_countdown
SUMMARY_TITLE_CONFIDENCE_BOOKMARK=$new_bookmark
STATE

    echo "  State saved: bookmark=$new_bookmark, title_conf=$title_conf"
}

# Load session summary feature
if [ ! -f "$SIDEKICK_ROOT/features/session-summary.sh" ]; then
    echo "ERROR: session-summary.sh not found"
    exit 1
fi
source "$SIDEKICK_ROOT/features/session-summary.sh"

# Configure features
export FEATURE_SESSION_SUMMARY=true
export FEATURE_STATUSLINE=true  # Required dependency
export LLM_PROVIDER="$PROVIDER"
if [ "$PROVIDER" = "openrouter" ]; then
    export LLM_OPENROUTER_MODEL="$MODEL"
elif [ "$PROVIDER" = "openai-api" ]; then
    export LLM_OPENAI_MODEL="$MODEL"
elif [ "$PROVIDER" = "claude-cli" ]; then
    export LLM_CLAUDE_MODEL="$MODEL"
fi

log_info "Sidekick libraries loaded"
log_info "Session summary configured: $PROVIDER / $MODEL"

# Create output directory
SESSION_OUTPUT_DIR="${OUTPUT_DIR}/${SESSION_ID}"
mkdir -p "$SESSION_OUTPUT_DIR"
echo "Session output:   $SESSION_OUTPUT_DIR"
echo ""

###############################################################################
# Find Previous Session (Session Continuity)
###############################################################################

find_previous_session() {
    local target_line=$1
    local output_dir=$2

    # Find all existing session files in format ####-session-summary.json
    local previous_session_file=""
    local highest_line=0

    for session_file in "$output_dir"/[0-9][0-9][0-9][0-9]-session-summary.json; do
        if [ -f "$session_file" ]; then
            # Extract line number from filename
            local line_num=$(basename "$session_file" | sed 's/^0*//' | sed 's/-session-summary.json$//')
            # Handle edge case where line_num is empty (0000)
            [ -z "$line_num" ] && line_num=0

            # Check if this is less than target and higher than current highest
            if [ "$line_num" -lt "$target_line" ] && [ "$line_num" -gt "$highest_line" ]; then
                highest_line=$line_num
                previous_session_file="$session_file"
            fi
        fi
    done

    if [ -n "$previous_session_file" ]; then
        echo "$previous_session_file"
    else
        echo ""
    fi
}

echo "Finding previous session analysis..."
PREVIOUS_SESSION_FILE=$(find_previous_session "$TO_LINE" "$SESSION_OUTPUT_DIR")

# Initialize state variables
PREVIOUS_BOOKMARK=0
PREVIOUS_SESSION_JSON=""

if [ -n "$PREVIOUS_SESSION_FILE" ]; then
    PREVIOUS_LINE=$(basename "$PREVIOUS_SESSION_FILE" | sed 's/^0*//' | sed 's/-session-summary.json$//')
    [ -z "$PREVIOUS_LINE" ] && PREVIOUS_LINE=0

    # Load previous state file to get bookmark
    PREVIOUS_STATE_FILE="${SESSION_OUTPUT_DIR}/$(printf '%04d' "$PREVIOUS_LINE")-state.sh"
    if [ -f "$PREVIOUS_STATE_FILE" ]; then
        source "$PREVIOUS_STATE_FILE"
        PREVIOUS_BOOKMARK=$SUMMARY_TITLE_CONFIDENCE_BOOKMARK
        echo "Found previous:   Line $PREVIOUS_LINE (bookmark: $PREVIOUS_BOOKMARK)"
    else
        # Fallback: use previous line as bookmark if no state file
        PREVIOUS_BOOKMARK=$PREVIOUS_LINE
        echo "Found previous:   Line $PREVIOUS_LINE (no state file, using line as bookmark)"
    fi

    PREVIOUS_SESSION_JSON=$(cat "$PREVIOUS_SESSION_FILE")
else
    echo "No previous session found (first analysis)"
fi
echo ""

###############################################################################
# Extract and Preprocess Transcript (Tiered if bookmark exists)
###############################################################################

echo "Extracting transcript lines 1-${TO_LINE}..."

# Create temporary working directory
TEMP_WORK_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_WORK_DIR'" EXIT

TEMP_TRANSCRIPT="${TEMP_WORK_DIR}/transcript.jsonl"

# Extract lines 1 to TO_LINE
head -n "$TO_LINE" "$TRANSCRIPT_PATH" > "$TEMP_TRANSCRIPT"

# Determine if we should use tiered extraction (bookmark logic)
USE_TIERED=false
BOOKMARK_LINE=$PREVIOUS_BOOKMARK

if [ "$BOOKMARK_LINE" -gt 0 ] && [ "$TO_LINE" -gt "$BOOKMARK_LINE" ]; then
    USE_TIERED=true
    LINE_DELTA=$((TO_LINE - BOOKMARK_LINE))
    echo "Using tiered extraction (bookmark at line $BOOKMARK_LINE, delta: $LINE_DELTA)"
fi

if [ "$USE_TIERED" = "true" ]; then
    echo "Preprocessing transcript (tiered: historical + recent)..."

    # Historical: lines 1 to bookmark_line (aggressive filtering)
    filter_historical=$(transcript_build_filter "true")
    sed -n "1,${BOOKMARK_LINE}p" "$TEMP_TRANSCRIPT" | jq -c "$filter_historical" | jq -s '.' > "${TEMP_WORK_DIR}/historical.json"

    # Recent: lines bookmark_line+1 to TO_LINE (light filtering)
    filter_recent=$(transcript_build_filter "false")
    sed -n "$((BOOKMARK_LINE+1)),${TO_LINE}p" "$TEMP_TRANSCRIPT" | jq -c "$filter_recent" | jq -s '.' > "${TEMP_WORK_DIR}/recent.json"

    # Validate minimum context preservation
    MIN_USER_MSGS=${SUMMARY_MIN_USER_MESSAGES:-5}
    MIN_RECENT_LINES=${SUMMARY_MIN_RECENT_LINES:-50}

    USER_MSG_COUNT=$(jq -n --slurpfile h "${TEMP_WORK_DIR}/historical.json" --slurpfile r "${TEMP_WORK_DIR}/recent.json" \
        '($h[0] + $r[0]) | map(select(.role == "user")) | length')

    COMBINED_LINE_COUNT=$(jq -n --slurpfile h "${TEMP_WORK_DIR}/historical.json" --slurpfile r "${TEMP_WORK_DIR}/recent.json" \
        '($h[0] + $r[0]) | length')

    # Fall back to full extraction if insufficient context
    if [ "$USER_MSG_COUNT" -lt "$MIN_USER_MSGS" ] || [ "$COMBINED_LINE_COUNT" -lt "$MIN_RECENT_LINES" ]; then
        echo "Insufficient context (users=$USER_MSG_COUNT/$MIN_USER_MSGS, lines=$COMBINED_LINE_COUNT/$MIN_RECENT_LINES), falling back to full extraction"
        USE_TIERED=false
    else
        # Build tiered excerpt JSON
        EXCERPT_JSON=$(jq -n --slurpfile h "${TEMP_WORK_DIR}/historical.json" --slurpfile r "${TEMP_WORK_DIR}/recent.json" \
            --arg bl "$BOOKMARK_LINE" --arg cl "$TO_LINE" \
            '{historical: $h[0], recent: $r[0], bookmark_line: $bl, current_line: $cl, type: "tiered"}')

        HISTORICAL_COUNT=$(jq 'length' "${TEMP_WORK_DIR}/historical.json")
        RECENT_COUNT=$(jq 'length' "${TEMP_WORK_DIR}/recent.json")
        echo "Tiered result:    $HISTORICAL_COUNT historical + $RECENT_COUNT recent messages"
    fi
fi

if [ "$USE_TIERED" = "false" ]; then
    echo "Preprocessing transcript (full extraction with standard filtering)..."

    # Use same filtering logic as production (from lib/transcript.sh)
    FILTER_TOOLS=${SUMMARY_FILTER_TOOL_MESSAGES:-true}
    JQ_FILTER=$(transcript_build_filter "$FILTER_TOOLS")

    # Apply filter and wrap in JSON array
    jq -c "$JQ_FILTER" "$TEMP_TRANSCRIPT" | jq -s '.' > "${TEMP_WORK_DIR}/filtered.json"

    # Build full excerpt JSON
    EXCERPT_JSON=$(jq -n --slurpfile t "${TEMP_WORK_DIR}/filtered.json" '{transcript: $t[0], type: "full"}')

    FILTERED_COUNT=$(jq 'length' "${TEMP_WORK_DIR}/filtered.json")
    echo "Filtered result:  $FILTERED_COUNT messages (from $TO_LINE raw lines)"
fi

echo ""

###############################################################################
# Build Complete Prompt (or load revised)
###############################################################################

# Generate output file prefix early (needed for revised prompt detection)
FILE_PREFIX=$(printf '%04d' "$TO_LINE")

# Determine if using revised prompt
if [ "$USE_REVISED" = true ]; then
    # Check for revised prompt file
    REVISED_PROMPT_FILE="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt-revised.txt"

    if [ ! -f "$REVISED_PROMPT_FILE" ]; then
        echo "ERROR: --use-revised specified but file not found:"
        echo "  $REVISED_PROMPT_FILE"
        echo ""
        echo "Workflow:"
        echo "  1. Run analysis normally to generate ${FILE_PREFIX}-prompt.txt"
        echo "  2. Edit and save as ${FILE_PREFIX}-prompt-revised.txt"
        echo "  3. Run again with --use-revised flag"
        exit 1
    fi

    echo "Loading revised prompt..."
    echo "  Source: ${FILE_PREFIX}-prompt-revised.txt"
    PROMPT_TEXT=$(cat "$REVISED_PROMPT_FILE")
    echo "  Size: $(wc -c < "$REVISED_PROMPT_FILE") bytes"
    echo ""
else
    echo "Building complete prompt..."

    # Detect excerpt type
    EXCERPT_TYPE=$(echo "$EXCERPT_JSON" | jq -r '.type')
    echo "  Excerpt type: $EXCERPT_TYPE"

    # Load schema (common to both types)
    if ! SCHEMA_PATH=$(_resolve_path_with_source_fallback "prompts/session-summary.schema.json"); then
        log_error "Schema not found: prompts/session-summary.schema.json"
        exit 1
    fi
    SCHEMA_JSON=$(cat "$SCHEMA_PATH")

    # Save schema as artifact for reference/revision
    TEMP_SCHEMA="${TEMP_WORK_DIR}/schema.json"
    echo "$SCHEMA_JSON" > "$TEMP_SCHEMA"

    # Load previous summary for confidence extraction
    PREVIOUS_CONFIDENCE="0.0"
    if [ -n "$PREVIOUS_SESSION_JSON" ]; then
        PREVIOUS_CONFIDENCE=$(echo "$PREVIOUS_SESSION_JSON" | jq -r '.session_title_confidence // 0.0')
    fi

    # Load appropriate prompt template and build substitutions
    if [ "$EXCERPT_TYPE" = "tiered" ]; then
        # Tiered/bookmark mode
        if ! PROMPT_TEMPLATE_PATH=$(_resolve_path_with_source_fallback "prompts/session-summary-bookmark.prompt.txt"); then
            log_error "Bookmark prompt template not found: prompts/session-summary-bookmark.prompt.txt"
            exit 1
        fi

        PROMPT_TEMPLATE=$(cat "$PROMPT_TEMPLATE_PATH")

        # Extract tiered components (pretty-printed for readability)
        HISTORICAL_TRANSCRIPT=$(cat "${TEMP_WORK_DIR}/historical.json")
        RECENT_TRANSCRIPT=$(cat "${TEMP_WORK_DIR}/recent.json")
        EXCERPT_BOOKMARK_LINE=$(echo "$EXCERPT_JSON" | jq -r '.bookmark_line')
        EXCERPT_CURRENT_LINE=$(echo "$EXCERPT_JSON" | jq -r '.current_line')
        BOOKMARK_LINE_PLUS_1=$((EXCERPT_BOOKMARK_LINE + 1))

        # Build prompt with tiered substitutions
        PROMPT_TEXT="$PROMPT_TEMPLATE"
        PROMPT_TEXT="${PROMPT_TEXT//\{BOOKMARK_LINE\}/$EXCERPT_BOOKMARK_LINE}"
        PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_CONFIDENCE\}/$PREVIOUS_CONFIDENCE}"
        PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_SESSION\}/$PREVIOUS_SESSION_JSON}"
        PROMPT_TEXT="${PROMPT_TEXT//\{HISTORICAL_TRANSCRIPT\}/$HISTORICAL_TRANSCRIPT}"
        PROMPT_TEXT="${PROMPT_TEXT//\{BOOKMARK_LINE_PLUS_1\}/$BOOKMARK_LINE_PLUS_1}"
        PROMPT_TEXT="${PROMPT_TEXT//\{CURRENT_LINE\}/$EXCERPT_CURRENT_LINE}"
        PROMPT_TEXT="${PROMPT_TEXT//\{RECENT_TRANSCRIPT\}/$RECENT_TRANSCRIPT}"

    else
        # Full mode
        if ! PROMPT_TEMPLATE_PATH=$(_resolve_path_with_source_fallback "prompts/session-summary.prompt.txt"); then
            log_error "Prompt template not found: prompts/session-summary.prompt.txt"
            exit 1
        fi

        PROMPT_TEMPLATE=$(cat "$PROMPT_TEMPLATE_PATH")

        # Extract full transcript (pretty-printed for readability)
        TRANSCRIPT_JSON=$(cat "${TEMP_WORK_DIR}/filtered.json")

        # Build prompt with full substitutions
        PROMPT_TEXT="$PROMPT_TEMPLATE"
        PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_CONFIDENCE\}/$PREVIOUS_CONFIDENCE}"

        # Handle PREVIOUS_SESSION substitution (null if empty)
        if [ -n "$PREVIOUS_SESSION_JSON" ]; then
            PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_SESSION\}/$PREVIOUS_SESSION_JSON}"
        else
            PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_SESSION\}/null}"
        fi

        PROMPT_TEXT="${PROMPT_TEXT//\{TRANSCRIPT\}/$TRANSCRIPT_JSON}"
    fi

    # Save to file for artifact
    TEMP_PROMPT="${TEMP_WORK_DIR}/prompt.txt"
    echo "$PROMPT_TEXT" > "$TEMP_PROMPT"

    echo "  Prompt built ($(wc -c < "$TEMP_PROMPT") bytes)"
    echo ""
fi  # End of USE_REVISED conditional


###############################################################################
# Invoke LLM
###############################################################################

echo "Invoking LLM ($PROVIDER / $MODEL)..."
export LOG_LEVEL=ERROR  # Suppress debug logs for cleaner output

# Load JSON schema for LLM (check for revised version first)
if [ "$USE_REVISED" = true ]; then
    REVISED_SCHEMA_FILE="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema-revised.json"
    if [ -f "$REVISED_SCHEMA_FILE" ]; then
        echo "  Using revised JSON schema: ${FILE_PREFIX}-json-schema-revised.json"
        JSON_SCHEMA=$(cat "$REVISED_SCHEMA_FILE")
    else
        echo "  No revised schema found, using default"
        JSON_SCHEMA=$(llm_load_schema "session-summary.schema")
    fi
else
    JSON_SCHEMA=$(llm_load_schema "session-summary.schema")
fi

# Invoke LLM with schema
if ! llm_output=$(llm_invoke "$MODEL" "$PROMPT_TEXT" 60 "$JSON_SCHEMA"); then
    echo "ERROR: LLM invocation failed"
    echo "$llm_output" | head -20
    exit 1
fi

# Extract JSON from output (handles markdown wrapping)
session_summary_json=$(llm_extract_json "$llm_output")

# Validate JSON
if ! json_validate "$session_summary_json"; then
    echo "ERROR: Invalid JSON response from LLM"
    echo "$session_summary_json" | head -20
    exit 1
fi

echo "Session summary extracted successfully"
echo ""

###############################################################################
# Save Artifacts
###############################################################################

echo "Saving artifacts..."

# Determine output files based on mode
if [ "$USE_REVISED" = true ]; then
    # Revised mode: only save revised session summary
    ARTIFACT_SESSION_FILE="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-session-revised.json"
    echo "$session_summary_json" | jq '.' > "$ARTIFACT_SESSION_FILE"
    echo "  → ${FILE_PREFIX}-session-revised.json"
else
    # Normal mode: save all artifacts
    ARTIFACT_TRANSCRIPT="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-transcript.jsonl"
    ARTIFACT_EXCERPT="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-excerpt.json"
    ARTIFACT_PROMPT="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt"
    ARTIFACT_SCHEMA="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json"
    ARTIFACT_SESSION_FILE="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-session-summary.json"

    cp "$TEMP_TRANSCRIPT" "$ARTIFACT_TRANSCRIPT"
    echo "$EXCERPT_JSON" | jq '.' > "$ARTIFACT_EXCERPT"
    cp "$TEMP_PROMPT" "$ARTIFACT_PROMPT"
    cp "$TEMP_SCHEMA" "$ARTIFACT_SCHEMA"
    echo "$session_summary_json" | jq '.' > "$ARTIFACT_SESSION_FILE"

    echo "  → ${FILE_PREFIX}-transcript.jsonl  (raw, $TO_LINE lines)"

    # Describe excerpt based on type
    if [ "$EXCERPT_TYPE" = "tiered" ]; then
        HIST_COUNT=$(echo "$EXCERPT_JSON" | jq '.historical | length')
        REC_COUNT=$(echo "$EXCERPT_JSON" | jq '.recent | length')
        echo "  → ${FILE_PREFIX}-excerpt.json      (tiered: $HIST_COUNT historical + $REC_COUNT recent)"
    else
        EXCERPT_COUNT=$(echo "$EXCERPT_JSON" | jq '.transcript | length')
        echo "  → ${FILE_PREFIX}-excerpt.json      (full: $EXCERPT_COUNT messages)"
    fi

    echo "  → ${FILE_PREFIX}-prompt.txt        ($(wc -c < "$ARTIFACT_PROMPT") bytes)"
    echo "  → ${FILE_PREFIX}-json-schema.json  ($(wc -c < "$ARTIFACT_SCHEMA") bytes)"
    echo "  → ${FILE_PREFIX}-session-summary.json"
fi

# Write state file (production-compatible bookmark tracking)
_write_state_file "$SESSION_OUTPUT_DIR" "$TO_LINE" "$session_summary_json" "$PREVIOUS_BOOKMARK"
echo "  → ${FILE_PREFIX}-state.sh"
echo ""

###############################################################################
# Summary
###############################################################################

echo "=============================================="
echo "Analysis Complete"
echo "=============================================="
echo ""
echo "Output directory: $SESSION_OUTPUT_DIR"
echo ""

# Extract key fields for display
clarity=$(echo "$session_summary_json" | jq -r '.clarity_score // "N/A"')
significant_change=$(echo "$session_summary_json" | jq -r '.significant_change // "N/A"')
initial_goal=$(echo "$session_summary_json" | jq -r '.initial_goal // "N/A"' | head -c 80)

echo "Results:"
echo "  Clarity score:       $clarity"
echo "  Significant change:  $significant_change"
echo "  Initial goal:        ${initial_goal}..."
echo ""

echo "Next steps:"
echo "  # View extracted session summary"
echo "  cat $ARTIFACT_SESSION_FILE"
echo ""

if [ "$USE_REVISED" = false ]; then
    echo "  # View excerpt (LLM input - tiered or full)"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-excerpt.json | jq"
    echo ""
    echo "  # View complete prompt and schema"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json"
    echo ""
    echo "  # Edit prompt/schema and test revision"
    echo "  cp ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt-revised.txt"
    echo "  cp ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema-revised.json"
    echo "  # ... edit the revised files ..."
    echo "  ./scripts/analyze-session-at-line.sh $SESSION_ID --to-line $TO_LINE --use-revised"
    echo ""
fi

echo "  # Analyze next checkpoint"
echo "  ./scripts/analyze-session-at-line.sh $SESSION_ID --to-line $((TO_LINE + 100))"
echo ""
