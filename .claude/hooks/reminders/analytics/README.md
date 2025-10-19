# Analytics Output Directory

This directory contains LLM-generated analysis of conversation transcripts produced by the async analysis system.

## Purpose

The LLM analysis system uses detached background processes to analyze Claude Code conversation transcripts. This enables rich, structured analysis without impacting hook performance or causing recursive execution.

## File Format

### Topic Analysis Files
- **Filename**: `{session_id}_topic.json`
- **Created by**: `analyze-transcript.sh` in `topic-only` and `incremental` modes
- **Schema**:
  ```json
  {
    "session_id": "...",
    "timestamp": "2025-10-19T12:34:56Z",
    "task_ids": ["T001", "FEAT-08"],
    "initial_goal": "One-line summary of user's stated goal",
    "current_objective": "What they're working on right now",
    "clarity_score": 9,
    "confidence": 0.95,
    "snarky_comment": "Optional witty observation (only if clarity >= 7)"
  }
  ```

### Full Analytics Files
- **Filename**: `{session_id}_analytics.json`
- **Created by**: `analyze-transcript.sh` in `full-analytics` mode only
- **Schema**:
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

## Output Routing

The analysis system routes output based on mode:
- **`topic-only` and `incremental`**: Write to `tmp/` directory (ephemeral, not synced)
- **`full-analytics`**: Write to `analytics/` directory (persistent, available for historical review)

This directory (`analytics/`) is gitignored and excluded from sync operations via `.claudeignore`.

## Retention Policy

Files in this directory are **not automatically cleaned up**. Over time, analytics files may accumulate and consume disk space.

### Manual Cleanup

To remove analytics files older than 30 days:
```bash
find ~/.claude/hooks/reminders/analytics -name "*.json" -mtime +30 -delete
```

To remove analytics for specific sessions:
```bash
rm ~/.claude/hooks/reminders/analytics/{session_id}_*.json
```

To clear all analytics:
```bash
rm -rf ~/.claude/hooks/reminders/analytics/*.json
```

## Configuration

Control analysis behavior via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ANALYSIS_ENABLED` | `true` | Enable/disable LLM analysis |
| `CLAUDE_ANALYSIS_MODE` | `topic-only` | Analysis mode: `topic-only`, `incremental`, `full-analytics` |
| `CLAUDE_ANALYSIS_CADENCE` | `3` | Analyze every N responses |
| `CLAUDE_ANALYSIS_MODEL` | `haiku-4.5` | Model to use: `haiku-4.5`, `haiku-3.5`, `haiku-3` |

Set `CLAUDE_ANALYSIS_MODE=full-analytics` to enable persistent analytics file generation.

## Troubleshooting

### No Analytics Files Generated

Check if full analytics mode is enabled:
```bash
echo $CLAUDE_ANALYSIS_MODE  # Should be 'full-analytics'
```

Check analysis logs:
```bash
tail -f /tmp/claude-analysis-*.log
```

### Disk Space Issues

Check directory size:
```bash
du -sh ~/.claude/hooks/reminders/analytics
```

Count files:
```bash
find ~/.claude/hooks/reminders/analytics -name "*.json" | wc -l
```

## Related Documentation

- **LLM Analysis Plan**: `LLM_PLAN.md`
- **Hook System**: `.claude/hooks/reminders/response-tracker.sh`
- **Statusline Integration**: `.claude/statusline.sh`
- **Sync Configuration**: `.claudeignore`
