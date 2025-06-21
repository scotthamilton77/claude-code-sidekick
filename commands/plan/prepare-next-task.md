Prepare the next task for implementation with architectural review and context creation: $ARGUMENTS

## Purpose

This command prepares the next pending task for implementation by validating dependencies, creating implementation context, conducting architectural review, and marking the task as "ready" for execution. Uses Claude Code todos for progress tracking and state management to prevent duplicate work.

## Implementation Strategy

This command immediately creates todos for all major steps, then executes each step with proper state checking to avoid duplicate work and provide clear progress visibility.

---

I'll begin by creating todos for the complete preparation workflow:

```claude-todo-setup
/todo-write {
  "todos": [
    {
      "id": "plan-resolution",
      "content": "Resolve plan name and validate plan-tracker.json exists and is readable",
      "status": "pending",
      "priority": "high"
    },
    {
      "id": "architecture-check", 
      "content": "Check architecture documentation availability and warn if missing",
      "status": "pending",
      "priority": "medium"
    },
    {
      "id": "task-selection",
      "content": "Select next available task, validate dependencies, and handle state conflicts",
      "status": "pending", 
      "priority": "high"
    },
    {
      "id": "context-creation",
      "content": "Create scratch directory structure and initial context files",
      "status": "pending",
      "priority": "high"
    },
    {
      "id": "architecture-primer-creation",
      "content": "Create architecture primer (or reuse existing if valid) and generate architecture-primer.json",
      "status": "pending",
      "priority": "high"
    },
    {
      "id": "finalization",
      "content": "Update context with architect insights and mark task as 'ready'",
      "status": "pending",
      "priority": "high"
    }
  ]
}
```

Now I'll execute each step with proper state management:

## Step 1: Plan Name Resolution and Validation

Mark the plan-resolution todo as in_progress, then:

**Plan Name Resolution Logic:**
- If plan name provided in $ARGUMENTS: use it and update `/planning/tasks/last-plan.json`
- If no plan name provided: read from `/planning/tasks/last-plan.json` 
- If neither exists: check for plan-tracker.json in current directory
- Update `/planning/tasks/last-plan.json` with resolved plan name

**Validation Steps:**
```bash
# Check if plan-tracker.json exists and is readable
plan_tracker_path="/planning/tasks/[resolved-plan-name]/plan-tracker.json"
if ! test -f "$plan_tracker_path"; then
    echo "ERROR: plan-tracker.json not found at $plan_tracker_path"
    echo "Run /plan-execution-init [plan-name] first to initialize tracking"
    exit 1
fi

# Validate JSON structure
if ! jq 'empty' "$plan_tracker_path" 2>/dev/null; then
    echo "ERROR: plan-tracker.json contains invalid JSON"
    echo "Check file format and repair if needed"
    exit 1
fi
```

Mark plan-resolution todo as completed on success.

## Step 2: Architecture Documentation Check

Mark architecture-check todo as in_progress, then:

**Check Architecture Files:**
```bash
arch_missing=false
if ! test -f "/planning/architecture.md"; then
    echo "WARNING: /planning/architecture.md not found"
    arch_missing=true
fi
if ! test -f "/planning/standards.md"; then
    echo "WARNING: /planning/standards.md not found" 
    arch_missing=true
fi

if [ "$arch_missing" = true ]; then
    echo "Architecture documentation is missing."
    echo "Recommend running /plan-architecture first for better context."
    read -p "Continue without architecture documentation? (y/n): " continue_choice
    if [ "$continue_choice" != "y" ]; then
        echo "Exiting. Run /plan-architecture first, then retry this command."
        /todo-write '{"todos": [{"id": "plan-resolution", "content": "Resolve plan name and validate plan-tracker.json exists and is readable", "status": "completed", "priority": "high"}, {"id": "architecture-check", "content": "Check architecture documentation availability and warn if missing", "status": "completed", "priority": "medium"}, {"id": "task-selection", "content": "Select next available task, validate dependencies, and handle state conflicts", "status": "pending", "priority": "high"}, {"id": "context-creation", "content": "Create scratch directory structure and initial context files", "status": "pending", "priority": "high"}, {"id": "architecture-primer-creation", "content": "Create architecture primer (or reuse existing if valid) and generate architecture-primer.json", "status": "pending", "priority": "high"}, {"id": "finalization", "content": "Update context with architect insights and mark task as ready", "status": "pending", "priority": "high"}]}'
        exit 0
    fi
fi
```

Mark architecture-check todo as completed.

## Step 3: Task Selection and State Management  

Mark task-selection todo as in_progress, then:

