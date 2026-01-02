/**
 * CreateFirstSessionSummary Handler
 *
 * Creates placeholder summary on session start. Only writes for startup/clear.
 * Resume/compact preserve existing summary.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */

import type { SessionStartHookEvent } from '@sidekick/core'
import { backupIfDevMode } from '@sidekick/core'
import type { SupervisorContext } from '@sidekick/types'
import type { SessionSummaryState } from '../types.js'
import fs from 'node:fs/promises'
import path from 'node:path'

const STATE_FILE = 'session-summary.json'

export async function createFirstSessionSummary(event: SessionStartHookEvent, ctx: SupervisorContext): Promise<void> {
  const { sessionId } = event.context
  const { startType } = event.payload

  // Only create placeholder for fresh sessions
  if (startType !== 'startup' && startType !== 'clear') {
    ctx.logger.debug('Preserving existing summary', { startType, sessionId })
    return
  }

  const placeholder: SessionSummaryState = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    session_title: 'New Session',
    session_title_confidence: 0,
    latest_intent: 'Awaiting first prompt...',
    latest_intent_confidence: 0,
  }

  // Write to .sidekick/sessions/{sessionId}/state/session-summary.json
  const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
  const statePath = path.join(stateDir, 'sessions', sessionId, 'state', STATE_FILE)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await backupIfDevMode(ctx.config.core.development.enabled, statePath, { logger: ctx.logger })
  await fs.writeFile(statePath, JSON.stringify(placeholder, null, 2), 'utf-8')

  ctx.logger.info('Created placeholder session summary', { sessionId })
}
