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
  MockTranscriptService,
  MockStagingService,
  MockTelemetry,
  MockDaemonClient,
  MockProfileProviderFactory,
  createDefaultMetrics,
  createDefaultTokenUsage,
  createMockDaemonContext,
  createMockCLIContext,
  createTestConfig,
  createTestFeature,
  createRecordingFeature,
} from '../index'
import type { SessionStartHookEvent, EventContext, StagedReminder } from '@sidekick/types'

/** Helper to create valid StagedReminder test fixtures */
function createTestReminder(name: string, overrides: Partial<StagedReminder> = {}): StagedReminder {
  return {
    name,
    blocking: false,
    priority: 0,
    persistent: false,
    ...overrides,
  }
}

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

  it('resolveJson returns null for missing assets', () => {
    expect(assets.resolveJson('missing.json')).toBeNull()
  })

  it('resolveJson throws on invalid JSON content', () => {
    assets.register('invalid.json', 'not valid json {')

    expect(() => assets.resolveJson('invalid.json')).toThrow(SyntaxError)
  })

  it('resolveYaml parses valid YAML', () => {
    assets.register('config.yaml', 'key: value\ncount: 42')

    const data = assets.resolveYaml<{ key: string; count: number }>('config.yaml')
    expect(data?.key).toBe('value')
    expect(data?.count).toBe(42)
  })

  it('resolveYaml returns null for missing assets', () => {
    expect(assets.resolveYaml('missing.yaml')).toBeNull()
  })

  it('resolveYaml throws on invalid YAML', () => {
    assets.register('invalid.yaml', '{{ invalid yaml ::')

    expect(() => assets.resolveYaml('invalid.yaml')).toThrow(/Failed to parse YAML asset/)
  })

  it('resolvePath returns null for missing assets', () => {
    expect(assets.resolvePath('missing.txt')).toBeNull()
  })
})

