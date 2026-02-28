# Config CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `sidekick config get/set/unset/list` CLI commands that provide validated, comment-preserving config manipulation.

**Architecture:** New `config-writer.ts` module in `@sidekick/core` handles all read/write logic (dot-path resolution, YAML parseDocument for comment preservation, Zod schema validation, file seeding from defaults). Thin CLI handler in `@sidekick/cli` routes subcommands, parses flags, and formats output. Config validation is done by applying changes to the full cascade and validating the merged result against `SidekickConfigSchema`.

**Tech Stack:** TypeScript, `yaml` package (parseDocument API for comment-preserving writes), Zod v4, yargs-parser, vitest.

**Reference:** Design spec at `docs/plans/2026-02-28-skill-split-config-cli-design.md` (Component 3).

---

### Task 1: Export config internals needed by config-writer

**Files:**
- Modify: `packages/sidekick-core/src/config.ts`

The config-writer module needs access to domain mappings, value coercion, and YAML reading utilities that are currently internal to `config.ts`. Export them without changing behavior.

**Step 1: Add `export` to internal constants and functions**

In `config.ts`, add `export` keyword to these declarations:

```typescript
// Line 74 — change `const` to `export const`
export const DOMAIN_FILES: Record<ConfigDomain, string> = { ... }

// Line 493 — change `const` to `export const`
export const EXTERNAL_DEFAULTS_FILES: Record<ConfigDomain, string> = { ... }

// Line 302 — add `export`
export function deepMerge<T extends Record<string, unknown>>(...)

// Line 330 — add `export`
export function coerceValue(raw: string): unknown { ... }

// Line 359 — add `export`
export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void { ... }

// Line 379 — add `export`
export function tryReadYaml(filePath: string): Record<string, unknown> | null { ... }
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: SUCCESS — all exports are additive, no breaking changes.

**Step 3: Commit**

```
chore(config): export internal utilities for config-writer reuse
```

---

### Task 2: Create config-writer with `configGet`

**Files:**
- Create: `packages/sidekick-core/src/config-writer.ts`
- Create: `packages/sidekick-core/src/__tests__/config-writer.test.ts`
- Modify: `packages/sidekick-core/src/index.ts` (add export)

**Step 1: Write the failing tests for configGet**

Test file: `packages/sidekick-core/src/__tests__/config-writer.test.ts`

Test cases:
1. `configGet` returns cascade-resolved value for a dot-path (e.g., `core.logging.level` → `'info'`)
2. `configGet` returns nested objects when path points to a branch (e.g., `core.logging` → `{level, format, ...}`)
3. `configGet` with `--scope=project` returns only the project scope's value (not cascade-resolved)
4. `configGet` returns `undefined` for nonexistent paths
5. `configGet` extracts domain from first path segment correctly for all four domains

Use the same test helper pattern as `config-service.test.ts`: temp directories, `createMockAssets`, env isolation.

Key test pattern for scope-specific reads:
```typescript
test('configGet with scope returns only that scope value', () => {
  // Write to user scope: logging.level = 'warn'
  // Write to project scope: logging.level = 'error'
  // configGet('core.logging.level') → 'error' (cascade)
  // configGet('core.logging.level', { scope: 'user' }) → 'warn'
  // configGet('core.logging.level', { scope: 'project' }) → 'error'
  // configGet('core.logging.level', { scope: 'local' }) → undefined
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern config-writer`
Expected: FAIL — module doesn't exist yet.

**Step 3: Implement configGet**

Create `packages/sidekick-core/src/config-writer.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AssetResolver } from './assets'
import type { Logger } from '@sidekick/types'
import {
  type ConfigDomain,
  DOMAIN_FILES,
  loadConfig,
  tryReadYaml,
  type ConfigServiceOptions,
} from './config'

// Valid config domains
const VALID_DOMAINS: ConfigDomain[] = ['core', 'llm', 'transcript', 'features']

export type ConfigScope = 'user' | 'project' | 'local'

export interface ConfigGetOptions {
  scope?: ConfigScope
  projectRoot?: string
  homeDir?: string
  assets?: AssetResolver
  logger?: Logger
}

export interface ConfigGetResult {
  value: unknown
  domain: ConfigDomain
  path: string[]
}

/**
 * Parse a dot-path into domain and remaining key path.
 * First segment is the domain (core|llm|transcript|features).
 */
export function parseDotPath(dotPath: string): { domain: ConfigDomain; keyPath: string[] } {
  const parts = dotPath.split('.')
  const domain = parts[0] as ConfigDomain
  if (!VALID_DOMAINS.includes(domain)) {
    throw new Error(`Unknown config domain: "${domain}". Valid domains: ${VALID_DOMAINS.join(', ')}`)
  }
  return { domain, keyPath: parts.slice(1) }
}

/**
 * Navigate a nested object by key path.
 * Returns undefined if any segment is missing.
 */
export function getNestedValue(obj: unknown, keyPath: string[]): unknown {
  let current = obj
  for (const key of keyPath) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Get the file path for a domain at a specific scope.
 */
function getScopeFilePath(domain: ConfigDomain, scope: ConfigScope, projectRoot: string, homeDir: string): string {
  const filename = DOMAIN_FILES[domain]
  switch (scope) {
    case 'user':
      return join(homeDir, '.sidekick', filename)
    case 'project':
      return join(projectRoot, '.sidekick', filename)
    case 'local':
      return join(projectRoot, '.sidekick', filename.replace('.yaml', '.local.yaml'))
  }
}

/**
 * Read a cascade-resolved config value at a dot-path.
 * With scope, returns only the value at that specific scope.
 */
export function configGet(dotPath: string, options: ConfigGetOptions = {}): ConfigGetResult {
  const { domain, keyPath } = parseDotPath(dotPath)
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot ?? process.cwd()

  if (options.scope) {
    // Scope-specific read: return value from just that scope's file
    const filePath = getScopeFilePath(domain, options.scope, projectRoot, homeDir)
    const fileData = tryReadYaml(filePath)
    const value = fileData ? getNestedValue(fileData, keyPath) : undefined
    return { value, domain, path: keyPath }
  }

  // Cascade-resolved read: load full config
  const config = loadConfig({
    projectRoot,
    homeDir,
    assets: options.assets,
    logger: options.logger,
  })
  const domainConfig = config[domain]
  const value = keyPath.length === 0 ? domainConfig : getNestedValue(domainConfig, keyPath)
  return { value, domain, path: keyPath }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern config-writer`
Expected: PASS

**Step 5: Add export to core index.ts**

In `packages/sidekick-core/src/index.ts`, add:
```typescript
export * from './config-writer'
```

**Step 6: Build and verify**

Run: `pnpm build && pnpm typecheck`
Expected: SUCCESS

**Step 7: Commit**

```
feat(config): add configGet with cascade and scope-specific reads
```

---

### Task 3: Add `configSet` with comment-preserving writes

**Files:**
- Modify: `packages/sidekick-core/src/config-writer.ts`
- Modify: `packages/sidekick-core/src/__tests__/config-writer.test.ts`

This is the most complex task. Uses `yaml` package's `parseDocument` API for comment preservation, validates changes against the full cascade, and seeds new files from bundled defaults.

**Step 1: Write failing tests for configSet**

Test cases:
1. `configSet` writes value to correct file at project scope (default)
2. `configSet` writes to user scope with `--scope=user`
3. `configSet` writes to local scope with `--scope=local`
4. `configSet` auto-detects types: numbers, booleans, strings, JSON objects/arrays
5. `configSet` preserves existing YAML comments when updating a file
6. `configSet` creates parent directories if they don't exist
7. `configSet` seeds from bundled defaults when creating a new file
8. `configSet` rejects invalid values (wrong type for enum field, unknown strict-mode keys)
9. `configSet` handles nested dot-paths creating intermediate objects

Key test for comment preservation:
```typescript
test('configSet preserves YAML comments', () => {
  // Write a file with comments
  writeFileSync(scopeFile, '# Important note\nlogging:\n  # Log verbosity\n  level: info\n')
  // configSet('core.logging.level', 'debug', { scope: 'project' })
  // Read file back — comments should still be there
  const content = readFileSync(scopeFile, 'utf8')
  expect(content).toContain('# Important note')
  expect(content).toContain('# Log verbosity')
  expect(content).toContain('level: debug')
})
```

Key test for validation:
```typescript
test('configSet rejects invalid enum value', () => {
  expect(() =>
    configSet('core.logging.level', 'verbose', { ... })
  ).toThrow(/validation/i)
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern config-writer`
Expected: FAIL

**Step 3: Implement configSet**

Add to `config-writer.ts`:

```typescript
import YAML from 'yaml'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  coerceValue,
  setNestedValue,
  deepMerge,
  EXTERNAL_DEFAULTS_FILES,
  SidekickConfigSchema,
} from './config'

export interface ConfigSetOptions {
  scope?: ConfigScope  // default: 'project'
  projectRoot?: string
  homeDir?: string
  assets?: AssetResolver
  logger?: Logger
}

export interface ConfigSetResult {
  domain: ConfigDomain
  path: string[]
  value: unknown
  filePath: string
}

/**
 * Set a nested value in a YAML Document AST, preserving comments.
 * Creates intermediate nodes as needed.
 */
function setInDocument(doc: YAML.Document, keyPath: string[], value: unknown): void {
  if (keyPath.length === 0) return

  let current: YAML.YAMLMap | null = doc.contents as YAML.YAMLMap

  // Navigate/create intermediate maps
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i]
    let next = current?.get(key)
    if (!next || !(next instanceof YAML.YAMLMap)) {
      next = new YAML.YAMLMap()
      current?.set(key, next)
    }
    current = next as YAML.YAMLMap
  }

  // Set the leaf value
  current?.set(keyPath[keyPath.length - 1], value)
}

/**
 * Write a config value at a dot-path to the specified scope.
 * Uses parseDocument for comment preservation.
 * Validates the resulting full cascade against Zod schemas.
 */
export function configSet(dotPath: string, rawValue: string, options: ConfigSetOptions = {}): ConfigSetResult {
  const { domain, keyPath } = parseDotPath(dotPath)
  if (keyPath.length === 0) {
    throw new Error('Cannot set an entire domain. Specify a key path (e.g., core.logging.level)')
  }

  const scope = options.scope ?? 'project'
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot ?? process.cwd()
  const filePath = getScopeFilePath(domain, scope, projectRoot, homeDir)
  const coerced = coerceValue(rawValue)

  // Read existing file or seed from defaults
  let doc: YAML.Document
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8')
    doc = YAML.parseDocument(content)
  } else {
    // Seed from bundled defaults if available
    const defaultContent = loadDefaultsContent(domain, options.assets)
    doc = defaultContent ? YAML.parseDocument(defaultContent) : new YAML.Document({})
  }

  // Apply the change to the document AST
  setInDocument(doc, keyPath, coerced)

  // Validate: load full cascade with this change applied
  // Write temp, validate, then commit (or validate in-memory)
  const tempConfig = buildConfigWithChange(domain, keyPath, coerced, {
    projectRoot, homeDir, assets: options.assets, logger: options.logger,
  })
  const result = SidekickConfigSchema.safeParse(tempConfig)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Validation failed: ${issues}`)
  }

  // Write the file
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, doc.toString())

  return { domain, path: keyPath, value: coerced, filePath }
}

/**
 * Build a config object with a change applied for validation.
 * Loads cascade, applies change in-memory, returns merged (unfrozen) result.
 */
function buildConfigWithChange(
  domain: ConfigDomain,
  keyPath: string[],
  value: unknown,
  options: ConfigServiceOptions
): Record<string, unknown> {
  // Load current cascade (without freezing — we need to mutate for validation)
  // Use tryReadYaml for each layer and merge manually
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot ?? process.cwd()

  // Build raw config from all layers (same as loadConfig but without freeze/validation)
  const rawConfig = buildRawCascade(options)

  // Apply the change
  if (!rawConfig[domain]) rawConfig[domain] = {}
  setNestedValue(rawConfig[domain] as Record<string, unknown>, keyPath, value)

  return rawConfig
}
```

Note: The actual implementation will need to replicate the cascade loading logic from `loadConfig` but without freeze/validate, or extract a shared helper. The implementing agent should look at `loadDomainConfig` and replicate its cascade for validation purposes.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern config-writer`
Expected: PASS

**Step 5: Build and verify**

Run: `pnpm build && pnpm typecheck`

**Step 6: Commit**

```
feat(config): add configSet with comment-preserving YAML writes
```

---

### Task 4: Add `configUnset` and `configList`

**Files:**
- Modify: `packages/sidekick-core/src/config-writer.ts`
- Modify: `packages/sidekick-core/src/__tests__/config-writer.test.ts`

**Step 1: Write failing tests for configUnset**

Test cases:
1. `configUnset` removes a key from the scope file
2. `configUnset` preserves YAML comments in remaining content
3. `configUnset` returns error for nonexistent key (no-op, not an error — just return success)
4. After unset, cascade falls through to lower-priority scope
5. `configUnset` removes empty parent objects after removing last child

**Step 2: Write failing tests for configList**

Test cases:
1. `configList` returns all overrides at project scope
2. `configList` returns overrides across all domain files at a scope
3. `configList` returns empty result when no files exist at scope
4. `configList` flattens nested values into dot-path format for display

**Step 3: Run tests to verify they fail**

**Step 4: Implement configUnset**

```typescript
export interface ConfigUnsetOptions {
  scope?: ConfigScope  // default: 'project'
  projectRoot?: string
  homeDir?: string
}

export interface ConfigUnsetResult {
  domain: ConfigDomain
  path: string[]
  filePath: string
  existed: boolean
}

/**
 * Remove a config value at a dot-path from the specified scope.
 */
export function configUnset(dotPath: string, options: ConfigUnsetOptions = {}): ConfigUnsetResult {
  const { domain, keyPath } = parseDotPath(dotPath)
  if (keyPath.length === 0) {
    throw new Error('Cannot unset an entire domain. Specify a key path.')
  }

  const scope = options.scope ?? 'project'
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot ?? process.cwd()
  const filePath = getScopeFilePath(domain, scope, projectRoot, homeDir)

  if (!existsSync(filePath)) {
    return { domain, path: keyPath, filePath, existed: false }
  }

  const content = readFileSync(filePath, 'utf8')
  const doc = YAML.parseDocument(content)

  // Delete the key using Document API
  deleteInDocument(doc, keyPath)

  writeFileSync(filePath, doc.toString())
  return { domain, path: keyPath, filePath, existed: true }
}
```

**Step 5: Implement configList**

```typescript
export interface ConfigListOptions {
  scope?: ConfigScope  // default: 'project'
  projectRoot?: string
  homeDir?: string
}

export interface ConfigListResult {
  scope: ConfigScope
  entries: Array<{ path: string; value: unknown }>
}

/**
 * List all config overrides at a specific scope.
 * Returns flattened dot-paths and their values.
 */
export function configList(options: ConfigListOptions = {}): ConfigListResult {
  const scope = options.scope ?? 'project'
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot ?? process.cwd()
  const entries: Array<{ path: string; value: unknown }> = []

  for (const domain of VALID_DOMAINS) {
    const filePath = getScopeFilePath(domain, scope, projectRoot, homeDir)
    const data = tryReadYaml(filePath)
    if (data) {
      flattenObject(data, domain, entries)
    }
  }

  return { scope, entries }
}

/** Flatten a nested object into dot-path entries. */
function flattenObject(
  obj: Record<string, unknown>,
  prefix: string,
  entries: Array<{ path: string; value: unknown }>
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value as Record<string, unknown>, path, entries)
    } else {
      entries.push({ path, value })
    }
  }
}
```

**Step 6: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern config-writer`

