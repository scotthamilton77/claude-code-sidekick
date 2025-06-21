#!/bin/bash

# resolve-plan-name.sh
# Resolves plan name using the planning system's resolution strategy
# Returns JSON with resolved plan name and metadata

set -euo pipefail

# Function to output JSON error
error_json() {
    local message="$1"
    echo "{\"success\": false, \"error\": \"$message\"}" >&2
    exit 1
}

# Function to output JSON success
success_json() {
    local plan_name="$1"
    local source="$2"
    local last_plan_file="/planning/tasks/last-plan.json"
    
    # Update last-plan.json with resolved plan name
    local last_plan_dir
    last_plan_dir=$(dirname "$last_plan_file")
    mkdir -p "$last_plan_dir"
    
    echo "{\"plan_name\": \"$plan_name\", \"last_updated\": \"$(date -Iseconds)\"}" > "$last_plan_file"
    
    echo "{\"success\": true, \"plan_name\": \"$plan_name\", \"source\": \"$source\", \"last_plan_updated\": true}"
}

# Parse command line arguments
PLAN_NAME=""
if [[ $# -gt 0 ]]; then
    PLAN_NAME="$1"
fi

LAST_PLAN_FILE="/planning/tasks/last-plan.json"
CURRENT_DIR_TRACKER="./plan-tracker.json"

# Step 1: If plan name provided in arguments, use it
if [[ -n "$PLAN_NAME" ]]; then
    # Validate the plan exists
    PLAN_DIR="/planning/tasks/$PLAN_NAME"
    if [[ ! -d "$PLAN_DIR" ]]; then
        error_json "Plan directory not found: $PLAN_DIR"
    fi
    
    if [[ ! -f "$PLAN_DIR/plan-tracker.json" ]]; then
        error_json "Plan tracker not found: $PLAN_DIR/plan-tracker.json"
    fi
    
    success_json "$PLAN_NAME" "command_argument"
fi

# Step 2: If no plan name provided, read from last-plan.json
if [[ -f "$LAST_PLAN_FILE" ]]; then
    # Parse the last plan name from JSON
    if command -v jq >/dev/null 2>&1; then
        LAST_PLAN_NAME=$(jq -r '.plan_name // empty' "$LAST_PLAN_FILE" 2>/dev/null || true)
    else
        # Fallback parsing without jq
        LAST_PLAN_NAME=$(grep -o '"plan_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$LAST_PLAN_FILE" 2>/dev/null | sed 's/.*"plan_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)
    fi
    
    if [[ -n "$LAST_PLAN_NAME" ]]; then
        # Validate the last plan still exists
        PLAN_DIR="/planning/tasks/$LAST_PLAN_NAME"
        if [[ -d "$PLAN_DIR" && -f "$PLAN_DIR/plan-tracker.json" ]]; then
            success_json "$LAST_PLAN_NAME" "last_plan_json"
        else
            # Last plan no longer exists, remove the invalid reference
            rm -f "$LAST_PLAN_FILE"
        fi
    fi
fi

# Step 3: Check for plan-tracker.json in current directory
if [[ -f "$CURRENT_DIR_TRACKER" ]]; then
    # Extract plan name from the tracker file
    if command -v jq >/dev/null 2>&1; then
        CURRENT_PLAN_NAME=$(jq -r '.planName // .plan_name // empty' "$CURRENT_DIR_TRACKER" 2>/dev/null || true)
    else
        # Fallback parsing without jq
        CURRENT_PLAN_NAME=$(grep -o '"plan_name\|planName"[[:space:]]*:[[:space:]]*"[^"]*"' "$CURRENT_DIR_TRACKER" 2>/dev/null | sed 's/.*"plan_name\|planName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -1 || true)
    fi
    
    if [[ -n "$CURRENT_PLAN_NAME" ]]; then
        success_json "$CURRENT_PLAN_NAME" "current_directory_tracker"
    else
        error_json "Found plan-tracker.json in current directory but could not extract plan name"
    fi
fi

# Step 4: No plan found anywhere
error_json "No plan found. Provide a plan name, ensure last-plan.json exists, or run from a directory with plan-tracker.json"