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
 * Parse ClaudeCodeStatusInput from raw hook input JSON.
 * Uses lenient parsing with defaults - for a statusline, showing 0/"unknown"
 * is better than failing entirely. Only truly required: session_id and cwd.
 */
export function parseStatuslineInput(raw: Record<string, unknown>): ClaudeCodeStatusInput | undefined {
  // Only session_id and cwd are truly required - we need to know which session and where
  if (typeof raw.session_id !== 'string') return undefined
  if (typeof raw.cwd !== 'string') return undefined

  // Extract nested objects with safe typing
  const model = raw.model as { id?: string; display_name?: string } | undefined
  const workspace = raw.workspace as { current_dir?: string; project_dir?: string } | undefined
  const outputStyle = raw.output_style as { name?: string } | undefined
  const cost = raw.cost as
    | {
        total_cost_usd?: number
        total_duration_ms?: number
        total_api_duration_ms?: number
        total_lines_added?: number
        total_lines_removed?: number
      }
    | undefined
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
        } | null
      }
    | undefined
  const currentUsage = contextWindow?.current_usage

  // Helper to safely extract numbers with default
  const num = (val: unknown, fallback: number): number => (typeof val === 'number' ? val : fallback)

  return {
    hook_event_name: 'Status',
    session_id: raw.session_id,
    transcript_path: typeof raw.transcript_path === 'string' ? raw.transcript_path : '',
    cwd: raw.cwd,
    version: typeof raw.version === 'string' ? raw.version : 'unknown',
    model: {
      id: model?.id ?? 'unknown',
      display_name: model?.display_name ?? 'unknown',
    },
    workspace: {
      current_dir: workspace?.current_dir ?? raw.cwd,
      project_dir: workspace?.project_dir ?? raw.cwd,
    },
    output_style: {
      name: outputStyle?.name ?? 'default',
    },
    cost: {
      total_cost_usd: num(cost?.total_cost_usd, 0),
      total_duration_ms: num(cost?.total_duration_ms, 0),
      total_api_duration_ms: num(cost?.total_api_duration_ms, 0),
      total_lines_added: num(cost?.total_lines_added, 0),
      total_lines_removed: num(cost?.total_lines_removed, 0),
    },
    context_window: {
      total_input_tokens: num(contextWindow?.total_input_tokens, 0),
      total_output_tokens: num(contextWindow?.total_output_tokens, 0),
      // Default to 200k if not specified - reasonable for Claude models
      context_window_size: num(contextWindow?.context_window_size, 200_000),
      current_usage: {
        input_tokens: num(currentUsage?.input_tokens, 0),
        output_tokens: num(currentUsage?.output_tokens, 0),
        cache_creation_input_tokens: num(currentUsage?.cache_creation_input_tokens, 0),
        cache_read_input_tokens: num(currentUsage?.cache_read_input_tokens, 0),
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

  // userConfigDir is ~/.sidekick for baseline user context metrics
  const userConfigDir = process.env.HOME ? path.join(process.env.HOME, '.sidekick') : undefined

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
    // Pass directories for baseline metrics reading (new session display)
    userConfigDir,
    projectDir,
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
