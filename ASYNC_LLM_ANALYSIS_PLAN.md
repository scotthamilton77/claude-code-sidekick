# Async LLM-Based Transcript Analysis Implementation Plan

## Executive Summary

Replace synchronous, prompt-based intent analysis with asynchronous LLM-powered transcript analysis using detached background processes. This enables rich, structured analysis of conversation transcripts using cost-effective Haiku models without impacting hook performance or causing recursive execution.

## Objectives

### Primary Goals

1. **Zero-Latency Hook Execution**: Hooks must complete in <50ms, launching analysis as detached background process
2. **Prevent Hook Recursion**: Analysis invokes `claude -p` in isolated workspace with empty hooks configuration
3. **Rich Structured Output**: Extract conversation metadata as JSON (topic, intent, clarity, analytics)
4. **Cost Efficiency**: Use Haiku 4.5 ($1/$5 per million tokens) or Haiku 3.5 ($0.80/$4 per million) for analysis
5. **Flexible Analysis Modes**: Support topic-only, incremental, and full analytics modes
6. **Dual-Scope Compatibility**: Work identically in project `.claude/` and user `~/.claude/` contexts

### Secondary Goals

1. **Enhanced Statusline Integration**: Feed richer topic data to statusline.sh
2. **Historical Analytics**: Build conversation insights over time
3. **Debugging Visibility**: Comprehensive logging separate from main conversation
4. **Backward Compatibility**: Existing hooks continue working during development

## Architecture

### Component Overview

```
User Conversation (Sonnet 4.5)
    ↓
Hook: response-tracker.sh fires
    ↓
Decision: Should we analyze? (cadence check)
    ↓ YES
Launch detached: analyze-transcript.sh &
    ↓ (hook exits immediately)

[Background Process - Isolated]
    ↓
Create /tmp workspace with clean settings
    ↓
cd /tmp/workspace && claude -p (Haiku 4.5)
    ↓
Parse JSON output
    ↓
Write to .claude/hooks/reminders/analytics/
    ↓ (background process exits)

[Next Statusline Render]
    ↓
Read enhanced analytics files
    ↓
Display enriched topic/metrics
```

### Key Design Decisions

**1. Detached Process Pattern**
```bash
nohup /path/to/analyze-transcript.sh "$session_id" "$transcript_path" \
  </dev/null &>/tmp/claude-analysis.log &
```
- Parent hook exits immediately (~5ms overhead)
- Child process runs independently
- Output redirected to dedicated log file
- No zombie processes (double-fork pattern if needed)

**2. Isolated Workspace**
```bash
workspace="/tmp/claude-analysis-$$"
mkdir -p "$workspace/.claude"
echo '{"hooks":{}}' > "$workspace/.claude/settings.json"
cd "$workspace"
claude -p --model haiku-4.5 --output-format json "..."
```
- Empty hooks object prevents recursion
- Temporary directory cleaned on exit
- Process isolation guarantees safety

**3. Analysis Modes**

| Mode | Input Size | Use Case | Output |
|------|-----------|----------|--------|
| `topic-only` | Last 1-3 messages | Fast topic detection | topic.json |
| `incremental` | Last 10-20 messages | Recent context analysis | topic.json + metrics |
| `full-analytics` | Full transcript | Comprehensive insights | Full analytics suite |

**4. Output Schema**

```json
// {session_id}_topic.json
{
  "session_id": "...",
  "timestamp": "2025-10-19T12:34:56Z",
  "primary_topic": "Async LLM analysis via detached process",
  "intent_category": "development",
  "clarity_score": 9,
  "confidence": 0.95,
  "suggested_summary": "One-line description for statusline",
  "snarky_comment": "Finally figured out how to make LLMs useful without breaking everything"
}

// {session_id}_analytics.json (full mode only)
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

## Implementation Steps

### Phase 1: Core Analysis Script ✅

**File**: `.claude/hooks/reminders/analyze-transcript.sh`

**Status**: COMPLETED

**Requirements**:
- Accept CLI arguments: `session_id`, `transcript_path`, `mode`, `output_dir`
- Validate inputs and fail fast with descriptive errors
- Create isolated workspace with clean settings.json
- Load appropriate analysis prompt template based on mode
- Execute `claude -p --model haiku-4.5 --output-format json`
- Parse and validate JSON output
- Write formatted results to output directory
- Comprehensive error logging to `/tmp/claude-analysis-{session_id}.log`
- Cleanup workspace on exit (trap EXIT)
- Dual-scope path resolution (detect project vs user context)

**Success Criteria**:
- Can be invoked directly for testing: `./analyze-transcript.sh <session_id> <path> topic-only /tmp`
- Produces valid JSON output files
- No hooks fire during `claude -p` execution
- Completes within 2-5 seconds for topic-only mode
- Logs include timestamps and error details

**Testing**:
```bash
# Manual test
./analyze-transcript.sh "test-123" "/path/to/transcript.jsonl" "topic-only" "/tmp/test-output"

