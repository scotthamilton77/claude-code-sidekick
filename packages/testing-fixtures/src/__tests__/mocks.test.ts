/**
 * Test suite for mock implementations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MockLLMService,
  MockLogger,
  MockConfigService,
  MockAssetResolver,
  MockHandlerRegistry,
  createMockSupervisorContext,
  createTestConfig,
  createTestFeature,
  createRecordingFeature,
} from '../index'
import type { SessionStartHookEvent, TranscriptEvent, EventContext } from '@sidekick/types'

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
      system: 'Be helpful',
    })

    expect(llm.wasCalledWith({ model: 'test-model' })).toBe(true)
    expect(llm.wasCalledWith({ system: 'Be helpful' })).toBe(true)
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

  it('provides domain accessors with defaults', () => {
    // All domain accessors should return defaults
    expect(config.core.logging.level).toBe('info')
    expect(config.llm.defaultProfile).toBe('fast-lite')
    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.transcript.watchDebounceMs).toBe(100)
    expect(config.features).toEqual({})
  })

  it('sets and gets configuration via domain accessors', () => {
    config.set({ llm: { profiles: { 'fast-lite': { provider: 'openai' } } } })

    expect(config.llm.profiles['fast-lite'].provider).toBe('openai')
  })

  it('gets configuration by dot-path', () => {
    config.set({ llm: { profiles: { 'fast-lite': { provider: 'openai' } } } })

    expect(config.getPath('llm.profiles.fast-lite.provider')).toBe('openai')
  })

  it('merges configuration on set', () => {
    config.set({ llm: { profiles: { 'fast-lite': { provider: 'openai' } } } })
    config.set({ llm: { profiles: { 'fast-lite': { timeout: 60 } } } })

    expect(config.llm.profiles['fast-lite'].provider).toBe('openai')
    expect(config.llm.profiles['fast-lite'].timeout).toBe(60)
  })

  it('returns undefined for missing paths', () => {
    expect(config.getPath('nonexistent.path')).toBeUndefined()
  })

  it('getAll returns entire config with all domains', () => {
    config.set({ llm: { profiles: { 'fast-lite': { provider: 'openai' } } } })

    const all = config.getAll()
    expect(all.llm.profiles['fast-lite'].provider).toBe('openai')
    expect(all.core).toBeDefined()
    expect(all.transcript).toBeDefined()
    expect(all.features).toBeDefined()
  })

  it('reset restores defaults', () => {
    config.set({ llm: { profiles: { 'fast-lite': { provider: 'openai' } } } })
    config.reset()

    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.core.logging.level).toBe('info')
  })

  it('implements ConfigService interface with sources', () => {
    expect(config.sources).toEqual([])
  })

  it('getFeature returns feature config with defaults', () => {
    config.set({ features: { myFeature: { enabled: true, settings: { option: 'value' } } } })

    const feature = config.getFeature<{ option: string }>('myFeature')
    expect(feature.enabled).toBe(true)
    expect(feature.settings.option).toBe('value')
  })

  it('getFeature returns default for missing features', () => {
    const feature = config.getFeature('nonexistent')
    expect(feature.enabled).toBe(true)
    expect(feature.settings).toEqual({})
  })

  it('provides derived paths', () => {
    expect(config.paths.sessionRoot('abc123')).toBe('.sidekick/sessions/abc123')
    expect(config.paths.stagingRoot('abc123')).toBe('.sidekick/sessions/abc123/stage')
    expect(config.paths.logsDir()).toBe('.sidekick/logs')
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

describe('createMockSupervisorContext', () => {
  it('creates supervisor context with all required services', () => {
    const ctx = createMockSupervisorContext()

    expect(ctx.role).toBe('supervisor')
    expect(ctx.config).toBeInstanceOf(MockConfigService)
    expect(ctx.logger).toBeInstanceOf(MockLogger)
    expect(ctx.llm).toBeInstanceOf(MockLLMService)
    expect(ctx.assets).toBeInstanceOf(MockAssetResolver)
    expect(ctx.paths).toBeDefined()
  })

  it('allows overriding individual services', () => {
    const customLogger = new MockLogger()
    const ctx = createMockSupervisorContext({ logger: customLogger })

    expect(ctx.logger).toBe(customLogger)
  })

  it('allows overriding paths', () => {
    const customPaths = {
      projectDir: '/custom/project',
      userConfigDir: '/custom/home/.sidekick',
      projectConfigDir: '/custom/project/.sidekick',
    }
    const ctx = createMockSupervisorContext({ paths: customPaths })

    expect(ctx.paths.projectDir).toBe('/custom/project')
  })
})

describe('createTestConfig', () => {
  it('creates config with sensible defaults', () => {
    const config = createTestConfig()

    expect(config.llm.defaultProfile).toBe('fast-lite')
    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.core.logging.level).toBe('info')
    expect(config.core.supervisor.idleTimeoutMs).toBe(300000)
    expect(config.transcript.watchDebounceMs).toBe(100)
  })

  it('merges overrides with defaults', () => {
    const config = createTestConfig({
      llm: { profiles: { 'fast-lite': { provider: 'openai', timeout: 20 } } },
    })

    expect(config.llm.profiles['fast-lite'].provider).toBe('openai')
    expect(config.llm.profiles['fast-lite'].timeout).toBe(20)
    expect(config.llm.profiles['fast-lite'].timeoutMaxRetries).toBe(2) // Default preserved
  })

  it('deep merges nested objects', () => {
    const config = createTestConfig({
      core: {
        logging: {
          level: 'debug',
        },
      },
    })

    expect(config.core.logging.level).toBe('debug')
    expect(config.core.logging.format).toBe('pretty') // Default preserved
  })

  it('supports feature flags with enabled/settings structure', () => {
    const config = createTestConfig({
      features: {
        myFeature: {
          enabled: true,
          settings: { threshold: 10 },
        },
      },
    })

    expect(config.features.myFeature?.enabled).toBe(true)
    expect(config.features.myFeature?.settings).toEqual({ threshold: 10 })
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

// Test fixtures for MockHandlerRegistry
const baseContext: EventContext = {
  sessionId: 'test-session-123',
  timestamp: Date.now(),
  scope: 'project',
}

const sessionStartEvent: SessionStartHookEvent = {
  kind: 'hook',
  hook: 'SessionStart',
  context: baseContext,
  payload: {
    startType: 'startup',
    transcriptPath: '/path/to/transcript.jsonl',
  },
}

describe('MockHandlerRegistry', () => {
  let registry: MockHandlerRegistry

  beforeEach(() => {
    registry = new MockHandlerRegistry()
  })

  describe('register', () => {
    it('records handler registrations', () => {
      registry.register({
        id: 'test:handler',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: async () => {},
      })

      const registrations = registry.getRegistrations()
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('test:handler')
      expect(registrations[0].priority).toBe(50)
    })

    it('allows multiple registrations', () => {
      registry.register({
        id: 'handler1',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: async () => {},
      })
      registry.register({
        id: 'handler2',
        priority: 50,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: async () => {},
      })

      expect(registry.getRegistrations()).toHaveLength(2)
    })
  })

  describe('getHandler', () => {
    it('retrieves handler by ID', () => {
      registry.register({
        id: 'test:handler',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: () => Promise.resolve({ stop: true }),
      })

      const handler = registry.getHandler('test:handler')
      expect(handler).toBeDefined()
      expect(handler?.id).toBe('test:handler')
    })

    it('returns undefined for missing handler', () => {
      expect(registry.getHandler('nonexistent')).toBeUndefined()
    })
  })

  describe('getHandlersByKind', () => {
    beforeEach(() => {
      registry.register({
        id: 'hook-handler',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart', 'SessionEnd'] },
        handler: async () => {},
      })
      registry.register({
        id: 'transcript-handler',
        priority: 50,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: async () => {},
      })
      registry.register({
        id: 'all-handler',
        priority: 25,
        filter: { kind: 'all' },
        handler: async () => {},
      })
    })

    it('filters by hook kind', () => {
      const handlers = registry.getHandlersByKind('hook')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('hook-handler')
    })

    it('filters by transcript kind', () => {
      const handlers = registry.getHandlersByKind('transcript')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('transcript-handler')
    })

    it('filters by all kind', () => {
      const handlers = registry.getHandlersByKind('all')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('all-handler')
    })
  })

  describe('getHandlersForHook', () => {
    beforeEach(() => {
      registry.register({
        id: 'session-start-handler',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: async () => {},
      })
      registry.register({
        id: 'multi-hook-handler',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart', 'SessionEnd'] },
        handler: async () => {},
      })
      registry.register({
        id: 'stop-handler',
        priority: 25,
        filter: { kind: 'hook', hooks: ['Stop'] },
        handler: async () => {},
      })
    })

    it('finds handlers for specific hook', () => {
      const handlers = registry.getHandlersForHook('SessionStart')
      expect(handlers).toHaveLength(2)
    })

    it('returns empty for hook with no handlers', () => {
      const handlers = registry.getHandlersForHook('PreCompact')
      expect(handlers).toHaveLength(0)
    })
  })

  describe('getHandlersForTranscriptEvent', () => {
    beforeEach(() => {
      registry.register({
        id: 'user-prompt-handler',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: async () => {},
      })
      registry.register({
        id: 'tool-handler',
        priority: 50,
        filter: { kind: 'transcript', eventTypes: ['ToolCall', 'ToolResult'] },
        handler: async () => {},
      })
    })

    it('finds handlers for specific transcript event type', () => {
      const handlers = registry.getHandlersForTranscriptEvent('UserPrompt')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('user-prompt-handler')
    })

    it('finds handlers for multiple event types', () => {
      const handlers = registry.getHandlersForTranscriptEvent('ToolCall')
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('tool-handler')
    })
  })

  describe('invokeHook', () => {
    it('records invocation', async () => {
      await registry.invokeHook('SessionStart', sessionStartEvent)

      const calls = registry.getInvokeHookCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].hook).toBe('SessionStart')
      expect(calls[0].event).toBe(sessionStartEvent)
    })

    it('returns default response', async () => {
      const response = await registry.invokeHook('SessionStart', sessionStartEvent)
      expect(response).toEqual({})
    })

    it('returns custom default response when set', async () => {
      registry.defaultHookResponse = { blocking: true, reason: 'Test block' }

      const response = await registry.invokeHook('SessionStart', sessionStartEvent)
      expect(response.blocking).toBe(true)
      expect(response.reason).toBe('Test block')
    })
  })

  describe('emitTranscriptEvent', () => {
    it('records emission', () => {
      const entry = { type: 'human', message: 'Hello' }
      registry.emitTranscriptEvent('UserPrompt', entry, 42)

      const calls = registry.getEmitTranscriptCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].eventType).toBe('UserPrompt')
      expect(calls[0].entry).toBe(entry)
      expect(calls[0].lineNumber).toBe(42)
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      registry.register({
        id: 'test',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: async () => {},
      })
      await registry.invokeHook('SessionStart', sessionStartEvent)
      registry.emitTranscriptEvent('UserPrompt', {}, 1)
      registry.defaultHookResponse = { blocking: true }

      registry.reset()

      expect(registry.getRegistrations()).toHaveLength(0)
      expect(registry.getInvokeHookCalls()).toHaveLength(0)
      expect(registry.getEmitTranscriptCalls()).toHaveLength(0)
      expect(registry.defaultHookResponse).toEqual({})
    })
  })
})

describe('createMockSupervisorContext with handlers', () => {
  it('includes handlers in context', () => {
    const ctx = createMockSupervisorContext()

    expect(ctx.handlers).toBeInstanceOf(MockHandlerRegistry)
  })

  it('allows overriding handlers', () => {
    const customHandlers = new MockHandlerRegistry()
    customHandlers.defaultHookResponse = { blocking: true }

    const ctx = createMockSupervisorContext({ handlers: customHandlers })

    expect(ctx.handlers).toBe(customHandlers)
    // Access mock-specific property through the typed reference
    expect(customHandlers.defaultHookResponse.blocking).toBe(true)
  })
})
