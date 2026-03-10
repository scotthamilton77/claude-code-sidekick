/**
 * Persona CLI Command
 *
 * Manages session personas with subcommands:
 *   - persona list              List available persona IDs
 *   - persona set <id>          Set session persona (requires --session-id)
 *   - persona clear             Clear session persona (requires --session-id)
 *   - persona pin <id>          Pin persona for new sessions (--scope=project|user)
 *   - persona unpin             Remove pinned persona (--scope=project|user)
 *   - persona test <id>         Test persona voice (requires --session-id)
 *
 * All commands support --format=json or --format=table for output.
 */

import { readFile } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import {
  DaemonClient,
  IpcService,
  StateService,
  SessionStateAccessor,
  sessionState,
  discoverPersonas,
  getDefaultPersonasDir,
  configSet,
  configGet,
  configUnset,
} from '@sidekick/core'
import type { AssetResolver } from '@sidekick/core'
import type { PersonaDefinition } from '@sidekick/types'
import type { SessionPersonaState } from '@sidekick/types'
import { SessionPersonaStateSchema } from '@sidekick/types'
import { renderTable, renderEmptyTable } from './table.js'

/**
 * Session persona state descriptor.
 * Matches the descriptor in feature-session-summary/src/state.ts.
 */
const SessionPersonaDescriptor = sessionState('session-persona.json', SessionPersonaStateSchema, {
  defaultValue: null,
})

export interface PersonaCommandOptions {
  /** Session ID (required for set/clear/test) */
  sessionId?: string
  /** Output format: json (default) or table */
  format?: 'json' | 'table'
  /** Test message type: snarky or resume */
  testType?: 'snarky' | 'resume'
  /** Table width in characters (default: 100) */
  width?: number
  /** Config scope for pin/unpin: project (default) or user */
  scope?: 'project' | 'user'
  /** Asset resolver for config validation */
  assets?: AssetResolver
}

export interface PersonaCommandResult {
  exitCode: number
  output: string
}

/** Write JSON response to stdout and return command result. */
function writeJsonResponse(
  stdout: Writable,
  response: Record<string, unknown>,
  exitCode: number
): PersonaCommandResult {
  const output = JSON.stringify(response, null, 2)
  stdout.write(output + '\n')
  return { exitCode, output }
}

/**
 * Validate that a persona exists. Returns the discovered personas map on success,
 * or an error result after writing an error JSON response.
 */
function validatePersonaExists(
  personaId: string,
  opts: { projectRoot: string; logger: Logger; stdout: Writable }
):
  | { personas: Map<string, PersonaDefinition>; result?: undefined }
  | { personas?: undefined; result: PersonaCommandResult } {
  const personas = discoverPersonas({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot: opts.projectRoot,
    logger: opts.logger,
  })

  if (!personas.has(personaId)) {
    const availableIds = Array.from(personas.keys()).join(', ')
    const errorMsg = `Persona "${personaId}" not found. Available: ${availableIds}`
    opts.logger.error('Persona not found', { personaId, available: availableIds })
    return { result: writeJsonResponse(opts.stdout, { success: false, error: errorMsg }, 1) }
  }

  return { personas }
}

/**
 * Handle the persona list subcommand.
 *
 * Lists all available persona IDs from the cascade layers.
 */
function handlePersonaList(
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): PersonaCommandResult {
  const format = options.format ?? 'json'
  const tableWidth = options.width ?? 100

  logger.debug('Listing personas', { projectRoot })

  const personas = discoverPersonas({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot,
    logger,
  })

  const personaIds = Array.from(personas.keys()).sort()

  if (format === 'table') {
    if (personaIds.length === 0) {
      stdout.write(renderEmptyTable('No personas found', tableWidth) + '\n')
    } else {
      stdout.write(`Available Personas (${personaIds.length}):\n\n`)

      const data = personaIds.map((id) => {
        const persona = personas.get(id)!
        return [id, persona.display_name ?? id, persona.theme ?? '']
      })

      const table = renderTable(data, {
        totalWidth: tableWidth,
        columns: [
          { header: 'ID', width: 20 },
          { header: 'Display Name', width: 20 },
          { header: 'Theme', width: 'flex', minWidth: 20 },
        ],
      })
      stdout.write(table + '\n')
    }
  } else {
    const result = {
      personas: personaIds.map((id) => {
        const persona = personas.get(id)!
        return {
          id,
          displayName: persona.display_name,
          theme: persona.theme,
        }
      }),
      count: personaIds.length,
    }
    stdout.write(JSON.stringify(result, null, 2) + '\n')
  }

  return { exitCode: 0, output: JSON.stringify({ count: personaIds.length }) }
}

