/**
 * Persona Test CLI Command
 *
 * Tests persona voice differentiation by generating snarky or resume messages
 * with a specific persona and outputting the result.
 *
 * Usage:
 *   sidekick persona-test <persona-id> --session-id=<id> [--type=snarky|resume]
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { DaemonClient, IpcService, StateService } from '@sidekick/core'
import { readFile } from 'node:fs/promises'

export interface PersonaTestOptions {
  /** Session ID to use for generation */
  sessionId: string
  /** Type of message to generate */
  type: 'snarky' | 'resume'
}

export interface PersonaTestResult {
  exitCode: number
  output: string
}

/**
 * Handle the persona-test CLI command.
 *
 * Flow:
 * 1. Set session persona via daemon IPC
 * 2. Trigger message generation via daemon IPC
 * 3. Read and output the resulting state file
 */
export async function handlePersonaTestCommand(
  personaId: string,
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: PersonaTestOptions
): Promise<PersonaTestResult> {
  const { sessionId, type } = options

  logger.info('Persona test starting', { personaId, sessionId, type })

  // Ensure daemon is running
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
    const generateMethod = type === 'snarky' ? 'snarky.generate' : 'resume.generate'
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
    const stateFileName = type === 'snarky' ? 'snarky-message.json' : 'resume-message.json'
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
