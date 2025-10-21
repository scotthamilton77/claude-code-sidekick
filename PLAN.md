# Sidekick Implementation Plan

Implementation checklist for refactoring the reminders hooks into the Sidekick architecture.

**KEY REFERENCE:** ARCH.md

## Phase 1: Infrastructure Setup

### 1.1 Create Directory Structure
- [ ] Create `src/sidekick/` directory
- [ ] Create `src/sidekick/lib/` directory
- [ ] Create `src/sidekick/handlers/` directory
- [ ] Create `src/sidekick/features/` directory
- [ ] Create `src/sidekick/features/prompts/` directory
- [ ] Create `scripts/tests/unit/` directory
- [ ] Create `scripts/tests/integration/` directory

### 1.2 Implement Shared Library (lib/common.sh)
- [ ] Create `lib/common.sh` with file header and double-source guard
- [ ] Implement LOGGING namespace:
  - [ ] `log_init()` - Initialize session-specific log file
  - [ ] `log_debug()` - Debug level logging
  - [ ] `log_info()` - Info level logging
  - [ ] `log_warn()` - Warning level logging
  - [ ] `log_error()` - Error level logging
  - [ ] `_log_to_file()` - Internal file writer
  - [ ] `_log_format_ansi()` - Internal ANSI formatter
- [ ] Implement CONFIGURATION namespace:
  - [ ] `config_load()` - Load config cascade
  - [ ] `config_get()` - Get config value
  - [ ] `config_is_feature_enabled()` - Check feature toggle
  - [ ] `_config_validate()` - Validate configuration
- [ ] Implement PATH RESOLUTION namespace:
  - [ ] `path_detect_scope()` - Detect user vs project scope
  - [ ] `path_get_sidekick_root()` - Get installation directory
  - [ ] `path_get_session_dir()` - Get session-specific directory
  - [ ] `path_get_project_dir()` - Extract project directory
  - [ ] `_path_normalize()` - Normalize path
- [ ] Implement JSON PROCESSING namespace:
  - [ ] `json_get()` - Generic jq wrapper
  - [ ] `json_get_session_id()` - Extract session_id
  - [ ] `json_get_transcript_path()` - Extract transcript_path
  - [ ] `json_validate()` - Validate JSON syntax
  - [ ] `json_extract_from_markdown()` - Extract JSON from markdown
- [ ] Implement PROCESS MANAGEMENT namespace:
  - [ ] `process_launch_background()` - Launch background process with PID
  - [ ] `process_is_running()` - Check if PID is alive
  - [ ] `process_kill()` - Kill process by PID file
  - [ ] `process_cleanup_stale_pids()` - Clean stale PID files
- [ ] Implement CLAUDE INVOCATION namespace:
  - [ ] `claude_find_bin()` - Locate Claude CLI binary
  - [ ] `claude_invoke()` - Invoke Claude with isolation
  - [ ] `claude_extract_json()` - Extract JSON from output
- [ ] Implement WORKSPACE MANAGEMENT namespace:
  - [ ] `workspace_create()` - Create isolated workspace
  - [ ] `workspace_cleanup()` - Remove workspace
- [ ] Implement UTILITIES namespace:
  - [ ] `util_validate_count()` - Validate integer
  - [ ] `util_get_file_size()` - Cross-platform file size
  - [ ] `util_create_session_dir()` - Create session directory
  - [ ] `util_calculate_tokens()` - Estimate tokens from transcript
- [ ] Add ANSI color constants (readonly globals)
- [ ] Add error trap for debugging

### 1.3 Create Configuration Defaults
- [ ] Create `config.defaults` with all feature toggles
- [ ] Add topic extraction configuration
- [ ] Add sleeper configuration
- [ ] Add resume configuration
- [ ] Add statusline configuration
- [ ] Add tracking configuration
- [ ] Add cleanup configuration
- [ ] Add global configuration (LOG_LEVEL, CLAUDE_BIN)
- [ ] Add inline documentation for each setting

