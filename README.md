# Claude Code Planning & Execution System

A comprehensive command system for AI-assisted project planning, decomposition, and execution with automated code review cycles.

## TODOs

- architect.md
  - asks another architect subagent for review and iterates up to 3x
  - can be asked for clarifications by the implementation agent, who can respond by updating existing or creating new artifacts

## Quick Start

```bash
# Create a high-level plan from an idea
/create "Build a customer portal with authentication and reporting"

# Explore strategic options
/brainstorm-options "customer-portal"

# Decompose into detailed tasks
/decompose "customer-portal"

# Initialize execution tracking
/execution-init "customer-portal"

# Prepare next task with architectural review
/prepare-next-task "customer-portal"

# Execute prepared task with automated review
/implement-task "customer-portal"

# Monitor progress with status reports
/status "customer-portal"
```

## Planning & Execution Workflow

### 1. Initial Planning

```bash
/create "Your project description"
```

Creates `/planning/tasks/[plan-name]/` with high-level structure and phases.

### 2. Strategic Options (Optional)

```bash
/brainstorm-options "plan-name"
```

Presents 3-5 implementation strategies with clear tradeoffs and recommendations.

### 3. Refinement (As Needed)

```bash
/ideate "plan-name: Add real-time notifications feature"
```

Updates plan based on new requirements or feedback.

### 4. Task Decomposition

```bash
/decompose "plan-name"
```

Generates detailed phase files with tasks, subtasks, and acceptance criteria.

### 5. Execution Tracking

```bash
/execution-init "plan-name"
```

Creates `plan-tracker.json` to monitor progress across all phases and tasks.

### 6. Task Preparation

```bash
/prepare-next-task "plan-name"
```

Prepares the next pending task with architectural review and context creation. Marks the task as "ready" for implementation.

### 7. Task Implementation

```bash
/implement-task "plan-name"
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
- **`/prepare-next-task`** - Prepare next pending task with architectural review and context creation
- **`/implement-task`** - Execute prepared tasks with automated implementation and review

### Monitoring Commands

- **`/plan-status`** - Generate visual progress reports with smart update detection

### Other Available Commands

This document provides a high-level overview of additional available Claude commands for various development workflows.