**Task Selection Algorithm:**
```javascript
// Read plan-tracker.json and find next available task
function selectNextTask(tracker) {
  for (const phase of tracker.phases) {
    if (phase.status === "completed") continue;
    
    // Check phase dependencies are satisfied
    if (!areDependenciesMatched(phase.dependencies, tracker)) continue;
    
    for (const task of phase.tasks) {
      if (task.status === "pending") {
        // Check task dependencies are satisfied
        if (areDependenciesMatched(task.dependencies, tracker)) {
          return { phase, task };
        }
      }
    }
  }
  return null; // No available tasks
}
```

**State Conflict Handling:**
```bash
# If selected task status is "preparing" or "ready"
if [ "$task_status" = "preparing" ]; then
    echo "Task is already being prepared (status: preparing)"
    echo "Options:"
    echo "1. Continue (override previous preparation)"
    echo "2. Reset to pending (clear previous preparation)" 
    echo "3. Exit without changes"
    read -p "Choose option (1/2/3): " conflict_choice
    
    case $conflict_choice in
        1) echo "Continuing with override..." ;;
        2) # Reset task to pending, clean scratch directory
           echo "Resetting task to pending..."
           # Update tracker status atomically
           ;;
        3) echo "Exiting without changes"; exit 0 ;;
        *) echo "Invalid choice"; exit 1 ;;
    esac
elif [ "$task_status" = "ready" ]; then
    echo "Task is already prepared (status: ready)"
    read -p "Re-prepare this task? (y/n): " reprepare_choice
    if [ "$reprepare_choice" != "y" ]; then
        echo "Task is ready for implementation. Run /implement-task to proceed."
        exit 0
    fi
fi
```

**Atomic Status Update:**
```bash
# Update task status to "preparing" atomically
temp_tracker=$(mktemp)
jq '.phases['"${phase_index}"'].tasks['"${task_index}"'].status = "preparing"' \
   "$plan_tracker_path" > "$temp_tracker"
mv "$temp_tracker" "$plan_tracker_path"
```

Mark task-selection todo as completed.

## Step 4: Context Creation

Mark context-creation todo as in_progress, then:

**Directory Structure Creation:**
```bash
scratch_dir="/planning/tasks/${plan_name}/scratch/phase-${phase_id}/task-${task_id}"
mkdir -p "$scratch_dir"

# Check if initial-context-summary.md already exists
if test -f "$scratch_dir/initial-context-summary.md"; then
    echo "Context file already exists, checking if update needed..."
    # Compare timestamps, only regenerate if plan files are newer
    if find_plan_files_newer_than_context; then
        echo "Updating context file with latest plan information..."
        generate_context_file
    else
        echo "Context file is current, skipping regeneration"
    fi
else
    echo "Generating initial context file..."
    generate_context_file
fi
```

**Context File Template Generation:**
```markdown
# Task Implementation Context

## Task Information
- **Phase**: [Phase Name] (ID: ${phase_id})
- **Task**: [Task Name] (ID: ${task_id}) 
- **Priority**: [priority]
- **Status**: preparing → ready (after architecture primer creation)

## Task Description
[Full task description from plan]

## Acceptance Criteria
[List acceptance criteria]

## Dependencies
**Satisfied Dependencies:**
[List completed dependencies that enabled this task]

**External Requirements:**
[List external requirements]

## Relevant Context

### From Plan Context Source Files
- PLAN.md: [link and relevant sections]
- README.md: [link and relevant sections]
- Phase documentation: [link and relevant sections]

### From Architecture Documentation
**Architecture Status**: [Available/Missing with details]

**CRITICAL**: Read these architecture files entirely before implementation:
- `/planning/architecture.md` - System architecture, component design, data flow
- `/planning/standards.md` - Development standards, coding guidelines

### Architectural Context
**Pre-Implementation Architecture Primer**: [Will reference architecture-primer.json]

[Architectural context will be populated after architecture primer creation]

## Technical Requirements
[Specific technical details from plan]

## Implementation Guidelines
- Follow existing code patterns in the project
- Ensure all tests pass before marking complete
- Update documentation as needed
- Consider edge cases and error handling
- Maintain architectural compliance
```

Mark context-creation todo as completed.

## Step 5: Architecture Primer Creation

Mark architecture-primer-creation todo as in_progress, then:

