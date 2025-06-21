Execute the next pending task from plan-tracker.json with automated code review: $ARGUMENTS

## Purpose

This command reads `plan-tracker.json`, identifies the next task to execute, creates a working context, spawns implementation and review agents, and manages the review cycle to produce quality code ready for human review or PR.

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
   - Find next pending task respecting dependencies
   - Check prerequisites are met
   - Update task status to "in_progress"

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

6. **Implementation Cycle**:

   - Spawn implementation subagent with context
   - Subagent reads context and architecture files entirely to understand system context
   - Subagent implements the task with context awareness
   - If architecture-level questions arise, spawn architect subagent for clarification
   - Update status to "ready-for-review"

7. **Review Cycle** (up to 3 iterations):

   - Spawn review subagent to critique implementation
   - Generate code-review.md (detailed feedback) and code-review-tracker.json (structured findings)
   - **Snapshot to review-audit/iteration-N-initial/** before implementation sees it
   - Implementation subagent addresses each finding (fix or reject with rationale)
   - **Snapshot to review-audit/iteration-N-response/** after implementation updates
   - Review subagent verifies fixes and evaluates rejection rationales
   - If disputes remain AND iteration < 3: increment iteration and repeat
   - If iteration = 3 AND disputes remain: set status to "needs-human-review" and stop
   - Complete audit trail preserved in review-audit/ directory

8. **Completion**:
   - Update task status to "completed" or "needs-human-review"
   - Log execution details
   - Prepare for next task or PR creation

## Directory Structure

```
/planning/tasks/[plan-name]/
├── plan-tracker.json
├── scratch/
│   └── phase-[##]/
│       └── task-[##]/
│           ├── initial-context-summary.md
│           ├── architect-review-[timestamp].json  # Pre-implementation architect review
│           ├── implementation-notes.md
│           ├── architect-qa-[timestamp].json       # Architecture Q&A sessions during implementation
│           ├── code-review.md                      # Current/active review
│           ├── code-review-tracker.json            # Current/active tracker
│           └── review-audit/                   # Historical snapshots
│               ├── iteration-1-initial/
│               │   ├── code-review.md
│               │   └── code-review-tracker.json
│               ├── iteration-1-response/
│               │   ├── code-review.md
│               │   └── code-review-tracker.json
│               ├── iteration-2-initial/
│               │   ├── code-review.md
│               │   └── code-review-tracker.json
│               └── iteration-2-response/
│                   ├── code-review.md
│                   └── code-review-tracker.json
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
      "category": "approach",
      "severity": "major",
      "description": "Complex custom caching solution when simple library exists",
      "file": "multiple",
      "line": null,
      "status": "recommended",
      "reviewer_comment": "Current implementation creates custom caching with 200+ lines of code. Consider using functools.lru_cache or redis-py which would accomplish the same with 20-30 lines and better reliability",
      "implementation_response": null,
      "implementation_rationale": null,
      "final_status": null
    },
    {
      "id": "finding-002",
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
      "id": "finding-003",
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
      "id": "finding-004",
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

### Review Audit System

The review-audit/ directory maintains a complete history of the review process:

**Snapshot Points**:

1. **iteration-N-initial/**: Captured immediately after reviewer creates review

   - Contains the original review findings before any responses
   - Preserves the reviewer's initial assessment

2. **iteration-N-response/**: Captured after implementation agent responds
   - Shows the state after fixes/rejections but before verification
   - Documents all implementation decisions and rationales

**Purpose**:

- Provides clear history of how issues were identified and resolved
- Enables human review of the full conversation between agents
- Prevents loss of context during iterative reviews
- Makes it easy to see what changed between iterations

**Example Flow**:

```
Initial Implementation → Review 1 → Snapshot (iteration-1-initial) →
Implementation Response → Snapshot (iteration-1-response) →
Review Verification → Disputes Found → Review 2 → Snapshot (iteration-2-initial) →
Implementation Response → Snapshot (iteration-2-response) →
Review Verification → Still Disputed → Review 3 → Snapshot (iteration-3-initial) →
Implementation Response → Snapshot (iteration-3-response) →
Review Verification → Still Disputed → STOP (needs-human-review)
```

**Iteration Limit Enforcement**:

- Maximum 3 review iterations to prevent endless loops
- After iteration 3, unresolved disputes escalate to human review
- Prevents agent cycles that don't converge on solutions

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

### 3. Implementation Agent Prompt

````
You are tasked with implementing a specific task as part of a larger plan execution.

**CRITICAL**: First, read the initial context summary at:
/planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

This file contains all necessary context, requirements, and acceptance criteria for your task.

**CRITICAL - Architecture Understanding**:
Before beginning implementation, you MUST:
1. Read the architect review file: `architect-review-[timestamp].json` in your task directory for:
   - Pre-analyzed architectural context for this specific task
   - Identified constraints, patterns, and integration guidance
   - Risk assessment and mitigation strategies
   - Specific implementation recommendations
2. Read `/planning/architecture.md` entirely to understand:
   - System architecture and component relationships
   - Data flow and integration patterns
   - Deployment and infrastructure considerations
   - Security architecture and boundaries
3. Read `/planning/standards.md` entirely to understand:
   - Coding standards and conventions
   - Testing requirements and strategies
   - Documentation standards
   - Quality assurance processes

**Your responsibilities**:
1. Understand the task requirements completely
2. Read and internalize the context, architecture and standards documentation
3. Implement the solution following project conventions and architectural patterns
4. Write/update tests as needed
5. Ensure all acceptance criteria are met
6. **Document code properly following these practices**:
   - Write self-descriptive code with clear variable and function names
   - Add file-level docstrings/comments explaining purpose and high-level approach
   - Document public classes and methods with clear descriptions, parameters, and return values
   - Add inline comments ONLY for complex logic, non-obvious decisions, or business rules
   - Document WHY (rationale) not WHAT (implementation) - code should be self-explanatory
   - Include examples in docstrings for complex APIs or usage patterns
   - Avoid over-commenting - prefer refactoring unclear code to be more readable
7. Create an implementation-notes.md file documenting:
   - Key decisions made
   - Challenges encountered
   - Files created/modified
   - Testing approach

**Architecture-Level Questions**:
If during implementation you encounter questions about:
- System architecture decisions or conflicts
- Integration patterns that aren't clear
- Component relationship ambiguities
- Standards interpretation or missing guidelines
- Architectural constraints or trade-offs

Then spawn an architect subagent using the Task tool as follows:

1. **Read the base architect prompt** from `~/.claude/.templates/architect-agent-prompt.md`
2. **Prepend your specific context** to create the complete prompt:

```
=== SPECIFIC CONTEXT FOR THIS SESSION ===

I am implementing [task name] and need architectural guidance. I have questions about [specific architecture area].

Questions:
1. [Specific question 1]
2. [Specific question 2]

Implementation Context:
- Task: [brief task description]
- Current implementation approach: [what you're trying to do]
- Specific confusion/conflict: [where you're stuck]
- Initial context summary: /planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

Please record your answers in the scratch file:
/planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/architect-qa-[timestamp].json

=== BASE ARCHITECT INSTRUCTIONS ===

[Insert the complete content from ~/.claude/.templates/architect-agent-prompt.md here]
```

3. **Use the combined prompt** when calling the Task tool to spawn the architect subagent

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
````

### 4. Architect Review Agent Prompt

````
You are the architect subagent responsible for reviewing the current system state and providing architectural context before task implementation.

**CRITICAL**: Read these files entirely before beginning your review:
- `/planning/architecture.md` - Current system architecture
- `/planning/standards.md` - Development standards and guidelines
- Initial context summary at: /planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

**Your Analysis Scope**:

1. **Current State Analysis**:
   - Review completed tasks and their architectural impact
   - Analyze existing codebase structure and patterns
   - Identify current architectural state and any technical debt
   - Review integration points and system boundaries

2. **Next Task Architectural Context**:
   - Understand the task requirements in architectural context
   - Identify potential architectural conflicts or challenges
   - Determine if the task requires architectural changes/updates
   - Assess impact on existing components and integrations

3. **Architecture Artifact Updates**:
   - Determine if architecture.md needs updates for this task
   - Identify if standards.md needs clarification or additions
   - Flag any missing architectural documentation
   - Recommend new architectural patterns or guidelines

4. **Implementation Guidance**:
   - Provide specific architectural constraints for implementation
   - Recommend integration patterns and approaches
   - Identify reusable components or services
   - Flag potential architectural risks or anti-patterns to avoid

**Generate Output File**:

Create `/planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/architect-review-[timestamp].json`:

```json
{
  "review_timestamp": "2025-06-21T10:30:00Z",
  "task_id": "[task-id]",
  "task_name": "[task-name]",
  "current_state_analysis": {
    "completed_tasks_impact": "Summary of how completed tasks affect architecture",
    "existing_patterns": ["List of established patterns in codebase"],
    "integration_points": ["Current integration points that may be affected"],
    "technical_debt": ["Any architectural issues identified"],
    "system_boundaries": "Current component/service boundaries"
  },
  "task_architectural_context": {
    "architectural_requirements": ["Specific architectural needs for this task"],
    "potential_conflicts": ["Areas where task might conflict with current architecture"],
    "integration_impact": "How this task affects system integration",
    "scalability_considerations": "Scalability implications of this task",
    "security_implications": "Security architectural considerations"
  },
  "required_artifact_updates": {
    "architecture_md_updates": ["Specific sections that need updates"],
    "standards_md_updates": ["Standards that need clarification/addition"],
    "new_documentation_needed": ["New docs that should be created"],
    "pattern_library_updates": ["New patterns to document"]
  },
  "implementation_guidance": {
    "architectural_constraints": ["Hard constraints implementation must follow"],
    "recommended_patterns": ["Specific patterns to use for this task"],
    "integration_approach": "Recommended approach for integrations",
    "reusable_components": ["Existing components that can be leveraged"],
    "anti_patterns_to_avoid": ["Specific things implementation should NOT do"]
  },
  "risk_assessment": {
    "architectural_risks": ["Potential architectural risks"],
    "mitigation_strategies": ["How to mitigate identified risks"],
    "monitoring_requirements": ["What should be monitored architecturally"]
  },
  "recommendations": {
    "pre_implementation_actions": ["Actions to take before implementation"],
    "during_implementation_notes": ["Key things to watch during implementation"],
    "post_implementation_validation": ["How to validate architectural compliance"]
  }
}
```

**After creating the architect review**:

1. **Update initial-context-summary.md** by adding an "Architectural Context" section that includes:
   - Key architectural insights from your review
   - Specific constraints and patterns to follow
   - Integration guidance and reusable components
   - Risks to be aware of during implementation

2. **Flag any blocking architectural issues** that must be resolved before implementation

3. **Recommend architecture artifact updates** if any are needed for this task

Your analysis ensures the implementation agent has comprehensive architectural context before beginning work, reducing the need for mid-implementation architectural questions and ensuring consistency with overall system design.
````

### 5. Review Agent Prompt

```
You are a code reviewer tasked with reviewing an implementation for quality and completeness.

**IMPORTANT**: First, read the initial context summary at:
/planning/tasks/[plan-name]/scratch/phase-[##]/task-[##]/initial-context-summary.md

**Review Process**:
1. Check git status and diff to see all changes
2. **MANDATORY**: Run all linting and syntax checking tools before code review:
   - **Python**: Execute `ruff check`, `ruff format --check`, `black --check`, `mypy`, and `pyright` if available
   - **Node.js/TypeScript**: Execute `npm run lint`, `npm run format -- --check`, `tsc --noEmit`, and any ESLint/Prettier commands
   - **Other**: Run all project-specific linting commands found in package.json, Makefile, or CI configuration
3. **CRITICAL**: Flag any linting errors, type errors, or formatting issues as blocking issues
4. **EVALUATE THE APPROACH**: Before reviewing code details, assess the overall solution:
   - Does this approach solve the problem effectively?
   - Is there a simpler, more maintainable way to achieve the same result?
   - Does the solution follow established patterns in the codebase?
   - Are there any architectural concerns or missed opportunities?
   - If you see a clearly better approach, recommend it as a major finding
5. **ASSESS CODE DOCUMENTATION QUALITY**:
   - Are files properly documented with purpose and high-level approach?
   - Are public classes/methods documented with clear descriptions, parameters, and return values?
   - Is complex logic explained with rationale (WHY not WHAT)?
   - Is the code self-descriptive with appropriate naming?
   - Are there examples for complex APIs or usage patterns?
   - Is documentation balanced (not over-commented, not under-documented)?
6. Verify all acceptance criteria are met
7. Review code quality, patterns, and best practices
8. Check test coverage and edge cases
9. Validate external documentation updates (README, API docs, etc.)

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
   - Set category from review categories list (including "approach" for architectural concerns)
   - Include specific file:line references (use "multiple" for approach-level issues)
   - Set all findings to "recommended" status initially
   - **For approach issues**: Include alternative solution suggestions in the reviewer_comment

**After creating both files**:
- Copy both files to `review-audit/iteration-1-initial/` (or appropriate iteration number)
- This preserves your original review before the implementation agent responds

**Review Categories**:
- **Approach & Architecture**: Is this the right solution approach? Any simpler/better alternatives?
- **Linting & Syntax**: All linting tools pass without errors or warnings
- **Type Safety**: All type checking tools pass (mypy, pyright, tsc, etc.)
- **Code Formatting**: Code follows project formatting standards
- **Functionality**: Does it work as intended?
- **Code Quality**: Is it maintainable and follows patterns?
- **Testing**: Adequate coverage and edge cases?
- **Code Documentation**: Proper documentation practices followed:
  - File-level documentation explaining purpose and approach
  - Public API documented with clear descriptions, parameters, return values
  - Complex logic explained with rationale (WHY, not WHAT)
  - Self-descriptive code with minimal over-commenting
  - Examples provided for complex usage patterns
- **Project Documentation**: External docs (README, API docs) updated as needed
- **Security**: Any vulnerabilities?

Be constructive but thorough. Provide specific, actionable feedback.
```

### 6. Review Response Instructions

````markdown
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

**After addressing all findings**:

- Copy both code-review.md and code-review-tracker.json to `review-audit/iteration-N-response/`
- This preserves your responses before the reviewer verifies them

When complete, ensure code-review-tracker.json shows all findings have been addressed (either fixed or rejected with rationale).
````

### 7. Review Verification Instructions

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
- If any blockers remain or items disputed:
  - Check current iteration number
  - If iteration < 3: Mark as "Needs Resolution" and create new review iteration
    - Copy files to `review-audit/iteration-N-initial/` after creating the new review
  - If iteration = 3: Mark task as "needs-human-review" and STOP
    - Include summary of remaining disputes in final assessment
    - Do NOT create iteration 4

```

## Status Flow

```text
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
# Continue with next task in last referenced plan (reads from /planning/tasks/last-plan.json)
/plan-execute-continue

# Continue specific plan (updates /planning/tasks/last-plan.json)
/plan-execute-continue "web-app-redesign"

# Skip to specific phase/task
/plan-execute-continue "mobile-app --phase 2 --task 3"

# Force re-execution of current task
/plan-execute-continue "--retry-current"

# Example workflow showing last-plan tracking:
/plan-execute-continue "web-app-redesign"  # Updates last-plan.json
/plan-execute-continue                     # Uses "web-app-redesign" from last-plan.json
/plan-status                              # Also uses "web-app-redesign"
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
   - Review cycle progress

3. **Completion Report**:
   - Task outcome (completed/needs-human-review)
   - Files modified
   - Review iterations performed (with audit trail in review-audit/)
   - Summary of any unresolved disputes
   - Next recommended action

## Error Handling

- **No pending tasks**: Report completion or blocked tasks
- **Dependency not met**: List blocking dependencies
- **Review cycle exhausted (3 iterations)**: Mark task as "needs-human-review" with complete audit trail
- **Disputed findings remain after iteration 3**: Stop processing, escalate to human with dispute summary
- **Blocker issues unresolved after 3 iterations**: Cannot proceed without human resolution
- **Agent failure**: Retry with enhanced context
- **Invalid plan structure**: Provide diagnostic information

## Next Steps

After task completion:

- Run again for next task: `/plan-execute-continue`
- Create PR if phase complete: `/pr`
- Review execution logs and audit trail in scratch directory:
  - `review-audit/` contains full history of review cycles
  - Current state in `code-review.md` and `code-review-tracker.json`
- Manual intervention if needed for blocked tasks or disputed findings
