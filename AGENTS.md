# AGENTS.md

TypeScript developer for Claude Code hooks system (Sidekick).

<constraints>
<!-- PRESERVE: project-specific constraints -->

- **No backward compat**: Single-user project, breaking changes allowed
- **Dual-scope**: Must work identically in `.claude/` and `~/.claude/`
- **Hook changes**: Require `claude --continue` restart
- **LLM tests**: Provider tests excluded from default runs (expensive API calls)
- **Cleanup**: Remove any temp files/scripts created during iteration
- **Mock isolation**: `vi.fn()` in `vi.mock()` factories needs explicit `.mockClear()` in `beforeEach` — `vi.restoreAllMocks()` won't clear them
</constraints>

<directives>

- **Architecture questions**: Cite `docs/ARCHITECTURE.md` or `docs/design/FOO.md`—don't guess
- **Verification**: Run `pnpm build && pnpm typecheck` before completion
</directives>

<structure>

```
packages/                  # See packages/AGENTS.md for monorepo details
assets/sidekick/defaults/  # YAML config defaults
assets/sidekick/personas/  # Character personality profiles (20 personas)
assets/sidekick/prompts/   # LLM prompt templates with persona interpolation
scripts/dev-sidekick/      # Development hook scripts (for dev-mode)
scripts/dev-mode.sh        # Wrapper for pnpm sidekick dev-mode
```
</structure>

<sidekick_invocation>
Sidekick's CLI *must* be invoked unsandboxed.

To invoke sidekick's CLI: `pnpm sidekick <command> [args]`
**NEVER use `npx`** — it pulls the published package instead of local code.

**Commands:** (add --json or --format=json for structured output, --format=table for ASCII tables)
- `persona list` - list the available persona ids
- `persona set {persona-id} --session-id={session-id}` - change that session's selected persona
- `persona clear --session-id={session-id}` - clear that session's selected persona
- `persona test {persona-id} --session-id={session-id} [--type=snarky|resume]` - test the "voice" of that session's selected persona
- `sessions` - list all tracked sessions (table format unless --format=json specified)
- `daemon start|stop|status|kill` - manage the background daemon
- `dev-mode enable|disable|status|clean|clean-all` - manage development hooks
- `ui` - launch the web monitoring UI
</sidekick_invocation>

<sandbox_testing>

IPC tests fail in Claude Code sandbox (Unix socket `EPERM`).

```bash
# Run @sidekick/core excluding IPC tests:
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'

# Full tests (user must run outside sandbox):
INTEGRATION_TESTS=1 pnpm test
```

**Dev-mode**: `pnpm sidekick dev-mode enable` or `scripts/dev-mode.sh enable` (requires `pnpm build`, restart Claude Code)
</sandbox_testing>

<debugging>

- **Logs are file-only** (not stdout). Check `.sidekick/*.log` directly — don't expect console output
- **pnpm timeouts**: pnpm commands can time out — account for this in test and debug workflows
- **Scope**: Search project-level configs/logs first (`.sidekick/`), not user-scope (`~/.sidekick/`), unless explicitly told otherwise
</debugging>

<plugin_testing>
<!-- PRESERVE: plugin testing workflow (outside dev-mode) -->

**Dev-mode vs Plugin Testing**:
- **Dev-mode** (`pnpm sidekick dev-mode enable`): Tests local builds in THIS project only
- **Plugin testing**: Tests the published npm package in OTHER projects

**To test in another project**, you MUST:
1. **Publish to npm first**: `cd packages/sidekick-dist && npm publish --access public --tag latest`
2. **Start Claude Code with plugin-dir**: `claude --plugin-dir=/path/to/claude-code-sidekick/packages/sidekick-plugin`

The plugin's `hooks.json` uses `npx @scotthamilton77/sidekick` which fetches from npm, NOT the local build.

**Version bump before publish**:
```bash
# Check current npm versions
npm view @scotthamilton77/sidekick versions

# Edit packages/sidekick-dist/package.json to increment version
# Then publish
cd packages/sidekick-dist
npm publish --access public --tag latest
```

See README.md "Testing Outside Dev-Mode" section for full instructions.
</plugin_testing>

