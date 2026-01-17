/**
 * Tests for ContextMetricsService CLI Capture Methods
 *
 * These tests cover the private captureBaseMetrics() and readContextOutputFromTranscript()
 * methods by mocking the external CLI dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { homedir } from 'node:os'
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

  // Integration tests that exercise the full capture flow
  // These require INTEGRATION_TESTS=1 and write to ~/.claude/projects/
  describe.skipIf(!process.env.INTEGRATION_TESTS)('captureBaseMetrics() integration', () => {
    const TEMP_CAPTURE_DIR = '/tmp/sidekick/context-capture'

    beforeEach(async () => {
      // Clean up temp capture dir
      try {
        await fs.rm(TEMP_CAPTURE_DIR, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    afterEach(async () => {
      // Clean up temp capture dir and transcript files
      try {
        await fs.rm(TEMP_CAPTURE_DIR, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('should handle CLI spawn and process transcript output', async () => {
      // Create the temp capture directory that captureBaseMetrics expects
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })
      const resolvedTempDir = await fs.realpath(TEMP_CAPTURE_DIR)
      const encodedPath = resolvedTempDir.replace(/\//g, '-').replace(/^-/, '-')
      const transcriptDir = path.join(homedir(), '.claude', 'projects', encodedPath)

      // Mock will create transcript file when called
      mockedSpawnClaudeCli.mockImplementation(async (opts) => {
        const args = opts.args ?? []
        const sessionIdIndex = args.indexOf('--session-id')
        if (sessionIdIndex !== -1) {
          const mockSessionId = args[sessionIdIndex + 1]
          await fs.mkdir(transcriptDir, { recursive: true })

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

          const transcriptEntry = JSON.stringify({
            message: { content: contextOutput },
          })
          await fs.writeFile(path.join(transcriptDir, `${mockSessionId}.jsonl`), transcriptEntry)
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()

      // Wait for async capture to complete
      await new Promise((r) => setTimeout(r, 1000))

      // Should have captured successfully
      expect(logger.wasLogged('Base metrics captured successfully')).toBe(true)

      // Verify metrics were written
      const metrics = await service.readBaseMetrics()
      expect(metrics.capturedFrom).toBe('context_command')
      expect(metrics.systemPromptTokens).toBe(2900)

      // Clean up transcript dir
      try {
        await fs.rm(transcriptDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('should handle missing transcript file', async () => {
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })

      // Mock returns success but doesn't create transcript file
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
        skipCliCapture: false,
      })

      await service.initialize()
      await new Promise((r) => setTimeout(r, 1000))

      // Should have logged error about missing transcript
      expect(
        logger.wasLoggedAtLevel('Transcript file not found', 'warn') ||
          logger.wasLoggedAtLevel('Failed to extract /context output from transcript', 'warn')
      ).toBe(true)
    })

    it('should handle transcript with no context output', async () => {
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })
      const resolvedTempDir = await fs.realpath(TEMP_CAPTURE_DIR)
      const encodedPath = resolvedTempDir.replace(/\//g, '-').replace(/^-/, '-')
      const transcriptDir = path.join(homedir(), '.claude', 'projects', encodedPath)

      mockedSpawnClaudeCli.mockImplementation(async (opts) => {
        const args = opts.args ?? []
        const sessionIdIndex = args.indexOf('--session-id')
        if (sessionIdIndex !== -1) {
          const mockSessionId = args[sessionIdIndex + 1]
          await fs.mkdir(transcriptDir, { recursive: true })
          // Write transcript without context output
          const transcriptEntry = JSON.stringify({
            message: { content: 'Just a regular message without context' },
          })
          await fs.writeFile(path.join(transcriptDir, `${mockSessionId}.jsonl`), transcriptEntry)
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()
      await new Promise((r) => setTimeout(r, 1000))

      expect(logger.wasLoggedAtLevel('No /context output found in transcript', 'warn')).toBe(true)

      try {
        await fs.rm(transcriptDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('should handle transcript with invalid context table', async () => {
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })
      const resolvedTempDir = await fs.realpath(TEMP_CAPTURE_DIR)
      const encodedPath = resolvedTempDir.replace(/\//g, '-').replace(/^-/, '-')
      const transcriptDir = path.join(homedir(), '.claude', 'projects', encodedPath)

      mockedSpawnClaudeCli.mockImplementation(async (opts) => {
        const args = opts.args ?? []
        const sessionIdIndex = args.indexOf('--session-id')
        if (sessionIdIndex !== -1) {
          const mockSessionId = args[sessionIdIndex + 1]
          await fs.mkdir(transcriptDir, { recursive: true })
          // Has local-command-stdout but invalid table
          const invalidContextOutput = `<local-command-stdout>## Context Usage
Not a valid table format - missing required rows
</local-command-stdout>`
          const transcriptEntry = JSON.stringify({
            message: { content: invalidContextOutput },
          })
          await fs.writeFile(path.join(transcriptDir, `${mockSessionId}.jsonl`), transcriptEntry)
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()
      await new Promise((r) => setTimeout(r, 1000))

      expect(
        logger.wasLoggedAtLevel('Transcript content does not appear to be /context output', 'warn') ||
          logger.wasLoggedAtLevel('Failed to parse /context table output', 'warn')
      ).toBe(true)

      try {
        await fs.rm(transcriptDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('should handle CLI spawn error', async () => {
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })

      mockedSpawnClaudeCli.mockRejectedValue(new Error('CLI spawn failed'))

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()
      await new Promise((r) => setTimeout(r, 500))

      expect(logger.wasLoggedAtLevel('CLI capture failed', 'warn')).toBe(true)
    })

    it('should handle unparseable JSON lines in transcript', async () => {
      await fs.mkdir(TEMP_CAPTURE_DIR, { recursive: true })
      const resolvedTempDir = await fs.realpath(TEMP_CAPTURE_DIR)
      const encodedPath = resolvedTempDir.replace(/\//g, '-').replace(/^-/, '-')
      const transcriptDir = path.join(homedir(), '.claude', 'projects', encodedPath)

      mockedSpawnClaudeCli.mockImplementation(async (opts) => {
        const args = opts.args ?? []
        const sessionIdIndex = args.indexOf('--session-id')
        if (sessionIdIndex !== -1) {
          const mockSessionId = args[sessionIdIndex + 1]
          await fs.mkdir(transcriptDir, { recursive: true })
          // Write invalid JSON
          await fs.writeFile(path.join(transcriptDir, `${mockSessionId}.jsonl`), 'not valid json\nalso invalid\n')
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const service = new ContextMetricsService({
        projectDir,
        logger,
        projectStateService,
        userStateService,
        skipCliCapture: false,
      })

      await service.initialize()
      await new Promise((r) => setTimeout(r, 1000))

      // Should gracefully handle and log no context found
      expect(logger.wasLoggedAtLevel('No /context output found in transcript', 'warn')).toBe(true)

      try {
        await fs.rm(transcriptDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })
  })
})
