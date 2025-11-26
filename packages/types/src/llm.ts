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

export interface LLMRequest {
  messages: Message[]
  system?: string
  model?: string
  temperature?: number
  maxTokens?: number
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
