/**
 * Persona CLI Command
 *
 * Manages session personas with subcommands:
 *   - persona list              List available persona IDs
 *   - persona set <id>          Set session persona (requires --session-id)
 *   - persona clear             Clear session persona (requires --session-id)
 *   - persona test <id>         Test persona voice (requires --session-id)
 *
 * All commands support --json for structured output.
 */

import { readFile } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { DaemonClient, IpcService, StateService, discoverPersonas, getDefaultPersonasDir } from '@sidekick/core'

/**
 * Execute an IPC command with automatic daemon start and cleanup.
 *
 * Handles the common pattern of:
 * 1. Creating DaemonClient and IpcService
 * 2. Starting the daemon
 * 3. Sending the IPC message
 * 4. Closing the IPC service
 */
async function withDaemonIpc<T>(
  projectRoot: string,
  logger: Logger,
  method: string,
  payload: Record<string, unknown>
): Promise<{ success: true; result: T } | { success: false; error: string }> {
  const daemonClient = new DaemonClient(projectRoot, logger)
  const ipcService = new IpcService(projectRoot, logger)

  try {
    await daemonClient.start()
    const result = await ipcService.send<T>(method, payload)

    if (!result) {
      return { success: false, error: 'No response from daemon' }
    }

    return { success: true, result }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMsg }
  } finally {
    ipcService.close()
  }
}

export interface PersonaCommandOptions {
  /** Session ID (required for set/clear/test) */
  sessionId?: string
  /** Output format: json (default) or table */
  format?: 'json' | 'table'
  /** Test message type: snarky or resume */
  testType?: 'snarky' | 'resume'
}

export interface PersonaCommandResult {
  exitCode: number
  output: string
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

  logger.debug('Listing personas', { projectRoot })

  const personas = discoverPersonas({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot,
    logger,
  })

  const personaIds = Array.from(personas.keys()).sort()

  if (format === 'table') {
    if (personaIds.length === 0) {
      stdout.write('No personas found.\n')
    } else {
      stdout.write(`Available Personas (${personaIds.length}):\n\n`)
      for (const id of personaIds) {
        const persona = personas.get(id)!
        const displayName = persona.display_name ?? id
        stdout.write(`  ${id.padEnd(20)} ${displayName}\n`)
      }
      stdout.write('\n')
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

interface PersonaSetResult {
  success: boolean
  previousPersonaId?: string
  error?: string
}

/**
 * Handle the persona set subcommand.
 *
 * Sets the session persona via daemon IPC.
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

  const ipcResult = await withDaemonIpc<PersonaSetResult>(projectRoot, logger, 'persona.set', { sessionId, personaId })

  if (!ipcResult.success) {
    logger.error('Failed to set persona', { error: ipcResult.error })
    stdout.write(JSON.stringify({ success: false, error: ipcResult.error }, null, 2) + '\n')
    return { exitCode: 1, output: ipcResult.error }
  }

  const result = ipcResult.result
  if (!result.success) {
    const errorMsg = result.error ?? 'Unknown error'
    stdout.write(JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n')
    return { exitCode: 1, output: errorMsg }
  }

  const response = {
    success: true,
    personaId,
    previousPersonaId: result.previousPersonaId ?? null,
  }

  stdout.write(JSON.stringify(response, null, 2) + '\n')

  if (result.previousPersonaId) {
    logger.info('Persona changed', { from: result.previousPersonaId, to: personaId })
  } else {
    logger.info('Persona set', { personaId })
  }

  return { exitCode: 0, output: JSON.stringify(response) }
}

/**
 * Handle the persona clear subcommand.
 *
 * Clears the session persona via daemon IPC.
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

  const ipcResult = await withDaemonIpc<PersonaSetResult>(projectRoot, logger, 'persona.set', {
    sessionId,
    personaId: null,
  })

  if (!ipcResult.success) {
    logger.error('Failed to clear persona', { error: ipcResult.error })
    stdout.write(JSON.stringify({ success: false, error: ipcResult.error }, null, 2) + '\n')
    return { exitCode: 1, output: ipcResult.error }
  }

  const result = ipcResult.result
  if (!result.success) {
    const errorMsg = result.error ?? 'Unknown error'
    stdout.write(JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n')
    return { exitCode: 1, output: errorMsg }
  }

  const response = {
    success: true,
    personaId: null,
    previousPersonaId: result.previousPersonaId ?? null,
  }

  stdout.write(JSON.stringify(response, null, 2) + '\n')
  logger.info('Persona cleared', { previousPersonaId: result.previousPersonaId ?? '(none)' })

  return { exitCode: 0, output: JSON.stringify(response) }
}

/**
 * Handle the persona test subcommand.
 *
 * Tests persona voice differentiation by generating snarky or resume messages.
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
      stdout.write(JSON.stringify({ error: errorMsg }, null, 2) + '\n')
      return { exitCode: 1, output: errorMsg }
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
      stdout.write(JSON.stringify({ error: errorMsg }, null, 2) + '\n')
      return { exitCode: 1, output: errorMsg }
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
      const errorMsg = `Failed to read generated file: ${statePath}`
      stdout.write(JSON.stringify({ error: errorMsg }, null, 2) + '\n')
      return { exitCode: 1, output: errorMsg }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Persona test failed', { error: errorMsg })
    stdout.write(JSON.stringify({ error: errorMsg }, null, 2) + '\n')
    return { exitCode: 1, output: errorMsg }
  } finally {
    ipcService.close()
  }
}

/**
 * Show usage help for the persona command.
 */
function showPersonaHelp(stdout: Writable): PersonaCommandResult {
  stdout.write(`Usage: sidekick persona <subcommand> [options]

Subcommands:
  list                          List available persona IDs
  set <persona-id>              Set session persona (requires --session-id)
  clear                         Clear session persona (requires --session-id)
  test <persona-id>             Test persona voice (requires --session-id)

Options:
  --session-id=<id>             Session ID for set/clear/test commands
  --type=snarky|resume          Message type for test command (default: snarky)
  --json                        Output as JSON (default)
  --format=table                Output as human-readable table

Examples:
  sidekick persona list
  sidekick persona list --format=table
  sidekick persona set marvin --session-id=abc123
  sidekick persona clear --session-id=abc123
  sidekick persona test skippy --session-id=abc123 --type=snarky
`)
  return { exitCode: 0, output: '' }
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

    case 'help':
    case '--help':
    case '-h':
      return showPersonaHelp(stdout)

    case undefined:
      stdout.write('Error: persona command requires a subcommand\n\n')
      return showPersonaHelp(stdout)

    default:
      stdout.write(`Error: Unknown persona subcommand: ${subcommand}\n\n`)
      return showPersonaHelp(stdout)
  }
}