describe('MockTranscriptService', () => {
  let service: MockTranscriptService

  beforeEach(() => {
    service = new MockTranscriptService()
  })

  describe('lifecycle', () => {
    it('rejects start before prepare', async () => {
      await expect(service.start()).rejects.toThrow('called before prepare')
    })

    it('initializes with prepare and starts successfully', async () => {
      await service.prepare('session-123', '/path/to/transcript.jsonl')
      await service.start()
      expect(service.getSessionInfo().sessionId).toBe('session-123')
      expect(service.getSessionInfo().transcriptPath).toBe('/path/to/transcript.jsonl')
    })

    it('shutdown clears session state', async () => {
      await service.prepare('session-123', '/path/to/transcript.jsonl')
      await service.shutdown()

      const info = service.getSessionInfo()
      expect(info.sessionId).toBeNull()
      expect(info.transcriptPath).toBeNull()
    })
  })

  describe('metrics', () => {
    it('returns default metrics initially', () => {
      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
      expect(metrics.toolCount).toBe(0)
      expect(metrics.messageCount).toBe(0)
    })

    it('setMetrics updates metrics', async () => {
      await service.prepare('s', '/p')
      service.setMetrics({ turnCount: 5, toolCount: 10 })

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(5)
      expect(metrics.toolCount).toBe(10)
    })

    it('getMetric returns individual metric values', async () => {
      await service.prepare('s', '/p')
      service.setMetrics({ turnCount: 7 })

      expect(service.getMetric('turnCount')).toBe(7)
    })

    it('notifies callbacks on setMetrics', async () => {
      await service.prepare('s', '/p')
      const received: unknown[] = []
      service.onMetricsChange((metrics) => received.push(metrics))

      service.setMetrics({ turnCount: 5 })

      expect(received).toHaveLength(1)
      expect((received[0] as { turnCount: number }).turnCount).toBe(5)
    })

    it('fires threshold callback when metric crosses threshold', async () => {
      await service.prepare('s', '/p')
      let fired = false
      service.onThreshold('turnCount', 10, () => {
        fired = true
      })

      service.setMetrics({ turnCount: 5 })
      expect(fired).toBe(false)

      service.setMetrics({ turnCount: 10 })
      expect(fired).toBe(true)
    })

    it('threshold callback only fires on crossing, not when already above', async () => {
      await service.prepare('s', '/p')
      let fireCount = 0
      service.onThreshold('turnCount', 5, () => {
        fireCount++
      })

      service.setMetrics({ turnCount: 10 }) // Cross threshold
      service.setMetrics({ turnCount: 15 }) // Already above

      expect(fireCount).toBe(1)
    })

    it('unsubscribe removes callback', async () => {
      await service.prepare('s', '/p')
      const received: unknown[] = []
      const unsubscribe = service.onMetricsChange((m) => received.push(m))

      service.setMetrics({ turnCount: 1 })
      unsubscribe()
      service.setMetrics({ turnCount: 2 })

      expect(received).toHaveLength(1)
    })
  })

  describe('simulation helpers', () => {
    beforeEach(async () => {
      await service.prepare('s', '/p')
    })

    it('simulateTurn increments turnCount and resets toolsThisTurn', () => {
      service.setMetrics({ toolsThisTurn: 3 })

      service.simulateTurn()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1)
      expect(metrics.toolsThisTurn).toBe(0)
      expect(metrics.messageCount).toBe(1)
    })

    it('simulateToolCall increments toolCount and toolsThisTurn', () => {
      service.simulateToolCall()
      service.simulateToolCall()

      const metrics = service.getMetrics()
      expect(metrics.toolCount).toBe(2)
      expect(metrics.toolsThisTurn).toBe(2)
    })

    it('simulateTokenUsage accumulates token counts', () => {
      service.simulateTokenUsage({ inputTokens: 100, outputTokens: 50 })
      service.simulateTokenUsage({ inputTokens: 200, outputTokens: 100 })

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.inputTokens).toBe(300)
      expect(metrics.tokenUsage.outputTokens).toBe(150)
      expect(metrics.tokenUsage.totalTokens).toBe(450)
    })

    it('simulateTokenUsage tracks by model', () => {
      service.simulateTokenUsage({ inputTokens: 100, outputTokens: 50, model: 'gpt-4' })
      service.simulateTokenUsage({ inputTokens: 200, outputTokens: 100, model: 'gpt-4' })

      const byModel = service.getMetrics().tokenUsage.byModel
      expect(byModel['gpt-4'].inputTokens).toBe(300)
      expect(byModel['gpt-4'].outputTokens).toBe(150)
      expect(byModel['gpt-4'].requestCount).toBe(2)
    })

    it('simulateAssistantMessage increments messageCount only', () => {
      const beforeMetrics = service.getMetrics()
      service.simulateAssistantMessage()

      const afterMetrics = service.getMetrics()
      expect(afterMetrics.messageCount).toBe(beforeMetrics.messageCount + 1)
      expect(afterMetrics.turnCount).toBe(beforeMetrics.turnCount)
    })

    it('simulateLineProcessed increments lastProcessedLine', () => {
      service.simulateLineProcessed()
      service.simulateLineProcessed()

      expect(service.getMetrics().lastProcessedLine).toBe(2)
    })
  })

  describe('transcript data', () => {
    beforeEach(async () => {
      await service.prepare('session-xyz', '/transcript.jsonl')
    })

    it('getTranscript returns configured entries', () => {
      const entries = [
        {
          id: 'entry-1',
          timestamp: new Date(),
          role: 'user' as const,
          type: 'text' as const,
          content: 'Hello',
          metadata: { provider: 'test' },
        },
      ]
      service.setMockEntries(entries)

      const transcript = service.getTranscript()
      expect(transcript.entries).toBe(entries)
      expect(transcript.metadata.sessionId).toBe('session-xyz')
    })

    it('getExcerpt returns configured content', () => {
      service.setMockExcerptContent('Recent conversation...')
      service.setMetrics({ lastProcessedLine: 100 })

      const excerpt = service.getExcerpt({ maxLines: 50 })
      expect(excerpt.content).toBe('Recent conversation...')
      expect(excerpt.lineCount).toBeLessThanOrEqual(50)
    })
  })

  describe('compaction', () => {
    beforeEach(async () => {
      await service.prepare('s', '/p')
    })

    it('capturePreCompactState records compaction entry', async () => {
      service.setMetrics({ turnCount: 10, toolCount: 5 })

      await service.capturePreCompactState('/snapshot/path.jsonl')

      const history = service.getCompactionHistory()
      expect(history).toHaveLength(1)
      expect(history[0].transcriptSnapshotPath).toBe('/snapshot/path.jsonl')
      expect(history[0].metricsAtCompaction.turnCount).toBe(10)
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      await service.prepare('s', '/p')
      service.setMetrics({ turnCount: 5 })
      service.onMetricsChange(() => {})

      service.reset()

      expect(service.getSessionInfo().sessionId).toBeNull()
      expect(service.getMetrics().turnCount).toBe(0)
      expect(service.getCallbackCounts().metricsCallbacks).toBe(0)
    })
  })
})

