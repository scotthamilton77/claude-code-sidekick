#!/bin/bash
# Response tracking hook - handles session initialization and reminder injection

operation="$1"
project_dir="$2"
shift 2  # Remove operation and project_dir from args, remaining args are flags

# Validate required parameters
if [ -z "$project_dir" ]; then
    echo "[ResponseTracker] ERROR: project_dir parameter required" >&2
    exit 1
fi

# Parse flags
VERBOSE=false
for arg in "$@"; do
    case "$arg" in
        --verbose|-v)
            VERBOSE=true
            ;;
    esac
done

# Configuration
STATIC_REMINDER_CADENCE=${STATIC_REMINDER_CADENCE:-4}
readonly HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Allow override for testing - set TEST_*_REMINDER_FILE to override paths
readonly USER_REMINDER_FILE="${TEST_USER_REMINDER_FILE:-$HOME/.claude/hooks/reminders/static-reminder.txt}"
readonly PROJECT_REMINDER_FILE="${TEST_PROJECT_REMINDER_FILE:-${HOOK_DIR}/static-reminder.txt}"

# Analysis configuration
ANALYSIS_ENABLED=${CLAUDE_ANALYSIS_ENABLED:-true}
ANALYSIS_MODE=${CLAUDE_ANALYSIS_MODE:-topic-only}
ANALYSIS_CADENCE_LOW_CLARITY=${CLAUDE_ANALYSIS_CADENCE_LOW:-3}
ANALYSIS_CADENCE_HIGH_CLARITY=${CLAUDE_ANALYSIS_CADENCE_HIGH:-10}
ANALYSIS_CLARITY_THRESHOLD=${CLAUDE_ANALYSIS_CLARITY_THRESHOLD:-7}

# Load static reminder content from user and/or project level files
# Returns concatenated content if both exist, otherwise whichever is found
load_static_reminder() {
    local user_content=""
    local project_content=""
    local found=false

    if [ -f "$USER_REMINDER_FILE" ]; then
        user_content=$(cat "$USER_REMINDER_FILE")
        found=true
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] Loaded user-level reminder from $USER_REMINDER_FILE" >&2
    fi

    if [ -f "$PROJECT_REMINDER_FILE" ]; then
        project_content=$(cat "$PROJECT_REMINDER_FILE")
        found=true
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] Loaded project-level reminder from $PROJECT_REMINDER_FILE" >&2
    fi

    if [ "$found" = false ]; then
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] WARNING: No static reminder files found" >&2
        return 1
    fi

    # Concatenate with blank line separator if both exist
    if [ -n "$user_content" ] && [ -n "$project_content" ]; then
        echo "$user_content"
        echo ""
        echo "$project_content"
    elif [ -n "$user_content" ]; then
        echo "$user_content"
    else
        echo "$project_content"
    fi

    return 0
}

# Load and substitute variables in a template file
# Args: template_basename (e.g., "topic-unset-reminder.txt")
# Uses variables from caller's scope: HOOK_DIR, session_id, topic
# Only these whitelisted variables are substituted - all others are left as-is
load_template() {
    local template_name="$1"
    local user_template="$HOME/.claude/hooks/reminders/$template_name"
    local project_template="${HOOK_DIR}/$template_name"
    local template_path=""

    # Prefer project-level template over user-level
    if [ -f "$project_template" ]; then
        template_path="$project_template"
    elif [ -f "$user_template" ]; then
        template_path="$user_template"
    else
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] WARNING: Template not found: $template_name" >&2
        return 1
    fi

    # Export variables for envsubst, then perform whitelisted substitution
    # The whitelist ensures only specified variables are substituted
    export HOOK_DIR session_id topic
    cat "$template_path" | envsubst '${HOOK_DIR} ${session_id} ${topic}'

    return 0
}

# Validate that a value is a non-negative integer
validate_count() {
    local val="$1"
    if [[ "$val" =~ ^[0-9]+$ ]]; then
        echo "$val"
    else
        echo "0"
    fi
}

# Get current clarity score from most recent analysis
# Args: session_id, output_dir
# Returns: clarity score (1-10) or 0 if unavailable
get_clarity_score() {
    local session_id="$1"
    local output_dir="$2"
    local topic_file="${output_dir}/${session_id}_topic.json"

    # Default to 0 (unknown) if file doesn't exist
    if [ ! -f "$topic_file" ]; then
        echo "0"
        return
    fi

    # Extract clarity_score from JSON
    local clarity=$(jq -r '.clarity_score // 0' "$topic_file" 2>/dev/null)

    # Validate it's a number
    if [[ "$clarity" =~ ^[0-9]+$ ]]; then
        echo "$clarity"
    else
        echo "0"
    fi
}

