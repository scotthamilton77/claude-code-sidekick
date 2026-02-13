/**
 * API Key Validation
 *
 * Validates API keys by calling provider endpoints that don't consume credits.
 * Each provider has its own validation endpoint and logic.
 */

import type { Logger } from '@sidekick/types'
import type { ValidationResult } from './providers/base.js'

/**
 * Provider-specific validation endpoints.
 * These endpoints are free to call and don't consume credits.
 *
 * NOTE: OpenRouter's /api/v1/models is public (returns 200 for any key).
 * We use /api/v1/key instead, which requires authentication and returns
 * 401 for invalid keys.
 */
const VALIDATION_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/key',
  openai: 'https://api.openai.com/v1/models',
} as const

export type ValidatableProviderType = keyof typeof VALIDATION_ENDPOINTS

/**
 * Validate an API key by calling a provider endpoint that requires authentication.
 *
 * @param timeoutMs - Optional fetch timeout in milliseconds. When omitted, fetch waits indefinitely.
 */
async function validateApiKey(
  provider: ValidatableProviderType,
  apiKey: string,
  logger?: Logger,
  timeoutMs?: number
): Promise<ValidationResult> {
  const endpoint = VALIDATION_ENDPOINTS[provider]

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(timeoutMs !== undefined && { signal: AbortSignal.timeout(timeoutMs) }),
    })

    if (response.ok) {
      return { valid: true }
    }
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }
    return { valid: false, error: `API returned status ${response.status}` }
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
    const errorMsg = isTimeout
      ? `Validation timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : 'Network error'
    logger?.warn('API key validation failed', { provider, error: errorMsg, isTimeout })
    return { valid: false, error: errorMsg }
  }
}

/**
 * Validate OpenRouter API key.
 */
export function validateOpenRouterKey(apiKey: string, logger?: Logger, timeoutMs?: number): Promise<ValidationResult> {
  return validateApiKey('openrouter', apiKey, logger, timeoutMs)
}

/**
 * Validate OpenAI API key.
 */
export function validateOpenAIKey(apiKey: string, logger?: Logger, timeoutMs?: number): Promise<ValidationResult> {
  return validateApiKey('openai', apiKey, logger, timeoutMs)
}

// Re-export ValidationResult type
export type { ValidationResult } from './providers/base.js'
