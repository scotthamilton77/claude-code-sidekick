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
   - Generate code-review.md (detailed feedback) and code-review-tracker.json (structured findings)
   - Implementation subagent addresses each finding (fix or reject with rationale)
   - Review subagent verifies fixes and evaluates rejection rationales
   - Tracker maintains full audit trail of decisions
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
│           ├── code-review-tracker.json
│           ├── implementation-notes.md
│           └── review-iterations/
│               ├── review-1.md
│               ├── review-1-tracker.json
│               ├── review-2.md
│               ├── review-2-tracker.json
│               ├── review-3.md
│               └── review-3-tracker.json
```

## Implementation Details

### Code Review Tracker Structure

The `code-review-tracker.json` file provides structured tracking of the review process, enabling:
- Clear audit trail of all review findings and resolutions
- Explicit rationale documentation for rejected suggestions
- Automatic tracking of blocker issues that must be resolved
- Separation of review content (code-review.md) from status tracking
- Measurable progress through the review cycle

The tracker maintains the complete conversation between reviewer and implementor:

```json
{
  "review_iteration": 1,
  "total_findings": 5,
  "findings": [
    {
      "id": "finding-001",
      "category": "linting",
      "severity": "blocker",
      "description": "Type errors in user_service.py:45",
      "file": "user_service.py",
      "line": 45,
      "status": "recommended",
      "reviewer_comment": "Missing type annotation for 'user_data' parameter",
      "implementation_response": null,
      "implementation_rationale": null,
      "final_status": null
    },
    {
      "id": "finding-002",
      "category": "functionality",
      "severity": "major",
      "description": "Missing error handling for database connection",
      "file": "database.py",
      "line": 120,
      "status": "fixed",
      "reviewer_comment": "Need try-catch for connection failures",
      "implementation_response": "Added comprehensive error handling with retry logic",
      "implementation_rationale": "Implemented exponential backoff retry pattern",
      "final_status": "accepted"
    },
    {
      "id": "finding-003",
      "category": "code_quality",
      "severity": "minor",
      "description": "Function could be simplified",
      "file": "utils.py",
      "line": 89,
      "status": "rejected",
      "reviewer_comment": "Complex nested conditionals could use early returns",
      "implementation_response": "Keeping current implementation",
      "implementation_rationale": "Current structure follows team's established pattern for validation logic, changing would be inconsistent",
      "final_status": "recommended"
    }
  ],
  "summary": {
    "blockers_remaining": 1,
    "fixed": 1,
    "rejected": 1,
    "pending": 2,
    "accepted": 1
  }
}
```

**Finding Status Workflow**:
- `recommended` → Initial state when reviewer creates finding
- `fixed` → Implementation agent addressed the issue
- `rejected` → Implementation agent declined with rationale
- `accepted` → Reviewer verified the fix
- `disputed` → Reviewer disagrees with rejection, needs resolution

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
- Run comprehensive linting and formatting tools based on project type:
  - **Python**: Run `ruff check`, `ruff format`, `black`, `mypy`, and `pyright` (if available)
  - **Node.js/TypeScript**: Run `npm run lint`, `npm run format`, `tsc --noEmit`, and any project-specific linting
  - **Other**: Run project-specific linting commands found in package.json, Makefile, or project documentation
- **CRITICAL**: Address ALL linting errors and warnings before proceeding
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
2. **MANDATORY**: Run all linting and syntax checking tools before code review:
   - **Python**: Execute `ruff check`, `ruff format --check`, `black --check`, `mypy`, and `pyright` if available
   - **Node.js/TypeScript**: Execute `npm run lint`, `npm run format -- --check`, `tsc --noEmit`, and any ESLint/Prettier commands
   - **Other**: Run all project-specific linting commands found in package.json, Makefile, or CI configuration
3. **CRITICAL**: Flag any linting errors, type errors, or formatting issues as blocking issues
4. Verify all acceptance criteria are met
5. Review code quality, patterns, and best practices
6. Check test coverage and edge cases
7. Validate documentation updates

**Generate TWO files for the review**:

1. **code-review.md** - Detailed narrative review including:
   - Overall assessment (Approved/Needs Changes)
   - Detailed explanation of each issue found
   - Suggestions for improvement
   - Confirmation of met acceptance criteria
   - Any security or performance concerns

2. **code-review-tracker.json** - Structured tracking of findings:
   - Create a finding entry for each issue identified
   - Assign unique IDs (finding-001, finding-002, etc.)
   - Set severity: blocker (must fix), major (should fix), minor (consider fixing)
   - Set category from review categories list
   - Include specific file:line references
   - Set all findings to "recommended" status initially

**Review Categories**:
- **Linting & Syntax**: All linting tools pass without errors or warnings
- **Type Safety**: All type checking tools pass (mypy, pyright, tsc, etc.)
- **Code Formatting**: Code follows project formatting standards
- **Functionality**: Does it work as intended?
- **Code Quality**: Is it maintainable and follows patterns?
- **Testing**: Adequate coverage and edge cases?
- **Documentation**: Clear and updated?
- **Security**: Any vulnerabilities?

Be constructive but thorough. Provide specific, actionable feedback.
```

