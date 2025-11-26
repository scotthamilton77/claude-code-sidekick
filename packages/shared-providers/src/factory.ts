/**
 * Provider Factory
 *
 * Config-driven instantiation of LLM providers. Handles provider selection
 * and configuration based on runtime config.
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
        throw new ProviderError(`Unknown provider type: ${provider}`, 'factory', false)
    }
  }

  private createOpenAI(): LLMProvider {
    if (!this.config.apiKey) {
      throw new ProviderError(
        'OpenAI requires apiKey in config or OPENAI_API_KEY environment variable',
        'openai',
        false
      )
    }

    const openaiConfig: OpenAINativeConfig = {
      apiKey: this.config.apiKey,
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
    }

    return new OpenAINativeProvider(openaiConfig, this.logger)
  }

  private createOpenRouter(): LLMProvider {
    if (!this.config.apiKey) {
      throw new ProviderError(
        'OpenRouter requires apiKey in config or OPENROUTER_API_KEY environment variable',
        'openrouter',
        false
      )
    }

    const openrouterConfig: OpenAINativeConfig = {
      apiKey: this.config.apiKey,
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