# Verify no hooks fired
grep "ResponseTracker" /tmp/claude-analysis-test-123.log  # Should be empty

# Validate output
jq . /tmp/test-output/test-123_topic.json
```

### Phase 2: Analysis Prompt Templates ✅

**Directory**: `.claude/hooks/reminders/analysis-prompts/`

**Status**: COMPLETED

**Files**:

1. **`topic-only.txt`** ✅
   - Input: Last 1-3 conversation exchanges
   - Output: Primary topic, intent category, clarity score
   - Optimized for speed (minimal tokens)

2. **`incremental.txt`** ✅
   - Input: Last 10-20 messages
   - Output: Topic + basic metrics (complexity, progress)
   - Balanced speed/insight

3. **`full-analytics.txt`** ✅
   - Input: Full transcript
   - Output: Comprehensive analytics
   - Deep analysis (slower, richer)

**Template Format**:
```
You are analyzing a Claude Code conversation transcript.

ANALYSIS MODE: {mode}
INPUT: {transcript_excerpt}

Extract and return ONLY valid JSON with this exact schema:
{schema_definition}

Requirements:
- Be concise but accurate
- Clarity score: 1 (vague/unclear) to 10 (crystal clear)
- Intent category: development|debugging|research|planning|conversation
- Snarky comment: witty observation about the conversation
```

**Success Criteria**:
- Templates produce consistent JSON output
- Topic detection completes in <2 seconds
- Incremental analysis in <4 seconds
- Full analytics in <10 seconds

### Phase 3: Hook Integration

**File**: `.claude/hooks/reminders/response-tracker.sh` (modifications)

**Changes**:

1. Add configuration variables:
```bash
# Analysis configuration
ANALYSIS_ENABLED=${CLAUDE_ANALYSIS_ENABLED:-true}
ANALYSIS_MODE=${CLAUDE_ANALYSIS_MODE:-topic-only}
ANALYSIS_CADENCE=${CLAUDE_ANALYSIS_CADENCE:-3}  # Every N responses
```

2. Add detached launcher function:
```bash
launch_analysis() {
    local session_id="$1"
    local transcript_path="$2"
    local mode="${ANALYSIS_MODE}"

    # Determine output directory (dual-scope)
    local output_dir="${cache_dir}"

    # Launch detached process
    nohup "${HOOK_DIR}/analyze-transcript.sh" \
        "$session_id" \
        "$transcript_path" \
        "$mode" \
        "$output_dir" \
        </dev/null \
        &>"/tmp/claude-analysis-${session_id}.log" &

    # Optional: capture PID for monitoring
    local analysis_pid=$!
    [ "$VERBOSE" = true ] && echo "[ResponseTracker] Launched analysis: PID $analysis_pid" >&2
}
```

3. Integrate into tracking logic:
```bash
# After incrementing counter
count=$((count + 1))
echo "$count" > "$counter_file"

# Check if analysis should run
if [ "$ANALYSIS_ENABLED" = true ]; then
    analysis_due=$((count % ANALYSIS_CADENCE))
    if [ $analysis_due -eq 0 ]; then
        launch_analysis "$session_id" "$transcript_path"
    fi
fi

# Continue with existing reminder logic...
```

**Success Criteria**:
- Hook completion time remains <50ms
- Analysis process launches successfully
- No zombie processes created
- Analysis logs appear in `/tmp/`
- Topic files written to expected location

**Testing**:
```bash
# Time hook execution
time ./response-tracker.sh track "$PWD" < test-input.json

# Verify detached process
ps aux | grep analyze-transcript.sh

