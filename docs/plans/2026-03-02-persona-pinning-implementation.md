# Persona Pinning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to pin a specific persona at project or user scope so new sessions default to it instead of random selection.

**Architecture:** Add `pinnedPersona` string to the existing `session-summary.personas` config. The selection logic checks this key before random selection. New `persona pin`/`unpin` CLI subcommands write via the existing config-writer. The config cascade (project > user > defaults) handles scope resolution automatically.

**Tech Stack:** TypeScript, Vitest, YAML config, config-writer (`configSet`/`configUnset`/`configGet`)

---

### Task 1: Add `pinnedPersona` to config type and defaults

**Files:**
- Modify: `packages/feature-session-summary/src/types.ts:66-81`
- Modify: `assets/sidekick/defaults/features/session-summary.defaults.yaml:77-107`

**Step 1: Add `pinnedPersona` to the TypeScript interface**

In `packages/feature-session-summary/src/types.ts`, add the field to the `personas` object inside `SessionSummaryConfig`:

```typescript
  /** Persona configuration for creative outputs */
  personas?: {
    /** Pin a specific persona for all new sessions (empty = random selection) */
    pinnedPersona?: string
    /** Comma-separated allow-list of persona IDs (empty = all available) */
    allowList: string
    // ... rest unchanged
  }
```

**Step 2: Add `pinnedPersona` to the TypeScript defaults**

In the same file, add the default value to `DEFAULT_SESSION_SUMMARY_CONFIG.personas`:

```typescript
  personas: {
    pinnedPersona: '',
    allowList: '',
    // ... rest unchanged
  },
```

**Step 3: Add `pinnedPersona` to the YAML defaults**

In `assets/sidekick/defaults/features/session-summary.defaults.yaml`, add under `personas:` section (before `allowList`):

```yaml
  personas:
    # Pin a specific persona for all new sessions
    # When set, this persona is used instead of random selection
    # Can be set at project scope (.sidekick/) or user scope (~/.sidekick/)
    # Project scope takes priority over user scope
    # Empty string means no pin (random selection)
    pinnedPersona: ""
    # Comma-separated allow-list...
```

**Step 4: Commit**

```bash
git add packages/feature-session-summary/src/types.ts assets/sidekick/defaults/features/session-summary.defaults.yaml
git commit -m "feat(config): add pinnedPersona to session-summary personas config"
```

---

### Task 2: Add pinned persona early-exit to selection logic (tests first)

**Files:**
- Modify: `packages/feature-session-summary/src/__tests__/persona-selection.test.ts`
- Modify: `packages/feature-session-summary/src/handlers/persona-selection.ts`

**Step 1: Write failing tests for pinned persona selection**

Add a new `describe` block in `packages/feature-session-summary/src/__tests__/persona-selection.test.ts` inside the `selectPersonaForSession` describe, after the existing tests:

```typescript
  describe('pinned persona', () => {
    it('uses pinned persona when it exists in discovered personas', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      personas.set('scotty', createMockPersona('scotty'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
          pinnedPersona: 'bones',
        },
      }

      // Run multiple times to verify it never selects randomly
      for (let i = 0; i < 10; i++) {
        const result = await selectPersonaForSession(`session-${i}`, config, ctx)
        expect(result).toBe('bones')
      }

      expect(mockLogger.wasLoggedAtLevel('Using pinned persona for session', 'info')).toBe(true)
    })

    it('falls back to random when pinned persona is not found', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
          pinnedPersona: 'nonexistent',
        },
      }

      const result = await selectPersonaForSession('test-session', config, ctx)

      // Should fall back to random (only skippy available)
      expect(result).toBe('skippy')
      expect(mockLogger.wasLoggedAtLevel('Pinned persona not found, falling back to random selection', 'warn')).toBe(true)
    })

    it('uses random selection when pinnedPersona is empty string', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
          pinnedPersona: '',
        },
      }

      // Should work like normal random selection
      const results = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const result = await selectPersonaForSession(`session-${i}`, config, ctx)
        if (result) results.add(result)
      }

      expect(results.size).toBe(2) // Both should be selected eventually
    })

    it('pinned persona bypasses allowList and blockList', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
          pinnedPersona: 'bones',
          allowList: 'skippy',    // bones NOT in allowList
          blockList: 'bones',      // bones IS in blockList
        },
      }

      const result = await selectPersonaForSession('test-session', config, ctx)

      // Pin overrides allowList/blockList
      expect(result).toBe('bones')
    })
  })
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/feature-session-summary && pnpm test -- --run persona-selection.test.ts`
Expected: FAIL — 4 new tests fail (pinnedPersona is not checked)

