/**
 * LLM Provider Interface Definitions
 *
 * Unified type-safe interface for interacting with various LLM providers.
 * All providers implement the LLMProvider interface for consistent interaction.
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

export interface LLMProvider {
  id: string
  complete(request: LLMRequest): Promise<LLMResponse>
}
