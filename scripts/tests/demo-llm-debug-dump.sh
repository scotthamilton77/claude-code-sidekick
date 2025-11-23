#!/bin/bash
# Test script for LLM debug dumping functionality
#
# This script demonstrates the enhanced debugging that captures:
# - Complete curl command with all parameters
# - Full JSON payload
# - Metadata (provider, model, timestamp, etc.)
#
# Usage: ./test-llm-debug-dump.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source the sidekick library
source "$PROJECT_ROOT/src/sidekick/lib/common.sh"

echo "=== LLM Debug Dump Test ==="
echo ""

# Temporarily enable debug dumping
export LLM_DEBUG_DUMP_ENABLED=true
export LLM_PROVIDER=openrouter
export LLM_OPENROUTER_MODEL=google/gemma-3-4b-it
export LLM_OPENROUTER_API_KEY="${LLM_OPENROUTER_API_KEY:-}"

if [ -z "$LLM_OPENROUTER_API_KEY" ]; then
    echo "ERROR: LLM_OPENROUTER_API_KEY not set"
    echo "Set it in your environment or config file"
    exit 1
fi

echo "Configuration:"
echo "  Provider: $LLM_PROVIDER"
echo "  Model: $LLM_OPENROUTER_MODEL"
echo "  Debug Dumping: $LLM_DEBUG_DUMP_ENABLED"
echo ""

# Make a simple LLM call
echo "Making a test LLM call..."
prompt='{"task": "session_summary", "instructions": "Extract the main topic from this conversation. Respond with JSON only.", "conversation": "User: Hello\nAssistant: Hi there!"}'

# Call the LLM (this will trigger debug dumping)
if result=$(llm_invoke "$LLM_OPENROUTER_MODEL" "$prompt" 10); then
    echo "✓ LLM call succeeded"
    echo ""
    echo "Result:"
    echo "$result" | head -5
    echo ""
else
    echo "✗ LLM call failed (exit code: $?)"
    echo ""
fi

# Show where debug files were saved
echo "=== Debug Files Location ==="
debug_dir="/tmp/sidekick-llm-debug/openrouter/google-gemma-3-4b-it"
if [ -d "$debug_dir" ]; then
    echo "Debug files saved to: $debug_dir"
    echo ""
    echo "Latest debug dump:"
    latest=$(ls -t "$debug_dir" | grep 'metadata.txt$' | head -1 | sed 's/-metadata.txt$//')
    if [ -n "$latest" ]; then
        base_path="$debug_dir/$latest"
        echo ""
        echo "--- Metadata ($base_path-metadata.txt) ---"
        cat "$base_path-metadata.txt"
        echo ""
        echo "--- Curl Command ($base_path-curl.sh) ---"
        cat "$base_path-curl.sh"
        echo ""
        echo "--- Payload (first 50 lines of $base_path-payload.json) ---"
        head -50 "$base_path-payload.json"
        echo ""
        echo "=== Files Available ==="
        ls -lh "$base_path"-*
    else
        echo "No debug dumps found"
    fi
else
    echo "Debug directory not found: $debug_dir"
    echo "Check if LLM_DEBUG_DUMP_ENABLED was properly set"
fi

echo ""
echo "=== Test Complete ==="
echo "To enable debug dumping in production:"
echo "  1. Add 'LLM_DEBUG_DUMP_ENABLED=true' to your sidekick.conf"
echo "  2. Re-run your benchmark/script"
echo "  3. Check /tmp/sidekick-llm-debug/{provider}/{model}/ for dump files"
