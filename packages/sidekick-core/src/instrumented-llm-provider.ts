/**
 * Instrumented LLM Provider
 *
 * Decorator that wraps an LLMProvider to track per-session metrics:
 * - Call counts (total, success, failed) by provider and model
 * - Token usage (input, output) by provider and model
 * - Latency statistics (min, max, avg, p50, p90, p95) by provider and model
 *
 * Metrics are persisted to `llm-metrics.json` in the session state directory
 * with debounced writes to avoid excessive I/O.
 *
 * @example
 * ```typescript
 * const instrumented = new InstrumentedLLMProvider(baseProvider, {
 *   sessionId: 'abc-123',
 *   stateService,
 *   sessionDir: '.sidekick/sessions/abc-123',
 *   logger,
 * })
 * await instrumented.initialize()
 * const response = await instrumented.complete(request)
 * await instrumented.shutdown()
 * ```
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import type { Logger, LLMProvider, LLMRequest, LLMResponse, MinimalStateService, Telemetry } from '@sidekick/types'
import {
  createDefaultLLMMetrics,
  DEFAULT_LATENCY_STATS,
  LLMMetricsStateSchema,
  type LLMLatencyStats,
  type LLMMetricsState,
  type LLMModelMetrics,
  type LLMProviderMetrics,
} from '@sidekick/types'
import { toErrorMessage } from './error-utils.js'

const STATE_FILE = 'llm-metrics.json'
const DEFAULT_DEBOUNCE_MS = 500

/**
 * Duck-typed interface matching FallbackProvider's tracking properties.
 * Used to detect fallback usage without creating a dependency on shared-providers.
 */
interface FallbackTrackingProvider {
  fallbackWasUsed: boolean
  lastUsedProviderId: string | null
}

function hasFallbackTracking(provider: unknown): provider is FallbackTrackingProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'fallbackWasUsed' in provider &&
    'lastUsedProviderId' in provider
  )
}

/**
 * LLM profile parameters for debug dump logging
 */
export interface LLMProfileParams {
  profileName?: string
  provider?: string
  model?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
}

export interface InstrumentedLLMProviderConfig {
  /** Session identifier */
  sessionId: string
  /** StateService for atomic state file operations */
  stateService: MinimalStateService
  /** Path to session directory (for debug dumps, sibling to state dir) */
  sessionDir: string
  /** Logger instance */
  logger: Logger
  /** Telemetry instance for emitting metrics (optional) */
  telemetry?: Telemetry
  /** Debounce interval for persistence (default: 500ms) */
  persistDebounceMs?: number
  /** Enable debug dump of LLM requests/responses to session directory */
  debugDumpEnabled?: boolean
  /** Profile parameters for debug dump logging */
  profileParams?: LLMProfileParams
}

/**
 * LLM Provider wrapper that tracks and persists metrics per session.
 */
export class InstrumentedLLMProvider implements LLMProvider {
  readonly id: string

  private metrics: LLMMetricsState
  private readonly debounceMs: number
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private persistPromise: Promise<void> | null = null

  // Store individual latencies for percentile calculation
  // Nested map: provider -> model -> latencies[]
  private latencyBuffers: Map<string, Map<string, number[]>> = new Map()

  constructor(
    private readonly delegate: LLMProvider,
    private readonly config: InstrumentedLLMProviderConfig
  ) {
    this.id = delegate.id
    this.debounceMs = config.persistDebounceMs ?? DEFAULT_DEBOUNCE_MS
    this.metrics = createDefaultLLMMetrics(config.sessionId)

    config.logger.debug('InstrumentedLLMProvider created', {
      sessionId: config.sessionId,
      delegateId: delegate.id,
    })
  }

  /**
   * Get state file path using StateService path helper.
   */
  private get statePath(): string {
    return this.config.stateService.sessionStatePath(this.config.sessionId, STATE_FILE)
  }