**Step 3: Implement pinned persona early-exit in selection logic**

In `packages/feature-session-summary/src/handlers/persona-selection.ts`, in `selectPersonaForSession()`, add the pinned persona check after persona discovery (after `allPersonas.size === 0` check, before `parsePersonaList`):

```typescript
  // Check for pinned persona (bypasses allowList/blockList/weights)
  const pinnedPersona = personaConfig.pinnedPersona?.trim()
  if (pinnedPersona) {
    const pinned = allPersonas.get(pinnedPersona)
    if (pinned) {
      // Persist pinned persona as session selection
      const personaState: SessionPersonaState = {
        persona_id: pinned.id,
        selected_from: [pinned.id],
        timestamp: new Date().toISOString(),
      }
      const summaryState = createSessionSummaryState(ctx.stateService)
      await summaryState.sessionPersona.write(sessionId, personaState)

      ctx.logger.info('Using pinned persona for session', {
        sessionId,
        personaId: pinned.id,
        personaName: pinned.display_name,
      })
      return pinned.id
    }

    ctx.logger.warn('Pinned persona not found, falling back to random selection', {
      sessionId,
      pinnedPersona,
      availablePersonas: Array.from(allPersonas.keys()),
    })
  }
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/feature-session-summary && pnpm test -- --run persona-selection.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/feature-session-summary/src/handlers/persona-selection.ts packages/feature-session-summary/src/__tests__/persona-selection.test.ts
git commit -m "feat(selection): use pinned persona when configured, bypassing random selection"
```

---

### Task 3: Add `persona pin` CLI subcommand (tests first)

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/persona.test.ts`
- Modify: `packages/sidekick-cli/src/commands/persona.ts`

**Step 1: Add mock for `configSet` and `configGet` in test file**

In `packages/sidekick-cli/src/commands/__tests__/persona.test.ts`, add to the `vi.hoisted` block:

```typescript
  mockConfigSet: vi.fn(),
  mockConfigGet: vi.fn(),
```

Add to the `vi.mock('@sidekick/core', ...)` factory:

```typescript
    configSet: mockConfigSet,
    configGet: mockConfigGet,
```

In `beforeEach`, add defaults:

```typescript
    mockConfigSet.mockReturnValue({ domain: 'features', path: ['session-summary', 'personas', 'pinnedPersona'], value: 'marvin', filePath: '/mock/.sidekick/features.yaml' })
    mockConfigGet.mockReturnValue(undefined)