<typescript_tooling>
<!-- PRESERVE: post-training-cutoff knowledge -->

**Versions**: eslint 9.39.1, typescript-eslint 8.48.0, typescript 5.9.3

**ESLint v9 Flat Config** (Claude trained on legacy `.eslintrc.*`):
- Config: `eslint.config.js` with `export default []`
- `extends` → `...tseslint.configs.recommended`
- `plugins` → object: `plugins: { '@typescript-eslint': tseslint }`
- `parser` → `languageOptions: { parser }`
- `parserOptions.project` → `languageOptions.parserOptions.projectService: true`
- `ignorePatterns` → `ignores: []` in dedicated config object
- `overrides` → separate config objects with `files: []` property
- Root `package.json` requires `"type": "module"` for ESM config

**v7 → v8 Breaking Changes**:

| v7 | v8 |
|----|----------------|
| `ban-types` | `no-restricted-types`, `no-empty-object-type`, `no-unsafe-function-type`, `no-wrapper-object-types` |
| `no-throw-literal` | `only-throw-error` |
| `no-var-requires` | `no-require-imports` |
| `no-useless-template-literals` | `no-unnecessary-template-expression` |
| `prefer-ts-expect-error` | `ban-ts-comment` |
| `EXPERIMENTAL_useProjectService` | `projectService` |
| `automaticSingleRunInference` | `disallowAutomaticSingleRunInference` (opt-out) |
| `node.typeParameter.constraint/name` | `node.constraint` / `node.key` |
| `node.members` | `node.body.members` (enum AST) |
| Min TS >=4.7.4, ESLint ^8.56.0 | >=4.8.4, ^8.57.0 |

**New Rules (post-Jan 2025)**: `no-misused-spread` (v8.20), `no-unnecessary-type-conversion` (v8.32), `no-unused-private-class-members` (v8.47)

**Behavior Changes**: `prefer-nullish-coalescing` ignores conditional tests; dot-directories matched by default in `parserOptions.project` globs
</typescript_tooling>

<vitest_upgrade>
<!-- PRESERVE: vitest 4.x upgrade context and migration notes -->

**Versions**: vitest 4.0.18, vite 6.x, esbuild 0.27.3

**Why we upgraded**: Security vulnerability GHSA-67mh-4wv8-2f99 in esbuild <0.27.3 (bundled with vite 5.x). Required upgrading:
- vite 5.x → 6.x (to get patched esbuild)
- vitest 2.x → 4.x (hard dependency on vite 6.x)

**Vitest 2.x → 4.x Breaking Changes**:

1. **Constructor mocking**: `vi.fn()` and `vi.spyOn()` now return `Mock<Procedure | Constructable>` instead of simple function type
   - Arrow functions **cannot** be used as constructor mocks
   - Use `function` keyword or `class` keyword for constructors

   ```typescript
   // ❌ BROKEN in vitest 4.x
   vi.mock('openai', () => ({
     default: vi.fn().mockImplementation(() => ({ /* mock */ }))  // Arrow function!
   }))

   // ✅ WORKS in vitest 4.x
   vi.mock('openai', () => ({
     default: vi.fn().mockImplementation(function() {  // function keyword
       return { /* mock */ }
     })
   }))
   ```

2. **Mock type compatibility**: `vi.fn()` results must be cast when assigned to typed interfaces
   ```typescript
   // ❌ Type error in vitest 4.x
   const mockLogger: Logger = {
     trace: vi.fn(),
     debug: vi.fn(),
     // ... Mock<Procedure | Constructable> not assignable to (msg: string) => void
   }

   // ✅ Cast to bypass type checking
   const mockLogger: Logger = {
     trace: vi.fn() as any,
     debug: vi.fn() as any,
     // ... or use a helper function that returns 'any'
   }
   ```

**Do NOT use `@ts-nocheck` in test files**. Instead:
- Use `function` keyword (not arrow functions) for constructor mocks
- Cast `vi.fn()` results with `as any` when needed for type compatibility
- Use `Logger` from `@sidekick/types` as return type for `createFakeLogger()` helpers
</vitest_upgrade>

<lessons_learned>

</lessons_learned>