/**
 * Handle the persona set subcommand.
 *
 * Writes directly to session-persona.json, bypassing daemon IPC.
 * This allows persona switching to work in sandbox mode.
 */
async function handlePersonaSet(
  personaId: string,
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): Promise<PersonaCommandResult> {
  const { sessionId } = options

  if (!sessionId) {
    const error = 'Error: persona set requires --session-id'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick persona set <persona-id> --session-id=<id>\n')
    return { exitCode: 1, output: error }
  }

  logger.info('Setting persona', { personaId, sessionId })

  // Validate persona exists
  const validation = validatePersonaExists(personaId, { projectRoot, logger, stdout })
  if (validation.result) return validation.result
  const personas = validation.personas

  // Create state service and accessor for direct file write
  const stateService = new StateService(projectRoot, { cache: false, logger })
  const personaAccessor = new SessionStateAccessor(stateService, SessionPersonaDescriptor)

  try {
    // Read existing persona (if any) for response
    const existingResult = await personaAccessor.read(sessionId)
    const previousPersonaId = existingResult.data?.persona_id ?? null

    // Write new persona selection
    const newState: SessionPersonaState = {
      persona_id: personaId,
      selected_from: Array.from(personas.keys()),
      timestamp: new Date().toISOString(),
    }

    await personaAccessor.write(sessionId, newState)

    if (previousPersonaId) {
      logger.info('Persona changed', { from: previousPersonaId, to: personaId })
    } else {
      logger.info('Persona set', { personaId })
    }

    return writeJsonResponse(stdout, { success: true, personaId, previousPersonaId }, 0)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to set persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}

/**
 * Handle the persona clear subcommand.
 *
 * Deletes session-persona.json directly, bypassing daemon IPC.
 * This allows persona clearing to work in sandbox mode.
 */
async function handlePersonaClear(
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): Promise<PersonaCommandResult> {
  const { sessionId } = options

  if (!sessionId) {
    const error = 'Error: persona clear requires --session-id'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick persona clear --session-id=<id>\n')
    return { exitCode: 1, output: error }
  }

  logger.info('Clearing persona', { sessionId })

  // Create state service and accessor for direct file operations
  const stateService = new StateService(projectRoot, { cache: false, logger })
  const personaAccessor = new SessionStateAccessor(stateService, SessionPersonaDescriptor)

  try {
    // Read existing persona (if any) for response
    const existingResult = await personaAccessor.read(sessionId)
    const previousPersonaId = existingResult.data?.persona_id ?? null

    // Delete the persona file
    const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
    await stateService.delete(personaPath)

    logger.info('Persona cleared', { previousPersonaId: previousPersonaId ?? '(none)' })

    return writeJsonResponse(stdout, { success: true, personaId: null, previousPersonaId }, 0)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to clear persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}

/**
 * Handle the persona test subcommand.
 *
 * Tests persona voice differentiation by generating snarky or resume messages.
 * This command still uses IPC because it requires the daemon for LLM generation.
 */
async function handlePersonaTest(
  personaId: string,
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): Promise<PersonaCommandResult> {
  const { sessionId, testType = 'snarky' } = options

  if (!sessionId) {
    const error = 'Error: persona test requires --session-id'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick persona test <persona-id> --session-id=<id> [--type=snarky|resume]\n')
    return { exitCode: 1, output: error }
  }

  logger.info('Persona test starting', { personaId, sessionId, type: testType })

  const daemonClient = new DaemonClient(projectRoot, logger)
  const ipcService = new IpcService(projectRoot, logger)

  try {
    await daemonClient.start()

    // Step 1: Set the persona for this session
    logger.debug('Setting session persona', { personaId })
    const setResult = await ipcService.send<{
      success: boolean
      previousPersonaId?: string
      error?: string
    }>('persona.set', { sessionId, personaId })

    if (!setResult || !setResult.success) {
      const errorMsg = `Failed to set persona: ${setResult?.error ?? 'No response from daemon'}`
      return writeJsonResponse(stdout, { error: errorMsg }, 1)
    }

    if (setResult.previousPersonaId) {
      logger.info('Persona changed', { from: setResult.previousPersonaId, to: personaId })
    }

    // Step 2: Generate the message
    const generateMethod = testType === 'snarky' ? 'snarky.generate' : 'resume.generate'
    logger.debug('Triggering generation', { method: generateMethod })

    const genResult = await ipcService.send<{
      success: boolean
      error?: string
    }>(generateMethod, { sessionId })

    if (!genResult || !genResult.success) {
      const errorMsg = `Generation failed: ${genResult?.error ?? 'No response from daemon'}`
      return writeJsonResponse(stdout, { error: errorMsg }, 1)
    }

    // Step 3: Read and output the state file
    const stateFileName = testType === 'snarky' ? 'snarky-message.json' : 'resume-message.json'
    const stateService = new StateService(projectRoot, { cache: false, logger })
    const statePath = stateService.sessionStatePath(sessionId, stateFileName)

    try {
      const content = await readFile(statePath, 'utf-8')
      stdout.write(content + '\n')
      return { exitCode: 0, output: content }
    } catch {
      return writeJsonResponse(stdout, { error: `Failed to read generated file: ${statePath}` }, 1)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Persona test failed', { error: errorMsg })
    return writeJsonResponse(stdout, { error: errorMsg }, 1)
  } finally {
    ipcService.close()
  }
}

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
  const validation = validatePersonaExists(personaId, { projectRoot, logger, stdout })
  if (validation.result) return validation.result

  try {
    const result = configSet('features.session-summary.settings.personas.pinnedPersona', personaId, {
      scope,
      projectRoot,
      assets: options.assets,
      logger,
    })

    logger.info('Persona pinned', { personaId, scope, filePath: result.filePath })

    return writeJsonResponse(
      stdout,
      {
        success: true,
        personaId,
        scope,
        filePath: result.filePath,
      },
      0
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to pin persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}

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
    const current = configGet('features.session-summary.settings.personas.pinnedPersona', {
      scope,
      projectRoot,
      assets: options.assets,
      logger,
    })
    const previousPersonaId = (current?.value as string) || null

    configUnset('features.session-summary.settings.personas.pinnedPersona', { scope, projectRoot })

    logger.info('Persona unpinned', { scope, previousPersonaId })

    return writeJsonResponse(
      stdout,
      {
        success: true,
        scope,
        previousPersonaId,
      },
      0
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to unpin persona', { error: errorMsg })
    return writeJsonResponse(stdout, { success: false, error: errorMsg }, 1)
  }
}

/**
 * Show usage help for the persona command.
 */
function showPersonaHelp(stdout: Writable, exitCode = 0): PersonaCommandResult {
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
  return { exitCode, output: '' }
}

/**
 * Handle the persona CLI command with subcommands.
 *
 * Routes to appropriate handler based on subcommand.
 */
export async function handlePersonaCommand(
  subcommand: string | undefined,
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): Promise<PersonaCommandResult> {
  // Get persona ID from args if present (position after subcommand)
  const personaId = args[0] as string | undefined

  switch (subcommand) {
    case 'list':
      return handlePersonaList(projectRoot, logger, stdout, options)

    case 'set':
      if (!personaId) {
        const error = 'Error: persona set requires a persona ID'
        stdout.write(error + '\n')
        stdout.write('Usage: sidekick persona set <persona-id> --session-id=<id>\n')
        return { exitCode: 1, output: error }
      }
      return handlePersonaSet(personaId, projectRoot, logger, stdout, options)

    case 'clear':
      return handlePersonaClear(projectRoot, logger, stdout, options)

    case 'test':
      if (!personaId) {
        const error = 'Error: persona test requires a persona ID'
        stdout.write(error + '\n')
        stdout.write('Usage: sidekick persona test <persona-id> --session-id=<id> [--type=snarky|resume]\n')
        return { exitCode: 1, output: error }
      }
      return handlePersonaTest(personaId, projectRoot, logger, stdout, options)

    case 'pin':
      if (!personaId) {
        const error = 'Error: persona pin requires a persona ID'
        stdout.write(error + '\n')
        stdout.write('Usage: sidekick persona pin <persona-id> [--scope=project|user]\n')
        return { exitCode: 1, output: error }
      }
      return handlePersonaPin(personaId, projectRoot, logger, stdout, options)

    case 'unpin':
      return handlePersonaUnpin(projectRoot, logger, stdout, options)

    case 'help':
    case '--help':
    case '-h':
      return showPersonaHelp(stdout)

    case undefined:
      stdout.write('Error: persona command requires a subcommand\n\n')
      return showPersonaHelp(stdout, 1)

    default:
      stdout.write(`Error: Unknown persona subcommand: ${subcommand}\n\n`)
      return showPersonaHelp(stdout, 1)
  }
}
