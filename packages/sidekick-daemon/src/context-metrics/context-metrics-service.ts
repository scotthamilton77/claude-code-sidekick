/**
 * Context Metrics Service
 *
 * Manages capture and storage of Claude Code's context window overhead metrics.
 * Handles both initial capture (via CLI) and ongoing monitoring (via transcript events).
 *
 * @see METRICS_PLAN.md §Step 3
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Logger, HandlerRegistry, TranscriptEvent } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/core'
import type { MinimalStateService } from '@sidekick/types'
import { spawnClaudeCli } from '@sidekick/shared-providers'
import {
  type BaseTokenMetricsState,
  type ProjectContextMetrics,
  type SessionContextMetrics,
  type ParsedContextTable,
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  SessionContextMetricsSchema,
  DEFAULT_BASE_METRICS,
  DEFAULT_PROJECT_METRICS,
} from './types.js'
import { parseContextTable, isContextCommandOutput } from './transcript-parser.js'

// ============================================================================
// Constants
// ============================================================================

/** Timeout for CLI capture (ms) */
const CLI_CAPTURE_TIMEOUT_MS = 30_000

/** Retry interval after capture error (1 hour in ms) */
const CAPTURE_RETRY_INTERVAL_MS = 60 * 60 * 1000

/** Base metrics file name (user-level, in ~/.sidekick/state/) */
const BASE_METRICS_FILE = 'baseline-user-context-token-metrics.json'

/** Project metrics file name (project-level, in .sidekick/state/) */
const PROJECT_METRICS_FILE = 'baseline-project-context-token-metrics.json'

/** Session metrics file name */
const SESSION_METRICS_FILE = 'context-metrics.json'

// ============================================================================
// Service
// ============================================================================

export interface ContextMetricsServiceConfig {
  /** Path to project directory (used for CLI capture working directory) */
  projectDir: string
  /** Logger instance */
  logger: Logger
  /**
   * StateService for project-level state (.sidekick/).
   * Used for project metrics and session metrics.
   */
  projectStateService: MinimalStateService
  /**
   * StateService for user-level state (~/.sidekick/).
   * Used for base metrics. Should be created with stateDir: '' option.
   */
  userStateService: MinimalStateService
  /** Whether to skip CLI capture (for testing) */
  skipCliCapture?: boolean
}

/**
 * Service for managing context metrics capture and storage.
 *
 * Implements two-level state model:
 * - Base metrics: Global (system prompt, tools, autocompact buffer)
 * - Project metrics: Per-project (MCP tools, agents, memory files)
 * - Session metrics: Per-session (full context snapshot)
 */
export class ContextMetricsService {
  private readonly projectDir: string
  private readonly logger: Logger
  private readonly projectStateService: MinimalStateService
  private readonly userStateService: MinimalStateService
  private readonly skipCliCapture: boolean

