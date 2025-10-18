#!/bin/bash
# Helper script to write unclear topic file content
# Usage: write-unclear-topic.sh <session_id> <cynical_insult>

session_id="$1"
cynical_insult="$2"

if [ -z "$session_id" ] || [ -z "$cynical_insult" ]; then
    echo "Usage: write-unclear-topic.sh <session_id> <cynical_insult>" >&2
    exit 1
fi

# Construct full path to unclear topic file
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache_dir="${HOOK_DIR}/cache"
topic_file="${cache_dir}/${session_id}_topic"
unclear_topic_file="${cache_dir}/${session_id}_topic_unclear"

# Ensure cache directory exists
mkdir -p "$cache_dir"

# Remove clear topic file if it exists (unclear takes precedence)
rm -f "$topic_file"

echo "$cynical_insult" > "$unclear_topic_file"