# Check logs
tail -f /tmp/claude-analysis-*.log
```

### Phase 4: Output Integration

**File**: `.claude/statusline.sh` (modifications)

**Changes**:

1. Enhance `get_session_topic()` to check analytics directory:
```bash
# Check for JSON analytics file first
local analytics_file="${cache_dir}/${session_id}_topic.json"
if [ -f "$analytics_file" ]; then
    # Extract topic with jq, fall back to legacy format
    local topic=$(jq -r '.suggested_summary // .primary_topic' "$analytics_file" 2>/dev/null)
    if [ -n "$topic" ] && [ "$topic" != "null" ]; then
        printf "${MAGENTA}%s${RESET}" "$topic"
        return
    fi
fi

# Fall back to legacy topic file...
```

2. Optional: Add analytics indicator (if full analytics available):
```bash
# Show indicator when rich analytics available
if [ -f "${cache_dir}/${session_id}_analytics.json" ]; then
    printf " ${BLUE}📊${RESET}"
fi
```

**Success Criteria**:
- Statusline displays LLM-generated topics when available
- Falls back gracefully to legacy topic files
- No performance degradation (file reads cached)

### Phase 5: Configuration & Documentation

**1. Update `.claudeignore`**
```
# Existing entries...
hooks/reminders/tmp/
hooks/reminders/analytics/  # ADD THIS
```

**2. Create `.claude/hooks/reminders/analytics/README.md`**
```markdown
# Analytics Output Directory

This directory contains LLM-generated analysis of conversation transcripts.

## File Format

- `{session_id}_topic.json`: Topic detection results
- `{session_id}_analytics.json`: Full analytics (if enabled)

## Retention

Files are not automatically cleaned up. To remove old analytics:

```bash
find ~/.claude/hooks/reminders/analytics -name "*.json" -mtime +30 -delete
```
```

**3. Update project `CLAUDE.md`**
- Document analysis system
- Explain configuration variables
- Provide troubleshooting guide

### Phase 6: Testing & Validation

**1. Unit Tests** (`tests/test-analyze-transcript.sh`)
```bash
#!/bin/bash
# Test suite for analyze-transcript.sh

test_isolation() {
    # Verify no hooks fire during analysis
}

test_json_output() {
    # Validate JSON schema
}

test_error_handling() {
    # Test failure modes
}
```

**2. Integration Tests** (`tests/test-llm-analysis-integration.sh`)
```bash
#!/bin/bash
# End-to-end test: hook → analysis → statusline

test_detached_launch() {
    # Verify hook doesn't block
}

test_output_consumption() {
    # Verify statusline reads results
}
```

**3. Performance Tests**
```bash
# Measure hook overhead
time ./response-tracker.sh track "$PWD" < test-input.json

# Should be <50ms even with analysis enabled

# Measure analysis completion time
time ./analyze-transcript.sh ... "topic-only" ...
# Should be <5s for topic-only
```

**4. Isolation Tests**
```bash
# Verify no recursive hooks
CLAUDE_ANALYSIS_MODE=topic-only ./response-tracker.sh track "$PWD" < test-input.json

# Check analysis logs - should show no hook events
grep -i "hook" /tmp/claude-analysis-*.log
```

### Phase 7: Deployment

**1. Deploy to Project Scope** (for testing)
```bash
cd /home/scott/projects/claude-config
# All files already in .claude/
# Test in isolated project environment
```

**2. Add to Setup Script** (`scripts/setup-reminders.sh`)
```bash
# Add permissions for analyze-transcript.sh
chmod +x "$HOOK_DIR/analyze-transcript.sh"

# Create analytics directory
mkdir -p "$HOOK_DIR/analytics"
```

**3. Deploy to User Scope** (after validation)
```bash
./scripts/push-to-claude.sh
# Syncs to ~/.claude/
```

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ANALYSIS_ENABLED` | `true` | Enable/disable LLM analysis |
| `CLAUDE_ANALYSIS_MODE` | `topic-only` | Analysis mode: topic-only\|incremental\|full-analytics |
| `CLAUDE_ANALYSIS_CADENCE` | `3` | Analyze every N responses |
| `CLAUDE_ANALYSIS_MODEL` | `haiku-4.5` | Model to use: haiku-4.5\|haiku-3.5\|haiku-3 |