describe('MockStagingService', () => {
  let staging: MockStagingService

  beforeEach(() => {
    staging = new MockStagingService()
  })

  describe('CRUD operations', () => {
    it('stages and retrieves reminders', async () => {
      const reminder = createTestReminder('test', { userMessage: 'hello' })
      await staging.stageReminder('SessionStart', 'test', reminder)

      const retrieved = await staging.readReminder('SessionStart', 'test')
      expect(retrieved).toEqual(reminder)
    })

    it('returns null for missing reminders', async () => {
      const result = await staging.readReminder('SessionStart', 'nonexistent')
      expect(result).toBeNull()
    })

    it('deletes reminders', async () => {
      await staging.stageReminder('SessionStart', 'test', createTestReminder('test'))
      await staging.deleteReminder('SessionStart', 'test')

      const result = await staging.readReminder('SessionStart', 'test')
      expect(result).toBeNull()
    })

    it('listReminders returns reminders for specific hook', async () => {
      await staging.stageReminder('SessionStart', 'a', createTestReminder('a'))
      await staging.stageReminder('SessionStart', 'b', createTestReminder('b'))
      await staging.stageReminder('SessionEnd', 'c', createTestReminder('c'))

      const list = await staging.listReminders('SessionStart')
      expect(list).toHaveLength(2)
    })
  })

  describe('clearStaging', () => {
    beforeEach(async () => {
      await staging.stageReminder('SessionStart', 'a', createTestReminder('a'))
      await staging.stageReminder('SessionStart', 'b', createTestReminder('b'))
      await staging.stageReminder('SessionEnd', 'c', createTestReminder('c'))
    })

    it('clears only specified hook reminders', async () => {
      await staging.clearStaging('SessionStart')

      expect(await staging.readReminder('SessionStart', 'a')).toBeNull()
      expect(await staging.readReminder('SessionStart', 'b')).toBeNull()
      expect(await staging.readReminder('SessionEnd', 'c')).not.toBeNull()
    })

    it('clears all reminders when no hook specified', async () => {
      await staging.clearStaging()

      expect(await staging.readReminder('SessionStart', 'a')).toBeNull()
      expect(await staging.readReminder('SessionEnd', 'c')).toBeNull()
    })
  })

  describe('consumed reminders', () => {
    it('tracks consumed reminders via addConsumedReminder', async () => {
      const reminder = createTestReminder('test', { userMessage: 'data' })
      staging.addConsumedReminder('SessionStart', 'test', reminder)

      const consumed = await staging.listConsumedReminders('SessionStart', 'test')
      expect(consumed).toHaveLength(1)
      expect(consumed[0]).toEqual(reminder)
    })

    it('getLastConsumed returns most recent', async () => {
      staging.addConsumedReminder('Hook', 'name', createTestReminder('first'))
      staging.addConsumedReminder('Hook', 'name', createTestReminder('second'))

      const last = await staging.getLastConsumed('Hook', 'name')
      expect(last?.name).toBe('second')
    })

    it('getLastConsumed returns null when none consumed', async () => {
      const result = await staging.getLastConsumed('Hook', 'missing')
      expect(result).toBeNull()
    })
  })

  describe('test utilities', () => {
    it('getAllReminders returns copy of all reminders', async () => {
      await staging.stageReminder('Hook1', 'a', createTestReminder('a'))
      await staging.stageReminder('Hook2', 'b', createTestReminder('b'))

      const all = staging.getAllReminders()
      expect(all.size).toBe(2)
    })

    it('getRemindersForHook returns filtered list', async () => {
      await staging.stageReminder('SessionStart', 'a', createTestReminder('a'))
      await staging.stageReminder('SessionEnd', 'b', createTestReminder('b'))

      const forHook = staging.getRemindersForHook('SessionStart')
      expect(forHook).toHaveLength(1)
    })

    it('reset clears all state', async () => {
      await staging.stageReminder('Hook', 'a', createTestReminder('a'))
      staging.addConsumedReminder('Hook', 'b', createTestReminder('b'))

      staging.reset()

      expect(staging.getAllReminders().size).toBe(0)
      expect(await staging.listConsumedReminders('Hook', 'b')).toHaveLength(0)
    })
  })
})

