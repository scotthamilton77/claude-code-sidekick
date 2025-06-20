# Claude Commands Reference

This document provides a high-level overview of the available Claude commands, grouped by functional category. These commands are designed to assist with various stages of the software development lifecycle, from planning and research to coding and deployment.

## Agent Framework

This group of commands facilitates multi-agent workflows. They provide the foundation for coordinating multiple AI agents to work on a project collaboratively, managing task assignments, agent initialization, and status tracking to enable complex, parallelized development.

<!-- WORKFLOW NOTES: The agent framework creates a complete coordination system where agents can work independently on different parts of a project using git worktrees. Key workflow patterns:
1. Assignment workflow: plan -> task creation -> agent assignment -> parallel execution -> coordination/joining
2. Agent lifecycle: init -> start -> work on tasks -> status tracking -> completion with PR creation
3. Multi-agent coordination: workload balancing, dependency management, join points, progress monitoring
4. Integration points: Connects deeply with Task Management for work assignment, uses TodoWrite for session tracking, integrates with git workflows for parallel development -->

**Commands**: agent-assign, agent-complete, agent-init, agent-start, agent-status

**Related commands from other categories**: task-create, task-update, task-list (for work assignment), plan (for initial task creation), start (for individual agent workflows)

**Key workflows enabled**:
- Multi-agent project execution with isolated worktrees
- Automated workload distribution and dependency management  
- Progress tracking and coordination across parallel work streams
- Clean completion with PR creation and workspace cleanup

## Project Analysis & Planning

Commands for analyzing codebases and creating comprehensive development plans. These commands understand project structure, identify improvement opportunities, and create integrated task hierarchies for execution.

<!-- WORKFLOW NOTES: Planning is the entry point for most major workflows. The 'plan' command creates a bridge between high-level analysis and detailed task execution:
1. Codebase analysis -> plan creation -> hierarchical task breakdown -> multi-agent assignment
2. Integrates directly with Task Management by creating initial plans/tasks/subtasks
3. Supports both single-agent and multi-agent workflows
4. Creates foundation for all subsequent work coordination -->

**Commands**: plan

**Related commands from other categories**: task-create, task-list, task-update (created by planning), agent-assign (for multi-agent execution), start (for execution)

**Key workflows enabled**:
- Automated codebase analysis and improvement identification
- Hierarchical project planning with task breakdown
- Integration between strategic planning and tactical execution
- Foundation for multi-agent coordination

## Task Management System

A comprehensive three-tier hierarchical task management system (Plans → Tasks → Subtasks) with persistent storage, progress tracking, and integration with TodoWrite. This is the core organizational system that other command categories build upon.

<!-- WORKFLOW NOTES: This is the foundational system that most other categories depend on. Key workflow patterns:
1. Hierarchical creation: plan -> tasks -> subtasks with automatic organization
2. Status propagation: subtask completion -> task progress -> plan progress -> TodoWrite sync
3. Multi-agent support: tasks can be assigned to different agents for parallel work
4. Lifecycle management: create -> update -> track -> archive with full audit trail
5. Search and discovery: find work across the entire hierarchy
6. Integration hub: connects planning, agent coordination, and workflow automation -->

**Commands**: task-create, task-list, task-update, task-show, task-search, task-archive, task-log

**Related commands from other categories**: plan (creates initial task structure), agent-assign/agent-init/agent-status (work with task assignments), start (consumes task priorities)

**Key workflows enabled**:
- Hierarchical project organization with automatic progress aggregation
- Multi-agent task distribution and tracking
- Historical progress tracking with audit trails
- Search and discovery across project hierarchies
- Integration with session todos for active work management

## Workflow Automation

Commands that automate common development workflows by intelligently selecting and executing tasks based on priorities, dependencies, and current project state.

<!-- WORKFLOW NOTES: These commands consume the outputs of other categories to automate decision-making and execution:
1. Task prioritization and selection from the task management system
2. Integration with agent framework for automated work distribution
3. Connects to planning outputs for understanding project context
4. Bridges the gap between strategic planning and tactical execution -->

**Commands**: start

**Related commands from other categories**: task-list, task-update (for finding and updating work), agent-init, agent-start (for agent-specific workflows), plan (for understanding project context)

**Key workflows enabled**:
- Automated task selection and prioritization
- Intelligent workflow progression based on dependencies
- Integration between planning, task management, and execution
- Context-aware development automation

<!-- ANALYSIS NOTES:
Commands referenced in files but not present as command files:
- /tdd (referenced in agent-start.md) - appears to be a test-driven development workflow command
- /task-to-todo (referenced in agent-init.md) - converter between task system and TodoWrite
- /plan-multi-agent (referenced in agent-assign.md) - multi-agent planning command  
- /parallel-enhanced (referenced in agent-assign.md) - enhanced parallel execution
- /project:next-steps (referenced in start.md) - project analysis for next steps

Files that should be moved out of commands/ folder:
- task.md - This is a comprehensive reference document for the task management system, not an executable command. Should be moved to root level as TASK-SYSTEM.md or similar.

Framework characteristics:
1. Highly integrated system where categories depend on each other
2. Hierarchical task system is the central organizing principle
3. Multi-agent support is a first-class concern throughout
4. Strong integration with git workflows (worktrees, branches, PRs)
5. TodoWrite integration provides session-level task tracking
6. Emphasis on automation and intelligent workflow progression

Key workflow patterns across categories:
1. Plan -> Create Tasks -> Assign to Agents -> Execute -> Track Progress -> Complete
2. Analysis -> Planning -> Task Creation -> Multi-agent Distribution -> Coordination -> Integration
3. Single task focus: Task Selection -> Start Work -> Progress Tracking -> Completion
4. Maintenance: Archive completed work, maintain clean active workspace
-->