### 1.4 Implement Main Entry Point (sidekick.sh)
- [ ] Create `sidekick.sh` with shebang and strict mode
- [ ] Source `lib/common.sh`
- [ ] Implement command-line argument parsing
- [ ] Call `config_load()` to initialize configuration
- [ ] Read stdin JSON for hook events
- [ ] Extract session_id and project_dir
- [ ] Call `log_init()` to set up logging
- [ ] Implement command routing logic:
  - [ ] `session-start` → source handler, call `handler_session_start()`
  - [ ] `user-prompt-submit` → source handler, call `handler_user_prompt_submit()`
  - [ ] `statusline` → source feature, call `feature_statusline_render()`
- [ ] Implement error handling and exit codes
- [ ] Add usage/help output

## Phase 2: Handlers Implementation

### 2.1 Implement session-start Handler
- [ ] Create `handlers/session-start.sh`
- [ ] Define `handler_session_start()` function
- [ ] Source required features (tracking, cleanup, resume)
- [ ] Create session directory
- [ ] Initialize tracking counter (if enabled)
- [ ] Launch cleanup in background (if enabled)
- [ ] Generate resume topic (if enabled)
- [ ] Add error handling for each step

### 2.2 Implement user-prompt-submit Handler
- [ ] Create `handlers/user-prompt-submit.sh`
- [ ] Define `handler_user_prompt_submit()` function
- [ ] Source required features (tracking, topic-extraction)
- [ ] Increment tracking counter
- [ ] Launch sleeper on first call (if enabled)
- [ ] Check cadence-based analysis (if enabled)
- [ ] Check static reminder cadence
- [ ] Output hook JSON if reminder due
- [ ] Add error handling for each step

## Phase 3: Features Implementation

### 3.1 Implement Tracking Feature
- [ ] Create `features/tracking.sh`
- [ ] Define `tracking_init()` - Initialize counter file
- [ ] Define `tracking_increment()` - Increment and return count
- [ ] Define `tracking_get()` - Read current count
- [ ] Define `tracking_check_reminder()` - Check static reminder cadence
- [ ] Implement static reminder file loading (user + project cascade)

### 3.2 Implement Topic Extraction Feature
- [ ] Create `features/topic-extraction.sh`
- [ ] Copy prompt templates to `features/prompts/`:
  - [ ] `topic-only.txt`
  - [ ] `incremental.txt`
  - [ ] `full-analytics.txt`
- [ ] Define `topic_extraction_analyze()`:
  - [ ] Pre-process transcript (extract message objects)
  - [ ] Extract transcript excerpt based on mode
  - [ ] Load prompt template
  - [ ] Substitute transcript into prompt
  - [ ] Invoke Claude using `claude_invoke()`
  - [ ] Parse JSON output
  - [ ] Write topic.json file
  - [ ] Write analytics.json (if full mode)
  - [ ] Error handling and logging
- [ ] Define `topic_extraction_sleeper_start()`:
  - [ ] Check for existing sleeper PID
  - [ ] Launch background process via `process_launch_background()`
- [ ] Define `topic_extraction_sleeper_loop()`:
  - [ ] Initialize state tracking (last_size, last_analysis_time)
  - [ ] Implement polling loop with adaptive intervals
  - [ ] Check transcript size delta
  - [ ] Call `topic_extraction_analyze()` when threshold met
  - [ ] Check clarity score and exit if threshold met
  - [ ] Exit after max duration
  - [ ] Cleanup PID file on exit
- [ ] Define `topic_extraction_check_cadence()`:
  - [ ] Get current clarity score from topic.json
  - [ ] Determine cadence based on clarity threshold
  - [ ] Launch analysis if due
- [ ] Define `topic_extraction_get_clarity()` - Extract clarity from topic.json

