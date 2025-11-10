import { describe, it, expect } from 'vitest'
import { calculateOverallScore } from '../../../src/benchmark/scoring/Aggregator'

describe('Aggregator', () => {
  describe('calculateOverallScore', () => {
    it('should calculate overall score with weights: schema 30%, technical 50%, content 20%', () => {
      // schema: 100, technical: 100, content: 100
      // expected: (100 * 0.30) + (100 * 0.50) + (100 * 0.20) = 30 + 50 + 20 = 100
      const result = calculateOverallScore(100, 100, 100)
      expect(result).toBe(100)
    })

    it('should calculate overall score for all zeros', () => {
      // schema: 0, technical: 0, content: 0
      // expected: (0 * 0.30) + (0 * 0.50) + (0 * 0.20) = 0
      const result = calculateOverallScore(0, 0, 0)
      expect(result).toBe(0)
    })

    it('should calculate overall score with mixed values (example 1)', () => {
      // schema: 80, technical: 60, content: 40
      // expected: (80 * 0.30) + (60 * 0.50) + (40 * 0.20) = 24 + 30 + 8 = 62
      const result = calculateOverallScore(80, 60, 40)
      expect(result).toBe(62)
    })

    it('should calculate overall score with mixed values (example 2)', () => {
      // schema: 50, technical: 75, content: 90
      // expected: (50 * 0.30) + (75 * 0.50) + (90 * 0.20) = 15 + 37.5 + 18 = 70.5
      const result = calculateOverallScore(50, 75, 90)
      expect(result).toBe(70.5)
    })

    it('should calculate overall score with decimal inputs', () => {
      // schema: 85.5, technical: 92.3, content: 78.1
      // expected: (85.5 * 0.30) + (92.3 * 0.50) + (78.1 * 0.20) = 25.65 + 46.15 + 15.62 = 87.42
      const result = calculateOverallScore(85.5, 92.3, 78.1)
      expect(result).toBeCloseTo(87.42, 2)
    })

    it('should round to 2 decimal places (Track 1 uses scale=2)', () => {
      // schema: 33.333, technical: 66.666, content: 99.999
      // expected: (33.333 * 0.30) + (66.666 * 0.50) + (99.999 * 0.20) = 9.9999 + 33.333 + 19.9998 = 63.33
      const result = calculateOverallScore(33.333, 66.666, 99.999)
      expect(result).toBeCloseTo(63.33, 2)
    })

    it('should handle high schema score with low others', () => {
      // schema: 100, technical: 0, content: 0
      // expected: (100 * 0.30) + (0 * 0.50) + (0 * 0.20) = 30
      const result = calculateOverallScore(100, 0, 0)
      expect(result).toBe(30)
    })

    it('should handle high technical score with low others', () => {
      // schema: 0, technical: 100, content: 0
      // expected: (0 * 0.30) + (100 * 0.50) + (0 * 0.20) = 50
      const result = calculateOverallScore(0, 100, 0)
      expect(result).toBe(50)
    })

    it('should handle high content score with low others', () => {
      // schema: 0, technical: 0, content: 100
      // expected: (0 * 0.30) + (0 * 0.50) + (100 * 0.20) = 20
      const result = calculateOverallScore(0, 0, 100)
      expect(result).toBe(20)
    })

    it('should calculate realistic benchmark scenario 1', () => {
      // schema: 100 (perfect JSON), technical: 85 (mostly accurate), content: 60 (decent comment)
      // expected: (100 * 0.30) + (85 * 0.50) + (60 * 0.20) = 30 + 42.5 + 12 = 84.5
      const result = calculateOverallScore(100, 85, 60)
      expect(result).toBe(84.5)
    })

    it('should calculate realistic benchmark scenario 2', () => {
      // schema: 70 (missing some fields), technical: 50 (partial match), content: 80 (good comment)
      // expected: (70 * 0.30) + (50 * 0.50) + (80 * 0.20) = 21 + 25 + 16 = 62
      const result = calculateOverallScore(70, 50, 80)
      expect(result).toBe(62)
    })

    it('should handle fractional results that need rounding', () => {
      // schema: 77.77, technical: 88.88, content: 99.99
      // expected: (77.77 * 0.30) + (88.88 * 0.50) + (99.99 * 0.20) = 23.331 + 44.44 + 19.998 = 87.77
      const result = calculateOverallScore(77.77, 88.88, 99.99)
      expect(result).toBeCloseTo(87.77, 2)
    })

    it('should match Track 1 bash calculation with bc scale=2', () => {
      // Test case from Track 1: schema: 90, technical: 75, content: 45
      // bash: echo "scale=2; (90 * 0.30) + (75 * 0.50) + (45 * 0.20)" | bc
      // expected: 27 + 37.5 + 9 = 73.5
      const result = calculateOverallScore(90, 75, 45)
      expect(result).toBe(73.5)
    })

    it('should handle very small decimal differences correctly', () => {
      // schema: 33.33, technical: 66.67, content: 99.99
      // expected: (33.33 * 0.30) + (66.67 * 0.50) + (99.99 * 0.20) = 9.999 + 33.335 + 19.998 = 63.33
      const result = calculateOverallScore(33.33, 66.67, 99.99)
      expect(result).toBeCloseTo(63.33, 2)
    })

    it('should validate weights sum to 1.0 (30% + 50% + 20% = 100%)', () => {
      // With all inputs at 100, output should be 100
      // This validates that weights are correctly: 0.30 + 0.50 + 0.20 = 1.0
      const result = calculateOverallScore(100, 100, 100)
      expect(result).toBe(100)

      // With all inputs at 50, output should be 50
      const result2 = calculateOverallScore(50, 50, 50)
      expect(result2).toBe(50)
    })

    it('should handle edge case with all maximum scores', () => {
      const result = calculateOverallScore(100, 100, 100)
      expect(result).toBe(100)
    })

    it('should handle edge case with all minimum scores', () => {
      const result = calculateOverallScore(0, 0, 0)
      expect(result).toBe(0)
    })
  })
})
