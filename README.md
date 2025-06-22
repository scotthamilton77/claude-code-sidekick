# Claude Code Planning & Execution System

A comprehensive command system for AI-assisted project planning, decomposition, and execution with automated code review cycles.

## TODOs

- check to see if we need to prefix IDs for tasks and knowledge
- currently still creating /planning/tasks and sticking last-plan.json there; do we need the tasks subfolder?
- what happens if I run the same command 2x for the same project, e.g. create, decompose, execution-init, prepare-next-task?
- do we still need execution-init?  Can it be combined with prepare-next-task?
- need better name for the workflows, e.g. create -> [ideate] -> decompose (from here on should warn if no architecture) -> next-task-prep -> next-task-start -> status

tested:
- plan-create, plan-decompose

- prep file is running into complex bash commands and screwing up folder names - see doc-index-mcp test-suite/scratch/**
  -- just added bunch of "echo" for debuggin
- rename to plan\* again?
- architect.md
  - asks another architect subagent for review and iterates up to 3x
  - can be asked for clarifications by the implementation agent, who can respond by updating existing or creating new artifacts
- do a qualitiative comparison to https://github.com/scopecraft/command/tree/main/.claude/commands and other similar projects on command formatting, command creation automation
- consider integration with MCP / other tools

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

Creates `/planning/tasks/[plan-name]/` with high-level structure and phases.

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

Generates detailed phase files with tasks, subtasks, and acceptance criteria.

### 5. Execution Tracking

```bash
/plan-execution-init "plan-name"
```

Creates `plan-tracker.json` to monitor progress across all phases and tasks.

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

Generates comprehensive status reports saved to `/planning/tasks/[plan-name]/status.md` with smart update detection.

## Command Categories

### Planning Commands

- **`/plan-create`** - Transform ideas into structured high-level plans
- **`/plan-brainstorm-options`** - Generate strategic alternatives with tradeoffs
- **`/plan-ideate`** - Incorporate feedback to refine existing plans
- **`/plan-decompose`** - Break down phases into detailed, executable tasks

### Execution Commands

- **`/plan-execution-init`** - Create tracking structure from plan files
- **`/plan-prepare-next-task`** - Prepare next pending task with architectural review and context creation
- **`/plan-implement-task`** - Execute prepared tasks with automated implementation and review

### Monitoring Commands

- **`/plan-status`** - Generate visual progress reports with smart update detection

### Other Available Commands

This document provides a high-level overview of additional available Claude commands for various development workflows.
