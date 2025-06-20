Incorporate user feedback to refine and improve the plan: $ARGUMENTS

## Purpose

This command takes user suggestions, corrections, or new ideas and intelligently updates the existing plan. It re-evaluates the high-level structure, adjusts phases, and ensures the plan remains coherent while incorporating the feedback.

## Process

1. **Feedback Analysis**:
   - Parse user input for specific suggestions
   - Identify type of change (addition, modification, removal, pivot)
   - Determine impact scope (single task, phase, or entire plan)
   - Assess compatibility with existing objectives

2. **Impact Assessment**:
   - Analyze how changes affect dependencies
   - Evaluate resource and timeline implications
   - Check for conflicts with existing work
   - Consider ripple effects across phases

3. **Plan Revision**:
   - Update affected sections of PLAN.md
   - Regenerate impacted phase files if needed
   - Adjust dependencies and timelines
   - Document changes and rationale

4. **Validation**:
   - Ensure plan coherence after changes
   - Verify all objectives still achievable
   - Check dependency graph remains valid
   - Confirm acceptance criteria alignment

## Change Categories

### 1. Feature Addition
```markdown
User: "Add real-time notifications to the dashboard"
Actions:
- Identify appropriate phase for integration
- Add new tasks for notification system
- Update dependencies for related features
- Adjust timeline estimates
```

### 2. Approach Modification
```markdown
User: "Use microservices instead of monolithic architecture"
Actions:
- Restructure development phases
- Update all technical tasks
- Revise deployment strategy
- Modify testing approach
```

### 3. Scope Adjustment
```markdown
User: "Let's start with just the core features and add reporting later"
Actions:
- Move reporting tasks to future phase
- Simplify initial phases
- Update success criteria
- Adjust resource allocation
```

### 4. Priority Shift
```markdown
User: "Security should be built-in from the start, not added later"
Actions:
- Integrate security tasks into each phase
- Remove dedicated security phase
- Update all implementation tasks
- Add security acceptance criteria
```

## Implementation Details

### Change Analysis Framework

1. **Parse Feedback**:
   ```
   - Extract key change requests
   - Identify affected components
   - Determine change magnitude
   - Assess feasibility
   ```

2. **Generate Change Plan**:
   ```
   - List specific modifications needed
   - Order changes by dependency
   - Identify files to update
   - Plan validation steps
   ```

3. **Apply Changes**:
   ```
   - Update PLAN.md with revisions
   - Modify affected phase files
   - Regenerate dependencies.md
   - Update README.md if needed
   ```

4. **Document Changes**:
   ```
   - Create change-log.md entry
   - Note rationale for changes
   - Track original vs revised approach
   - Update timeline/resource estimates
   ```

## Change Log Template

```markdown
# Plan Change Log

## [Date] - Ideation Session

### User Feedback
"[Original user input]"

### Analysis
- **Change Type**: Addition/Modification/Removal/Pivot
- **Impact Level**: Low/Medium/High
- **Affected Phases**: [Phase numbers/names]

### Changes Applied

1. **PLAN.md Updates**:
   - [Specific section]: [Change description]
   - Modified objectives to include [new requirement]
   - Adjusted phase structure to [explanation]

2. **Phase File Updates**:
   - phase-02-implementation.md: Added tasks for [feature]
   - phase-03-testing.md: Updated validation criteria
   
3. **Dependency Changes**:
   - [Task A] now depends on [new Task B]
   - Removed dependency between [X] and [Y]

4. **Timeline Impact**:
   - Phase 2 extended by ~[N] days
   - Overall timeline impact: [description]

### Rationale
[Explanation of why changes improve the plan]

### Validation
- [ ] All objectives still achievable
- [ ] Dependencies remain valid
- [ ] Resources adequate for changes
- [ ] Risk assessment updated
```

## Usage Examples

```bash
# Add new feature to existing plan
/plan-ideate "web-app-redesign: Add multi-language support throughout the application"

# Change technical approach
/plan-ideate "api-project: Switch from REST to GraphQL for better performance"

# Adjust project scope
/plan-ideate "mobile-app: Focus on iOS first, delay Android to phase 5"

# Modify architecture
/plan-ideate "data-pipeline: Add caching layer between processing stages"

# Update based on new requirements
/plan-ideate "customer-portal: Client wants SSO integration with their AD system"
```

## Arguments

Format: `[plan-name]: [feedback/suggestion]`

The feedback should clearly describe:
- What needs to change
- Why the change is beneficial
- Any constraints or preferences

## Output

1. **Change Summary**:
   - What was modified
   - Impact on timeline/resources
   - Updated phase structure
   - New dependencies created

2. **Updated Files**:
   - List of modified files
   - Key changes in each file
   - New content highlights

3. **Validation Report**:
   - Coherence check results
   - Dependency validation
   - Risk assessment updates
   - Recommended next steps

## Smart Adaptation Features

### 1. Context Preservation
- Maintains completed work integrity
- Preserves valid dependencies
- Retains successful patterns

### 2. Intelligent Integration
- Finds optimal placement for new features
- Minimizes disruption to existing plan
- Leverages existing components

### 3. Proactive Suggestions
- Identifies related improvements
- Suggests complementary changes
- Warns about potential issues

### 4. Learning from Patterns
- Recognizes common change types
- Applies successful adaptation strategies
- Improves suggestions over time

## Workflow Integration

After ideation:

1. **Review Changes**:
   - Check updated PLAN.md
   - Verify phase modifications
   - Confirm timeline adjustments

2. **Decompose New Elements**:
   - Run `/plan-decompose --regenerate` if major changes
   - Update only affected phases for minor changes

3. **Update Tracking**:
   - If execution started, update plan-tracker.json
   - Mark affected tasks for re-evaluation
   - Adjust completion percentages

4. **Continue Execution**:
   - Resume with `/plan-execute-continue`
   - Re-prioritize based on changes

## Best Practices

1. **Timing Considerations**:
   - Ideate early before deep execution
   - Batch related changes together
   - Consider work already completed

2. **Clear Communication**:
   - Be specific about desired changes
   - Explain reasoning when possible
   - Mention any constraints

3. **Iterative Refinement**:
   - Start with high-level changes
   - Refine with subsequent ideation
   - Validate after each round

## Next Steps

After plan updates:
1. Review all modified files
2. Run `/plan-brainstorm-options` for strategic alternatives
3. Decompose updated phases with `/plan-decompose`
4. Re-initialize tracking if needed