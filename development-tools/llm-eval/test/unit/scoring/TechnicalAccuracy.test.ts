/**
 * Tests for Technical Accuracy Scorer
 *
 * Validates scoring logic matches Track 1 bash implementation:
 * - scripts/benchmark/lib/scoring.sh::score_technical_accuracy()
 */

import { describe, it, expect, vi } from 'vitest'
import { scoreTechnicalAccuracy } from '../../../src/benchmark/scoring/TechnicalAccuracy'
import type { TopicAnalysis } from '../../../src/benchmark/scoring/types'
import type { SemanticSimilarityConfig } from '../../../src/benchmark/scoring/SemanticSimilarity'
import type { LLMResponse } from '../../../src/lib/providers/types'

/**
 * Create a mock semantic similarity config for testing
 */
function createMockConfig(
  similarityOverrides: Record<string, number> = {}
): SemanticSimilarityConfig {
  return {
    judgeProvider: {
      // eslint-disable-next-line @typescript-eslint/require-await
      invoke: vi.fn(async (prompt: string) => {
        // Extract texts from prompt to determine which comparison is being made
        const textAMatch = prompt.match(/Text A: (.+?)(?:\n|$)/s)
        const textBMatch = prompt.match(/Text B: (.+?)$/s)

        if (!textAMatch?.[1] || !textBMatch?.[1]) {
          throw new Error('Could not parse prompt')
        }

        const textA = textAMatch[1].trim()
        const textB = textBMatch[1].trim()
        const key = `${textA}|${textB}`

        const similarity = similarityOverrides[key] ?? 1.0

        return {
          content: JSON.stringify({ score: similarity }),
          metadata: {
            wallTimeMs: 100,
            rawResponse: JSON.stringify({ score: similarity }),
            usage: {
              inputTokens: 100,
              outputTokens: 10,
              totalTokens: 110,
            },
          },
        }
      }),
      extractJSON: <T>(response: LLMResponse): T => {
        return JSON.parse(response.content) as T
      },
    },
  }
}

/**
 * Reference output fixture (consensus from high-quality models)
 */
const REFERENCE: TopicAnalysis = {
  task_ids: 'task-001, task-002',
  initial_goal: 'Implement user authentication',
  current_objective: 'Set up OAuth provider',
  clarity_score: 7,
  confidence: 0.85,
  significant_change: true,
  high_clarity_snarky_comment: 'Auth is basically middleware with trust issues',
  low_clarity_snarky_comment: null,
}