**Step 7: Build and verify**

Run: `pnpm build && pnpm typecheck`

**Step 8: Commit**

```
feat(config): add configUnset and configList operations
```

---

### Task 5: Create CLI command handler and register in cli.ts

**Files:**
- Create: `packages/sidekick-cli/src/commands/config.ts`
- Modify: `packages/sidekick-cli/src/cli.ts` (register command + update help text)

**Step 1: Write the CLI command handler**

Follow the pattern established by `persona.ts`: interface with options/result types, subcommand routing via switch, JSON/text output formatting.

```typescript
// packages/sidekick-cli/src/commands/config.ts

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { configGet, configSet, configUnset, configList, type ConfigScope } from '@sidekick/core'
import type { AssetResolver } from '@sidekick/core'

export interface ConfigCommandOptions {
  format?: 'json' | 'text'
  scope?: ConfigScope
  json?: boolean  // shortcut for --json on get
}

export interface ConfigCommandResult {
  exitCode: number
  output: string
}

export async function handleConfigCommand(
  subcommand: string | undefined,
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions & { assets?: AssetResolver }
): Promise<ConfigCommandResult> {
  switch (subcommand) {
    case 'get': return handleGet(args, projectRoot, logger, stdout, options)
    case 'set': return handleSet(args, projectRoot, logger, stdout, options)
    case 'unset': return handleUnset(args, projectRoot, logger, stdout, options)
    case 'list': return handleList(projectRoot, logger, stdout, options)
    case 'help':
    case '--help':
      return showConfigHelp(stdout)
    case undefined:
      stdout.write('Error: config command requires a subcommand\n\n')
      return showConfigHelp(stdout)
    default:
      stdout.write(`Error: Unknown config subcommand: ${subcommand}\n\n`)
      return showConfigHelp(stdout)
  }
}
```

