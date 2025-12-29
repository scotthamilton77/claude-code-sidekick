/**
 * Statusline Command Handler
 *
 * Renders the statusline using metrics from Claude Code's hook input.
 * Falls back to session state files for summary data not provided by Claude Code.
 *
 * Usage:
 *   sidekick statusline [--format <text|json>]
 *
 * @see docs/design/FEATURE-STATUSLINE.md §7 Invocation Model
 * @see https://code.claude.com/docs/en/statusline
 */

import * as path from 'node:path'
import type { Logger, ConfigService } from '@sidekick/core'
import { LogEvents, logEvent, type EventLogContext } from '@sidekick/core'

/**
 * Metrics provided directly by Claude Code in statusline hook input.
 * Used to avoid re-reading state files for data Claude Code already provides.
 */
export interface StatuslineHookMetrics {
  /** Model display name (e.g., "Opus") */
  modelDisplayName: string
  /** Model ID (e.g., "claude-opus-4-1") */
  modelId?: string
  /** Total input tokens */
  totalInputTokens?: number
  /** Total output tokens */
  totalOutputTokens?: number
  /** Context window size */
  contextWindowSize?: number
  /** Total cost in USD */
  totalCostUsd?: number
  /** Total duration in milliseconds */
  totalDurationMs?: number
  /** Current working directory from hook input */
  cwd?: string
}

export interface StatuslineCommandOptions {
  /** Output format: 'text' (ANSI) or 'json' (raw data) */
  format?: 'text' | 'json'
  /** Session ID (defaults to current session detection) */
  sessionId?: string
  /** Whether the session was resumed */
  isResumed?: boolean
  /** Metrics from Claude Code hook input (avoids reading state files) */
  hookMetrics?: StatuslineHookMetrics
  /** Config service for loading settings from the config cascade */
  configService?: ConfigService
}

/**
 * Parse StatuslineInput from raw hook input JSON.
 * Returns extracted metrics or undefined if parsing fails.
 */
export function parseStatuslineInput(raw: Record<string, unknown>): StatuslineHookMetrics | undefined {
  // Check for model info - this is required
  const model = raw.model as { id?: string; display_name?: string } | undefined
  if (!model?.display_name) {
    return undefined
  }

  const contextWindow = raw.context_window as
    | {
        total_input_tokens?: number
        total_output_tokens?: number
        context_window_size?: number
      }
    | undefined

  const cost = raw.cost as
    | {
        total_cost_usd?: number
        total_duration_ms?: number
      }
    | undefined

  return {
    modelDisplayName: model.display_name,
    modelId: model.id,
    totalInputTokens: contextWindow?.total_input_tokens,
    totalOutputTokens: contextWindow?.total_output_tokens,
    contextWindowSize: contextWindow?.context_window_size,
    totalCostUsd: cost?.total_cost_usd,
    totalDurationMs: cost?.total_duration_ms,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
  }
}

export interface StatuslineCommandResult {
  exitCode: number
}

/**
 * Handle the statusline command.
 *
 * This is designed for minimal latency - it should complete in <50ms.
 * When hookMetrics is provided, uses data directly from Claude Code instead of state files.
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
  // Session ID extracted from hook input JSON by CLI (per CLI.md §3.1.1)
  // Falls back to 'current' for backward compatibility / interactive mode
  const sidekickDir = path.join(projectDir, '.sidekick')
  const sessionId = options.sessionId ?? 'current'
  const sessionStateDir = path.join(sidekickDir, 'sessions', sessionId, 'state')

  // Build event context for structured logging
  const eventContext: EventLogContext = {
    sessionId,
    scope: 'project',
  }

  // Use cwd from hook input if available, otherwise fall back to process.cwd()
  const cwd = options.hookMetrics?.cwd ?? process.cwd()

  const service = createStatuslineService({
    sessionStateDir,
    cwd,
    homeDir: process.env.HOME,
    isResumedSession: options.isResumed ?? false,
    useColors,
    // Pass hook metrics directly - service will use these instead of reading state files
    hookMetrics: options.hookMetrics,
    // Pass config service for cascade-based configuration
    configService: options.configService,
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
