/**
 * Mock LLM provider for testing
 *
 * Provides a configurable mock that can:
 * - Return predefined responses
 * - Simulate latency
 * - Simulate errors (timeout, API errors, etc.)
 * - Track invocation history
 *
 * Zero API costs - all responses are mocked.
 */

import { LLMProvider } from '../../src/lib/providers/LLMProvider.js'
import {
  InvokeOptions,
  LLMResponse,
  LLMError,
  LLMErrorType,
  TokenUsage,
  ProviderConfig,
} from '../../src/lib/providers/types.js'

/**
 * Configuration for mock responses
 */
export interface MockResponseConfig {
  /**
   * Content to return (JSON string or plain text)
   */
  content: string

  /**
   * Simulated latency in milliseconds (default: 10)
   */
  latencyMs?: number

  /**
   * Simulated token usage
   */
  usage?: Partial<TokenUsage>

  /**
   * Simulated cost in USD
   */
  costUsd?: number
}

/**
 * Configuration for mock errors
 */
export interface MockErrorConfig {
  /**
   * Error type to simulate
   */
  type: LLMErrorType

  /**
   * Error message
   */
  message: string

  /**
   * Latency before error (milliseconds, default: 10)
   */
  latencyMs?: number
}

/**
 * Mock provider configuration
 */
export interface MockProviderConfig {
  /**
   * Model name (default: 'mock-model')
   */
  model?: string

  /**
   * Default timeout (default: 30 seconds)
   */
  timeout?: number

  /**
   * Queue of responses to return in order
   * If empty, returns default response
   */
  responseQueue?: (MockResponseConfig | MockErrorConfig)[]

  /**
   * Default response when queue is empty
   */
  defaultResponse?: MockResponseConfig
}

/**
 * Invocation record for testing
 */
export interface InvocationRecord {
  /**
   * Prompt text
   */
  prompt: string

  /**
   * Invocation options
   */
  options?: InvokeOptions

  /**
   * Timestamp
   */
  timestamp: Date

  /**
   * Response (if successful)
   */
  response?: LLMResponse

  /**
   * Error (if failed)
   */
  error?: LLMError
}

/**
 * Mock LLM provider implementation
 *
 * Example usage:
 * ```typescript
 * const provider = new MockProvider({
 *   model: 'test-model',
 *   responseQueue: [
 *     { content: '{"result": "success"}', latencyMs: 100 },
 *     { type: LLMErrorType.TIMEOUT, message: 'Timeout', latencyMs: 5000 },
 *   ],
 * });
 *
 * const response = await provider.invoke('test prompt');
 * console.log(provider.getInvocationHistory());
 * ```
 */
export class MockProvider extends LLMProvider {
  private responseQueue: (MockResponseConfig | MockErrorConfig)[]
  private defaultResponse: MockResponseConfig
  private invocationHistory: InvocationRecord[] = []

  constructor(config: MockProviderConfig = {}) {
    const providerConfig: ProviderConfig = {
      type: 'custom',
      model: config.model ?? 'mock-model',
    }
    if (config.timeout !== undefined) {
      providerConfig.timeout = config.timeout
    }
    super(providerConfig)

    this.responseQueue = config.responseQueue ?? []
    this.defaultResponse = config.defaultResponse ?? {
      content: '{"mock": true}',
      latencyMs: 10,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      costUsd: 0.001,
    }
  }

  /**
   * Invoke the mock provider
   *
   * Returns the next response from the queue, or the default response
   * if the queue is empty.
   */
  async invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse> {
    const record: InvocationRecord = {
      prompt,
      ...(options && { options }),
      timestamp: new Date(),
    }

    // Get next response from queue or use default
    const config = this.responseQueue.shift() ?? this.defaultResponse

    // Simulate latency
    const latencyMs = config.latencyMs ?? 10
    await this.sleep(latencyMs)

    // Check if this is an error config
    if ('type' in config && 'message' in config) {
      const error = this.createError(config.type, config.message)
      record.error = error
      this.invocationHistory.push(record)
      throw error
    }

    // Build successful response
    const responseConfig = config
    const usage: TokenUsage = {
      inputTokens: responseConfig.usage?.inputTokens ?? 10,
      outputTokens: responseConfig.usage?.outputTokens ?? 5,
      totalTokens: responseConfig.usage?.totalTokens ?? 15,
    }

    const response: LLMResponse = {
      content: responseConfig.content,
      metadata: {
        wallTimeMs: latencyMs,
        apiDurationMs: latencyMs,
        costUsd: responseConfig.costUsd ?? 0.001,
        usage,
        rawResponse: responseConfig.content,
        providerMetadata: {
          mock: true,
        },
      },
    }

    record.response = response
    this.invocationHistory.push(record)

    return response
  }

  /**
   * Get invocation history for testing
   */
  getInvocationHistory(): InvocationRecord[] {
    return [...this.invocationHistory]
  }

  /**
   * Get the most recent invocation
   */
  getLastInvocation(): InvocationRecord | undefined {
    return this.invocationHistory[this.invocationHistory.length - 1]
  }

  /**
   * Clear invocation history
   */
  clearHistory(): void {
    this.invocationHistory = []
  }

  /**
   * Get number of invocations
   */
  getInvocationCount(): number {
    return this.invocationHistory.length
  }

  /**
   * Add a response to the queue
   */
  enqueueResponse(config: MockResponseConfig): void {
    this.responseQueue.push(config)
  }

  /**
   * Add an error to the queue
   */
  enqueueError(config: MockErrorConfig): void {
    this.responseQueue.push(config)
  }

  /**
   * Set the default response
   */
  setDefaultResponse(config: MockResponseConfig): void {
    this.defaultResponse = config
  }

  /**
   * Check if response queue is empty
   */
  isQueueEmpty(): boolean {
    return this.responseQueue.length === 0
  }

  /**
   * Get remaining queue size
   */
  getQueueSize(): number {
    return this.responseQueue.length
  }

  /**
   * Sleep utility for simulating latency
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create a simple mock provider with a single JSON response
 *
 * @param content - JSON object to return
 * @param options - Optional configuration
 * @returns Configured MockProvider
 */
export function createSimpleMock<T = unknown>(
  content: T,
  options?: {
    model?: string
    latencyMs?: number
    usage?: Partial<TokenUsage>
    costUsd?: number
  }
): MockProvider {
  const defaultResponse: MockResponseConfig = {
    content: JSON.stringify(content),
  }

  if (options?.latencyMs !== undefined) {
    defaultResponse.latencyMs = options.latencyMs
  }
  if (options?.usage !== undefined) {
    defaultResponse.usage = options.usage
  }
  if (options?.costUsd !== undefined) {
    defaultResponse.costUsd = options.costUsd
  }

  const config: MockProviderConfig = {
    defaultResponse,
  }

  if (options?.model !== undefined) {
    config.model = options.model
  }

  return new MockProvider(config)
}

/**
 * Create a mock provider that always errors
 *
 * @param type - Error type
 * @param message - Error message
 * @param options - Optional configuration
 * @returns Configured MockProvider
 */
export function createErrorMock(
  type: LLMErrorType,
  message: string,
  options?: {
    model?: string
    latencyMs?: number
  }
): MockProvider {
  const errorConfig: MockErrorConfig = {
    type,
    message,
  }

  if (options?.latencyMs !== undefined) {
    errorConfig.latencyMs = options.latencyMs
  }

  const config: MockProviderConfig = {
    responseQueue: [errorConfig],
  }

  if (options?.model !== undefined) {
    config.model = options.model
  }

  return new MockProvider(config)
}
