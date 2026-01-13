/**
 * Tests for BenchmarkRunner
 * Validates behavioral parity with Track 1: scripts/benchmark/run-benchmark.sh
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BenchmarkRunner } from '../../../src/benchmark/core/BenchmarkRunner.js'
import { MockLLMProvider } from '../../__mocks__/LLMProvider.js'
import type { ModelSpec } from '../../../src/benchmark/core/BenchmarkTypes.js'
import type { LLMProvider } from '../../../src/lib/providers/LLMProvider.js'

// Test fixtures directory
const TEST_ROOT = join(process.cwd(), 'test-fixtures', 'benchmark-runner')
const TEST_DATA_ROOT = join(TEST_ROOT, 'test-data')

// Sample prompt template
const PROMPT_TEMPLATE = 'Analyze this transcript:\n\n{TRANSCRIPT}'

// Sample model specs
const SAMPLE_MODELS: ModelSpec[] = [
  {
    provider: 'mock',
    model: 'fast-model',
    inputPrice: 0.02,
    outputPrice: 0.07,
    tags: ['cheap', 'fast'],
  },
  {
    provider: 'mock',
    model: 'expensive-model',
    inputPrice: 3.0,
    outputPrice: 15.0,
    tags: ['expensive'],
  },
  {
    provider: 'mock',
    model: 'default-model',
    inputPrice: 0.1,
    outputPrice: 0.5,
    tags: ['default'],
  },
]

// Sample model output
const SAMPLE_OUTPUT = {
  task_ids: 'TASK-001',
  initial_goal: 'Implement feature',
  current_objective: 'Write tests',
  clarity_score: 8,
  confidence: 0.85,
  high_clarity_snarky_comment: 'Crystal clear!',
  low_clarity_snarky_comment: null,
  significant_change: true,
}

/**
 * Setup test data directory with minimal fixtures
 */
async function setupTestData(): Promise<void> {
  // Create directory structure
  await mkdir(join(TEST_DATA_ROOT, 'transcripts'), { recursive: true })
  await mkdir(join(TEST_DATA_ROOT, 'references', 'v1.0_2025-01-01_000000'), { recursive: true })
  await mkdir(join(TEST_DATA_ROOT, 'results'), { recursive: true })

  // Create minimal golden-set.json
  const goldenSet = {
    version: '1.0',
    description: 'Test golden set',
    golden_ids: ['test-001', 'test-002', 'test-003'],
  }
  await writeFile(
    join(TEST_DATA_ROOT, 'transcripts', 'golden-set.json'),
    JSON.stringify(goldenSet, null, 2)
  )

  // Create sample transcripts
  for (const id of goldenSet.golden_ids) {
    const transcript = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
    ]
    await writeFile(
      join(TEST_DATA_ROOT, 'transcripts', `${id}.jsonl`),
      transcript.map((msg) => JSON.stringify(msg)).join('\n')
    )
  }

  // Create sample reference outputs
  for (const id of goldenSet.golden_ids) {
    const refDir = join(TEST_DATA_ROOT, 'references', 'v1.0_2025-01-01_000000', id)
    await mkdir(refDir, { recursive: true })

    const consensus = {
      task_ids: 'TASK-001',
      initial_goal: 'Implement feature',
      current_objective: 'Write tests',
      clarity_score: 8,
      confidence: 0.85,
      significant_change: true,
      generated_at: '2025-01-01T00:00:00Z',
      consensus_method: 'semantic_centrality',
    }

    await writeFile(join(refDir, 'consensus.json'), JSON.stringify(consensus, null, 2))
  }
}

/**
 * Cleanup test data directory
 */
