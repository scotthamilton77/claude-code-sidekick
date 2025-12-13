/**
 * StatuslineService - Main orchestration for statusline rendering
 *
 * Coordinates data fetching (StateReader, GitProvider) and formatting
 * to produce the final statusline output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.1 StatuslineService
 */

import type {
  StatuslineConfig,
  StatuslineViewModel,
  StatuslineRenderResult,
  DisplayMode,
  SessionState,
  SessionSummaryState,
  ResumeMessageState,
} from './types.js'
import { DEFAULT_STATUSLINE_CONFIG, DEFAULT_PLACEHOLDERS } from './types.js'
import { StateReader, createStateReader } from './state-reader.js'
import { GitProvider, createGitProvider } from './git-provider.js'
import {
  Formatter,
  createFormatter,
  formatTokens,
  formatCost,
  formatDuration,
  shortenPath,
  formatBranch,
  getThresholdStatus,
} from './formatter.js'

// ============================================================================
// Service Configuration
// ============================================================================

/**
 * Configuration for StatuslineService.
 */
export interface StatuslineServiceConfig {
  /** Path to session state directory */
  sessionStateDir: string
  /** Current working directory */
  cwd: string
  /** User's home directory (for path shortening) */
  homeDir?: string
  /** Statusline configuration (merged with defaults) */
  config?: Partial<StatuslineConfig>
  /** Whether session was resumed (affects display mode) */
  isResumedSession?: boolean
  /** Whether to output ANSI colors */
  useColors?: boolean
}

// ============================================================================
// StatuslineService
// ============================================================================

/**
 * Main service for rendering the statusline.
 * Orchestrates StateReader, GitProvider, and Formatter.
 */
export class StatuslineService {
  private readonly stateReader: StateReader
  private readonly gitProvider: GitProvider
  private readonly formatter: Formatter
  private readonly config: StatuslineConfig
  private readonly cwd: string
  private readonly homeDir?: string
  private readonly isResumedSession: boolean
  private readonly useColors: boolean

  constructor(serviceConfig: StatuslineServiceConfig) {
    this.config = { ...DEFAULT_STATUSLINE_CONFIG, ...serviceConfig.config }
    this.cwd = serviceConfig.cwd
    this.homeDir = serviceConfig.homeDir
    this.isResumedSession = serviceConfig.isResumedSession ?? false
    this.useColors = serviceConfig.useColors ?? true

    this.stateReader = createStateReader(serviceConfig.sessionStateDir)
    this.gitProvider = createGitProvider(serviceConfig.cwd)
    this.formatter = createFormatter({
      theme: this.config.theme,
      useColors: this.useColors,
    })
  }

  /**
   * Render the statusline by fetching all data in parallel and formatting.
   *
   * Performance target: <50ms total execution time.
   */
  async render(): Promise<StatuslineRenderResult> {
    // Parallel data fetch (critical for <50ms target)
    const [stateResult, summaryResult, resumeResult, snarkyResult, branchResult] = await Promise.all([
      this.stateReader.getSessionState(),
      this.stateReader.getSessionSummary(),
      this.stateReader.getResumeMessage(),
      this.stateReader.getSnarkyMessage(),
      this.gitProvider.getCurrentBranch(),
    ])

    // Build view model
    const viewModel = this.buildViewModel(
      stateResult.data,
      summaryResult.data,
      resumeResult.data,
      snarkyResult.data,
      branchResult.branch
    )

    // Format output
    let text = this.formatter.format(this.config.format, viewModel)

    // Determine if any stale data was used
    const staleData =
      stateResult.source === 'stale' ||
      summaryResult.source === 'stale' ||
      resumeResult.source === 'stale' ||
      snarkyResult.source === 'stale'

    // Append visual stale indicator per docs/design/FEATURE-STATUSLINE.md §8.2
    if (staleData) {
      const ANSI_DIM = '\x1b[2m'
      const ANSI_RESET = '\x1b[0m'
      const indicator = this.useColors ? `${ANSI_DIM}(stale)${ANSI_RESET}` : '(stale)'
      text = `${text} ${indicator}`
    }

    return {
      text,
      displayMode: viewModel.displayMode,
      staleData,
      viewModel,
    }
  }

