/**
 * Tests for configuration cascade system
 *
 * Tests the 4-level configuration cascade:
 * 1. Defaults (hardcoded)
 * 2. User global config (~/.claude/benchmark-next.conf)
 * 3. Project config (.benchmark-next/config.json)
 * 4. Project local config (.benchmark-next/config.local.json) - highest priority
 *
 * Also tests environment variable overrides and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Config } from '../../../src/lib/config/Config'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

describe.sequential('Config', () => {
  let tempDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'))

    // Save original environment
    originalEnv = { ...process.env }

    // Set HOME to temp directory for user config tests
    process.env['HOME'] = tempDir
  })

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv

    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (err) {
      // Ignore cleanup errors
    }
  })

  describe('Defaults', () => {
    it('should load default configuration with no config files', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.logLevel).toBe('info')
      expect(config.features.topicExtraction).toBe(true)
      expect(config.features.tracking).toBe(true)
      expect(config.llm.provider).toBe('openrouter')
      expect(config.llm.timeoutSeconds).toBe(10)
      expect(config.llm.benchmarkTimeoutSeconds).toBe(15)
      expect(config.topic.cadenceHigh).toBe(10)
      expect(config.topic.cadenceLow).toBe(1)
      expect(config.topic.clarityThreshold).toBe(7)
      expect(config.cleanup.minCount).toBe(5)
      expect(config.cleanup.ageDays).toBe(2)
    })

    it('should provide correct default LLM provider configs', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.llm.claude.model).toBe('haiku')
      expect(config.llm.openai.model).toBe('gpt-5-nano')
      expect(config.llm.openai.endpoint).toBe('https://api.openai.com/v1/chat/completions')
      expect(config.llm.openrouter.model).toBe('google/gemma-3-12b-it')
      expect(config.llm.openrouter.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions')
    })

    it('should provide correct default circuit breaker config', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.llm.circuitBreaker.enabled).toBe(true)
      expect(config.llm.circuitBreaker.failureThreshold).toBe(3)
      expect(config.llm.circuitBreaker.backoffInitial).toBe(60)
      expect(config.llm.circuitBreaker.backoffMax).toBe(3600)
      expect(config.llm.circuitBreaker.backoffMultiplier).toBe(2)
    })

    it('should provide correct default benchmark config', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.benchmark.referenceVersion).toBe('v1.0')
      expect(config.benchmark.scoreWeightSchema).toBe(0.3)
      expect(config.benchmark.scoreWeightAccuracy).toBe(0.5)
      expect(config.benchmark.scoreWeightContent).toBe(0.2)
      expect(config.benchmark.earlyTermJsonFailures).toBe(3)
      expect(config.benchmark.earlyTermTimeoutCount).toBe(3)
    })
  })

  describe('User Global Config', () => {
    it('should load user global config and override defaults', async () => {
      // Create user config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      const configPath = path.join(userConfigDir, 'benchmark-next.conf')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          logLevel: 'debug',
          llm: {
            timeoutSeconds: 20,
          },
          topic: {
            cadenceHigh: 15,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // User overrides should apply
      expect(config.logLevel).toBe('debug')
      expect(config.llm.timeoutSeconds).toBe(20)
      expect(config.topic.cadenceHigh).toBe(15)

      // Non-overridden values should be defaults
      expect(config.features.tracking).toBe(true)
      expect(config.topic.cadenceLow).toBe(1)
    })
  })

  describe('Project Config', () => {
    it('should load project config and override user and defaults', async () => {
      // Create user config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          logLevel: 'debug',
          llm: {
            timeoutSeconds: 20,
          },
        })
      )

      // Create project config
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'warn',
          llm: {
            timeoutSeconds: 30,
          },
          cleanup: {
            minCount: 10,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Project overrides should win
      expect(config.logLevel).toBe('warn')
      expect(config.llm.timeoutSeconds).toBe(30)
      expect(config.cleanup.minCount).toBe(10)

      // Non-overridden values should be defaults
      expect(config.features.tracking).toBe(true)
    })
  })

  describe('Project Local Config (Highest Priority)', () => {
    it('should load project local config and override all others', async () => {
      // Create user config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          logLevel: 'debug',
          llm: {
            timeoutSeconds: 20,
          },
        })
      )

      // Create project config
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'warn',
          llm: {
            timeoutSeconds: 30,
          },
        })
      )

      // Create project local config (highest priority)
      await fs.writeFile(
        path.join(projectConfigDir, 'config.local.json'),
        JSON.stringify({
          logLevel: 'error',
          cleanup: {
            minCount: 20,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Project local should win for logLevel
      expect(config.logLevel).toBe('error')
      expect(config.cleanup.minCount).toBe(20)

      // Non-overridden value should come from project config
      expect(config.llm.timeoutSeconds).toBe(30)
    })
  })

  describe('Full 4-Level Cascade', () => {
    it('should correctly apply full cascade (defaults → user → project → local)', async () => {
      // Create all four levels with different values

      // 1. User config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          logLevel: 'debug',
          topic: {
            cadenceHigh: 20,
          },
          cleanup: {
            minCount: 10,
          },
        })
      )

      // 2. Project config
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'warn',
          topic: {
            cadenceHigh: 30,
          },
        })
      )

      // 3. Project local config (highest priority)
      await fs.writeFile(
        path.join(projectConfigDir, 'config.local.json'),
        JSON.stringify({
          logLevel: 'error',
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Verify cascade precedence:
      // logLevel: error (local wins over project, user, defaults)
      expect(config.logLevel).toBe('error')

      // cadenceHigh: 30 (project wins over user, defaults)
      expect(config.topic.cadenceHigh).toBe(30)

      // cleanup.minCount: 10 (user wins over defaults)
      expect(config.cleanup.minCount).toBe(10)

      // features.tracking: true (default, not overridden)
      expect(config.features.tracking).toBe(true)
    })
  })

  describe('Environment Variable Overrides', () => {
    it('should override config with environment variables', async () => {
      // Set environment variables
      process.env['BENCHMARK_LOG_LEVEL'] = 'error'
      process.env['BENCHMARK_LLM_TIMEOUT_SECONDS'] = '25'
      process.env['BENCHMARK_TOPIC_CADENCE_HIGH'] = '50'

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.logLevel).toBe('error')
      expect(config.llm.timeoutSeconds).toBe(25)
      expect(config.topic.cadenceHigh).toBe(50)
    })

    it('should allow env vars to override config files', async () => {
      // Create project config
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'warn',
          llm: {
            timeoutSeconds: 30,
          },
        })
      )

      // Set environment variables (should win)
      process.env['BENCHMARK_LOG_LEVEL'] = 'error'
      process.env['BENCHMARK_LLM_TIMEOUT_SECONDS'] = '40'

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.logLevel).toBe('error')
      expect(config.llm.timeoutSeconds).toBe(40)
    })

    it('should support LLM provider API keys from environment', async () => {
      process.env['OPENAI_API_KEY'] = 'test-openai-key'
      process.env['OPENROUTER_API_KEY'] = 'test-openrouter-key'

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.llm.openai.apiKey).toBe('test-openai-key')
      expect(config.llm.openrouter.apiKey).toBe('test-openrouter-key')
    })
  })

  describe('Timeout Resolution Cascade', () => {
    it('should use benchmarkTimeoutSeconds if set', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })
      const timeout = config.resolveTimeout('benchmark')

      // Should use benchmark-specific timeout
      expect(timeout).toBe(15)
    })

    it('should fall back to timeoutSeconds if benchmarkTimeoutSeconds not set', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          llm: {
            timeoutSeconds: 25,
            // benchmarkTimeoutSeconds is intentionally not set, which means null in the config file
            // This will override the default value (15) from getDefaults() with null
            benchmarkTimeoutSeconds: null,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })
      const timeout = config.resolveTimeout('benchmark')

      expect(timeout).toBe(25)
    })

    it('should use timeoutSeconds for non-benchmark contexts', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })
      const timeout = config.resolveTimeout('default')

      expect(timeout).toBe(10)
    })
  })

  describe('Feature Toggle Checks', () => {
    it('should check if feature is enabled', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.isFeatureEnabled('topicExtraction')).toBe(true)
      expect(config.isFeatureEnabled('tracking')).toBe(true)
      expect(config.isFeatureEnabled('cleanup')).toBe(true)
    })

    it('should respect feature overrides in config files', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          features: {
            topicExtraction: false,
            cleanup: false,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.isFeatureEnabled('topicExtraction')).toBe(false)
      expect(config.isFeatureEnabled('cleanup')).toBe(false)
      expect(config.isFeatureEnabled('tracking')).toBe(true) // Still default
    })
  })

  describe('Validation', () => {
    it('should reject invalid log level', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'invalid',
        })
      )

      await expect(Config.load({ projectDir: tempDir, homeDir: tempDir })).rejects.toThrow()
    })

    it('should reject negative timeout values', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          llm: {
            timeoutSeconds: -10,
          },
        })
      )

      await expect(Config.load({ projectDir: tempDir, homeDir: tempDir })).rejects.toThrow()
    })

    it('should reject invalid clarity threshold (out of range)', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          topic: {
            clarityThreshold: 15, // Should be 1-10
          },
        })
      )

      await expect(Config.load({ projectDir: tempDir, homeDir: tempDir })).rejects.toThrow()
    })

    it('should accept valid configuration', async () => {
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          logLevel: 'debug',
          llm: {
            timeoutSeconds: 30,
          },
          topic: {
            clarityThreshold: 5,
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      expect(config.logLevel).toBe('debug')
      expect(config.llm.timeoutSeconds).toBe(30)
      expect(config.topic.clarityThreshold).toBe(5)
    })
  })

  describe('Config File Not Found', () => {
    it('should handle missing user config gracefully', async () => {
      // No user config file created
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Should use defaults
      expect(config.logLevel).toBe('info')
    })

    it('should handle missing project config gracefully', async () => {
      // Create user config but no project config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          logLevel: 'debug',
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Should use user config
      expect(config.logLevel).toBe('debug')
    })

    it('should handle all config files missing gracefully', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Should use defaults
      expect(config.logLevel).toBe('info')
      expect(config.features.tracking).toBe(true)
    })
  })

  describe('Deep Merge', () => {
    it('should deep merge nested config objects', async () => {
      // Create user config with partial LLM config
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          llm: {
            claude: {
              model: 'sonnet',
            },
          },
        })
      )

      // Create project config with different partial LLM config
      const projectConfigDir = path.join(tempDir, '.benchmark-next')
      await fs.mkdir(projectConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          llm: {
            openai: {
              model: 'gpt-5-mini',
            },
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Both should be merged, not replaced
      expect(config.llm.claude.model).toBe('sonnet') // From user config
      expect(config.llm.openai.model).toBe('gpt-5-mini') // From project config
      expect(config.llm.openrouter.model).toBe('google/gemma-3-12b-it') // From defaults
    })

    it('should allow deep override of nested values', async () => {
      const userConfigDir = path.join(tempDir, '.claude')
      await fs.mkdir(userConfigDir, { recursive: true })
      await fs.writeFile(
        path.join(userConfigDir, 'benchmark-next.conf'),
        JSON.stringify({
          llm: {
            circuitBreaker: {
              failureThreshold: 5,
              backoffInitial: 120,
            },
          },
        })
      )

      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })

      // Overridden values
      expect(config.llm.circuitBreaker.failureThreshold).toBe(5)
      expect(config.llm.circuitBreaker.backoffInitial).toBe(120)

      // Non-overridden values (should be defaults)
      expect(config.llm.circuitBreaker.backoffMax).toBe(3600)
      expect(config.llm.circuitBreaker.backoffMultiplier).toBe(2)
    })
  })

  describe('Config Export', () => {
    it('should export config as plain object', async () => {
      const config = await Config.load({ projectDir: tempDir, homeDir: tempDir })
      const exported = config.toObject()

      expect(exported.logLevel).toBe('info')
      expect(exported.features.tracking).toBe(true)
      expect(exported.llm.timeoutSeconds).toBe(10)
      expect(typeof exported).toBe('object')
    })
  })

  describe('Static Factory Methods', () => {
    it('should load from defaults only', () => {
      const config = Config.loadDefaults()

      expect(config.logLevel).toBe('info')
      expect(config.features.tracking).toBe(true)
    })

    it('should load with explicit options', async () => {
      const config = await Config.load({
        projectDir: tempDir,
        skipUserConfig: true,
      })

      expect(config).toBeDefined()
    })
  })
})
