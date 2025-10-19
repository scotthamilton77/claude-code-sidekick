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
- `.claude/hooks/reminders/write-topic.sh`: Records clear conversation topics with metadata
- `.claude/hooks/reminders/write-unclear-topic.sh`: Handles vague/ambiguous user requests
- `.claude/hooks/reminders/response-tracker.sh`: Monitors Claude responses and provides periodic reminders
- `.claude/hooks/reminders/analyze-transcript.sh`: Async LLM-based transcript analysis (detached background process)
- `.claude/hooks/reminders/analysis-prompts/`: LLM prompt templates for different analysis modes
- `.claude/hooks/reminders/tmp/`: Runtime state for hook operations (excluded from version control)
- `.claude/hooks/reminders/analytics/`: Persistent analytics output (excluded from sync)

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
- **UserPromptSubmit**: Triggered before Claude processes user input
  - `write-topic.sh`: Analyzes intent, records topic metadata
  - `write-unclear-topic.sh`: Handles ambiguous/vague requests
  - `response-tracker.sh`: Maintains response count, injects periodic reminders

State files in `.claude/hooks/reminders/tmp/` persist across conversations (gitignored).

### LLM Analysis System

The repository implements an **asynchronous transcript analysis system** that uses detached background processes to analyze conversation transcripts with LLM models without impacting hook performance.

#### Architecture

```
User Conversation (Sonnet 4.5)
    ↓
response-tracker.sh fires → decides if analysis needed
    ↓ YES
Launch detached: analyze-transcript.sh &
    ↓ (hook exits immediately <50ms)

[Background Process - Isolated]
    ↓
Create /tmp workspace with empty hooks config
    ↓
claude -p --model haiku-4.5 (prevents recursion)
    ↓
Parse JSON output
    ↓
Write to .claude/hooks/reminders/tmp/ or analytics/
```

#### Key Features

- **Zero-Latency Execution**: Hooks launch analysis via `nohup` and exit immediately
- **Recursion Prevention**: Isolated workspace with `"hooks":{}` in settings.json
- **Adaptive Cadence**: Analysis frequency adjusts based on conversation clarity
- **Cost-Efficient**: Uses Haiku models (~$0.03-0.07 per 100-response conversation)
- **Dual-Output Routing**:
  - `topic-only`/`incremental` modes → `tmp/` (ephemeral, statusline consumption)
  - `full-analytics` mode → `analytics/` (persistent, historical review)

#### Components

- **`analyze-transcript.sh`**: Core analysis script (detached execution)
- **`analysis-prompts/`**: Mode-specific prompt templates
  - `topic-only.txt`: Fast topic detection (~2s, minimal tokens)
  - `incremental.txt`: Recent context analysis (~4s)
  - `full-analytics.txt`: Comprehensive insights (~10s)
- **`.claude/hooks/reminders/analytics/`**: Persistent analytics storage (gitignored)
- **`.claude/hooks/reminders/tmp/`**: Ephemeral topic files for statusline

#### Configuration

Control via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ANALYSIS_ENABLED` | `true` | Enable/disable analysis |
| `CLAUDE_ANALYSIS_MODE` | `topic-only` | Mode: `topic-only`, `incremental`, `full-analytics` |
| `CLAUDE_ANALYSIS_CADENCE` | `3` | Base frequency (every N responses) |
| `CLAUDE_ANALYSIS_CADENCE_HIGH_CLARITY` | `5` | Frequency for clear conversations |
| `CLAUDE_ANALYSIS_CADENCE_LOW_CLARITY` | `2` | Frequency for unclear conversations |
| `CLAUDE_ANALYSIS_CLARITY_THRESHOLD` | `7` | Clarity score threshold (1-10 scale) |
| `CLAUDE_ANALYSIS_MODEL` | `haiku-4.5` | Model: `haiku-4.5`, `haiku-3.5`, `haiku-3` |

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

**Analysis not running**:
```bash
# Check if enabled
echo $CLAUDE_ANALYSIS_ENABLED

# View logs
tail -f /tmp/claude-analysis-*.log

# Check for stuck processes
ps aux | grep analyze-transcript
```

**Performance issues**:
```bash
# Measure hook overhead
time ./response-tracker.sh track "$PWD" < test.json

# Should be <50ms
```

**Disk space concerns**:
```bash
# Check analytics directory size
du -sh ~/.claude/hooks/reminders/analytics

# Clean old files (30+ days)
find ~/.claude/hooks/reminders/analytics -name "*.json" -mtime +30 -delete
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