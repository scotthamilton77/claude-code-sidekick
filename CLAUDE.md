# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Claude Code Planning & Execution System - a comprehensive command framework for AI-assisted project planning, decomposition, and execution with Atlas MCP integration. The system facilitates structured project management with automated code review cycles and sophisticated multi-agent coordination.

## Atlas MCP Integration

The system uses Atlas MCP (Model Context Protocol) for all project and task management:
- **Atlas Project**: Primary organizational unit with metadata and relationships
- **Atlas Tasks**: Flattened task hierarchy with dependencies and tagging
- **Atlas Knowledge**: Categorized documentation storage and retrieval
- **Configuration**: See `mcp.json` for Atlas server settings (Neo4j backend at bolt://localhost:7687)

## Core Commands and Workflows

### Planning Phase Commands
```bash
# Create new project from idea
/plan-create "Build a customer portal with authentication"

# Break down into phases and tasks  
/plan-decompose "plan-customer-portal"

# Explore strategic options (optional)
/plan-brainstorm-options "plan-customer-portal"
```

### Execution Phase Commands
```bash
# Initialize project for execution
/plan-execution-init "plan-customer-portal"

# Prepare next task with architectural review
/plan-prepare-next-task "plan-customer-portal"

# Execute prepared task with review cycles
/plan-implement-task "plan-customer-portal"

# Monitor progress
/plan-status "plan-customer-portal"
```

### Migration Command
```bash
# Migrate filesystem plans to Atlas
/plan-migrate-to-atlas "existing-plan-name"
```

## Architecture and Key Concepts

### Atlas Entity Structure
- **Projects**: Use format `plan-[kebab-case-name]` for IDs
- **Tasks**: Hierarchical IDs like `01-001` (phase-task) or `01-001-01` (subtask)
- **Knowledge**: Tagged with document types (`doc-type-plan-overview`, `doc-type-phase-plan`)
- **Dependencies**: Maintained through Atlas task relationships

### Task Status Flow
1. `backlog` → Tasks with unmet dependencies
2. `todo` → Ready for preparation
3. `in-progress` → Being worked on
4. `completed` → Finished successfully

### Knowledge Categorization Tags
- **Document Types**: `doc-type-plan-overview`, `doc-type-phase-plan`, `doc-type-task-prep`
- **Lifecycle**: `lifecycle-planning`, `lifecycle-execution`, `lifecycle-review`
- **Scope**: `scope-project`, `scope-phase`, `scope-task`
- **Quality**: `quality-draft`, `quality-reviewed`, `quality-final`

### Coordination Files
- `${project_root}/last-plan.json` - Tracks current active plan
- `/planning/status-report-*.md` - Generated status reports

## Development Guidelines

### Working with Commands
- Commands are markdown files in `/commands/plan/` directory
- Each command follows a structured template with implementation steps
- Commands use Atlas MCP tools exclusively for data operations
- Always validate Atlas entities exist before operations

### Atlas Enum Compliance
Always use proper Atlas enums:
- **ProjectStatus**: `active`, `pending`, `in-progress`, `completed`, `archived`
- **TaskStatus**: `backlog`, `todo`, `in-progress`, `completed`
- **TaskPriority**: `low`, `medium`, `high`, `critical`
- **TaskType**: `research`, `generation`, `analysis`, `integration`

### Error Handling
- Validate project existence before any operations
- Check for circular dependencies in task graphs
- Ensure proper Atlas connection before bulk operations
- Provide clear migration paths from filesystem to Atlas

### Testing Approach
No formal test suite exists. When modifying commands:
1. Create a test project with `/plan-create`
2. Run through full workflow to execution
3. Verify Atlas entities are created correctly
4. Check coordination files are updated
5. Ensure status reports generate properly

## Common Development Tasks

### Adding New Commands
1. Create markdown file in `/commands/plan/`
2. Follow existing command structure
3. Use Atlas MCP tools for all data operations
4. Update README.md with command documentation
5. Test full workflow integration

### Debugging Atlas Operations
```bash
# Check Atlas connection
mcp__atlas-mcp-server__atlas_project_list

# Search across all entities
mcp__atlas-mcp-server__atlas_unified_search value:"search-term"

# View project with all relationships
mcp__atlas-mcp-server__atlas_project_list mode:"details" id:"project-id" includeKnowledge:true includeTasks:true
```

### Migration from Filesystem Plans
The system supports migrating existing filesystem-based plans:
1. Use `/plan-migrate-to-atlas` command
2. Validates filesystem structure first
3. Creates Atlas entities maintaining relationships
4. Preserves task hierarchy through tagging
5. Updates coordination files

## Important Notes

- **Atlas First**: All data operations must use Atlas MCP, never filesystem for work tracking
- **ID Conventions**: Strictly follow project and task ID formats
- **Tag Consistency**: Always apply proper categorization tags to knowledge items
- **Transaction Safety**: Use bulk operations for multiple related changes
- **Status Consistency**: Ensure task states align with dependency requirements