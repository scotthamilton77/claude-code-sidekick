/**
 * LLM Provider Interface Definitions
 *
 * Core types for LLM interaction across the Sidekick runtime.
 * These interfaces are implemented by shared-providers package.
 *
 * @see shared-providers for concrete provider implementations (OpenAI, Claude CLI, etc.)
 */

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * JSON Schema configuration for structured output.
 * When provided, compatible providers will use response_format to enforce the schema.
 */
export interface JsonSchemaConfig {
  /** Name for the schema (used in API requests) */
  name: string
  /** JSON Schema object defining the expected response structure */
  schema: Record<string, unknown>
  /** Whether to enforce strict schema adherence (default: true) */
  strict?: boolean
}

export interface LLMRequest {
  messages: Message[]
  system?: string
  model?: string
  /**
   * JSON Schema for structured output.
   * When provided, the provider will attempt to use native structured output support.
   * Falls back to prompt-based schema guidance for providers that don't support it.
   */
  jsonSchema?: JsonSchemaConfig
  additionalParams?: Record<string, unknown>
}

export interface LLMResponse {
  content: string
  model: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  rawResponse: {
    status: number
    body: string
  }
}

/**
 * Core LLM provider interface - all providers must implement this.
 * Used by RuntimeContext for dependency injection of LLM capabilities.
 */
export interface LLMProvider {
  id: string
  complete(request: LLMRequest): Promise<LLMResponse>
}

/**
 * Profile-based provider factory interface.
 * Creates LLM providers from named profile configurations.
 * Reads config at call time to enable runtime tunability.
 *
 * @see docs/design/LLM_PROFILES.md for profile system design
 */
export interface ProfileProviderFactory {
  /**
   * Creates a provider for a named profile.
   * Wraps with FallbackProvider if fallbackProfileId is specified.
   *
   * @param profileId - Name of the profile in llm.profiles
   * @param fallbackProfileId - Optional name of fallback profile in llm.fallbacks
   */
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider

  /**
   * Creates a provider using the default profile (llm.defaultProfile).
   */
  createDefault(): LLMProvider
}
