/**
 * Test suite for mock implementations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MockLLMService,
  MockLogger,
  MockConfigService,
  MockAssetResolver,
  createMockContext,
  createTestConfig,
  createTestFeature,
  createRecordingFeature,
} from '../index'

describe('MockLLMService', () => {
  let llm: MockLLMService

  beforeEach(() => {
    llm = new MockLLMService()
  })

  it('returns queued responses in order', async () => {
    llm.queueResponses(['First', 'Second', 'Third'])

    const result1 = await llm.complete({ messages: [{ role: 'user', content: 'Test 1' }] })
    const result2 = await llm.complete({ messages: [{ role: 'user', content: 'Test 2' }] })
    const result3 = await llm.complete({ messages: [{ role: 'user', content: 'Test 3' }] })

    expect(result1.content).toBe('First')
    expect(result2.content).toBe('Second')
    expect(result3.content).toBe('Third')
  })

  it('returns default response when queue empty', async () => {
    llm.setDefaultResponse('Default response')

    const result = await llm.complete({ messages: [{ role: 'user', content: 'Test' }] })

    expect(result.content).toBe('Default response')
  })

  it('records all requests for assertions', async () => {
    await llm.complete({ messages: [{ role: 'user', content: 'First' }] })
    await llm.complete({ messages: [{ role: 'user', content: 'Second' }] })

    expect(llm.recordedRequests).toHaveLength(2)
    expect(llm.recordedRequests[0].messages[0].content).toBe('First')
    expect(llm.recordedRequests[1].messages[0].content).toBe('Second')
  })

  it('wasCalledWith matches partial request', async () => {
    await llm.complete({
      messages: [{ role: 'user', content: 'Test' }],
      model: 'test-model',
      temperature: 0.7,
    })

    expect(llm.wasCalledWith({ model: 'test-model' })).toBe(true)
    expect(llm.wasCalledWith({ temperature: 0.7 })).toBe(true)
    expect(llm.wasCalledWith({ model: 'other-model' })).toBe(false)
  })

  it('wasCalledWith matches messages array', async () => {
    await llm.complete({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
    })

    expect(
      llm.wasCalledWith({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      })
    ).toBe(true)

    expect(
      llm.wasCalledWith({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).toBe(false)
  })

  it('reset clears queue and recorded requests', async () => {
    llm.queueResponse('Test')
    await llm.complete({ messages: [{ role: 'user', content: 'Test' }] })

    llm.reset()

    expect(llm.recordedRequests).toHaveLength(0)
    expect(llm.getLastRequest()).toBeUndefined()
  })

  it('getLastRequest returns most recent request', async () => {
    await llm.complete({ messages: [{ role: 'user', content: 'First' }] })
    await llm.complete({ messages: [{ role: 'user', content: 'Second' }] })

    const last = llm.getLastRequest()
    expect(last?.messages[0].content).toBe('Second')
  })

  it('includes usage statistics in response', async () => {
    const result = await llm.complete({
      messages: [{ role: 'user', content: 'Test message for tokens' }],
    })

    expect(result.usage).toBeDefined()
    expect(result.usage?.inputTokens).toBeGreaterThan(0)
    expect(result.usage?.outputTokens).toBeGreaterThan(0)
  })
})

describe('MockLogger', () => {
  let logger: MockLogger

  beforeEach(() => {
    logger = new MockLogger()
  })

  it('records logs at all levels', () => {
    logger.trace('Trace message')
    logger.debug('Debug message')
    logger.info('Info message')
    logger.warn('Warn message')
    logger.error('Error message')
    logger.fatal('Fatal message')

    expect(logger.recordedLogs).toHaveLength(6)
    expect(logger.recordedLogs[0].level).toBe('trace')
    expect(logger.recordedLogs[5].level).toBe('fatal')
  })

  it('records metadata with messages', () => {
    logger.info('Test message', { key: 'value', count: 42 })

    expect(logger.recordedLogs[0].meta).toEqual({ key: 'value', count: 42 })
  })

  it('wasLogged finds messages', () => {
    logger.info('Test message')

    expect(logger.wasLogged('Test message')).toBe(true)
    expect(logger.wasLogged('Other message')).toBe(false)
  })

  it('wasLoggedAtLevel checks specific level', () => {
    logger.info('Info message')
    logger.error('Error message')

    expect(logger.wasLoggedAtLevel('Info message', 'info')).toBe(true)
    expect(logger.wasLoggedAtLevel('Info message', 'error')).toBe(false)
  })

  it('getLogsByLevel filters correctly', () => {
    logger.info('Info 1')
    logger.error('Error 1')
    logger.info('Info 2')

    const infoLogs = logger.getLogsByLevel('info')
    expect(infoLogs).toHaveLength(2)
    expect(infoLogs[0].msg).toBe('Info 1')
    expect(infoLogs[1].msg).toBe('Info 2')
  })

  it('reset clears recorded logs', () => {
    logger.info('Test')
    logger.reset()

    expect(logger.recordedLogs).toHaveLength(0)
  })

  it('child logger shares recorded logs', () => {
    const child = logger.child({ component: 'test' })
    child.info('Child message')

    expect(logger.recordedLogs).toHaveLength(1)
  })
})

describe('MockConfigService', () => {
  let config: MockConfigService

  beforeEach(() => {
    config = new MockConfigService()
  })

  it('sets and gets configuration', () => {
    config.set({ llm: { provider: 'openai-api' } })

    expect(config.get('llm.provider')).toBe('openai-api')
  })

  it('merges configuration on set', () => {
    config.set({ llm: { provider: 'openai-api' } })
    config.set({ llm: { timeout: 30 } })

    expect(config.get('llm.provider')).toBe('openai-api')
    expect(config.get('llm.timeout')).toBe(30)
  })

  it('returns undefined for missing paths', () => {
    expect(config.get('nonexistent.path')).toBeUndefined()
  })

  it('getAll returns entire config', () => {
    config.set({ llm: { provider: 'openai-api' } })

    const all = config.getAll()
    expect(all).toEqual({ llm: { provider: 'openai-api' } })
  })

  it('reset clears config', () => {
    config.set({ llm: { provider: 'openai-api' } })
    config.reset()

    expect(config.getAll()).toEqual({})
  })
})

describe('MockAssetResolver', () => {
  let assets: MockAssetResolver

  beforeEach(() => {
    assets = new MockAssetResolver()
  })

  it('resolves registered assets', () => {
    assets.register('prompts/test.txt', 'Test content')

    expect(assets.resolve('prompts/test.txt')).toBe('Test content')
  })

  it('returns null for missing assets', () => {
    expect(assets.resolve('missing.txt')).toBeNull()
  })

  it('resolveOrThrow throws for missing assets', () => {
    expect(() => assets.resolveOrThrow('missing.txt')).toThrow('Asset not found')
  })

  it('registerAll sets multiple assets', () => {
    assets.registerAll({
      'asset1.txt': 'Content 1',
      'asset2.txt': 'Content 2',
    })

    expect(assets.resolve('asset1.txt')).toBe('Content 1')
    expect(assets.resolve('asset2.txt')).toBe('Content 2')
  })

  it('resolveJson parses JSON content', () => {
    assets.register('data.json', '{"key": "value", "count": 42}')

    const data = assets.resolveJson<{ key: string; count: number }>('data.json')
    expect(data?.key).toBe('value')
    expect(data?.count).toBe(42)
  })

  it('resolvePath returns mock path', () => {
    assets.register('test.txt', 'content')

    expect(assets.resolvePath('test.txt')).toBe('/mock/assets/test.txt')
  })

  it('has checks for asset existence', () => {
    assets.register('exists.txt', 'content')

    expect(assets.has('exists.txt')).toBe(true)
    expect(assets.has('missing.txt')).toBe(false)
  })

  it('reset clears all assets', () => {
    assets.register('test.txt', 'content')
    assets.reset()

    expect(assets.has('test.txt')).toBe(false)
  })
})

describe('createMockContext', () => {
  it('creates context with all required services', () => {
    const ctx = createMockContext()

    expect(ctx.config).toBeInstanceOf(MockConfigService)
    expect(ctx.logger).toBeInstanceOf(MockLogger)
    expect(ctx.llm).toBeInstanceOf(MockLLMService)
    expect(ctx.assets).toBeInstanceOf(MockAssetResolver)
    expect(ctx.paths).toBeDefined()
    expect(ctx.scope).toBe('project')
  })

  it('allows overriding individual services', () => {
    const customLogger = new MockLogger()
    const ctx = createMockContext({ logger: customLogger })

    expect(ctx.logger).toBe(customLogger)
  })

  it('allows overriding scope', () => {
    const ctx = createMockContext({ scope: 'user' })

    expect(ctx.scope).toBe('user')
  })

  it('allows overriding paths', () => {
    const customPaths = {
      projectDir: '/custom/project',
      userDir: '/custom/home',
      configDir: '/custom/config',
      assetsDir: '/custom/assets',
      logsDir: '/custom/logs',
    }
    const ctx = createMockContext({ paths: customPaths })

    expect(ctx.paths.projectDir).toBe('/custom/project')
  })
})

describe('createTestConfig', () => {
  it('creates config with sensible defaults', () => {
    const config = createTestConfig()

    expect(config.llm.provider).toBe('openrouter')
    expect(config.features.statusline).toBe(true)
    expect(config.logLevel).toBe('info')
  })

  it('merges overrides with defaults', () => {
    const config = createTestConfig({
      llm: { provider: 'openai-api', timeout: 20 },
    })

    expect(config.llm.provider).toBe('openai-api')
    expect(config.llm.timeout).toBe(20)
    expect(config.llm.timeoutMaxRetries).toBe(3) // Default preserved
  })

  it('deep merges nested objects', () => {
    const config = createTestConfig({
      llm: {
        circuitBreaker: {
          enabled: false,
        },
      },
    })

    expect(config.llm.circuitBreaker.enabled).toBe(false)
    expect(config.llm.circuitBreaker.failureThreshold).toBe(3) // Default preserved
  })
})

describe('createTestFeature', () => {
  it('creates feature with defaults', () => {
    const feature = createTestFeature()

    expect(feature.name).toBe('test-feature')
    expect(feature.enabled).toBe(true)
    expect(feature.config).toEqual({})
    expect(feature.hooks).toEqual({})
  })

  it('allows overriding properties', () => {
    const feature = createTestFeature({
      name: 'custom-feature',
      enabled: false,
      config: { option: 'value' },
    })

    expect(feature.name).toBe('custom-feature')
    expect(feature.enabled).toBe(false)
    expect(feature.config).toEqual({ option: 'value' })
  })
})

describe('createRecordingFeature', () => {
  it('creates feature with recording hooks', () => {
    const feature = createRecordingFeature('test')

    expect(feature.name).toBe('test')
    expect(feature.hooks.onSessionStart).toBeDefined()
    expect(feature.recordedCalls).toEqual([])
  })

  it('records hook calls', async () => {
    const feature = createRecordingFeature()

    await feature.hooks.onSessionStart?.('ctx')
    await feature.hooks.onUserPrompt?.('ctx', 'Hello')

    expect(feature.recordedCalls).toHaveLength(2)
    expect(feature.recordedCalls[0].hook).toBe('onSessionStart')
    expect(feature.recordedCalls[1].hook).toBe('onUserPrompt')
    expect(feature.recordedCalls[1].args[1]).toBe('Hello')
  })
})
