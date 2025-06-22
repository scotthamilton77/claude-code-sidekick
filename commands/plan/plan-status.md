Generate a concise, visually-pleasing status report for the specified plan: $ARGUMENTS

## Purpose

This command reads `plan-tracker.json` and generates a comprehensive status report showing the overall progress of plan development and execution. The report is saved to `/planning/tasks/[plan-name]/plan-status.md` with smart update capabilities that regenerate only when source files have changed since the last generation.

## Process

1. **Plan Name Resolution**:

   - If plan name provided in $ARGUMENTS, use it and update `/planning/tasks/last-plan.json`
   - If no plan name provided, read from `/planning/tasks/last-plan.json` for the last referenced plan
   - If neither exists, check for `plan-tracker.json` in current directory
   - Update `/planning/tasks/last-plan.json` with resolved plan name

2. **File Timestamp Analysis**:

   - Check if `/planning/tasks/[plan-name]/plan-status.md` exists
   - If exists, compare its timestamp against source files:
     - `plan-tracker.json`
     - All `*.md` files in plan directory (PLAN.md, README.md, phase files)
     - All files in `scratch/` directories
     - All `code-review-tracker.json` files
     - All files in `review-audit/` directories
   - Skip generation if status file is newer than all source files (unless `--force`)

3. **Smart Update Detection**:

   - If only specific sections need updates (e.g., task status changes), update incrementally
   - If major changes detected (new phases, structural changes), regenerate completely
   - Parse existing status.md to preserve manual annotations if present

4. **Data Collection**:

   - Read plan-tracker.json from `/planning/tasks/[plan-name]/`
   - Analyze phase and task completion rates
   - Identify blockers and dependencies
   - Calculate time metrics
   - Review recent execution logs from scratch directories
   - Parse review audit trails for quality metrics

5. **Status Analysis**:

   - Overall completion percentage
   - Phase-by-phase progress
   - Task status distribution
   - Critical path analysis
   - Blocker identification
   - Performance metrics from review cycles

6. **Report Generation**:
   - Generate or update `/planning/tasks/[plan-name]/plan-status.md`
   - Add generation timestamp header
   - Visual progress indicators
   - Status summary dashboard
   - Timeline visualization
   - Blocker alerts with review audit context
   - Next steps recommendations

## Status Report Template

````markdown
# Plan Status Report: [Plan Name]

Generated: [ISO Timestamp]
Source Files Last Modified: [Most Recent Timestamp]
Report Status: [Up to Date | Updated | Force Regenerated]

## Executive Summary

**Overall Progress**: [██████████░░░░░░] 67% Complete

- **Status**: [In Progress | Blocked | On Track | Completed]
- **Started**: [Date]
- **Estimated Completion**: [Date]
- **Days Elapsed**: [N days]

## Phase Progress

| Phase                  | Status         | Progress          | Tasks | Blockers |
| ---------------------- | -------------- | ----------------- | ----- | -------- |
| Phase 1: Foundation    | ✅ Completed   | [██████████] 100% | 8/8   | 0        |
| Phase 2: Core Features | 🔄 In Progress | [████████░░] 75%  | 9/12  | 1        |
| Phase 3: Integration   | ⏸️ Pending     | [░░░░░░░░░░] 0%   | 0/6   | 0        |
| Phase 4: Testing       | ⏸️ Blocked     | [░░░░░░░░░░] 0%   | 0/10  | 2        |
| Phase 5: Deployment    | ⏸️ Pending     | [░░░░░░░░░░] 0%   | 0/5   | 0        |

## Task Distribution
```text
┌─────────────────────────────────────┐
│ Completed │████████████│ 23 (56%) │
│ In Progress │███ │ 3 (7%) │
│ Ready │██ │ 2 (5%) │
│ Blocked │██ │ 2 (5%) │
│ Pending │███████ │ 11 (27%) │
└─────────────────────────────────────┘
```

## Current Activity

### 🔄 In Progress Tasks
1. **[Phase 2.3]** Implement user authentication service
   - Started: 2 hours ago
   - Assignee: Implementation Agent
   - Review Cycle: 1/3
   - Audit Trail: `/scratch/phase-02/task-03/review-audit/`