  /**
   * Load existing metrics from disk if available.
   * Call this before using the provider to support session resume.
   */
  async initialize(): Promise<void> {
    try {
      const result = await this.config.stateService.read(this.statePath, LLMMetricsStateSchema, () =>
        createDefaultLLMMetrics(this.config.sessionId)
      )

      if (result.source !== 'default') {
        this.metrics = result.data
        this.config.logger.debug('Loaded existing LLM metrics', {
          sessionId: this.config.sessionId,
          callCount: this.metrics.totals.callCount,
          source: result.source,
        })
      }
    } catch (err) {
      this.config.logger.warn('Failed to load LLM metrics, starting fresh', {
        error: toErrorMessage(err),
      })
    }
  }

  /**
   * Flush pending metrics to disk and cleanup timers.
   * Call this when the session ends.
   */
  async shutdown(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    // Wait for any in-flight persist to complete
    if (this.persistPromise) {
      await this.persistPromise
    }

    // Final persist with computed percentiles
    this.computePercentiles()
    await this.persist()

    this.config.logger.debug('InstrumentedLLMProvider shutdown', {
      sessionId: this.config.sessionId,
      finalCallCount: this.metrics.totals.callCount,
    })
  }

  /**
   * Get current metrics snapshot (for testing/inspection).
   */
  getMetrics(): LLMMetricsState {
    return structuredClone(this.metrics)
  }

