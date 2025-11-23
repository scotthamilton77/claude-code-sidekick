/**
 * Tests for Numeric Consensus (Median)
 *
 * Validates behavioral parity with Track 1 bash implementation:
 * scripts/benchmark/lib/consensus.sh::consensus_numeric_field()
 */

import { describe, it, expect } from 'vitest'
import { computeNumericConsensus } from '../../../src/benchmark/consensus/NumericConsensus'

describe('NumericConsensus', () => {
  describe('median calculation with 3 values', () => {
    it('returns middle value when values are already sorted', () => {
      const result = computeNumericConsensus(1, 2, 3)
      expect(result).toBe(2)
    })

    it('returns middle value when values are unsorted', () => {
      const result = computeNumericConsensus(7, 9, 8)
      expect(result).toBe(8)
    })

    it('returns middle value when values are reverse sorted', () => {
      const result = computeNumericConsensus(10, 5, 0)
      expect(result).toBe(5)
    })

    it('returns middle value when first two are identical', () => {
      const result = computeNumericConsensus(5, 5, 10)
      expect(result).toBe(5)
    })

    it('returns middle value when last two are identical', () => {
      const result = computeNumericConsensus(2, 8, 8)
      expect(result).toBe(8)
    })

    it('returns the value when all three are identical', () => {
      const result = computeNumericConsensus(7, 7, 7)
      expect(result).toBe(7)
    })
  })

  describe('null and undefined handling', () => {
    it('converts null to 0 and calculates median', () => {
      const result = computeNumericConsensus(null, 5, 10)
      expect(result).toBe(5) // [0, 5, 10] → median is 5
    })

    it('converts all nulls to 0', () => {
      const result = computeNumericConsensus(null, null, null)
      expect(result).toBe(0) // [0, 0, 0] → median is 0
    })

    it('converts undefined to 0', () => {
      const result = computeNumericConsensus(undefined, 3, 6)
      expect(result).toBe(3) // [0, 3, 6] → median is 3
    })

    it('handles mix of null and undefined', () => {
      const result = computeNumericConsensus(null, undefined, 9)
      expect(result).toBe(0) // [0, 0, 9] → median is 0
    })

    it('handles two nulls and one valid value', () => {
      const result = computeNumericConsensus(null, null, 42)
      expect(result).toBe(0) // [0, 0, 42] → median is 0
    })
  })

  describe('floating point values', () => {
    it('calculates median with floats', () => {
      const result = computeNumericConsensus(0.5, 0.8, 0.6)
      expect(result).toBe(0.6)
    })

    it('handles precision correctly', () => {
      const result = computeNumericConsensus(0.333, 0.666, 0.999)
      expect(result).toBe(0.666)
    })

    it('handles mix of integers and floats', () => {
      const result = computeNumericConsensus(1, 2.5, 3)
      expect(result).toBe(2.5)
    })
  })

  describe('negative numbers', () => {
    it('handles all negative numbers', () => {
      const result = computeNumericConsensus(-10, -5, -20)
      expect(result).toBe(-10) // [-20, -10, -5] → median is -10
    })

    it('handles mix of positive and negative', () => {
      const result = computeNumericConsensus(-5, 0, 5)
      expect(result).toBe(0)
    })

    it('handles negative with null', () => {
      const result = computeNumericConsensus(null, -10, -20)
      expect(result).toBe(-10) // [-20, -10, 0] → median is -10
    })
  })

  describe('edge cases', () => {
    it('handles zero values', () => {
      const result = computeNumericConsensus(0, 0, 0)
      expect(result).toBe(0)
    })

    it('handles very large numbers', () => {
      const result = computeNumericConsensus(1000000, 2000000, 3000000)
      expect(result).toBe(2000000)
    })

    it('handles very small numbers', () => {
      const result = computeNumericConsensus(0.0001, 0.0002, 0.0003)
      expect(result).toBe(0.0002)
    })
  })

  describe('Track 1 behavioral parity', () => {
    // These test cases validate exact behavior from bash implementation
    it('matches bash behavior for clarity_score range (1-10)', () => {
      const result = computeNumericConsensus(7, 9, 8)
      expect(result).toBe(8) // From consensus example in bash
    })

    it('matches bash behavior for confidence range (0.0-1.0)', () => {
      const result = computeNumericConsensus(0.5, 0.8, 0.6)
      expect(result).toBe(0.6)
    })

    it('matches bash default conversion: null → 0', () => {
      // Bash: [ "$num1" = "null" ] || [ -z "$num1" ] && num1=0
      const result = computeNumericConsensus(null, null, null)
      expect(result).toBe(0)
    })

    it('matches bash jq sort behavior', () => {
      // Bash: echo "$num1" "$num2" "$num3" | jq -s 'sort | .[1]'
      const result = computeNumericConsensus(3, 1, 2)
      expect(result).toBe(2) // [1, 2, 3] → index 1 is 2
    })
  })
})
