Execute the next pending task from plan-tracker.json with automated code review: $ARGUMENTS

## Purpose

This command ensures proper architecture documentation, reads `plan-tracker.json`, identifies the next task to execute, creates a working context, all in prep to get the next task to execute ready for implementation.

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

3. **Task Selection**:

   - Read plan-tracker.json from `/planning/tasks/[plan-name]/`
   - Find next pending or preparing task respecting dependencies
   - If the task is in preparing state, warn the user that the task is already in a preparing state and see if the user wants to continue or stop
   - Check prerequisites are met
   - Update task status to "preparing"

4. **Context Preparation**:

   - Create scratchpad directory structure
   - Generate initial-context-summary.md with architecture file references
   - Gather relevant plan documents and dependencies
   - Include architecture documentation in context when available
   - Create curated context for agents

5. **Architect Review Phase**:

   - Spawn architect subagent to review current state and next task
   - Architect analyzes:
     - Completed tasks and their architectural implications
     - Current system state and existing code patterns
     - Next task requirements in architectural context
     - Integration points and potential conflicts
     - Required updates to architecture artifacts
   - Generate architect-review-[timestamp].json with insights
   - Update initial-context-summary.md with architectural context
   - Flag any architectural concerns or recommendations

6. **Completion**:
   - Update task status to "ready" or "needs-human-review"
   - Log execution details

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

- **No pending tasks**: Report completion or blocked tasks
- **Dependency not met**: List blocking dependencies
- **Blocker issues unresolved after 3 iterations**: Cannot proceed without human resolution
- **Agent failure**: Retry with enhanced context
- **Invalid plan structure**: Provide diagnostic information

## Next Steps

After task completion:

- Implement next ready task: `/implement-task`
- Run again for next task: `/prepare-next-task`
- Create PR if phase complete: `/pr`
- Manual intervention if needed for blocked tasks or disputed findings
