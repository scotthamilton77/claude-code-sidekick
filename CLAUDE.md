# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

This repository serves as the **experimental proving ground** for Claude Code configuration development. It enables testing and debugging of commands, hooks, agents, skills, and other Claude Code capabilities in a project-scoped environment before deploying them to the user's global `~/.claude` directory.

**Critical Design Principle**: All scripts and capabilities must operate identically whether invoked from:
- **Project scope**: `.claude/` directory within this repository
- **User scope**: `~/.claude/` global configuration directory

This dual-scope requirement ensures configurations can be tested locally before global deployment.

## Architecture Overview

The repository is organized around three main systems:

- **Experimental Command Templates**: `backlog/commands-to-explore/` and `backlog/commands/` contain markdown-based command specifications for development tasks
- **Hook System**: Scripts in `.claude/hooks/` handle conversation tracking, response monitoring, and topic classification
- **Synchronization Infrastructure**: Shell scripts in `scripts/` manage bidirectional sync between project `.claude/` and global `~/.claude` configurations

### Key Components

#### Command System
- `backlog/commands-to-explore/`: Experimental command templates under development
- `backlog/commands/plan/`: Planning and project management commands
- `backlog/commands/proto/`: Prototype command patterns

#### Hook System
- `.claude/hooks/reminders/response-tracker.sh`: UserPromptSubmit hook that manages sleeper launch and fallback analysis
- `.claude/hooks/reminders/snarkify-last-session.sh`: SessionStart hook for proactive resume statusline generation
- `.claude/hooks/reminders/sleeper-analysis.sh`: Persistent background polling process with adaptive intervals
- `.claude/hooks/reminders/analyze-transcript.sh`: Core LLM-based transcript analysis (used by both sleeper and fallback)
- `.claude/hooks/reminders/analysis-prompts/`: LLM prompt templates for different analysis modes
- `.claude/hooks/reminders/tmp/`: Runtime state for hook operations (excluded from version control)
- `.claude/hooks/reminders/analytics/`: Persistent analytics output (excluded from sync)
- `.claude/hooks/reminders/deprecated/`: Deprecated hooks (write-topic.sh, write-unclear-topic.sh)

#### Configuration Files
- `.claude/CLAUDE.md`: Project-specific instructions (mirrors global `~/.claude/CLAUDE.md`)
- `.claude/mcp.json`: Model Context Protocol server configurations (context7, sequential-thinking, zen, memory)
- `.claude/settings.json`: Project-scoped permissions and configuration
- `.claude/settings.local.json`: Local overrides (excluded from sync)
- `.claude/statusline.sh`: Dynamic status line generator
- `.claudeignore`: Sync exclusion patterns (supports file and directory wildcards)

#### Synchronization Scripts
- `scripts/pull-from-claude.sh`: Import files from `~/.claude` → `.claude/`
- `scripts/push-to-claude.sh`: Export files from `.claude/` → `~/.claude`
- `scripts/sync-claude.sh`: Bidirectional sync (pull → push)
- `scripts/setup-reminders.sh`: Initialize hook permissions and statusline configuration (supports `--project` flag)
- `scripts/cleanup-reminders.sh`: Remove hook permissions and statusline configuration (supports `--project` flag)

## Common Commands

### Initial Setup
```bash
# Configure hook permissions and statusline for user scope
./scripts/setup-reminders.sh

# Also configure project-local settings (for testing in project scope)
./scripts/setup-reminders.sh --project
```

### Configuration Sync
```bash
# Import from global config (test changes made in ~/.claude)
./scripts/pull-from-claude.sh

# Export to global config (deploy tested changes)
./scripts/push-to-claude.sh

# Bidirectional sync (import then export)
./scripts/sync-claude.sh
```

### Testing
```bash
# Test setup-reminders.sh functionality (comprehensive test suite)
./tests/test-setup-reminders.sh

# Test cleanup-reminders.sh functionality
./tests/test-cleanup-reminders.sh

# Test response tracker hook behavior
./tests/test-response-tracker.sh
```

### Development Workflow
1. Modify configurations in `.claude/` directory
2. Test locally in project scope (hooks run from `.claude/hooks/`)
3. Verify dual-scope compatibility
4. Deploy to user scope via `./scripts/push-to-claude.sh`

## MCP Server Configuration

The repository uses several MCP (Model Context Protocol) servers:
- **context7**: External SSE server for enhanced context
- **sequential-thinking**: NPX-based thinking assistance
- **zen**: Local Python-based server for specialized functionality  
- **memory**: NPX-based memory management

