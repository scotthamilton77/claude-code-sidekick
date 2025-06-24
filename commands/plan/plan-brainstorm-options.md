Analyze plan objectives and present strategic options with tradeoffs: $ARGUMENTS

## Purpose

This command analyzes the current Atlas project's objectives and generates multiple strategic implementation options. Each option includes clear tradeoffs, risks, benefits, and a recommendation. The user can select an option to automatically update the Atlas project and knowledge accordingly.

## Process

1. **Atlas Project Resolution**:

   - If plan name provided in $ARGUMENTS, use it and update `${project_root}/last-plan.json`
   - If no plan name provided, read from `${project_root}/last-plan.json` for the last referenced plan
   - If neither exists, check for Atlas projects in current directory
   - Update `${project_root}/last-plan.json` with resolved plan name
   - Validate Atlas project exists using `atlas_project_list`

2. **Atlas Knowledge Analysis**:

   - Use `atlas_knowledge_list` to retrieve plan documentation with `doc-type-plan-overview` tags
   - Parse project objectives and success criteria from Atlas knowledge
   - Identify key constraints (time, resources, technology) from project metadata
   - Analyze current approach strengths/weaknesses from existing knowledge
   - Determine flexibility points using cross-project Atlas insights

3. **Strategic Option Generation**:

   - Use `atlas_unified_search` to find similar projects for option inspiration
   - Create 3-5 distinct strategic options based on organizational patterns
   - Ensure each option achieves core objectives from Atlas project data
   - Vary approaches across dimensions (speed, quality, cost, risk)
   - Include innovative alternatives based on Atlas cross-project analysis

4. **Tradeoff Analysis with Atlas Intelligence**:

   - Quantify impacts using similar project data from Atlas
   - Compare timeline, resource, and quality implications
   - Assess technical and business risks using Atlas knowledge patterns
   - Calculate opportunity costs based on organizational learning

5. **Presentation & Atlas Integration**:
   - Present options in clear, structured format
   - Provide data-driven recommendation using Atlas analytics
   - Allow user selection
   - Update Atlas project and knowledge based on choice

## Strategic Option Template

```markdown
# Strategic Options Analysis for [Plan Name]

## Current Objectives Recap

1. [Primary objective]
2. [Secondary objectives]
3. [Success criteria]

## Constraints

- Timeline: [Current estimate]
- Resources: [Team size/budget]
- Technology: [Requirements]
- Quality: [Standards]

## Option 1: [Descriptive Name] - "Fast Track"

### Approach

[Clear description of the strategy, typically 3-4 sentences explaining the core approach]

### Implementation Highlights

- [Key implementation choice 1]
- [Key implementation choice 2]
- [Key implementation choice 3]

### Timeline & Resources

- **Duration**: [X weeks/months] (Y% faster than baseline)
- **Team Needs**: [Specific roles and count]
- **Budget Impact**: [Relative cost]

### Tradeoffs

✅ **Pros**:

- Fastest time to market
- [Specific advantage]
- [Specific advantage]

❌ **Cons**:

- [Specific disadvantage]
- [Specific disadvantage]
- Technical debt: [High/Medium/Low]

### Risk Assessment

| Risk     | Likelihood | Impact | Mitigation |
| -------- | ---------- | ------ | ---------- |
| [Risk 1] | High       | Medium | [Strategy] |
| [Risk 2] | Low        | High   | [Strategy] |

### Best For

Teams that need to launch quickly and can address technical debt later.

---

## Option 2: [Descriptive Name] - "Quality First"

### Approach

[Clear description focusing on robustness and maintainability]

### Implementation Highlights

- Comprehensive testing at each phase
- [Key implementation choice]
- [Key implementation choice]

### Timeline & Resources

- **Duration**: [X weeks/months] (Y% slower than baseline)
- **Team Needs**: [Specific roles including QA]
- **Budget Impact**: [Higher initial, lower maintenance]

### Tradeoffs

✅ **Pros**:

- Highest quality deliverable
- Minimal technical debt
- [Specific advantage]

❌ **Cons**:

- Longer time to market
- Higher upfront cost
- [Specific disadvantage]

### Risk Assessment

[Similar table structure]

### Best For

Teams building mission-critical systems or with strict compliance requirements.

---

## Option 3: [Descriptive Name] - "Balanced Progressive"

### Approach

[Description of phased/iterative approach]

### Implementation Highlights

- MVP first, then iterate
- [Key implementation choice]
- [Key implementation choice]

### Timeline & Resources

- **Duration**: [Phased timeline]
- **Team Needs**: [Flexible scaling]
- **Budget Impact**: [Distributed over time]

### Tradeoffs

✅ **Pros**:

- Early user feedback
- Flexible pivoting
- Risk distribution

❌ **Cons**:

- Requires strong iteration discipline
- [Specific disadvantage]

### Risk Assessment

[Similar table structure]

### Best For

Teams wanting to validate assumptions early while maintaining flexibility.

---

## Option 4: [Descriptive Name] - "Innovation Play"

### Approach

[Description of cutting-edge or unconventional approach]

### Implementation Highlights

- [Innovative technology/method]
- [Key differentiator]
- [Unique aspect]

### Timeline & Resources

- **Duration**: [Variable with learning curve]
- **Team Needs**: [Specialized skills]
- **Budget Impact**: [Investment in innovation]

### Tradeoffs

✅ **Pros**:

- Competitive advantage
- Future-proof architecture
- [Specific advantage]

❌ **Cons**:

- Higher uncertainty
- Steeper learning curve
- [Specific disadvantage]

### Risk Assessment

[Similar table structure]

### Best For

Teams with innovation mandates or in competitive markets requiring differentiation.

---

## Comparative Analysis

| Aspect         | Option 1   | Option 2   | Option 3   | Option 4   |
| -------------- | ---------- | ---------- | ---------- | ---------- |
| Time to Market | ⭐⭐⭐⭐⭐ | ⭐⭐       | ⭐⭐⭐⭐   | ⭐⭐⭐     |
| Quality        | ⭐⭐⭐     | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐   | ⭐⭐⭐⭐   |
| Cost           | ⭐⭐⭐⭐   | ⭐⭐       | ⭐⭐⭐     | ⭐⭐       |
| Risk           | ⭐⭐       | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐   | ⭐⭐       |
| Innovation     | ⭐⭐       | ⭐⭐⭐     | ⭐⭐⭐     | ⭐⭐⭐⭐⭐ |
| Flexibility    | ⭐⭐       | ⭐⭐⭐     | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     |

## 🎯 Recommendation

Based on your objectives and constraints, **Option 3: Balanced Progressive** is recommended because:

1. [Specific reason related to objectives]
2. [Risk mitigation benefit]
3. [Resource optimization aspect]
4. [Strategic advantage]

This approach provides the best balance of [key factors] while maintaining flexibility to [adaptive benefit].

## Selection Prompt

Choose an option to update your plan:

- Type `1`, `2`, `3`, or `4` to select an option
- Type `none` to keep the current plan unchanged
- Type `custom` to describe a hybrid approach

Your selection: \_
```