async function cleanupTestData(): Promise<void> {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true })
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe('BenchmarkRunner', () => {
  let providers: Map<string, LLMProvider>
  let judgeProvider: LLMProvider

  beforeEach(async () => {
    // Setup test data
    await setupTestData()

    // Create mock providers
    const mockProvider = new MockLLMProvider('mock', 'test-model')
    mockProvider.setDefaultResponse({
      content: JSON.stringify(SAMPLE_OUTPUT),
      latency: 100,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    providers = new Map<string, any>([['mock', mockProvider]])

    const judgeProviderImpl = new MockLLMProvider('judge', 'judge-model')

    // Mock judge responses for semantic similarity
    judgeProviderImpl.setDefaultResponse({
      content: JSON.stringify({ similarity_score: 0.95 }),
      latency: 50,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    judgeProvider = judgeProviderImpl as any
  })

  afterEach(async () => {
    await cleanupTestData()
  })

  describe('Model Filtering', () => {
    it('should filter models by "all" tag', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'all',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models).toHaveLength(3)
      const models = result.models.map((m) => m.model).sort()
      expect(models).toEqual(['default-model', 'expensive-model', 'fast-model'])
    })

    it('should filter models by "cheap" tag', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'cheap',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models).toHaveLength(1)
      expect(result.models[0]?.model).toBe('fast-model')
    })

    it('should filter models by "expensive" tag', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'expensive',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models).toHaveLength(1)
      expect(result.models[0]?.model).toBe('expensive-model')
    })

    it('should filter models by explicit model name', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models).toHaveLength(1)
      expect(result.models[0]?.model).toBe('fast-model')
    })

    it('should filter models by comma-separated list', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model,expensive-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models).toHaveLength(2)
      expect(result.models.map((m) => m.model).sort()).toEqual(['expensive-model', 'fast-model'])
    })

    it('should throw error if no models match filter', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      await expect(
        runner.run({
          mode: 'smoke',
          modelsFilter: 'nonexistent-model',
          availableModels: SAMPLE_MODELS,
          referenceVersion: 'v1.0',
        })
      ).rejects.toThrow('No models matched filter: nonexistent-model')
    })
  })

  describe('Mode Configuration', () => {
    it('should run smoke mode (3 samples, 1 run)', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.metadata.mode).toBe('smoke')
      expect(result.metadata.transcriptCount).toBe(3)
      expect(result.metadata.runCount).toBe(1)
      expect(result.models.length).toBeGreaterThan(0)
      const model1 = result.models[0]
      expect(model1).toBeDefined()
      if (!model1) return
      expect(model1.scores.totalRuns).toBe(3) // 3 transcripts × 1 run
    })

    it('should run quick mode (10 samples, 3 runs) - limited by available transcripts', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'quick',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.metadata.mode).toBe('quick')
      expect(result.metadata.transcriptCount).toBe(3) // Limited by available test data
      expect(result.metadata.runCount).toBe(3)
      expect(result.models.length).toBeGreaterThan(0)
      const model2 = result.models[0]
      expect(model2).toBeDefined()
      if (!model2) return
      expect(model2.scores.totalRuns).toBe(9) // 3 transcripts × 3 runs
    })

    it('should run full mode (all samples, 5 runs)', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'full',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.metadata.mode).toBe('full')
      expect(result.metadata.transcriptCount).toBe(3)
      expect(result.metadata.runCount).toBe(5)
      expect(result.models.length).toBeGreaterThan(0)
      const model3 = result.models[0]
      expect(model3).toBeDefined()
      if (!model3) return
      expect(model3.scores.totalRuns).toBe(15) // 3 transcripts × 5 runs
    })
  })

  describe('Latency Measurement', () => {
    it('should measure latency in milliseconds', async () => {
      const mockProvider = new MockLLMProvider('mock', 'test-model')

      // Mock a response with artificial delay
      mockProvider.setDefaultResponse({
        content: JSON.stringify(SAMPLE_OUTPUT),
        latency: 100,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', mockProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      // Latency should be measured in milliseconds
      expect(result.models.length).toBeGreaterThan(0)
      const model4 = result.models[0]
      expect(model4).toBeDefined()
      if (!model4) return
      expect(model4.latency.min).toBeGreaterThan(0)
      expect(model4.latency.max).toBeGreaterThan(0)
      expect(model4.latency.avg).toBeGreaterThan(0)
    })

    it('should calculate correct latency statistics', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const latency = result.models[0]?.latency
      expect(latency).toBeDefined()

      if (!latency) return

      expect(latency.count).toBe(3) // 3 runs
      expect(latency.min).toBeLessThanOrEqual(latency.avg)
      expect(latency.max).toBeGreaterThanOrEqual(latency.avg)
      expect(latency.avg).toBeGreaterThan(0)
    })
  })

  describe('Output Organization', () => {
    it('should create output directory structure', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const { readdir, access } = await import('node:fs/promises')

      // Verify output directory exists
      await expect(access(result.metadata.outputDir)).resolves.not.toThrow()

      // Verify summary.json exists
      await expect(access(join(result.metadata.outputDir, 'summary.json'))).resolves.not.toThrow()

      // Verify raw output directory exists
      const rawDir = join(result.metadata.outputDir, 'raw')
      await expect(access(rawDir)).resolves.not.toThrow()

      // Verify model directory exists
      const modelDir = join(rawDir, 'mock_fast-model')
      await expect(access(modelDir)).resolves.not.toThrow()

      // Verify test directories exist
      const testDirs = await readdir(modelDir)
      expect(testDirs).toContain('test-001')
      expect(testDirs).toContain('test-002')
      expect(testDirs).toContain('test-003')
    })

    it('should save all output files for each run', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const { access } = await import('node:fs/promises')

      const modelDir = join(result.metadata.outputDir, 'raw', 'mock_fast-model', 'test-001')

      // Verify all output files exist
      await expect(access(join(modelDir, 'run_1_raw.txt'))).resolves.not.toThrow()
      await expect(access(join(modelDir, 'run_1.json'))).resolves.not.toThrow()
      await expect(access(join(modelDir, 'run_1_timing.txt'))).resolves.not.toThrow()
      await expect(access(join(modelDir, 'run_1_scores.json'))).resolves.not.toThrow()
    })
  })

  describe('Failure Handling', () => {
    it('should handle API failures and track error rates', async () => {
      const failingProvider = new MockLLMProvider('mock', 'test-model')
      failingProvider.setDefaultResponse({
        content: 'Error',
        shouldFail: true,
        error: new Error('API error'),
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', failingProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models.length).toBeGreaterThan(0)
      const model5 = result.models[0]
      expect(model5).toBeDefined()
      if (!model5) return
      expect(model5.scores.apiFailures).toBe(3)
      expect(model5.scores.successfulRuns).toBe(0)
      expect(model5.scores.errorRate).toBe(1.0)
    })

    it('should handle timeout failures', async () => {
      const timeoutProvider = new MockLLMProvider('mock', 'test-model')
      timeoutProvider.setDefaultResponse({
        content: 'Error',
        shouldFail: true,
        error: new Error('timeout'),
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', timeoutProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models.length).toBeGreaterThan(0)
      const model6 = result.models[0]
      expect(model6).toBeDefined()
      if (!model6) return
      expect(model6.scores.timeouts).toBe(3)
      expect(model6.scores.timeoutRate).toBe(1.0)
    })

    it('should handle JSON parse failures', async () => {
      const invalidProvider = new MockLLMProvider('mock', 'test-model')
      invalidProvider.setDefaultResponse({
        content: 'This is not valid JSON',
        latency: 100,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', invalidProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      // All runs should fail with JSON parse error
      expect(result.models.length).toBeGreaterThan(0)
      const model7 = result.models[0]
      expect(model7).toBeDefined()
      if (!model7) return
      expect(model7.scores.apiFailures).toBe(3)
      expect(model7.scores.otherApiErrors).toBe(3)
    })
  })

  describe('Early Termination', () => {
    it('should terminate after 3 consecutive JSON failures', async () => {
      const invalidProvider = new MockLLMProvider('mock', 'test-model')
      invalidProvider.setDefaultResponse({
        content: 'Invalid JSON',
        latency: 100,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', invalidProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'full', // Would normally run 5 runs per transcript
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      // Should terminate early after first transcript (3 consecutive failures)
      expect(result.models.length).toBeGreaterThan(0)
      const model8 = result.models[0]
      expect(model8).toBeDefined()
      if (!model8) return
      expect(model8.terminated).toBe(true)
      expect(model8.terminationReason).toContain('consecutive JSON failures')
      expect(model8.scores.totalRuns).toBeLessThan(15) // Less than 3 transcripts × 5 runs
    })

    it('should terminate after 3 consecutive timeouts', async () => {
      const timeoutProvider = new MockLLMProvider('mock', 'test-model')
      timeoutProvider.setDefaultResponse({
        content: 'Error',
        shouldFail: true,
        error: new Error('timeout'),
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', timeoutProvider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'full',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.models.length).toBeGreaterThan(0)
      const model9 = result.models[0]
      expect(model9).toBeDefined()
      if (!model9) return
      expect(model9.terminated).toBe(true)
      expect(model9.terminationReason).toContain('consecutive timeouts')
    })

    it('should reset failure counter on successful run', async () => {
      const provider = new MockLLMProvider('mock', 'test-model')

      // Alternate between failures and successes
      let callCount = 0
      // eslint-disable-next-line @typescript-eslint/require-await
      vi.spyOn(provider, 'invoke').mockImplementation(async (_prompt, _options) => {
        callCount++
        if (callCount % 3 === 0) {
          // Every 3rd call succeeds
          return {
            content: JSON.stringify(SAMPLE_OUTPUT),
            metadata: {
              provider: 'mock',
              model: 'test-model',
              tokens: {
                prompt: 100,
                completion: 50,
                total: 150,
              },
              latency_ms: 100,
            },
          }
        } else {
          throw new Error('API error')
        }
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', provider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'full',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      // Should not terminate because failures are not consecutive
      expect(result.models.length).toBeGreaterThan(0)
      const model10 = result.models[0]
      expect(model10).toBeDefined()
      if (!model10) return
      expect(model10.terminated).toBe(false)
    })
  })

  describe('Statistics Aggregation', () => {
    it('should calculate correct score averages', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const scores = result.models[0]?.scores
      expect(scores).toBeDefined()

      if (!scores) return

      // All runs should succeed
      expect(scores.successfulRuns).toBe(scores.totalRuns)
      expect(scores.errorRate).toBe(0)

      // Scores should be within valid range
      expect(scores.schemaAvg).toBeGreaterThanOrEqual(0)
      expect(scores.schemaAvg).toBeLessThanOrEqual(100)
      expect(scores.technicalAvg).toBeGreaterThanOrEqual(0)
      expect(scores.technicalAvg).toBeLessThanOrEqual(100)
      expect(scores.contentAvg).toBeGreaterThanOrEqual(0)
      expect(scores.contentAvg).toBeLessThanOrEqual(100)
      expect(scores.overallAvg).toBeGreaterThanOrEqual(0)
      expect(scores.overallAvg).toBeLessThanOrEqual(100)
    })

    it('should exclude failed runs from score averages', async () => {
      const provider = new MockLLMProvider('mock', 'test-model')

      // First 2 calls succeed, last call fails
      let callCount = 0
      // eslint-disable-next-line @typescript-eslint/require-await
      vi.spyOn(provider, 'invoke').mockImplementation(async (_prompt, _options) => {
        callCount++
        if (callCount <= 2) {
          return {
            content: JSON.stringify(SAMPLE_OUTPUT),
            metadata: {
              provider: 'mock',
              model: 'test-model',
              tokens: {
                prompt: 100,
                completion: 50,
                total: 150,
              },
              latency_ms: 100,
            },
          }
        } else {
          throw new Error('API error')
        }
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const testProviders = new Map<string, any>([['mock', provider]])

      const runner = new BenchmarkRunner({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        providers: testProviders,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const scores = result.models[0]?.scores
      expect(scores).toBeDefined()

      if (!scores) return

      expect(scores.successfulRuns).toBe(2)
      expect(scores.apiFailures).toBe(1)
      expect(scores.errorRate).toBeCloseTo(1 / 3)

      // Score averages should be calculated from successful runs only
      expect(scores.overallAvg).toBeGreaterThan(0)
    })
  })

  describe('Reference Version Handling', () => {
    it('should use latest reference version by default', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'latest',
      })

      expect(result.metadata.referenceVersion).toMatch(/^v1\.0_/)
    })

    it('should use specified reference version', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.metadata.referenceVersion).toMatch(/^v1\.0_/)
    })

    it('should throw error if reference version not found', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      await expect(
        runner.run({
          mode: 'smoke',
          modelsFilter: 'fast-model',
          availableModels: SAMPLE_MODELS,
          referenceVersion: 'v99.0',
        })
      ).rejects.toThrow('No reference directory found for version: v99.0')
    })
  })

  describe('Metadata Generation', () => {
    it('should generate correct benchmark metadata', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'quick',
        modelsFilter: 'cheap',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      expect(result.metadata.mode).toBe('quick')
      expect(result.metadata.modelsFilter).toBe('cheap')
      expect(result.metadata.transcriptCount).toBe(3)
      expect(result.metadata.runCount).toBe(3)
      expect(result.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(result.metadata.outputDir).toContain('results')
    })

    it('should include model pricing information', async () => {
      const runner = new BenchmarkRunner({
        providers,
        judgeProvider,
        promptTemplate: PROMPT_TEMPLATE,
        testDataRoot: TEST_DATA_ROOT,
      })

      const result = await runner.run({
        mode: 'smoke',
        modelsFilter: 'fast-model',
        availableModels: SAMPLE_MODELS,
        referenceVersion: 'v1.0',
      })

      const model = result.models[0]
      expect(model?.pricing.inputPerMillion).toBe(0.02)
      expect(model?.pricing.outputPerMillion).toBe(0.07)
      expect(model?.tags).toBe('cheap,fast')
    })
  })
})
