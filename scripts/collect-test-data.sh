#!/bin/bash
###############################################################################
# collect-test-data.sh
#
# Interactive script to collect diverse transcript samples for LLM benchmarking.
# Scans ~/.claude/projects/, displays stats, and prompts user to include/skip
# each transcript. Generates metadata.json with test case classifications.
#
# Usage:
#   ./scripts/collect-test-data.sh [--reset]
#
# Options:
#   --reset  Clear existing test data and start fresh
###############################################################################

set -euo pipefail

# Directories
PROJECTS_DIR="${HOME}/.claude/projects"
SIDEKICK_SESSIONS_DIR=".sidekick/sessions"
OUTPUT_DIR="test-data/transcripts"
METADATA_FILE="${OUTPUT_DIR}/metadata.json"

# Counters for distribution tracking
declare -i count_short=0
declare -i count_medium=0
declare -i count_long=0
declare -i count_total=0

# Array to store metadata entries
declare -a metadata_entries=()

###############################################################################
# Helper Functions
###############################################################################

# Print colored output
print_header() {
    echo ""
    echo "=============================================="
    echo "$1"
    echo "=============================================="
}

print_info() {
    echo "[INFO] $1"
}

print_stat() {
    printf "  %-20s %s\n" "$1:" "$2"
}

print_success() {
    echo "[✓] $1"
}

print_warning() {
    echo "[!] $1"
}

# Classify transcript by length
classify_length() {
    local lines=$1
    if (( lines < 50 )); then
        echo "short"
    elif (( lines <= 150 )); then
        echo "medium"
    else
        echo "long"
    fi
}


# Extract initial goal from sidekick topic.json if available
extract_goal() {
    local session_id=$1
    local topic_file="${SIDEKICK_SESSIONS_DIR}/${session_id}/topic.json"

    if [[ -f "$topic_file" ]]; then
        local goal=$(jq -r '.initial_goal // empty' "$topic_file" 2>/dev/null || echo "")
        if [[ -n "$goal" && "$goal" != "null" ]]; then
            echo "$goal"
            return
        fi
    fi
    echo ""
}

# Extract project name from encoded directory name
extract_project_name() {
    local dir_name=$1
    # Remove leading dash and convert remaining dashes to slashes for readability
    # E.g., "-home-scott-projects-claude-config" -> "home/scott/projects/claude-config"
    echo "${dir_name#-}" | sed 's/-/\//g'
}

# Preprocess transcript using same logic as topic-extraction.sh
# Filters tool messages and strips unnecessary attributes
preprocess_transcript() {
    local transcript=$1

    # Replicate topic-extraction.sh preprocessing:
    # 1. Extract .message field (ignore wrapper metadata)
    # 2. Filter out tool_use and tool_result content
    # 3. Strip model, id, type, stop_reason, stop_sequence, usage attributes
    jq -c '
        .message |
        select(. != null) |
        select(
            (.content |
                if type == "array" then
                    (.[0].type != "tool_use" and .[0].type != "tool_result")
                else
                    true
                end
            )
        ) |
        del(.model, .id, .type, .stop_reason, .stop_sequence, .usage)
    ' "$transcript" 2>/dev/null
}

