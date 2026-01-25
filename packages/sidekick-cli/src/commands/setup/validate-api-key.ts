// packages/sidekick-cli/src/commands/setup/validate-api-key.ts
import type { Logger } from '@sidekick/types'

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string }

/**
 * Validate OpenRouter API key by calling the models endpoint.
 * This is a free endpoint that doesn't consume credits.
 */
export async function validateOpenRouterKey(
  apiKey: string,
  logger?: Logger
): Promise<ValidationResult> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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
 * Validate OpenAI API key by calling the models endpoint.
 */
export async function validateOpenAIKey(
  apiKey: string,
  logger?: Logger
): Promise<ValidationResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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