### Cost Estimates

**Topic-only mode** (default):
- Frequency: Every 3 responses
- Input: ~500-1000 tokens (last few messages)
- Output: ~100 tokens (JSON)
- Cost per analysis: ~$0.001-0.002
- Cost per 100-response conversation: ~$0.03-0.07

**Incremental mode**:
- Input: ~2000-5000 tokens
- Output: ~200 tokens
- Cost per analysis: ~$0.003-0.008
- Cost per 100-response conversation: ~$0.10-0.27

**Full analytics mode**:
- Input: 10K-50K+ tokens (full transcript)
- Output: ~500 tokens
- Cost per analysis: ~$0.015-0.075
- Use sparingly (conversation end only)

## Troubleshooting

### Analysis Not Running

```bash
# Check if enabled
echo $CLAUDE_ANALYSIS_ENABLED

# Check logs
tail -f /tmp/claude-analysis-*.log

# Verify hook permissions
ls -la ~/.claude/hooks/reminders/analyze-transcript.sh
```

### Recursive Hooks Detected

```bash
# Check workspace isolation
grep "hooks" /tmp/claude-analysis-workspace-*/settings.json
# Should show: "hooks": {}

# Verify process isolation
ps aux | grep claude
# Should show separate process IDs
```

### JSON Parse Errors

```bash
# Validate output files
jq . ~/.claude/hooks/reminders/analytics/*_topic.json

# Check model output in logs
grep "claude -p" /tmp/claude-analysis-*.log -A 20
```

### Performance Issues

```bash
# Measure hook time
time ./response-tracker.sh track "$PWD" < test.json

# Measure analysis time
time ./analyze-transcript.sh ... "topic-only" ...

# Check system load
top  # Look for runaway claude processes
```

## Future Enhancements

### Phase 8+ (Optional)

1. **Conversation Summaries**: Generate end-of-session summaries
2. **Trend Analysis**: Track topics/patterns across multiple conversations
3. **Quality Metrics**: Measure conversation effectiveness, code quality
4. **MCP Memory Integration**: Feed insights to memory server for cross-session context
5. **Cleanup Automation**: Cron job to archive/delete old analytics
6. **Web Dashboard**: Visualize conversation analytics over time
7. **Custom Prompts**: User-defined analysis templates
8. **Multi-Model Support**: A/B test different models for analysis quality

## Success Metrics

### Technical Metrics
- ✅ Hook completion time: <50ms (target: <10ms)
- ✅ Topic detection time: <5s (target: <3s)
- ✅ Zero recursive hook invocations
- ✅ JSON parse success rate: >99%
- ✅ Cost per conversation: <$0.10 (topic-only mode)

### User Experience Metrics
- ✅ Statusline displays accurate topics
- ✅ No perceptible latency in conversation
- ✅ Topics reflect actual conversation content
- ✅ Snarky comments provide entertainment value

### Reliability Metrics
- ✅ No zombie processes
- ✅ Graceful degradation on failures
- ✅ Comprehensive error logging
- ✅ Backward compatibility maintained

## Rollback Plan

If issues arise:

1. **Disable Analysis**: `export CLAUDE_ANALYSIS_ENABLED=false`
2. **Revert Hook Changes**: Restore `response-tracker.sh` from git
3. **Remove Files**: Delete `.claude/hooks/reminders/analyze-transcript.sh`
4. **Clear State**: `rm -rf ~/.claude/hooks/reminders/analytics/`

Existing topic detection (via prompt-based reminders) continues working.

## Timeline Estimate

- **Phase 1** (Core Script): 2-3 hours
- **Phase 2** (Templates): 1 hour
- **Phase 3** (Hook Integration): 1-2 hours
- **Phase 4** (Statusline): 30 minutes
- **Phase 5** (Documentation): 1 hour
- **Phase 6** (Testing): 2-3 hours
- **Phase 7** (Deployment): 30 minutes

**Total**: ~8-11 hours for complete implementation and validation

## References

- Hook system: `.claude/hooks/reminders/response-tracker.sh`
- Statusline: `.claude/statusline.sh`
- Sync system: `scripts/push-to-claude.sh`
- Claude Code docs: https://docs.claude.com/en/docs/claude-code/hooks
- Haiku pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
