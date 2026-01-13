/**
 * Mock LLM Provider for zero-cost testing
 *
 * This mock provider implements the expected LLMProvider interface from Phase 1.3
 * and can be used to test components that depend on LLM providers without making real API calls.
 */

import { ZodSchema } from 'zod'

/**
 * Response structure from an LLM provider
 */
export interface LLMResponse {
  /** Raw text content from the LLM */
  content: string
  /** Provider-specific metadata (tokens used, model, etc.) */
  metadata: {
    provider: string
    model: string
    tokens?: {
      prompt: number
      completion: number
      total: number
    }
    latency_ms?: number
  }
}

/**
 * Options for LLM invocation
 */
export interface InvokeOptions {
  /** Temperature for response generation (0.0-1.0) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Timeout in milliseconds */
  timeout?: number
  /** System prompt/instructions */
  systemPrompt?: string
  /** JSON schema for structured output (provider-specific implementation) */
  jsonSchema?: object
}

/**
 * Abstract LLM provider interface
 *
 * This interface will be implemented by ClaudeProvider, OpenAIProvider, etc.
 * in Phase 1.4-1.5. For now, it's used by the mock for testing.
 */
export interface LLMProvider {
  /**
   * Invoke the LLM with a prompt
   * @param prompt - User prompt text
   * @param options - Optional invocation parameters
   * @returns LLM response with content and metadata
   */
  invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse>

  /**
   * Extract and validate JSON from LLM response
   * @param response - LLM response containing JSON
   * @param schema - Optional Zod schema for validation
   * @returns Parsed and validated JSON object
   */
  extractJSON<T>(response: LLMResponse, schema?: ZodSchema<T>): T

  /**
   * Get the provider name (e.g., "claude", "openai", "openrouter")
   */
  getProviderName(): string

  /**
   * Get the model name (e.g., "claude-3-5-sonnet-20241022", "gpt-4o")
   */
  getModelName(): string
}

/**
 * Configuration for mock responses
 */
export interface MockResponseConfig {
  /** Canned response content */
  content: string
  /** Simulated latency in milliseconds */
  latency?: number
  /** Should the mock throw an error? */
  shouldFail?: boolean
  /** Error to throw (if shouldFail is true) */
  error?: Error
}

/**
 * Mock LLM Provider for testing
 *
 * Provides deterministic, configurable responses without making API calls.
 *
 * @example
 * ```typescript
 * const mock = new MockLLMProvider('claude', 'haiku')
 * mock.addResponse('analyze this', { content: '{"topic":"test"}' })
 * const response = await mock.invoke('analyze this')
 * // response.content === '{"topic":"test"}'
 * ```
 */
export class MockLLMProvider implements LLMProvider {
  private responses: Map<string, MockResponseConfig> = new Map()
  private defaultResponse: MockResponseConfig = {
    content: '{"status":"ok","message":"Mock response"}',
    latency: 0,
  }
  private invocationCount = 0

  constructor(
    private providerName: string = 'mock',
    private modelName: string = 'mock-model'
  ) {}

  /**
   * Add a canned response for a specific prompt
   * @param prompt - The prompt to match
   * @param config - Response configuration
   */
  addResponse(prompt: string, config: MockResponseConfig): void {
    this.responses.set(prompt, config)
  }

  /**
   * Set the default response for unmatched prompts
   * @param config - Default response configuration
   */
  setDefaultResponse(config: MockResponseConfig): void {
    this.defaultResponse = config
  }

  /**
   * Get the number of times invoke() was called
   */
  getInvocationCount(): number {
    return this.invocationCount
  }

  /**
   * Reset all state (responses, invocation count)
   */
  reset(): void {
    this.responses.clear()
    this.invocationCount = 0
    this.defaultResponse = {
      content: '{"status":"ok","message":"Mock response"}',
      latency: 0,
    }
  }

  /**
   * Invoke the mock LLM with a prompt
   */
  async invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse> {
    this.invocationCount++

    // Get response config (matched or default)
    const config = this.responses.get(prompt) || this.defaultResponse

    // Calculate latency (use configured latency, default to 0 for instant response)
    const latency = config.latency ?? 0
    const timeout = options?.timeout

    // Simulate timeout if latency exceeds configured timeout
    if (timeout !== undefined && latency > timeout) {
      await new Promise((resolve) => setTimeout(resolve, timeout))
      throw new Error(`Request timeout after ${timeout}ms`)
    }

    // Simulate normal latency
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency))
    }

    // Simulate failure
    if (config.shouldFail) {
      throw config.error || new Error('Mock provider configured to fail')
    }

    // Return mock response
    const promptTokens = Math.floor(prompt.length / 4) // Rough token estimate
    const completionTokens = Math.floor(config.content.length / 4)

    return {
      content: config.content,
      metadata: {
        provider: this.providerName,
        model: this.modelName,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: promptTokens + completionTokens, // Sum of individual token counts
        },
        latency_ms: latency,
      },
    }
  }

  /**
   * Extract and validate JSON from mock response
   */
  extractJSON<T>(response: LLMResponse, schema?: ZodSchema<T>): T {
    const content = response.content.trim()

    // Handle code fence format (```json ... ```)
    let jsonText = content
    if (content.startsWith('```')) {
      const match = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
      if (match && match[1] !== undefined) {
        jsonText = match[1]
      }
    }

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (error) {
      throw new Error(
        `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // Validate with Zod schema if provided
    if (schema) {
      const result = schema.safeParse(parsed)
      if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`)
      }
      return result.data
    }

    return parsed as T
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.providerName
  }

  /**
   * Get the model name
   */
  getModelName(): string {
    return this.modelName
  }
}

/**
 * Create a mock provider pre-configured with common test responses
 *
 * Useful for quick test setup without manual configuration.
 *
 * @example
 * ```typescript
 * const mock = createTestMockProvider()
 * const response = await mock.invoke('hello')
 * // Returns a valid JSON response
 * ```
 */
export function createTestMockProvider(
  providerName = 'test-mock',
  modelName = 'test-model'
): MockLLMProvider {
  const mock = new MockLLMProvider(providerName, modelName)

  // Add common test responses
  mock.addResponse('hello', {
    content: '{"greeting":"Hello from mock provider!"}',
    latency: 10,
  })

  mock.addResponse('timeout', {
    content: 'This should never be returned',
    latency: 5000, // 5 second delay for timeout testing
  })

  mock.addResponse('error', {
    content: 'This should never be returned',
    shouldFail: true,
    error: new Error('Simulated API error'),
  })

  return mock
}
