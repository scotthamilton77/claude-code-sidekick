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
  calculateContextUsage,
  createFormatter,
  formatBranch,
  formatCost,
  formatCwd,
  formatDuration,
  formatTokens,
  getBranchColor,
  getThresholdStatus,
} from './formatter.js'
import { GitProvider, createGitProvider } from './git-provider.js'
import { StateReader, createStateReader, discoverPreviousResumeMessage } from './state-reader.js'
import type {
  DisplayMode,
  FirstPromptSummaryState,
  ResumeMessageState,
  SessionMetricsState,
  SessionSummaryState,
  StateReadResult,
  StatuslineConfig,
  StatuslineRenderResult,
  StatuslineViewModel,
} from './types.js'
import { DEFAULT_PLACEHOLDERS, DEFAULT_STATUSLINE_CONFIG } from './types.js'

// ============================================================================
// Service Configuration
// ============================================================================

/**
 * Metrics provided directly by Claude Code in statusline hook input.
 * When provided, these values are used instead of reading from state files.
 *
 * @see https://code.claude.com/docs/en/statusline
 */
export interface HookMetrics {
  /** Model display name (e.g., "Opus") - directly from Claude Code */
  modelDisplayName: string
  /** Model ID (e.g., "claude-opus-4-1") */
  modelId?: string
  /** Total input tokens from context_window */
  totalInputTokens?: number
  /** Total output tokens from context_window */
  totalOutputTokens?: number
  /** Context window size from context_window */
  contextWindowSize?: number
  /** Total cost in USD from cost object */
  totalCostUsd?: number
  /** Total duration in milliseconds from cost object */
  totalDurationMs?: number
  /** Current working directory */
  cwd?: string
}

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
  /**
   * Metrics from Claude Code hook input.
   * When provided, uses these directly instead of reading state files.
   */
  hookMetrics?: HookMetrics
}

// ============================================================================
// StatuslineService
// ============================================================================

/**
 * Main service for rendering the statusline.
 * Orchestrates StateReader, GitProvider, and Formatter.
 *
 * When hookMetrics are provided (from Claude Code's statusline input),
 * uses those directly for model/tokens/cost instead of reading state files.
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
  private readonly hookMetrics?: HookMetrics

  constructor(serviceConfig: StatuslineServiceConfig) {
    this.config = { ...DEFAULT_STATUSLINE_CONFIG, ...serviceConfig.config }
    this.cwd = serviceConfig.cwd
    this.homeDir = serviceConfig.homeDir
    this.isResumedSession = serviceConfig.isResumedSession ?? false
    this.useColors = serviceConfig.useColors ?? true
    this.sessionsDir = serviceConfig.sessionsDir
    this.currentSessionId = serviceConfig.currentSessionId
    this.hookMetrics = serviceConfig.hookMetrics

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
   *
   * When hookMetrics is provided (from Claude Code), uses those values directly
   * for model/tokens/cost/duration instead of reading from state files.
   */
  async render(): Promise<StatuslineRenderResult> {
    // Determine what data to fetch based on whether hookMetrics is available
    // When hookMetrics is provided, we skip session state (Claude Code gives us metrics)
    // but still need summary/resume/snarky/firstPrompt (Sidekick-specific content)
    const hasHookMetrics = !!this.hookMetrics

    // Parallel data fetch (critical for <50ms target)
    // When hookMetrics provided, skip getSessionState() - Claude Code already gave us metrics
    const [stateResult, summaryResult, resumeResult, snarkyResult, firstPromptResult, branchResult] = await Promise.all(
      [
        hasHookMetrics ? Promise.resolve(this.buildStateFromHookMetrics()) : this.stateReader.getSessionState(),
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

    // Determine if any stale data was used (hookMetrics is always fresh)
    const staleData =
      (!hasHookMetrics && stateResult.source === 'stale') ||
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
   * Build a synthetic StateReadResult from hook metrics.
   * Used when Claude Code provides metrics directly in the statusline input.
   */
  private buildStateFromHookMetrics(): StateReadResult<SessionMetricsState> {
    const metrics = this.hookMetrics!
    const totalTokens = (metrics.totalInputTokens ?? 0) + (metrics.totalOutputTokens ?? 0)

    return {
      data: {
        sessionId: '',
        lastUpdatedAt: Date.now(),
        // Use display name directly - Claude Code already formatted it
        primaryModel: metrics.modelDisplayName,
        tokens: {
          input: metrics.totalInputTokens ?? 0,
          output: metrics.totalOutputTokens ?? 0,
          total: totalTokens,
          cacheCreation: 0,
          cacheRead: 0,
        },
        costUsd: metrics.totalCostUsd ?? 0,
        // Convert milliseconds to seconds
        durationSeconds: (metrics.totalDurationMs ?? 0) / 1000,
      },
      source: 'fresh', // Hook metrics are always fresh
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

    // Calculate context usage if hook metrics provide context window data
    const contextUsage = this.hookMetrics
      ? calculateContextUsage(
          this.hookMetrics.totalInputTokens,
          this.hookMetrics.totalOutputTokens,
          this.hookMetrics.contextWindowSize
        )
      : undefined

    return {
      model: this.formatModelName(state.primaryModel || 'unknown'),
      tokens: formatTokens(state.tokens.total),
      tokensStatus: getThresholdStatus(state.tokens.total, this.config.thresholds.tokens),
      cost: formatCost(state.costUsd),
      costStatus: getThresholdStatus(state.costUsd, this.config.thresholds.cost),
      duration: formatDuration(state.durationSeconds * 1000),
      cwd: formatCwd(this.cwd, this.homeDir),
      branch: formatBranch(branch, this.config.theme.useNerdFonts),
      branchColor: getBranchColor(branch),
      displayMode,
      summary: summaryText,
      title,
      snarkyComment: snarkyMessage || undefined,
      contextUsage,
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