  /**
   * Write debug dump files for LLM request/response.
   * Creates files in: {stateDir}/../llm-debug/
   */
  private writeDebugDump(
    request: LLMRequest,
    response: LLMResponse | null,
    error: Error | null,
    durationMs: number
  ): void {
    if (!this.config.debugDumpEnabled) {
      return
    }

    try {
      // Determine actual provider display
      // Use profile params provider, with fallback detection
      let providerDisplay = this.config.profileParams?.provider ?? this.delegate.id
      if (hasFallbackTracking(this.delegate) && this.delegate.fallbackWasUsed) {
        providerDisplay = `${this.delegate.lastUsedProviderId} (fallback used)`
      }

      // Use model from profile config, then response, then request, then 'unknown'
      const model = this.config.profileParams?.model ?? response?.model ?? request.model ?? 'unknown'

      // Write to session dir: sessions/{id}/llm-debug/ (flattened, no subdirs)
      const debugDir = join(this.config.sessionDir, 'llm-debug')

      if (!existsSync(debugDir)) {
        mkdirSync(debugDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const basePath = join(debugDir, timestamp)

      // Write request with all available parameters
      writeFileSync(
        `${basePath}-request.yaml`,
        YAML.stringify({
          provider: providerDisplay,
          model,
          sessionId: this.config.sessionId,
          timestamp: new Date().toISOString(),
          // LLM parameters from profile
          params: this.config.profileParams ?? {},
          // Full request structure
          request: {
            messages: request.messages,
            system: request.system,
            model: request.model,
            jsonSchema: request.jsonSchema,
            additionalParams: request.additionalParams,
          },
        })
      )

      // Write response or error
      writeFileSync(
        `${basePath}-response.yaml`,
        YAML.stringify({
          provider: providerDisplay,
          model,
          sessionId: this.config.sessionId,
          timestamp: new Date().toISOString(),
          durationMs,
          success: error === null,
          response: response
            ? {
                content: response.content,
                model: response.model,
                usage: response.usage,
              }
            : null,
          // Include raw response when available (for debugging)
          rawResponse: response?.rawResponse ?? null,
          error: error
            ? {
                name: error.name,
                message: error.message,
              }
            : null,
        })
      )

      this.config.logger.debug('Debug dump written', { path: basePath })
    } catch (dumpError) {
      // Don't fail the request if dump fails
      this.config.logger.warn('Failed to write debug dump', {
        error: toErrorMessage(dumpError),
      })
    }
  }

  /**
   * Emit telemetry metrics if telemetry is configured.
   */
  private emitTelemetry(
    model: string,
    durationMs: number,
    success: boolean,
    usage?: { inputTokens: number; outputTokens: number },
    errorType?: string
  ): void {
    const telemetry = this.config.telemetry
    if (!telemetry) return

    const tags = {
      provider: this.delegate.id,
      model,
      success: String(success),
    }

    telemetry.histogram('llm_request_duration', durationMs, 'ms', tags)

    if (success && usage) {
      telemetry.histogram('llm_input_tokens', usage.inputTokens, 'tokens', {
        provider: this.delegate.id,
        model,
      })
      telemetry.histogram('llm_output_tokens', usage.outputTokens, 'tokens', {
        provider: this.delegate.id,
        model,
      })
    }

    if (!success) {
      telemetry.increment('llm_request_errors', {
        provider: this.delegate.id,
        model,
        error_type: errorType ?? 'unknown',
      })
    }
  }

  /**
   * Complete an LLM request while tracking metrics.
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    const model = request.model ?? 'unknown'

    try {
      const response = await this.delegate.complete(request)
      const latencyMs = Date.now() - startTime

      // Write debug dump if enabled
      this.writeDebugDump(request, response, null, latencyMs)

      // Record session metrics
      this.recordSuccess(
        this.delegate.id,
        response.model ?? model,
        latencyMs,
        response.usage?.inputTokens ?? 0,
        response.usage?.outputTokens ?? 0
      )

      // Emit telemetry
      this.emitTelemetry(response.model ?? model, latencyMs, true, response.usage)

      return response
    } catch (error) {
      const latencyMs = Date.now() - startTime

      // Write debug dump for errors if enabled
      this.writeDebugDump(request, null, error instanceof Error ? error : new Error(String(error)), latencyMs)

      // Record session metrics
      this.recordFailure(this.delegate.id, model, latencyMs)

      // Emit telemetry
      this.emitTelemetry(
        model,
        latencyMs,
        false,
        undefined,
        error instanceof Error ? error.constructor.name : 'unknown'
      )

      throw error
    }
  }

  /**
   * Ensure provider and model entries exist in metrics, returning both.
   */
  private getOrCreateModelMetrics(
    provider: string,
    model: string
  ): { providerMetrics: LLMProviderMetrics; modelMetrics: LLMModelMetrics } {
    if (!this.metrics.byProvider[provider]) {
      this.metrics.byProvider[provider] = this.createEmptyProviderMetrics()
    }
    const providerMetrics = this.metrics.byProvider[provider]

    if (!providerMetrics.byModel[model]) {
      providerMetrics.byModel[model] = this.createEmptyModelMetrics()
    }
    const modelMetrics = providerMetrics.byModel[model]

    return { providerMetrics, modelMetrics }
  }

  /**
   * Get or create the latency buffer for a provider/model pair.
   */
  private getOrCreateLatencyBuffer(provider: string, model: string): number[] {
    if (!this.latencyBuffers.has(provider)) {
      this.latencyBuffers.set(provider, new Map())
    }
    const providerBuffers = this.latencyBuffers.get(provider)!
    if (!providerBuffers.has(model)) {
      providerBuffers.set(model, [])
    }
    return providerBuffers.get(model)!
  }

  /**
   * Record a successful LLM call.
   */
  private recordSuccess(
    provider: string,
    model: string,
    latencyMs: number,
    inputTokens: number,
    outputTokens: number
  ): void {
    const { providerMetrics, modelMetrics } = this.getOrCreateModelMetrics(provider, model)

    // Update model metrics
    modelMetrics.callCount++
    modelMetrics.successCount++
    modelMetrics.inputTokens += inputTokens
    modelMetrics.outputTokens += outputTokens
    this.updateLatencyStats(modelMetrics.latency, latencyMs)

    // Update provider metrics
    providerMetrics.callCount++
    providerMetrics.successCount++
    providerMetrics.inputTokens += inputTokens
    providerMetrics.outputTokens += outputTokens
    this.updateLatencyStats(providerMetrics.latency, latencyMs)

    // Update totals
    this.metrics.totals.callCount++
    this.metrics.totals.successCount++
    this.metrics.totals.inputTokens += inputTokens
    this.metrics.totals.outputTokens += outputTokens
    this.metrics.totals.totalLatencyMs += latencyMs
    this.metrics.totals.averageLatencyMs =
      this.metrics.totals.successCount > 0 ? this.metrics.totals.totalLatencyMs / this.metrics.totals.successCount : 0

    this.getOrCreateLatencyBuffer(provider, model).push(latencyMs)

    this.metrics.lastUpdatedAt = Date.now()
    this.schedulePersist()
  }

  /**
   * Record a failed LLM call.
   */
  private recordFailure(provider: string, model: string, _latencyMs: number): void {
    const { providerMetrics, modelMetrics } = this.getOrCreateModelMetrics(provider, model)

    // Update model metrics (only counts, not latency stats for failures)
    modelMetrics.callCount++
    modelMetrics.failedCount++

    // Update provider metrics
    providerMetrics.callCount++
    providerMetrics.failedCount++

    // Update totals
    this.metrics.totals.callCount++
    this.metrics.totals.failedCount++

    this.metrics.lastUpdatedAt = Date.now()
    this.schedulePersist()
  }

  /**
   * Update latency statistics with a new value.
   */
  private updateLatencyStats(stats: LLMLatencyStats, latencyMs: number): void {
    stats.min = Math.min(stats.min === Infinity ? latencyMs : stats.min, latencyMs)
    stats.max = Math.max(stats.max, latencyMs)
    stats.sum += latencyMs
    stats.count++
  }

  /**
   * Create empty provider metrics.
   */
  private createEmptyProviderMetrics(): LLMProviderMetrics {
    return {
      callCount: 0,
      successCount: 0,
      failedCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      latency: { ...DEFAULT_LATENCY_STATS },
      byModel: {},
    }
  }

  /**
   * Create empty model metrics.
   */
  private createEmptyModelMetrics(): LLMModelMetrics {
    return {
      callCount: 0,
      successCount: 0,
      failedCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      latency: { ...DEFAULT_LATENCY_STATS },
    }
  }

  /**
   * Schedule a debounced persist.
   */
  private schedulePersist(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.computePercentiles()
      // Track the persist promise so shutdown can wait for it
      this.persistPromise = this.persist().finally(() => {
        this.persistPromise = null
      })
    }, this.debounceMs)
  }