  /**
   * Build the view model from raw state data.
   * Implements display mode selection per docs/design/FEATURE-STATUSLINE.md §6.2.
   */
  private buildViewModel(
    state: SessionState,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string,
    branch: string
  ): StatuslineViewModel {
    // Determine display mode
    const displayMode = this.determineDisplayMode(summary, resume)

    // Determine summary text based on display mode
    const { summaryText, title } = this.getSummaryContent(displayMode, summary, resume, snarkyMessage)

    return {
      model: this.formatModelName(state.modelName),
      tokens: formatTokens(state.tokens),
      tokensStatus: getThresholdStatus(state.tokens, this.config.thresholds.tokens),
      cost: formatCost(state.cost),
      costStatus: getThresholdStatus(state.cost, this.config.thresholds.cost),
      duration: formatDuration(state.durationMs),
      cwd: shortenPath(this.cwd, this.homeDir),
      branch: formatBranch(branch, this.config.theme.useNerdFonts),
      displayMode,
      summary: summaryText,
      title,
      snarkyComment: snarkyMessage || undefined,
    }
  }

  /**
   * Determine display mode based on available data.
   *
   * Priority order (per docs/design/FEATURE-STATUSLINE.md §6.2):
   * 1. Resume message (if session was resumed and resume-message exists)
   * 2. Empty-summary default (no summary yet, new session)
   * 3. First-prompt default (UserPromptSubmit before summary exists)
   * 4. Session summary (normal operation)
   */
  private determineDisplayMode(summary: SessionSummaryState, resume: ResumeMessageState | null): DisplayMode {
    // Check for resume message on resumed sessions
    if (this.isResumedSession && resume) {
      return 'resume_message'
    }

    // Check if we have a meaningful summary
    const hasSummary = summary.session_title && summary.session_title !== ''

    if (!hasSummary) {
      // No summary yet - could be new session or awaiting first turn
      // Use empty_summary for brand new sessions
      return 'empty_summary'
    }

    // Normal operation with summary available
    return 'session_summary'
  }

  /**
   * Get summary content based on display mode.
   */
  private getSummaryContent(
    displayMode: DisplayMode,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string
  ): { summaryText: string; title: string } {
    switch (displayMode) {
      case 'resume_message':
        return {
          summaryText: resume?.resume_last_goal_message || DEFAULT_PLACEHOLDERS.newSession,
          title: summary.session_title || '',
        }

      case 'empty_summary':
        return {
          summaryText: DEFAULT_PLACEHOLDERS.newSession,
          title: '',
        }

      case 'first_prompt':
        return {
          summaryText: DEFAULT_PLACEHOLDERS.awaitingFirstTurn,
          title: '',
        }

      case 'session_summary':
      default: {
        // Priority: snarky message > latest intent > title
        let summaryText = summary.session_title
        if (snarkyMessage) {
          summaryText = snarkyMessage
        } else if (summary.latest_intent) {
          summaryText = summary.latest_intent
        }
        return {
          summaryText,
          title: summary.session_title,
        }
      }
    }
  }

  /**
   * Format model name for display (strip "claude-" prefix if long).
   */
  private formatModelName(modelName: string): string {
    if (!modelName || modelName === 'unknown') return 'unknown'

    // Shorten common model names
    if (modelName.startsWith('claude-')) {
      return modelName.replace('claude-', '')
    }
    return modelName
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Factory function to create StatuslineService.
 */
export function createStatuslineService(config: StatuslineServiceConfig): StatuslineService {
  return new StatuslineService(config)
}
