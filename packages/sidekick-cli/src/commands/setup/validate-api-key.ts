// packages/sidekick-cli/src/commands/setup/validate-api-key.ts
import type { Logger } from '@sidekick/types'

export type ValidationResult = { valid: true } | { valid: false; error: string }

const API_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/models',
  openai: 'https://api.openai.com/v1/models',
} as const

type Provider = keyof typeof API_ENDPOINTS

/**
 * Validate an API key by calling the provider's models endpoint.
 * These are free endpoints that don't consume credits.
 */
async function validateApiKey(provider: Provider, apiKey: string, logger?: Logger): Promise<ValidationResult> {
  try {
    const response = await fetch(API_ENDPOINTS[provider], {
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
    logger?.warn('API key validation failed', { error: err })
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