Each handler (handleGet, handleSet, handleUnset, handleList) should:
- Parse args (dot-path from `args[0]`, value from `args[1]` for set)
- Call the core function
- Format output: JSON by default for get, text confirmation for set/unset
- Handle errors with clear messages

**Step 2: Register in cli.ts**

Add to `routeCommand()` in `cli.ts`, following the persona command pattern (around line 519):

```typescript
if (parsed.command === 'config') {
  const { handleConfigCommand } = await import('./commands/config.js')
  const subcommand = parsed.help ? '--help' : (parsed._?.[1] as string | undefined)
  const args = parsed._?.slice(2) ?? []

  const result = await handleConfigCommand(
    subcommand,
    args,
    runtime.projectRoot || process.cwd(),
    runtime.logger,
    stdout,
    {
      scope: parsed.scope as ConfigScope | undefined,
      format: parsed.format === 'json' ? 'json' : undefined,
      assets: runtime.assets,
    }
  )
  return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
}
```

Also add `config` to the global help text (around line 336):
```
  config <subcommand>      Manage configuration (get, set, unset, list)
```

Add `'json'` to the boolean flags in CLI_OPTIONS if not already present (for `--json` shortcut on `config get`).

**Step 3: Build and verify**

Run: `pnpm build && pnpm typecheck`

