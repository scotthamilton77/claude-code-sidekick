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
import {
  createPersonaLoader,
  getDefaultPersonasDir,
  readDaemonHealth,
  SetupStatusService,
  type ApiKeyName,
  type SetupState,
} from '@sidekick/core'
import * as path from 'node:path'
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
  contextBarStatusToThresholdStatus,
} from './formatter.js'
import { GitProvider, createGitProvider } from './git-provider.js'
import { StateReader, createStateReader, discoverPreviousResumeMessage } from './state-reader.js'
import { readContextOverhead, getDefaultOverhead, type ContextOverhead } from './context-overhead-reader.js'
import { resolveEffectiveTokens } from './token-resolution.js'
import type { ClaudeCodeStatusInput } from './hook-types.js'
import {
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
  shouldAutoConfigureProject(): Promise<boolean>
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
  projectDirShort: '',
  projectDirFull: '',
  worktreeName: '',
  branchWT: '',
  warningCount: 0,
  errorCount: 0,
  logStatus: 'normal',
  personaName: '',
} as const

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
      return persona.statusline_empty_messages[
        deterministicIndex(this.sessionId, persona.statusline_empty_messages.length)
      ]
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

    return messages[deterministicIndex(this.sessionId, messages.length)]
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
        // Suppress warning when auto-configure is pending (race: statusline runs
        // before SessionStart finishes writing setup-status.json)
        if (await this.setupService.shouldAutoConfigureProject()) {
          return { warning: '', state: 'healthy' }
        }
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
              warning: `${keyName} not found. Run 'sidekick doctor' or /sidekick-setup`,
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
  private buildMinimalViewModel(warning: string): StatuslineViewModel {
    return {
      ...EMPTY_STATUSLINE_VIEWMODEL,
      summary: warning,
    }
  }

  /**
   * Build a StatuslineRenderResult for warning display with yellow ANSI coloring.
   * Shared by setup warnings and daemon health warnings.
   */
  private buildWarningResult(warning: string): StatuslineRenderResult {
    const ANSI_YELLOW = '\x1b[33m'
    const ANSI_RESET = '\x1b[0m'
    const text = this.useColors ? `${ANSI_YELLOW}${warning}${ANSI_RESET}` : warning
    return {
      text,
      displayMode: 'setup_warning',
      staleData: false,
      viewModel: this.buildMinimalViewModel(warning),
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
      return this.buildWarningResult(setupCheck.warning)
    }

    // Check daemon health - if daemon failed, show degraded warning
    // Lower priority than setup issues (checked second)
    if (this.projectDir) {
      const daemonHealth = await readDaemonHealth(this.projectDir)
      if (daemonHealth.status === 'failed') {
        const warning = daemonHealth.error
          ? `Daemon not running: ${daemonHealth.error}. Sidekick features limited.`
          : 'Daemon not running. Sidekick features limited.'
        return this.buildWarningResult(warning)
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
      emptySessionMessage,
      persona
    )

    // Calculate effective tokens for display
    const isIndeterminate = state.isPostCompactIndeterminate === true
    const { effectiveTokens, usingBaseline, usingTranscript } = resolveEffectiveTokens(state, baseline, this.hookInput)

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

    // Worktree-aware project directory resolution
    const worktree = this.hookInput?.worktree
    const projectRoot = worktree?.original_cwd || this.hookInput?.workspace?.project_dir || this.cwd
    const projectDirShort = path.basename(projectRoot)
    const homeShorten = (p: string): string =>
      this.homeDir && p.startsWith(this.homeDir) ? '~' + p.slice(this.homeDir.length) : p

    return {
      model: this.formatModelName(modelName),
      contextWindow: formatTokens(contextWindowSize),
      tokenUsageActual: isIndeterminate ? '⟳ compacted' : formatTokens(effectiveTokens),
      tokenUsageEffective: isIndeterminate ? '⟳ compacted' : formatTokens(totalWithBuffer),
      tokenPercentageActual: isIndeterminate ? '⟳' : `${actualPercentage}%`,
      tokenPercentageEffective: isIndeterminate ? '⟳' : `${effectivePercentage}%`,
      tokensStatus: isIndeterminate
        ? 'normal'
        : contextUsage
          ? contextBarStatusToThresholdStatus(contextUsage.status)
          : 'normal',
      cost: formatCost(costUsd),
      costStatus: getThresholdStatus(costUsd, this.config.thresholds.cost),
      duration: formatDuration(durationMs),
      cwd: formatCwd(this.cwd, this.homeDir),
      branch: formatBranch(branch),
      branchColor: getBranchColor(branch),
      projectDirShort,
      projectDirFull: homeShorten(projectRoot),
      worktreeName: worktree?.name ?? '',
      branchWT: formatBranch(branch),
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
    emptySessionMessage: string,
    persona: PersonaDefinition | null
  ): { summaryText: string; title: string } {
    switch (displayMode) {
      case 'resume_message': {
        const resumeTitle = resume?.session_title
          ? `Last Session: ${resume.session_title}`
          : DEFAULT_PLACEHOLDERS.newSession
        let resumeSummary = resume?.snarky_comment || emptySessionMessage

        // Attribution wrapper: when source persona differs from current, prefix with source name.
        // Do not require a resolved PersonaDefinition; fall back to persona_id when persona is null.
        const isPersonaDisabled = persona?.id === 'disabled'

        if (
          resume?.persona_id &&
          resume.persona_display_name &&
          !isPersonaDisabled &&
          resume.persona_id !== persona?.id
        ) {
          resumeSummary = `${resume.persona_display_name}: ${resumeSummary}`
        }

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

/**
 * Deterministic index selection based on a seed string (session ID).
 * Produces a stable index for a given seed + array length, avoiding
 * the flickering caused by Math.random() on every render.
 *
 * Uses djb2 hash algorithm for fast, well-distributed hashing.
 *
 * @param seed - Seed string (typically session ID)
 * @param arrayLength - Length of array to index into
 * @returns Stable index in range [0, arrayLength)
 */
export function deterministicIndex(seed: string, arrayLength: number): number {
  if (arrayLength <= 1) return 0
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % arrayLength
}
