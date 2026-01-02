/**
 * StatuslineService - Main orchestration for statusline rendering
 *
 * Coordinates data fetching (StateReader, GitProvider) and formatting
 * to produce the final statusline output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.1 StatuslineService
 */

import type { Logger } from '@sidekick/types'

/** Minimal config service interface for feature packages */
interface MinimalConfigService {
  getFeature<T>(name: string): { settings: T }
}
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
import { readContextOverhead, getDefaultOverhead, type ContextOverhead } from './context-overhead-reader.js'
import type {
  DisplayMode,
  FirstPromptSummaryState,
  ResumeMessageState,
  TranscriptMetricsState,
  SessionSummaryState,
  StateReadResult,
  StatuslineConfig,
  StatuslineRenderResult,
  StatuslineViewModel,
} from './types.js'
import { DEFAULT_PLACEHOLDERS, DEFAULT_STATUSLINE_CONFIG } from './types.js'

// ============================================================================
// Claude Code Hook Input Types
// ============================================================================

/**
 * Model information from Claude Code status hook.
 */
export interface ClaudeCodeModel {
  /** Model identifier (e.g., "claude-opus-4-1") */
  id: string
  /** Human-readable display name (e.g., "Opus") */
  display_name: string
}

/**
 * Workspace information from Claude Code status hook.
 */
export interface ClaudeCodeWorkspace {
  /** Current working directory */
  current_dir: string
  /** Original project directory (where Claude Code was launched) */
  project_dir: string
}

/**
 * Output style configuration from Claude Code.
 */
export interface ClaudeCodeOutputStyle {
  /** Style name (e.g., "default") */
  name: string
}

/**
 * Cost and duration metrics from Claude Code status hook.
 */
export interface ClaudeCodeCost {
  /** Total accumulated cost in USD */
  total_cost_usd: number
  /** Total wall-clock duration in milliseconds */
  total_duration_ms: number
  /** Total time spent in API calls in milliseconds */
  total_api_duration_ms: number
  /** Total lines of code added during session */
  total_lines_added: number
  /** Total lines of code removed during session */
  total_lines_removed: number
}

/**
 * Current context window usage from Claude Code.
 */
export interface ClaudeCodeCurrentUsage {
  /** Input tokens in current context */
  input_tokens: number
  /** Output tokens in current context */
  output_tokens: number
  /** Tokens used for cache creation */
  cache_creation_input_tokens: number
  /** Tokens read from cache */
  cache_read_input_tokens: number
}

/**
 * Context window information from Claude Code status hook.
 */
export interface ClaudeCodeContextWindow {
  /** Cumulative input tokens across session */
  total_input_tokens: number
  /** Cumulative output tokens across session */
  total_output_tokens: number
  /** Maximum context window size for the model */
  context_window_size: number
  /** Current context window usage (resets on compact). May be null at session start. */
  current_usage: ClaudeCodeCurrentUsage | null
}

/**
 * Complete status hook input from Claude Code.
 * This is the exact structure passed to statusline hooks.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */
export interface ClaudeCodeStatusInput {
  /** Event type (always "Status" for statusline hooks) */
  hook_event_name: 'Status'
  /** Session identifier */
  session_id: string
  /** Path to the transcript JSON file */
  transcript_path: string
  /** Current working directory */
  cwd: string
  /** Model information */
  model: ClaudeCodeModel
  /** Workspace paths */
  workspace: ClaudeCodeWorkspace
  /** Claude Code version */
  version: string
  /** Output style configuration */
  output_style: ClaudeCodeOutputStyle
  /** Cost and duration metrics */
  cost: ClaudeCodeCost
  /** Context window information */
  context_window: ClaudeCodeContextWindow
}

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
  /** Config service for loading settings from the config cascade */
  configService?: MinimalConfigService
  /** Whether session was resumed (affects display mode) */
  isResumedSession?: boolean
  /** Whether to output ANSI colors */
  useColors?: boolean
  /** Path to sessions directory for artifact discovery (e.g., .sidekick/sessions/) */
  sessionsDir?: string
  /** Current session ID for excluding from discovery */
  currentSessionId?: string
  /**
   * Complete status input from Claude Code hook.
   * When provided, uses these directly instead of reading state files.
   */
  hookInput?: ClaudeCodeStatusInput
  /**
   * Optional logger for debug output.
   * When provided, logs intermediate values for troubleshooting token calculations.
   */
  logger?: Logger
  /**
   * User config directory (e.g., ~/.sidekick).
   * Required for reading baseline user context metrics.
   */
  userConfigDir?: string
  /**
   * Project directory (e.g., /path/to/project).
   * Required for reading baseline project context metrics.
   */
  projectDir?: string
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
  private readonly hookInput?: ClaudeCodeStatusInput
  private readonly logger?: Logger
  private readonly userConfigDir?: string
  private readonly projectDir?: string

  constructor(serviceConfig: StatuslineServiceConfig) {
    // Build config from cascade: configService takes precedence, then direct config, then defaults
    this.config = this.buildConfig(serviceConfig)
    this.cwd = serviceConfig.cwd
    this.homeDir = serviceConfig.homeDir
    this.isResumedSession = serviceConfig.isResumedSession ?? false
    this.useColors = serviceConfig.useColors ?? true
    this.sessionsDir = serviceConfig.sessionsDir
    this.currentSessionId = serviceConfig.currentSessionId
    this.hookInput = serviceConfig.hookInput
    this.logger = serviceConfig.logger
    this.userConfigDir = serviceConfig.userConfigDir
    this.projectDir = serviceConfig.projectDir

    this.stateReader = createStateReader(serviceConfig.sessionStateDir)
    this.gitProvider = createGitProvider(serviceConfig.cwd)
    this.formatter = createFormatter({
      theme: this.config.theme,
      useColors: this.useColors,
    })
  }

  /**
   * Build the final StatuslineConfig.
   * Priority: configService cascade > direct config > defaults
   */
  private buildConfig(serviceConfig: StatuslineServiceConfig): StatuslineConfig {
    if (serviceConfig.configService) {
      const featureConfig = serviceConfig.configService.getFeature<Partial<StatuslineConfig>>('statusline')
      return {
        ...DEFAULT_STATUSLINE_CONFIG,
        ...featureConfig.settings,
        ...(serviceConfig.config ?? {}),
      }
    }
    return { ...DEFAULT_STATUSLINE_CONFIG, ...serviceConfig.config }
  }

  /**
   * Render the statusline by fetching all data in parallel and formatting.
   *
   * Performance target: <50ms total execution time.
   *
   * When hookInput is provided (from Claude Code), uses those values directly
   * for model/tokens/cost/duration instead of reading from state files.
   */
  async render(): Promise<StatuslineRenderResult> {
    // Determine what data to fetch based on whether hookInput is available
    // When hookInput is provided, we skip session state (Claude Code gives us metrics)
    // but still need summary/resume/snarky/firstPrompt (Sidekick-specific content)
    const hasHookInput = !!this.hookInput

    // Parallel data fetch (critical for <50ms target)
    // Always fetch transcript metrics for currentContextTokens (needed for accurate post-compaction display)
    // When hookInput provided, we merge currentContextTokens from transcript into hook-based state
    // Also fetch baseline metrics for new session display (when current_usage is 0)
    const [transcriptResult, summaryResult, resumeResult, snarkyResult, firstPromptResult, branchResult, baseline] =
      await Promise.all([
        this.stateReader.getSessionState(),
        this.stateReader.getSessionSummary(),
        this.stateReader.getResumeMessage(),
        this.stateReader.getSnarkyMessage(),
        this.stateReader.getFirstPromptSummary(),
        this.gitProvider.getCurrentBranch(),
        this.readBaselineMetrics(),
      ])

    // Build state: use hook input if available, but always include currentContextTokens from transcript
    const stateResult = hasHookInput
      ? {
          ...this.buildStateFromHookInput(),
          data: {
            ...this.buildStateFromHookInput().data,
            currentContextTokens: transcriptResult.data.currentContextTokens,
          },
        }
      : transcriptResult

    // Artifact discovery: if this is a new session (no meaningful summary yet), try to find
    // a resume message from a previous session per docs/design/FEATURE-RESUME.md §3.1
    let effectiveResumeData = resumeResult.data
    // A session is "new" if it has no title, a placeholder title, or zero confidence
    // The InitSessionState handler creates a default with title="New Session" and confidence=0
    const hasNoMeaningfulSummary =
      !summaryResult.data.session_title ||
      summaryResult.data.session_title === '' ||
      (summaryResult.data.session_title_confidence ?? 0) === 0

    if (hasNoMeaningfulSummary && !effectiveResumeData && this.sessionsDir && this.currentSessionId) {
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
      branchResult.branch,
      baseline
    )

    // Format output
    let text = this.formatter.format(this.config.format, viewModel)

    // Stale indicator: only transcript metrics can be stale (Supervisor heartbeat).
    // Content artifacts (summary, snarky, resume, first-prompt) are point-in-time
    // and remain valid until regenerated - they don't indicate Supervisor health.
    // See docs/design/FEATURE-STATUSLINE.md §8.2
    const staleData = !hasHookInput && stateResult.source === 'stale'

    // Append visual stale indicator
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
   * Build a synthetic StateReadResult from hook input.
   * Used when Claude Code provides metrics directly in the statusline input.
   * Only returns token-related data; cost/duration/model come from hookInput at display time.
   */
  private buildStateFromHookInput(): StateReadResult<TranscriptMetricsState> {
    const ctx = this.hookInput!.context_window
    const totalTokens = ctx.total_input_tokens + ctx.total_output_tokens

    return {
      data: {
        sessionId: this.hookInput!.session_id,
        lastUpdatedAt: Date.now(),
        tokens: {
          input: ctx.total_input_tokens,
          output: ctx.total_output_tokens,
          total: totalTokens,
          cacheCreation: ctx.current_usage?.cache_creation_input_tokens ?? 0,
          cacheRead: ctx.current_usage?.cache_read_input_tokens ?? 0,
        },
      },
      source: 'fresh', // Hook input is always fresh
    }
  }

  /**
   * Read baseline context metrics for new session display.
   * Returns combined user + project baseline metrics, falling back to defaults if not available.
   */
  private async readBaselineMetrics(): Promise<ContextOverhead> {
    if (this.userConfigDir && this.projectDir) {
      try {
        this.logger?.debug('Reading baseline context overhead metrics', {
          userConfigDir: this.userConfigDir,
          projectDir: this.projectDir,
        })
        const overhead = await readContextOverhead({
          userConfigDir: this.userConfigDir,
          projectDir: this.projectDir,
        })
        this.logger?.debug('Successfully read baseline context overhead metrics', { overhead })
        return overhead
      } catch (error) {
        this.logger?.warn('Failed to read baseline context overhead metrics, using defaults', { error })
        // Fall through to defaults
      }
    }
    const defaultOverhead = getDefaultOverhead()
    this.logger?.debug('Using default baseline context overhead metrics', { defaultOverhead })
    return defaultOverhead
  }

  /**
   * Build the view model from raw state data.
   * Implements display mode selection per docs/design/FEATURE-STATUSLINE.md §6.2.
   *
   * Token data comes from hookInput's current_usage (Claude Code's statusline input).
   * When current_usage is 0 (new session or /clear), uses baseline metrics.
   * Cost, duration, and model also come from hookInput.
   */
  private buildViewModel(
    state: TranscriptMetricsState,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string,
    firstPromptSummary: FirstPromptSummaryState | null,
    branch: string,
    baseline: ContextOverhead
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

    // Calculate effective tokens for display
    // Use current_usage from hook input: sum of input + cache tokens represents actual context window usage
    // current_usage resets on compact, so it accurately reflects post-compaction state
    const isIndeterminate = state.isPostCompactIndeterminate === true
    let effectiveTokens: number
    let usingBaseline = false
    let usingTranscript = false

    if (this.hookInput) {
      const usage = this.hookInput.context_window.current_usage

      if (usage) {
        // Normal case: use current_usage from hook input
        effectiveTokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
      } else {
        // current_usage is null (can happen at session start) - fallback to transcript metrics
        // This prevents "flashing" baseline values when hook input arrives before current_usage is populated
        const transcriptTokens = state.currentContextTokens
        if (transcriptTokens != null && transcriptTokens > 0) {
          effectiveTokens = transcriptTokens
          usingTranscript = true
        } else {
          // No transcript data either, use baseline
          effectiveTokens = 0
        }
      }

      // When effectiveTokens is 0 (new session, /clear, or no data), use baseline estimate
      // Baseline = systemPromptTokens + systemToolsTokens + mcpToolsTokens + customAgentsTokens + memoryFilesTokens
      // Note: autocompactBufferTokens is NOT included as it's reserved buffer, not actual usage
      if (effectiveTokens === 0) {
        effectiveTokens =
          baseline.systemPromptTokens +
          baseline.systemToolsTokens +
          baseline.mcpToolsTokens +
          baseline.customAgentsTokens +
          baseline.memoryFilesTokens
        usingBaseline = true
      }
    } else {
      // Fallback when no hook input (shouldn't happen in normal statusline flow)
      effectiveTokens = state.currentContextTokens ?? state.tokens.total
    }

    // Debug logging for token calculation tracing
    this.logger?.debug('Statusline token calculation', {
      hookInput: this.hookInput
        ? {
            currentUsage: this.hookInput.context_window.current_usage,
            contextWindowSize: this.hookInput.context_window.context_window_size,
          }
        : null,
      baseline: usingBaseline
        ? {
            systemPromptTokens: baseline.systemPromptTokens,
            systemToolsTokens: baseline.systemToolsTokens,
            mcpToolsTokens: baseline.mcpToolsTokens,
            customAgentsTokens: baseline.customAgentsTokens,
            memoryFilesTokens: baseline.memoryFilesTokens,
            usingDefaults: baseline.usingDefaults,
          }
        : null,
      transcriptMetrics: usingTranscript
        ? {
            currentContextTokens: state.currentContextTokens,
          }
        : null,
      calculation: {
        effectiveTokens,
        isIndeterminate,
        usingBaseline,
        usingTranscript,
      },
    })

    // Calculate context usage using effective tokens (respects compaction/clear)
    // Must use effectiveTokens, not raw hook input, so bar graph matches token display
    // Pass autocompactBufferTokens for the buffer portion of the bar
    const contextUsage = this.hookInput?.context_window.context_window_size
      ? calculateContextUsage(
          effectiveTokens,
          baseline.autocompactBufferTokens,
          this.hookInput.context_window.context_window_size
        )
      : undefined

    // Get cost/duration/model from hook input (Claude Code's statusline input)
    const costUsd = this.hookInput?.cost.total_cost_usd ?? 0
    const durationMs = this.hookInput?.cost.total_duration_ms ?? 0
    const modelName = this.hookInput?.model.display_name ?? 'unknown'

    // Format tokens - show compound format context|total (matches /context report)
    // Total includes autocompact buffer for accurate comparison with /context output
    const totalWithBuffer = effectiveTokens + baseline.autocompactBufferTokens
    const tokensDisplay = isIndeterminate
      ? '⟳ compacted'
      : `${formatTokens(effectiveTokens)}|${formatTokens(totalWithBuffer)}`

    return {
      model: this.formatModelName(modelName),
      tokens: tokensDisplay,
      tokensStatus: isIndeterminate ? 'normal' : getThresholdStatus(effectiveTokens, this.config.thresholds.tokens),
      cost: formatCost(costUsd),
      costStatus: getThresholdStatus(costUsd, this.config.thresholds.cost),
      duration: formatDuration(durationMs),
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

    // Priority 4: Discovered resume message from previous session
    // Show this when we have no confident summary (new session with placeholder)
    // This provides context about what the user was working on before
    if (resume) {
      return 'resume_message'
    }

    // Priority 5: Low-confidence session summary (better than nothing)
    if (hasSummary) {
      return 'session_summary'
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
      case 'resume_message': {
        // Format: "{resume_last_goal_message} ({snarky_comment})"
        const goalMessage = resume?.resume_last_goal_message || DEFAULT_PLACEHOLDERS.newSession
        const snarky = resume?.snarky_comment
        const summaryText = snarky ? `${goalMessage} (${snarky})` : goalMessage
        return {
          summaryText,
          title: summary.session_title || '',
        }
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
        let summaryText = ''
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