**Smart Architecture Primer Logic:**
```bash
# Check for existing architecture primer file
architecture_primer_file="$scratch_dir/architecture-primer.json"

if test -f "$architecture_primer_file"; then
    # Found existing primer, check if recent enough to reuse
    primer_age_hours=$(( ($(date +%s) - $(stat -c %Y "$architecture_primer_file")) / 3600 ))
    
    if [ $primer_age_hours -lt 24 ]; then
        echo "Found recent architecture primer (${primer_age_hours}h old): $(basename "$architecture_primer_file")"
        read -p "Reuse existing primer? (y/n): " reuse_choice
        
        if [ "$reuse_choice" = "y" ]; then
            echo "Reusing existing architecture primer: $(basename "$architecture_primer_file")"
            # Skip to context update step
            skip_architecture_primer=true
        fi
    else
        echo "Found older architecture primer (${primer_age_hours}h old): $(basename "$architecture_primer_file")"
        read -p "Generate new primer? (y/n): " new_primer_choice
        if [ "$new_primer_choice" != "y" ]; then
            echo "Keeping existing primer: $(basename "$architecture_primer_file")"
            skip_architecture_primer=true
        fi
    fi
fi

# Generate new architecture primer if not reusing existing
if [ "$skip_architecture_primer" != true ]; then
    echo "Generating new architecture primer..."
    iso_timestamp=$(date -Iseconds)
    
    # Spawn architect agent with comprehensive context
    /task "Architecture Primer Creation" "
    You are an expert software architect creating an architecture primer for task implementation.
    
    **Context:**
    - Plan: $plan_name
    - Phase: $phase_name (ID: $phase_id)
    - Task: $task_name (ID: $task_id)
    - Plan tracker: $plan_tracker_path
    - Context file: $scratch_dir/initial-context-summary.md
    - Architecture files: /planning/architecture.md, /planning/standards.md
    
    **Analysis Required:**
    1. Review completed tasks and their architectural implications
    2. Analyze current system state and existing code patterns
    3. Examine next task requirements in architectural context
    4. Identify integration points and potential conflicts
    5. Recommend updates to architecture artifacts
    6. Create todos for architecture documentation updates
    7. Actually update the architecture files as needed
    
    **Tasks to Complete:**
    1. Use TodoWrite to create todos for any architecture file updates needed
    2. Actually update /planning/architecture.md and /planning/standards.md as needed
    3. Mark architecture update todos as completed after making changes
    
    **Output Format:**
    Generate a structured JSON file with these sections:
    {
      \"primer_metadata\": {
        \"timestamp\": \"$iso_timestamp\",
        \"plan_name\": \"$plan_name\", 
        \"phase_id\": \"$phase_id\",
        \"task_id\": \"$task_id\",
        \"architect\": \"architect-agent\",
        \"architecture_files_available\": boolean
      },
      \"current_state_analysis\": {
        \"completed_tasks_summary\": \"Summary of completed work\",
        \"architectural_debt\": [\"List of architectural issues\"],
        \"existing_patterns\": [\"Code patterns to follow\"],
        \"integration_points\": [\"Systems that will be affected\"]
      },
      \"task_analysis\": {
        \"architectural_significance\": \"high|medium|low\",
        \"complexity_assessment\": \"Description of implementation complexity\",
        \"risk_factors\": [\"List of implementation risks\"],
        \"recommended_approach\": \"Recommended implementation strategy\"
      },
      \"implementation_guidance\": {
        \"architectural_constraints\": [\"Must-follow constraints\"],
        \"recommended_patterns\": [\"Patterns to use\"],
        \"anti_patterns_to_avoid\": [\"Patterns to avoid\"],
        \"integration_strategy\": \"How to integrate with existing systems\",
        \"validation_requirements\": [\"How to verify architectural compliance\"]
      },
      \"architecture_updates_completed\": {
        \"architecture_md_updates\": [\"Changes made to architecture.md\"],
        \"standards_md_updates\": [\"Changes made to standards.md\"],
        \"new_documentation_created\": [\"New docs created\"]
      },
      \"blocking_issues\": [\"Critical issues requiring human resolution\"],
      \"recommendations\": [\"Overall recommendations for this task\"]
    }
    
    Save this JSON structure to: $architecture_primer_file
    
    CRITICAL: 
    - If any blocking architectural conflicts are found, mark them clearly in the blocking_issues array
    - Use TodoWrite to create todos for architecture updates, then actually complete them
    - Only mark architecture updates as 'completed' in the JSON after actually making the changes
    "
    
    # Validate architecture primer output
    if ! test -f "$architecture_primer_file"; then
        echo "ERROR: Architecture primer failed to generate output file"
        # Rollback task status to pending
        rollback_task_status_to_pending
        exit 1
    fi
    
    if ! jq 'empty' "$architecture_primer_file" 2>/dev/null; then
        echo "ERROR: Architecture primer generated invalid JSON"
        # Rollback task status to pending  
        rollback_task_status_to_pending
        exit 1
    fi
    
    # Check for blocking issues
    blocking_issues=$(jq -r '.blocking_issues | length' "$architecture_primer_file")
    if [ "$blocking_issues" -gt 0 ]; then
        echo "CRITICAL: Architecture primer found blocking issues:"
        jq -r '.blocking_issues[]' "$architecture_primer_file"
        echo "Task requires human resolution before implementation."
        
        # Update task status to "needs-human-review"
        temp_tracker=$(mktemp)
        jq '.phases['"${phase_index}"'].tasks['"${task_index}"'].status = "needs-human-review"' \
           "$plan_tracker_path" > "$temp_tracker"
        mv "$temp_tracker" "$plan_tracker_path"
        
        /todo-write '{"todos": [{"id": "plan-resolution", "content": "Resolve plan name and validate plan-tracker.json exists and is readable", "status": "completed", "priority": "high"}, {"id": "architecture-check", "content": "Check architecture documentation availability and warn if missing", "status": "completed", "priority": "medium"}, {"id": "task-selection", "content": "Select next available task, validate dependencies, and handle state conflicts", "status": "completed", "priority": "high"}, {"id": "context-creation", "content": "Create scratch directory structure and initial context files", "status": "completed", "priority": "high"}, {"id": "architecture-primer-creation", "content": "Create architecture primer (or reuse existing if valid) and generate architecture-primer.json", "status": "completed", "priority": "high"}, {"id": "finalization", "content": "Update context with architect insights and mark task as ready", "status": "pending", "priority": "high"}]}'
        exit 1
    fi
    
    echo "Architecture primer completed successfully: $(basename "$architecture_primer_file")"
fi
```