## Development Patterns

### Dual-Scope Compatibility
All scripts must support both deployment contexts:
- **Project scope**: Paths relative to `$CLAUDE_PROJECT_DIR/.claude/`
- **User scope**: Paths relative to `~/.claude/`

Use environment variables and dynamic path resolution to ensure portability. See `setup-reminders.sh:186-254` for context detection patterns.

### Hook System Architecture
Hooks execute at specific conversation events:
- **SessionStart**: Triggered when a new conversation session begins
  - `snarkify-last-session.sh`: Generates resume statusline from previous session's topic (proactive)
- **UserPromptSubmit**: Triggered before Claude processes user input
  - `response-tracker.sh`: Launches sleeper process (first call only), manages fallback analysis cadence

State files in `.claude/hooks/reminders/tmp/` persist across conversations (gitignored).

### LLM Analysis System

The repository implements an **adaptive asynchronous transcript analysis system** with two complementary approaches:

1. **Sleeper Process** (default): Persistent background polling for rapid status updates during active work
2. **Cadence-Based Fallback**: Periodic analysis after sleeper exits or when disabled

#### Architecture

**Sleeper Mode** (Active during initial conversation phase):
```
SessionStart Hook
    ↓
snarkify-last-session.sh → generates resume statusline (proactive)
    ↓
Statusline shows "Resume: <goal>" immediately

First UserPromptSubmit
    ↓
response-tracker.sh launches sleeper-analysis.sh
    ↓ (hook exits <10ms)

[Sleeper Process - Long-Running Background]
    ↓
Poll transcript every 2-5s (adaptive)
    ↓
If size changed >500 bytes AND >10s since last analysis:
    Run analyze-transcript.sh
    Check clarity_score from result
    ↓
    If clarity >= threshold (default 7): EXIT sleeper
    If clarity < threshold: CONTINUE polling
    ↓
After 10 minutes OR clarity met: EXIT sleeper
```

**Fallback Mode** (After sleeper exits or when disabled):
```
response-tracker.sh fires on UserPromptSubmit
    ↓
Check if analysis due (based on response count & clarity)
    ↓
Launch analyze-transcript.sh (one-time)
    ↓
Continue normal cadence-based analysis
```

#### Key Features

- **Adaptive Polling**: Sleeper adjusts intervals (2s active, 5s idle) based on transcript activity
- **Clarity-Based Exit**: Sleeper terminates when clarity threshold met, hands off to fallback
- **Resume Continuity**: Proactive snarkification of last session's topic on new sessions
- **Cost Control**: Minimum size change (500 bytes) and interval (10s) throttling
- **Zero Hook Overhead**: Sleeper runs independently, hooks complete in <10ms
- **Self-Terminating**: Maximum 10-minute runtime prevents orphan processes
- **Backward Compatible**: Can be disabled to use original cadence-based system

#### Components

- **`sleeper-analysis.sh`**: Persistent polling process with adaptive intervals
- **`snarkify-last-session.sh`**: SessionStart hook for proactive resume statusline
- **`analyze-transcript.sh`**: Core analysis script (used by both sleeper and fallback)
- **`response-tracker.sh`**: Manages sleeper launch and fallback analysis
- **`analysis-prompts/`**: Mode-specific prompt templates
  - `topic-only.txt`: Fast topic detection (~2s, minimal tokens)
  - `incremental.txt`: Recent context analysis (~4s)
  - `full-analytics.txt`: Comprehensive insights (~10s)
- **`.claude/hooks/reminders/tmp/`**: Ephemeral topic files + sleeper PID tracking
- **`.claude/hooks/reminders/analytics/`**: Persistent analytics storage (gitignored)

#### Configuration

Control via environment variables:

