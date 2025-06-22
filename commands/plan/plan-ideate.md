Incorporate user feedback to refine and improve the Atlas project plan: $ARGUMENTS

## Purpose

This command takes user suggestions, corrections, or new ideas and intelligently updates the existing Atlas project and knowledge. It re-evaluates the high-level structure, adjusts phases, and ensures the plan remains coherent while incorporating the feedback through Atlas MCP integration.

## Process

1. **Atlas Project Resolution**:

   - If plan name provided in $ARGUMENTS, use it and update `/planning/tasks/last-plan.json`
   - If no plan name provided, read from `/planning/tasks/last-plan.json` for the last referenced plan
   - If neither exists, check for Atlas projects in current directory
   - Update `/planning/tasks/last-plan.json` with resolved plan name
   - Validate Atlas project exists using `atlas_project_list`

2. **Atlas Knowledge-Based Feedback Analysis**:

   - Use `atlas_knowledge_list` to retrieve current plan documentation
   - Parse user input for specific suggestions
   - Identify type of change (addition, modification, removal, pivot)
   - Determine impact scope using Atlas task relationships
   - Assess compatibility with existing objectives from Atlas project data

3. **Atlas-Powered Impact Assessment**:

   - Use `atlas_task_list` to analyze how changes affect task dependencies
   - Evaluate resource and timeline implications using Atlas project metadata
   - Check for conflicts with existing work through Atlas task status
   - Consider ripple effects across phases using Atlas knowledge patterns

4. **Atlas Project and Knowledge Revision**:

   - Use `atlas_knowledge_add` to store updated plan content with proper tags
   - Use `atlas_project_update` to modify project metadata when needed
   - Use `atlas_task_update` to adjust task dependencies and timelines
   - Document changes and rationale as Atlas knowledge with `doc-type-implementation-notes`

5. **Atlas Integration Validation**:
   - Ensure plan coherence after changes using Atlas knowledge consistency
   - Verify all objectives still achievable through Atlas project validation
   - Check dependency graph remains valid using Atlas task relationships
   - Confirm acceptance criteria alignment through Atlas task data

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

## Atlas Integration Implementation

### **Step 1: Atlas Context Retrieval**

```javascript
// Read coordination file for Atlas project context
const lastPlan = await readLastPlanReference()
if (!lastPlan?.atlas_project_id) {
  throw new Error("No Atlas project found. Run /plan-create first.")
}

// Use TodoWrite for progress tracking
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "pending", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "pending", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "pending", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "pending", priority: "medium" }
  ]
})

// Retrieve current Atlas project and knowledge
const project = await atlas_project_list({ 
  mode: "details", 
  id: lastPlan.atlas_project_id,
  includeKnowledge: true,
  includeTasks: true 
})

const planKnowledge = await atlas_knowledge_list({
  projectId: lastPlan.atlas_project_id,
  tags: ["doc-type-plan-overview", "lifecycle-planning"],
  limit: 50
})

const allTasks = await atlas_task_list({
  projectId: lastPlan.atlas_project_id,
  limit: 100
})
```

### **Step 2: Atlas-Powered Change Analysis**

```javascript
// Mark feedback analysis as in progress
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "in_progress", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "pending", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "pending", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "pending", priority: "medium" }
  ]
})

// Parse feedback using Atlas context
const feedbackAnalysis = analyzeFeedbackWithAtlasContext(userFeedback, {
  project,
  planKnowledge,
  allTasks
})

// Extract key change requests
const changeRequests = extractChangeRequests(feedbackAnalysis)
const affectedComponents = identifyAffectedComponents(changeRequests, allTasks)
const changeMagnitude = determineChangeMagnitude(changeRequests, project)
const feasibilityAssessment = assessFeasibility(changeRequests, project)
```

### **Step 3: Atlas Impact Assessment**