  constructor(config: ContextMetricsServiceConfig) {
    this.projectDir = config.projectDir
    this.logger = config.logger
    this.projectStateService = config.projectStateService
    this.userStateService = config.userStateService
    this.skipCliCapture = config.skipCliCapture ?? false
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the context metrics service.
   * Writes defaults immediately, then triggers async capture if needed.
   * Will retry capture if previous attempt failed (file has defaults).
   */
  async initialize(): Promise<void> {
    this.logger.info('ContextMetricsService initializing', {
      skipCliCapture: this.skipCliCapture,
    })

    // Try to read existing metrics (returns default if not found)
    const currentMetrics = await this.readBaseMetrics()
    let shouldCapture = false

    if (currentMetrics.capturedFrom === 'defaults') {
      // Check if we recently had an error - wait for retry interval
      const now = Date.now()
      const errorAge = currentMetrics.lastErrorAt ? now - currentMetrics.lastErrorAt : Infinity
      if (currentMetrics.capturedAt === 0) {
        // Never written - write defaults immediately (with timestamp so we know file exists on retry)
        this.logger.info('Writing default base token metrics (file does not exist)')
        await this.writeBaseMetrics({
          ...DEFAULT_BASE_METRICS,
          capturedAt: Date.now(),
        })
        shouldCapture = true
      } else if (errorAge < CAPTURE_RETRY_INTERVAL_MS) {
        this.logger.info('Skipping capture - recent error, will retry later', {
          lastErrorAt: new Date(currentMetrics.lastErrorAt!).toISOString(),
          lastErrorMessage: currentMetrics.lastErrorMessage,
          retryInMs: CAPTURE_RETRY_INTERVAL_MS - errorAge,
        })
      } else {
        this.logger.info('Base metrics file exists but contains defaults, will retry capture', {
          capturedAt: currentMetrics.capturedAt,
          lastErrorAt: currentMetrics.lastErrorAt ? new Date(currentMetrics.lastErrorAt).toISOString() : null,
        })
        shouldCapture = true
      }
    } else {
      this.logger.info('Base token metrics already captured', {
        capturedFrom: currentMetrics.capturedFrom,
        capturedAt: new Date(currentMetrics.capturedAt).toISOString(),
        systemPromptTokens: currentMetrics.systemPromptTokens,
        systemToolsTokens: currentMetrics.systemToolsTokens,
      })
    }

    // Trigger async capture if needed
    if (shouldCapture && !this.skipCliCapture) {
      this.logger.info('Triggering async CLI capture for base metrics')
      void this.captureBaseMetrics().catch((err) => {
        this.logger.warn('Failed to capture base metrics via CLI', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      })
    }
  }

  // ==========================================================================
  // Base Metrics (Global) - User-level state via userStateService
  // ==========================================================================

  /**
   * Get path to base metrics file (user-level).
   */
  private getBaseMetricsPath(): string {
    return this.userStateService.globalStatePath(BASE_METRICS_FILE)
  }

  /**
   * Write base metrics to file (atomic via StateService).
   */
  private async writeBaseMetrics(metrics: BaseTokenMetricsState): Promise<void> {
    const filePath = this.getBaseMetricsPath()
    await this.userStateService.write(filePath, metrics, BaseTokenMetricsStateSchema)
  }

  /**
   * Record a capture error in the base metrics file.
   * Preserves existing metrics but adds error timestamp/message.
   */
  private async recordCaptureError(errorMessage: string): Promise<void> {
    const current = await this.readBaseMetrics()
    const updated: BaseTokenMetricsState = {
      ...current,
      lastErrorAt: Date.now(),
      lastErrorMessage: errorMessage,
    }
    await this.writeBaseMetrics(updated)
    this.logger.debug('Recorded capture error', {
      lastErrorAt: new Date(updated.lastErrorAt!).toISOString(),
      lastErrorMessage: errorMessage,
    })
  }

  /**
   * Read base metrics from file (validated via StateService).
   */
  async readBaseMetrics(): Promise<BaseTokenMetricsState> {
    const filePath = this.getBaseMetricsPath()
    const result = await this.userStateService.read(filePath, BaseTokenMetricsStateSchema, DEFAULT_BASE_METRICS)
    return result.data
  }

  /**
   * Capture base metrics by running `claude -p "/context"`.
   * This is an expensive operation that spawns a new Claude session.
   *
   * IMPORTANT: The Claude CLI does NOT output to stdout. Instead, it writes
   * all output to a transcript file at ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl.
   * We must read the transcript file after the CLI exits to get the /context output.
   */
  private async captureBaseMetrics(): Promise<void> {
    const sessionId = randomUUID()
    const tempDir = path.join('/tmp', 'sidekick', 'context-capture')

    this.logger.info('Capturing base metrics via CLI', {
      sessionId,
      tempDir,
      timeout: CLI_CAPTURE_TIMEOUT_MS,
    })

    try {
      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true })

      // Execute: claude --session-id={uuid} -p "/context"
      // Use temp directory as working directory to avoid project context
      const args = ['--session-id', sessionId, '-p', '/context']

      this.logger.debug('Spawning Claude CLI for /context capture', { args })

      const result = await spawnClaudeCli({
        args,
        cwd: tempDir,
        timeout: CLI_CAPTURE_TIMEOUT_MS,
        maxRetries: 1, // Limited retries for capture (not critical path)
        logger: this.logger,
        providerId: 'context-metrics',
      })

      this.logger.debug('CLI process completed', {
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
      })

      // Read the /context output from the transcript file
      // CLI writes to: ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl
      const output = await this.readContextOutputFromTranscript(tempDir, sessionId)

      if (!output) {
        const errorMessage = 'Failed to extract /context output from transcript'
        this.logger.warn(errorMessage, { sessionId, tempDir })
        await this.recordCaptureError(errorMessage)
        return
      }

      this.logger.debug('Extracted /context output from transcript', {
        outputLength: output.length,
        outputPreview: output.slice(0, 200),
      })

      // Parse the output
      if (isContextCommandOutput(output)) {
        const parsed = parseContextTable(output)
        if (parsed) {
          const metrics: BaseTokenMetricsState = {
            systemPromptTokens: parsed.systemPrompt,
            systemToolsTokens: parsed.systemTools,
            autocompactBufferTokens: parsed.autocompactBuffer,
            capturedAt: Date.now(),
            capturedFrom: 'context_command',
            sessionId,
            // Clear error state on success
            lastErrorAt: null,
            lastErrorMessage: null,
          }

          await this.writeBaseMetrics(metrics)
          this.logger.info('Base metrics captured successfully', {
            systemPromptTokens: metrics.systemPromptTokens,
            systemToolsTokens: metrics.systemToolsTokens,
            autocompactBufferTokens: metrics.autocompactBufferTokens,
            sessionId,
          })
          return
        } else {
          const errorMessage = 'Failed to parse /context table output'
          this.logger.warn(errorMessage, {
            outputLength: output.length,
            outputPreview: output.slice(0, 500),
          })
          await this.recordCaptureError(errorMessage)
        }
      } else {
        const errorMessage = 'Transcript content does not appear to be /context output'
        this.logger.warn(errorMessage, {
          outputLength: output.length,
          outputPreview: output.slice(0, 500),
          hasLocalCommandTag: output.includes('<local-command-stdout>'),
          hasSystemPrompt: output.includes('System prompt'),
          hasSystemTools: output.includes('System tools'),
        })
        await this.recordCaptureError(errorMessage)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.logger.warn('CLI capture failed', {
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
      })
      await this.recordCaptureError(errorMessage)
    }
  }

  /**
   * Read the /context output from the transcript file.
   *
   * Claude CLI writes output to: ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl
   * where encoded-cwd replaces / with - (e.g., /tmp/foo → -tmp-foo)
   *
   * @returns The content containing <local-command-stdout>, or null if not found
   */
  private async readContextOutputFromTranscript(cwd: string, sessionId: string): Promise<string | null> {
    try {
      // Resolve symlinks (macOS /tmp → /private/tmp)
      const resolvedCwd = await fs.realpath(cwd)

      // Encode the cwd path: /private/tmp/foo → -private-tmp-foo
      const encodedPath = resolvedCwd.replace(/\//g, '-').replace(/^-/, '-')

      // Build transcript path
      const transcriptPath = path.join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)

      this.logger.debug('Reading transcript file', { transcriptPath })

      // Wait a moment for file system to sync
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Check if file exists
      try {
        await fs.access(transcriptPath)
      } catch {
        this.logger.warn('Transcript file not found', { transcriptPath })
        return null
      }

      // Read and parse the transcript
      const content = await fs.readFile(transcriptPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      // Find the line with <local-command-stdout> containing /context output
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { message?: { content?: string } }
          const messageContent = entry.message?.content
          if (typeof messageContent === 'string' && messageContent.includes('<local-command-stdout>')) {
            return messageContent
          }
        } catch {
          // Skip unparseable lines
        }
      }

      this.logger.warn('No /context output found in transcript', {
        transcriptPath,
        lineCount: lines.length,
      })
      return null
    } catch (err) {
      this.logger.warn('Failed to read transcript file', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  // ==========================================================================
  // Project Metrics - Project-level state via projectStateService
  // ==========================================================================

  /**
   * Get path to project metrics file (project-level).
   */
  private getProjectMetricsPath(): string {
    return this.projectStateService.globalStatePath(PROJECT_METRICS_FILE)
  }

  /**
   * Read project metrics from file (validated via StateService).
   */
  async readProjectMetrics(): Promise<ProjectContextMetrics> {
    const filePath = this.getProjectMetricsPath()
    const result = await this.projectStateService.read(filePath, ProjectContextMetricsSchema, DEFAULT_PROJECT_METRICS)
    return result.data
  }

  /**
   * Write project metrics to file (atomic via StateService).
   */
  private async writeProjectMetrics(metrics: ProjectContextMetrics): Promise<void> {
    const filePath = this.getProjectMetricsPath()
    await this.projectStateService.write(filePath, metrics, ProjectContextMetricsSchema)
  }

  // ==========================================================================
  // Session Metrics - Session-level state via projectStateService
  // ==========================================================================

  /**
   * Get path to session metrics file.
   */
  private getSessionMetricsPath(sessionId: string): string {
    return this.projectStateService.sessionStatePath(sessionId, SESSION_METRICS_FILE)
  }

  /**
   * Read session metrics from file (validated via StateService).
   */
  async readSessionMetrics(sessionId: string): Promise<SessionContextMetrics | null> {
    const filePath = this.getSessionMetricsPath(sessionId)
    const result = await this.projectStateService.read(filePath, SessionContextMetricsSchema, null)
    return result.data
  }

  /**
   * Write session metrics to file (atomic via StateService).
   */
  private async writeSessionMetrics(sessionId: string, metrics: SessionContextMetrics): Promise<void> {
    const filePath = this.getSessionMetricsPath(sessionId)
    await this.projectStateService.write(filePath, metrics, SessionContextMetricsSchema)
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Handle transcript content that may contain /context output.
   * Called by transcript event handlers when new content is observed.
   *
   * @param sessionId - Session ID where content was observed
   * @param content - Transcript message content
   * @returns true if metrics were updated
   */
  async handleTranscriptContent(sessionId: string, content: string): Promise<boolean> {
    if (!isContextCommandOutput(content)) {
      return false
    }

    const parsed = parseContextTable(content)
    if (!parsed) {
      this.logger.debug('Failed to parse /context output', { sessionId })
      return false
    }

    this.logger.info('Detected /context output in transcript', {
      sessionId,
      systemPrompt: parsed.systemPrompt,
      systemTools: parsed.systemTools,
      memoryFiles: parsed.memoryFiles,
    })

    // 1. Update session state with current values
    const sessionMetrics: SessionContextMetrics = {
      sessionId,
      systemPromptTokens: parsed.systemPrompt,
      systemToolsTokens: parsed.systemTools,
      mcpToolsTokens: parsed.mcpTools,
      customAgentsTokens: parsed.customAgents,
      memoryFilesTokens: parsed.memoryFiles,
      autocompactBufferTokens: parsed.autocompactBuffer,
      totalOverheadTokens:
        parsed.systemPrompt +
        parsed.systemTools +
        parsed.mcpTools +
        parsed.customAgents +
        parsed.memoryFiles +
        parsed.autocompactBuffer,
      lastUpdatedAt: Date.now(),
    }
    await this.writeSessionMetrics(sessionId, sessionMetrics)

    // 2. Update project state, keeping MINIMUM memory files
    await this.updateProjectMetrics(parsed)

    return true
  }

  /**
   * Update project metrics from parsed context table.
   * Keeps the minimum memory files value (baseline for project).
   */
  private async updateProjectMetrics(parsed: ParsedContextTable): Promise<void> {
    const current = await this.readProjectMetrics()

    // Determine if we should update
    // For memory files: keep the minimum (baseline)
    // For MCP/agents: update if we have new values
    const shouldUpdate =
      current.lastUpdatedAt === 0 ||
      parsed.memoryFiles < current.memoryFilesTokens ||
      parsed.mcpTools !== current.mcpToolsTokens ||
      parsed.customAgents !== current.customAgentsTokens

    if (shouldUpdate) {
      const newMetrics: ProjectContextMetrics = {
        mcpToolsTokens: parsed.mcpTools,
        customAgentsTokens: parsed.customAgents,
        memoryFilesTokens:
          current.lastUpdatedAt === 0 ? parsed.memoryFiles : Math.min(parsed.memoryFiles, current.memoryFilesTokens),
        lastUpdatedAt: Date.now(),
      }

      await this.writeProjectMetrics(newMetrics)
      this.logger.debug('Project metrics updated', {
        mcpTools: newMetrics.mcpToolsTokens,
        customAgents: newMetrics.customAgentsTokens,
        memoryFiles: newMetrics.memoryFilesTokens,
      })
    }
  }

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  /**
   * Get the total fixed overhead tokens for this project.
   * Combines base metrics with project-specific metrics.
   *
   * @returns Total overhead tokens (system + tools + MCP + agents + memory + buffer)
   */
  async getTotalOverhead(): Promise<number> {
    const base = await this.readBaseMetrics()
    const project = await this.readProjectMetrics()

    return (
      base.systemPromptTokens +
      base.systemToolsTokens +
      project.mcpToolsTokens +
      project.customAgentsTokens +
      project.memoryFilesTokens +
      base.autocompactBufferTokens
    )
  }

  /**
   * Get the effective context limit (total window minus overhead).
   *
   * @param contextWindowSize - Total context window size (e.g., 200000)
   * @returns Effective limit for user messages
   */
  async getEffectiveLimit(contextWindowSize: number): Promise<number> {
    const overhead = await this.getTotalOverhead()
    return Math.max(0, contextWindowSize - overhead)
  }

  // ============================================================================
  // Handler Registration
  // ============================================================================

  /**
   * Register transcript event handlers for /context detection.
   * Listens for UserPrompt events containing <local-command-stdout> from /context command.
   *
   * @param handlerRegistry - Handler registry to register with
   */
  registerHandlers(handlerRegistry: HandlerRegistry): void {
    handlerRegistry.register({
      id: 'context-metrics:detect-context-output',
      priority: 50, // Lower priority - non-critical path
      filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
      handler: async (event) => {
        if (!isTranscriptEvent(event as TranscriptEvent)) return

        // Extract message content from the transcript entry
        const entry = (event as TranscriptEvent).payload.entry as { message?: { content?: string } }
        const content = entry.message?.content
        if (!content) return

        // Check for and process /context output
        const sessionId = (event as TranscriptEvent).context.sessionId
        if (sessionId) {
          const updated = await this.handleTranscriptContent(sessionId, content)
          if (updated) {
            this.logger.info('Context metrics updated from /context output', { sessionId })
          }
        }
      },
    })

    this.logger.debug('Context metrics handler registered')
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new ContextMetricsService instance.
 */
export function createContextMetricsService(config: ContextMetricsServiceConfig): ContextMetricsService {
  return new ContextMetricsService(config)
}