**Step 4: Commit**

```
feat(cli): add config get/set/unset/list commands
```

---

### Task 6: CLI tests and integration verification

**Files:**
- Create: `packages/sidekick-cli/src/__tests__/commands/config.test.ts`

**Step 1: Write CLI handler tests**

Test cases using `handleConfigCommand` directly (unit tests, no process spawn):
1. `config get core.logging.level` returns the resolved value
2. `config get core.logging.level --scope=project` returns scope-specific value
3. `config get nonexistent.path` returns appropriate error
4. `config set core.logging.level debug` writes and returns success
5. `config set core.logging.level verbose` returns validation error
6. `config unset core.logging.level` removes override and returns success
7. `config list --scope=project` lists all project overrides
8. `config --help` shows help text
9. Unknown subcommand shows error

Use temp directories and mock assets (same pattern as persona.test.ts or config-service.test.ts).

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/cli test -- --testPathPattern config`

**Step 3: Build and verify everything**

Run: `pnpm build && pnpm typecheck`

**Step 4: Commit**

```
test(cli): add config command tests
```

---

### Task 7: Final verification and cleanup

**Step 1: Run full test suite**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/cli test
```

**Step 2: Build check**

```bash
pnpm build && pnpm typecheck
```

**Step 3: Manual smoke test**

