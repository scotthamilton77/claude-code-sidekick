Initialize plan execution tracking for the specified plan: $ARGUMENTS

## Purpose

This command reads existing plan files in `/tasks/[plan-name]/` and creates a comprehensive `plan-tracker.json` file to track progress on phases, tasks, subtasks, and acceptance criteria validation.

## Process

1. **Plan Discovery**:

   - Read all plan files in `/tasks/[plan-name]/` directory
   - Parse README.md, PLAN.md, and \*-PLAN.md files
   - Extract phases, tasks, subtasks, and acceptance criteria
   - Identify dependencies and prerequisites

2. **Tracker Initialization**:

   - Create `plan-tracker.json` with complete plan structure
   - Set all items to "pending" status initially
   - Include metadata for tracking and coordination
   - Validate plan structure and flag any issues

3. **Validation**:
   - Check for missing dependencies
   - Verify acceptance criteria are measurable
   - Ensure proper phase sequencing
   - Flag any ambiguous or incomplete specifications

## Plan Tracker JSON Template

```json
{
  "plan_name": "string",
  "plan_title": "string",
  "initialized_at": "ISO_timestamp",
  "last_updated": "ISO_timestamp",
  "overall_status": "pending|in_progress|completed|blocked",
  "completion_percentage": 0,
  "metadata": {
    "plan_directory": "/tasks/[plan-name]/",
    "plan_context_source_files": ["PLAN.md", "README.md"], // not actual phase files
    "total_phases": 0,
    "total_tasks": 0,
    "total_subtasks": 0
  },
  "phases": [
    {
      "id": "phase_1",
      "name": "Phase Name",
      "description": "Phase description",
      "phase_source_file": "relative path to file with phase details",
      "status": "pending|in_progress|completed|blocked|skipped",
      "started_at": null,
      "completed_at": null,
      "dependencies": ["phase_id", "phase_id/task_id"],
      "prerequisites": ["requirement"],
      "acceptance_criteria": [
        {
          "id": "ac_1",
          "description": "Acceptance criteria description",
          "status": "pending|verified|failed",
          "validation_method": "test|review|demo|metrics",
          "validated_at": null,
          "notes": []
        }
      ],
      "tasks": [
        {
          "id": "task_1",
          "name": "Task Name",
          "description": "Task description",
          "plan_task_reference": "section in plan document for this task",
          "status": "pending|in_progress|completed|blocked|skipped",
          "priority": "high|medium|low",
          "assigned_to": null,
          "started_at": null,
          "completed_at": null,
          "estimated_effort": "string",
          "actual_effort": null,
          "dependencies": ["phase_id/task_id"],
          "acceptance_criteria": [
            {
              "id": "ac_1",
              "description": "Task acceptance criteria",
              "status": "pending|verified|failed",
              "validation_method": "test|review|demo|metrics",
              "validated_at": null,
              "notes": []
            }
          ],
          "subtasks": [
            {
              "id": "subtask_1",
              "name": "Subtask Name",
              "description": "Subtask description",
              "status": "pending|in_progress|completed|blocked|skipped",
              "started_at": null,
              "completed_at": null,
              "deliverables": ["deliverable"],
              "validation_steps": ["step"],
              "notes": []
            }
          ],
          "deliverables": ["deliverable"],
          "notes": []
        }
      ],
      "deliverables": ["phase deliverable"],
      "notes": []
    }
  ],
  "global_dependencies": {
    "external_systems": [],
    "tools_required": [],
    "resources_needed": [],
    "team_coordination": []
  },
  "risk_tracking": [
    {
      "id": "risk_1",
      "description": "Risk description",
      "impact": "high|medium|low",
      "probability": "high|medium|low",
      "mitigation_strategy": "string",
      "status": "open|mitigated|closed",
      "affects_phases": ["phase_id"]
    }
  ]
}
```

## Implementation Steps

1. **Validate Input**:

   - Check if plan name is provided as argument
   - Verify `/tasks/[plan-name]/` directory exists
   - List all plan files in the directory

2. **Parse Plan Files**:

   - Read each plan file (PLAN.md, README.md, \*-PLAN.md)
   - Extract structured information about phases, tasks, and acceptance criteria
   - Parse dependencies and prerequisites
   - Identify deliverables and validation methods

3. **Generate Tracker**:

   - Create plan-tracker.json with complete hierarchy
   - Generate unique IDs for all phases, tasks, and subtasks
   - Set initial timestamps and status values
   - Calculate metadata (totals, percentages)

4. **Validation & Output**:
   - Validate the generated structure for completeness
   - Check for circular dependencies
   - Flag any missing or ambiguous specifications
   - Save plan-tracker.json to the plan directory
   - Provide summary of initialization results

## Usage Examples

```bash
# Initialize tracking for a specific plan
/plan-execution-init "web-app-redesign"

# Initialize with custom task directory
/plan-execution-init "mobile-app tasks-alt"
```

## Arguments

Plan name (required): $ARGUMENTS

The plan name should match a directory under `/tasks/` unless an alternative path is specified.

## Output

- Creates `plan-tracker.json` in the plan directory
- Provides initialization summary with:
  - Total phases, tasks, and subtasks discovered
  - Any validation warnings or errors
  - Recommended next steps for plan execution
  - Confirmation of tracker file location

## Next Steps

After running this command, use:

- `/plan-execute-continue` to begin executing the next pending tasks
- Manual editing of `plan-tracker.json` to adjust priorities or assignments
- Regular status updates as work progresses
