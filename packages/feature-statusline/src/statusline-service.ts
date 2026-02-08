/**
 * StatuslineService - Main orchestration for statusline rendering
 *
 * Coordinates data fetching (StateReader, GitProvider) and formatting
 * to produce the final statusline output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.1 StatuslineService
 */

import type {
  Logger,
  MinimalStateService,
  MinimalConfigService,
  MinimalAssetResolver,
  SessionPersonaState,
  PersonaDefinition,
  ApiKeyHealth,
} from '@sidekick/types'
import { createPersonaLoader, getDefaultPersonasDir, SetupStatusService, type ApiKeyName, type SetupState } from '@sidekick/core'
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
import {
  normalizeSymbolMode,
  DEFAULT_PLACEHOLDERS,
  DEFAULT_STATUSLINE_CONFIG,
  type DisplayMode,
  type ResumeMessageState,
  TranscriptMetricsState,
  SessionSummaryState,
  StateReadResult,
  StatuslineConfig,
  StatuslineRenderResult,
  StatuslineViewModel,
  LogMetricsState,
} from './types.js'

/**
 * Minimal interface for setup status checking.
 * StatuslineService only needs these two methods from SetupStatusService.
 * This allows tests to provide a simple mock without implementing the full class.
 */
export interface MinimalSetupStatusService {
  getSetupState(): Promise<SetupState>
  getEffectiveApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth>
}

/**
 * Empty base view model for setup_warning display mode.
 * Only `summary` varies per-call; all other fields are static empty/default values.
 */
