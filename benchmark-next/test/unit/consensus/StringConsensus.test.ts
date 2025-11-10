/**
 * Tests for String Consensus (Semantic Centrality)
 *
 * Validates behavioral parity with Track 1 bash implementation:
 * scripts/benchmark/lib/consensus.sh::consensus_string_field()
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { computeStringConsensus } from '../../../src/benchmark/consensus/StringConsensus'
import type { SemanticSimilarityConfig } from '../../../src/benchmark/scoring/SemanticSimilarity'
import type { LLMResponse } from '../../../src/lib/providers/types'

/**
 * Mock provider for testing semantic similarity
 */
class MockSimilarityProvider {
  private similarityMap: Map<string, number> = new Map()

  setSimilarity(text1: string, text2: string, score: number): void {
    const key = this.makeKey(text1, text2)
    this.similarityMap.set(key, score)
  }

  invoke(prompt: string): Promise<LLMResponse> {
    // Extract texts from prompt
    const text1Match = prompt.match(/Text A: (.+)/)
    const text2Match = prompt.match(/Text B: (.+)/)

    if (!text1Match || !text2Match) {
      return Promise.reject(new Error('Could not parse texts from prompt'))
    }

    const text1 = text1Match[1]!
    const text2 = text2Match[1]!
    const key = this.makeKey(text1, text2)
    const score = this.similarityMap.get(key)

    if (score === undefined) {
      return Promise.reject(
        new Error(`No similarity score configured for: "${text1}" vs "${text2}"`)
      )
    }

    return Promise.resolve({
      content: JSON.stringify({ score }),
      metadata: {
        wallTimeMs: 100,
        rawResponse: JSON.stringify({ score }),
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      },
    })
  }

  extractJSON<T>(response: LLMResponse): T {
    return JSON.parse(response.content) as T
  }

  private makeKey(text1: string, text2: string): string {
    // Normalize key (order-independent)
    return text1 < text2 ? `${text1}|||${text2}` : `${text2}|||${text1}`
  }

  reset(): void {
    this.similarityMap.clear()
  }
}