describe('MockTelemetry', () => {
  let telemetry: MockTelemetry

  beforeEach(() => {
    telemetry = new MockTelemetry()
  })

  describe('recording', () => {
    it('increment records counter calls', () => {
      telemetry.increment('requests', { path: '/api' })

      expect(telemetry.counters).toHaveLength(1)
      expect(telemetry.counters[0].name).toBe('requests')
      expect(telemetry.counters[0].tags?.path).toBe('/api')
    })

    it('gauge records gauge values', () => {
      telemetry.gauge('memory_usage', 1024, { unit: 'mb' })

      expect(telemetry.gauges).toHaveLength(1)
      expect(telemetry.gauges[0].name).toBe('memory_usage')
      expect(telemetry.gauges[0].value).toBe(1024)
    })

    it('histogram records distribution values', () => {
      telemetry.histogram('response_time', 150, 'ms', { endpoint: '/health' })

      expect(telemetry.histograms).toHaveLength(1)
      expect(telemetry.histograms[0].name).toBe('response_time')
      expect(telemetry.histograms[0].value).toBe(150)
      expect(telemetry.histograms[0].unit).toBe('ms')
    })
  })

  describe('query helpers', () => {
    beforeEach(() => {
      telemetry.increment('count', { type: 'a' })
      telemetry.increment('count', { type: 'b' })
      telemetry.histogram('duration', 100, 'ms', { op: 'read' })
      telemetry.histogram('duration', 200, 'ms', { op: 'write' })
    })

    it('getCountersByName filters counters', () => {
      const counts = telemetry.getCountersByName('count')
      expect(counts).toHaveLength(2)
    })

    it('getHistogramsByName filters histograms', () => {
      const durations = telemetry.getHistogramsByName('duration')
      expect(durations).toHaveLength(2)
    })

    it('wasCounterIncremented checks by name only', () => {
      expect(telemetry.wasCounterIncremented('count')).toBe(true)
      expect(telemetry.wasCounterIncremented('missing')).toBe(false)
    })

    it('wasCounterIncremented checks with tag filter', () => {
      expect(telemetry.wasCounterIncremented('count', { type: 'a' })).toBe(true)
      expect(telemetry.wasCounterIncremented('count', { type: 'c' })).toBe(false)
    })

    it('wasHistogramRecorded checks by name only', () => {
      expect(telemetry.wasHistogramRecorded('duration')).toBe(true)
      expect(telemetry.wasHistogramRecorded('missing')).toBe(false)
    })

    it('wasHistogramRecorded checks with tag filter', () => {
      expect(telemetry.wasHistogramRecorded('duration', { op: 'read' })).toBe(true)
      expect(telemetry.wasHistogramRecorded('duration', { op: 'delete' })).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all recorded telemetry', () => {
      telemetry.increment('count')
      telemetry.gauge('level', 5)
      telemetry.histogram('time', 100, 'ms')

      telemetry.reset()

      expect(telemetry.counters).toHaveLength(0)
      expect(telemetry.gauges).toHaveLength(0)
      expect(telemetry.histograms).toHaveLength(0)
    })
  })
})