### 3.3 Implement Resume Feature
- [ ] Create `features/resume.sh`
- [ ] Copy prompt template to `features/prompts/new-session-topic.txt`
- [ ] Define `resume_snarkify()`:
  - [ ] Find most recent topic file with clarity > threshold
  - [ ] Load prompt template
  - [ ] Substitute previous topic into prompt
  - [ ] Invoke Claude using `claude_invoke()`
  - [ ] Extract initial_goal, current_objective, snarky_comment
  - [ ] Write topic.json with resume fields
  - [ ] Error handling with fallback values
  - [ ] Skip if current session already has topic

### 3.4 Implement Statusline Feature
- [ ] Create `features/statusline.sh`
- [ ] Define `feature_statusline_render()`:
  - [ ] Parse stdin JSON (model, session_id, cost, duration, etc.)
  - [ ] Calculate tokens from transcript
  - [ ] Calculate percentage of threshold
  - [ ] Format cost with colors
  - [ ] Format duration with colors
  - [ ] Format tokens with colors
  - [ ] Extract session topic from topic.json
  - [ ] Format git branch (if in repo)
  - [ ] Assemble final statusline string
  - [ ] Output to stdout
- [ ] Define `_statusline_format_cost()` - Format cost helper
- [ ] Define `_statusline_format_duration()` - Format duration helper
- [ ] Define `_statusline_format_tokens()` - Format tokens helper
- [ ] Define `_statusline_get_topic()` - Extract topic from analytics

### 3.5 Implement Cleanup Feature
- [ ] Create `features/cleanup.sh`
- [ ] Define `cleanup_launch()`:
  - [ ] Launch background process via `process_launch_background()`
- [ ] Define `cleanup_run()`:
  - [ ] Check if cleanup enabled
  - [ ] Find all session directories matching UUID pattern
  - [ ] Calculate age for each session (newest file in directory)
  - [ ] Filter sessions older than age threshold
  - [ ] Check if old count exceeds minimum threshold
  - [ ] Sort old sessions by age (oldest first)
  - [ ] Remove oldest sessions to reach threshold
  - [ ] Dry-run mode support
  - [ ] Safety checks (path validation)
  - [ ] Logging for each deletion

## Phase 4: Installation Scripts

### 4.1 Implement Install Script
- [ ] Create `scripts/install.sh`
- [ ] Implement argument parsing:
  - [ ] `--user` - Install to ~/.claude only
  - [ ] `--project` - Install to project .claude only
  - [ ] `--both` - Install to both (default)
  - [ ] `--features <list>` - Install specific features only
- [ ] Implement `install_to_user()`:
  - [ ] Create `~/.claude/hooks/sidekick/` directory
  - [ ] Copy `sidekick.sh`
  - [ ] Copy `lib/` directory
  - [ ] Copy `handlers/` directory
  - [ ] Copy `features/` directory (or selected features)
  - [ ] Create `tmp/` directory
  - [ ] Copy `config.defaults` → `sidekick.conf` (if not exists)
  - [ ] Set executable permissions on .sh files
  - [ ] Register hooks in `~/.claude/settings.json`
- [ ] Implement `install_to_project()`:
  - [ ] Create `.claude/hooks/sidekick/` directory
  - [ ] Copy `sidekick.sh`
  - [ ] Copy `lib/` directory
  - [ ] Copy `handlers/` directory
  - [ ] Copy `features/` directory (or selected features)
  - [ ] Create `tmp/` directory
  - [ ] Copy `config.defaults` → `sidekick.conf` (if not exists)
  - [ ] Set executable permissions on .sh files
  - [ ] Register hooks in `.claude/settings.json` or `.claude/settings.local.json`
  - [ ] Update `.claudeignore` with `hooks/sidekick/tmp/`
- [ ] Implement `register_hooks_in_settings()`:
  - [ ] Read current settings.json
  - [ ] Add SessionStart hook command
  - [ ] Add UserPromptSubmit hook command
  - [ ] Add statusLine command
  - [ ] Write updated settings.json
  - [ ] Backup original settings.json
- [ ] Add colored output and progress indicators
- [ ] Add error handling and rollback on failure

