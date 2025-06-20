Execute the next pending task from plan-tracker.json with automated code review: $ARGUMENTS

## Purpose

This command reads `plan-tracker.json`, identifies the next task to execute, creates a working context, spawns implementation and review agents, and manages the review cycle to produce quality code ready for human review or PR.

## Process Overview

1. **Task Selection**:

   - Read plan-tracker.json from `/tasks/[plan-name]/`
   - Find next pending task respecting dependencies
   - Check prerequisites are met
   - Update task status to "in_progress"

2. **Context Preparation**:

   - Create scratchpad directory structure
   - Generate initial-context-summary.md
   - Gather relevant plan documents and dependencies
   - Create curated context for agents

3. **Implementation Cycle**:

   - Spawn implementation subagent with context
   - Subagent implements the task
   - Update status to "ready-for-review"

4. **Review Cycle** (up to 3 iterations):

   - Spawn review subagent to critique implementation
   - Generate code-review.md with specific feedback
   - Implementation subagent addresses review comments
   - Repeat until approved or max iterations reached

5. **Completion**:
   - Update task status to "completed" or "needs-human-review"
   - Log execution details
   - Prepare for next task or PR creation

## Directory Structure

```
/tasks/[plan-name]/
├── plan-tracker.json
├── scratch/
│   └── phase-[##]/
│       └── task-[##]/
│           ├── initial-context-summary.md
│           ├── code-review.md
│           ├── implementation-notes.md
│           └── review-iterations/
│               ├── review-1.md
│               ├── review-2.md
│               └── review-3.md
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

[Relevant sections]

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

### 3. Implementation Agent Prompt

```
You are tasked with implementing a specific task as part of a larger plan execution.

**IMPORTANT**: First, read the initial context summary at:
/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

This file contains all necessary context, requirements, and acceptance criteria for your task.

**Your responsibilities**:
1. Understand the task requirements completely
2. Implement the solution following project conventions
3. Write/update tests as needed
4. Ensure all acceptance criteria are met
5. Document your implementation decisions
6. Create an implementation-notes.md file documenting:
   - Key decisions made
   - Challenges encountered
   - Files created/modified
   - Testing approach

**When complete**:
- Ensure all tests pass
- Run linting/formatting tools
- Update the task status in plan-tracker.json to "ready-for-review"
- Summarize what was implemented

Focus on delivering a complete, working solution that meets all requirements.
```

### 4. Review Agent Prompt

```
You are a code reviewer tasked with reviewing an implementation for quality and completeness.

**IMPORTANT**: First, read the initial context summary at:
/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

**Review Process**:
1. Check git status and diff to see all changes
2. Verify all acceptance criteria are met
3. Review code quality, patterns, and best practices
4. Check test coverage and edge cases
5. Validate documentation updates

**Generate a detailed review in code-review.md** including:
- Overall assessment (Approved/Needs Changes)
- Specific issues found (if any) with file:line references
- Suggestions for improvement
- Confirmation of met acceptance criteria
- Any security or performance concerns

**Review Categories**:
- Functionality: Does it work as intended?
- Code Quality: Is it maintainable and follows patterns?
- Testing: Adequate coverage and edge cases?
- Documentation: Clear and updated?
- Security: Any vulnerabilities?

Be constructive but thorough. Provide specific, actionable feedback.
```

### 5. Review Response Instructions

```
Review feedback has been provided in code-review.md.

**Your task**:
1. Read the review feedback carefully
2. Address each point raised
3. Make necessary code changes
4. Add notes to code-review.md under each item:
   - [ADDRESSED]: Description of change made
   - [DISPUTED]: Explanation why change wasn't made
   - [CLARIFIED]: Additional context provided

**Important**:
- Focus on addressing the specific issues raised
- Maintain code quality while making changes
- Re-run tests after changes
- Update documentation if needed

When complete, update your section in code-review.md to indicate all feedback has been addressed.
```

## Status Flow

```
pending → in_progress → initialized → implementing → ready-for-review →
  ↓                                                    ↓
  └→ under-review → revision-needed → implementing ←─┘
                          ↓
                    needs-human-review (after 3 cycles)
                          ↓
                      completed
```

## Usage Examples

```bash
# Continue with next task in default plan
/plan-execute-continue

# Continue specific plan
/plan-execute-continue "web-app-redesign"

# Skip to specific phase/task
/plan-execute-continue "mobile-app --phase 2 --task 3"

# Force re-execution of current task
/plan-execute-continue "--retry-current"
```

## Arguments

Optional plan name: $ARGUMENTS

If no plan name provided, looks for plan-tracker.json in current directory or most recently used plan.

## Output

1. **Progress Summary**:

   - Current task being executed
   - Phase and overall completion percentage
   - Dependencies satisfied

2. **Execution Log**:

   - Agent spawning confirmations
   - Status updates
   - Review cycle progress

3. **Completion Report**:
   - Task outcome (completed/needs-human-review)
   - Files modified
   - Review iterations performed
   - Next recommended action

## Error Handling

- **No pending tasks**: Report completion or blocked tasks
- **Dependency not met**: List blocking dependencies
- **Review cycle exhausted**: Escalate to human review
- **Agent failure**: Retry with enhanced context
- **Invalid plan structure**: Provide diagnostic information

## Next Steps

After task completion:

- Run again for next task: `/plan-execute-continue`
- Create PR if phase complete: `/pr`
- Review execution logs in scratch directory
- Manual intervention if needed for blocked tasks