describe('MockDaemonClient', () => {
  let client: MockDaemonClient

  beforeEach(() => {
    client = new MockDaemonClient()
  })

  describe('lifecycle', () => {
    it('starts in stopped state', async () => {
      expect(client.isRunning).toBe(false)
      const status = await client.getStatus()
      expect(status.status).toBe('stopped')
    })

    it('start transitions to running', async () => {
      await client.start()

      expect(client.isRunning).toBe(true)
      const status = await client.getStatus()
      expect(status.status).toBe('running')
    })

    it('stop transitions to stopped', async () => {
      await client.start()
      await client.stop()

      expect(client.isRunning).toBe(false)
      const status = await client.getStatus()
      expect(status.status).toBe('stopped')
    })

    it('kill returns success and stops', async () => {
      await client.start()

      const result = await client.kill()

      expect(result.killed).toBe(true)
      expect(client.isRunning).toBe(false)
    })
  })

  describe('setStatus', () => {
    it('allows setting custom status for testing', async () => {
      client.setStatus({ status: 'error', error: 'Connection failed' })

      const status = await client.getStatus()
      expect(status.status).toBe('error')
      expect(status.error).toBe('Connection failed')
    })
  })
})

describe('MockProfileProviderFactory', () => {
  it('createForProfile returns the shared LLM', () => {
    const llm = new MockLLMService()
    const factory = new MockProfileProviderFactory(llm)

    const provider = factory.createForProfile('some-profile')

    expect(provider).toBe(llm)
  })

  it('createDefault returns the shared LLM', () => {
    const llm = new MockLLMService()
    const factory = new MockProfileProviderFactory(llm)

    const provider = factory.createDefault()

    expect(provider).toBe(llm)
  })

  it('uses MockLLMService by default when no LLM provided', () => {
    const factory = new MockProfileProviderFactory()

    const provider = factory.createDefault()

    expect(provider).toBeInstanceOf(MockLLMService)
  })
})

describe('createMockCLIContext', () => {
  it('creates CLI context with role cli', () => {
    const ctx = createMockCLIContext()

    expect(ctx.role).toBe('cli')
  })

  it('includes daemon client', () => {
    const ctx = createMockCLIContext()

    expect(ctx.daemon).toBeInstanceOf(MockDaemonClient)
  })

  it('includes all standard services', () => {
    const ctx = createMockCLIContext()

    expect(ctx.config).toBeInstanceOf(MockConfigService)
    expect(ctx.logger).toBeInstanceOf(MockLogger)
    expect(ctx.assets).toBeInstanceOf(MockAssetResolver)
    expect(ctx.handlers).toBeInstanceOf(MockHandlerRegistry)
    expect(ctx.paths).toBeDefined()
  })

  it('allows overriding daemon client', () => {
    const customDaemon = new MockDaemonClient()
    customDaemon.setStatus({ status: 'custom' })

    const ctx = createMockCLIContext({ daemon: customDaemon })

    expect(ctx.daemon).toBe(customDaemon)
  })
})

