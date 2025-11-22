#!/bin/bash
###############################################################################
# replay-session-summary.sh
#
# Simulates how session summary evolves as a transcript grows, mimicking
# the production sleeper process behavior. Useful for tuning extraction logic
# and observing how summaries evolve over time.
#
# Usage:
#   ./scripts/replay-session-summary.sh <session-id-or-path> [OPTIONS]
#
# Arguments:
#   <session-id-or-path>   Session ID (looks in ~/.claude/projects/) or
#                          path to transcript.jsonl file
#
# Options:
#   --provider PROVIDER        LLM provider (default: openrouter)
#   --model MODEL              Model name (default: google/gemini-2.5-flash-lite)
#   --output-dir DIR           Output directory (default: replay-results/)
#   --min-size-change BYTES    Minimum transcript growth to trigger (default: 500)
#   --min-interval SECONDS     Minimum time between analyses (default: 10)
#   --time-increment SECONDS   Simulated time advance per iteration (default: 10)
#   --messages-per-tick N      Messages to add per iteration (default: 1)
#   --start-at-line N          Start replay from line N (default: 1)
#   --stop-at-line N           Stop replay at line N (default: process all lines)
#
# Output:
#   replay-results/<session-id>-<timestamp>/
#     ├── 001-transcript.jsonl  # Transcript state at extraction 1
#     ├── 001-session-summary.json        # Summary extracted from that state
#     ├── 002-transcript.jsonl  # Transcript state at extraction 2
#     ├── 002-session-summary.json
#     └── ...
###############################################################################

set -euo pipefail

# Check for help first (before parsing positional args)
if [ $# -eq 1 ] && [[ "$1" =~ ^(-h|--help)$ ]]; then
    # Extract documentation header (lines 2-33, skip shebang)
    sed -n '2,33p' "$0" | sed 's/^# *//' | sed 's/^#$//'
    exit 0
fi

# Parse arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <session-id-or-path> [OPTIONS]"
    echo "Run with --help for details"
    exit 1
fi

INPUT="$1"
shift

# Default configuration
PROVIDER="openrouter"
MODEL="google/gemini-2.5-flash-lite"
OUTPUT_DIR="test-data/replay-results"
MIN_SIZE_CHANGE=500
MIN_INTERVAL=10
TIME_INCREMENT=10
MESSAGES_PER_TICK=1
START_AT_LINE=1
STOP_AT_LINE=-1  # -1 means process all lines

# Parse options
while [[ $# -gt 0 ]]; do
    case "$1" in
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
        --min-size-change)
            MIN_SIZE_CHANGE="$2"
            shift 2
            ;;
        --min-interval)
            MIN_INTERVAL="$2"
            shift 2
            ;;
        --time-increment)
            TIME_INCREMENT="$2"
            shift 2
            ;;
        --messages-per-tick)
            MESSAGES_PER_TICK="$2"
            shift 2
            ;;
        --start-at-line)
            START_AT_LINE="$2"
            shift 2
            ;;
        --stop-at-line)
            STOP_AT_LINE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

###############################################################################
# Setup
###############################################################################

echo "=============================================="
echo "Session Summary Replay Debugger"
echo "=============================================="
echo ""
echo "Input:            $INPUT"
echo "Provider:         $PROVIDER"
echo "Model:            $MODEL"
echo "Min size change:  $MIN_SIZE_CHANGE bytes"
echo "Min interval:     $MIN_INTERVAL seconds"
echo "Time increment:   $TIME_INCREMENT seconds/tick"
echo "Messages/tick:    $MESSAGES_PER_TICK"
echo "Start at line:    $START_AT_LINE"
if [ $STOP_AT_LINE -gt 0 ]; then
    echo "Stop at line:     $STOP_AT_LINE"
else
    echo "Stop at line:     (process all)"
fi
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

# Initialize logging
log_init "replay-${SESSION_ID}"

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

# Override sleeper config to match replay params
export SLEEPER_MIN_SIZE_CHANGE="$MIN_SIZE_CHANGE"
export SLEEPER_MIN_INTERVAL="$MIN_INTERVAL"

log_info "Sidekick libraries loaded"
log_info "Session summary configured: $PROVIDER / $MODEL"

# Create output directory
RUN_TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="${OUTPUT_DIR}/${SESSION_ID}-${RUN_TIMESTAMP}"
mkdir -p "$RUN_DIR"
echo "Output directory: $RUN_DIR"
echo ""

# Create temporary session directory for analysis
TEMP_SESSION_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_SESSION_DIR'" EXIT

TEMP_TRANSCRIPT="${TEMP_SESSION_DIR}/transcript.jsonl"
touch "$TEMP_TRANSCRIPT"

###############################################################################
# Replay Simulation
###############################################################################

# State tracking (mimics sleeper-loop.sh)
declare -i last_size=0
declare -i last_analysis_time=0
declare -i current_time=0
declare -i sequence=0

echo "Starting replay simulation..."
echo ""

# Read full transcript into array
mapfile -t TRANSCRIPT_LINES < "$TRANSCRIPT_PATH"