2. **[Phase 2.4]** Create API endpoints for user management
   - Started: 45 minutes ago
   - Status: Under Review (Iteration 2/3)
   - Blockers: 2 linting errors, 1 disputed architectural approach
   - Last Review: 15 minutes ago

### 🚫 Blockers
1. **[HIGH]** Database schema migration required before Phase 3
   - Blocking: 3 tasks
   - Resolution: Awaiting DBA approval

2. **[MEDIUM]** Missing API documentation for external service
   - Blocking: Phase 4 integration tests
   - Resolution: Vendor ticket #1234 opened

## Recent Completions (Last 24h)

✅ **Phase 2.1**: Setup project structure and dependencies
✅ **Phase 2.2**: Implement database models and migrations
✅ **Phase 1.8**: Finalize technical architecture document

## Performance Metrics

- **Average Task Duration**: 2.5 hours
- **Review Cycle Efficiency**: 87% (first-pass approval)
- **Review Iterations**: 1.3 avg (max 3)
- **Disputed Findings Rate**: 8% (requiring human review)
- **Blocker Resolution Time**: 4.2 hours avg
- **Daily Velocity**: 3.8 tasks/day
- **Code Quality Score**: 94% (from review audit data)

## Upcoming Milestones

| Milestone | Target Date | Status | Risk |
|-----------|------------|--------|------|
| MVP Feature Complete | [Date] | On Track | Low |
| Beta Testing Start | [Date] | At Risk | Medium |
| Production Deploy | [Date] | On Track | Low |

## Risk Assessment

### 🔴 High Risk Items
- Database migration dependency blocking Phase 3 start
- External API documentation delay impacting testing

### 🟡 Medium Risk Items
- Code review bottleneck if velocity increases
- Test coverage below 80% target in some modules

## Recommendations

1. **Immediate Actions**:
   - Escalate database migration approval
   - Assign backup reviewer for code reviews
   - Contact vendor for API documentation ETA

2. **Process Improvements**:
   - Consider parallel task execution in Phase 2
   - Implement automated linting in CI/CD
   - Add integration test mocks for external APIs

3. **Next 24 Hours**:
   - Complete remaining Phase 2 tasks
   - Resolve current blockers
   - Prepare Phase 3 initialization

## Command History

```bash
# Recent executions
[timestamp] /plan-execute-continue "project-name" # Task 2.3 completed
[timestamp] /plan-execute-continue "project-name" # Task 2.4 started
[timestamp] /plan-status "project-name"          # This report
```

---

_Use `/plan-execute-continue` to resume execution_

````

## Visual Elements

The report uses these visual indicators for clarity:

- **Progress Bars**: `[██████████░░░░░░]` for percentage completion
- **Status Icons**:
  - ✅ Completed
  - 🔄 In Progress
  - ⏸️ Pending/Paused
  - 🚫 Blocked
  - ⚠️ At Risk
  - 🔴 High Risk
  - 🟡 Medium Risk
  - 🟢 Low Risk

## Usage Examples

```bash
# Generate status for last referenced plan (reads from /planning/tasks/last-plan.json)
/plan-status

# Generate status for specific plan (updates /planning/tasks/last-plan.json)
/plan-status "web-app-redesign"

# Force complete regeneration of status file
/plan-status "mobile-app" --force

# Quick status display (doesn't save to file, still updates last-plan.json)
/plan-status "data-pipeline" --summary --no-save

# Check if status needs updating without generating
/plan-status "project-name" --check-only

# Example workflow showing last-plan tracking:
/plan-status "web-app-redesign"  # Creates/updates last-plan.json
/plan-status                     # Uses "web-app-redesign" from last-plan.json
/plan-status "mobile-app"        # Updates last-plan.json to "mobile-app"
/plan-status                     # Now uses "mobile-app"
```

## Arguments

**Plan Name**: $ARGUMENTS (optional)

- If no plan name provided, uses the last referenced plan from `/planning/tasks/last-plan.json`
- If last-plan.json doesn't exist, checks for plan-tracker.json in current directory
- Updates `/planning/tasks/last-plan.json` with the resolved plan name for future commands

**Options**:

- `--force`: Force complete regeneration, ignore timestamps
- `--summary`: Generate summary section only (faster)
- `--blockers`: Focus on detailed blocker analysis
- `--timeline`: Gantt-style progress view
- `--no-save`: Display only, don't write to status.md file
- `--check-only`: Check if update needed, don't generate
- `--include-audit`: Include detailed review audit trail data

## File Output

**Primary Output**: `/planning/tasks/[plan-name]/plan-status.md`

- Generated automatically with smart update detection
- Preserves manual annotations in specially marked sections
- Includes generation metadata and timestamps

**Smart Update Logic**:

1. **No Change**: Status file newer than all source files → Skip generation
2. **Incremental**: Only task status/progress changed → Update specific sections
3. **Full Regeneration**: Structural changes or `--force` → Complete rebuild
4. **Source Files Monitored**:
   - `plan-tracker.json`
   - `*.md` files in plan directory
   - All `scratch/` subdirectories
   - `review-audit/` directories
   - `code-review-tracker.json` files

## Integration Points

- Reads from `plan-tracker.json` for current state
- Analyzes `scratch/` directories for execution details
- Parses `review-audit/` directories for complete review history
- Reviews git commits for recent changes
- Checks code-review-tracker.json files for quality metrics
- Monitors file modification timestamps for smart updates

## Implementation Details

### Last Plan Tracking

The `/planning/tasks/last-plan.json` file maintains project-level tracking of the most recently referenced plan:

```json
{
  "plan_name": "web-app-redesign",
  "last_updated": "2024-01-15T14:30:22.123Z",
  "updated_by": "plan-status",
  "command_history": [
    {
      "command": "plan-status",
      "plan_name": "web-app-redesign",
      "timestamp": "2024-01-15T14:30:22.123Z"
    },
    {
      "command": "plan-execute-continue",
      "plan_name": "mobile-app",
      "timestamp": "2024-01-15T12:15:08.456Z"
    }
  ]
}
```

**Plan Name Resolution Logic**:

1. If plan name provided in command → Use it and update last-plan.json
2. If no plan name provided → Read plan_name from last-plan.json
3. If last-plan.json doesn't exist → Check current directory for plan-tracker.json
4. If found → Extract plan name and create last-plan.json
5. If none found → Error with suggestion to run plan initialization

**Update Behavior**:

- Always update last-plan.json when a plan name is resolved
- Maintain command history (last 10 entries) for debugging
- Include timestamp and command that updated the reference

### Timestamp Checking Algorithm

```bash
# Pseudo-code for timestamp checking
function needsUpdate(planName) {
  statusFile = `/planning/tasks/${planName}/plan-status.md`
  if (!exists(statusFile)) return true

  statusTime = getModTime(statusFile)
  sourceFiles = [
    `plan-tracker.json`,
    glob(`*.md`),
    glob(`scratch/**/*`),
    glob(`**/code-review-tracker.json`),
    glob(`**/review-audit/**/*`)
  ]

  for (file of sourceFiles) {
    if (getModTime(file) > statusTime) return true
  }
  return false
}
```

### Smart Update Detection

1. **Parse existing status.md** to identify sections
2. **Compare data changes**:
   - Task status changes → Update "Current Activity" section
   - Phase completion → Update "Phase Progress" section
   - New blockers → Update "Blockers" section
   - Performance metrics → Update "Performance Metrics" section
3. **Preserve manual content** in marked sections:
   ```markdown
   <!-- MANUAL-CONTENT-START: Custom Notes -->

   User's manual annotations here

   <!-- MANUAL-CONTENT-END -->
   ```

### Generation Output Messages

```
Status file up to date (no changes since [timestamp])
Status file updated (3 sections modified)
Status file regenerated (--force specified)
Status file created (first generation)
```

## Error Handling

- **No plan name and no last-plan.json**: Suggest running `/plan-execution-init` first
- **Invalid last-plan.json**: Attempt to recover plan name from current directory
- **Plan name in last-plan.json but tracker missing**: Suggest plan may have been moved/deleted
- **No tracker found**: Suggest running `/plan-execution-init` first
- **Corrupted tracker**: Attempt recovery from backup, show partial data
- **Missing source files**: Show partial report with warnings about missing data
- **Stale data**: Alert if last update > 24 hours old
- **Timestamp read errors**: Fall back to full regeneration
- **Write permission errors**: Display report without saving to file