```

**Step 2: Write failing tests for `persona pin`**

Add a new `describe('persona pin', ...)` block:

```typescript
  describe('persona pin', () => {
    test('requires persona ID', async () => {
      const result = await handlePersonaCommand('pin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Error: persona pin requires a persona ID')
    })

    test('pins persona at project scope by default', async () => {
      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(mockConfigSet).toHaveBeenCalledWith(
        'features.session-summary.personas.pinnedPersona',
        'marvin',
        expect.objectContaining({ scope: 'project', projectRoot })
      )

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.personaId).toBe('marvin')
      expect(output.scope).toBe('project')
    })

    test('pins persona at user scope when specified', async () => {
      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, { scope: 'user' })

      expect(result.exitCode).toBe(0)
      expect(mockConfigSet).toHaveBeenCalledWith(
        'features.session-summary.personas.pinnedPersona',
        'marvin',
        expect.objectContaining({ scope: 'user' })
      )

      const output = JSON.parse(stdout.data)
      expect(output.scope).toBe('user')
    })

    test('rejects unknown persona', async () => {
      const result = await handlePersonaCommand('pin', ['nonexistent'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      expect(mockConfigSet).not.toHaveBeenCalled()

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Persona "nonexistent" not found')
    })

    test('handles configSet failure', async () => {
      mockConfigSet.mockImplementationOnce(() => { throw new Error('Write failed') })

      const result = await handlePersonaCommand('pin', ['marvin'], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Write failed')
    })
  })
```

**Step 3: Run tests to verify they fail**

Run: `cd packages/sidekick-cli && pnpm test -- --run persona.test.ts`
Expected: FAIL — pin subcommand not implemented

**Step 4: Add `scope` to `PersonaCommandOptions`**

In `packages/sidekick-cli/src/commands/persona.ts`, add to the `PersonaCommandOptions` interface:

```typescript
  /** Config scope for pin/unpin: project (default) or user */
  scope?: 'project' | 'user'
```

**Step 5: Import `configSet` and `configGet`**

Add to the import from `@sidekick/core`:

```typescript
  configSet,
  configGet,
```

**Step 6: Implement `handlePersonaPin`**

Add new handler function (before `showPersonaHelp`):

```typescript
/**
 * Handle the persona pin subcommand.
 *
 * Writes pinnedPersona config at the specified scope (default: project).
 * Validates persona exists before writing.
 */
function handlePersonaPin(
  personaId: string,
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): PersonaCommandResult {
  const scope = options.scope ?? 'project'

  logger.info('Pinning persona', { personaId, scope })

  // Validate persona exists
  const personas = discoverPersonas({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot,
    logger,
  })

  if (!personas.has(personaId)) {
    const availableIds = Array.from(personas.keys()).join(', ')
    const errorMsg = `Persona "${personaId}" not found. Available: ${availableIds}`
    logger.error('Persona not found', { personaId, available: availableIds })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }

  try {
    const result = configSet(
      'features.session-summary.personas.pinnedPersona',
      personaId,
      { scope, projectRoot }
    )

    logger.info('Persona pinned', { personaId, scope, filePath: result.filePath })

    return writeJsonResponse(stdout, {
      success: true,
      personaId,
      scope,
      filePath: result.filePath,
    }, 0)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to pin persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}
```

**Step 7: Add `pin` case to the switch in `handlePersonaCommand`**

```typescript
    case 'pin':
      if (!personaId) {
        const error = 'Error: persona pin requires a persona ID'
        stdout.write(error + '\n')
        stdout.write('Usage: sidekick persona pin <persona-id> [--scope=project|user]\n')
        return { exitCode: 1, output: error }
      }
      return handlePersonaPin(personaId, projectRoot, logger, stdout, options)
```

**Step 8: Run tests to verify they pass**

Run: `cd packages/sidekick-cli && pnpm test -- --run persona.test.ts`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add packages/sidekick-cli/src/commands/persona.ts packages/sidekick-cli/src/commands/__tests__/persona.test.ts
git commit -m "feat(cli): add persona pin subcommand"
```

---

### Task 4: Add `persona unpin` CLI subcommand (tests first)

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/persona.test.ts`
- Modify: `packages/sidekick-cli/src/commands/persona.ts`

**Step 1: Add mock for `configUnset` in test file**

Add to `vi.hoisted`:

```typescript
  mockConfigUnset: vi.fn(),
```

Add to `vi.mock('@sidekick/core', ...)`:

```typescript
    configUnset: mockConfigUnset,
```

In `beforeEach`:

```typescript
    mockConfigUnset.mockReturnValue({ domain: 'features', path: ['session-summary', 'personas', 'pinnedPersona'], filePath: '/mock/.sidekick/features.yaml', existed: true })
```

**Step 2: Write failing tests for `persona unpin`**

```typescript
  describe('persona unpin', () => {
    test('unpins persona from project scope by default', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'marvin', domain: 'features', path: [] })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      expect(mockConfigUnset).toHaveBeenCalledWith(
        'features.session-summary.personas.pinnedPersona',
        expect.objectContaining({ scope: 'project', projectRoot })
      )

      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.scope).toBe('project')
      expect(output.previousPersonaId).toBe('marvin')
    })

    test('unpins persona from user scope when specified', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'skippy', domain: 'features', path: [] })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, { scope: 'user' })

      expect(result.exitCode).toBe(0)
      expect(mockConfigUnset).toHaveBeenCalledWith(
        'features.session-summary.personas.pinnedPersona',
        expect.objectContaining({ scope: 'user' })
      )

      const output = JSON.parse(stdout.data)
      expect(output.scope).toBe('user')
      expect(output.previousPersonaId).toBe('skippy')
    })

    test('succeeds idempotently when no pin exists', async () => {
      mockConfigGet.mockReturnValueOnce(undefined)
      mockConfigUnset.mockReturnValueOnce({ existed: false, domain: 'features', path: [], filePath: '/mock/.sidekick/features.yaml' })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(true)
      expect(output.previousPersonaId).toBeNull()
    })

    test('handles configUnset failure', async () => {
      mockConfigGet.mockReturnValueOnce({ value: 'marvin', domain: 'features', path: [] })
      mockConfigUnset.mockImplementationOnce(() => { throw new Error('Permission denied') })

      const result = await handlePersonaCommand('unpin', [], projectRoot, logger, stdout, {})

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(stdout.data)
      expect(output.success).toBe(false)
      expect(output.error).toContain('Permission denied')
    })
  })
```

**Step 3: Run tests to verify they fail**

Run: `cd packages/sidekick-cli && pnpm test -- --run persona.test.ts`
Expected: FAIL — unpin subcommand not implemented

**Step 4: Import `configUnset` and add handler**

Add `configUnset` to the import from `@sidekick/core`.

Implement `handlePersonaUnpin`:

```typescript
/**
 * Handle the persona unpin subcommand.
 *
 * Removes pinnedPersona config at the specified scope (default: project).
 * Idempotent: succeeds even when no pin exists.
 */
