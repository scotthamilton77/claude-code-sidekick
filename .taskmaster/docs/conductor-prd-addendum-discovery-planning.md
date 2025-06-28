# Conductor PRD Addendum Refined Discovery & Planning

## Initialization & Discovery Refinements

### Project Initialization

#### Zero-Friction Start

- **No project scaffolding required** - Conductor creates structure as needed
- **Single command entry**: `/conductor "describe your idea"`
- **Workspace detection**: Automatically detects existing code vs greenfield
- **Context inference**: Examines workspace for clues about project type

#### Discovery Conversation Flow

**Progressive Understanding Building**

1. **Problem First**: Start with the problem, not the solution

   - "Tell me about a recent time this was frustrating"
   - "Who else experiences this problem?"
   - "What happens if this doesn't get solved?"

2. **Concrete Examples**: Ground abstract ideas in specifics

   - "Walk me through your last grocery trip"
   - "Show me what you currently use"
   - "What broke down last time?"

3. **Success Vision**: Define what "better" looks like
   - "How would you know this is working?"
   - "What would change for your users?"
   - "What metrics matter?"

#### Discovery Artifacts

**Living Project Document** (`.conductor/project.md`)

```markdown
---
id: grocery-genie
stage: discovery
confidence: exploring|validating|committed
last_updated: 2024-01-15T10:30:00Z
---

# Project Vision

## Problem Space

- **Core Problem**: [Emerges from conversation]
- **Affected Users**: [Specific personas identified]
- **Current Pain**: [Quantified where possible]

## Success Looks Like

- [Concrete, measurable outcomes]
- [User behavior changes]
- [Business metrics]

## Constraints Discovered

- **Must Have**: [Non-negotiables]
- **Nice to Have**: [Acknowledged but deferred]
- **Won't Do**: [Explicit exclusions]

## Key Insights

- [Aha moments from discovery]
- [Assumptions to validate]
- [Risks identified]
```

### Discovery Mode Behaviors

#### Conductor's Discovery Personality

- **Curious, not prescriptive**: Asks "why" and "tell me more"
- **Concrete over abstract**: Always grounds in examples
- **Patient**: Doesn't rush to solutions
- **Memory**: References earlier points to build understanding

#### Visual Discovery Building

- As conversation progresses, build visual summary alongside
- Not a requirements document - a shared understanding artifact
- User can see their thoughts organized in real-time
- Editable and collaborative

#### Discovery Exit Criteria

Clear transition points when:

1. **Problem is well-understood** (can articulate to others)
2. **Success is defined** (measurable outcomes identified)
3. **Scope has boundaries** (explicit what's in/out)
4. **Commitment level is clear** (exploring vs building)

## Planning Mode Refinements

### Planning Philosophy

#### Just-In-Time Detail

- **Don't plan what you won't build soon** - Details become stale
- **Rolling wave planning** - Detail increases as work approaches
- **Aperture matches commitment** - Exploring = broad, Building = specific

#### Planning Artifacts

**Adaptive Plan Document** (`.conductor/plan.md`)

```markdown
---
planning_level: roadmap|release|sprint|epic|story|task
current_focus: "MVP Week 1"
last_updated: 2024-01-15T14:00:00Z
confidence: high|medium|low
---

# Active Plan: [Level-appropriate title]

## Outcome

[What success looks like at this level]

## Timeline

[Appropriate granularity: quarters/weeks/days/hours]

## Scope

### In

- [Committed deliverables]

### Out (Decided)

- [Explicitly excluded with rationale]

### Later (Deferred)

- [Good ideas for future]

## Dependencies

- [What must happen first]
- [External dependencies]

## Risks & Mitigations

- [What could go wrong]
- [How we'll handle it]

## Progress

- [Visual representation appropriate to level]
- [Key metrics/milestones]
```

### Planning Mode Aperture Control

#### Planning Hierarchy (Industry-Standard Terminology)

##### 🗺️ Product Roadmap

- **Timeframe**: Quarters/Months
- **Outcome**: Strategic direction and major milestones
- **Artifacts**: Vision, themes, success metrics
- **Decisions**: Build vs buy, technical investments

##### 🎯 Release Planning

- **Timeframe**: 2-6 weeks
- **Outcome**: Shippable increments with clear value
- **Artifacts**: Release goals, feature sets, acceptance criteria
- **Decisions**: MVP scope, feature prioritization

##### 📦 Sprint/Iteration

- **Timeframe**: 1-2 weeks
- **Outcome**: Tested, integrated features
- **Artifacts**: Sprint goals, committed stories
- **Decisions**: Capacity planning, dependencies

##### 📋 Epic

- **Timeframe**: 2-4 sprints
- **Outcome**: Major feature or capability
- **Artifacts**: Epic brief, architectural decisions
- **Decisions**: Technical approach, UX patterns

##### 📝 User Story

- **Timeframe**: 1-3 days
- **Outcome**: Specific user value delivered
- **Artifacts**: Story card, acceptance criteria, tasks
- **Decisions**: Implementation approach, done definition

##### ✅ Task

- **Timeframe**: Hours to 1 day
- **Outcome**: Specific technical work completed
- **Artifacts**: Task description, implementation notes
- **Decisions**: Technical details, patterns

#### Aperture Interface

- Visual zoom control slider
- Bidirectional navigation (zoom in/out)
- Context-appropriate detail at each level
- Progressive disclosure of information

### Aperture-Specific Planning Behaviors

#### Roadmap Level (Quarters/Months)

- **Questions**: "What market opportunity?", "What's the vision?"
- **Outputs**: Themes, strategic bets, success metrics
- **Precision**: Directionally correct, not precisely wrong
- **Revision Frequency**: Monthly

#### Release Level (2-6 weeks)

- **Questions**: "What ships together?", "What's the user value?"
- **Outputs**: Feature sets, acceptance criteria, launch plan
- **Precision**: Specific features, flexible implementation
- **Revision Frequency**: Weekly

#### Sprint Level (1-2 weeks)

- **Questions**: "What can we complete?", "Who does what?"
- **Outputs**: Committed stories, task assignments, impediments
- **Precision**: Detailed enough to start work
- **Revision Frequency**: Daily

#### Epic/Story/Task Levels

- **Generated on-demand** when diving into specific work
- **Detail emerges** through design/build modes
- **Stored in context** for the appropriate mode

### Planning Transitions

#### From Discovery to Planning

```
Conductor: "I think I understand the problem space well. Ready to map out a path to solving it?"

[Show discovered constraints and success criteria]
[Suggest initial timeline scope]
[Let user choose planning level to start]
```

#### Planning Level Navigation

- **Zoom metaphor**: Smooth transitions between levels
- **Breadcrumbs**: Always know where you are
- **Quick jumps**: Can move between levels without losing context

#### From Planning to Design/Build

```
Conductor: "We have a solid [sprint/story] plan. Want to:
- Design how this should work (Design mode)
- Start building the first piece (Build mode)
- Refine the plan more (Stay in Planning)
"
```
