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
import { EmulatorStateManager, OpenAIEmulator, OpenRouterEmulator, ClaudeCliEmulator } from './providers/emulators'
import { ProviderError } from './errors'

export type ProviderType = 'openai' | 'openrouter' | 'claude-cli' | 'emulator'

export type EmulatedProviderType = 'openai' | 'openrouter' | 'claude-cli'

export interface ProviderConfig {
  provider: ProviderType
  profileName?: string
  emulatedProvider?: EmulatedProviderType
  emulatorStatePath?: string
  apiKey?: string
  baseURL?: string
  model: string
  maxRetries?: number
  timeout?: number
  temperature?: number
  maxTokens?: number
  cliPath?: string
  // OpenRouter-specific provider routing
  providerAllowlist?: string[]
  providerBlocklist?: string[]
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
      case 'emulator':
        return this.createEmulator()
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
      profileName: this.config.profileName,
      apiKey,
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
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
      profileName: this.config.profileName,
      apiKey,
      baseURL: this.config.baseURL ?? 'https://openrouter.ai/api/v1',
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      providerAllowlist: this.config.providerAllowlist,
      providerBlocklist: this.config.providerBlocklist,
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

  private createEmulator(): LLMProvider {
    const emulatedProvider = this.config.emulatedProvider ?? 'openai'
    const statePath = this.config.emulatorStatePath ?? '.sidekick/emulator-state/call-counts.json'

    this.logger.debug('Creating emulator provider', {
      emulatedProvider,
      model: this.config.model,
      statePath,
    })

    switch (emulatedProvider) {
      case 'openai': {
        const stateManager = new EmulatorStateManager(statePath, this.logger)
        return new OpenAIEmulator(stateManager, { model: this.config.model }, this.logger)
      }
      case 'openrouter': {
        const stateManager = new EmulatorStateManager(statePath, this.logger)
        return new OpenRouterEmulator(stateManager, { model: this.config.model }, this.logger)
      }
      case 'claude-cli':
        // ClaudeCliEmulator spawns a real script, manages its own state
        return new ClaudeCliEmulator({ model: this.config.model, statePath }, this.logger)
      default:
        throw new ProviderError(`Unknown emulated provider: ${emulatedProvider as string}`, 'emulator', false)
    }
  }
}
