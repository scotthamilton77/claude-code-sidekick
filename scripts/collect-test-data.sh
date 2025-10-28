#!/bin/bash
###############################################################################
# collect-test-data.sh
#
# Interactive script to collect diverse transcript samples for LLM benchmarking.
# Scans ~/.claude/projects/, displays stats, and prompts user to include/skip
# each transcript. Generates metadata.json with test case classifications.
#
# Usage:
#   ./scripts/collect-test-data.sh [--reset] [--test-data]
#
# Options:
#   --reset      Clear existing test data and start fresh
#   --test-data  Use pre-collected test data from test-data/ directories
#                (auto-includes all transcripts without prompting)
###############################################################################

set -euo pipefail

# Mode flags
TEST_DATA_MODE=false

# Directories (will be overridden in test-data mode)
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
        short)
            count_short=$((count_short + 1))
            test_id=$(generate_test_id "short" "$count_short")
            ;;
        medium)
            count_medium=$((count_medium + 1))
            test_id=$(generate_test_id "medium" "$count_medium")
            ;;
        long)
            count_long=$((count_long + 1))
            test_id=$(generate_test_id "long" "$count_long")
            ;;
    esac

    # Copy transcript to output directory
    local dest_file="${test_id}.jsonl"
    cp "$transcript_file" "${OUTPUT_DIR}/${dest_file}"

    # Create metadata entry using jq for proper JSON escaping
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local entry=$(jq -n \
        --arg id "$test_id" \
        --arg file "$dest_file" \
        --arg session "$session_id" \
        --arg category "$length_category" \
        --argjson lines "$line_count" \
        --arg desc "$description" \
        --arg ts "$timestamp" \
        '{
            id: $id,
            file: $file,
            source_session: $session,
            length_category: $category,
            line_count: $lines,
            description: $desc,
            collected_at: $ts
        }')

    metadata_entries+=("$entry")
    count_total=$((count_total + 1))

    print_success "Added as ${test_id} (${length_category})"
}

# Generate final metadata.json
write_metadata() {
    print_info "Generating metadata.json..."

    # Write all entries to a temp file (one JSON object per line)
    local temp_entries=$(mktemp)
    for entry in "${metadata_entries[@]}"; do
        echo "$entry" >> "$temp_entries"
    done

    # Use jq slurp to read all entries and build the final JSON
    jq -n \
        --arg version "1.0" \
        --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --argjson count "$count_total" \
        --argjson short "$count_short" \
        --argjson medium "$count_medium" \
        --argjson long "$count_long" \
        --slurpfile transcripts "$temp_entries" \
        '{
            dataset_version: $version,
            generated_at: $timestamp,
            test_count: $count,
            distribution: {
                short: $short,
                medium: $medium,
                long: $long
            },
            transcripts: $transcripts
        }' > "$METADATA_FILE"

    # Clean up temp file
    rm -f "$temp_entries"

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
    # Parse command-line arguments
    local reset_mode=false
    for arg in "$@"; do
        case "$arg" in
            --reset)
                reset_mode=true
                ;;
            --test-data)
                TEST_DATA_MODE=true
                ;;
            *)
                echo "ERROR: Unknown option: $arg"
                echo "Usage: $0 [--reset] [--test-data]"
                exit 1
                ;;
        esac
    done

    # Override directories in test-data mode
    if [[ "$TEST_DATA_MODE" == true ]]; then
        PROJECTS_DIR="test-data/projects"
        SIDEKICK_SESSIONS_DIR="test-data/sessions"
        print_header "LLM Benchmark Test Data Collection (TEST-DATA MODE)"
        print_info "Using pre-collected data from test-data/ directories"
    else
        print_header "LLM Benchmark Test Data Collection"
    fi

    # Check for --reset flag
    if [[ "$reset_mode" == true ]]; then
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

            # Show conversation preview (unless in test-data mode)
            if [[ "$TEST_DATA_MODE" != true ]]; then
                echo ""
                echo "  Conversation preview:"
                local preview=$(extract_conversation_preview "$transcript")
                if [[ -n "$preview" ]]; then
                    echo "$preview"
                else
                    echo "      (no preview available)"
                fi
            fi

            # In test-data mode, auto-include all transcripts
            # In interactive mode, prompt user
            local should_include=false
            if [[ "$TEST_DATA_MODE" == true ]]; then
                should_include=true
            else
                # Prompt user
                echo ""
                read -p "Include this transcript? [y/N/q] " -n 1 -r
                echo

                if [[ $REPLY =~ ^[Qq]$ ]]; then
                    print_info "Quitting collection..."
                    break 2
                fi

                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    should_include=true
                fi
            fi

            if [[ "$should_include" == true ]]; then
                # Use goal as description, or prompt in interactive mode
                local description="$goal"
                if [[ "$TEST_DATA_MODE" != true && -z "$description" ]]; then
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
