/**
 * Tests for Content Quality Scorer
 *
 * Validates scoring logic matches Track 1 bash implementation:
 * - scripts/benchmark/lib/scoring.sh::score_content_quality()
 *
 * Scoring dimensions:
 * - Presence (20 pts): Comment exists and is not null/empty
 * - Length (20 pts): Comment length is 20-120 characters
 * - Relevance (60 pts): Semantic similarity to first 500 chars of transcript * 60
 *
 * Field selection based on clarity_score:
 * - clarity_score >= 7: use high_clarity_snarky_comment
 * - clarity_score < 7: use low_clarity_snarky_comment
 */

import { describe, it, expect, vi } from 'vitest'
import { scoreContentQuality } from '../../../src/benchmark/scoring/ContentQuality'
import type { TopicAnalysis } from '../../../src/benchmark/scoring/types'
import type { SemanticSimilarityConfig } from '../../../src/benchmark/scoring/SemanticSimilarity'
import type { LLMResponse } from '../../../src/lib/providers/types'

/**
 * Create a mock semantic similarity config for testing
 */
function createMockConfig(similarityScore: number = 1.0): SemanticSimilarityConfig {
  return {
    judgeProvider: {
      // eslint-disable-next-line @typescript-eslint/require-await
      invoke: vi.fn(async () => {
        return {
          content: JSON.stringify({ score: similarityScore }),
          metadata: {
            wallTimeMs: 100,
            rawResponse: JSON.stringify({ score: similarityScore }),
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
 * Sample transcript for relevance testing (500+ chars)
 */
const SAMPLE_TRANSCRIPT = `
User: I need help implementing user authentication for my web application.
Assistant: I'll help you implement a secure authentication system. Let me start by creating the user model and database schema.
User: Great! I also want to support OAuth login with Google and GitHub.
Assistant: Perfect. I'll add OAuth provider configuration to the authentication system. This will require setting up OAuth client credentials and handling the callback flow securely.
User: Make sure to include proper session management.
`.trim()

describe('ContentQuality', () => {
  describe('Perfect score (100 pts)', () => {
    it('should score 100 for high-clarity comment with all criteria met', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Implement authentication',
        current_objective: 'Set up OAuth',
        clarity_score: 8,
        confidence: 0.85,
        significant_change: true,
        high_clarity_snarky_comment: 'Auth is basically middleware with trust issues and paranoia',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(1.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.score).toBe(100)
      expect(result.details.field_used).toBe('high_clarity_snarky_comment')
      expect(result.details.comment_length).toBe(59)
      expect(result.details.present_score).toBe(20)
      expect(result.details.length_score).toBe(20)
      expect(result.details.relevance_similarity).toBe(1.0)
      expect(result.details.relevance_score).toBe(60)
    })

    it('should score 100 for low-clarity comment with all criteria met', async () => {
      const output: TopicAnalysis = {
        task_ids: null,
        initial_goal: 'Do something unclear',
        current_objective: 'Figure it out',
        clarity_score: 3,
        confidence: 0.5,
        significant_change: false,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment:
          "When the user says 'figure it out', they really mean 'I have no idea'",
      }

      const config = createMockConfig(1.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.score).toBe(100)
      expect(result.details.field_used).toBe('low_clarity_snarky_comment')
      expect(result.details.comment_length).toBe(69)
      expect(result.details.present_score).toBe(20)
      expect(result.details.length_score).toBe(20)
      expect(result.details.relevance_similarity).toBe(1.0)
      expect(result.details.relevance_score).toBe(60)
    })
  })

  describe('Field selection based on clarity_score', () => {
    it('should use high_clarity_snarky_comment when clarity >= 7', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Clear goal',
        current_objective: 'Clear objective',
        clarity_score: 7,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This is a high clarity comment that is good',
        low_clarity_snarky_comment: 'This is a low clarity comment',
      }

      const config = createMockConfig(0.8)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.field_used).toBe('high_clarity_snarky_comment')
      expect(result.details.comment_length).toBe(43)
    })

    it('should use low_clarity_snarky_comment when clarity < 7', async () => {
      const output: TopicAnalysis = {
        task_ids: null,
        initial_goal: 'Unclear goal',
        current_objective: 'Unclear objective',
        clarity_score: 6,
        confidence: 0.6,
        significant_change: false,
        high_clarity_snarky_comment: 'This is a high clarity comment',
        low_clarity_snarky_comment: 'This is a low clarity comment here',
      }

      const config = createMockConfig(0.7)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.field_used).toBe('low_clarity_snarky_comment')
      expect(result.details.comment_length).toBe(34)
    })

    it('should use low_clarity_snarky_comment when clarity is null', async () => {
      const output: TopicAnalysis = {
        task_ids: null,
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 0, // Will be treated as null/missing
        confidence: 0.5,
        significant_change: false,
        high_clarity_snarky_comment: 'High clarity comment',
        low_clarity_snarky_comment: 'Low clarity comment here ok',
      }

      const config = createMockConfig(0.6)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.field_used).toBe('low_clarity_snarky_comment')
    })
  })

  describe('Presence scoring (20 pts)', () => {
    it('should award 20 pts when comment is present', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'Short',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.present_score).toBe(20)
      expect(result.score).toBe(20) // Only presence, no length (too short), no relevance (0.0)
    })

    it('should award 0 pts when comment is null', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.present_score).toBe(0)
      expect(result.details.comment_length).toBe(0)
      expect(result.score).toBe(0)
    })

    it('should award 0 pts when comment is empty string', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: '',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.present_score).toBe(0)
      expect(result.details.comment_length).toBe(0)
      expect(result.score).toBe(0)
    })
  })

  describe('Length scoring (20 pts)', () => {
    it('should award 20 pts for length exactly 20 chars', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: '12345678901234567890', // exactly 20
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.comment_length).toBe(20)
      expect(result.details.length_score).toBe(20)
      expect(result.score).toBe(40) // 20 present + 20 length
    })

    it('should award 20 pts for length exactly 120 chars', async () => {
      const comment = 'a'.repeat(120)
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: comment,
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.comment_length).toBe(120)
      expect(result.details.length_score).toBe(20)
      expect(result.score).toBe(40) // 20 present + 20 length
    })

    it('should award 0 pts for length 19 chars (too short)', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: '1234567890123456789', // 19 chars
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.comment_length).toBe(19)
      expect(result.details.length_score).toBe(0)
      expect(result.score).toBe(20) // Only present
    })

    it('should award 0 pts for length 121 chars (too long)', async () => {
      const comment = 'a'.repeat(121)
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: comment,
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.comment_length).toBe(121)
      expect(result.details.length_score).toBe(0)
      expect(result.score).toBe(20) // Only present
    })

    it('should award 20 pts for mid-range length (60 chars)', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'a'.repeat(60),
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.comment_length).toBe(60)
      expect(result.details.length_score).toBe(20)
    })
  })

  describe('Relevance scoring (60 pts)', () => {
    it('should award 60 pts for perfect similarity (1.0)', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This comment is perfectly relevant to the transcript',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(1.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(1.0)
      expect(result.details.relevance_score).toBe(60)
      expect(result.score).toBe(100) // 20 + 20 + 60
    })

    it('should award 48 pts for 0.8 similarity', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This comment is relevant to authentication systems',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.8)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(0.8)
      expect(result.details.relevance_score).toBe(48)
      expect(result.score).toBe(88) // 20 + 20 + 48
    })

    it('should award 30 pts for 0.5 similarity', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This comment is somewhat related to the task',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.5)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(0.5)
      expect(result.details.relevance_score).toBe(30)
      expect(result.score).toBe(70) // 20 + 20 + 30
    })

    it('should award 0 pts for 0.0 similarity', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This comment is completely unrelated to anything',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(0.0)
      expect(result.details.relevance_score).toBe(0)
      expect(result.score).toBe(40) // 20 + 20 + 0
    })

    it('should use first 500 chars of transcript for comparison', async () => {
      const longTranscript = 'a'.repeat(1000)
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This is a relevant comment that fits criteria',
        low_clarity_snarky_comment: null,
      }

      // eslint-disable-next-line @typescript-eslint/require-await
      const mockInvoke = vi.fn(async (prompt: string) => {
        // Verify the transcript excerpt is exactly 500 chars
        expect(prompt).toContain('a'.repeat(500))
        expect(prompt).not.toContain('a'.repeat(501))

        return {
          content: JSON.stringify({ score: 0.9 }),
          metadata: {
            wallTimeMs: 100,
            rawResponse: JSON.stringify({ score: 0.9 }),
            usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          },
        }
      })

      const config: SemanticSimilarityConfig = {
        judgeProvider: {
          invoke: mockInvoke,
          extractJSON: <T>(response: LLMResponse): T => {
            return JSON.parse(response.content) as T
          },
        },
      }

      await scoreContentQuality(output, longTranscript, config)
      expect(mockInvoke).toHaveBeenCalled()
    })

    it('should return 0.0 similarity when comment is null', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
      }

      // Should not call the judge provider for null comments
      const mockInvoke = vi.fn()
      const config: SemanticSimilarityConfig = {
        judgeProvider: {
          invoke: mockInvoke,
          extractJSON: <T>(response: LLMResponse): T => {
            return JSON.parse(response.content) as T
          },
        },
      }

      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(0.0)
      expect(result.details.relevance_score).toBe(0)
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('should return 0.0 similarity when comment is empty', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: '',
        low_clarity_snarky_comment: null,
      }

      const mockInvoke = vi.fn()
      const config: SemanticSimilarityConfig = {
        judgeProvider: {
          invoke: mockInvoke,
          extractJSON: <T>(response: LLMResponse): T => {
            return JSON.parse(response.content) as T
          },
        },
      }

      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_similarity).toBe(0.0)
      expect(result.details.relevance_score).toBe(0)
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    it('should handle transcript shorter than 500 chars', async () => {
      const shortTranscript = 'Short transcript'
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This is a valid comment that should work',
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.75)
      const result = await scoreContentQuality(output, shortTranscript, config)

      expect(result.score).toBe(85) // 20 + 20 + 45
    })

    it('should handle both comment fields being null', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
      }

      const config = createMockConfig(0.0)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.score).toBe(0)
      expect(result.details.field_used).toBe('high_clarity_snarky_comment')
    })

    it('should round relevance score correctly', async () => {
      const output: TopicAnalysis = {
        task_ids: 'task-001',
        initial_goal: 'Goal',
        current_objective: 'Objective',
        clarity_score: 8,
        confidence: 0.8,
        significant_change: true,
        high_clarity_snarky_comment: 'This is a comment that meets length requirements',
        low_clarity_snarky_comment: null,
      }

      // 0.876 * 60 = 52.56 -> should round to 53
      const config = createMockConfig(0.876)
      const result = await scoreContentQuality(output, SAMPLE_TRANSCRIPT, config)

      expect(result.details.relevance_score).toBe(53)
      expect(result.score).toBe(93) // 20 + 20 + 53
    })
  })
})
