/**
 * Abstract LLM provider interface
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh::llm_invoke()
 *
 * All provider implementations must extend this interface and implement
 * the core methods for invoking the LLM and extracting JSON responses.
 */

import { z } from 'zod'
import { InvokeOptions, LLMResponse, ProviderConfig, LLMError, LLMErrorType } from './types.js'

/**
 * Abstract base class for LLM providers
 *
 * Provides common functionality for all providers:
 * - JSON extraction from responses
 * - Error handling
 * - Metadata tracking
 */
export abstract class LLMProvider<TConfig extends ProviderConfig = ProviderConfig> {
  /**
   * Provider configuration
   */
  protected readonly config: TConfig

  constructor(config: TConfig) {
    this.config = config
  }

  /**
   * Invoke the LLM with a prompt
   *
   * This is the main entry point for all LLM interactions.
   * Implementations should:
   * 1. Call the provider's API/CLI
   * 2. Measure timing and extract metadata
   * 3. Return the response with metadata
   *
   * @param prompt - The prompt text to send to the LLM
   * @param options - Invocation options (timeout, schema, etc.)
   * @returns Promise resolving to LLMResponse with content and metadata
   * @throws LLMError on failure
   */
  abstract invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse>

  /**
   * Get the provider name (e.g., "claude-cli", "openai-api")
   *
   * @returns Provider type identifier
   */
  getProviderName(): string {
    return this.config.type
  }

  /**
   * Get the model name (e.g., "haiku", "gpt-4-turbo")
   *
   * @returns Model identifier
   */
  getModelName(): string {
    return this.config.model
  }

  /**
   * Get the full provider identifier (provider/model)
   *
   * @returns Combined identifier string
   */
  getIdentifier(): string {
    return `${this.getProviderName()}/${this.getModelName()}`
  }

  /**
   * Extract JSON from LLM response (handles markdown wrapping)
   *
   * Maps to Track 1: llm.sh::llm_extract_json()
   *
   * This method handles various JSON formats:
   * - Raw JSON: `{"key": "value"}`
   * - Markdown code block: ```json\n{"key": "value"}\n```
   * - Markdown without language: ```\n{"key": "value"}\n```
   * - Single-element array unwrapping: `[{"key": "value"}]` -> `{"key": "value"}`
   *
   * @param response - The LLMResponse object
   * @param schema - Optional Zod schema to validate extracted JSON
   * @returns Parsed and validated JSON object
   * @throws LLMError if JSON is invalid or doesn't match schema
   */
  extractJSON<T = unknown>(response: LLMResponse, schema?: z.ZodSchema<T>): T {
    let text = response.content

    // Try to extract from markdown code block
    const extracted = this.extractFromMarkdown(text)
    if (extracted !== text) {
      text = extracted
    }

    // Look for JSON object in text (from first { to last })
    if (text.includes('{')) {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start !== -1 && end !== -1 && end > start) {
        text = text.substring(start, end + 1)
      }
    }

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new LLMError(
        LLMErrorType.JSON_PARSE_ERROR,
        `Failed to parse JSON from LLM response: ${error instanceof Error ? error.message : String(error)}`,
        error,
        { responsePreview: text.substring(0, 200) }
      )
    }

    // Unwrap single-element arrays
    // Some models incorrectly return [{...}] instead of {...}
    if (Array.isArray(parsed) && parsed.length === 1) {
      parsed = parsed[0]
    }

    // Validate with schema if provided
    if (schema) {
      const result = schema.safeParse(parsed)
      if (!result.success) {
        throw new LLMError(
          LLMErrorType.VALIDATION_ERROR,
          `LLM response doesn't match expected schema: ${result.error.message}`,
          result.error,
          { parsed }
        )
      }
      return result.data
    }

    return parsed as T
  }

  /**
   * Extract JSON from markdown code blocks
   *
   * Handles:
   * - ```json\n...\n```
   * - ```\n...\n```
   * - No markdown (returns input unchanged)
   *
   * @param text - Input text potentially containing markdown
   * @returns Extracted JSON or original text if no markdown found
   */
  protected extractFromMarkdown(text: string): string {
    // Match markdown code blocks: ```json\n...\n``` or ```\n...\n```
    const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/
    const match = text.match(codeBlockRegex)

    if (match && match[1]) {
      return match[1].trim()
    }

    return text
  }

  /**
   * Create a standardized error for provider failures
   *
   * @param type - Error type
   * @param message - Error message
   * @param cause - Original error (if any)
   * @param metadata - Additional metadata
   * @returns LLMError instance
   */
  protected createError(
    type: LLMErrorType,
    message: string,
    cause?: unknown,
    metadata?: Record<string, unknown>
  ): LLMError {
    const fullMessage = `[${this.getIdentifier()}] ${message}`
    return new LLMError(type, fullMessage, cause, {
      provider: this.getProviderName(),
      model: this.getModelName(),
      ...metadata,
    })
  }

  /**
   * Get effective timeout (from options or config default)
   *
   * @param options - Invocation options
   * @returns Timeout in seconds
   */
  protected getTimeout(options?: InvokeOptions): number {
    return options?.timeout ?? this.config.timeout ?? 30
  }

  /**
   * Get effective max retries (from options or default)
   *
   * @param options - Invocation options
   * @returns Max retry attempts
   */
  protected getMaxRetries(options?: InvokeOptions): number {
    return options?.maxRetries ?? 3
  }
}

/**
 * Utility function to extract JSON from raw text (static version)
 *
 * Useful for extracting JSON outside of a provider context.
 *
 * @param text - Text containing JSON
 * @returns Parsed JSON object
 * @throws LLMError if JSON is invalid
 */
export function extractJSONFromText<T = unknown>(text: string, schema?: z.ZodSchema<T>): T {
  // Use a temporary provider instance for the extraction logic
  class TempProvider extends LLMProvider {
    invoke(): Promise<LLMResponse> {
      throw new Error('Not implemented')
    }
  }

  const config: ProviderConfig = { type: 'custom', model: 'temp' }
  const provider = new TempProvider(config)
  return provider.extractJSON({ content: text, metadata: {} as never }, schema)
}
