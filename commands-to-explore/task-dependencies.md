Display and manage task dependencies with status tracking for $ARGUMENTS:

**IMPORTANT:** This command integrates with the task management system in `/tasks/` and coordinates with multi-agent workflows.

## Usage Patterns

### View Dependencies
```bash
# Show all dependencies for a specific task
/task-dependencies "project-name/task-name"

# Show dependencies with detailed status
/task-dependencies "project-name/task-name" --verbose

# Show reverse dependencies (what depends on this task)
/task-dependencies "project-name/task-name" --reverse

# Check if task is ready to start (all deps completed)
/task-dependencies "project-name/task-name" --ready-check
```

### Manage Dependencies
```bash
# Add dependencies
/task-dependencies "project-name/task-name" --add="prereq1,prereq2"

# Remove dependencies
/task-dependencies "project-name/task-name" --remove="old-dep"

# Clear all dependencies
/task-dependencies "project-name/task-name" --clear
```

## Implementation Steps

1. **Parse Arguments and Validate Task Path**:
   ```typescript
   const taskPath = args[0]; // "project-name/task-name"
   const [projectName, taskName] = taskPath.split('/');
   const taskFile = `/tasks/${projectName}/${getTaskIndex(taskName)}-${taskName}.md`;
   ```

2. **Load Task and Project Status**:
   ```typescript
   // Read task markdown file for local dependencies
   const taskContent = await Deno.readTextFile(taskFile);
   
   // Read project status.json for coordination data
   const statusFile = `/tasks/${projectName}/status.json`;
   const status = JSON.parse(await Deno.readTextFile(statusFile));
   ```

3. **Dependency Resolution Logic**:
   ```typescript
   interface TaskDependency {
     name: string;
     path: string;
     status: 'pending' | 'in-progress' | 'completed';
     assignedAgent?: string;
     blockedBy?: string[];
     estimatedCompletion?: string;
   }
   
   function resolveDependencies(taskPath: string): TaskDependency[] {
     // Parse task file for dependencies
     // Check status.json for coordination dependencies
     // Resolve agent assignments and conflicts
     // Return unified dependency tree
   }
   ```

4. **Status Display Format**:
   ```
   📋 Dependencies for project-name/task-name
   
   ┌─ Required Dependencies
   │  ✅ setup-foundation/project-structure (agent-a) - completed
   │  🔄 core-features/api-implementation (agent-b) - in progress
   │  ⏸️  core-features/database-schema (agent-b) - pending
   │
   ├─ Blocking Dependencies  
   │  ⚠️  testing-suite/unit-tests (agent-c) - waiting on this task
   │
   └─ Status: ⏸️ BLOCKED - 2 of 3 dependencies incomplete
      Ready to start: ❌ (estimated: 2h remaining)
   ```

5. **Multi-Agent Coordination**:
   ```typescript
   // Check for agent conflicts
   function checkAgentConflicts(dependencies: TaskDependency[]): string[] {
     // Verify no circular dependencies
     // Check agent availability
     // Validate worktree assignments
     // Return conflict warnings
   }
   ```

6. **Dependency Management**:
   ```typescript
   // Add dependencies to task file and status.json
   async function addDependencies(taskPath: string, deps: string[]) {
     // Update task markdown metadata
     // Update project status.json
     // Validate no circular dependencies
     // Update agent coordination if needed
   }
   ```

## Integration Points

### With Existing Commands
- **task-create**: Auto-detect dependencies during task creation
- **task-update**: Validate dependency constraints on status changes  
- **task-list**: Show dependency status in task listings
- **agent-status**: Include dependency blocking info

### With Multi-Agent System
- **Agent Assignment**: Ensure dependencies don't conflict with agent assignments
- **Worktree Coordination**: Track cross-worktree dependencies
- **Join Points**: Enforce dependency completion at join points
- **Status Synchronization**: Update all agent status files when dependencies change

## Error Handling

1. **Circular Dependencies**: Detect and report circular dependency chains
2. **Missing Tasks**: Validate all referenced tasks exist
3. **Agent Conflicts**: Warn about dependencies across agents
4. **Status Conflicts**: Flag when dependency status doesn't match task status

## Output Formats

### Default View
- Tree structure with status icons
- Agent assignments
- Estimated completion times
- Ready/blocked status

### Verbose Mode
- Full dependency paths
- Agent worktree locations
- Last updated timestamps
- Blocking reason details

### Ready Check Mode
- Simple boolean output for automation
- Exit codes (0=ready, 1=blocked, 2=error)
- JSON output option for scripting

This command provides comprehensive dependency tracking that integrates seamlessly with the existing task management and multi-agent coordination system.