## Option Generation Strategies

### 1. Time-Optimization Variants

- Parallel development tracks
- Reduced scope/MVP approach
- Pre-built components usage
- Aggressive timeline with overtime

### 2. Quality-Optimization Variants

- Comprehensive testing phases
- Formal verification methods
- Redundancy and failover systems
- Extensive documentation

### 3. Cost-Optimization Variants

- Open source maximization
- Offshore/distributed teams
- Phased funding approach
- Resource sharing strategies

### 4. Risk-Optimization Variants

- Conservative technology choices
- Extensive prototyping
- Parallel solution paths
- Incremental migration

### 5. Innovation-Optimization Variants

- Cutting-edge technology adoption
- Novel architectural patterns
- AI/ML integration opportunities
- Competitive differentiation focus

## Implementation After Selection

When user selects an option:

1. **Atlas Project Updates**:

   ```bash
   Updating Atlas project with Option [N]: [Name]

   Changes to be applied:
   - Restructuring phases to support [approach]
   - Adjusting timeline to [new estimate]
   - Modifying technical approach for [changes]
   - Updating resource requirements
   ```

2. **Atlas Knowledge Updates**:

   - Use `atlas_knowledge_add` to store updated strategy with `doc-type-plan-overview` tags
   - Use `atlas_project_update` to modify project metadata
   - Store decision rationale with `doc-type-implementation-notes` tags
   - Create strategy-decision knowledge with proper categorization

3. **Atlas Task Adjustments**:
   - Use `atlas_task_delete` and `atlas_task_create` to regenerate task structure
   - Update task dependencies using Atlas task relationships
   - Adjust task acceptance criteria through Atlas task updates
   - Modify risk assessments in Atlas knowledge

## Usage Examples

```bash
# Generate options for last referenced Atlas project (reads from ${project_root}/last-plan.json)
/plan-brainstorm-options

# Generate options for specific Atlas project (updates ${project_root}/last-plan.json)
/plan-brainstorm-options "plan-web-app-redesign"

# Generate options with specific focus
/plan-brainstorm-options "plan-api-project --focus performance"

# Generate options with constraints using last plan
/plan-brainstorm-options "--max-duration 3-months"

# Generate more creative options
/plan-brainstorm-options "plan-data-pipeline --innovation high"

# Example workflow showing Atlas integration:
/plan-create "API redesign"           # Creates Atlas project and updates last-plan.json
/plan-brainstorm-options              # Uses Atlas project from last-plan.json
/plan-ideate "Selected option 2"      # Updates Atlas knowledge
/plan-decompose                       # Regenerates Atlas tasks
```