# Launch transcript analysis as detached background process
# Args: session_id, transcript_path, output_base_dir
# output_base_dir should be parent of tmp/ (e.g., /project/.claude/hooks/reminders)
launch_analysis() {
    local session_id="$1"
    local transcript_path="$2"
    local output_base_dir="$3"
    local mode="${ANALYSIS_MODE}"

    # Validate inputs
    if [ -z "$session_id" ] || [ -z "$transcript_path" ] || [ -z "$output_base_dir" ]; then
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] WARNING: Missing args for analysis" >&2
        return 1
    fi

    # Ensure transcript exists
    if [ ! -f "$transcript_path" ]; then
        [ "$VERBOSE" = true ] && echo "[ResponseTracker] WARNING: Transcript not found: $transcript_path" >&2
        return 1
    fi

    # Check for existing analysis in progress
    local pid_file="${output_base_dir}/tmp/${session_id}_analysis.pid"
    if [ -f "$pid_file" ]; then
        local existing_pid=$(cat "$pid_file" 2>/dev/null)
        # Check if process is still running
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            [ "$VERBOSE" = true ] && echo "[ResponseTracker] Analysis already running: PID $existing_pid" >&2
            return 0
        else
            # Stale PID file - remove it
            [ "$VERBOSE" = true ] && echo "[ResponseTracker] Removing stale PID file: $existing_pid" >&2
            rm -f "$pid_file"
        fi
    fi

    # Launch detached process (double-fork pattern via nohup)
    # Redirect stdin from /dev/null, all output to log file
    local log_file="/tmp/claude-analysis-${session_id}.log"

    nohup "${HOOK_DIR}/analyze-transcript.sh" \
        "$session_id" \
        "$transcript_path" \
        "$mode" \
        "$output_base_dir" \
        </dev/null \
        &>"$log_file" &

    local analysis_pid=$!

    # Write PID to tracking file
    echo "$analysis_pid" > "$pid_file"
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Launched analysis: PID $analysis_pid, mode=$mode, output_dir=$output_base_dir, pid_file=$pid_file" >&2

    return 0
}

# Read JSON input from stdin
input=$(cat)

# Debug: Log the raw input
[ "$VERBOSE" = true ] && echo "[ResponseTracker] [$operation] Raw stdin: $input" >&2

# Extract session_id and transcript_path
session_id=$(echo "$input" | jq -r '.session_id')
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Debug: Log extracted values
[ "$VERBOSE" = true ] && echo "[ResponseTracker] [$operation] session_id='$session_id'" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] [$operation] transcript_path='$transcript_path'" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] [$operation] transcript exists: $([ -f "$transcript_path" ] && echo yes || echo no)" >&2

# Store session state in project-local tmp directory
cache_dir="${project_dir}/.claude/hooks/reminders/tmp"
output_base_dir="${project_dir}/.claude/hooks/reminders"
[ "$VERBOSE" = true ] && echo "[ResponseTracker] project_dir: $project_dir" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] cache_dir: $cache_dir" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] output_base_dir: $output_base_dir" >&2

mkdir -p "$cache_dir" || {
    echo "[ResponseTracker] ERROR: Failed to create cache directory: $cache_dir" >&2
    exit 1
}

counter_file="${cache_dir}/${session_id}_response_count"
topic_file="${cache_dir}/${session_id}_topic"
unclear_topic_file="${topic_file}_unclear"
[ "$VERBOSE" = true ] && echo "[ResponseTracker] counter_file: $counter_file" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] topic_file: $topic_file" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] unclear_topic_file: $unclear_topic_file" >&2

case "$operation" in
  init)
    # Initialize counter file
    echo "0" > "$counter_file" || {
        echo "[ResponseTracker] ERROR: Failed to write counter file" >&2
        exit 1
    }
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Initialized counter at: $counter_file" >&2

    # Note: We don't launch analysis here because the transcript file doesn't exist yet
    # The first 'track' call will detect missing topic file and launch analysis immediately
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] init complete (analysis will launch on first track call)" >&2

    exit 0
    ;;

  track)
    # Read current count (default to 0 if file doesn't exist)
    # Validate to prevent arithmetic injection
    if [ -f "$counter_file" ]; then
      count=$(validate_count "$(cat "$counter_file")")
    else
      count=0
    fi

    # Increment counter (safe now after validation)
    count=$((count + 1))
    echo "$count" > "$counter_file" || {
        echo "[ResponseTracker] ERROR: Failed to write counter file" >&2
        exit 1
    }

    # Check if transcript analysis should run
    if [ "$ANALYSIS_ENABLED" = true ]; then
        topic_json_file="${cache_dir}/${session_id}_topic.json"

        # If no topic file exists, launch analysis immediately (first time)
        if [ ! -f "$topic_json_file" ]; then
            [ "$VERBOSE" = true ] && echo "[ResponseTracker] No topic file found, launching initial analysis" >&2
            launch_analysis "$session_id" "$transcript_path" "$output_base_dir"
        else
            # Get current clarity score
            clarity=$(get_clarity_score "$session_id" "$cache_dir")

            # Determine cadence based on clarity
            if [ "$clarity" -ge "$ANALYSIS_CLARITY_THRESHOLD" ]; then
                cadence=$ANALYSIS_CADENCE_HIGH_CLARITY
            else
                cadence=$ANALYSIS_CADENCE_LOW_CLARITY
            fi

            analysis_due=$((count % cadence))
            if [ $analysis_due -eq 0 ]; then
                [ "$VERBOSE" = true ] && echo "[ResponseTracker] Analysis due at count $count (clarity=$clarity, cadence=$cadence)" >&2
                launch_analysis "$session_id" "$transcript_path" "$output_base_dir"
            fi
        fi
    fi

    # Decision logic for reminder injection (static reminders only now)
    context=""
    static_due=$((count % STATIC_REMINDER_CADENCE))

    if [ $static_due -eq 0 ]; then
      # Load static reminder from user/project files
      context=$(load_static_reminder)
    fi

    # Output JSON with additional context if any reminder is due
    if [ -n "$context" ]; then
      jq -n --arg context "$context" '{
        "hookSpecificOutput": {
          "hookEventName": "UserPromptSubmit",
          "additionalContext": $context
        }
      }'
    fi

    exit 0
    ;;

  *)
    echo "Unknown operation: $operation" >&2
    exit 1
    ;;
esac