describe('TechnicalAccuracy', () => {
  describe('Perfect match', () => {
    it('should score 100 for identical output and reference', async () => {
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(REFERENCE, REFERENCE, config)

      expect(result.score).toBe(100)
      expect(result.details.task_ids_match).toBe(true)
      expect(result.details.task_ids_score).toBe(15)
      expect(result.details.initial_goal_similarity).toBe(1.0)
      expect(result.details.initial_goal_score).toBe(20)
      expect(result.details.current_objective_similarity).toBe(1.0)
      expect(result.details.current_objective_score).toBe(20)
      expect(result.details.clarity_match).toBe(true)
      expect(result.details.clarity_score).toBe(20)
      expect(result.details.significant_change_match).toBe(true)
      expect(result.details.significant_change_score).toBe(15)
      expect(result.details.confidence_match).toBe(true)
      expect(result.details.confidence_score).toBe(10)
    })
  })

  describe('task_ids scoring (15 pts)', () => {
    it('should award 15 pts for exact match', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        task_ids: 'task-001, task-002',
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.task_ids_match).toBe(true)
      expect(result.details.task_ids_score).toBe(15)
    })

    it('should award 0 pts for mismatch', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        task_ids: 'task-003',
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.task_ids_match).toBe(false)
      expect(result.details.task_ids_score).toBe(0)
    })

    it('should handle null task_ids', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        task_ids: null,
      }
      const reference: TopicAnalysis = {
        ...REFERENCE,
        task_ids: null,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, reference, config)

      expect(result.details.task_ids_match).toBe(true)
      expect(result.details.task_ids_score).toBe(15)
    })
  })

  describe('initial_goal semantic similarity (20 pts)', () => {
    it('should award 20 pts for identical text (similarity 1.0)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Implement user authentication',
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_similarity).toBe(1.0)
      expect(result.details.initial_goal_score).toBe(20)
    })

    it('should scale score proportionally (similarity 0.8 → 16 pts)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Add user authentication',
      }
      const similarityKey = 'Add user authentication|Implement user authentication'
      const config = createMockConfig({ [similarityKey]: 0.8 })
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_similarity).toBe(0.8)
      expect(result.details.initial_goal_score).toBe(16) // 0.8 * 20 = 16
    })

    it('should round to nearest integer (similarity 0.875 → 18 pts)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Build user auth system',
      }
      const similarityKey = 'Build user auth system|Implement user authentication'
      const config = createMockConfig({ [similarityKey]: 0.875 })
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_similarity).toBe(0.875)
      expect(result.details.initial_goal_score).toBe(18) // Math.round(0.875 * 20) = 18
    })

    it('should handle empty output string (0 pts)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: '',
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_similarity).toBe(0.0)
      expect(result.details.initial_goal_score).toBe(0)
    })
  })

  describe('current_objective semantic similarity (20 pts)', () => {
    it('should award 20 pts for identical text', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        current_objective: 'Set up OAuth provider',
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.current_objective_similarity).toBe(1.0)
      expect(result.details.current_objective_score).toBe(20)
    })

    it('should scale score proportionally (similarity 0.5 → 10 pts)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        current_objective: 'Configure authentication',
      }
      const similarityKey = 'Configure authentication|Set up OAuth provider'
      const config = createMockConfig({ [similarityKey]: 0.5 })
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.current_objective_similarity).toBe(0.5)
      expect(result.details.current_objective_score).toBe(10) // 0.5 * 20 = 10
    })
  })

  describe('clarity_score tolerance (20 pts)', () => {
    it('should award 20 pts for exact match', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        clarity_score: 7,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.clarity_match).toBe(true)
      expect(result.details.clarity_score).toBe(20)
    })

    it('should award 20 pts for difference of 1 (boundary: +1)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        clarity_score: 8, // reference is 7, diff = 1
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.clarity_match).toBe(true)
      expect(result.details.clarity_score).toBe(20)
    })

    it('should award 20 pts for difference of 1 (boundary: -1)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        clarity_score: 6, // reference is 7, diff = 1
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.clarity_match).toBe(true)
      expect(result.details.clarity_score).toBe(20)
    })

    it('should award 0 pts for difference > 1', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        clarity_score: 9, // reference is 7, diff = 2
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.clarity_match).toBe(false)
      expect(result.details.clarity_score).toBe(0)
    })
  })

  describe('significant_change boolean match (15 pts)', () => {
    it('should award 15 pts for match (both true)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        significant_change: true,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.significant_change_match).toBe(true)
      expect(result.details.significant_change_score).toBe(15)
    })

    it('should award 15 pts for match (both false)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        significant_change: false,
      }
      const reference: TopicAnalysis = {
        ...REFERENCE,
        significant_change: false,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, reference, config)

      expect(result.details.significant_change_match).toBe(true)
      expect(result.details.significant_change_score).toBe(15)
    })

    it('should award 0 pts for mismatch', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        significant_change: false,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.significant_change_match).toBe(false)
      expect(result.details.significant_change_score).toBe(0)
    })
  })

  describe('confidence tolerance (10 pts)', () => {
    it('should award 10 pts for exact match', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        confidence: 0.85,
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.confidence_match).toBe(true)
      expect(result.details.confidence_score).toBe(10)
    })

    it('should award 10 pts for difference exactly 0.15 (boundary: +0.15)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        confidence: 1.0, // reference is 0.85, diff = 0.15
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.confidence_match).toBe(true)
      expect(result.details.confidence_score).toBe(10)
    })

    it('should award 10 pts for difference exactly 0.15 (boundary: -0.15)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        confidence: 0.7, // reference is 0.85, diff = 0.15
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.confidence_match).toBe(true)
      expect(result.details.confidence_score).toBe(10)
    })

    it('should award 0 pts for difference > 0.15', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        confidence: 0.6, // reference is 0.85, diff = 0.25
      }
      const config = createMockConfig()
      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.confidence_match).toBe(false)
      expect(result.details.confidence_score).toBe(0)
    })
  })

  describe('Edge cases', () => {
    it('should handle semantic similarity failure gracefully (returns 0)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Some different goal',
        current_objective: 'Some different objective',
      }
      const config = createMockConfig()

      // Override mock to throw error for specific comparison
      config.judgeProvider.invoke = vi.fn().mockRejectedValue(new Error('API timeout'))

      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      // Should not throw, but return 0 for failed similarity checks
      expect(result.details.initial_goal_similarity).toBe(0.0)
      expect(result.details.initial_goal_score).toBe(0)
      expect(result.details.current_objective_similarity).toBe(0.0)
      expect(result.details.current_objective_score).toBe(0)

      // Other fields should still be scored
      expect(result.details.task_ids_match).toBe(true)
      expect(result.details.task_ids_score).toBe(15)
    })

    it('should handle combination of mismatches correctly', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-999', // mismatch: 0 pts
        initial_goal: 'Different goal', // low similarity
        current_objective: 'Different objective', // low similarity
        clarity_score: 3, // diff = 4, mismatch: 0 pts
        confidence: 0.3, // diff = 0.55, mismatch: 0 pts
        significant_change: false, // mismatch: 0 pts
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: 'Some comment',
      }

      const goalKey = 'Different goal|Implement user authentication'
      const objKey = 'Different objective|Set up OAuth provider'
      const config = createMockConfig({
        [goalKey]: 0.2, // 0.2 * 20 = 4 pts
        [objKey]: 0.15, // 0.15 * 20 = 3 pts
      })

      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      // Expected: 0 + 4 + 3 + 0 + 0 + 0 = 7
      expect(result.score).toBe(7)
      expect(result.details.task_ids_score).toBe(0)
      expect(result.details.initial_goal_score).toBe(4)
      expect(result.details.current_objective_score).toBe(3)
      expect(result.details.clarity_score).toBe(0)
      expect(result.details.significant_change_score).toBe(0)
      expect(result.details.confidence_score).toBe(0)
    })
  })

  describe('Rounding behavior', () => {
    it('should round 0.5 → 1 (banker rounding: round half to even)', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Test rounding',
      }
      const similarityKey = 'Test rounding|Implement user authentication'
      const config = createMockConfig({ [similarityKey]: 0.025 }) // 0.025 * 20 = 0.5

      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      // Math.round(0.5) = 1 in JavaScript (rounds half up)
      expect(result.details.initial_goal_score).toBe(1)
    })

    it('should round 0.49 → 0', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Test rounding down',
      }
      const similarityKey = 'Test rounding down|Implement user authentication'
      const config = createMockConfig({ [similarityKey]: 0.024 }) // 0.024 * 20 = 0.48

      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_score).toBe(0)
    })

    it('should round 0.51 → 1', async () => {
      const output: TopicAnalysis = {
        ...REFERENCE,
        initial_goal: 'Test rounding up',
      }
      const similarityKey = 'Test rounding up|Implement user authentication'
      const config = createMockConfig({ [similarityKey]: 0.026 }) // 0.026 * 20 = 0.52

      const result = await scoreTechnicalAccuracy(output, REFERENCE, config)

      expect(result.details.initial_goal_score).toBe(1)
    })
  })
})