# Main replay loop
declare -i line_index=$((START_AT_LINE - 1))  # 0-indexed

while [ $line_index -lt ${#TRANSCRIPT_LINES[@]} ]; do
    # Check stop condition
    if [ $STOP_AT_LINE -gt 0 ] && [ $line_index -ge $STOP_AT_LINE ]; then
        break
    fi

    # Add messages to current transcript
    declare -i messages_added=0
    while [ $messages_added -lt $MESSAGES_PER_TICK ] && [ $line_index -lt ${#TRANSCRIPT_LINES[@]} ]; do
        # Check stop condition within inner loop too
        if [ $STOP_AT_LINE -gt 0 ] && [ $line_index -ge $STOP_AT_LINE ]; then
            break
        fi
        echo "${TRANSCRIPT_LINES[$line_index]}" >> "$TEMP_TRANSCRIPT"
        line_index=$((line_index + 1))
        messages_added=$((messages_added + 1))
    done

    # Advance simulated time
    current_time=$((current_time + TIME_INCREMENT))

    # Get current transcript size
    current_size=$(stat -c%s "$TEMP_TRANSCRIPT" 2>/dev/null || stat -f%z "$TEMP_TRANSCRIPT")
    size_delta=$((current_size - last_size))
    time_delta=$((current_time - last_analysis_time))

    # Check dual-gate trigger condition
    trigger=false
    if [ $size_delta -ge $MIN_SIZE_CHANGE ] && [ $time_delta -ge $MIN_INTERVAL ]; then
        trigger=true
    fi

    # Debug output
    printf "[T=%3ds] Line %4d/%d | Size: %6d (+%4d) | Last analysis: %3ds ago" \
        "$current_time" "$line_index" "${#TRANSCRIPT_LINES[@]}" \
        "$current_size" "$size_delta" "$time_delta"

    if [ "$trigger" = true ]; then
        sequence=$((sequence + 1))
        printf " → TRIGGER #%d\n" "$sequence"

        # Save transcript snapshot
        snapshot_transcript="${RUN_DIR}/$(printf '%03d' $sequence)-transcript.jsonl"
        cp "$TEMP_TRANSCRIPT" "$snapshot_transcript"

        # Run session summary
        export LOG_LEVEL=ERROR  # Suppress debug logs for cleaner output

        # Run analysis - session dir will be created automatically in .sidekick/sessions/
        analysis_output=$(session_summary_analyze "replay-${sequence}" "$TEMP_TRANSCRIPT" "$PWD" 2>&1 || echo "FAILED")

        # Get the session directory path (created by session_summary_analyze)
        analysis_session_dir="${PWD}/.sidekick/sessions/replay-${sequence}"

        if echo "$analysis_output" | grep -q "FAILED"; then
            echo "         ERROR: Analysis function failed"
            echo "$analysis_output" | grep -i "error\|fatal" | head -5
        elif [ -f "${analysis_session_dir}/session-summary.json" ]; then
            # Copy generated session-summary.json to snapshot
            snapshot_summary="${RUN_DIR}/$(printf '%03d' $sequence)-session-summary.json"
            cp "${analysis_session_dir}/session-summary.json" "$snapshot_summary"

            # Extract key fields for display
            confidence=$(jq -r '.session_title_confidence // "N/A"' "$snapshot_summary")
            title=$(jq -r '.session_title // "N/A"' "$snapshot_summary" | head -c 60)
            echo "         Confidence: $confidence | Title: ${title}..."
        else
            echo "         ERROR: session-summary.json not generated"
        fi

        # Clean up session directory (we've already copied the summary file)
        rm -rf "$analysis_session_dir" 2>/dev/null || true

        # Update state
        last_analysis_time=$current_time
        last_size=$current_size
    else
        # Show why not triggered
        reasons=()
        [ $size_delta -lt $MIN_SIZE_CHANGE ] && reasons+=("size < $MIN_SIZE_CHANGE")
        [ $time_delta -lt $MIN_INTERVAL ] && reasons+=("time < ${MIN_INTERVAL}s")
        printf " → skip (%s)\n" "$(IFS=', '; echo "${reasons[*]}")"

        # Update size tracking even when not triggered
        last_size=$current_size
    fi

    # Exit if we've processed all lines
    if [ $line_index -ge ${#TRANSCRIPT_LINES[@]} ]; then
        break
    fi
done

###############################################################################
# Summary
###############################################################################

echo ""
echo "=============================================="
echo "Replay Complete"
echo "=============================================="
echo "Total messages:       $TOTAL_LINES"
echo "Messages processed:   $line_index"
echo "Extractions:          $sequence"
echo "Simulated duration:   ${current_time}s"
echo ""
echo "Output directory:     $RUN_DIR"
echo ""
echo "Next steps:"
echo "  # View summary evolution"
echo "  ls -lh $RUN_DIR/"
echo ""
echo "  # Compare summary changes"
echo "  diff -u $RUN_DIR/001-session-summary.json $RUN_DIR/002-session-summary.json"
echo ""
echo "  # View transcript at specific extraction"
echo "  cat $RUN_DIR/001-transcript.jsonl"
echo ""