describe('createDefaultMetrics', () => {
  it('returns metrics with all zeros', () => {
    const metrics = createDefaultMetrics()

    expect(metrics.turnCount).toBe(0)
    expect(metrics.toolCount).toBe(0)
    expect(metrics.toolsThisTurn).toBe(0)
    expect(metrics.messageCount).toBe(0)
    expect(metrics.lastProcessedLine).toBe(0)
  })

  it('includes token usage with all zeros', () => {
    const metrics = createDefaultMetrics()

    expect(metrics.tokenUsage.inputTokens).toBe(0)
    expect(metrics.tokenUsage.outputTokens).toBe(0)
    expect(metrics.tokenUsage.totalTokens).toBe(0)
  })
})

describe('createDefaultTokenUsage', () => {
  it('returns token usage with all zeros', () => {
    const usage = createDefaultTokenUsage()

    expect(usage.inputTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
    expect(usage.totalTokens).toBe(0)
    expect(usage.cacheCreationInputTokens).toBe(0)
    expect(usage.cacheReadInputTokens).toBe(0)
  })

  it('includes empty collections', () => {
    const usage = createDefaultTokenUsage()

    expect(usage.serviceTierCounts).toEqual({})
    expect(usage.byModel).toEqual({})
  })
})

describe('createMockDaemonContext', () => {
  it('creates daemon context with all required services', () => {
    const ctx = createMockDaemonContext()

    expect(ctx.role).toBe('daemon')
    expect(ctx.config).toBeInstanceOf(MockConfigService)
    expect(ctx.logger).toBeInstanceOf(MockLogger)
    expect(ctx.llm).toBeInstanceOf(MockLLMService)
    expect(ctx.assets).toBeInstanceOf(MockAssetResolver)
    expect(ctx.paths).toBeDefined()
  })

  it('allows overriding individual services', () => {
    const customLogger = new MockLogger()
    const ctx = createMockDaemonContext({ logger: customLogger })

    expect(ctx.logger).toBe(customLogger)
  })

  it('allows overriding paths', () => {
    const customPaths = {
      projectDir: '/custom/project',
      userConfigDir: '/custom/home/.sidekick',
      projectConfigDir: '/custom/project/.sidekick',
    }
    const ctx = createMockDaemonContext({ paths: customPaths })

    expect(ctx.paths.projectDir).toBe('/custom/project')
  })
})

describe('createTestConfig', () => {
  it('creates config with sensible defaults', () => {
    const config = createTestConfig()

    expect(config.llm.defaultProfile).toBe('fast-lite')
    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.core.logging.level).toBe('info')
    expect(config.core.daemon.idleTimeoutMs).toBe(300000)
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
    expect(config.core.logging.format).toBe('json') // Default preserved
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
    it('records emission', async () => {
      const entry = { type: 'human', message: 'Hello' }
      await registry.emitTranscriptEvent('UserPrompt', entry, 42)

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
      await registry.emitTranscriptEvent('UserPrompt', {}, 1)
      registry.defaultHookResponse = { blocking: true }

      registry.reset()

      expect(registry.getRegistrations()).toHaveLength(0)
      expect(registry.getInvokeHookCalls()).toHaveLength(0)
      expect(registry.getEmitTranscriptCalls()).toHaveLength(0)
      expect(registry.defaultHookResponse).toEqual({})
    })
  })
})

describe('createMockDaemonContext with handlers', () => {
  it('includes handlers in context', () => {
    const ctx = createMockDaemonContext()

    expect(ctx.handlers).toBeInstanceOf(MockHandlerRegistry)
  })

  it('allows overriding handlers', () => {
    const customHandlers = new MockHandlerRegistry()
    customHandlers.defaultHookResponse = { blocking: true }

    const ctx = createMockDaemonContext({ handlers: customHandlers })

    expect(ctx.handlers).toBe(customHandlers)
    // Access mock-specific property through the typed reference
    expect(customHandlers.defaultHookResponse.blocking).toBe(true)
  })
})