```javascript
// Mark impact assessment as in progress
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "completed", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "in_progress", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "pending", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "pending", priority: "medium" }
  ]
})

// Analyze Atlas task dependencies
const dependencyImpact = analyzeDependencyImpact(changeRequests, allTasks)
const resourceImplications = evaluateResourceImplications(changeRequests, project)
const conflictAnalysis = checkForConflicts(changeRequests, allTasks)
const rippleEffects = analyzeRippleEffects(changeRequests, planKnowledge)
```

### **Step 4: Atlas Project and Knowledge Updates**

```javascript
// Mark Atlas updates as in progress
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "completed", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "completed", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "in_progress", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "pending", priority: "medium" }
  ]
})

// Update Atlas project metadata if needed
if (changeRequests.requiresProjectUpdate) {
  await atlas_project_update({
    mode: "single",
    id: lastPlan.atlas_project_id,
    updates: generateProjectUpdates(changeRequests)
  })
}

// Store updated plan content in Atlas knowledge
const updatedPlanContent = generateUpdatedPlanContent(planKnowledge, changeRequests)
await atlas_knowledge_add({
  mode: "single",
  projectId: lastPlan.atlas_project_id,
  text: updatedPlanContent,
  domain: project.taskType === "technical" ? "technical" : "business",
  tags: ["doc-type-plan-overview", "lifecycle-planning", "quality-approved"]
})

// Store change rationale
const changeRationale = generateChangeRationale(changeRequests, feedbackAnalysis)
await atlas_knowledge_add({
  mode: "single",
  projectId: lastPlan.atlas_project_id,
  text: changeRationale,
  domain: "business",
  tags: ["doc-type-implementation-notes", "lifecycle-planning", "change-rationale"]
})

// Update affected Atlas tasks
if (changeRequests.affectedTasks.length > 0) {
  const taskUpdates = generateTaskUpdates(changeRequests.affectedTasks)
  await atlas_task_update({
    mode: "bulk",
    tasks: taskUpdates
  })
}
```

### **Step 5: Atlas Validation and Completion**

```javascript
// Mark validation as in progress
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "completed", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "completed", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "completed", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "in_progress", priority: "medium" }
  ]
})

// Validate plan coherence using Atlas data
const validationResults = await validatePlanCoherence(lastPlan.atlas_project_id)

// Update coordination file
lastPlan.last_ideation = {
  timestamp: new Date().toISOString(),
  feedback_processed: userFeedback.substring(0, 100),
  changes_applied: changeRequests.length,
  validation_status: validationResults.status
}
lastPlan.last_updated = new Date().toISOString()
lastPlan.updated_by = "plan-ideate"

await writeFile('/planning/tasks/last-plan.json', JSON.stringify(lastPlan, null, 2))

// Complete all todos
await TodoWrite({
  todos: [
    { id: "analyze-feedback", content: "Analyze user feedback for plan changes", status: "completed", priority: "high" },
    { id: "assess-impact", content: "Assess impact on Atlas tasks and dependencies", status: "completed", priority: "high" },
    { id: "update-atlas", content: "Update Atlas project and knowledge", status: "completed", priority: "high" },
    { id: "validate-changes", content: "Validate plan coherence after changes", status: "completed", priority: "medium" }
  ]
})
```

## Change Documentation Template

Changes are documented in Atlas knowledge with proper categorization:

```markdown
# Atlas Plan Change Log

## [Date] - Ideation Session

### User Feedback

"[Original user input]"

### Analysis

- **Change Type**: Addition/Modification/Removal/Pivot
- **Impact Level**: Low/Medium/High
- **Affected Tasks**: [Atlas task IDs]

### Atlas Changes Applied

1. **Atlas Project Updates**:

   - Project metadata: [Change description]
   - Modified objectives in Atlas project
   - Adjusted completion requirements

2. **Atlas Knowledge Updates**:
   - Updated plan overview with `doc-type-plan-overview` tags
   - Added implementation notes with `doc-type-implementation-notes` tags
   - Tagged with `lifecycle-planning` and `quality-approved`

3. **Atlas Task Changes**:

   - [Task A] dependencies updated to include [new Task B]
   - Removed dependency between [Task X] and [Task Y]
   - Updated task priorities and status

4. **Timeline Impact**:
   - Task completion requirements extended
   - Overall project impact: [description]

### Rationale

[Explanation of why changes improve the plan]

### Atlas Validation

- [ ] All Atlas project objectives still achievable
- [ ] Atlas task dependencies remain valid
- [ ] Atlas project resources adequate for changes
- [ ] Risk assessment stored in Atlas knowledge
```

