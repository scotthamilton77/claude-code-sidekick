/**
 * Provider Factory
 *
 * Config-driven instantiation of LLM providers. Handles provider selection
 * and configuration based on runtime config.
 *
 * Credential Precedence (per docs/design/LLM-PROVIDERS.md §6.1):
 * 1. Environment Variables (highest priority): OPENAI_API_KEY, OPENROUTER_API_KEY
 * 2. Configuration File: apiKey in config object
 */

import type { Logger, LLMProvider } from '@sidekick/types'
import { OpenAINativeProvider, type OpenAINativeConfig } from './providers/openai-native'
import { AnthropicCliProvider, type AnthropicCliConfig } from './providers/anthropic-cli'
import { ProviderError } from './errors'

export type ProviderType = 'openai' | 'openrouter' | 'claude-cli'

export interface ProviderConfig {
  provider: ProviderType
  apiKey?: string
  baseURL?: string
  model: string
  maxRetries?: number
  timeout?: number
  cliPath?: string
}

/**
 * Environment variable names for API keys by provider.
 */
const ENV_VAR_NAMES: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

export class ProviderFactory {
  constructor(
    private readonly config: ProviderConfig,
    private readonly logger: Logger
  ) {}

  create(): LLMProvider {
    const { provider } = this.config

    switch (provider) {
      case 'claude-cli':
        return this.createClaudeCli()
      case 'openai':
        return this.createOpenAI()
      case 'openrouter':
        return this.createOpenRouter()
      default:
        throw new ProviderError(`Unknown provider type: ${provider as string}`, 'factory', false)
    }
  }

  /**
   * Resolve API key with precedence: env var > config.
   * Per docs/design/LLM-PROVIDERS.md §6.1
   */
  private resolveApiKey(provider: string): string | undefined {
    const envVarName = ENV_VAR_NAMES[provider]
    if (envVarName) {
      const envValue = process.env[envVarName]
      if (envValue) {
        this.logger.debug('Using API key from environment variable', {
          provider,
          envVar: envVarName,
        })
        return envValue
      }
    }
    return this.config.apiKey
  }

  private createOpenAI(): LLMProvider {
    const apiKey = this.resolveApiKey('openai')
    if (!apiKey) {
      throw new ProviderError(
        'OpenAI requires apiKey in config or OPENAI_API_KEY environment variable',
        'openai',
        false
      )
    }

    const openaiConfig: OpenAINativeConfig = {
      apiKey,
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
    }

    return new OpenAINativeProvider(openaiConfig, this.logger)
  }

  private createOpenRouter(): LLMProvider {
    const apiKey = this.resolveApiKey('openrouter')
    if (!apiKey) {
      throw new ProviderError(
        'OpenRouter requires apiKey in config or OPENROUTER_API_KEY environment variable',
        'openrouter',
        false
      )
    }

    const openrouterConfig: OpenAINativeConfig = {
      apiKey,
      baseURL: this.config.baseURL ?? 'https://openrouter.ai/api/v1',
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
    }

    return new OpenAINativeProvider(openrouterConfig, this.logger)
  }

  private createClaudeCli(): LLMProvider {
    const cliConfig: AnthropicCliConfig = {
      model: this.config.model,
      cliPath: this.config.cliPath,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
    }

    this.logger.debug('Creating Claude CLI provider', {
      model: this.config.model,
      cliPath: this.config.cliPath ?? 'claude',
      timeout: this.config.timeout,
    })

    return new AnthropicCliProvider(cliConfig, this.logger)
  }
}
