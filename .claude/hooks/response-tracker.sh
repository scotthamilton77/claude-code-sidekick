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
TOPIC_REFRESH_CADENCE=${TOPIC_REFRESH_CADENCE:-10}
readonly TOPIC_UNSET_MARKER="--"
readonly HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Allow override for testing - set TEST_*_REMINDER_FILE to override paths
readonly USER_REMINDER_FILE="${TEST_USER_REMINDER_FILE:-$HOME/.claude/hooks/static-reminder.txt}"
readonly PROJECT_REMINDER_FILE="${TEST_PROJECT_REMINDER_FILE:-${HOOK_DIR}/static-reminder.txt}"

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
    local user_template="$HOME/.claude/hooks/$template_name"
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

# Read JSON input from stdin
input=$(cat)

# Extract session_id and transcript_path
session_id=$(echo "$input" | jq -r '.session_id')
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Store session state in project-local cache
cache_dir="${project_dir}/.claude/hooks/cache"
[ "$VERBOSE" = true ] && echo "[ResponseTracker] project_dir: $project_dir" >&2
[ "$VERBOSE" = true ] && echo "[ResponseTracker] cache_dir: $cache_dir" >&2

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
    # Initialize counter file only
    echo "0" > "$counter_file" || {
        echo "[ResponseTracker] ERROR: Failed to write counter file" >&2
        exit 1
    }
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Initialized counter at: $counter_file" >&2
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

    # Check if topic file exists (if not, topic is unset)
    if [ -f "$topic_file" ]; then
      topic=$(cat "$topic_file")
    else
      topic="$TOPIC_UNSET_MARKER"
    fi

    # Increment counter (safe now after validation)
    count=$((count + 1))
    echo "$count" > "$counter_file" || {
        echo "[ResponseTracker] ERROR: Failed to write counter file" >&2
        exit 1
    }

    # Decision logic for reminder injection
    context=""

    if [ "$topic" = "$TOPIC_UNSET_MARKER" ]; then
      # Topic not set - inject topic update reminder (every turn)
      context=$(load_template "topic-unset-reminder.txt")
    else
      # Topic is set - check for static or topic refresh reminders
      static_due=$((count % STATIC_REMINDER_CADENCE))
      topic_due=$((count % TOPIC_REFRESH_CADENCE))

      if [ $static_due -eq 0 ]; then
        # Static reminder takes precedence - load from user/project files
        context=$(load_static_reminder)
      elif [ $topic_due -eq 0 ]; then
        # Topic refresh reminder
        context=$(load_template "topic-refresh-reminder.txt")
      fi
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
