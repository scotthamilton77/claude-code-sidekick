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
 */
const VALIDATION_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/models',
  openai: 'https://api.openai.com/v1/models',
} as const

export type ValidatableProviderType = keyof typeof VALIDATION_ENDPOINTS

/**
 * Validate an API key by calling the provider's models endpoint.
 */
async function validateApiKey(
  provider: ValidatableProviderType,
  apiKey: string,
  logger?: Logger
): Promise<ValidationResult> {
  const endpoint = VALIDATION_ENDPOINTS[provider]

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (response.ok) {
      return { valid: true }
    }
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }
    return { valid: false, error: `API returned status ${response.status}` }
  } catch (err) {
    logger?.warn('API key validation failed', { provider, error: err })
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Validate OpenRouter API key.
 */
export function validateOpenRouterKey(apiKey: string, logger?: Logger): Promise<ValidationResult> {
  return validateApiKey('openrouter', apiKey, logger)
}

/**
 * Validate OpenAI API key.
 */
export function validateOpenAIKey(apiKey: string, logger?: Logger): Promise<ValidationResult> {
  return validateApiKey('openai', apiKey, logger)
}

// Re-export ValidationResult type
export type { ValidationResult } from './providers/base.js'
