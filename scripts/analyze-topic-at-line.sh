#!/bin/bash
###############################################################################
# analyze-topic-at-line.sh
#
# Surgical topic extraction tool - analyzes transcript up to a specific line
# and saves all intermediate artifacts (filtered transcript, prompt, topic).
# Maintains topic continuity by finding and using the previous topic analysis
# for significance change detection.
#
# Usage:
#   ./scripts/analyze-topic-at-line.sh <session-id-or-path> --to-line N [OPTIONS]
#
# Arguments:
#   <session-id-or-path>   Session ID (looks in ~/.claude/projects/) or
#                          path to transcript.jsonl file
#
# Required Options:
#   --to-line N                Analyze transcript up to and including line N
#
# Optional:
#   --output-dir DIR           Output directory (default: test-data/topic-analysis/)
#   --provider PROVIDER        LLM provider (default: openrouter)
#   --model MODEL              Model name (default: google/gemini-2.5-flash-lite)
#   --use-revised              Use ####-prompt-revised.txt instead of building prompt,
#                              outputs to ####-topic-revised.json
#
# Output:
#   <output-dir>/<session-id>/
#     ├── 0100-transcript.jsonl          # Raw transcript lines 1-100
#     ├── 0100-filtered.jsonl            # Preprocessed (what LLM sees)
#     ├── 0100-prompt.txt                # Complete prompt sent to LLM
#     ├── 0100-json-schema.json          # JSON schema passed to LLM
#     ├── 0100-topic.json                # Extracted topic result
#     ├── 0100-prompt-revised.txt        # Optional: manually edited prompt
#     ├── 0100-json-schema-revised.json  # Optional: manually edited schema
#     └── 0100-topic-revised.json        # Result from revised prompt/schema (--use-revised)
#
# Topic Continuity:
#   Before analysis, scans output directory for previous topic files
#   (####-topic.json where #### < target line) and uses the highest one
#   as {PREVIOUS_TOPIC} for significance change detection.
#
# Examples:
#   # First analysis - no previous
#   ./scripts/analyze-topic-at-line.sh abc123 --to-line 100
#
#   # Second analysis - uses 0100-topic.json as previous
#   ./scripts/analyze-topic-at-line.sh abc123 --to-line 200
#
#   # Works out of order - uses 0100-topic.json (highest < 150)
#   ./scripts/analyze-topic-at-line.sh abc123 --to-line 150
#
#   # Test revised prompt - edit 0100-prompt.txt, save as 0100-prompt-revised.txt
#   ./scripts/analyze-topic-at-line.sh abc123 --to-line 100 --use-revised
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
OUTPUT_DIR="test-data/topic-analysis"
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
echo "Surgical Topic Extraction"
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

# Load topic extraction feature
if [ ! -f "$SIDEKICK_ROOT/features/topic-extraction.sh" ]; then
    echo "ERROR: topic-extraction.sh not found"
    exit 1
fi
source "$SIDEKICK_ROOT/features/topic-extraction.sh"

# Configure features
export FEATURE_TOPIC_EXTRACTION=true
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
log_info "Topic extraction configured: $PROVIDER / $MODEL"

# Create output directory
SESSION_OUTPUT_DIR="${OUTPUT_DIR}/${SESSION_ID}"
mkdir -p "$SESSION_OUTPUT_DIR"
echo "Session output:   $SESSION_OUTPUT_DIR"
echo ""

###############################################################################
# Find Previous Topic (Topic Continuity)
###############################################################################

find_previous_topic() {
    local target_line=$1
    local output_dir=$2

    # Find all existing topic files in format ####-topic.json
    local previous_topic_file=""
    local highest_line=0

    for topic_file in "$output_dir"/[0-9][0-9][0-9][0-9]-topic.json; do
        if [ -f "$topic_file" ]; then
            # Extract line number from filename
            local line_num=$(basename "$topic_file" | sed 's/^0*//' | sed 's/-topic.json$//')
            # Handle edge case where line_num is empty (0000)
            [ -z "$line_num" ] && line_num=0

            # Check if this is less than target and higher than current highest
            if [ "$line_num" -lt "$target_line" ] && [ "$line_num" -gt "$highest_line" ]; then
                highest_line=$line_num
                previous_topic_file="$topic_file"
            fi
        fi
    done

    if [ -n "$previous_topic_file" ]; then
        echo "$previous_topic_file"
    else
        echo ""
    fi
}