  /**
   * Compute percentiles from latency buffers.
   * Uses nested maps to avoid delimiter-based key parsing that would
   * corrupt model names containing colons (e.g. "anthropic:claude-3:opus").
   */
  private computePercentiles(): void {
    for (const [provider, modelBuffers] of this.latencyBuffers.entries()) {
      const providerMetrics = this.metrics.byProvider[provider]
      if (!providerMetrics) continue

      const allProviderLatencies: number[] = []

      for (const [model, latencies] of modelBuffers.entries()) {
        if (latencies.length === 0) continue

        const modelMetrics = providerMetrics.byModel[model]
        if (!modelMetrics) continue

        // Sort for percentile calculation
        const sorted = [...latencies].sort((a, b) => a - b)

        // Update model percentiles
        modelMetrics.latency.p50 = this.percentile(sorted, 50)
        modelMetrics.latency.p90 = this.percentile(sorted, 90)
        modelMetrics.latency.p95 = this.percentile(sorted, 95)

        // Accumulate for provider-level percentiles
        allProviderLatencies.push(...latencies)
      }

      // Compute provider-level percentiles from all model latencies
      if (allProviderLatencies.length > 0) {
        const sorted = [...allProviderLatencies].sort((a, b) => a - b)
        providerMetrics.latency.p50 = this.percentile(sorted, 50)
        providerMetrics.latency.p90 = this.percentile(sorted, 90)
        providerMetrics.latency.p95 = this.percentile(sorted, 95)
      }
    }
  }

  /**
   * Calculate percentile from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  /**
   * Persist metrics to disk using StateService atomic write.
   */
  private async persist(): Promise<void> {
    try {
      await this.config.stateService.write(this.statePath, this.metrics, LLMMetricsStateSchema)

      this.config.logger.debug('Persisted LLM metrics', {
        sessionId: this.config.sessionId,
        callCount: this.metrics.totals.callCount,
      })
    } catch (err) {
      this.config.logger.warn('Failed to persist LLM metrics', {
        error: toErrorMessage(err),
      })
    }
  }
}
