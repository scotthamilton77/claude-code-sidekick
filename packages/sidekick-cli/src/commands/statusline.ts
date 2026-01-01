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
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */

import * as path from 'node:path'
import type { Logger, ConfigService } from '@sidekick/core'
import { LogEvents, logEvent, type EventLogContext } from '@sidekick/core'
// Re-export for use by CLI
export type { ClaudeCodeStatusInput } from '@sidekick/feature-statusline'
import type { ClaudeCodeStatusInput } from '@sidekick/feature-statusline'

export interface StatuslineCommandOptions {
  /** Output format: 'text' (ANSI) or 'json' (raw data) */
  format?: 'text' | 'json'
  /** Session ID (defaults to current session detection) */
  sessionId?: string
  /** Whether the session was resumed */
  isResumed?: boolean
  /** Complete status input from Claude Code hook */
  hookInput?: ClaudeCodeStatusInput
  /** Config service for loading settings from the config cascade */
  configService?: ConfigService
}

/**
 * Parse and validate ClaudeCodeStatusInput from raw hook input JSON.
 * Returns the validated input or undefined if parsing fails.
 */
export function parseStatuslineInput(raw: Record<string, unknown>): ClaudeCodeStatusInput | undefined {
  // Validate required top-level fields
  // Note: hook_event_name is NOT sent by Claude Code for statusline hooks,
  // so we don't validate it - we hardcode 'Status' in the return value
  if (typeof raw.session_id !== 'string') return undefined
  if (typeof raw.transcript_path !== 'string') return undefined
  if (typeof raw.cwd !== 'string') return undefined
  if (typeof raw.version !== 'string') return undefined

  // Validate model
  const model = raw.model as { id?: string; display_name?: string } | undefined
  if (!model?.id || !model?.display_name) return undefined

  // Validate workspace
  const workspace = raw.workspace as { current_dir?: string; project_dir?: string } | undefined
  if (!workspace?.current_dir || !workspace?.project_dir) return undefined

  // Validate output_style
  const outputStyle = raw.output_style as { name?: string } | undefined
  if (!outputStyle?.name) return undefined

  // Validate cost
  const cost = raw.cost as
    | {
        total_cost_usd?: number
        total_duration_ms?: number
        total_api_duration_ms?: number
        total_lines_added?: number
        total_lines_removed?: number
      }
    | undefined
  if (
    typeof cost?.total_cost_usd !== 'number' ||
    typeof cost?.total_duration_ms !== 'number' ||
    typeof cost?.total_api_duration_ms !== 'number' ||
    typeof cost?.total_lines_added !== 'number' ||
    typeof cost?.total_lines_removed !== 'number'
  )
    return undefined

  // Validate context_window
  const contextWindow = raw.context_window as
    | {
        total_input_tokens?: number
        total_output_tokens?: number
        context_window_size?: number
        current_usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }
      }
    | undefined
  if (
    typeof contextWindow?.total_input_tokens !== 'number' ||
    typeof contextWindow?.total_output_tokens !== 'number' ||
    typeof contextWindow?.context_window_size !== 'number' ||
    typeof contextWindow?.current_usage?.input_tokens !== 'number' ||
    typeof contextWindow?.current_usage?.output_tokens !== 'number' ||
    typeof contextWindow?.current_usage?.cache_creation_input_tokens !== 'number' ||
    typeof contextWindow?.current_usage?.cache_read_input_tokens !== 'number'
  )
    return undefined

  return {
    hook_event_name: 'Status',
    session_id: raw.session_id,
    transcript_path: raw.transcript_path,
    cwd: raw.cwd,
    version: raw.version,
    model: {
      id: model.id,
      display_name: model.display_name,
    },
    workspace: {
      current_dir: workspace.current_dir,
      project_dir: workspace.project_dir,
    },
    output_style: {
      name: outputStyle.name,
    },
    cost: {
      total_cost_usd: cost.total_cost_usd,
      total_duration_ms: cost.total_duration_ms,
      total_api_duration_ms: cost.total_api_duration_ms,
      total_lines_added: cost.total_lines_added,
      total_lines_removed: cost.total_lines_removed,
    },
    context_window: {
      total_input_tokens: contextWindow.total_input_tokens,
      total_output_tokens: contextWindow.total_output_tokens,
      context_window_size: contextWindow.context_window_size,
      current_usage: {
        input_tokens: contextWindow.current_usage.input_tokens,
        output_tokens: contextWindow.current_usage.output_tokens,
        cache_creation_input_tokens: contextWindow.current_usage.cache_creation_input_tokens,
        cache_read_input_tokens: contextWindow.current_usage.cache_read_input_tokens,
      },
    },
  }
}

export interface StatuslineCommandResult {
  exitCode: number
}

/**
 * Handle the statusline command.
 *
 * This is designed for minimal latency - it should complete in <50ms.
 * When hookInput is provided, uses data directly from Claude Code instead of state files.
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
  // Falls back to 'current' for interactive mode
  const sidekickDir = path.join(projectDir, '.sidekick')
  const sessionId = options.sessionId ?? 'current'
  const sessionStateDir = path.join(sidekickDir, 'sessions', sessionId, 'state')

  // Build event context for structured logging
  const eventContext: EventLogContext = {
    sessionId,
    scope: 'project',
  }

  // Use cwd from hook input if available, otherwise fall back to process.cwd()
  const cwd = options.hookInput?.cwd ?? process.cwd()

  // Debug log the hook input being passed to the service
  logger.debug('Statusline hookInput received', { hookInput: options.hookInput })
  if (options.hookInput?.context_window) {
    logger.debug('ClaudeCodeContextWindow', { context_window: options.hookInput.context_window })
  }

  const service = createStatuslineService({
    sessionStateDir,
    cwd,
    homeDir: process.env.HOME,
    isResumedSession: options.isResumed ?? false,
    useColors,
    // Pass hook input directly - service will use these instead of reading state files
    hookInput: options.hookInput,
    // Pass config service for cascade-based configuration
    configService: options.configService,
    // Pass logger for debug output in token calculations
    logger,
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