echo "Finding previous topic analysis..."
PREVIOUS_TOPIC_FILE=$(find_previous_topic "$TO_LINE" "$SESSION_OUTPUT_DIR")

if [ -n "$PREVIOUS_TOPIC_FILE" ]; then
    PREVIOUS_LINE=$(basename "$PREVIOUS_TOPIC_FILE" | sed 's/^0*//' | sed 's/-topic.json$//')
    [ -z "$PREVIOUS_LINE" ] && PREVIOUS_LINE=0
    echo "Found previous:   Line $PREVIOUS_LINE ($PREVIOUS_TOPIC_FILE)"
    PREVIOUS_TOPIC_JSON=$(cat "$PREVIOUS_TOPIC_FILE")
else
    echo "No previous topic found (first analysis)"
    PREVIOUS_TOPIC_JSON=""
fi
echo ""

###############################################################################
# Extract and Preprocess Transcript
###############################################################################

echo "Extracting transcript lines 1-${TO_LINE}..."

# Create temporary working directory
TEMP_WORK_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_WORK_DIR'" EXIT

TEMP_TRANSCRIPT="${TEMP_WORK_DIR}/transcript.jsonl"
TEMP_FILTERED="${TEMP_WORK_DIR}/filtered.jsonl"

# Extract lines 1 to TO_LINE
head -n "$TO_LINE" "$TRANSCRIPT_PATH" > "$TEMP_TRANSCRIPT"

echo "Preprocessing transcript (filtering meta, tools, extracting .message)..."

# Use same filtering logic as production (from lib/transcript.sh)
TOPIC_FILTER_TOOL_MESSAGES=${TOPIC_FILTER_TOOL_MESSAGES:-true}

# Build jq filter using production function
JQ_FILTER=$(transcript_build_filter "$TOPIC_FILTER_TOOL_MESSAGES")

# Apply filter and wrap in JSON array
jq -c "$JQ_FILTER" "$TEMP_TRANSCRIPT" > "$TEMP_FILTERED"

# Also create JSON array format for prompt substitution
FILTERED_JSON=$(jq -s '.' "$TEMP_FILTERED")

FILTERED_COUNT=$(wc -l < "$TEMP_FILTERED")
echo "Filtered result:  $FILTERED_COUNT messages (from $TO_LINE raw lines)"
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

    # Load prompt template and schema
    PROMPT_TEMPLATE_PATH=$(path_resolve_cascade "prompts/topic.prompt.txt" "$CLAUDE_PROJECT_DIR")
    SCHEMA_PATH=$(path_resolve_cascade "prompts/topic.schema.json" "$CLAUDE_PROJECT_DIR")

if [ -z "$PROMPT_TEMPLATE_PATH" ] || [ ! -f "$PROMPT_TEMPLATE_PATH" ]; then
    log_error "Prompt template not found: prompts/topic.prompt.txt"
    exit 1
fi

if [ -z "$SCHEMA_PATH" ] || [ ! -f "$SCHEMA_PATH" ]; then
    log_error "Schema not found: prompts/topic.schema.json"
    exit 1
fi

# Read files
PROMPT_TEMPLATE=$(cat "$PROMPT_TEMPLATE_PATH")
SCHEMA_JSON=$(cat "$SCHEMA_PATH")

# Save schema as artifact for reference/revision
TEMP_SCHEMA="${TEMP_WORK_DIR}/schema.json"
echo "$SCHEMA_JSON" > "$TEMP_SCHEMA"

# Build prompt with substitutions using bash parameter expansion
# This handles multi-line JSON and special characters safely
PROMPT_TEXT="$PROMPT_TEMPLATE"

# Substitute {SCHEMA}
PROMPT_TEXT="${PROMPT_TEXT//\{SCHEMA\}/$SCHEMA_JSON}"

# Substitute {PREVIOUS_TOPIC}
if [ -n "$PREVIOUS_TOPIC_JSON" ]; then
    PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_TOPIC\}/$PREVIOUS_TOPIC_JSON}"
else
    PROMPT_TEXT="${PROMPT_TEXT//\{PREVIOUS_TOPIC\}/null}"
fi

# Substitute {TRANSCRIPT}
PROMPT_TEXT="${PROMPT_TEXT//\{TRANSCRIPT\}/$FILTERED_JSON}"

