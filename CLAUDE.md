# CLAUDE.md

## Role

Bash expert for dual-scope Claude Code hooks system (Sidekick). Experimental project—no backward compatibility required.

## Constraints [PRESERVE]

- **No backward compatibility**: Single-user project, breaking changes allowed
- **Dual-scope testing**: Every script must work identically in `.claude/` and `~/.claude/` contexts
- **Install/uninstall authorization**: Abort unless user message contains exact word "install" or "uninstall"
- **Timestamp preservation**: Use `rsync -a`, never `cp`, for file sync (critical for `./scripts/sync-to-user.sh`)
- **Plugin architecture boundary**: New features → `src/sidekick/features/<name>.sh` only. NEVER edit `handlers/*.sh`
- **Restart requirement**: All hook changes require `claude --continue` restart to take effect
- **Test isolation**: LLM provider tests (`test-llm-providers.sh`) intentionally excluded from default runs (expensive API calls)

## Critical Directives

- **Questions about architecture/design**: Cite `ARCH.md:<section>` instead of guessing
- **Plugin creation**: (1) Create `src/sidekick/features/<name>.sh`, (2) Add `FEATURE_<NAME>=true` to `config.defaults`, (3) Test, (4) Install project (with permission), (5) Verify session
- **Config system**: 4 modular domains (config, llm-core, llm-providers, features) + `sidekick.conf` override. See `src/sidekick/*.defaults` for all options
- **Path resolution**: Use `src/sidekick/lib/common.sh` path helpers for dual-scope compatibility
- **LLM debugging**: Enable `LLM_DEBUG_DUMP_ENABLED=true` → saves payloads to `/tmp/sidekick-llm-debug/`

## Project Structure (Action Paths)

```
src/sidekick/          # Source (edit here)
├── features/*.sh      # Plugins (add new features here)
├── handlers/*.sh      # Framework (never edit)
├── lib/*.sh           # Shared libraries (edit for infra changes)
└── *.defaults         # Config domains (4 files)

.claude/hooks/sidekick/    # Project deployment (ephemeral)
~/.claude/hooks/sidekick/  # User deployment (ephemeral)
.sidekick/*.conf           # Project persistent (git-committable - but note this project specifically .gitignored)
~/.sidekick/*.conf         # User persistent (survives installs)

scripts/
├── install.sh                      # Deploy to --user, --project, or --both
├── analyze-topic-at-line.sh        # Surgical session summary (debug tool)
├── replay-session-summary.sh       # Session summary simulator (debug tool)
├── tests/                          # run-unit-tests.sh (mocked, free)
└── benchmark/                      # LLM benchmarking code (legacy, being rewritten in another branch)

benchmark-next/        # TypeScript rewrite (see child CLAUDE.md)
test-data/
├── projects/          # Test transcripts
├── replay-results/    # Replay simulation output (gitignored)
└── topic-analysis/    # Surgical extraction output (gitignored)
```

## Development Checklist

**New plugin (zero handler edits)**:

1. `src/sidekick/features/<name>.sh` with `<name>_on_<event>()` functions
2. `FEATURE_<NAME>=true` in `config.defaults`
3. `./scripts/tests/run-unit-tests.sh`
4. `./scripts/install.sh --project && claude --continue`
5. Test in real session
6. `./scripts/install.sh --user && claude --continue`

**Config override**:

- Modular: Create `.sidekick/llm-providers.conf` (domain-specific)
- Simple: Create `.sidekick/sidekick.conf` (overrides all domains)
- API keys: `.env` files (never commit `~/.sidekick/.env`)

**Dual-scope verification**:

```bash
./scripts/install.sh --both
# Test in project context
cd /workspaces/claude-config && .claude/hooks/sidekick/sidekick.sh <cmd>
# Test in user context (outside project)
cd /tmp && ~/.claude/hooks/sidekick/sidekick.sh <cmd>
```

**Session summary debugging**:

```bash
# Surgical analysis - extract summary at specific line
./scripts/analyze-topic-at-line.sh <session-id> --to-line 100

# Outputs: 0100-transcript.jsonl, 0100-filtered.jsonl, 0100-prompt.txt, 0100-topic.json
# Use to inspect exact LLM input and validate filtering logic

# Replay simulation - observe summary evolution over time
./scripts/replay-session-summary.sh <session-id> --min-size-change 500
```

## Reference Docs (For Questions)

- **ARCH.md**: Complete design (plugin system, LLM providers, cascade logic)
- **PLAN.md**: Implementation status (Phase 5.3: manual testing)
- **README.md**: User guide (installation, configuration, troubleshooting)

## Tech Stack

- **Sidekick**: Bash 4.4+, jq 1.6+, 9 namespace libs, pluggable LLM providers
- **Tests**: Mocked unit (free), integration (free), LLM provider (expensive, opt-in)
