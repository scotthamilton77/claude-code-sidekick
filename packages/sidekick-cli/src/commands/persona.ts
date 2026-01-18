/**
 * Persona CLI Command
 *
 * Changes the current persona for a session.
 *
 * Usage:
 *   sidekick persona <persona-id> --session-id=<id>
 *   sidekick persona --session-id=<id>              # Clear persona (use default)
 */

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { DaemonClient, IpcService } from '@sidekick/core'

export interface PersonaCommandOptions {
  /** Session ID to set persona for */
  sessionId: string
}

export interface PersonaCommandResult {
  exitCode: number
  output: string
}

/**
 * Handle the persona CLI command.
 *
 * Sets the session persona via daemon IPC and reports success/failure.
 */
export async function handlePersonaCommand(
  personaId: string | undefined,
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaCommandOptions
): Promise<PersonaCommandResult> {
  const { sessionId } = options

  logger.info('Setting persona', { personaId: personaId ?? '(clear)', sessionId })

  const daemonClient = new DaemonClient(projectRoot, logger)
  const ipcService = new IpcService(projectRoot, logger)

  try {
    await daemonClient.start()

    const result = await ipcService.send<{
      success: boolean
      previousPersonaId?: string
      error?: string
    }>('persona.set', { sessionId, personaId: personaId ?? null })

    if (!result || !result.success) {
      const errorMsg = result?.error ?? 'No response from daemon'
      stdout.write(JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n')
      return { exitCode: 1, output: errorMsg }
    }

    const response = {
      success: true,
      personaId: personaId ?? null,
      previousPersonaId: result.previousPersonaId ?? null,
    }

    stdout.write(JSON.stringify(response, null, 2) + '\n')

    if (result.previousPersonaId) {
      logger.info('Persona changed', { from: result.previousPersonaId, to: personaId ?? '(none)' })
    } else if (personaId) {
      logger.info('Persona set', { personaId })
    } else {
      logger.info('Persona cleared')
    }

    return { exitCode: 0, output: JSON.stringify(response) }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to set persona', { error: errorMsg })
    stdout.write(JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n')
    return { exitCode: 1, output: errorMsg }
  } finally {
    ipcService.close()
  }
}