const EMPTY_STATUSLINE_VIEWMODEL: Omit<StatuslineViewModel, 'summary'> = {
  model: '',
  contextWindow: '',
  tokenUsageActual: '',
  tokenUsageEffective: '',
  tokenPercentageActual: '',
  tokenPercentageEffective: '',
  tokensStatus: 'normal',
  cost: '',
  costStatus: 'normal',
  duration: '',
  cwd: '',
  branch: '',
  branchColor: '',
  displayMode: 'setup_warning',
  title: '',
  warningCount: 0,
  errorCount: 0,
  logStatus: 'normal',
  personaName: '',
} as const

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
  /** StateService for state file operations */
  stateService: MinimalStateService
  /** Current session ID for state file resolution */
  sessionId: string
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
  /**
   * Asset resolver for loading configurable assets.
   * Used to load empty session messages with cascade override support.
   */
  assets?: MinimalAssetResolver
  /**
   * Persona configuration for statusline.
   * Controls resume message freshness and persona-specific behavior.
   */
  personaConfig?: {
    /** Maximum age (hours) for resume messages to be considered fresh */
    resumeFreshnessHours: number
  }
  /**
   * Optional setup status service for health checking.
   * If not provided, creates a default SetupStatusService.
   * Accepts MinimalSetupStatusService for easy test mocking.
   */
  setupService?: MinimalSetupStatusService
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
  private readonly sessionId: string
  private readonly hookInput?: ClaudeCodeStatusInput
  private readonly logger?: Logger
  private readonly userConfigDir?: string
  private readonly projectDir?: string
  private readonly assets?: MinimalAssetResolver
  /** Resume freshness in hours (default: 4) */
  private readonly resumeFreshnessHours: number
  /** Setup status service for health checking */
  private readonly setupService: MinimalSetupStatusService

  constructor(serviceConfig: StatuslineServiceConfig) {
    // Build config from cascade: configService takes precedence, then direct config, then defaults
    this.config = this.buildConfig(serviceConfig)
    this.cwd = serviceConfig.cwd
    this.homeDir = serviceConfig.homeDir
    this.isResumedSession = serviceConfig.isResumedSession ?? false
    this.useColors = serviceConfig.useColors ?? true
    this.sessionsDir = serviceConfig.sessionsDir
    this.sessionId = serviceConfig.sessionId
    this.hookInput = serviceConfig.hookInput
    this.logger = serviceConfig.logger
    this.userConfigDir = serviceConfig.userConfigDir
    this.projectDir = serviceConfig.projectDir
    this.assets = serviceConfig.assets
    this.resumeFreshnessHours = serviceConfig.personaConfig?.resumeFreshnessHours ?? 4

    this.stateReader = createStateReader(serviceConfig.stateService, serviceConfig.sessionId)
    this.gitProvider = createGitProvider(serviceConfig.cwd)
    this.formatter = createFormatter({
      theme: this.config.theme,
      useColors: this.useColors,
    })
    this.setupService =
      serviceConfig.setupService ??
      new SetupStatusService(serviceConfig.projectDir ?? serviceConfig.cwd, {
        homeDir: serviceConfig.homeDir,
        logger: serviceConfig.logger,
      })
  }

  /**
   * Load persona definition for the session.
   * Returns null if no persona is selected or persona not found.
   */
  private loadPersonaDefinition(personaState: SessionPersonaState | null): PersonaDefinition | null {
    if (!personaState || !this.projectDir) {
      return null
    }

    const loader = createPersonaLoader({
      defaultPersonasDir: getDefaultPersonasDir(),
      projectRoot: this.projectDir,
      logger: this.logger,
    })

    const personas = loader.discover()
    return personas.get(personaState.persona_id) ?? null
  }

  /**
   * Get empty session message based on persona.
   * Priority:
   * 1. Persona-specific statusline_empty_messages (if persona exists and has messages)
   * 2. Sidekick persona's statusline_empty_messages
   * 3. Default asset file (statusline-empty-messages.txt)
   * 4. SESSION_SUMMARY_PLACEHOLDERS.newSession
   *
   * For "disabled" persona or no persona selected, uses SESSION_SUMMARY_PLACEHOLDERS.
   *
   * @see docs/design/PERSONA-PROFILES-DESIGN.md - Statusline Empty Messages
   */
  private getEmptySessionMessage(persona: PersonaDefinition | null): string {
    // Disabled persona or no persona: use placeholders
    if (!persona || persona.id === 'disabled') {
      return DEFAULT_PLACEHOLDERS.newSession
    }

    // Try persona-specific empty messages first
    if (persona.statusline_empty_messages && persona.statusline_empty_messages.length > 0) {
      const randomIndex = Math.floor(Math.random() * persona.statusline_empty_messages.length)
      return persona.statusline_empty_messages[randomIndex]
    }

    // Fallback to default asset file (for sidekick persona or personas without messages)
    return this.loadRandomEmptyMessageFromAssets()
  }

  /**
   * Load empty session messages from assets and pick one randomly.
   * Uses the asset resolver cascade to support user/project overrides.
   * Falls back to DEFAULT_PLACEHOLDERS.newSession if not found/empty.
   */
  private loadRandomEmptyMessageFromAssets(): string {
    if (!this.assets) {
      return DEFAULT_PLACEHOLDERS.newSession
    }

    const content = this.assets.resolve('defaults/features/statusline-empty-messages.txt')
    if (!content) {
      return DEFAULT_PLACEHOLDERS.newSession
    }

    const messages = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (messages.length === 0) {
      return DEFAULT_PLACEHOLDERS.newSession
    }

    const randomIndex = Math.floor(Math.random() * messages.length)
    return messages[randomIndex]
  }

  /**
   * Check if resume message is still fresh based on timestamp.
   * Returns false if resume is older than resumeFreshnessHours.
   *
   * @see docs/design/PERSONA-PROFILES-DESIGN.md - Resume Message Freshness
   */
  private isResumeFresh(resumeTimestamp: string | undefined): boolean {
    if (!resumeTimestamp) {
      return false
    }

    const resumeTime = new Date(resumeTimestamp).getTime()
    const ageMs = Date.now() - resumeTime
    const freshnessMs = this.resumeFreshnessHours * 60 * 60 * 1000
    return ageMs < freshnessMs
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
   * Check setup status and return warning message if unhealthy.
   * Returns empty warning for healthy state.
   */
  private async checkSetupStatus(): Promise<{ warning: string; state: SetupState }> {
    const state = await this.setupService.getSetupState()

    switch (state) {
      case 'not-run':
        return {
          warning: "Sidekick not configured. Run 'sidekick setup' to get started.",
          state,
        }
      case 'partial':
        return {
          warning: "Project not configured. Run 'sidekick setup' for this project.",
          state,
        }
      case 'unhealthy': {
        // Check both API keys to determine which is the problem
        const keysToCheck: ApiKeyName[] = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY']
        for (const keyName of keysToCheck) {
          const keyHealth = await this.setupService.getEffectiveApiKeyHealth(keyName)
          if (keyHealth === 'missing') {
            return {
              warning: `${keyName} not found. Run 'sidekick doctor' or /sidekick-config`,
              state,
            }
          }
          if (keyHealth === 'invalid') {
            return {
              warning: `${keyName} invalid. Run 'sidekick doctor' to fix.`,
              state,
            }
          }
        }
        return {
          warning: "Setup issue detected. Run 'sidekick doctor'.",
          state,
        }
      }
      default:
        return { warning: '', state: 'healthy' }
    }
  }

  /**
   * Build minimal view model for setup_warning display mode.
   * Only includes fields needed for warning display.
   */
  private buildMinimalViewModel(setupCheck: { warning: string; state: SetupState }): StatuslineViewModel {
    return {
      ...EMPTY_STATUSLINE_VIEWMODEL,
      summary: setupCheck.warning,
    }
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
    // Check setup status FIRST - if unhealthy, return only the warning
    const setupCheck = await this.checkSetupStatus()
    if (setupCheck.state !== 'healthy') {
      const viewModel = this.buildMinimalViewModel(setupCheck)
      // Apply yellow color directly (ANSI code)
      const ANSI_YELLOW = '\x1b[33m'
      const ANSI_RESET = '\x1b[0m'
      const text = this.useColors ? `${ANSI_YELLOW}${setupCheck.warning}${ANSI_RESET}` : setupCheck.warning
      return {
        text,
        displayMode: 'setup_warning',
        staleData: false,
        viewModel,
      }
    }

    // Determine what data to fetch based on whether hookInput is available
    // When hookInput is provided, we skip session state (Claude Code gives us metrics)
    // but still need summary/resume/snarky (Sidekick-specific content)
    const hasHookInput = !!this.hookInput

    // Parallel data fetch (critical for <50ms target)
    // Always fetch transcript metrics for currentContextTokens (needed for accurate post-compaction display)
    // When hookInput provided, we merge currentContextTokens from transcript into hook-based state
    // Also fetch baseline metrics for new session display (when current_usage is 0)
    const [
      transcriptResult,
      summaryResult,
      resumeResult,
      snarkyResult,
      branchResult,
      baseline,
      logMetricsResult,
      personaResult,
    ] = await Promise.all([
      this.stateReader.getTranscriptMetrics(),
      this.stateReader.getSessionSummary(),
      this.stateReader.getResumeMessage(),
      this.stateReader.getSnarkyMessage(),
      this.gitProvider.getCurrentBranch(),
      this.readBaselineMetrics(),
      this.stateReader.getLogMetrics(),
      this.stateReader.getSessionPersona(),
    ])

    // Load persona definition if persona is selected
    const persona = this.loadPersonaDefinition(personaResult.data)

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

    if (hasNoMeaningfulSummary && !effectiveResumeData && this.sessionsDir && this.sessionId) {
      const discovery = await discoverPreviousResumeMessage(this.sessionsDir, this.sessionId)
      if (discovery.source === 'discovered' && discovery.data) {
        effectiveResumeData = discovery.data
      }
    }

    // Check resume freshness - skip stale resume messages
    // @see docs/design/PERSONA-PROFILES-DESIGN.md - Resume Message Freshness
    if (effectiveResumeData && !this.isResumeFresh(effectiveResumeData.timestamp)) {
      this.logger?.debug('Resume message is stale, skipping', {
        timestamp: effectiveResumeData.timestamp,
        freshnessHours: this.resumeFreshnessHours,
      })
      effectiveResumeData = null
    }

    // Get empty session message based on persona
    const emptySessionMessage = this.getEmptySessionMessage(persona)

    // Build view model
    const viewModel = this.buildViewModel(
      stateResult.data,
      summaryResult.data,
      effectiveResumeData,
      snarkyResult.data,
      branchResult.branch,
      baseline,
      logMetricsResult.data,
      emptySessionMessage,
      persona
    )

    // Format output
    let text = this.formatter.format(this.config.format, viewModel)

    // Stale indicator: only transcript metrics can be stale (Daemon heartbeat).
    // Content artifacts (summary, snarky, resume) are point-in-time
    // and remain valid until regenerated - they don't indicate Daemon health.
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
   *
   * @see docs/design/PERSONA-PROFILES-DESIGN.md - Statusline integration
   */
  private buildViewModel(
    state: TranscriptMetricsState,
    summary: SessionSummaryState,
    resume: ResumeMessageState | null,
    snarkyMessage: string,
    branch: string,
    baseline: ContextOverhead,
    logMetrics: LogMetricsState,
    emptySessionMessage: string,
    persona: PersonaDefinition | null
  ): StatuslineViewModel {
    // Determine display mode
    const displayMode = this.determineDisplayMode(summary, resume)

    // Determine summary text based on display mode
    const { summaryText, title } = this.getSummaryContent(
      displayMode,
      summary,
      resume,
      snarkyMessage,
      emptySessionMessage
    )

    // Calculate effective tokens for display
    // Use current_usage from hook input: sum of input + cache tokens represents actual context window usage
    // current_usage resets on compact, so it accurately reflects post-compaction state
    const isIndeterminate = state.isPostCompactIndeterminate === true
    let effectiveTokens: number
    let usingBaseline = false
    let usingTranscript = false

    // Determine the effective tokens used for context display
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

    // Format tokens - compute atomic placeholders for flexible template composition
    // Total includes autocompact buffer for accurate comparison with /context output
    const totalWithBuffer = effectiveTokens + baseline.autocompactBufferTokens
    const contextWindowSize = this.hookInput?.context_window.context_window_size ?? 200000
    const actualPercentage = Math.round((effectiveTokens / contextWindowSize) * 100)
    const effectivePercentage = Math.round((totalWithBuffer / contextWindowSize) * 100)

    // Calculate log status: critical if any errors, warning if many warnings, else normal
    const logStatus =
      logMetrics.errorCount >= this.config.thresholds.logs.critical
        ? 'critical'
        : logMetrics.warningCount >= this.config.thresholds.logs.warning
          ? 'warning'
          : 'normal'

    // Get persona name (empty if no persona or disabled)
    const personaName = persona && persona.id !== 'disabled' ? persona.display_name : ''

    return {
      model: this.formatModelName(modelName),
      contextWindow: formatTokens(contextWindowSize),
      tokenUsageActual: isIndeterminate ? '⟳ compacted' : formatTokens(effectiveTokens),
      tokenUsageEffective: isIndeterminate ? '⟳ compacted' : formatTokens(totalWithBuffer),
      tokenPercentageActual: isIndeterminate ? '⟳' : `${actualPercentage}%`,
      tokenPercentageEffective: isIndeterminate ? '⟳' : `${effectivePercentage}%`,
      tokensStatus: isIndeterminate ? 'normal' : getThresholdStatus(effectiveTokens, this.config.thresholds.tokens),
      cost: formatCost(costUsd),
      costStatus: getThresholdStatus(costUsd, this.config.thresholds.cost),
      duration: formatDuration(durationMs),
      cwd: formatCwd(this.cwd, this.homeDir, normalizeSymbolMode(this.config.theme.useNerdFonts)),
      branch: formatBranch(branch, normalizeSymbolMode(this.config.theme.useNerdFonts)),
      branchColor: getBranchColor(branch),
      displayMode,
      summary: summaryText,
      title,
      snarkyComment: snarkyMessage || undefined,
      contextUsage,
      warningCount: logMetrics.warningCount,
      errorCount: logMetrics.errorCount,
      logStatus,
      personaName,
    }
  }

  /**
   * Determine display mode based on available data.
   *
   * Priority order:
   * 1. Resume message (if session was resumed and resume-message exists)
   * 2. Session summary (if exists with a title)
   * 3. Empty (brand new, nothing submitted)
   */
  private determineDisplayMode(summary: SessionSummaryState, resume: ResumeMessageState | null): DisplayMode {
    // Check if we have a meaningful summary
    const hasSummary =
      summary.session_title &&
      summary.session_title !== '' &&
      summary.session_title !== DEFAULT_PLACEHOLDERS.newSession &&
      summary.latest_intent !== DEFAULT_PLACEHOLDERS.awaitingFirstTurn

    // Priority 1: Resume message (explicit session continuation)
    if (resume && this.isResumedSession) {
      this.logger?.debug('Display mode selected: resume_message (resumed session with resume message)')
      return 'resume_message'
    }

    // Priority 2: Session summary (if exists with title)
    if (hasSummary) {
      this.logger?.debug('Display mode selected: session_summary (existing session summary)')
      return 'session_summary'
    }

    // Priority 3: Discovered resume message from previous session (new session, not explicit --continue)
    // This differs from Priority 1: here isResumedSession is false but we found a resume message from a prior session.
    // Provides context about what the user was working on before, even when not using --continue.
    if (resume) {
      this.logger?.debug('Display mode selected: resume_message (discovered resume message from previous session)')
      return 'resume_message'
    }

    this.logger?.debug('Display mode selected: empty_summary (new session with no summary)')
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
    emptySessionMessage: string
  ): { summaryText: string; title: string } {
    switch (displayMode) {
      case 'resume_message': {
        const resumeTitle = resume?.session_title
          ? `Last Session: ${resume.session_title}`
          : DEFAULT_PLACEHOLDERS.newSession
        const resumeSummary = resume?.snarky_comment || emptySessionMessage
        return {
          summaryText: resumeSummary,
          title: resumeTitle,
        }
      }

      case 'empty_summary':
        return {
          summaryText: emptySessionMessage,
          title: DEFAULT_PLACEHOLDERS.newSession,
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