describe('StringConsensus', () => {
  let mockProvider: MockSimilarityProvider
  let config: SemanticSimilarityConfig

  beforeEach(() => {
    mockProvider = new MockSimilarityProvider()
    config = { judgeProvider: mockProvider }
  })

  describe('null and empty handling', () => {
    it('returns null when all inputs are null', async () => {
      const result = await computeStringConsensus(null, null, null, config)
      expect(result.consensus).toBeNull()
    })

    it('returns null when all inputs are empty strings', async () => {
      const result = await computeStringConsensus('', '', '', config)
      expect(result.consensus).toBeNull()
    })

    it('returns null when all inputs are null or empty', async () => {
      const result = await computeStringConsensus(null, '', null, config)
      expect(result.consensus).toBeNull()
    })

    it('returns the single non-null value when only one is present', async () => {
      const result = await computeStringConsensus('test', null, null, config)
      expect(result.consensus).toBe('test')
    })

    it('returns the single non-empty value when only one is present', async () => {
      const result = await computeStringConsensus('', 'hello', '', config)
      expect(result.consensus).toBe('hello')
    })

    it('returns the single non-null value (third position)', async () => {
      const result = await computeStringConsensus(null, null, 'world', config)
      expect(result.consensus).toBe('world')
    })
  })

  describe('identical string optimization', () => {
    it('returns the identical string when first two match', async () => {
      const result = await computeStringConsensus('identical', 'identical', 'different', config)
      expect(result.consensus).toBe('identical')
    })

    it('returns the identical string when first and third match', async () => {
      const result = await computeStringConsensus('same', 'different', 'same', config)
      expect(result.consensus).toBe('same')
    })

    it('returns the identical string when second and third match', async () => {
      const result = await computeStringConsensus('different', 'matching', 'matching', config)
      expect(result.consensus).toBe('matching')
    })

    it('returns the identical string when all three match', async () => {
      const result = await computeStringConsensus('all-same', 'all-same', 'all-same', config)
      expect(result.consensus).toBe('all-same')
    })
  })

  describe('semantic centrality (three different strings)', () => {
    it('selects the most central string based on average similarity', async () => {
      const str1 = 'Fix authentication bug'
      const str2 = 'Resolve login issue'
      const str3 = 'Debug auth system'

      // Set up similarity scores where str1 is most central
      // str1 has high similarity to both str2 and str3
      mockProvider.setSimilarity(str1, str2, 0.85) // sim(1,2)
      mockProvider.setSimilarity(str1, str3, 0.8) // sim(1,3)
      mockProvider.setSimilarity(str2, str3, 0.6) // sim(2,3)

      // Average similarities:
      // avg1 = (0.85 + 0.80) / 2 = 0.825
      // avg2 = (0.85 + 0.60) / 2 = 0.725
      // avg3 = (0.80 + 0.60) / 2 = 0.700

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str1)
    })

    it('selects second string when it has highest average similarity', async () => {
      const str1 = 'Add new feature'
      const str2 = 'Implement user profile'
      const str3 = 'Create settings page'

      // Set up scores where str2 is most central
      mockProvider.setSimilarity(str1, str2, 0.7) // sim(1,2)
      mockProvider.setSimilarity(str1, str3, 0.5) // sim(1,3)
      mockProvider.setSimilarity(str2, str3, 0.75) // sim(2,3)

      // avg1 = (0.70 + 0.50) / 2 = 0.60
      // avg2 = (0.70 + 0.75) / 2 = 0.725
      // avg3 = (0.50 + 0.75) / 2 = 0.625

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str2)
    })

    it('selects third string when it has highest average similarity', async () => {
      const str1 = 'Update docs'
      const str2 = 'Refactor code'
      const str3 = 'Fix bug'

      // Set up scores where str3 is most central
      mockProvider.setSimilarity(str1, str2, 0.3) // sim(1,2)
      mockProvider.setSimilarity(str1, str3, 0.8) // sim(1,3)
      mockProvider.setSimilarity(str2, str3, 0.85) // sim(2,3)

      // avg1 = (0.30 + 0.80) / 2 = 0.55
      // avg2 = (0.30 + 0.85) / 2 = 0.575
      // avg3 = (0.80 + 0.85) / 2 = 0.825

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str3)
    })

    it('returns first string when all averages are equal', async () => {
      const str1 = 'A'
      const str2 = 'B'
      const str3 = 'C'

      // All equal similarities
      mockProvider.setSimilarity(str1, str2, 0.5)
      mockProvider.setSimilarity(str1, str3, 0.5)
      mockProvider.setSimilarity(str2, str3, 0.5)

      // All averages = 0.50

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str1)
    })
  })

  describe('two non-null different strings', () => {
    it('returns first string when only first two are non-null and different', async () => {
      const str1 = 'First'
      const str2 = 'Second'

      mockProvider.setSimilarity(str1, str2, 0.6)

      const result = await computeStringConsensus(str1, str2, null, config)
      expect(result.consensus).toBe(str1)
    })

    it('returns first string when only first and third are non-null and different', async () => {
      const str1 = 'First'
      const str3 = 'Third'

      mockProvider.setSimilarity(str1, str3, 0.7)

      const result = await computeStringConsensus(str1, null, str3, config)
      expect(result.consensus).toBe(str1)
    })

    it('returns second string when only second and third are non-null and different', async () => {
      const str2 = 'Second'
      const str3 = 'Third'

      mockProvider.setSimilarity(str2, str3, 0.8)

      const result = await computeStringConsensus(null, str2, str3, config)
      expect(result.consensus).toBe(str2)
    })
  })

  describe('error handling', () => {
    it('returns first string when all similarity calculations fail', async () => {
      const str1 = 'A'
      const str2 = 'B'
      const str3 = 'C'

      // Don't set any similarities - will throw errors

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str1)
    })

    it('uses 0.0 for failed similarity calculations and continues', async () => {
      const str1 = 'First'
      const str2 = 'Second'
      const str3 = 'Third'

      // Only set one similarity, others will fail
      mockProvider.setSimilarity(str2, str3, 0.9)

      // Averages:
      // avg1 = (0.0 + 0.0) / 2 = 0.0
      // avg2 = (0.0 + 0.90) / 2 = 0.45
      // avg3 = (0.0 + 0.90) / 2 = 0.45

      // str2 and str3 tied at 0.45, should return str2 (first tie-breaker)
      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str2)
    })

    it('returns first non-null when similarity fails for two-string case', async () => {
      const str1 = 'First'
      const str2 = 'Second'

      // Don't configure similarity - will fail

      const result = await computeStringConsensus(str1, str2, null, config)
      expect(result.consensus).toBe(str1)
    })
  })

  describe('debug information', () => {
    it('includes debug info when requested for three-string case', async () => {
      const str1 = 'A'
      const str2 = 'B'
      const str3 = 'C'

      mockProvider.setSimilarity(str1, str2, 0.8)
      mockProvider.setSimilarity(str1, str3, 0.7)
      mockProvider.setSimilarity(str2, str3, 0.6)

      const result = await computeStringConsensus(str1, str2, str3, config, true)

      expect(result.debug).toBeDefined()
      expect(result.debug?.averages[0]).toBeCloseTo(0.75, 5)
      expect(result.debug?.averages[1]).toBeCloseTo(0.7, 5)
      expect(result.debug?.averages[2]).toBeCloseTo(0.65, 5)
      expect(result.debug?.pairwiseScores).toEqual([0.8, 0.7, 0.6])
      expect(result.debug?.selectedIndex).toBe(0)
    })

    it('does not include debug info when not requested', async () => {
      const str1 = 'A'
      const str2 = 'B'
      const str3 = 'C'

      mockProvider.setSimilarity(str1, str2, 0.5)
      mockProvider.setSimilarity(str1, str3, 0.5)
      mockProvider.setSimilarity(str2, str3, 0.5)

      const result = await computeStringConsensus(str1, str2, str3, config, false)
      expect(result.debug).toBeUndefined()
    })

    it('includes debug info for two-string case when requested', async () => {
      const str1 = 'First'
      const str2 = 'Second'

      mockProvider.setSimilarity(str1, str2, 0.85)

      const result = await computeStringConsensus(str1, str2, null, config, true)

      expect(result.debug).toBeDefined()
      expect(result.debug?.averages).toEqual([0.85, 0.85, 0])
      expect(result.debug?.pairwiseScores).toEqual([0.85, 0, 0])
      expect(result.debug?.selectedIndex).toBe(0)
    })
  })

  describe('fallback provider', () => {
    it('uses fallback provider when primary fails', async () => {
      const str1 = 'A'
      const str2 = 'B'
      const str3 = 'C'

      const fallbackProvider = new MockSimilarityProvider()
      fallbackProvider.setSimilarity(str1, str2, 0.7)
      fallbackProvider.setSimilarity(str1, str3, 0.8)
      fallbackProvider.setSimilarity(str2, str3, 0.6)

      const configWithFallback: SemanticSimilarityConfig = {
        judgeProvider: mockProvider, // Primary will fail (no similarities configured)
        fallbackProvider: fallbackProvider,
      }

      const result = await computeStringConsensus(str1, str2, str3, configWithFallback)

      // Should use fallback and select str1 (avg = 0.75)
      expect(result.consensus).toBe(str1)
    })
  })

  describe('edge cases', () => {
    it('handles very long strings', async () => {
      const str1 = 'A'.repeat(1000)
      const str2 = 'B'.repeat(1000)
      const str3 = 'C'.repeat(1000)

      mockProvider.setSimilarity(str1, str2, 0.5)
      mockProvider.setSimilarity(str1, str3, 0.5)
      mockProvider.setSimilarity(str2, str3, 0.5)

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str1)
    })

    it('handles strings with special characters', async () => {
      const str1 = 'Test with "quotes" and \\backslashes\\'
      const str2 = 'Test with <html> tags'
      const str3 = 'Test with emoji 🚀'

      mockProvider.setSimilarity(str1, str2, 0.6)
      mockProvider.setSimilarity(str1, str3, 0.5)
      mockProvider.setSimilarity(str2, str3, 0.4)

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str1)
    })

    it('handles strings with newlines and whitespace', async () => {
      const str1 = 'Line 1\nLine 2\nLine 3'
      const str2 = 'Single line with  spaces'
      const str3 = '  Leading and trailing  '

      mockProvider.setSimilarity(str1, str2, 0.3)
      mockProvider.setSimilarity(str1, str3, 0.2)
      mockProvider.setSimilarity(str2, str3, 0.8)

      // avg1 = (0.3 + 0.2) / 2 = 0.25
      // avg2 = (0.3 + 0.8) / 2 = 0.55 (highest)
      // avg3 = (0.2 + 0.8) / 2 = 0.50

      const result = await computeStringConsensus(str1, str2, str3, config)
      expect(result.consensus).toBe(str2) // avg2 = 0.55 (highest)
    })
  })
})
