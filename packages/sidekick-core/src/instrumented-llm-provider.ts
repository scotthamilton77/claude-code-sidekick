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
 *   stateDir: '.sidekick/sessions/abc-123/state',
 *   logger,
 * })
 * await instrumented.initialize()
 * const response = await instrumented.complete(request)
 * await instrumented.shutdown()
 * ```
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Logger, LLMProvider, LLMRequest, LLMResponse } from '@sidekick/types'
import {
  createDefaultLLMMetrics,
  DEFAULT_LATENCY_STATS,
  LLMMetricsStateSchema,
  type LLMLatencyStats,
  type LLMMetricsState,
  type LLMModelMetrics,
  type LLMProviderMetrics,
} from '@sidekick/types'

const STATE_FILE = 'llm-metrics.json'
const DEFAULT_DEBOUNCE_MS = 500

export interface InstrumentedLLMProviderConfig {
  /** Session identifier */
  sessionId: string
  /** Path to session state directory */
  stateDir: string
  /** Logger instance */
  logger: Logger
  /** Debounce interval for persistence (default: 500ms) */
  persistDebounceMs?: number
}

/**
 * LLM Provider wrapper that tracks and persists metrics per session.
 */
export class InstrumentedLLMProvider implements LLMProvider {
  readonly id: string

  private metrics: LLMMetricsState
  private readonly statePath: string
  private readonly debounceMs: number
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Store individual latencies for percentile calculation
  // Map key is `${provider}:${model}`
  private latencyBuffers: Map<string, number[]> = new Map()

  constructor(
    private readonly delegate: LLMProvider,
    private readonly config: InstrumentedLLMProviderConfig
  ) {
    this.id = delegate.id
    this.statePath = join(config.stateDir, STATE_FILE)
    this.debounceMs = config.persistDebounceMs ?? DEFAULT_DEBOUNCE_MS
    this.metrics = createDefaultLLMMetrics(config.sessionId)

    config.logger.debug('InstrumentedLLMProvider created', {
      sessionId: config.sessionId,
      statePath: this.statePath,
      delegateId: delegate.id,
    })
  }

  /**
   * Load existing metrics from disk if available.
   * Call this before using the provider to support session resume.
   */
  initialize(): void {
    try {
      if (existsSync(this.statePath)) {
        const content = readFileSync(this.statePath, 'utf-8')
        const parsed: unknown = JSON.parse(content)
        const validated = LLMMetricsStateSchema.safeParse(parsed)

        if (validated.success) {
          this.metrics = validated.data
          this.config.logger.debug('Loaded existing LLM metrics', {
            sessionId: this.config.sessionId,
            callCount: this.metrics.totals.callCount,
          })
        } else {
          this.config.logger.warn('Invalid LLM metrics file, starting fresh', {
            error: validated.error.message,
          })
        }
      }
    } catch (err) {
      this.config.logger.warn('Failed to load LLM metrics, starting fresh', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Flush pending metrics to disk and cleanup timers.
   * Call this when the session ends.
   */
  shutdown(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    // Final persist with computed percentiles
    this.computePercentiles()
    this.persistSync()

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
   * Complete an LLM request while tracking metrics.
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    const model = request.model ?? 'unknown'

    try {
      const response = await this.delegate.complete(request)
      const latencyMs = Date.now() - startTime

      this.recordSuccess(
        this.delegate.id,
        response.model ?? model,
        latencyMs,
        response.usage?.inputTokens ?? 0,
        response.usage?.outputTokens ?? 0
      )

      return response
    } catch (error) {
      const latencyMs = Date.now() - startTime
      this.recordFailure(this.delegate.id, model, latencyMs)
      throw error
    }
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
    // Ensure provider exists
    if (!this.metrics.byProvider[provider]) {
      this.metrics.byProvider[provider] = this.createEmptyProviderMetrics()
    }
    const providerMetrics = this.metrics.byProvider[provider]

    // Ensure model exists
    if (!providerMetrics.byModel[model]) {
      providerMetrics.byModel[model] = this.createEmptyModelMetrics()
    }
    const modelMetrics = providerMetrics.byModel[model]

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

    // Store latency for percentile calculation
    const bufferKey = `${provider}:${model}`
    if (!this.latencyBuffers.has(bufferKey)) {
      this.latencyBuffers.set(bufferKey, [])
    }
    this.latencyBuffers.get(bufferKey)!.push(latencyMs)

    this.metrics.lastUpdatedAt = Date.now()
    this.schedulePersist()
  }

  /**
   * Record a failed LLM call.
   */
  private recordFailure(provider: string, model: string, _latencyMs: number): void {
    // Ensure provider exists
    if (!this.metrics.byProvider[provider]) {
      this.metrics.byProvider[provider] = this.createEmptyProviderMetrics()
    }
    const providerMetrics = this.metrics.byProvider[provider]

    // Ensure model exists
    if (!providerMetrics.byModel[model]) {
      providerMetrics.byModel[model] = this.createEmptyModelMetrics()
    }
    const modelMetrics = providerMetrics.byModel[model]

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
      this.persistSync()
    }, this.debounceMs)
  }

  /**
   * Compute percentiles from latency buffers.
   */
  private computePercentiles(): void {
    for (const [key, latencies] of this.latencyBuffers.entries()) {
      if (latencies.length === 0) continue

      const [provider, model] = key.split(':')
      const providerMetrics = this.metrics.byProvider[provider]
      if (!providerMetrics) continue

      const modelMetrics = providerMetrics.byModel[model]
      if (!modelMetrics) continue

      // Sort for percentile calculation
      const sorted = [...latencies].sort((a, b) => a - b)

      // Update model percentiles
      modelMetrics.latency.p50 = this.percentile(sorted, 50)
      modelMetrics.latency.p90 = this.percentile(sorted, 90)
      modelMetrics.latency.p95 = this.percentile(sorted, 95)
    }

    // Compute provider-level percentiles by combining all model latencies
    for (const [provider, providerMetrics] of Object.entries(this.metrics.byProvider)) {
      const allLatencies: number[] = []
      for (const model of Object.keys(providerMetrics.byModel)) {
        const bufferKey = `${provider}:${model}`
        const buffer = this.latencyBuffers.get(bufferKey)
        if (buffer) {
          allLatencies.push(...buffer)
        }
      }

      if (allLatencies.length > 0) {
        const sorted = allLatencies.sort((a, b) => a - b)
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
   * Persist metrics to disk synchronously with atomic write.
   */
  private persistSync(): void {
    try {
      // Ensure directory exists
      const dir = dirname(this.statePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Atomic write: write to temp file then rename
      const tmpPath = `${this.statePath}.tmp`
      const json = JSON.stringify(this.metrics, null, 2)
      writeFileSync(tmpPath, json, 'utf-8')
      renameSync(tmpPath, this.statePath)

      this.config.logger.debug('Persisted LLM metrics', {
        sessionId: this.config.sessionId,
        callCount: this.metrics.totals.callCount,
      })
    } catch (err) {
      this.config.logger.warn('Failed to persist LLM metrics', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
