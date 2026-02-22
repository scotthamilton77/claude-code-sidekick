# Config Audit: Defaults + Security

## Goal

Audit all configuration settings for production readiness before 1.0 release. Two dimensions:

1. **Defaults** — Every default value is sane for first-time users. No foot-guns, no confusion.
2. **Security** — API keys and secrets cannot leak to git, logs, or stdout.

## Scope

### Dimension 1: Defaults

Review every setting across:
- 7 YAML default files (`assets/sidekick/defaults/`)
- Hardcoded constants (`structured-logging.ts`, `logger.ts`)
- Setup-status defaults (`setup-status.ts`)

For each setting:
- Is the default reasonable for a first-time user?
- Does it work out-of-the-box without extra config?
- Any surprising semantics (e.g., `0` meaning "unlimited")?
- Any values that could cause excessive cost, noise, or confusion?

### Dimension 2: Security

- `.env` files gitignored at both user and project scope?
- `DEFAULT_REDACT_KEYS` list covers all sensitive field names?
- `setup-status.json` stores health status strings, never raw keys?
- No code path leaks keys to console or log files?
- `.gitignore` templates written by setup cover all sensitive paths?
- `consoleEnabled: false` default not overridable without explicit action?

## Deliverable

Findings list with severity tags:
- **CRITICAL**: Must fix before release (security holes, data loss risks)
- **WARNING**: Should fix (confusing defaults, mild foot-guns)
- **INFO**: Noted but acceptable (minor UX improvements, post-1.0)

Beads created for any critical/warning findings that need code changes.

## Out of Scope

- Zod schema validation correctness
- Config cascade merge behavior
- Integration/E2E testing of config loading
