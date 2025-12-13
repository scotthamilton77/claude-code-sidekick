/**
 * Statusline Command Handler
 *
 * Renders the statusline from session state files.
 *
 * Usage:
 *   sidekick statusline [--format <text|json>] [--session-id <id>]
 *
 * @see docs/design/FEATURE-STATUSLINE.md §7 Invocation Model
 */

import * as path from 'node:path'
import type { Logger } from '@sidekick/core'
import { LogEvents, logEvent, type EventLogContext } from '@sidekick/core'

export interface StatuslineCommandOptions {
  /** Output format: 'text' (ANSI) or 'json' (raw data) */
  format?: 'text' | 'json'
  /** Session ID (defaults to current session detection) */
  sessionId?: string
  /** Whether the session was resumed */
  isResumed?: boolean
}

export interface StatuslineCommandResult {
  exitCode: number
}

/**
 * Handle the statusline command.
 *
 * This is designed for minimal latency - it should complete in <50ms.
 */
export async function handleStatuslineCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: StatuslineCommandOptions = {}
): Promise<StatuslineCommandResult> {
  const format = options.format ?? 'text'
  const useColors = format === 'text'
  const startTime = performance.now()

  // Dynamically import to avoid loading feature package until needed
  const { createStatuslineService } = await import('@sidekick/feature-statusline')

  // Determine session state directory
  // Default: .sidekick/sessions/{sessionId}/state/
  const sidekickDir = path.join(projectDir, '.sidekick')
  const sessionId = options.sessionId ?? 'current' // TODO: Implement session detection
  const sessionStateDir = path.join(sidekickDir, 'sessions', sessionId, 'state')

  // Build event context for structured logging
  const eventContext: EventLogContext = {
    sessionId,
    scope: 'project',
  }

  const service = createStatuslineService({
    sessionStateDir,
    cwd: process.cwd(),
    homeDir: process.env.HOME,
    isResumedSession: options.isResumed ?? false,
    useColors,
  })

  try {
    const result = await service.render()
    const durationMs = Math.round(performance.now() - startTime)

    if (format === 'json') {
      stdout.write(JSON.stringify(result.viewModel, null, 2) + '\n')
    } else {
      stdout.write(result.text + '\n')
    }

    // Emit structured StatuslineRendered event
    const event = LogEvents.statuslineRendered(
      eventContext,
      {
        displayMode: result.displayMode,
        staleData: result.staleData,
      },
      {
        model: result.viewModel.model,
        tokens: parseInt(result.viewModel.tokens.replace(/[^0-9]/g, ''), 10) || undefined,
        durationMs,
      }
    )
    logEvent(logger, event)

    return { exitCode: 0 }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime)

    // Graceful degradation - output minimal statusline on error
    if (format === 'json') {
      stdout.write(JSON.stringify({ error: 'render_failed' }) + '\n')
    } else {
      stdout.write('[sidekick]\n')
    }

    // Emit structured StatuslineError event
    const event = LogEvents.statuslineError(eventContext, 'unknown', {
      fallbackUsed: true,
      error: error instanceof Error ? error.message : String(error),
    })
    logEvent(logger, event)

    // Also log with duration for telemetry
    logger.warn('Statusline render failed', { durationMs })

    return { exitCode: 0 } // Don't fail the shell prompt on error
  }
}
