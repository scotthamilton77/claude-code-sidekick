#!/bin/bash
# Helper script to write topic file content
# Usage: write-topic.sh <session_id> <topic_line> <snarky_explanation>

session_id="$1"
topic_line="$2"
snarky_explanation="$3"

if [ -z "$session_id" ] || [ -z "$topic_line" ] || [ -z "$snarky_explanation" ]; then
    echo "Usage: write-topic.sh <session_id> <topic_line> <snarky_explanation>" >&2
    exit 1
fi

# Construct full path to topic file
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache_dir="${HOOK_DIR}/cache"
topic_file="${cache_dir}/${session_id}_topic"

# Ensure cache directory exists
mkdir -p "$cache_dir"

# Write formatted content: line1=topic, line2=blank, line3+=explanation
echo -e "${topic_line}\n\n${snarky_explanation}" > "$topic_file"