## Arguments

**Plan Name**: $ARGUMENTS (optional)

- If no plan name provided, uses the last referenced plan from `${project_root}/last-plan.json`
- If last-plan.json doesn't exist, checks for Atlas projects in current directory
- Updates `${project_root}/last-plan.json` with the resolved plan name for future commands
- Plan name should match Atlas project ID format: `plan-[kebab-case-name]`

**Optional flags**:

- `--focus [speed|quality|cost|innovation]`: Emphasize specific dimension
- `--max-duration [timeframe]`: Set time constraint
- `--team-size [number]`: Set resource constraint
- `--innovation [low|medium|high]`: Set innovation appetite

## Output Flow

1. **Initial Analysis**:

   - Display current objectives and constraints
   - Show baseline plan metrics
   - Identify optimization opportunities

2. **Options Presentation**:

   - Present 3-5 strategic options
   - Include visual comparison table
   - Provide clear recommendation

3. **Selection Interface**:

   - Prompt for user choice
   - Confirm selection
   - Show changes preview

4. **Plan Update**:
   - Apply selected strategy
   - Update all affected files
   - Provide summary of changes

## Decision Factors Framework

Each option is evaluated across:

1. **Business Factors**:

   - Time to market
   - Competitive advantage
   - Market positioning
   - Revenue potential

2. **Technical Factors**:

   - Architecture quality
   - Scalability potential
   - Maintenance burden
   - Technical debt

3. **Team Factors**:

   - Skill requirements
   - Team satisfaction
   - Growth opportunities
   - Workload distribution

4. **Risk Factors**:
   - Technical risks
   - Market risks
   - Execution risks
   - Dependency risks

## Atlas Integration Implementation

### **Step 1: Atlas Project and Knowledge Retrieval**

```javascript
// Read coordination file for Atlas project context
const lastPlan = await readLastPlanReference()
if (!lastPlan?.atlas_project_id) {
  throw new Error("No Atlas project found. Run /plan-create first.")
}

// Retrieve Atlas project details
const project = await atlas_project_list({ 
  mode: "details", 
  id: lastPlan.atlas_project_id,
  includeKnowledge: true,
  includeTasks: true 
})

// Get plan overview knowledge
const planKnowledge = await atlas_knowledge_list({
  projectId: lastPlan.atlas_project_id,
  tags: ["doc-type-plan-overview"],
  limit: 50
})

// Search for similar projects for option inspiration
const similarProjects = await atlas_unified_search({
  value: project.taskType,
  entityTypes: ["project"],
  limit: 10
})
```

### **Step 2: Strategic Analysis with Atlas Intelligence**

```javascript
// Analyze project objectives and constraints
const objectives = extractObjectives(planKnowledge)
const constraints = analyzeConstraints(project)
const currentApproach = analyzeCurrentApproach(planKnowledge)
const organizationalPatterns = extractPatterns(similarProjects)

// Generate strategic options using Atlas insights
const strategicOptions = generateOptionsWithAtlasIntelligence({
  objectives,
  constraints,
  currentApproach,
  organizationalPatterns,
  similarProjects
})
```

### **Step 3: Present Options and Capture Selection**

```javascript
// Present options to user with Atlas-powered recommendations
const selectedOption = await presentOptionsAndGetSelection(strategicOptions)

if (selectedOption && selectedOption !== 'none') {
  // Update Atlas project with selected strategy
  await updateAtlasProjectWithStrategy(lastPlan.atlas_project_id, selectedOption)
  
  // Store decision rationale in Atlas knowledge
  await storeDecisionRationale(lastPlan.atlas_project_id, selectedOption, strategicOptions)
}
```

## Best Practices

1. **Atlas-Integrated Planning**:

   - Use after `/plan-create` for strategic direction with Atlas context
   - Re-run when requirements change significantly
   - Leverage Atlas cross-project insights for better options

2. **Combine with Atlas Tools**:

   - Use `/plan-ideate` for specific changes
   - Use `/plan-brainstorm-options` for strategic pivots
   - Use `atlas_unified_search` for continuous learning

3. **Document in Atlas**:
   - Store strategy decisions as Atlas knowledge
   - Tag with `doc-type-implementation-notes` and `lifecycle-planning`
   - Track assumption changes through Atlas knowledge updates

## Next Steps

After option selection:

1. Review updated Atlas project and knowledge
2. Run `/plan-decompose --regenerate` for new Atlas task structure
3. Initialize execution with `/plan-execution-init`
4. Begin implementation with `/plan-implement-task`