### 5. Review Response Instructions

```
Review feedback has been provided in code-review.md and code-review-tracker.json.

**Your task**:
1. Read BOTH the detailed review (code-review.md) and tracker (code-review-tracker.json)
2. For each finding in code-review-tracker.json:
   - If you fix the issue: Update status to "fixed" and add implementation_response
   - If you reject the suggestion: Update status to "rejected" and add detailed implementation_rationale
   - Focus on addressing all "blocker" severity issues first
3. Make necessary code changes for items you're fixing
4. **MANDATORY**: After making changes, re-run all linting and formatting tools:
   - **Python**: `ruff check`, `ruff format`, `black`, `mypy`, `pyright`
   - **Node.js/TypeScript**: `npm run lint`, `npm run format`, `tsc --noEmit`, ESLint/Prettier
   - **Other**: All project-specific linting commands
5. **CRITICAL**: Ensure all linting passes before marking issues as fixed
6. Update code-review-tracker.json with your responses:
   ```json
   {
     "status": "fixed",
     "implementation_response": "Added type annotations to all function parameters",
     "implementation_rationale": "Used Union types to handle multiple input types"
   }
   ```
   OR
   ```json
   {
     "status": "rejected", 
     "implementation_response": "Not changing current implementation",
     "implementation_rationale": "Current pattern matches team conventions and changing would break consistency with 20+ other similar functions"
   }
   ```

**Important**:
- ALL blocker issues must be either fixed or have detailed rejection rationale
- Provide clear rationale for any rejected suggestions
- Re-run tests after changes
- Update the summary counts in code-review-tracker.json

When complete, ensure code-review-tracker.json shows all findings have been addressed (either fixed or rejected with rationale).
```

### 6. Review Verification Instructions

```
The implementation agent has responded to your review. Check their work:

**Your task**:
1. Read the updated code-review-tracker.json
2. For each finding with status "fixed":
   - Verify the fix actually addresses the issue
   - Re-run relevant linting/testing to confirm
   - Update final_status to "accepted" if satisfied
   - If not satisfied, update final_status to "disputed" with additional reviewer_comment
3. For each finding with status "rejected":
   - Review the implementation_rationale carefully
   - If rationale is valid, update final_status to "accepted"
   - If you disagree, update final_status to "disputed" with additional reviewer_comment explaining why
4. Update the summary in code-review-tracker.json

**Decision criteria**:
- Accept rejection only if rationale is technically sound and well-justified
- Dispute if rejection compromises code quality, security, or maintainability
- All "blocker" issues must be resolved (either fixed or accepted rejection)

**Final Assessment**:
- If all blockers resolved and no disputed items: Mark review as "Approved"
- If any blockers remain or items disputed: Mark as "Needs Resolution"
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
- **Review cycle exhausted**: Escalate to human review with code-review-tracker.json summary
- **Disputed findings remain**: Mark task as needs-human-review with dispute details
- **Blocker issues unresolved**: Cannot proceed without resolution
- **Agent failure**: Retry with enhanced context
- **Invalid plan structure**: Provide diagnostic information

## Next Steps

After task completion:

- Run again for next task: `/plan-execute-continue`
- Create PR if phase complete: `/pr`
- Review execution logs in scratch directory
- Manual intervention if needed for blocked tasks
