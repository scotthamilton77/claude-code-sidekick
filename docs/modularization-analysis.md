# Analysis of plan-*.md Files for Modularization Opportunities

## Common Patterns Found

### 1. Plan Name Resolution Pattern
All commands share an identical plan name resolution process:
- Check if plan name provided in $ARGUMENTS
- If not, read from `/planning/tasks/last-plan.json`
- If neither exists, check current directory
- Update `/planning/tasks/last-plan.json` with resolved plan name

This appears in **ALL 7 files** starting around line 9-15 in the Process section.

### 2. Last Plan Tracking Pattern
All commands implement the same last-plan.json structure and update logic:
```json
{
  "plan_name": "web-app-redesign",
  "last_updated": "ISO_timestamp",
  "updated_by": "command-name",
  "command_history": [...]
}
```

### 3. Usage Examples Pattern
Each file has extensive usage examples showing:
- Using with specific plan name
- Using without plan name (reads from last-plan.json)
- Example workflow showing last-plan tracking
- Optional flags/parameters

### 4. Directory Structure References
Common directory paths referenced across all files:
- `/planning/tasks/[plan-name]/`
- `/planning/tasks/last-plan.json`
- Subdirectories: `scratch/`, `review-audit/`, phase files, etc.

### 5. Arguments Section Pattern
All files have a similar Arguments section explaining:
- Plan name is optional
- Resolution logic from last-plan.json
- Updates to last-plan.json

## Repeated Content/Instructions

### 1. Plan Name Resolution Logic (Repeated 7 times)
The exact same 4-step resolution process and last-plan.json update behavior is documented in each file.

### 2. File Path Constants
- `/planning/tasks/` base path
- `last-plan.json` filename
- Directory structure patterns

### 3. Error Handling Patterns
Similar error cases across files:
- No plan name and no last-plan.json
- Invalid last-plan.json
- Missing tracker/plan files
- Permission errors

## Potential Areas for Modularization

### 1. Common Functions Module
Create a shared module for:
- `resolvePlanName(arguments)` - handles all plan name resolution logic
- `updateLastPlan(planName, commandName)` - updates last-plan.json
- `getPlanDirectory(planName)` - returns plan directory path
- `validatePlanExists(planName)` - checks if plan directory exists

### 2. Constants Module
Define all shared paths and filenames:
- `PLANNING_BASE_DIR = "/planning/tasks/"`
- `LAST_PLAN_FILE = "last-plan.json"`
- `PLAN_TRACKER_FILE = "plan-tracker.json"`
- Directory structure constants

### 3. Template Modules
Extract common templates:
- last-plan.json structure
- Error message templates
- Status report components
- Plan tracker JSON schema

### 4. Documentation Helpers
Create shared documentation components:
- Standard usage examples generator
- Arguments section template
- Error handling documentation

## Key Differences Between Commands

### Purpose & Core Functionality
Each command has a unique primary purpose:
- **plan-create**: Creates initial high-level plan structure
- **plan-ideate**: Incorporates feedback to refine plans
- **plan-brainstorm-options**: Generates strategic alternatives with tradeoffs
- **plan-decompose**: Breaks high-level plans into detailed tasks
- **plan-execution-init**: Creates plan-tracker.json for tracking
- **plan-execute-continue**: Executes tasks with code review cycles
- **plan-status**: Generates status reports with smart updates

### Unique Templates & Structures
Each command has specialized templates:
- plan-create: High-level plan template
- plan-ideate: Change log template
- plan-brainstorm-options: Strategic options analysis template
- plan-decompose: Detailed phase template with tasks
- plan-execution-init: Plan tracker JSON schema
- plan-execute-continue: Review cycle prompts and audit structure
- plan-status: Visual status report template

### Command-Specific Logic
- plan-execute-continue: Complex review cycle management (3 iterations max)
- plan-status: Timestamp checking and smart update detection
- plan-brainstorm-options: Option generation and selection interface
- plan-decompose: Task decomposition algorithm

## Recommendations for Modularization

### 1. Create Core Modules
- `plan-common.js/py` - Shared functions for plan resolution, paths, etc.
- `plan-constants.js/py` - All shared constants and configurations
- `plan-templates.js/py` - Common template structures

### 2. Refactor Commands to Use Modules
Each command would:
- Import common modules
- Focus only on its unique logic
- Reduce repetition by ~40-50%

### 3. Centralize Documentation
- Create a shared documentation section for common patterns
- Reference it from individual commands
- Maintain command-specific details separately

### 4. Standardize Error Handling
- Create common error handler
- Define standard error codes
- Consistent error messaging across commands

This modularization would significantly reduce code duplication while maintaining the unique functionality of each command.