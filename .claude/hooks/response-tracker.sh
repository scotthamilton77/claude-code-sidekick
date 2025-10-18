#!/bin/bash
# Response tracking hook - handles session initialization and reminder injection

operation="$1"
shift  # Remove operation from args, remaining args are flags

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
# Allow override for testing - set TEST_USER_REMINDER_FILE to override user-level path
readonly USER_REMINDER_FILE="${TEST_USER_REMINDER_FILE:-$HOME/.claude/hooks/static-reminder.txt}"
readonly PROJECT_REMINDER_FILE="${HOOK_DIR}/static-reminder.txt"

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
cache_dir="${HOOK_DIR}/cache"
mkdir -p "$cache_dir" || {
    echo "[ResponseTracker] ERROR: Failed to create cache directory" >&2
    exit 1
}

counter_file="${cache_dir}/${session_id}_response_count"
topic_file="${cache_dir}/${session_id}_topic"

case "$operation" in
  init)
    # Initialize counter and topic files
    echo "0" > "$counter_file" || {
        echo "[ResponseTracker] ERROR: Failed to write counter file" >&2
        exit 1
    }
    echo "$TOPIC_UNSET_MARKER" > "$topic_file" || {
        echo "[ResponseTracker] ERROR: Failed to write topic file" >&2
        exit 1
    }
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Initialized counter at: $counter_file" >&2
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Initialized topic at: $topic_file" >&2
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

    # Read current topic (default to marker if file doesn't exist)
    if [ -f "$topic_file" ]; then
      topic=$(cat "$topic_file")
    else
      topic="$TOPIC_UNSET_MARKER"
      echo "$TOPIC_UNSET_MARKER" > "$topic_file" || {
          echo "[ResponseTracker] ERROR: Failed to write topic file" >&2
          exit 1
      }
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
      context="IMPORTANT: Update the session topic file at \`$topic_file\` if you now understand the user's goal. Use a concise description (50 chars max). Use the Write tool to update this file."
    else
      # Topic is set - check for static or topic refresh reminders
      static_due=$((count % STATIC_REMINDER_CADENCE))
      topic_due=$((count % TOPIC_REFRESH_CADENCE))

      if [ $static_due -eq 0 ]; then
        # Static reminder takes precedence - load from user/project files
        context=$(load_static_reminder)
      elif [ $topic_due -eq 0 ]; then
        # Topic refresh reminder
        context="IMPORTANT: This conversation's topic was previously set to \"$topic\" - if it has changed, update the topic file at \`$topic_file\` to reflect reality. Use the Write tool."
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
