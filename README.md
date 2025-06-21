# Claude Code Planning & Execution System

A comprehensive command system for AI-assisted project planning, decomposition, and execution with automated code review cycles.

## TODOs

- architect.md
    - asks another architect subagent for review and iterates up to 3x
  - can be asked for clarifications by the implementation agent, who can respond by updating existing or creating new artifacts

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

# Execute tasks with automated review
/plan-execute-continue "customer-portal"

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

### 6. Automated Execution

```bash
/plan-execute-continue "plan-name"
```

Executes pending tasks with automated implementation and code review cycles.

### 7. Progress Monitoring

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
- **`/plan-execute-continue`** - Execute tasks with automated implementation and review

### Monitoring Commands

- **`/plan-status`** - Generate visual progress reports with smart update detection

### Other Available Commands

This document provides a high-level overview of additional available Claude commands for various development workflows.
