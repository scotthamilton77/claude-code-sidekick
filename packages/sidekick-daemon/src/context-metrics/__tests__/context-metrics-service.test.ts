/**
 * Tests for ContextMetricsService
 *
 * Tests initialization, metrics read/write, event handling, and computed values.
 * CLI capture is skipped via skipCliCapture flag.
 *
 * NOTE: CLI capture methods (captureBaseMetrics, readContextOutputFromTranscript)
 * are integration-test territory - they spawn external CLI and read from ~/.claude/.
 * Run with INTEGRATION_TESTS=1 outside sandbox for full coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { SidekickEvent } from '@sidekick/types'
import { MockLogger, MockHandlerRegistry } from '@sidekick/testing-fixtures'
import { StateService } from '@sidekick/core'
import { ContextMetricsService, createContextMetricsService } from '../context-metrics-service.js'
import { DEFAULT_BASE_METRICS, DEFAULT_PROJECT_METRICS } from '../types.js'

// Test helpers
const TEST_BASE_DIR = '/tmp/claude/context-metrics-test'

async function createTestDirs(): Promise<{ projectDir: string; userConfigDir: string }> {
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const projectDir = path.join(TEST_BASE_DIR, testId, 'project')
  const userConfigDir = path.join(TEST_BASE_DIR, testId, 'user')

  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(userConfigDir, { recursive: true })

  return { projectDir, userConfigDir }
}

async function cleanupTestDirs(projectDir: string): Promise<void> {
  try {
    const testDir = path.dirname(projectDir)
    await fs.rm(testDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

describe('ContextMetricsService', () => {
  let projectDir: string
  let userConfigDir: string
  let logger: MockLogger
  let projectStateService: StateService
  let userStateService: StateService

  beforeEach(async () => {
    const dirs = await createTestDirs()
    projectDir = dirs.projectDir
    userConfigDir = dirs.userConfigDir
    logger = new MockLogger()
    // Create StateService instances for testing
    projectStateService = new StateService(projectDir)
    userStateService = new StateService(userConfigDir, { stateDir: '' })
  })

  afterEach(async () => {
    await cleanupTestDirs(projectDir)
  })

  describe('constructor', () => {
    it('should create service with required config', () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      expect(service).toBeInstanceOf(ContextMetricsService)
    })

    it('should create service with custom userConfigDir', () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      expect(service).toBeInstanceOf(ContextMetricsService)
    })
  })

  describe('createContextMetricsService factory', () => {
    it('should create service instance', () => {
      const service = createContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      expect(service).toBeInstanceOf(ContextMetricsService)
    })
  })

  describe('initialize()', () => {
    it('should write defaults when base metrics file does not exist', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      await service.initialize()

      // Verify defaults were written
      const metrics = await service.readBaseMetrics()
      expect(metrics.capturedFrom).toBe('defaults')
      expect(metrics.systemPromptTokens).toBe(DEFAULT_BASE_METRICS.systemPromptTokens)

      // Verify logging
      expect(logger.wasLogged('ContextMetricsService initializing')).toBe(true)
      expect(logger.wasLogged('Writing default base token metrics (file does not exist)')).toBe(true)
    })

    it('should not overwrite existing real metrics', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write real metrics first
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const realMetrics = {
        systemPromptTokens: 5000,
        systemToolsTokens: 20000,
        autocompactBufferTokens: 50000,
        capturedAt: Date.now(),
        capturedFrom: 'context_command',
        sessionId: 'test-session',
        lastErrorAt: null,
        lastErrorMessage: null,
      }
      await fs.writeFile(path.join(stateDir, 'baseline-user-context-token-metrics.json'), JSON.stringify(realMetrics))

      await service.initialize()

      // Verify real metrics were preserved
      const metrics = await service.readBaseMetrics()
      expect(metrics.capturedFrom).toBe('context_command')
      expect(metrics.systemPromptTokens).toBe(5000)

      // Verify logged that metrics already exist
      expect(logger.wasLogged('Base token metrics already captured')).toBe(true)
    })

    it('should skip capture retry if recent error', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write defaults with recent error (capturedAt > 0 indicates file was previously written)
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const metricsWithError = {
        ...DEFAULT_BASE_METRICS,
        capturedAt: Date.now() - 60000, // Written 1 minute ago
        lastErrorAt: Date.now() - 1000, // Error 1 second ago (within retry interval)
        lastErrorMessage: 'Test error',
      }
      await fs.writeFile(
        path.join(stateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify(metricsWithError)
      )

      await service.initialize()

      expect(logger.wasLogged('Skipping capture - recent error, will retry later')).toBe(true)
    })
  })

  describe('readBaseMetrics()', () => {
    it('should return defaults when file does not exist', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const metrics = await service.readBaseMetrics()

      expect(metrics).toEqual(DEFAULT_BASE_METRICS)
    })

    it('should read valid metrics from file', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write test metrics
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const testMetrics = {
        systemPromptTokens: 3000,
        systemToolsTokens: 15000,
        autocompactBufferTokens: 45000,
        capturedAt: 1700000000000,
        capturedFrom: 'context_command',
        sessionId: 'abc-123',
        lastErrorAt: null,
        lastErrorMessage: null,
      }
      await fs.writeFile(path.join(stateDir, 'baseline-user-context-token-metrics.json'), JSON.stringify(testMetrics))

      const metrics = await service.readBaseMetrics()

      expect(metrics.systemPromptTokens).toBe(3000)
      expect(metrics.systemToolsTokens).toBe(15000)
      expect(metrics.capturedFrom).toBe('context_command')
    })

    it('should return defaults for invalid JSON', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write invalid JSON
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(path.join(stateDir, 'baseline-user-context-token-metrics.json'), 'not valid json')

      const metrics = await service.readBaseMetrics()

      expect(metrics).toEqual(DEFAULT_BASE_METRICS)
    })

    it('should return defaults for invalid schema', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write JSON that doesn't match schema
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(
        path.join(stateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify({ foo: 'bar' })
      )

      const metrics = await service.readBaseMetrics()

      expect(metrics).toEqual(DEFAULT_BASE_METRICS)
    })
  })

  describe('readProjectMetrics()', () => {
    it('should return defaults when file does not exist', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const metrics = await service.readProjectMetrics()

      expect(metrics).toEqual(DEFAULT_PROJECT_METRICS)
    })

    it('should read valid project metrics from file', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write test project metrics
      const stateDir = path.join(projectDir, '.sidekick', 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const testMetrics = {
        mcpToolsTokens: 1000,
        customAgentsTokens: 500,
        memoryFilesTokens: 2000,
        lastUpdatedAt: 1700000000000,
      }
      await fs.writeFile(
        path.join(stateDir, 'baseline-project-context-token-metrics.json'),
        JSON.stringify(testMetrics)
      )

      const metrics = await service.readProjectMetrics()

      expect(metrics.mcpToolsTokens).toBe(1000)
      expect(metrics.customAgentsTokens).toBe(500)
      expect(metrics.memoryFilesTokens).toBe(2000)
    })
  })

  describe('readSessionMetrics()', () => {
    it('should return null when file does not exist', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const metrics = await service.readSessionMetrics('nonexistent-session')

      expect(metrics).toBeNull()
    })

    it('should read valid session metrics from file', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const sessionId = 'test-session-123'

      // Write test session metrics
      const sessionStateDir = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      const testMetrics = {
        sessionId,
        systemPromptTokens: 3000,
        systemToolsTokens: 15000,
        mcpToolsTokens: 1000,
        customAgentsTokens: 500,
        memoryFilesTokens: 2000,
        autocompactBufferTokens: 45000,
        totalOverheadTokens: 66500,
        lastUpdatedAt: 1700000000000,
      }
      await fs.writeFile(path.join(sessionStateDir, 'context-metrics.json'), JSON.stringify(testMetrics))

      const metrics = await service.readSessionMetrics(sessionId)

      expect(metrics).not.toBeNull()
      expect(metrics!.sessionId).toBe(sessionId)
      expect(metrics!.totalOverheadTokens).toBe(66500)
    })
  })

  describe('handleTranscriptContent()', () => {
    it('should return false for non-context output', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const result = await service.handleTranscriptContent('session-1', 'Just a regular message')

      expect(result).toBe(false)
    })

    it('should process valid /context output and update metrics', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const sessionId = 'session-context-test'
      const contextOutput = `<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 63.0k / 200.0k (32%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
| MCP tools | 1.2k | 0.6% |
| Custom agents | 300 | 0.2% |
| Memory files | 1.5k | 0.8% |
| Autocompact buffer | 45.0k | 22.5% |
</local-command-stdout>`

      const result = await service.handleTranscriptContent(sessionId, contextOutput)

      expect(result).toBe(true)

      // Verify session metrics were written
      const sessionMetrics = await service.readSessionMetrics(sessionId)
      expect(sessionMetrics).not.toBeNull()
      expect(sessionMetrics!.systemPromptTokens).toBe(2900)
      expect(sessionMetrics!.systemToolsTokens).toBe(15100)
      expect(sessionMetrics!.mcpToolsTokens).toBe(1200)

      // Verify project metrics were updated
      const projectMetrics = await service.readProjectMetrics()
      expect(projectMetrics.mcpToolsTokens).toBe(1200)
      expect(projectMetrics.memoryFilesTokens).toBe(1500)

      // Verify logging
      expect(logger.wasLogged('Detected /context output in transcript')).toBe(true)
    })

    it('should return false for unparseable /context output', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Has the markers to pass isContextCommandOutput but no valid parseable table
      // Must include: <local-command-stdout>, "System prompt", "System tools", "Context"
      const badOutput = `<local-command-stdout>## Context Usage

System prompt and System tools are here but the table is malformed

| Category | Tokens |
| System prompt | not-a-number |
| System tools | also-not-valid |
</local-command-stdout>`

      const result = await service.handleTranscriptContent('session-1', badOutput)

      expect(result).toBe(false)
      // Verify the debug log was called for parse failure
      expect(logger.wasLogged('Failed to parse /context output')).toBe(true)
    })

    it('should keep minimum memory files across updates', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // First context output with higher memory files
      const firstOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 5k | 2.5% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-1', firstOutput)
      let projectMetrics = await service.readProjectMetrics()
      expect(projectMetrics.memoryFilesTokens).toBe(5000)

      // Second context output with lower memory files
      const secondOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-2', secondOutput)
      projectMetrics = await service.readProjectMetrics()
      expect(projectMetrics.memoryFilesTokens).toBe(2000) // Should be minimum
    })
  })

  describe('getTotalOverhead()', () => {
    it('should calculate total overhead from base and project metrics', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write base metrics
      const userStateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(userStateDir, { recursive: true })
      await fs.writeFile(
        path.join(userStateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify({
          systemPromptTokens: 3000,
          systemToolsTokens: 15000,
          autocompactBufferTokens: 45000,
          capturedAt: Date.now(),
          capturedFrom: 'context_command',
          sessionId: 'test',
          lastErrorAt: null,
          lastErrorMessage: null,
        })
      )

      // Write project metrics
      const projectStateDir = path.join(projectDir, '.sidekick', 'state')
      await fs.mkdir(projectStateDir, { recursive: true })
      await fs.writeFile(
        path.join(projectStateDir, 'baseline-project-context-token-metrics.json'),
        JSON.stringify({
          mcpToolsTokens: 1000,
          customAgentsTokens: 500,
          memoryFilesTokens: 2000,
          lastUpdatedAt: Date.now(),
        })
      )

      const overhead = await service.getTotalOverhead()

      // 3000 + 15000 + 1000 + 500 + 2000 + 45000 = 66500
      expect(overhead).toBe(66500)
    })

    it('should use defaults when no metrics files exist', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const overhead = await service.getTotalOverhead()

      // Should be sum of all defaults
      const expected =
        DEFAULT_BASE_METRICS.systemPromptTokens +
        DEFAULT_BASE_METRICS.systemToolsTokens +
        DEFAULT_PROJECT_METRICS.mcpToolsTokens +
        DEFAULT_PROJECT_METRICS.customAgentsTokens +
        DEFAULT_PROJECT_METRICS.memoryFilesTokens +
        DEFAULT_BASE_METRICS.autocompactBufferTokens

      expect(overhead).toBe(expected)
    })
  })

  describe('getEffectiveLimit()', () => {
    it('should calculate effective limit correctly', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write minimal metrics for predictable calculation
      const userStateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(userStateDir, { recursive: true })
      await fs.writeFile(
        path.join(userStateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify({
          systemPromptTokens: 3000,
          systemToolsTokens: 15000,
          autocompactBufferTokens: 45000,
          capturedAt: Date.now(),
          capturedFrom: 'context_command',
          sessionId: 'test',
          lastErrorAt: null,
          lastErrorMessage: null,
        })
      )

      const projectStateDir = path.join(projectDir, '.sidekick', 'state')
      await fs.mkdir(projectStateDir, { recursive: true })
      await fs.writeFile(
        path.join(projectStateDir, 'baseline-project-context-token-metrics.json'),
        JSON.stringify({
          mcpToolsTokens: 1000,
          customAgentsTokens: 500,
          memoryFilesTokens: 2000,
          lastUpdatedAt: Date.now(),
        })
      )

      // Overhead = 66500, context window = 200000
      const limit = await service.getEffectiveLimit(200000)

      expect(limit).toBe(200000 - 66500)
    })

    it('should return 0 when overhead exceeds context window', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Small context window
      const limit = await service.getEffectiveLimit(1000)

      expect(limit).toBe(0)
    })
  })

  describe('registerHandlers()', () => {
    it('should register transcript event handler', () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const registry = new MockHandlerRegistry()

      service.registerHandlers(registry)

      const handlers = registry.getRegistrations()
      expect(handlers).toHaveLength(1)
      expect(handlers[0].id).toBe('context-metrics:detect-context-output')
      expect(handlers[0].filter.kind).toBe('transcript')
      expect((handlers[0].filter as { eventTypes: string[] }).eventTypes).toContain('UserPrompt')
    })

    it('should process /context output when handler is triggered', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const registry = new MockHandlerRegistry()
      service.registerHandlers(registry)

      const handlerReg = registry.getHandler('context-metrics:detect-context-output')
      const handler = handlerReg!.handler

      const sessionId = 'handler-test-session'
      const contextOutput = `<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 63.0k / 200.0k (32%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
| MCP tools | 1.2k | 0.6% |
| Custom agents | 300 | 0.2% |
| Memory files | 1.5k | 0.8% |
| Autocompact buffer | 45.0k | 22.5% |
</local-command-stdout>`

      // Create a transcript event
      const event = {
        kind: 'transcript',
        type: 'UserPrompt',
        payload: {
          entry: {
            message: { content: contextOutput },
          },
        },
        context: {
          sessionId,
          projectDir,
        },
      } as unknown as SidekickEvent

      await handler(event, {})

      // Verify session metrics were written
      const sessionMetrics = await service.readSessionMetrics(sessionId)
      expect(sessionMetrics).not.toBeNull()
      expect(sessionMetrics!.systemPromptTokens).toBe(2900)
      expect(logger.wasLogged('Context metrics updated from /context output')).toBe(true)
    })

    it('should skip non-transcript events', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const registry = new MockHandlerRegistry()
      service.registerHandlers(registry)

      const handlerReg = registry.getHandler('context-metrics:detect-context-output')
      const handler = handlerReg!.handler

      // Non-transcript event
      const event = {
        kind: 'lifecycle',
        type: 'SessionStart',
        payload: {},
        context: {},
      } as unknown as SidekickEvent

      await handler(event, {})

      // Should not log context metrics updated
      expect(logger.wasLogged('Context metrics updated from /context output')).toBe(false)
    })

    it('should skip events without message content', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const registry = new MockHandlerRegistry()
      service.registerHandlers(registry)

      const handlerReg = registry.getHandler('context-metrics:detect-context-output')
      const handler = handlerReg!.handler

      // Event with no content
      const event = {
        kind: 'transcript',
        type: 'UserPrompt',
        payload: {
          entry: {
            message: {},
          },
        },
        context: {
          sessionId: 'test',
          projectDir,
        },
      } as unknown as SidekickEvent

      await handler(event, {})

      expect(logger.wasLogged('Context metrics updated from /context output')).toBe(false)
    })

    it('should skip events without sessionId', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const registry = new MockHandlerRegistry()
      service.registerHandlers(registry)

      const handlerReg = registry.getHandler('context-metrics:detect-context-output')
      const handler = handlerReg!.handler

      // Event with no sessionId
      const contextOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 5k | 2.5% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      const event = {
        kind: 'transcript',
        type: 'UserPrompt',
        payload: {
          entry: {
            message: { content: contextOutput },
          },
        },
        context: {
          projectDir,
          // no sessionId
        },
      } as unknown as SidekickEvent

      await handler(event, {})

      expect(logger.wasLogged('Context metrics updated from /context output')).toBe(false)
    })
  })

  describe('updateProjectMetrics()', () => {
    it('should not update if values are the same', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // First context output to initialize
      const firstOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-1', firstOutput)
      const firstMetrics = await service.readProjectMetrics()

      // Second identical output
      await service.handleTranscriptContent('session-2', firstOutput)
      const secondMetrics = await service.readProjectMetrics()

      // lastUpdatedAt should be the same (no update)
      expect(secondMetrics.lastUpdatedAt).toBe(firstMetrics.lastUpdatedAt)
    })

    it('should update when MCP tools change', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // First context output
      const firstOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-1', firstOutput)
      const firstMetrics = await service.readProjectMetrics()
      expect(firstMetrics.mcpToolsTokens).toBe(1000)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      // Second output with different MCP tools
      const secondOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 2k | 1.0% |
| Custom agents | 300 | 0.2% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-2', secondOutput)
      const secondMetrics = await service.readProjectMetrics()

      expect(secondMetrics.mcpToolsTokens).toBe(2000)
      expect(secondMetrics.lastUpdatedAt).toBeGreaterThan(firstMetrics.lastUpdatedAt)
    })

    it('should update when custom agents change', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // First context output
      const firstOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 300 | 0.2% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-1', firstOutput)
      const firstMetrics = await service.readProjectMetrics()
      expect(firstMetrics.customAgentsTokens).toBe(300)

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10))

      // Second output with different custom agents
      const secondOutput = `<local-command-stdout>## Context Usage
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 15k | 7.5% |
| MCP tools | 1k | 0.5% |
| Custom agents | 500 | 0.3% |
| Memory files | 2k | 1.0% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

      await service.handleTranscriptContent('session-2', secondOutput)
      const secondMetrics = await service.readProjectMetrics()

      expect(secondMetrics.customAgentsTokens).toBe(500)
      expect(secondMetrics.lastUpdatedAt).toBeGreaterThan(firstMetrics.lastUpdatedAt)
    })
  })

  describe('readSessionMetrics() edge cases', () => {
    it('should return null for invalid JSON', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const sessionId = 'invalid-json-session'
      const sessionStateDir = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      await fs.writeFile(path.join(sessionStateDir, 'context-metrics.json'), 'not valid json')

      const metrics = await service.readSessionMetrics(sessionId)

      expect(metrics).toBeNull()
    })

    it('should return null for invalid schema', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      const sessionId = 'invalid-schema-session'
      const sessionStateDir = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      await fs.writeFile(path.join(sessionStateDir, 'context-metrics.json'), JSON.stringify({ foo: 'bar' }))

      const metrics = await service.readSessionMetrics(sessionId)

      expect(metrics).toBeNull()
    })
  })

  describe('readProjectMetrics() edge cases', () => {
    it('should return defaults for invalid JSON', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write invalid JSON
      const stateDir = path.join(projectDir, '.sidekick', 'state')
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(path.join(stateDir, 'baseline-project-context-token-metrics.json'), 'not valid json')

      const metrics = await service.readProjectMetrics()

      expect(metrics).toEqual(DEFAULT_PROJECT_METRICS)
    })

    it('should return defaults for invalid schema', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true,
      })

      // Write JSON that doesn't match schema
      const stateDir = path.join(projectDir, '.sidekick', 'state')
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(
        path.join(stateDir, 'baseline-project-context-token-metrics.json'),
        JSON.stringify({ foo: 'bar' })
      )

      const metrics = await service.readProjectMetrics()

      expect(metrics).toEqual(DEFAULT_PROJECT_METRICS)
    })
  })
})