# Extract conversation preview from preprocessed transcript
# Shows first 10 lines of cleansed messages
extract_conversation_preview() {
    local transcript=$1
    local preview=""
    local msg_count=0
    local max_messages=10

    # Preprocess and extract text
    while IFS= read -r message_json; do
        [[ -z "$message_json" ]] && continue

        # Extract role and content from preprocessed message
        local role=$(echo "$message_json" | jq -r '.role // "unknown"')
        local content=""

        # Handle both string and array content
        local content_type=$(echo "$message_json" | jq -r '.content | type')
        if [[ "$content_type" == "array" ]]; then
            # Extract text from array content (filter text type only)
            content=$(echo "$message_json" | jq -r '.content[] | select(.type == "text") | .text' | head -1)
        else
            # String content
            content=$(echo "$message_json" | jq -r '.content')
        fi

        [[ -z "$content" || "$content" == "null" ]] && continue

        # Skip meta/command messages by content pattern
        [[ "$content" =~ ^\<(command|local-command|tool) ]] && continue
        [[ "$content" =~ ^Caveat:.*running\ local\ commands ]] && continue
        [[ ${#content} -lt 10 ]] && continue  # Skip very short messages

        # Capitalize role
        local display_role="${role^}"

        # Truncate long lines
        if [[ ${#content} -gt 90 ]]; then
            content="${content:0:87}..."
        fi

        preview+="      ${display_role}: ${content}"$'\n'
        msg_count=$((msg_count + 1))

        [[ $msg_count -ge $max_messages ]] && break
    done < <(preprocess_transcript "$transcript")

    echo "$preview"
}

# Generate a unique ID for the test case
generate_test_id() {
    local length_category=$1
    local counter=$2
    printf "%s-%03d" "$length_category" "$counter"
}

# Add a transcript to the collection
add_transcript() {
    local session_id=$1
    local session_dir=$2
    local transcript_file=$3
    local line_count=$4
    local length_category=$5
    local description=$6

    # Generate unique test ID
    local test_id
    case "$length_category" in
        short) test_id=$(generate_test_id "short" $((++count_short))) ;;
        medium) test_id=$(generate_test_id "medium" $((++count_medium))) ;;
        long) test_id=$(generate_test_id "long" $((++count_long))) ;;
    esac

    # Copy transcript to output directory
    local dest_file="${test_id}.jsonl"
    cp "$transcript_file" "${OUTPUT_DIR}/${dest_file}"

    # Create metadata entry
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local entry=$(cat <<JSON
    {
      "id": "${test_id}",
      "file": "${dest_file}",
      "source_session": "${session_id}",
      "length_category": "${length_category}",
      "line_count": ${line_count},
      "description": "${description}",
      "collected_at": "${timestamp}"
    }
JSON
    )

    metadata_entries+=("$entry")
    count_total=$((count_total + 1))

    print_success "Added as ${test_id} (${length_category})"
}

# Generate final metadata.json
write_metadata() {
    print_info "Generating metadata.json..."

    # Join entries with commas
    local entries_json=""
    for i in "${!metadata_entries[@]}"; do
        if [[ $i -gt 0 ]]; then
            entries_json+=","
        fi
        entries_json+="${metadata_entries[$i]}"
    done

    # Write complete JSON
    cat > "$METADATA_FILE" <<JSON
{
  "dataset_version": "1.0",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "test_count": ${count_total},
  "distribution": {
    "short": ${count_short},
    "medium": ${count_medium},
    "long": ${count_long}
  },
  "transcripts": [
${entries_json}
  ]
}
JSON

    print_success "Metadata written to ${METADATA_FILE}"
}

# Display collection summary
show_summary() {
    print_header "Collection Summary"
    print_stat "Total transcripts" "$count_total"
    print_stat "Short (<50 lines)" "$count_short ($(( count_short * 100 / (count_total > 0 ? count_total : 1) ))%)"
    print_stat "Medium (50-150)" "$count_medium ($(( count_medium * 100 / (count_total > 0 ? count_total : 1) ))%)"
    print_stat "Long (>150 lines)" "$count_long ($(( count_long * 100 / (count_total > 0 ? count_total : 1) ))%)"
    echo ""

    # Check for balanced distribution
    local target_low=25
    local target_high=40
    local pct_short=$(( count_short * 100 / (count_total > 0 ? count_total : 1) ))
    local pct_medium=$(( count_medium * 100 / (count_total > 0 ? count_total : 1) ))
    local pct_long=$(( count_long * 100 / (count_total > 0 ? count_total : 1) ))

    if (( pct_short < target_low || pct_short > target_high )); then
        print_warning "Short transcripts: ${pct_short}% (target: 30-35%)"
    fi
    if (( pct_medium < target_low || pct_medium > target_high )); then
        print_warning "Medium transcripts: ${pct_medium}% (target: 30-40%)"
    fi
    if (( pct_long < target_low || pct_long > target_high )); then
        print_warning "Long transcripts: ${pct_long}% (target: 30-35%)"
    fi

    if (( count_total >= 20 && count_total <= 30 )); then
        print_success "Good sample size (20-30 recommended)"
    elif (( count_total < 20 )); then
        print_warning "Consider collecting more samples (20-30 recommended)"
    else
        print_info "Large sample set (${count_total} transcripts)"
    fi
}

###############################################################################
# Main Script
###############################################################################

main() {
    print_header "LLM Benchmark Test Data Collection"

    # Check for --reset flag
    if [[ "${1:-}" == "--reset" ]]; then
        print_warning "Resetting test data directory..."
        rm -f "${OUTPUT_DIR}"/*.jsonl "$METADATA_FILE"
        print_success "Existing test data cleared"
    fi

    # Verify projects directory exists
    if [[ ! -d "$PROJECTS_DIR" ]]; then
        echo "ERROR: Projects directory not found: $PROJECTS_DIR"
        exit 1
    fi

    # Verify output directory exists
    mkdir -p "$OUTPUT_DIR"

    # Check for existing metadata
    if [[ -f "$METADATA_FILE" ]]; then
        print_warning "Existing metadata.json found. Use --reset to start fresh."
        read -p "Continue and append? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
    fi

    print_info "Scanning projects directory: $PROJECTS_DIR"
    echo ""

    # Scan projects
    local session_count=0
    local processed=0

    for project_dir in "$PROJECTS_DIR"/*; do
        [[ -d "$project_dir" ]] || continue

        local project_name=$(basename "$project_dir")

        # Skip temporary Claude CLI projects
        if [[ "$project_name" == -tmp-* ]]; then
            continue
        fi

        local readable_project=$(extract_project_name "$project_name")

        # Scan transcripts in this project
        for transcript in "$project_dir"/*.jsonl; do
            [[ -f "$transcript" ]] || continue

            session_count=$((session_count + 1))

            # Extract session ID from filename (e.g., "51e06a7f-160e-4991-b7dc-1cadd8181b57.jsonl")
            local session_id=$(basename "$transcript" .jsonl)
            local line_count=$(wc -l < "$transcript")
            local length_category=$(classify_length "$line_count")
            local goal=$(extract_goal "$session_id")

            # Display session info
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            print_stat "Project" "$readable_project"
            print_stat "Session ID" "${session_id:0:12}..."
            print_stat "Lines" "$line_count"
            print_stat "Category" "$length_category"
            if [[ -n "$goal" ]]; then
                print_stat "Goal" "${goal:0:60}$([ ${#goal} -gt 60 ] && echo '...')"
            fi

            # Show conversation preview
            echo ""
            echo "  Conversation preview:"
            local preview=$(extract_conversation_preview "$transcript")
            if [[ -n "$preview" ]]; then
                echo "$preview"
            else
                echo "      (no preview available)"
            fi

            # Prompt user
            echo ""
            read -p "Include this transcript? [y/N/q] " -n 1 -r
            echo

            if [[ $REPLY =~ ^[Qq]$ ]]; then
                print_info "Quitting collection..."
                break 2
            fi

            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # Optionally prompt for custom description
                local description="$goal"
                if [[ -z "$description" ]]; then
                    read -p "Enter brief description (or press Enter to skip): " description
                fi

                # Add to collection
                add_transcript "$session_id" "$project_dir" "$transcript" \
                              "$line_count" "$length_category" \
                              "${description:-No description}"
            else
                print_info "Skipped"
            fi

            echo ""
            processed=$((processed + 1))
        done
    done

    # Generate metadata
    if [[ $count_total -gt 0 ]]; then
        write_metadata
        show_summary

        print_info "Test data ready in: $OUTPUT_DIR"
        print_info "Metadata file: $METADATA_FILE"
    else
        print_warning "No transcripts collected"
    fi

    echo ""
    print_info "Scanned $session_count sessions, processed $processed"
}

# Run main
main "$@"
