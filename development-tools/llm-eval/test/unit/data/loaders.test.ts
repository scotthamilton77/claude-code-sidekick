/**
 * Tests for test data loaders
 *
 * Tests loading of golden set, metadata, transcripts, and reference outputs
 * from the canonical test-data/ directory
 */

import { describe, it, expect } from 'vitest'
import {
  loadGoldenSet,
  loadMetadata,
  loadTranscript,
  loadTranscriptMetadata,
  loadGoldenSetTranscripts,
  listReferenceVersions,
  loadReferenceOutput,
  loadConsensusOutput,
  loadAllReferenceOutputs,
} from '../../../src/benchmark/data/loaders.js'

describe('loadGoldenSet', () => {
  it('should load golden set metadata', async () => {
    const goldenSet = await loadGoldenSet()

    expect(goldenSet.total_count).toBe(15)
    expect(goldenSet.golden_ids).toHaveLength(15)
    expect(goldenSet.transcripts).toHaveLength(15)
    expect(goldenSet.distribution.short).toBe(5)
    expect(goldenSet.distribution.medium).toBe(5)
    expect(goldenSet.distribution.long).toBe(5)
  })

  it('should have proper structure for each transcript', async () => {
    const goldenSet = await loadGoldenSet()
    const firstTranscript = goldenSet.transcripts[0]!

    expect(firstTranscript).toHaveProperty('id')
    expect(firstTranscript).toHaveProperty('line_count')
    expect(firstTranscript).toHaveProperty('description')
    expect(typeof firstTranscript.id).toBe('string')
    expect(typeof firstTranscript.line_count).toBe('number')
    expect(typeof firstTranscript.description).toBe('string')
  })

  it('should have matching golden_ids and transcripts', async () => {
    const goldenSet = await loadGoldenSet()
    const transcriptIds = goldenSet.transcripts.map((t) => t.id)

    expect(new Set(transcriptIds)).toEqual(new Set(goldenSet.golden_ids))
  })
})

describe('loadMetadata', () => {
  it('should load metadata for all transcripts', async () => {
    const metadata = await loadMetadata()

    expect(metadata.test_count).toBe(497)
    expect(metadata.transcripts).toHaveLength(497)
    expect(metadata.distribution.short).toBe(179)
    expect(metadata.distribution.medium).toBe(110)
    expect(metadata.distribution.long).toBe(208)
  })

  it('should have proper structure for each transcript', async () => {
    const metadata = await loadMetadata()
    const firstTranscript = metadata.transcripts[0]!

    expect(firstTranscript).toBeDefined()
    expect(firstTranscript).toHaveProperty('id')
    expect(firstTranscript).toHaveProperty('file')
    expect(firstTranscript).toHaveProperty('source_session')
    expect(firstTranscript).toHaveProperty('length_category')
    expect(firstTranscript).toHaveProperty('line_count')
    expect(firstTranscript).toHaveProperty('description')
    expect(firstTranscript).toHaveProperty('collected_at')
  })

  it('should have valid length categories', async () => {
    const metadata = await loadMetadata()
    const categories = metadata.transcripts.map((t) => t.length_category)
    const uniqueCategories = new Set(categories)

    expect(uniqueCategories).toEqual(new Set(['short', 'medium', 'long']))
  })
})

describe('loadTranscript', () => {
  it('should load a transcript from JSONL file', async () => {
    const transcript = await loadTranscript('short-001')

    expect(Array.isArray(transcript)).toBe(true)
    expect(transcript.length).toBeGreaterThan(0)
  })

  it('should have proper message structure', async () => {
    const transcript = await loadTranscript('short-001')
    const firstMessage = transcript[0]

    expect(firstMessage).toHaveProperty('uuid')
    expect(firstMessage).toHaveProperty('timestamp')
    expect(firstMessage).toHaveProperty('type')
    expect(firstMessage).toHaveProperty('sessionId')
  })

  it('should parse JSONL correctly (one object per line)', async () => {
    const transcript = await loadTranscript('short-001')

    // Each message should be a valid object
    transcript.forEach((message) => {
      expect(typeof message).toBe('object')
      expect(message).not.toBeNull()
    })
  })

  it('should match line count from metadata', async () => {
    const metadata = await loadTranscriptMetadata('short-001')
    const transcript = await loadTranscript('short-001')

    expect(metadata).toBeDefined()
    expect(transcript).toHaveLength(metadata!.line_count)
  })
})

describe('loadTranscriptMetadata', () => {
  it('should load metadata for a specific transcript', async () => {
    const metadata = await loadTranscriptMetadata('short-001')

    expect(metadata).toBeDefined()
    expect(metadata!.id).toBe('short-001')
    expect(metadata!.length_category).toBe('short')
  })

  it('should return undefined for non-existent transcript', async () => {
    const metadata = await loadTranscriptMetadata('non-existent-999')

    expect(metadata).toBeUndefined()
  })
})