### 4.2 Implement Uninstall Script
- [ ] Create `scripts/uninstall.sh`
- [ ] Implement argument parsing (--user|--project|--both)
- [ ] Implement `uninstall_from_user()`:
  - [ ] Remove hook commands from `~/.claude/settings.json`
  - [ ] Remove `~/.claude/hooks/sidekick/` directory
  - [ ] Preserve tmp/ if contains recent sessions (prompt user)
- [ ] Implement `uninstall_from_project()`:
  - [ ] Remove hook commands from `.claude/settings.json`
  - [ ] Remove `.claude/hooks/sidekick/` directory
  - [ ] Preserve tmp/ if contains recent sessions (prompt user)
  - [ ] Remove `.claudeignore` entry
- [ ] Add confirmation prompts
- [ ] Add colored output

### 4.3 Implement Sync Script
- [ ] Create `scripts/sync-to-user.sh`
- [ ] Copy `.claude/hooks/sidekick/` → `~/.claude/hooks/sidekick/`
- [ ] Preserve `sidekick.conf` (don't overwrite)
- [ ] Preserve `tmp/` (don't sync)
- [ ] Update hooks in `~/.claude/settings.json`
- [ ] Add colored output

## Phase 5: Testing

### 5.1 Unit Tests
- [ ] Create `scripts/tests/unit/test-logging.sh`
  - [ ] Test `log_debug()` respects LOG_LEVEL
  - [ ] Test `log_info()` outputs correctly
  - [ ] Test `log_warn()` formats correctly
  - [ ] Test `log_error()` formats correctly
- [ ] Create `scripts/tests/unit/test-config.sh`
  - [ ] Test `config_load()` cascade (defaults → user → project)
  - [ ] Test `config_get()` returns correct values
  - [ ] Test `config_is_feature_enabled()` boolean logic
- [ ] Create `scripts/tests/unit/test-paths.sh`
  - [ ] Test `path_detect_scope()` user vs project
  - [ ] Test `path_get_sidekick_root()` resolution
  - [ ] Test `path_get_session_dir()` creation
- [ ] Create `scripts/tests/unit/test-json.sh`
  - [ ] Test `json_get()` extraction
  - [ ] Test `json_get_session_id()` extraction
  - [ ] Test `json_validate()` validation
  - [ ] Test `json_extract_from_markdown()` parsing
- [ ] Create `scripts/tests/unit/test-process.sh`
  - [ ] Test `process_launch_background()` PID creation
  - [ ] Test `process_is_running()` detection
  - [ ] Test `process_cleanup_stale_pids()` cleanup
- [ ] Create `scripts/tests/unit/test-claude.sh`
  - [ ] Test `claude_find_bin()` with mocked paths
  - [ ] Test `claude_invoke()` with mocked binary
  - [ ] Test `claude_extract_json()` parsing
- [ ] Create `scripts/tests/unit/test-workspace.sh`
  - [ ] Test `workspace_create()` isolation
  - [ ] Test `workspace_cleanup()` removal
- [ ] Create test runner script: `scripts/tests/run-unit-tests.sh`

### 5.2 Integration Tests
- [ ] Create `scripts/tests/integration/test-session-start.sh`
  - [ ] Mock Claude CLI
  - [ ] Trigger session-start with test JSON
  - [ ] Verify counter file created
  - [ ] Verify topic.json created (resume)
  - [ ] Verify cleanup launched in background
- [ ] Create `scripts/tests/integration/test-user-prompt-submit.sh`
  - [ ] Mock Claude CLI
  - [ ] Trigger user-prompt-submit 10 times
  - [ ] Verify counter increments correctly
  - [ ] Verify sleeper launched on first call
  - [ ] Verify cadence-based analysis
  - [ ] Verify static reminder output
- [ ] Create `scripts/tests/integration/test-statusline.sh`
  - [ ] Create mock topic.json
  - [ ] Trigger statusline with test JSON
  - [ ] Verify formatted output
- [ ] Create `scripts/tests/integration/test-feature-toggles.sh`
  - [ ] Disable each feature in config
  - [ ] Verify feature skipped
  - [ ] Re-enable and verify feature runs
- [ ] Create `scripts/tests/integration/test-config-cascade.sh`
  - [ ] Create user config override
  - [ ] Create project config override
  - [ ] Verify project overrides user overrides defaults
- [ ] Create `scripts/tests/integration/test-install.sh`
  - [ ] Run install.sh --user in temp directory
  - [ ] Verify files copied
  - [ ] Verify settings.json updated
  - [ ] Run uninstall.sh --user
  - [ ] Verify cleanup
- [ ] Create test runner script: `scripts/tests/run-integration-tests.sh`

### 5.3 Manual Testing Checklist
- [ ] Install to user scope (`./scripts/install.sh --user`)
  - [ ] Verify files exist in `~/.claude/hooks/sidekick/`
  - [ ] Verify `~/.claude/settings.json` has hooks registered
- [ ] Start new Claude session in test project
  - [ ] Verify SessionStart hook fires (check logs)
  - [ ] Verify `tmp/${session_id}/response_count` created
  - [ ] Verify resume topic generated (if previous session exists)
- [ ] Submit 10 user prompts
  - [ ] Verify counter increments (check `response_count`)
  - [ ] Verify sleeper launched (check `sleeper.pid`)
  - [ ] Verify topic analysis runs (check `topic.json`)
  - [ ] Verify static reminder appears on 4th, 8th prompts
- [ ] Check statusline
  - [ ] Verify displays model, tokens, percentage, directory, git branch
  - [ ] Verify topic displayed (from topic.json)
  - [ ] Verify snarky comment displayed
- [ ] Test feature toggles
  - [ ] Edit `sidekick.conf`, set `FEATURE_TOPIC_EXTRACTION=false`
  - [ ] Submit prompts, verify no analysis runs
  - [ ] Re-enable, verify analysis resumes
- [ ] Test configuration cascade
  - [ ] Edit `~/.claude/hooks/sidekick/sidekick.conf`, set `TOPIC_MODE=incremental`
  - [ ] Edit `.claude/hooks/sidekick/sidekick.conf`, set `TOPIC_MODE=full-analytics`
  - [ ] Verify project config wins (check logs for mode)
- [ ] Install to project scope (`./scripts/install.sh --project`)
  - [ ] Verify files exist in `.claude/hooks/sidekick/`
  - [ ] Verify `.claude/settings.json` has hooks registered
  - [ ] Verify `.claudeignore` has `hooks/sidekick/tmp/`
- [ ] Test dual-scope (user + project installed)
  - [ ] Verify project hooks fire (not user hooks)
  - [ ] Verify project config overrides user config
- [ ] Uninstall from user scope (`./scripts/uninstall.sh --user`)
  - [ ] Verify `~/.claude/hooks/sidekick/` removed
  - [ ] Verify hooks removed from settings.json
- [ ] Uninstall from project scope (`./scripts/uninstall.sh --project`)
  - [ ] Verify `.claude/hooks/sidekick/` removed
  - [ ] Verify hooks removed from settings.json

## Phase 6: Documentation & Migration

### 6.1 Update Documentation
- [ ] Update root `CLAUDE.md` with Sidekick architecture overview
- [ ] Update root `README.md` with:
  - [ ] Installation instructions
  - [ ] Configuration guide
  - [ ] Feature documentation
  - [ ] Troubleshooting section
- [ ] Create `MIGRATION.md` guide:
  - [ ] Reminders → Sidekick migration steps
  - [ ] Configuration translation table
  - [ ] Breaking changes list
- [ ] Add inline code documentation:
  - [ ] Function headers in `lib/common.sh`
  - [ ] Handler documentation
  - [ ] Feature documentation

### 6.2 Migrate from Reminders
- [ ] Install sidekick to project scope (`--project`)
- [ ] Test all features work in parallel with reminders
- [ ] Compare output (logs, topic files) for consistency
- [ ] Fix any discrepancies found
- [ ] Install sidekick to user scope (`--user`)
- [ ] Manually remove reminders hooks from settings.json
- [ ] Move `.claude/hooks/reminders/` → `.claude/hooks/reminders.backup/`
- [ ] Test with reminders removed, verify sidekick works
- [ ] Delete `.claude/hooks/reminders.backup/` after confidence period

### 6.3 Cleanup Old Code
- [ ] Move `.claude/hooks/reminders/deprecated/` to project root `deprecated/reminders/`
- [ ] Delete old `scripts/setup-reminders.sh`
- [ ] Delete old `scripts/cleanup-reminders.sh`
- [ ] Delete old `scripts/pull-from-claude.sh`
- [ ] Delete old `scripts/push-to-claude.sh`
- [ ] Delete old `scripts/sync-claude.sh`
- [ ] Update `.claudeignore` (remove old paths, add new)
- [ ] Update `LLM_PLAN.md` with deprecation notice

## Phase 7: Polish & Optimization

### 7.1 Performance Optimization
- [ ] Profile hook execution times (SessionStart, UserPromptSubmit)
- [ ] Optimize slow paths (if any exceed targets)
- [ ] Minimize disk I/O
- [ ] Optimize jq queries (use -r, avoid pipes)
- [ ] Test on large transcripts (>100KB)

### 7.2 Error Handling Improvements
- [ ] Add retry logic for LLM failures
- [ ] Add timeout handling for stuck processes
- [ ] Add disk space checks before writing
- [ ] Add graceful degradation for missing dependencies
- [ ] Test error scenarios:
  - [ ] jq not installed
  - [ ] Claude CLI not found
  - [ ] Transcript file missing
  - [ ] Invalid JSON input
  - [ ] Disk full
  - [ ] Permission denied

### 7.3 Logging Improvements
- [ ] Add log rotation (limit log file size)
- [ ] Add structured logging (JSON format option)
- [ ] Add DEBUG mode with full execution trace
- [ ] Add timing information to log entries
- [ ] Add log file consolidation script

### 7.4 User Experience
- [ ] Add colored output to install/uninstall scripts
- [ ] Add progress indicators for long operations
- [ ] Add helpful error messages with suggestions
- [ ] Add `--version` flag to sidekick.sh
- [ ] Add `--help` flag with examples
- [ ] Add configuration validation on install
- [ ] Add configuration wizard for initial setup

## Phase 8: Final Verification

### 8.1 Four Laws Compliance Check
- [ ] **Law 0 - Codebase Integrity**: Verify modular, DRY, SOLID architecture
- [ ] **Law 1 - No Harm**: Verify error handling prevents crashes, data loss
- [ ] **Law 2 - Follow Instructions**: Verify implements all specified features
- [ ] **Law 3 - Maintainability**: Verify clear documentation, testable code

### 8.2 Pre-Release Checklist
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Manual testing complete
- [ ] Documentation complete and accurate
- [ ] Performance targets met (hook times <100ms)
- [ ] No TODO/FIXME comments in production code
- [ ] All files have proper headers and licensing
- [ ] ARCH.md and PLAN.md accurate and complete

### 8.3 Deployment
- [ ] Tag release version (e.g., v1.0.0-sidekick)
- [ ] Create release notes
- [ ] Install to user scope on primary development machine
- [ ] Monitor for issues over 1 week
- [ ] Address any issues found
- [ ] Mark migration complete

## Success Criteria

- ✅ All features from reminders ported to sidekick
- ✅ No duplicated code across scripts
- ✅ Single `lib/common.sh` loaded once per hook invocation
- ✅ All features independently toggleable via config
- ✅ Configuration cascade working (project > user > defaults)
- ✅ Installation scripts work for user, project, and both scopes
- ✅ All tests passing (unit + integration)
- ✅ Hook execution times meet performance targets
- ✅ Documentation complete and accurate
- ✅ Successfully migrated from reminders on development machine
