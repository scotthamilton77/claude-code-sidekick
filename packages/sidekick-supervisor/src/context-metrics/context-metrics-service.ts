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
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { Logger } from '@sidekick/types'
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

/** Base metrics file name */
const BASE_METRICS_FILE = 'base-token-metrics.json'

/** Project metrics file name */
const PROJECT_METRICS_FILE = 'project-context-metrics.json'

/** Session metrics file name */
const SESSION_METRICS_FILE = 'context-metrics.json'

// ============================================================================
// Service
// ============================================================================

export interface ContextMetricsServiceConfig {
  /** Path to project directory */
  projectDir: string
  /** Logger instance */
  logger: Logger
  /** Path to user config directory (defaults to ~/.sidekick) */
  userConfigDir?: string
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
  private readonly userConfigDir: string
  private readonly projectStateDir: string
  private readonly skipCliCapture: boolean

  constructor(config: ContextMetricsServiceConfig) {
    this.projectDir = config.projectDir
    this.logger = config.logger
    this.userConfigDir = config.userConfigDir ?? path.join(homedir(), '.sidekick')
    this.projectStateDir = path.join(config.projectDir, '.sidekick', 'state')
    this.skipCliCapture = config.skipCliCapture ?? false
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the context metrics service.
   * Writes defaults immediately, then triggers async capture if needed.
   */
  async initialize(): Promise<void> {
    const exists = await this.baseMetricsFileExists()

    if (!exists) {
      // 1. Write defaults immediately (statusline can use these right away)
      this.logger.info('Writing default base token metrics')
      await this.writeBaseMetrics(DEFAULT_BASE_METRICS)

      // 2. Async: Capture real metrics (non-blocking)
      if (!this.skipCliCapture) {
        void this.captureBaseMetrics().catch((err) => {
          this.logger.warn('Failed to capture base metrics via CLI', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    } else {
      this.logger.debug('Base token metrics already exist, skipping capture')
    }
  }

  // ==========================================================================
  // Base Metrics (Global)
  // ==========================================================================

  /**
   * Check if base metrics file exists.
   */
  private async baseMetricsFileExists(): Promise<boolean> {
    const filePath = this.getBaseMetricsPath()
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get path to base metrics file.
   */
  private getBaseMetricsPath(): string {
    return path.join(this.userConfigDir, 'state', BASE_METRICS_FILE)
  }

  /**
   * Write base metrics to file.
   */
  private async writeBaseMetrics(metrics: BaseTokenMetricsState): Promise<void> {
    const filePath = this.getBaseMetricsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(metrics, null, 2), 'utf-8')
  }

  /**
   * Read base metrics from file.
   */
  async readBaseMetrics(): Promise<BaseTokenMetricsState> {
    const filePath = this.getBaseMetricsPath()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = BaseTokenMetricsStateSchema.safeParse(JSON.parse(content))
      if (parsed.success) {
        return parsed.data
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return DEFAULT_BASE_METRICS
  }

  /**
   * Capture base metrics by running `claude -p "/context"`.
   * This is an expensive operation that spawns a new Claude session.
   */
  private async captureBaseMetrics(): Promise<void> {
    const sessionId = randomUUID()
    const tempDir = path.join('/tmp', 'sidekick', 'context-capture')

    this.logger.info('Capturing base metrics via CLI', { sessionId })

    try {
      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true })

      // Execute: claude --session-id={uuid} -p "/context"
      // Use temp directory as working directory to avoid project context
      const output = await this.executeClaudeCli(sessionId, tempDir)

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
          }

          await this.writeBaseMetrics(metrics)
          this.logger.info('Base metrics captured successfully', {
            systemPromptTokens: metrics.systemPromptTokens,
            systemToolsTokens: metrics.systemToolsTokens,
            autocompactBufferTokens: metrics.autocompactBufferTokens,
          })
          return
        }
      }

      this.logger.warn('Failed to parse /context output, keeping defaults')
    } catch (err) {
      this.logger.warn('CLI capture failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Execute Claude CLI and return output.
   */
  private executeClaudeCli(sessionId: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['--session-id', sessionId, '-p', '/context']
      const proc = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: CLI_CAPTURE_TIMEOUT_MS,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('error', (err) => {
        reject(err)
      })

      proc.on('close', (code) => {
        if (code === 0) {
          // Wrap output in local-command-stdout tags for parser compatibility
          resolve(`<local-command-stdout>${stdout}</local-command-stdout>`)
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`))
        }
      })

      // Timeout handling
      setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`CLI capture timed out after ${CLI_CAPTURE_TIMEOUT_MS}ms`))
      }, CLI_CAPTURE_TIMEOUT_MS)
    })
  }

  // ==========================================================================
  // Project Metrics
  // ==========================================================================

  /**
   * Get path to project metrics file.
   */
  private getProjectMetricsPath(): string {
    return path.join(this.projectStateDir, PROJECT_METRICS_FILE)
  }

  /**
   * Read project metrics from file.
   */
  async readProjectMetrics(): Promise<ProjectContextMetrics> {
    const filePath = this.getProjectMetricsPath()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = ProjectContextMetricsSchema.safeParse(JSON.parse(content))
      if (parsed.success) {
        return parsed.data
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return DEFAULT_PROJECT_METRICS
  }

  /**
   * Write project metrics to file.
   */
  private async writeProjectMetrics(metrics: ProjectContextMetrics): Promise<void> {
    const filePath = this.getProjectMetricsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(metrics, null, 2), 'utf-8')
  }

  // ==========================================================================
  // Session Metrics
  // ==========================================================================

  /**
   * Get path to session metrics file.
   */
  private getSessionMetricsPath(sessionId: string): string {
    return path.join(this.projectDir, '.sidekick', 'sessions', sessionId, 'state', SESSION_METRICS_FILE)
  }

  /**
   * Read session metrics from file.
   */
  async readSessionMetrics(sessionId: string): Promise<SessionContextMetrics | null> {
    const filePath = this.getSessionMetricsPath(sessionId)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = SessionContextMetricsSchema.safeParse(JSON.parse(content))
      if (parsed.success) {
        return parsed.data
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return null
  }

  /**
   * Write session metrics to file.
   */
  private async writeSessionMetrics(sessionId: string, metrics: SessionContextMetrics): Promise<void> {
    const filePath = this.getSessionMetricsPath(sessionId)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(metrics, null, 2), 'utf-8')
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
