import type { StateService } from '@sidekick/core'
import { SnarkyMessageStateSchema } from '@sidekick/types'

/**
 * Replace stale persona messages with a placeholder so the statusline
 * doesn't show the previous persona's content during LLM regeneration.
 */
export async function stagePersonaTransition(stateService: StateService, sessionId: string): Promise<void> {
  const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
  const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')

  await Promise.all([
    stateService.write(
      snarkyPath,
      { message: 'Persona changed.', timestamp: new Date().toISOString() },
      SnarkyMessageStateSchema
    ),
    stateService.delete(resumePath),
  ])
}
