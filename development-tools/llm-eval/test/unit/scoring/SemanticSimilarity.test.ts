/**
 * Tests for SemanticSimilarity
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - Mock provider types differ from real provider types
import { describe, it, expect, vi } from 'vitest'
import { calculateSemanticSimilarity } from '../../../src/benchmark/scoring/SemanticSimilarity'
import { MockLLMProvider } from '../../__mocks__/LLMProvider'

describe('SemanticSimilarity', () => {
  describe('calculateSemanticSimilarity', () => {
    it('should return 1.0 for identical texts without API call', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      const invokeSpy = vi.spyOn(judgeProvider, 'invoke')

      const score = await calculateSemanticSimilarity('Fix auth bug', 'Fix auth bug', {
        judgeProvider,
      })

      expect(score).toBe(1.0)
      expect(invokeSpy).not.toHaveBeenCalled()
    })

    it('should return similarity score from judge model', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.85 }),
      })

      const score = await calculateSemanticSimilarity(
        'Fix authentication bug',
        'Resolve login issue',
        { judgeProvider }
      )

      expect(score).toBe(0.85)
    })

    it('should include similarity guidelines in prompt', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.9 }),
      })

      const invokeSpy = vi.spyOn(judgeProvider, 'invoke')

      await calculateSemanticSimilarity('text A', 'text B', { judgeProvider })

      expect(invokeSpy).toHaveBeenCalledWith(expect.stringContaining('Scoring guidelines:'))
      expect(invokeSpy).toHaveBeenCalledWith(
        expect.stringContaining('1.0: Identical or nearly identical in meaning')
      )
    })

    it('should include both texts in prompt', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.75 }),
      })

      const invokeSpy = vi.spyOn(judgeProvider, 'invoke')

      await calculateSemanticSimilarity('Fix auth bug', 'Debug login', {
        judgeProvider,
      })

      expect(invokeSpy).toHaveBeenCalledWith(expect.stringContaining('Text A: Fix auth bug'))
      expect(invokeSpy).toHaveBeenCalledWith(expect.stringContaining('Text B: Debug login'))
    })

    it('should throw error for empty text1', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')

      await expect(calculateSemanticSimilarity('', 'some text', { judgeProvider })).rejects.toThrow(
        'Both text1 and text2 must be non-empty'
      )
    })

    it('should throw error for empty text2', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')

      await expect(calculateSemanticSimilarity('some text', '', { judgeProvider })).rejects.toThrow(
        'Both text1 and text2 must be non-empty'
      )
    })

    it('should use fallback provider when primary fails', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('primary')
      judgeProvider.setDefaultResponse({
        content: '',
        shouldFail: true,
        error: new Error('Timeout'),
      })

      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const fallbackProvider = new MockLLMProvider('fallback')
      fallbackProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.7 }),
      })

      const primarySpy = vi.spyOn(judgeProvider, 'invoke')
      const fallbackSpy = vi.spyOn(fallbackProvider, 'invoke')

      const score = await calculateSemanticSimilarity('text A', 'text B', {
        judgeProvider,
        fallbackProvider,
      })

      expect(score).toBe(0.7)
      expect(primarySpy).toHaveBeenCalled()
      expect(fallbackSpy).toHaveBeenCalled()
    })

    it('should throw error when both primary and fallback fail', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('primary')
      judgeProvider.setDefaultResponse({
        content: '',
        shouldFail: true,
        error: new Error('Primary timeout'),
      })

      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const fallbackProvider = new MockLLMProvider('fallback')
      fallbackProvider.setDefaultResponse({
        content: '',
        shouldFail: true,
        error: new Error('Fallback rate limit'),
      })

      await expect(
        calculateSemanticSimilarity('text A', 'text B', {
          judgeProvider,
          fallbackProvider,
        })
      ).rejects.toThrow('Both primary and fallback judge models failed')
    })

    it('should throw error when primary fails and no fallback configured', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('primary')
      judgeProvider.setDefaultResponse({
        content: '',
        shouldFail: true,
        error: new Error('API error'),
      })

      await expect(
        calculateSemanticSimilarity('text A', 'text B', { judgeProvider })
      ).rejects.toThrow('Judge model failed for semantic similarity (no fallback configured)')
    })

    it('should handle high similarity scores (0.9-1.0)', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.95 }),
      })

      const score = await calculateSemanticSimilarity('Implement new feature', 'Add new feature', {
        judgeProvider,
      })

      expect(score).toBe(0.95)
      expect(score).toBeGreaterThanOrEqual(0.9)
      expect(score).toBeLessThanOrEqual(1.0)
    })

    it('should handle medium similarity scores (0.5-0.7)', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.6 }),
      })

      const score = await calculateSemanticSimilarity('Fix authentication', 'Update database', {
        judgeProvider,
      })

      expect(score).toBe(0.6)
      expect(score).toBeGreaterThanOrEqual(0.5)
      expect(score).toBeLessThanOrEqual(0.7)
    })

    it('should handle low similarity scores (0.0-0.3)', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.1 }),
      })

      const score = await calculateSemanticSimilarity(
        'Fix authentication bug',
        'Update documentation',
        { judgeProvider }
      )

      expect(score).toBe(0.1)
      expect(score).toBeGreaterThanOrEqual(0.0)
      expect(score).toBeLessThanOrEqual(0.3)
    })

    it('should extract JSON score from markdown-wrapped response', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: '```json\n{"score": 0.8}\n```',
      })

      const score = await calculateSemanticSimilarity('text A', 'text B', {
        judgeProvider,
      })

      expect(score).toBe(0.8)
    })

    it('should validate score is within 0.0-1.0 range', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.5 }),
      })

      const score = await calculateSemanticSimilarity('text A', 'text B', {
        judgeProvider,
      })

      expect(score).toBeGreaterThanOrEqual(0.0)
      expect(score).toBeLessThanOrEqual(1.0)
    })

    it('should handle exact match edge case (boundary)', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 1.0 }),
      })

      const score = await calculateSemanticSimilarity('Same meaning', 'Identical meaning', {
        judgeProvider,
      })

      expect(score).toBe(1.0)
    })

    it('should handle completely different edge case (boundary)', async () => {
      // @ts-expect-error - Mock provider types differ slightly
      // @ts-expect-error - Type mismatch between mock and real providers
      const judgeProvider = new MockLLMProvider('test-judge')
      judgeProvider.setDefaultResponse({
        content: JSON.stringify({ score: 0.0 }),
      })

      const score = await calculateSemanticSimilarity(
        'Authentication system',
        'Database migration',
        { judgeProvider }
      )

      expect(score).toBe(0.0)
    })
  })
})
