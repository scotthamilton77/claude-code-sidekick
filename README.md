# Claude Code Planning & Execution System

A comprehensive Atlas MCP-powered command system for AI-assisted project planning, decomposition, and execution with automated code review cycles.

## TODOs

- check to see if we need to prefix IDs for tasks and knowledge
- what happens if I run the same command 2x for the same project, e.g. create, decompose, execution-init, prepare-next-task?
- do we still need execution-init?  Can it be combined with prepare-next-task?
- need better name for the workflows, e.g. create -> [ideate] -> decompose (from here on should warn if no architecture) -> next-task-prep -> next-task-start -> status

tested:
- plan-create, plan-decompose, plan-status

future improvements:
- Multi-agent coordination with architect review cycles
- Qualitative comparison to other command frameworks
- Enhanced integration patterns documentation

## Quick Start

```bash
# Create a high-level plan from an idea
/plan-create "Build a customer portal with authentication and reporting"

# Explore strategic options
/plan-brainstorm-options "customer-portal"

# Decompose into detailed tasks
/plan-decompose "customer-portal"

# Initialize execution tracking
/plan-execution-init "customer-portal"

# Prepare next task with architectural review
/plan-prepare-next-task "customer-portal"

# Execute prepared task with automated review
/plan-implement-task "customer-portal"

# Monitor progress with status reports
/plan-status "customer-portal"
```

## Planning & Execution Workflow

### 1. Initial Planning

```bash
/plan-create "Your project description"
```

Creates Atlas project with categorized knowledge and metadata.

### 2. Strategic Options (Optional)

```bash
/plan-brainstorm-options "plan-name"
```

Presents 3-5 implementation strategies with clear tradeoffs and recommendations.

### 3. Refinement (As Needed)

```bash
/plan-ideate "plan-name: Add real-time notifications feature"
```

Updates plan based on new requirements or feedback.

### 4. Task Decomposition

```bash
/plan-decompose "plan-name"
```

Creates Atlas tasks with dependencies, tags, and proper hierarchy.

### 5. Execution Tracking

```bash
/plan-execution-init "plan-name"
```

Validates Atlas project structure and initializes tasks for execution.

### 6. Task Preparation

```bash
/plan-prepare-next-task "plan-name"
```

Prepares the next pending task with architectural review and context creation. Marks the task as "ready" for implementation.

### 7. Task Implementation

```bash
/plan-implement-task "plan-name"
```

Executes prepared tasks (marked as "ready") with automated implementation and code review cycles.

### 8. Progress Monitoring

```bash
/plan-status "plan-name"
```

Generates rich visual status reports saved to `/planning/status-report-[timestamp].md` with Atlas analytics.

## Command Categories

### Planning Commands

- **`/plan-create`** - Transform ideas into structured high-level plans
- **`/plan-brainstorm-options`** - Generate strategic alternatives with tradeoffs
- **`/plan-ideate`** - Incorporate feedback to refine existing plans
- **`/plan-decompose`** - Break down phases into detailed, executable tasks

### Execution Commands

- **`/plan-execution-init`** - Validate Atlas project and initialize execution tracking
- **`/plan-prepare-next-task`** - Prepare next pending task with architectural review and context creation
- **`/plan-implement-task`** - Execute prepared tasks with automated implementation and review

### Monitoring Commands

- **`/plan-status`** - Generate rich visual progress reports with Atlas analytics

### Migration Commands

- **`/plan-migrate-to-atlas`** - Migrate existing filesystem plans to Atlas MCP

## Architecture

This system uses **Atlas MCP (Model Context Protocol)** for robust project and task management:

- **Atlas Projects**: Primary organizational units with metadata and relationships
- **Atlas Tasks**: Flattened hierarchy with dependencies and categorization tags
- **Atlas Knowledge**: Searchable documentation with proper categorization
- **Neo4j Backend**: Provides transactional consistency and advanced querying

See `docs/plan/architecture-v2.md` for complete architectural details.

## Configuration

- **MCP Server**: Configured in `mcp.json` (Neo4j at bolt://localhost:7687)
- **Command Templates**: Located in `/commands/plan/` directory
- **Documentation**: Complete setup guide available in `CLAUDE.md`
