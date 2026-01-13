/**
 * Tests for ReferenceGenerator
 * Validates reference generation orchestration, provenance tracking, and consensus
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import {
  ReferenceGenerator,
  type ReferenceGeneratorConfig,
} from '../../../src/benchmark/core/ReferenceGenerator'
import type { LLMProvider } from '../../../src/lib/providers/LLMProvider'
import { loadGoldenSet, loadMetadata } from '../../../src/benchmark/data/loaders'

// Mock file system
vi.mock('fs/promises')

// Mock loaders
vi.mock('../../../src/benchmark/data/loaders', () => ({
  loadGoldenSet: vi.fn(),
  loadMetadata: vi.fn(),
}))

// Mock transcript excerpt
vi.mock('../../../src/lib/transcript/excerpt', () => ({
  extractExcerptFromFile: vi
    .fn()
    .mockResolvedValue([{ role: 'user', content: [{ type: 'text', text: 'Test message' }] }]),
}))

// Mock consensus algorithms
vi.mock('../../../src/benchmark/consensus/StringConsensus')
vi.mock('../../../src/benchmark/consensus/NumericConsensus')
vi.mock('../../../src/benchmark/consensus/BooleanConsensus')
vi.mock('../../../src/benchmark/consensus/ArrayConsensus')

import { computeStringConsensus } from '../../../src/benchmark/consensus/StringConsensus'
import { computeNumericConsensus } from '../../../src/benchmark/consensus/NumericConsensus'
import { computeBooleanConsensus } from '../../../src/benchmark/consensus/BooleanConsensus'
import { computeArrayConsensus } from '../../../src/benchmark/consensus/ArrayConsensus'

describe('ReferenceGenerator', () => {
  let mockProvider1: LLMProvider
  let mockProvider2: LLMProvider
  let mockProvider3: LLMProvider
  let mockJudgeProvider: LLMProvider
  let config: ReferenceGeneratorConfig

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset consensus mocks
    vi.mocked(computeStringConsensus).mockResolvedValue({
      consensus: 'Consensus string',
    })
    vi.mocked(computeNumericConsensus).mockReturnValue(7)
    vi.mocked(computeBooleanConsensus).mockReturnValue(true)
    vi.mocked(computeArrayConsensus).mockReturnValue(['T123', 'T456'])

    // Mock loaders
    vi.mocked(loadGoldenSet).mockResolvedValue({
      description: 'Test golden set',
      selection_method: 'manual',
      selected_at: '2025-11-11',
      total_count: 3,
      distribution: { short: 1, medium: 1, long: 1 },
      golden_ids: ['short-001', 'short-002', 'short-003'],
      transcripts: [],
    })

    vi.mocked(loadMetadata).mockResolvedValue({
      dataset_version: '1.0',
      generated_at: '2025-11-11',
      test_count: 3,
      distribution: { short: 1, medium: 1, long: 1 },
      transcripts: [],
    })

    // Mock LLM providers
    const createMockProvider = (name: string): LLMProvider =>
      ({
        invoke: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            task_ids: 'T123',
            initial_goal: 'Test goal',
            current_objective: 'Test objective',
            clarity_score: 7,
            confidence: 0.8,
            high_clarity_snarky_comment: 'Snarky comment',
            low_clarity_snarky_comment: null,
            significant_change: true,
          }),
          usage: { input_tokens: 100, output_tokens: 50 },
          metadata: { model: name, latency: 1000 },
        }),
        extractJSON: vi.fn().mockReturnValue({
          task_ids: 'T123',
          initial_goal: 'Test goal',
          current_objective: 'Test objective',
          clarity_score: 7,
          confidence: 0.8,
          high_clarity_snarky_comment: 'Snarky comment',
          low_clarity_snarky_comment: null,
          significant_change: true,
        }),
        getProviderName: vi.fn().mockReturnValue('mock'),
        getModelName: vi.fn().mockReturnValue(name),
        getIdentifier: vi.fn().mockReturnValue(`mock:${name}`),
      }) as unknown as LLMProvider

    mockProvider1 = createMockProvider('model1')
    mockProvider2 = createMockProvider('model2')
    mockProvider3 = createMockProvider('model3')
    mockJudgeProvider = createMockProvider('judge')

    config = {
      referenceVersion: 'v1.0-test',
      description: 'Test reference generation',
      excerptLines: 80,
      filterToolMessages: true,
      timeoutSeconds: 30,
      projectRoot: '/test/project',
      testDataDir: '/test/project/test-data',
      sidekickSrcDir: '/test/project/src/sidekick',
    }

    // Mock fs.mkdir to succeed
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)

    // Mock fs.writeFile to succeed
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    // Mock fs.access - default to file existing (transcript), not existing for consensus
    vi.mocked(fs.access).mockImplementation((filePath) => {
      const pathStr = String(filePath)
      // Consensus files don't exist by default (will be created)
      if (pathStr.includes('consensus.json')) {
        return Promise.reject(new Error('ENOENT: no such file or directory'))
      }
      // All other files exist (transcripts, prompts, schemas)
      return Promise.resolve(undefined)
    })

    // Mock fs.readFile for prompt and schema files
    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      const pathStr = String(filePath)
      if (pathStr.includes('topic-only.txt')) {
        return Promise.resolve('TRANSCRIPT: {TRANSCRIPT}\nPREVIOUS: {PREVIOUS_TOPIC}')
      }
      if (pathStr.includes('topic-schema.json')) {
        return Promise.resolve(
          JSON.stringify({ name: 'topic_analysis', schema: { type: 'object' } })
        )
      }
      if (pathStr.includes('golden-set.json')) {
        return Promise.resolve(
          JSON.stringify({
            golden_ids: ['short-001', 'short-002', 'short-003'],
            total_count: 3,
          })
        )
      }
      return Promise.resolve('')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create ReferenceGenerator with valid configuration', () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      expect(generator).toBeDefined()
    })

    it('should throw error if not exactly 3 reference providers', () => {
      expect(() => {
        new ReferenceGenerator(
          [
            { spec: 'provider1:model1', provider: mockProvider1 },
            { spec: 'provider2:model2', provider: mockProvider2 },
          ],
          mockJudgeProvider,
          config
        )
      }).toThrow('Exactly 3 reference providers required')
    })

    it('should use default paths if not provided in config', () => {
      const minimalConfig: ReferenceGeneratorConfig = {
        referenceVersion: 'v1.0-test',
        excerptLines: 80,
        filterToolMessages: true,
        timeoutSeconds: 30,
        projectRoot: '/test/project',
      }

      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        minimalConfig
      )

      expect(generator).toBeDefined()
    })
  })

  describe('generateReferences', () => {
    it('should generate references for all golden set tests', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      const result = await generator.generateReferences()

      expect(result.totalCount).toBe(3)
      expect(result.successCount).toBe(3)
      expect(result.skipCount).toBe(0)
      expect(result.failCount).toBe(0)
      expect(result.versionedDir).toContain('v1.0-test_')
    })

    it('should generate reference for single test when testId provided', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      const result = await generator.generateReferences({ testId: 'short-001' })

      expect(result.totalCount).toBe(1)
      expect(result.successCount).toBe(1)
    })

    it('should skip generation in dry run mode', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      const result = await generator.generateReferences({ dryRun: true })

      expect(result.successCount).toBe(0)
      expect(result.duration).toBe(0)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke1 = mockProvider1.invoke as ReturnType<typeof vi.fn>
      expect(mockInvoke1).not.toHaveBeenCalled()
    })

    it('should handle partial failures gracefully', async () => {
      // Make one provider fail
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke = mockProvider2.invoke as ReturnType<typeof vi.fn>
      mockInvoke.mockRejectedValue(new Error('Provider 2 failed'))

      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Should still succeed with 2 outputs
      const result = await generator.generateReferences({ testId: 'short-001' })

      expect(result.successCount).toBe(1)
      expect(result.failCount).toBe(0)
    })

    it('should fail if less than 2 providers succeed', async () => {
      // Make two providers fail
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke2 = mockProvider2.invoke as ReturnType<typeof vi.fn>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke3 = mockProvider3.invoke as ReturnType<typeof vi.fn>
      mockInvoke2.mockRejectedValue(new Error('Provider 2 failed'))
      mockInvoke3.mockRejectedValue(new Error('Provider 3 failed'))

      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      const result = await generator.generateReferences({ testId: 'short-001' })

      expect(result.failCount).toBe(1)
      expect(result.successCount).toBe(0)
    })
  })

  describe('generateReferenceForTest', () => {
    it('should skip if reference already exists and force is false', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Mock fs.access to simulate existing consensus file (all files exist)
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const result = await generator.generateReferenceForTest('short-001', '/test/output', false)

      expect(result.consensus).toBeNull()
      expect(result.outputs).toHaveLength(0)
    })

    it('should regenerate if reference exists and force is true', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Mock access so consensus exists but force=true will regenerate
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const result = await generator.generateReferenceForTest('short-001', '/test/output', true)

      expect(result.consensus).toBeDefined()
      expect(result.outputs).toHaveLength(3)
    })

    it('should throw error if transcript file not found', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Mock fs.access to throw for transcript file
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'))

      await expect(
        generator.generateReferenceForTest('nonexistent', '/test/output', false)
      ).rejects.toThrow('Transcript not found')
    })

    it('should invoke all 3 reference models', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Use default mock behavior (consensus doesn't exist)

      await generator.generateReferenceForTest('short-001', '/test/output', false)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke1 = mockProvider1.invoke as ReturnType<typeof vi.fn>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke2 = mockProvider2.invoke as ReturnType<typeof vi.fn>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke3 = mockProvider3.invoke as ReturnType<typeof vi.fn>
      expect(mockInvoke1).toHaveBeenCalled()
      expect(mockInvoke2).toHaveBeenCalled()
      expect(mockInvoke3).toHaveBeenCalled()
    })

    it('should save individual model outputs', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Use default mock behavior (consensus doesn't exist)

      await generator.generateReferenceForTest('short-001', '/test/output', false)

      // Should write 3 model outputs + 1 consensus = 4 files
      const writeFileCalls = vi
        .mocked(fs.writeFile)
        .mock.calls.filter((call) => String(call[0]).includes('/test/output/short-001/'))

      expect(writeFileCalls.length).toBeGreaterThanOrEqual(4)
    })

    it('should compute and save consensus', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Use default mock behavior (consensus doesn't exist)

      const result = await generator.generateReferenceForTest('short-001', '/test/output', false)

      expect(result.consensus).toBeDefined()
      expect(result.consensus?.consensus_method).toBe('semantic_similarity_median_majority')

      // Check that consensus file was written
      const consensusWrites = vi
        .mocked(fs.writeFile)
        .mock.calls.filter((call) => String(call[0]).includes('consensus.json'))
      expect(consensusWrites).toHaveLength(1)
    })
  })

  describe('provenance tracking', () => {
    it('should create _prompt-snapshot directory', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      await generator.generateReferences({ dryRun: false, testId: 'short-001' })

      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls
      const snapshotDirCall = mkdirCalls.find((call) =>
        String(call[0]).includes('_prompt-snapshot')
      )

      expect(snapshotDirCall).toBeDefined()
    })

    it('should snapshot prompt and schema files', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      await generator.generateReferences({ dryRun: false, testId: 'short-001' })

      const writeFileCalls = vi.mocked(fs.writeFile).mock.calls
      const promptSnapshot = writeFileCalls.find((call) =>
        String(call[0]).includes('topic-only.txt')
      )
      const schemaSnapshot = writeFileCalls.find((call) =>
        String(call[0]).includes('topic-schema.json')
      )

      expect(promptSnapshot).toBeDefined()
      expect(schemaSnapshot).toBeDefined()
    })

    it('should create config snapshot in bash format', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      await generator.generateReferences({ dryRun: false, testId: 'short-001' })

      const writeFileCalls = vi.mocked(fs.writeFile).mock.calls
      const configSnapshot = writeFileCalls.find((call) =>
        String(call[0]).includes('config-snapshot.sh')
      )

      expect(configSnapshot).toBeDefined()

      const configContent = String(configSnapshot?.[1])
      expect(configContent).toContain('REFERENCE_VERSION="v1.0-test"')
      expect(configContent).toContain('LLM_TIMEOUT_SECONDS=30')
      expect(configContent).toContain('TOPIC_EXCERPT_LINES=80')
      expect(configContent).toContain('REFERENCE_MODELS=(')
      expect(configContent).toContain('JUDGE_MODEL="mock:judge"')
    })

    it('should create metadata with checksums', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      await generator.generateReferences({ dryRun: false, testId: 'short-001' })

      const writeFileCalls = vi.mocked(fs.writeFile).mock.calls
      const metadataWrite = writeFileCalls.find((call) =>
        String(call[0]).includes('_metadata.json')
      )

      expect(metadataWrite).toBeDefined()

      const metadataContent = JSON.parse(String(metadataWrite?.[1])) as {
        reference_version: string
        description: string
        dataset: unknown
        models: { references: unknown[] }
        prompts: { topic_template_sha256: string; schema_sha256: string }
      }
      expect(metadataContent.reference_version).toBe('v1.0-test')
      expect(metadataContent.description).toBe('Test reference generation')
      expect(metadataContent.dataset).toBeDefined()
      expect(metadataContent.models.references).toHaveLength(3)
      expect(metadataContent.prompts.topic_template_sha256).toBeDefined()
      expect(metadataContent.prompts.schema_sha256).toBeDefined()
    })
  })

  describe('versioned directory', () => {
    it('should create directory with version and timestamp', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      const result = await generator.generateReferences({ testId: 'short-001' })

      expect(result.versionedDir).toMatch(/v1\.0-test_\d{4}-\d{2}-\d{2}_\d{6}/)
    })
  })

  describe('prompt building', () => {
    it('should replace TRANSCRIPT placeholder', async () => {
      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Use default mock behavior (consensus doesn't exist)

      await generator.generateReferenceForTest('short-001', '/test/output', false)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockInvoke = mockProvider1.invoke as ReturnType<typeof vi.fn>
      const invokeCalls = mockInvoke.mock.calls
      expect(invokeCalls.length).toBeGreaterThan(0)
      const prompt = String(invokeCalls[0]?.[0])

      expect(prompt).toContain('TRANSCRIPT:')
      expect(prompt).not.toContain('{TRANSCRIPT}')
      expect(prompt).not.toContain('{PREVIOUS_TOPIC}')
    })
  })

  describe('error handling', () => {
    it('should handle missing prompt file gracefully', async () => {
      vi.mocked(fs.readFile).mockImplementation((filePath) => {
        const pathStr = String(filePath)
        if (pathStr.includes('topic-only.txt')) {
          return Promise.reject(new Error('File not found'))
        }
        if (pathStr.includes('topic-schema.json')) {
          return Promise.resolve(
            JSON.stringify({ name: 'topic_analysis', schema: { type: 'object' } })
          )
        }
        if (pathStr.includes('golden-set.json')) {
          return Promise.resolve(
            JSON.stringify({
              golden_ids: ['short-001'],
              total_count: 1,
            })
          )
        }
        return Promise.resolve('')
      })

      const generator = new ReferenceGenerator(
        [
          { spec: 'provider1:model1', provider: mockProvider1 },
          { spec: 'provider2:model2', provider: mockProvider2 },
          { spec: 'provider3:model3', provider: mockProvider3 },
        ],
        mockJudgeProvider,
        config
      )

      // Should handle the error gracefully by tracking it in failCount
      const result = await generator.generateReferences({ testId: 'short-001' })

      expect(result.failCount).toBe(1)
      expect(result.successCount).toBe(0)
    })
  })
})