## Usage Examples

```bash
# Add new feature to last referenced Atlas project (reads from /planning/tasks/last-plan.json)
/plan-ideate "Add multi-language support throughout the application"

# Add new feature to specific Atlas project (updates /planning/tasks/last-plan.json)
/plan-ideate "plan-web-app-redesign: Add multi-language support throughout the application"

# Change technical approach
/plan-ideate "plan-api-project: Switch from REST to GraphQL for better performance"

# Adjust project scope using last plan
/plan-ideate "Focus on iOS first, delay Android to phase 5"

# Modify architecture
/plan-ideate "plan-data-pipeline: Add caching layer between processing stages"

# Example workflow showing Atlas integration:
/plan-create "E-commerce platform"        # Creates Atlas project and updates last-plan.json
/plan-ideate "Add shopping cart analytics" # Updates Atlas knowledge from last-plan.json
/plan-decompose                           # Regenerates Atlas tasks
```

## Arguments

**Format**: `[plan-name]: [feedback/suggestion]` or just `[feedback/suggestion]`

**Atlas Project Resolution**:

- If plan name provided before colon, use it and update `/planning/tasks/last-plan.json`
- If no plan name provided, uses the last referenced plan from `/planning/tasks/last-plan.json`
- If last-plan.json doesn't exist, checks for Atlas projects in current directory
- Updates `/planning/tasks/last-plan.json` with the resolved plan name for future commands
- Plan name should match Atlas project ID format: `plan-[kebab-case-name]`

**The feedback should clearly describe**:

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

## Atlas Workflow Integration

After ideation:

1. **Review Atlas Changes**:

   - Check updated Atlas knowledge with `doc-type-plan-overview` tags
   - Verify Atlas project metadata modifications
   - Confirm Atlas task dependency adjustments

2. **Regenerate Atlas Tasks**:

   - Run `/plan-decompose --regenerate` if major changes to regenerate Atlas tasks
   - Use `atlas_task_update` for minor changes to existing tasks

3. **Update Atlas Tracking**:

   - If execution started, update task status in Atlas
   - Mark affected tasks for re-evaluation using Atlas task tags
   - Adjust completion percentages through Atlas task updates

4. **Continue Atlas Execution**:
   - Resume with `/plan-implement-task` for Atlas-integrated execution
   - Re-prioritize based on changes using Atlas task priority system

## Atlas Best Practices

1. **Atlas Timing Considerations**:

   - Ideate early before deep Atlas task execution
   - Batch related changes together for efficient Atlas updates
   - Consider Atlas task status and completed work

2. **Clear Atlas Communication**:

   - Be specific about desired changes to Atlas project/tasks
   - Explain reasoning for Atlas knowledge documentation
   - Mention any constraints for Atlas project metadata

3. **Atlas Iterative Refinement**:
   - Start with high-level Atlas project changes
   - Refine with subsequent ideation through Atlas knowledge
   - Validate after each round using Atlas task relationships

## Next Steps

After Atlas plan updates:

1. Review all modified Atlas knowledge and project data
2. Run `/plan-brainstorm-options` for strategic alternatives using Atlas insights
3. Decompose updated phases with `/plan-decompose` to regenerate Atlas tasks
4. Re-initialize Atlas task tracking if needed with `/plan-execution-init`
