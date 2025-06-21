Execute the next pending task from plan-tracker.json with automated code review: $ARGUMENTS

## Purpose

This command prepares the next task for implementation by validating architecture documentation, identifying the next available task, creating implementation context, and conducting pre-implementation architectural review. The task is marked as "ready" upon successful completion.

## Entry Criteria

- Valid plan-tracker.json exists (either specified by name, in last-plan.json, or current directory)
- At least one task with status "pending" and satisfied dependencies exists
- User confirmation to proceed if architecture documentation is missing

## Exit Criteria

**Success** (task marked as "ready"):
- Next available task identified and marked as "preparing" (until we're done then it's marked "ready")
- All dependencies verified as satisfied
- Context files created in scratch directory structure
- Architect review completed and saved as architect-review-[timestamp].json
- initial-context-summary.md updated with architectural context
- Task status updated to "ready"

**Failure** (task remains "pending"):
- No tasks available due to unsatisfied dependencies
- User declines to proceed without architecture documentation
- Critical architecture conflicts identified that require human resolution

## Process Overview

1. **Plan Name Resolution**:

   - If plan name provided in $ARGUMENTS, use it and update `/planning/tasks/last-plan.json`
   - If no plan name provided, read from `/planning/tasks/last-plan.json` for the last referenced plan
   - If neither exists, check for plan-tracker.json in current directory
   - Update `/planning/tasks/last-plan.json` with resolved plan name

2. **Architecture Documentation Check**:

   - Check if `/planning/architecture.md` and `/planning/standards.md` exist
   - If architecture files are missing:
     - Ask user if they want to continue without architecture documentation
     - Recommend running `/plan-architecture` first for better context
     - If user chooses to continue, note the missing architecture in context

3. **Task Selection and Validation**:

   - Read plan-tracker.json from `/planning/tasks/[plan-name]/`
   - **Validate plan structure**: Ensure phases and tasks arrays exist with required fields
   - Find next pending task respecting dependencies using selection algorithm
   - **Handle task conflicts**: If task is in "preparing" state, warn user and offer options:
     - Continue (override previous preparation)
     - Stop (exit without changes)
     - Reset to pending (clear previous preparation)
   - **Dependency validation**: Check all task and phase dependencies are satisfied
   - **Block on unmet dependencies**: If dependencies not met, list blocking items and exit
   - Update task status to "preparing" only after all validations pass

4. **Context Preparation**:

   - Create scratchpad directory structure
   - Generate initial-context-summary.md with architecture file references
   - Gather relevant plan documents and dependencies
   - Include architecture documentation in context when available
   - Create curated context for agents

5. **Architect Review Phase**:

   - **Pre-review validation**: Ensure architect can access architecture files and task context
   - Spawn architect subagent to review current state and next task
   - Architect analyzes:
     - Completed tasks and their architectural implications
     - Current system state and existing code patterns
     - Next task requirements in architectural context
     - Integration points and potential conflicts
     - Required updates to architecture artifacts
   - **Generate structured output**: Create architect-review-[timestamp].json with required fields
   - **Validate architect output**: Ensure all required sections are complete
   - **Update context**: Add architectural insights to initial-context-summary.md
   - **Handle blocking issues**: If critical architectural conflicts found:
     - Mark task as "needs-human-review"
     - Document specific conflicts requiring resolution
     - Exit without marking task as "ready"

6. **Completion and Validation**:
   - **Final validation**: Verify all required files exist and are properly formatted
   - **Status update**: Mark task as "ready" if all steps completed successfully
   - **Alternative outcomes**: Mark as "needs-human-review" if blocking issues found
   - **Log execution**: Record detailed execution log with timestamps and file locations
   - **Verification**: Confirm task is ready for implement-task.md to pick up

## Directory Structure

```
/planning/tasks/[plan-name]/
├── plan-tracker.json
├── scratch/
│   └── phase-[##]/
│       └── task-[##]/
│           ├── initial-context-summary.md
│           ├── architect-review-[timestamp].json  # Pre-implementation architect review
│           └── implementation-notes.md
```

## Implementation Details

### 1. Task Selection Algorithm

```javascript
// Pseudo-code for task selection
function selectNextTask(tracker) {
  for (phase of tracker.phases) {
    if (phase.status === "completed") continue;

    // Check phase dependencies
    if (!areDependenciesMet(phase.dependencies)) continue;

    for (task of phase.tasks) {
      if (task.status === "pending") {
        // Check task dependencies
        if (areDependenciesMet(task.dependencies)) {
          return { phase, task };
        }
      }
    }
  }
  return null; // All tasks complete or blocked
}
```

### 2. Initial Context Summary Template