function handlePersonaUnpin(
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): PersonaCommandResult {
  const scope = options.scope ?? 'project'

  logger.info('Unpinning persona', { scope })

  try {
    // Read current pin value for response
    const current = configGet(
      'features.session-summary.personas.pinnedPersona',
      { scope, projectRoot }
    )
    const previousPersonaId = (current?.value as string) || null

    configUnset(
      'features.session-summary.personas.pinnedPersona',
      { scope, projectRoot }
    )

    logger.info('Persona unpinned', { scope, previousPersonaId })

    return writeJsonResponse(stdout, {
      success: true,
      scope,
      previousPersonaId,
    }, 0)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to unpin persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}
```

**Step 5: Add `unpin` case to the switch**

```typescript
    case 'unpin':
      return handlePersonaUnpin(projectRoot, logger, stdout, options)
```

**Step 6: Run tests to verify they pass**

Run: `cd packages/sidekick-cli && pnpm test -- --run persona.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add packages/sidekick-cli/src/commands/persona.ts packages/sidekick-cli/src/commands/__tests__/persona.test.ts
git commit -m "feat(cli): add persona unpin subcommand"
```

---

### Task 5: Update help text and wire `--scope` through CLI

**Files:**
- Modify: `packages/sidekick-cli/src/commands/persona.ts:328-351` (help text)
- Modify: `packages/sidekick-cli/src/cli.ts:531-552` (scope passthrough)

**Step 1: Update help text in `showPersonaHelp`**

Replace the help text to include `pin` and `unpin`:

```typescript
function showPersonaHelp(stdout: Writable): PersonaCommandResult {
  stdout.write(`Usage: sidekick persona <subcommand> [options]

Subcommands:
  list                          List available persona IDs
  set <persona-id>              Set session persona (requires --session-id)
  clear                         Clear session persona (requires --session-id)
  pin <persona-id>              Pin persona for all new sessions
  unpin                         Remove pinned persona
  test <persona-id>             Test persona voice (requires --session-id)

Options:
  --session-id=<id>             Session ID for set/clear/test commands
  --scope=<project|user>        Scope for pin/unpin (default: project)
  --type=snarky|resume          Message type for test command (default: snarky)
  --format=<format>             Output format: json (default) or table
  --width=<n>                   Table width in characters (default: 100)

Examples:
  sidekick persona list
  sidekick persona list --format=table
  sidekick persona pin darth-vader
  sidekick persona pin darth-vader --scope=user
  sidekick persona unpin
  sidekick persona unpin --scope=user
  sidekick persona set marvin --session-id=abc123
  sidekick persona clear --session-id=abc123
  sidekick persona test skippy --session-id=abc123 --type=snarky
`)
  return { exitCode: 0, output: '' }
}
```

**Step 2: Pass `scope` through in CLI router**

In `packages/sidekick-cli/src/cli.ts`, update the persona command options object (around line 546) to include scope:

```typescript
      {
        sessionId: parsed.sessionIdArg,
        format: parsed.format === 'json' || parsed.format === 'table' ? parsed.format : undefined,
        testType: parsed.messageType,
        width: parsed.width,
        scope: parsed.scope === 'user' || parsed.scope === 'project' ? parsed.scope : undefined,
      }
```

**Step 3: Update CLI help line**

In `packages/sidekick-cli/src/cli.ts`, update the persona description line (around line 351):

```typescript
  persona <subcommand>     Manage session personas (list, set, clear, pin, unpin, test)
```

**Step 4: Run all tests**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/persona.ts packages/sidekick-cli/src/cli.ts
git commit -m "feat(cli): update persona help text and wire --scope for pin/unpin"
```

---

### Task 6: Final verification

**Step 1: Run full build and quality gates**

```bash
pnpm build && pnpm typecheck && pnpm lint
```

Expected: ALL PASS

**Step 2: Run all affected tests**

```bash
pnpm --filter @sidekick/feature-session-summary test -- --run persona-selection.test.ts
pnpm --filter @sidekick/sidekick-cli test -- --run persona.test.ts
```

Expected: ALL PASS

**Step 3: Manual smoke test**

```bash
pnpm sidekick persona pin darth-vader
pnpm sidekick persona pin darth-vader --scope=user
pnpm sidekick persona unpin
pnpm sidekick persona unpin --scope=user
pnpm sidekick persona --help
```

**Step 4: Commit any remaining changes and push**

```bash
git push -u origin feat/persona-pinning
```
