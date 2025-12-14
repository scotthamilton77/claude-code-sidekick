/**
 * StatuslineService - Main orchestration for statusline rendering
 *
 * Coordinates data fetching (StateReader, GitProvider) and formatting
 * to produce the final statusline output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.1 StatuslineService
 */

import {
  Formatter,
  createFormatter,
  formatBranch,
  formatCost,
  formatDuration,
  formatTokens,
  getThresholdStatus,
  shortenPath,
} from './formatter.js'
import { GitProvider, createGitProvider } from './git-provider.js'
import { StateReader, createStateReader, discoverPreviousResumeMessage } from './state-reader.js'
import type {
  DisplayMode,
  FirstPromptSummaryState,
  ResumeMessageState,
  SessionMetricsState,
  SessionSummaryState,
  StatuslineConfig,
  StatuslineRenderResult,
  StatuslineViewModel,
} from './types.js'
import { DEFAULT_PLACEHOLDERS, DEFAULT_STATUSLINE_CONFIG } from './types.js'

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
  /** Path to sessions directory for artifact discovery (e.g., .sidekick/sessions/) */
  sessionsDir?: string
  /** Current session ID for excluding from discovery */
  currentSessionId?: string
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
  private readonly sessionsDir?: string
  private readonly currentSessionId?: string

  constructor(serviceConfig: StatuslineServiceConfig) {
    this.config = { ...DEFAULT_STATUSLINE_CONFIG, ...serviceConfig.config }
    this.cwd = serviceConfig.cwd
    this.homeDir = serviceConfig.homeDir
    this.isResumedSession = serviceConfig.isResumedSession ?? false
    this.useColors = serviceConfig.useColors ?? true
    this.sessionsDir = serviceConfig.sessionsDir
    this.currentSessionId = serviceConfig.currentSessionId

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
    const [stateResult, summaryResult, resumeResult, snarkyResult, firstPromptResult, branchResult] = await Promise.all(
      [
        this.stateReader.getSessionState(),
        this.stateReader.getSessionSummary(),
        this.stateReader.getResumeMessage(),
        this.stateReader.getSnarkyMessage(),
        this.stateReader.getFirstPromptSummary(),
        this.gitProvider.getCurrentBranch(),
      ]
    )

    // Artifact discovery: if this is a new session (no summary yet), try to find
    // a resume message from a previous session per docs/design/FEATURE-RESUME.md §3.1
    let effectiveResumeData = resumeResult.data
    const isNewSession = !summaryResult.data.session_title || summaryResult.data.session_title === ''

    if (isNewSession && !effectiveResumeData && this.sessionsDir && this.currentSessionId) {
      const discovery = await discoverPreviousResumeMessage(this.sessionsDir, this.currentSessionId)
      if (discovery.source === 'discovered' && discovery.data) {
        effectiveResumeData = discovery.data
      }
    }

    // Build view model
    const viewModel = this.buildViewModel(
      stateResult.data,
      summaryResult.data,
      effectiveResumeData,
      snarkyResult.data,
      firstPromptResult.data,
      branchResult.branch
    )

    // Format output
    let text = this.formatter.format(this.config.format, viewModel)

    // Determine if any stale data was used
    const staleData =
      stateResult.source === 'stale' ||
      summaryResult.source === 'stale' ||
      resumeResult.source === 'stale' ||
      snarkyResult.source === 'stale' ||
      firstPromptResult.source === 'stale'

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
    state: SessionMetricsState,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string,
    firstPromptSummary: FirstPromptSummaryState | null,
    branch: string
  ): StatuslineViewModel {
    // Determine display mode (confidence-aware per FEATURE-FIRST-PROMPT-SUMMARY.md §7.1)
    const displayMode = this.determineDisplayMode(summary, resume, firstPromptSummary)

    // Determine summary text based on display mode
    const { summaryText, title } = this.getSummaryContent(
      displayMode,
      summary,
      resume,
      snarkyMessage,
      firstPromptSummary
    )

    return {
      model: this.formatModelName(state.primaryModel || 'unknown'),
      tokens: formatTokens(state.tokens.total),
      tokensStatus: getThresholdStatus(state.tokens.total, this.config.thresholds.tokens),
      cost: formatCost(state.costUsd),
      costStatus: getThresholdStatus(state.costUsd, this.config.thresholds.cost),
      duration: formatDuration(state.durationSeconds * 1000),
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
   * Priority order (per docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §7.1):
   * 1. Resume message (if session was resumed and resume-message exists)
   * 2. Confident session summary (confidence >= threshold)
   * 3. First-prompt summary (when summary missing or low confidence)
   * 4. Low-confidence session summary (better than nothing)
   * 5. Empty (brand new, nothing submitted)
   */
  private determineDisplayMode(
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    firstPromptSummary: FirstPromptSummaryState | null
  ): DisplayMode {
    // Check if we have a meaningful summary
    const hasSummary = summary.session_title && summary.session_title !== ''
    const summaryConfident = (summary.session_title_confidence ?? 0) >= this.config.confidenceThreshold

    // Priority 1: Resume message (explicit session continuation)
    if (resume && this.isResumedSession) {
      return 'resume_message'
    }

    // Priority 2: Confident session summary
    if (hasSummary && summaryConfident) {
      return 'session_summary'
    }

    // Priority 3: First-prompt summary (when summary missing or low confidence)
    if (firstPromptSummary) {
      return 'first_prompt'
    }

    // Priority 4: Low-confidence session summary (better than nothing)
    if (hasSummary) {
      return 'session_summary'
    }

    // Priority 5: Empty (brand new, nothing submitted)
    // Also check for discovered resume message from previous session
    if (resume) {
      return 'resume_message'
    }

    return 'empty_summary'
  }

  /**
   * Get summary content based on display mode.
   */
  private getSummaryContent(
    displayMode: DisplayMode,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string,
    firstPromptSummary: FirstPromptSummaryState | null
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
          summaryText: firstPromptSummary?.message || DEFAULT_PLACEHOLDERS.awaitingFirstTurn,
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