```markdown
# Task Implementation Context

## Task Information

- **Phase**: [Phase Name] (ID: [phase_id])
- **Task**: [Task Name] (ID: [task_id])
- **Priority**: [priority]
- **Status**: initialized

## Task Description

[Full task description from plan]

## Acceptance Criteria

1. [Criterion 1]
2. [Criterion 2]
   ...

## Dependencies

- [List of completed dependencies]
- [External requirements]

## Relevant Context

### From plan_context_source_files (e.g. plan's README.md, PLAN.md, \*-PLAN.md)

- [List and link to these files]

[Relevant sections]

### From Architecture Documentation

**CRITICAL**: Read these architecture files entirely before beginning implementation to understand the system context:

- `/planning/architecture.md` - System architecture, component design, data flow
- `/planning/standards.md` - Development standards, coding guidelines, quality requirements

**Architecture Status**: [Available/Missing - if missing, note that architecture context is limited]

### Architectural Context

**Pre-Implementation Architect Review**: [Reference to architect-review-[timestamp].json]

**Key Architectural Insights**:

- [Architectural constraints that must be followed]
- [Recommended patterns and approaches for this task]
- [Integration points and reusable components]
- [Specific risks to be aware of during implementation]

**Architecture Artifact Updates Required**:

- [Updates needed to architecture.md]
- [Updates needed to standards.md]
- [New documentation to be created]

**Implementation Guidance**:

- [Specific architectural patterns to use]
- [Anti-patterns to avoid]
- [Integration approach recommendations]
- [Validation requirements for architectural compliance]

### From Phase Documentation

[Phase-specific context]

### Related Completed Tasks

[Summary of related completed work]

## Technical Requirements

- [Specific technical details]
- [Frameworks/libraries to use]
- [Constraints or limitations]

## Deliverables

- [Expected outputs]
- [Files to create/modify]

## Implementation Guidelines

- Follow existing code patterns in the project
- Ensure all tests pass
- Update documentation as needed
- Consider edge cases and error handling
```

## Usage Examples

```bash
# Prepare the next task in last referenced plan (reads from /planning/tasks/last-plan.json)
/prepare-next-task

# Prepare specific plan (updates /planning/tasks/last-plan.json)
/prepare-next-task "web-app-redesign"

# Skip to specific phase/task
/prepare-next-task "mobile-app --phase 2 --task 3"

# Force re-preparation of current task
/prepare-next-task "--retry-current"

# Example workflow showing last-plan tracking:
/prepare-next-task "web-app-redesign"  # Updates last-plan.json
/prepare-next-task                     # Uses "web-app-redesign" from last-plan.json
/status                                # Also uses "web-app-redesign"
```

## Arguments

**Plan Name**: $ARGUMENTS (optional)

- If no plan name provided, uses the last referenced plan from `/planning/tasks/last-plan.json`
- If last-plan.json doesn't exist, checks for plan-tracker.json in current directory
- Updates `/planning/tasks/last-plan.json` with the resolved plan name for future commands

## Output

1. **Progress Summary**:

   - Current task being executed
   - Phase and overall completion percentage
   - Dependencies satisfied

2. **Execution Log**:

   - Agent spawning confirmations
   - Status updates

3. **Completion Report**:
   - Task outcome (completed/needs-human-review)
   - Files modified
   - Next recommended action

## Error Handling

**Validation Errors**:
- **Invalid plan structure**: Report specific missing fields and exit
- **Plan file not found**: Guide user to create plan or specify correct name
- **Malformed JSON**: Report parsing errors with line numbers

**Task Selection Errors**:
- **No pending tasks**: Report plan completion status or list blocked tasks with reasons
- **All tasks blocked**: List each blocking dependency and suggested resolution steps
- **Task already preparing**: Offer user choice to override, reset, or exit

**Architecture Errors**:
- **Missing architecture files**: Prompt user to continue or run /plan-architecture first
- **Architect agent failure**: Log error details, attempt retry once, then exit
- **Critical architectural conflicts**: Document conflicts and mark task as needs-human-review

**Context Creation Errors**:
- **Directory creation failure**: Report permission issues and required paths
- **Template file issues**: Fall back to minimal context structure
- **File write failures**: Report specific path and permission problems

**Recovery Actions**:
- **Partial preparation**: Clean up incomplete scratch directories before exit
- **Task status rollback**: Reset task to "pending" if preparation fails after status update
- **Detailed logging**: Always log exact failure point for debugging

## Next Steps

**After successful preparation** (task marked as "ready"):
- Execute the prepared task: `/implement-task`
- Task will be automatically selected from "ready" status

**After preparation failure**:
- Review error details and resolve blocking issues
- Re-run: `/prepare-next-task` (same arguments)
- Consider architecture setup: `/plan-architecture` if architecture files missing

**When no more tasks to prepare**:
- Check plan status: `/status`
- Create PR if phase complete: `/pr`
- Manual review for any tasks marked "needs-human-review"

**Integration with implement-task**:
- implement-task.md looks for tasks with status "ready"
- No task name needs to be passed - it finds the ready task automatically
- Prepared context in scratch directory is automatically used