Mark architecture-primer-creation todo as completed.

## Step 6: Finalization and Status Update

Mark finalization todo as in_progress, then:

**Update Context with Architect Insights:**
```bash
# Extract key insights from architecture primer
architect_insights=$(jq -r '.implementation_guidance.recommended_patterns[]' "$architecture_primer_file")
architectural_constraints=$(jq -r '.implementation_guidance.architectural_constraints[]' "$architecture_primer_file")
integration_strategy=$(jq -r '.implementation_guidance.integration_strategy' "$architecture_primer_file")

# Update initial-context-summary.md with architect insights
sed -i '/### Architectural Context/,$d' "$scratch_dir/initial-context-summary.md"
cat >> "$scratch_dir/initial-context-summary.md" << EOF

### Architectural Context

**Pre-Implementation Architecture Primer**: $(basename "$architecture_primer_file")

**Key Architectural Insights:**
$(echo "$architect_insights" | sed 's/^/- /')

**Architectural Constraints:**
$(echo "$architectural_constraints" | sed 's/^/- /')

**Integration Strategy:**
$integration_strategy

**Implementation Guidance:**
- Follow architectural patterns specified in the primer
- Validate compliance with architectural constraints
- Consider integration points with existing systems
- Address risk factors identified in the primer

EOF
```

**Final Validation and Status Update:**
```bash
# Verify all required files exist
required_files=(
    "$scratch_dir/initial-context-summary.md"
    "$architecture_primer_file"
)

for file in "${required_files[@]}"; do
    if ! test -f "$file"; then
        echo "ERROR: Required file missing: $file"
        rollback_task_status_to_pending
        exit 1
    fi
done

# Atomically update task status to "ready"
temp_tracker=$(mktemp)
jq '.phases['"${phase_index}"'].tasks['"${task_index}"'].status = "ready" | .phases['"${phase_index}"'].tasks['"${task_index}"'].prepared_at = "'"$(date -Iseconds)"'"' \
   "$plan_tracker_path" > "$temp_tracker"
mv "$temp_tracker" "$plan_tracker_path"

echo "✅ Task preparation completed successfully!"
echo "Task status: ready"
echo "Next step: Run /implement-task to begin implementation"
```

Mark finalization todo as completed.

## Error Handling and Rollback

**Rollback Function:**
```bash
function rollback_task_status_to_pending() {
    echo "Rolling back task status to pending due to error..."
    temp_tracker=$(mktemp)
    jq '.phases['"${phase_index}"'].tasks['"${task_index}"'].status = "pending"' \
       "$plan_tracker_path" > "$temp_tracker"
    mv "$temp_tracker" "$plan_tracker_path"
    
    # Clean up partial scratch directory if it was created
    if [ -d "$scratch_dir" ] && [ -z "$(ls -A "$scratch_dir" 2>/dev/null)" ]; then
        rmdir "$scratch_dir"
        echo "Cleaned up empty scratch directory"
    fi
}
```

## Usage Examples

```bash
# Prepare next task in last referenced plan
/prepare-next-task

# Prepare specific plan (updates last-plan.json)  
/prepare-next-task "web-app-redesign"

# Check current preparation status
/todo-read
```
