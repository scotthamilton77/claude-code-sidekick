/**
 * Core types for LLM provider abstraction
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh
 */

/**
 * Supported LLM provider types
 */
export type ProviderType = 'claude-cli' | 'openai-api' | 'openrouter' | 'custom'

/**
 * Options for LLM invocation
 */
export interface InvokeOptions {
  /**
   * Timeout in seconds (default: from config or 30)
   */
  timeout?: number

  /**
   * JSON schema for structured output (OpenAI/OpenRouter)
   */
  jsonSchema?: Record<string, unknown>

  /**
   * Maximum retry attempts for timeout errors (default: from config or 3)
   */
  maxRetries?: number

  /**
   * Enable debug dumping to /tmp/ (default: false)
   */
  debugDump?: boolean
}

/**
 * Token usage information
 */
export interface TokenUsage {
  /**
   * Number of input tokens consumed
   */
  inputTokens: number

  /**
   * Number of output tokens generated
   */
  outputTokens: number

  /**
   * Total tokens (input + output)
   */
  totalTokens: number
}

/**
 * Response metadata from LLM provider
 */
export interface ResponseMetadata {
  /**
   * Wall clock duration in milliseconds
   */
  wallTimeMs: number

  /**
   * API-reported duration in milliseconds (may differ from wall time)
   */
  apiDurationMs?: number

  /**
   * Cost in USD (if available)
   */
  costUsd?: number

  /**
   * Token usage statistics
   */
  usage?: TokenUsage

  /**
   * Raw response from provider (for debugging/benchmarking)
   */
  rawResponse: string

  /**
   * HTTP status code (for API providers)
   */
  httpStatusCode?: number

  /**
   * Provider-specific metadata
   */
  providerMetadata?: Record<string, unknown>
}

/**
 * Complete LLM response with content and metadata
 */
export interface LLMResponse {
  /**
   * Text content from LLM
   */
  content: string

  /**
   * Response metadata
   */
  metadata: ResponseMetadata
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

/**
 * Circuit breaker state data
 */
export interface CircuitBreakerState {
  /**
   * Current circuit state
   */
  state: CircuitState

  /**
   * Number of consecutive failures
   */
  consecutiveFailures: number

  /**
   * Timestamp of last failure (epoch seconds)
   */
  lastFailureTime: number

  /**
   * Current backoff duration in seconds
   */
  backoffDuration: number

  /**
   * Timestamp when we can retry primary (epoch seconds)
   */
  nextRetryTime: number
}

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /**
   * Provider type
   */
  type: ProviderType

  /**
   * Model name
   */
  model: string

  /**
   * Default timeout in seconds
   */
  timeout?: number

  /**
   * Provider-specific options
   */
  options?: Record<string, unknown>
}

/**
 * Claude CLI specific configuration
 */
export interface ClaudeConfig extends ProviderConfig {
  type: 'claude-cli'

  /**
   * Path to Claude binary (optional, defaults to standard locations)
   */
  binPath?: string

  /**
   * Output format (default: 'json' for metadata)
   */
  outputFormat?: 'json' | 'text'

  /**
   * Settings sources (default: 'project')
   */
  settingSources?: 'project' | 'user' | 'both'
}

/**
 * OpenAI API specific configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  type: 'openai-api'

  /**
   * API key (required)
   */
  apiKey: string

  /**
   * API endpoint (default: https://api.openai.com/v1/chat/completions)
   */
  endpoint?: string

  /**
   * Enable structured output with JSON schema (default: true)
   */
  useJsonSchema?: boolean
}

/**
 * OpenRouter API specific configuration
 */
export interface OpenRouterConfig extends ProviderConfig {
  type: 'openrouter'

  /**
   * API key (required)
   */
  apiKey: string

  /**
   * API endpoint (default: https://openrouter.ai/api/v1/chat/completions)
   */
  endpoint?: string

  /**
   * Enable structured output with JSON schema (default: true)
   */
  useJsonSchema?: boolean
}

/**
 * Custom provider configuration
 */
export interface CustomConfig extends ProviderConfig {
  type: 'custom'

  /**
   * Path to custom binary
   */
  binPath: string

  /**
   * Command template with placeholders:
   * - {BIN}: Binary path
   * - {MODEL}: Model name
   * - {PROMPT_FILE}: Temp file with prompt
   * - {TIMEOUT}: Timeout in seconds
   */
  commandTemplate: string
}

/**
 * Union type for all provider configs
 */
export type AnyProviderConfig = ClaudeConfig | OpenAIConfig | OpenRouterConfig | CustomConfig

/**
 * Error types for LLM operations
 */
export enum LLMErrorType {
  /**
   * Timeout error (request exceeded time limit)
   */
  TIMEOUT = 'TIMEOUT',

  /**
   * API error (provider returned error response)
   */
  API_ERROR = 'API_ERROR',

  /**
   * Network error (connection failed)
   */
  NETWORK_ERROR = 'NETWORK_ERROR',

  /**
   * JSON parse error (invalid JSON in response)
   */
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',

  /**
   * Validation error (response doesn't match schema)
   */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /**
   * Configuration error (invalid provider config)
   */
  CONFIG_ERROR = 'CONFIG_ERROR',

  /**
   * Circuit breaker open (provider is unavailable)
   */
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',

  /**
   * Unknown error
   */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Custom error class for LLM operations
 */
export class LLMError extends Error {
  constructor(
    public readonly type: LLMErrorType,
    message: string,
    public readonly cause?: unknown,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

/**
 * Result type for operations that may fail
 */
export type Result<T, E = LLMError> = { success: true; value: T } | { success: false; error: E }
