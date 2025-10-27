#!/bin/bash
###############################################################################
# bulk-topic-extraction.sh
#
# Runs Sidekick topic extraction on all transcripts from ~/.claude/projects/
# and stores results in .sidekick/sessions/<session-id>/topic.json
#
# This pre-analyzes transcripts to populate intent_category and initial_goal
# metadata, making test data curation much easier.
#
# Usage:
#   ./scripts/bulk-topic-extraction.sh [OPTIONS]
#
# Options:
#   --provider PROVIDER    LLM provider (default: openrouter)
#   --model MODEL          Model name (default: google/gemini-2.5-flash-lite)
#   --dry-run              Show what would be processed without running analysis
#   --force                Re-analyze even if topic.json already exists
#   --limit N              Process at most N transcripts (useful for testing)
###############################################################################

set -euo pipefail

# Parse arguments
PROVIDER="openrouter"
MODEL="google/gemini-2.5-flash-lite"
DRY_RUN=false
FORCE=false
LIMIT=0  # 0 means no limit

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
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Constants
PROJECTS_DIR="${HOME}/.claude/projects"
SIDEKICK_ROOT="src/sidekick"
SESSIONS_DIR=".sidekick/sessions"

# Counters
declare -i total_transcripts=0
declare -i processed=0
declare -i skipped=0
declare -i failed=0

###############################################################################
# Setup
###############################################################################

echo "=============================================="
echo "Bulk Topic Extraction"
echo "=============================================="
echo ""
echo "Provider: $PROVIDER"
echo "Model:    $MODEL"
echo "Mode:     $([ "$DRY_RUN" = true ] && echo "DRY RUN" || echo "LIVE")"
echo "Force:    $([ "$FORCE" = true ] && echo "YES" || echo "NO")"
echo "Limit:    $([ "$LIMIT" -gt 0 ] && echo "$LIMIT transcripts" || echo "NO LIMIT")"
echo ""

# Load .env file if it exists (for API keys)
if [ -f ".env" ]; then
    set -a  # Auto-export all variables
    source .env
    set +a
    echo "[INFO] Loaded .env file"
fi

# Verify Sidekick exists
if [ ! -d "$SIDEKICK_ROOT" ]; then
    echo "ERROR: Sidekick source not found: $SIDEKICK_ROOT"
    exit 1
fi

# Set project directory for Sidekick path resolution
export CLAUDE_PROJECT_DIR="$PWD"

# Load Sidekick libraries
export SIDEKICK_ROOT_OVERRIDE="$PWD/$SIDEKICK_ROOT"
source "$SIDEKICK_ROOT/lib/common.sh"

# Load topic extraction feature
if [ ! -f "$SIDEKICK_ROOT/features/topic-extraction.sh" ]; then
    echo "ERROR: topic-extraction.sh not found"
    exit 1
fi
source "$SIDEKICK_ROOT/features/topic-extraction.sh"

# Enable topic extraction feature
export FEATURE_TOPIC_EXTRACTION=true

# Override LLM configuration
export LLM_PROVIDER="$PROVIDER"
if [ "$PROVIDER" = "openrouter" ]; then
    export LLM_OPENROUTER_MODEL="$MODEL"
elif [ "$PROVIDER" = "openai-api" ]; then
    export LLM_OPENAI_MODEL="$MODEL"
elif [ "$PROVIDER" = "groq" ]; then
    export LLM_GROQ_MODEL="$MODEL"
elif [ "$PROVIDER" = "claude-cli" ]; then
    export LLM_CLAUDE_MODEL="$MODEL"
fi

log_info "Sidekick libraries loaded"
log_info "Topic extraction feature loaded"
log_info "LLM provider configured: $PROVIDER / $MODEL"

# Create sessions directory
mkdir -p "$SESSIONS_DIR"

###############################################################################
# Main Processing
###############################################################################

echo ""
echo "Scanning transcripts..."
echo ""

# Scan all projects
for project_dir in "$PROJECTS_DIR"/*; do
    [ -d "$project_dir" ] || continue

    project_name=$(basename "$project_dir")

    # Skip temporary projects
    if [[ "$project_name" == -tmp-* ]]; then
        continue
    fi

    # Scan transcripts in this project
    for transcript in "$project_dir"/*.jsonl; do
        [ -f "$transcript" ] || continue

        total_transcripts=$((total_transcripts + 1))

        # Extract session ID from filename
        session_id=$(basename "$transcript" .jsonl)
        session_dir="${SESSIONS_DIR}/${session_id}"
        topic_file="${session_dir}/topic.json"

        # Check if already analyzed
        if [ -f "$topic_file" ] && [ "$FORCE" = false ]; then
            log_debug "Skipping $session_id (already analyzed)"
            skipped=$((skipped + 1))
            continue
        fi

        # Get transcript line count for display
        line_count=$(wc -l < "$transcript")

        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Session:  ${session_id:0:16}..."
        echo "Project:  ${project_name:0:40}"
        echo "Lines:    $line_count"
        echo ""

        if [ "$DRY_RUN" = true ]; then
            echo "[DRY RUN] Would analyze this transcript"
            processed=$((processed + 1))
            echo ""
            continue
        fi

        # Create session directory
        mkdir -p "$session_dir"

        # Enable debug logging for this run
        export LOG_LEVEL=DEBUG

        # Run topic extraction
        echo "Analyzing..."

        # Call the function and capture its output
        set +e  # Don't exit on error
        analysis_output=$(topic_extraction_analyze "$session_id" "$transcript" "$PWD" 2>&1)
        analysis_exit_code=$?
        set -e

        if [ $analysis_exit_code -eq 0 ]; then
            # Check if topic file was actually created
            if [ -f "$topic_file" ]; then
                log_info "✓ Analysis complete: $topic_file"

                # Display results
                echo ""
                echo "Results:"
                jq -r '
                    "  Intent:     " + (.intent_category // "unknown") + "\n" +
                    "  Clarity:    " + (.clarity_score | tostring) + "/10" + "\n" +
                    "  Goal:       " + ((.initial_goal // "N/A") | .[0:70]) + (if (.initial_goal | length) > 70 then "..." else "" end)
                ' "$topic_file"

                processed=$((processed + 1))
            else
                log_error "✗ Function returned success but no topic file created"
                echo "Output: $analysis_output"
                failed=$((failed + 1))
            fi
        else
            log_error "✗ Analysis failed for $session_id (exit code: $analysis_exit_code)"
            echo "Output: $analysis_output"
            failed=$((failed + 1))
        fi

        echo ""

        # Check if limit reached
        if [ "$LIMIT" -gt 0 ] && [ $((processed + failed)) -ge "$LIMIT" ]; then
            log_info "Limit reached ($LIMIT transcripts), stopping"
            break 2  # Break out of both loops
        fi

        # Add a small delay to avoid rate limiting
        sleep 0.5
    done
done

###############################################################################
# Summary
###############################################################################

echo "=============================================="
echo "Summary"
echo "=============================================="
echo "Total transcripts:    $total_transcripts"
echo "Processed:            $processed"
echo "Skipped (existing):   $skipped"
echo "Failed:               $failed"
echo ""

if [ "$DRY_RUN" = false ]; then
    echo "Topic metadata stored in: $SESSIONS_DIR/"
    echo ""
    echo "Next step:"
    echo "  ./scripts/collect-test-data.sh"
fi