# Save to file for artifact
TEMP_PROMPT="${TEMP_WORK_DIR}/prompt.txt"
echo "$PROMPT_TEXT" > "$TEMP_PROMPT"

echo "Prompt built ($(wc -c < "$TEMP_PROMPT") bytes)"
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
        JSON_SCHEMA=$(llm_load_schema "topic.schema")
    fi
else
    JSON_SCHEMA=$(llm_load_schema "topic.schema")
fi

# Invoke LLM with schema
if ! llm_output=$(llm_invoke "$MODEL" "$PROMPT_TEXT" 60 "$JSON_SCHEMA"); then
    echo "ERROR: LLM invocation failed"
    echo "$llm_output" | head -20
    exit 1
fi

# Extract JSON from output (handles markdown wrapping)
topic_json=$(llm_extract_json "$llm_output")

# Validate JSON
if ! json_validate "$topic_json"; then
    echo "ERROR: Invalid JSON response from LLM"
    echo "$topic_json" | head -20
    exit 1
fi

echo "Topic extracted successfully"
echo ""

###############################################################################
# Save Artifacts
###############################################################################

echo "Saving artifacts..."

# Determine output files based on mode
if [ "$USE_REVISED" = true ]; then
    # Revised mode: only save revised topic
    ARTIFACT_TOPIC="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-topic-revised.json"
    echo "$topic_json" | jq '.' > "$ARTIFACT_TOPIC"
    echo "  → ${FILE_PREFIX}-topic-revised.json"
else
    # Normal mode: save all artifacts
    ARTIFACT_TRANSCRIPT="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-transcript.jsonl"
    ARTIFACT_FILTERED="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-filtered.jsonl"
    ARTIFACT_PROMPT="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt"
    ARTIFACT_SCHEMA="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json"
    ARTIFACT_TOPIC="${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-topic.json"

    cp "$TEMP_TRANSCRIPT" "$ARTIFACT_TRANSCRIPT"
    cp "$TEMP_FILTERED" "$ARTIFACT_FILTERED"
    cp "$TEMP_PROMPT" "$ARTIFACT_PROMPT"
    cp "$TEMP_SCHEMA" "$ARTIFACT_SCHEMA"
    echo "$topic_json" | jq '.' > "$ARTIFACT_TOPIC"

    echo "  → ${FILE_PREFIX}-transcript.jsonl  (raw, $TO_LINE lines)"
    echo "  → ${FILE_PREFIX}-filtered.jsonl    (preprocessed, $FILTERED_COUNT lines)"
    echo "  → ${FILE_PREFIX}-prompt.txt        ($(wc -c < "$ARTIFACT_PROMPT") bytes)"
    echo "  → ${FILE_PREFIX}-json-schema.json  ($(wc -c < "$ARTIFACT_SCHEMA") bytes)"
    echo "  → ${FILE_PREFIX}-topic.json"
fi
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
clarity=$(echo "$topic_json" | jq -r '.clarity_score // "N/A"')
significant_change=$(echo "$topic_json" | jq -r '.significant_change // "N/A"')
initial_goal=$(echo "$topic_json" | jq -r '.initial_goal // "N/A"' | head -c 80)

echo "Results:"
echo "  Clarity score:       $clarity"
echo "  Significant change:  $significant_change"
echo "  Initial goal:        ${initial_goal}..."
echo ""

echo "Next steps:"
echo "  # View extracted topic"
echo "  cat $ARTIFACT_TOPIC"
echo ""

if [ "$USE_REVISED" = false ]; then
    echo "  # View filtered transcript (LLM input)"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-filtered.jsonl"
    echo ""
    echo "  # View complete prompt and schema"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt"
    echo "  cat ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json"
    echo ""
    echo "  # Edit prompt/schema and test revision"
    echo "  cp ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt.txt ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-prompt-revised.txt"
    echo "  cp ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema.json ${SESSION_OUTPUT_DIR}/${FILE_PREFIX}-json-schema-revised.json"
    echo "  # ... edit the revised files ..."
    echo "  ./scripts/analyze-topic-at-line.sh $SESSION_ID --to-line $TO_LINE --use-revised"
    echo ""
fi

echo "  # Analyze next checkpoint"
echo "  ./scripts/analyze-topic-at-line.sh $SESSION_ID --to-line $((TO_LINE + 100))"
echo ""