**Sleeper Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_SLEEPER_ENABLED` | `true` | Enable/disable sleeper polling |
| `CLAUDE_SLEEPER_INTERVAL_ACTIVE` | `2` | Polling interval when transcript changing (seconds) |
| `CLAUDE_SLEEPER_INTERVAL_IDLE` | `5` | Polling interval when idle (seconds) |
| `CLAUDE_SLEEPER_MAX_DURATION` | `600` | Maximum sleeper runtime (seconds, 10 min) |
| `CLAUDE_SLEEPER_CLARITY_EXIT` | `7` | Clarity score for sleeper exit (1-10 scale) |
| `CLAUDE_SLEEPER_MIN_SIZE_CHANGE` | `500` | Minimum bytes changed to trigger analysis |
| `CLAUDE_SLEEPER_MIN_INTERVAL` | `10` | Minimum seconds between analyses |

**Analysis Configuration** (both sleeper and fallback):
| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ANALYSIS_ENABLED` | `true` | Enable/disable fallback analysis |
| `CLAUDE_ANALYSIS_MODE` | `topic-only` | Mode: `topic-only`, `incremental`, `full-analytics` |
| `CLAUDE_ANALYSIS_CADENCE_HIGH_CLARITY` | `10` | Fallback frequency for clear conversations |
| `CLAUDE_ANALYSIS_CADENCE_LOW_CLARITY` | `1` | Fallback frequency for unclear conversations |
| `CLAUDE_ANALYSIS_CLARITY_THRESHOLD` | `7` | Clarity score threshold (1-10 scale) |
| `CLAUDE_ANALYSIS_MODEL` | `haiku-4.5` | Model: `haiku-4.5`, `haiku-3.5`, `haiku-3` |

**Resume Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_SNARK_MODEL` | `haiku-4.5` | Model for resume snarkification |

#### Output Schema

**Topic Files** (`{session_id}_topic.json`):
```json
{
  "session_id": "...",
  "timestamp": "2025-10-19T12:34:56Z",
  "task_ids": ["T001", "FEAT-08"],
  "initial_goal": "User's stated objective",
  "current_objective": "Current work focus",
  "clarity_score": 9,
  "confidence": 0.95,
  "snarky_comment": "Witty observation (if clarity >= 7)"
}
```

**Analytics Files** (`{session_id}_analytics.json` - full mode only):
```json
{
  "session_id": "...",
  "timestamp": "...",
  "topic_evolution": [...],
  "complexity_metrics": {...},
  "language_patterns": [...],
  "key_decisions": [...],
  "technical_domains": [...]
}
```

#### Troubleshooting

**Sleeper not running**:
```bash
# Check if enabled
echo $CLAUDE_SLEEPER_ENABLED

# View sleeper logs
tail -f /tmp/claude-sleeper-*.log

# Check for running sleeper
ps aux | grep sleeper-analysis

# Check PID file
cat .claude/hooks/reminders/tmp/*_sleeper.pid
ps -p $(cat .claude/hooks/reminders/tmp/*_sleeper.pid)
```

**Sleeper stuck or orphaned**:
```bash
# Kill all sleeper processes
pkill -f sleeper-analysis.sh

# Clean up stale PID files
rm -f .claude/hooks/reminders/tmp/*_sleeper.pid
```

**Analysis not running**:
```bash
# Check if analysis enabled
echo $CLAUDE_ANALYSIS_ENABLED

# View analysis logs
tail -f /tmp/claude-analysis-*.log

# Check for running analysis
ps aux | grep analyze-transcript
```

**Resume statusline not showing**:
```bash
# Check if SessionStart hook fired
tail -f /tmp/claude-snarkify.log

# Check for previous topic files
ls -la .claude/hooks/reminders/tmp/*_topic.json

# Manually test snarkify
echo '{"session_id":"test-123"}' | .claude/hooks/reminders/snarkify-last-session.sh
```

**Performance issues**:
```bash
# Measure hook overhead
time ./response-tracker.sh track "$PWD" < test.json
# Should be <10ms

# Check sleeper CPU usage
ps aux | grep sleeper-analysis | grep -v grep
# Should be <1% CPU
```

**Disk space concerns**:
```bash
# Check analytics directory size
du -sh .claude/hooks/reminders/analytics

# Clean old analytics files (30+ days)
find .claude/hooks/reminders/analytics -name "*.json" -mtime +30 -delete

# Clean old logs
find /tmp -name "claude-*.log" -mtime +7 -delete
```

See `LLM_PLAN.md` for complete implementation details and `analytics/README.md` for output documentation.

### Synchronization Behavior
- Timestamp-based copying: only files newer than destination are transferred
- `.claudeignore` supports glob patterns for files and directories
- `settings.local.json` and tmp files automatically excluded from sync
- Sync operations are idempotent and safe to run repeatedly

### Command Template Structure
Markdown-based specifications include:
- Purpose/requirements sections
- Process flows (often with Mermaid diagrams)
- Bash code blocks for execution
- Atlas MCP integration (where applicable)

## Critical Constraints

- **Never modify files outside project directory** without explicit authorization
- **All hooks must be permission-approved** in `settings.json` before execution
- **Dual-scope testing required** before deploying to `~/.claude`
- **Timestamp preservation** critical for sync correctness