/**
 * Tests for ContextMetricsService CLI Capture Methods
 *
 * These tests cover the private captureBaseMetrics() method
 * by mocking the external CLI dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { MockLogger } from '@sidekick/testing-fixtures'
import { StateService } from '@sidekick/core'
import { ContextMetricsService } from '../context-metrics-service.js'
import { DEFAULT_BASE_METRICS } from '../types.js'

// Mock spawnClaudeCli
vi.mock('@sidekick/shared-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/shared-providers')>()
  return {
    ...actual,
    spawnClaudeCli: vi.fn(),
  }
})

import { spawnClaudeCli } from '@sidekick/shared-providers'

const mockedSpawnClaudeCli = vi.mocked(spawnClaudeCli)

// Test helpers
const TEST_BASE_DIR = '/tmp/claude/context-metrics-cli-test'

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

describe('ContextMetricsService CLI Capture', () => {
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
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanupTestDirs(projectDir)
  })

  describe('captureBaseMetrics() via initialize()', () => {
    it('should log triggering capture when base metrics file does not exist', async () => {
      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false, // Enable CLI capture
      })

      await service.initialize()

      // The capture is triggered asynchronously
      expect(logger.wasLogged('Triggering async CLI capture for base metrics')).toBe(true)
    })

    it('should skip capture when skipCliCapture is true', async () => {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: true, // Skip CLI capture
      })

      await service.initialize()

      // Should not have called CLI or logged triggering
      expect(mockedSpawnClaudeCli).not.toHaveBeenCalled()
      expect(logger.wasLogged('Triggering async CLI capture for base metrics')).toBe(false)
    })

    it('should skip capture when recent error exists', async () => {
      // Write defaults with recent error (capturedAt > 0 indicates file was previously written)
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const metricsWithError = {
        ...DEFAULT_BASE_METRICS,
        capturedAt: Date.now() - 60000, // Written 1 minute ago
        lastErrorAt: Date.now() - 1000, // 1 second ago (within retry interval)
        lastErrorMessage: 'Previous capture failed',
      }
      await fs.writeFile(
        path.join(stateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify(metricsWithError)
      )

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()

      // Should not have called CLI
      expect(mockedSpawnClaudeCli).not.toHaveBeenCalled()
      expect(logger.wasLogged('Skipping capture - recent error, will retry later')).toBe(true)
    })

    it('should log retry intent when defaults file has old error', async () => {
      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })

      // Write defaults with old error (> 1 hour ago, capturedAt > 0 indicates file was previously written)
      const stateDir = path.join(userConfigDir, 'state')
      await fs.mkdir(stateDir, { recursive: true })
      const metricsWithOldError = {
        ...DEFAULT_BASE_METRICS,
        capturedAt: Date.now() - 3 * 60 * 60 * 1000, // Written 3 hours ago
        lastErrorAt: Date.now() - 2 * 60 * 60 * 1000, // Error 2 hours ago (past retry interval)
        lastErrorMessage: 'Old capture failed',
      }
      await fs.writeFile(
        path.join(stateDir, 'baseline-user-context-token-metrics.json'),
        JSON.stringify(metricsWithOldError)
      )

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()

      // Should have logged intent to retry
      expect(logger.wasLogged('Base metrics file exists but contains defaults, will retry capture')).toBe(true)
      expect(logger.wasLogged('Triggering async CLI capture for base metrics')).toBe(true)
    })

    it('should not trigger capture when real metrics already exist', async () => {
      // Write real metrics (not defaults)
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

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()

      // Should not trigger capture since real metrics exist
      expect(mockedSpawnClaudeCli).not.toHaveBeenCalled()
      expect(logger.wasLogged('Base token metrics already captured')).toBe(true)
    })
  })

  // Integration tests that exercise the full stdout capture flow
  describe('captureBaseMetrics() stdout capture', () => {
    /** Create a service with CLI capture enabled and poll until async capture settles. */
    async function initializeWithCapture(): Promise<ContextMetricsService> {
      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })
      await service.initialize()
      // Poll for capture completion instead of fixed sleep
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        const hasResult =
          logger.wasLogged('Base metrics captured successfully') ||
          logger.wasLoggedAtLevel('CLI stdout was empty \u2014 /context produced no output', 'warn') ||
          logger.wasLoggedAtLevel('CLI stdout does not appear to be /context output', 'warn') ||
          logger.wasLoggedAtLevel('Failed to parse /context table from CLI stdout', 'warn') ||
          logger.wasLoggedAtLevel('CLI capture failed', 'warn')
        if (hasResult) break
        await new Promise((r) => setTimeout(r, 25))
      }
      return service
    }

    it('should capture metrics from CLI stdout with visual format', async () => {
      const contextStdout = ` Context Usage
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   claude-opus-4-6 · 63k/200k tokens (32%)

  System prompt: 3.6k tokens (1.8%)
  System tools: 18.9k tokens (9.5%)
  MCP tools: 1.1k tokens (0.5%)
  Custom agents: 319 tokens (0.2%)
  Memory files: 5.5k tokens (2.8%)
  Skills: 2k tokens (1.0%)
  Messages: 32.2k tokens (16.1%)
  Free space: 103k (51.7%)
  Autocompact buffer: 33k tokens (16.5%)`

      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: contextStdout,
        stderr: '',
      })

      const service = await initializeWithCapture()

      expect(logger.wasLogged('Base metrics captured successfully')).toBe(true)

      const metrics = await service.readBaseMetrics()
      expect(metrics.capturedFrom).toBe('context_command')
      expect(metrics.systemPromptTokens).toBe(3600)
      expect(metrics.systemToolsTokens).toBe(18900)
      expect(metrics.autocompactBufferTokens).toBe(33000)
    })

    it('should capture metrics from CLI stdout with ANSI escape codes', async () => {
      const ansiStdout = `\x1b[1mContext Usage\x1b[22m
\x1b[38;2;102;102;102mclaude-opus-4-6 · 25k/200k tokens (13%)\x1b[39m
\x1b[38;2;153;153;153m⛁\x1b[39m System prompt: \x1b[38;2;102;102;102m3.2k tokens (1.6%)\x1b[39m
\x1b[38;2;102;102;102m⛁\x1b[39m System tools: \x1b[38;2;102;102;102m17.9k tokens (9.0%)\x1b[39m
\x1b[38;2;102;102;102m⛝\x1b[39m Autocompact buffer: \x1b[38;2;102;102;102m45.0k tokens (22.5%)\x1b[39m`

      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: ansiStdout,
        stderr: '',
      })

      const service = await initializeWithCapture()

      expect(logger.wasLogged('Base metrics captured successfully')).toBe(true)

      const metrics = await service.readBaseMetrics()
      expect(metrics.capturedFrom).toBe('context_command')
      expect(metrics.systemPromptTokens).toBe(3200)
      expect(metrics.systemToolsTokens).toBe(17900)
      expect(metrics.autocompactBufferTokens).toBe(45000)
    })

    it('should record error when stdout is empty', async () => {
      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })

      await initializeWithCapture()

      expect(logger.wasLoggedAtLevel('CLI stdout was empty \u2014 /context produced no output', 'warn')).toBe(true)
    })

    it('should record error when stdout is not /context output', async () => {
      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: 'Some random CLI output that is not /context',
        stderr: '',
      })

      await initializeWithCapture()

      expect(logger.wasLoggedAtLevel('CLI stdout does not appear to be /context output', 'warn')).toBe(true)
    })

    it('should record error when stdout has context markers but unparseable table', async () => {
      const badStdout = `Context Usage
System prompt: not-a-number tokens
System tools: also-not-a-number tokens`

      mockedSpawnClaudeCli.mockResolvedValue({
        exitCode: 0,
        stdout: badStdout,
        stderr: '',
      })

      await initializeWithCapture()

      const hasError =
        logger.wasLoggedAtLevel('CLI stdout does not appear to be /context output', 'warn') ||
        logger.wasLoggedAtLevel('Failed to parse /context table from CLI stdout', 'warn')
      expect(hasError).toBe(true)
    })

    it('should handle CLI spawn error', async () => {
      mockedSpawnClaudeCli.mockRejectedValue(new Error('CLI spawn failed'))

      await initializeWithCapture()

      expect(logger.wasLoggedAtLevel('CLI capture failed', 'warn')).toBe(true)
    })
  })
})
