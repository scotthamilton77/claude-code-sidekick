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

Commands for analyzing codebases and creating comprehensive development plans. These commands understand project structure, identify improvement opportunities, and create integrated task hierarchies for execution. Includes specialized planning for multi-agent coordination and intelligent next-step analysis.

<!-- WORKFLOW NOTES: Planning is the entry point for most major workflows. Key workflow patterns:
1. Single-agent planning: plan -> task creation -> hierarchical task breakdown -> execution
2. Multi-agent planning: plan-multi-agent -> agent assignments -> worktree setup -> parallel execution
3. Next-steps analysis: project state assessment -> priority analysis -> task recommendations -> creation
4. Integration with all other categories: creates foundation for task management, agent coordination, and workflow automation -->

**Commands**: plan, plan-multi-agent, next-steps

**Related commands from other categories**: task-create, task-list, task-update (created by planning), agent-assign/agent-init/agent-status (for multi-agent execution), start (for execution), parallel-enhanced (for coordination setup)

**Key workflows enabled**:
- Automated codebase analysis and improvement identification
- Single-agent and multi-agent project planning with task breakdown
- Intelligent next-step recommendations based on project state
- Multi-agent coordination with automatic agent assignments and worktree management
- Integration between strategic planning and tactical execution

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

## Workflow Automation & Development

Commands that automate common development workflows by intelligently selecting and executing tasks based on priorities, dependencies, and current project state. Includes specialized support for multi-agent coordination, parallel development, and test-driven development.

<!-- WORKFLOW NOTES: These commands consume the outputs of other categories to automate decision-making and execution:
1. Task prioritization and selection from the task management system
2. Multi-agent work-stealing and parallel coordination through parallel-enhanced
3. Test-driven development automation with language-specific setups
4. Integration with agent framework for automated work distribution
5. Bridges the gap between strategic planning and tactical execution -->

**Commands**: start, parallel-enhanced, tdd

**Related commands from other categories**: task-list, task-update (for finding and updating work), agent-init, agent-start, agent-assign (for agent-specific workflows), plan, plan-multi-agent (for understanding project context), next-steps (for task selection)

**Key workflows enabled**:
- Automated task selection and prioritization
- Multi-agent work-stealing with dynamic task claiming
- Parallel development coordination with worktree automation
- Test-driven development workflows with language-specific tooling
- Intelligent workflow progression based on dependencies
- Integration between planning, task management, and execution

<!-- ANALYSIS NOTES:
The framework is complete with:

Total commands: 18
- Agent Framework: 5 commands (agent-assign, agent-complete, agent-init, agent-start, agent-status)
- Project Analysis & Planning: 3 commands (plan, plan-multi-agent, next-steps)  
- Task Management System: 7 commands (task-create, task-list, task-update, task-show, task-search, task-archive, task-log)
- Workflow Automation & Development: 3 commands (start, parallel-enhanced, tdd)

Framework characteristics:
1. Highly integrated system where categories depend on each other
2. Hierarchical task system is the central organizing principle
3. Multi-agent support is a first-class concern throughout
4. Strong integration with git workflows (worktrees, branches, PRs)
5. TodoWrite integration provides session-level task tracking
6. Emphasis on automation and intelligent workflow progression

Key workflow patterns across categories:
1. Single-agent workflow: plan/next-steps -> task creation -> start -> progress tracking -> completion
2. Multi-agent workflow: plan-multi-agent -> agent assignments -> parallel-enhanced setup -> agent coordination -> integration
3. Work-stealing workflow: plan-multi-agent -> parallel-enhanced -> dynamic task claiming -> autonomous completion
4. TDD workflow: tdd setup -> test creation -> implementation -> refactoring -> integration
5. Maintenance: Archive completed work, maintain clean active workspace

Major workflow integrations:
- Planning commands create the foundation for task management
- Task management provides the coordination layer for agent framework
- Agent framework enables parallel execution of planned work
- Workflow automation commands bridge between planning and execution
- All categories integrate through the hierarchical task system and TodoWrite
-->
