Create a high-level plan from user requirements: $ARGUMENTS

## Purpose

This command takes a user's idea, project description, or requirements and creates an initial high-level plan structure. It establishes the plan foundation with clear objectives, success criteria, and major phases that will later be decomposed into detailed tasks.

## Process

1. **Requirements Analysis**:
   - Parse user input for key objectives
   - Identify project scope and constraints
   - Extract success criteria and deliverables
   - Determine project type and complexity

2. **Plan Structure Creation**:
   - Generate plan name from project description
   - Create `/tasks/[plan-name]/` directory
   - Write initial PLAN.md with high-level structure
   - Create README.md with project overview

3. **Phase Definition**:
   - Break project into 3-7 major phases
   - Define phase objectives and dependencies
   - Establish logical progression
   - Include validation and deployment phases

## High-Level Plan Template

```markdown
# [Project Title]

## Overview

[Project description and business value]

## Objectives

1. [Primary objective]
2. [Secondary objectives]
3. [Additional goals]

## Success Criteria

- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
- [ ] [Completion criteria]

## Constraints & Assumptions

- **Timeline**: [Estimated duration]
- **Technology**: [Tech stack constraints]
- **Resources**: [Team/budget limitations]
- **Dependencies**: [External requirements]

## High-Level Phases

### Phase 1: [Foundation/Planning]
**Duration**: [Estimate]
**Objectives**: 
- [Key objectives for this phase]

**Key Deliverables**:
- [Major deliverable 1]
- [Major deliverable 2]

### Phase 2: [Core Development]
**Duration**: [Estimate]
**Objectives**:
- [Key objectives for this phase]

**Key Deliverables**:
- [Major deliverable 1]
- [Major deliverable 2]

### Phase 3: [Integration/Testing]
**Duration**: [Estimate]
**Objectives**:
- [Key objectives for this phase]

**Key Deliverables**:
- [Test results]
- [Integration documentation]

### Phase 4: [Deployment/Launch]
**Duration**: [Estimate]
**Objectives**:
- [Deployment goals]

**Key Deliverables**:
- [Deployed system]
- [Documentation]

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| [Risk 1] | High | Medium | [Strategy] |
| [Risk 2] | Medium | Low | [Strategy] |

## Next Steps

1. Review and approve high-level plan
2. Run `/plan-decompose [plan-name]` to create detailed phase breakdowns
3. Initialize execution tracking with `/plan-execution-init [plan-name]`
```

## Implementation Steps

1. **Parse User Input**:
   - Extract project description
   - Identify key requirements
   - Determine project category (web app, API, data pipeline, etc.)

2. **Generate Plan Structure**:
   - Create unique plan identifier
   - Establish directory structure
   - Generate initial documentation

3. **Phase Generation**:
   - Apply appropriate phase template based on project type
   - Ensure logical flow and dependencies
   - Include standard phases (planning, implementation, testing, deployment)

4. **Output Creation**:
   - Write PLAN.md with high-level structure
   - Create README.md with quick reference
   - Generate initial directory structure

## Usage Examples

```bash
# Create plan from description
/plan-create "Build a customer portal with authentication, dashboard, and reporting features"

# Create plan with specific name
/plan-create "E-commerce platform --name shop-v2"

# Create plan with constraints
/plan-create "API migration project --timeline 3-months --team 2-developers"
```

## Arguments

Project description/requirements: $ARGUMENTS

The description should include:
- What you're building
- Key features/requirements
- Any specific constraints or preferences

## Output

Creates the following structure:
```
/tasks/[plan-name]/
├── README.md          # Quick project overview
├── PLAN.md           # Detailed high-level plan
└── .plan-metadata    # Plan creation metadata
```

Returns:
- Plan name and location
- Summary of phases created
- Next recommended command
- Any assumptions made

## Project Type Templates

The command automatically selects appropriate phase templates based on project type:

- **Web Application**: Planning → Frontend → Backend → Integration → Testing → Deployment
- **API Service**: Design → Core API → Data Layer → Testing → Documentation → Deployment  
- **Data Pipeline**: Requirements → Data Sources → Processing → Storage → Monitoring → Deployment
- **Mobile App**: Design → Core Features → Platform Integration → Testing → Release
- **Migration Project**: Analysis → Preparation → Migration → Validation → Cutover

## Next Steps

After creating the high-level plan:

1. Review and adjust PLAN.md if needed
2. Run `/plan-decompose [plan-name]` to break down phases into tasks
3. Use `/plan-execution-init [plan-name]` to begin tracking
4. Execute with `/plan-execute-continue [plan-name]`