```bash
pnpm sidekick config get core.logging.level
pnpm sidekick config set core.logging.level debug --scope=local
pnpm sidekick config get core.logging.level --scope=local
pnpm sidekick config list --scope=local
pnpm sidekick config unset core.logging.level --scope=local
pnpm sidekick config --help
```

**Step 4: Commit any final adjustments**

```
chore(config-cli): final cleanup and verification
```

---

## Implementation Notes

### Comment Preservation Strategy

Use `YAML.parseDocument(content)` instead of `YAML.parse(content)`. The Document API returns an AST that preserves:
- Block comments (`#`)
- Inline comments
- Blank lines between sections
- Original formatting/style

Manipulate via `doc.get(key)`, `doc.set(key, value)`, `doc.delete(key)`, then serialize with `doc.toString()`.

### Validation Strategy

For `configSet`, validate by:
1. Load the raw cascade config (all layers merged, no Zod parsing yet)
2. Apply the proposed change in-memory
3. Parse through `SidekickConfigSchema.safeParse()`
4. If valid → write to file
5. If invalid → throw with clear error message

This catches all validation: unknown keys (strict mode), wrong types, enum violations, cross-field validations (profile references).

**Important**: The `features` domain uses `z.record(z.string(), FeatureEntrySchema)` which allows arbitrary feature names with `settings: z.record(z.string(), z.unknown())`. This means feature settings paths are NOT strictly validated — only the structure `{enabled, settings}` is enforced. This is by design (features define their own settings schemas).

### File Seeding Strategy

When `configSet` creates a new file:
1. Check if `EXTERNAL_DEFAULTS_FILES[domain]` exists in assets
2. If yes, read the raw YAML content (not parsed) to preserve all comments
3. Parse as Document, apply the change, write
4. If no, create a minimal Document with just the change

The `AssetResolver` only returns parsed objects. For raw file content, use `assets.resolvePath()` to get the file path, then `readFileSync()` to get raw content.

### Dot-Path Edge Cases

- `core` alone (no key path) → get returns entire domain object, set/unset rejects
- `features.statusline.settings.format` → navigates into feature settings
- `features.session-summary.settings.personas.weights.skippy` → deeply nested
- `llm.profiles.my-profile.temperature` → into record values
