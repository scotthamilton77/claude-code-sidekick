import { describe, it, expect, vi } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { ProviderFactory, ProviderError } from '../index'

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('ProviderFactory', () => {
  it('creates OpenAI provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openai')
  })

  it('creates OpenRouter provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openrouter',
        apiKey: 'sk-or-test-key',
        model: 'openai/gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openrouter')
  })

  it('creates Claude CLI provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'claude-cli',
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('claude-cli')
  })

  it('throws error for OpenAI without API key', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openai',
        model: 'gpt-4',
      },
      logger
    )

    expect(() => factory.create()).toThrow(ProviderError)
  })

  it('throws error for OpenRouter without API key', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openrouter',
        model: 'openai/gpt-4',
      },
      logger
    )

    expect(() => factory.create()).toThrow(ProviderError)
  })

  it('throws error for unknown provider type', () => {
    const factory = new ProviderFactory(
      {
        provider: 'unknown' as any,
        model: 'test-model',
      },
      logger
    )

    expect(() => factory.create()).toThrow('Unknown provider type')
  })
})
