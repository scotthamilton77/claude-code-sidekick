# Conductor PRD Addendum - UX Modes

## Mode-Based User Experience

### Core Concept

Conductor operates in distinct modes, each with unique visual design, interface layout, and AI interaction patterns to prevent context confusion and set appropriate expectations.

### Defined Modes

#### 🌱 Discovery Mode (Green)

- **Purpose**: "What should we build?"
- **Interface**: Conversational, open-ended
- **Activities**: Explore ideas, understand problems, identify user needs
- **AI Behavior**: Asks probing questions, builds understanding
- **Outputs**: Vision elements, problem statements, success criteria

#### 📍 Planning Mode (Indigo)

- **Purpose**: "What's our path forward?"
- **Interface**: Timeline/hierarchy visualization with aperture control
- **Activities**: Create roadmaps, plan releases, break down work
- **AI Behavior**: Suggests phases, identifies dependencies, estimates effort
- **Outputs**: Roadmaps, release plans, epics, stories, tasks

#### 🎨 Design Mode (Blue)

- **Purpose**: "How should it work?"
- **Interface**: Split view - chat + interactive mockups
- **Activities**: User flows, interface sketches, data models, architecture
- **AI Behavior**: Generates mockups, suggests patterns, validates flows
- **Outputs**: Design decisions, mockups, architecture diagrams

#### ⚡ Build Mode (Orange)

- **Purpose**: "Let's make it real"
- **Interface**: Task → Code → Result pipeline view
- **Activities**: Implementation, code generation, integration
- **AI Behavior**: Focused execution, shows progress, quick cycles
- **Outputs**: Working code, completed features

#### 🧪 Test Mode (Purple)

- **Purpose**: "Does it actually work?"
- **Interface**: Scenarios + live preview + results dashboard
- **Activities**: Validation, edge cases, performance testing
- **AI Behavior**: Generates test scenarios, identifies issues
- **Outputs**: Test results, bug reports, performance metrics

#### ✨ Polish Mode (Gold)

- **Purpose**: "Make it excellent"
- **Interface**: Improvement checklist with focused refinement areas
- **Activities**: UX refinement, performance optimization, error handling
- **AI Behavior**: Suggests improvements, implements refinements
- **Outputs**: Polished features, optimized code

### Mode Transitions

- Clear visual and contextual transitions between modes
- Conductor can suggest mode switches based on user needs
- Each mode maintains its own context and memory
- Smart handoffs preserve relevant information

### Visual Differentiation

- Color-coded headers and themes
- Mode-appropriate typography
- Layout changes per mode
- Ambient visual indicators

## Initial User Experience

### Entry Point

- Simple, welcoming interface: "What's on your mind?"
- Multiple input options: text, sketch upload, document, voice
- No forms or templates initially

### Adaptive Interface

- Conversational start that builds understanding
- Visual building of ideas alongside chat
- Progressive discovery through dialogue
- Clear commitment levels (explore → prototype → build)

### Key UX Principles

1. **No cognitive load**: Interface guides naturally
2. **Progressive disclosure**: Details emerge as needed
3. **Visual feedback**: See ideas take shape in real-time
4. **Multiple exit points**: Save, share, or continue later
5. **Context preservation**: Never lose work or ideas

## Transition to Execution

- Seamless move from planning to building
- "Magic moment" where ideas become running code
- Clear value proposition at each transition point
- Time estimates for deliverables

## Mode Memory & Context

- Each mode maintains its own context
- Smart context transfer between modes
- No manual context management required
- Historical decision preservation

### Anti-Patterns to Avoid

#### In Discovery

- ❌ Jumping to solutions too fast
- ❌ Making assumptions without validation
- ❌ Generic requirements gathering
- ❌ Losing the "why" behind the "what"

#### In Planning

- ❌ Over-planning distant futures
- ❌ False precision in estimates
- ❌ Skipping the "what success looks like" discussion
- ❌ Planning without discovery completion