describe('loadGoldenSetTranscripts', () => {
  it('should load all golden set transcripts', async () => {
    const transcripts = await loadGoldenSetTranscripts()

    expect(transcripts.size).toBe(15)
  })

  it('should have transcripts for all golden IDs', async () => {
    const goldenSet = await loadGoldenSet()
    const transcripts = await loadGoldenSetTranscripts()

    goldenSet.golden_ids.forEach((id) => {
      expect(transcripts.has(id)).toBe(true)
      expect(transcripts.get(id)).toBeDefined()
    })
  })

  it('should have valid transcript data', async () => {
    const transcripts = await loadGoldenSetTranscripts()
    const firstTranscript = transcripts.get('short-001')

    expect(firstTranscript).toBeDefined()
    expect(Array.isArray(firstTranscript)).toBe(true)
    expect(firstTranscript!.length).toBeGreaterThan(0)
  })
})

describe('listReferenceVersions', () => {
  it('should list available reference versions', async () => {
    const versions = await listReferenceVersions()

    expect(versions.length).toBeGreaterThan(0)
  })

  it('should have proper version structure', async () => {
    const versions = await listReferenceVersions()
    const firstVersion = versions[0]!

    expect(firstVersion).toBeDefined()
    expect(firstVersion).toHaveProperty('version')
    expect(firstVersion).toHaveProperty('path')
    expect(firstVersion).toHaveProperty('transcriptIds')
    expect(Array.isArray(firstVersion.transcriptIds)).toBe(true)
  })

  it('should have transcript IDs for each version', async () => {
    const versions = await listReferenceVersions()

    versions.forEach((version) => {
      expect(version.transcriptIds.length).toBeGreaterThan(0)
    })
  })
})

describe('loadReferenceOutput', () => {
  it('should load a model reference output', async () => {
    const output = await loadReferenceOutput(
      'v1.0_2025-10-28_072648',
      'short-001',
      'openai-gpt-5-chat.json'
    )

    expect(output).toBeDefined()
    expect(output).toHaveProperty('initial_goal')
    expect(output).toHaveProperty('current_objective')
    expect(output).toHaveProperty('clarity_score')
    expect(output).toHaveProperty('confidence')
    expect(output).toHaveProperty('_metadata')
  })

  it('should have valid metadata', async () => {
    const output = await loadReferenceOutput(
      'v1.0_2025-10-28_072648',
      'short-001',
      'openai-gpt-5-chat.json'
    )

    expect(output._metadata).toBeDefined()
    expect(output._metadata!.model).toContain('openai')
    expect(output._metadata!.test_id).toBe('short-001')
    expect(typeof output._metadata!.latency_seconds).toBe('number')
  })

  it('should have valid score ranges', async () => {
    const output = await loadReferenceOutput(
      'v1.0_2025-10-28_072648',
      'short-001',
      'openai-gpt-5-chat.json'
    )

    expect(output.clarity_score).toBeGreaterThanOrEqual(0)
    expect(output.clarity_score).toBeLessThanOrEqual(10)
    expect(output.confidence).toBeGreaterThanOrEqual(0)
    expect(output.confidence).toBeLessThanOrEqual(1)
  })
})

describe('loadConsensusOutput', () => {
  it('should load consensus output', async () => {
    const consensus = await loadConsensusOutput('v1.0_2025-10-28_072648', 'short-001')

    expect(consensus).toBeDefined()
    expect(consensus).toHaveProperty('initial_goal')
    expect(consensus).toHaveProperty('current_objective')
    expect(consensus).toHaveProperty('clarity_score')
    expect(consensus).toHaveProperty('confidence')
    expect(consensus).toHaveProperty('generated_at')
    expect(consensus).toHaveProperty('consensus_method')
  })

  it('should not have _metadata field', async () => {
    const consensus = await loadConsensusOutput('v1.0_2025-10-28_072648', 'short-001')

    expect(consensus).not.toHaveProperty('_metadata')
  })

  it('should have consensus_method field', async () => {
    const consensus = await loadConsensusOutput('v1.0_2025-10-28_072648', 'short-001')

    expect(typeof consensus.consensus_method).toBe('string')
    expect(consensus.consensus_method.length).toBeGreaterThan(0)
  })
})

describe('loadAllReferenceOutputs', () => {
  it('should load all reference outputs for a transcript', async () => {
    const outputs = await loadAllReferenceOutputs('v1.0_2025-10-28_072648', 'short-001')

    expect(outputs).toBeDefined()
    expect(outputs).toHaveProperty('consensus')
    expect(outputs).toHaveProperty('models')
  })

  it('should have multiple model outputs', async () => {
    const outputs = await loadAllReferenceOutputs('v1.0_2025-10-28_072648', 'short-001')

    expect(outputs.models.size).toBeGreaterThan(0)
  })

  it('should have consensus output', async () => {
    const outputs = await loadAllReferenceOutputs('v1.0_2025-10-28_072648', 'short-001')

    expect(outputs.consensus).toBeDefined()
    expect(outputs.consensus).toHaveProperty('consensus_method')
  })

  it('should have valid model keys', async () => {
    const outputs = await loadAllReferenceOutputs('v1.0_2025-10-28_072648', 'short-001')

    outputs.models.forEach((output, key) => {
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
      expect(output).toHaveProperty('_metadata')
    })
  })

  it('should have matching test_id in all model outputs', async () => {
    const outputs = await loadAllReferenceOutputs('v1.0_2025-10-28_072648', 'short-001')

    outputs.models.forEach((output) => {
      expect(output._metadata!.test_id).toBe('short-001')
    })
  })
})
