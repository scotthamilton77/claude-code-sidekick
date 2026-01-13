/**
 * Tests for Boolean Consensus (Majority Vote)
 *
 * Validates behavioral parity with Track 1 bash implementation:
 * scripts/benchmark/lib/consensus.sh::consensus_boolean_field()
 */

import { describe, it, expect } from 'vitest'
import { computeBooleanConsensus } from '../../../src/benchmark/consensus/BooleanConsensus'

describe('BooleanConsensus', () => {
  describe('majority vote with 3 values', () => {
    it('returns true when all three are true', () => {
      const result = computeBooleanConsensus(true, true, true)
      expect(result).toBe(true)
    })

    it('returns false when all three are false', () => {
      const result = computeBooleanConsensus(false, false, false)
      expect(result).toBe(false)
    })

    it('returns true when first two are true', () => {
      const result = computeBooleanConsensus(true, true, false)
      expect(result).toBe(true)
    })

    it('returns true when first and last are true', () => {
      const result = computeBooleanConsensus(true, false, true)
      expect(result).toBe(true)
    })

    it('returns true when last two are true', () => {
      const result = computeBooleanConsensus(false, true, true)
      expect(result).toBe(true)
    })

    it('returns false when only first is true', () => {
      const result = computeBooleanConsensus(true, false, false)
      expect(result).toBe(false)
    })

    it('returns false when only second is true', () => {
      const result = computeBooleanConsensus(false, true, false)
      expect(result).toBe(false)
    })

    it('returns false when only third is true', () => {
      const result = computeBooleanConsensus(false, false, true)
      expect(result).toBe(false)
    })
  })

  describe('null handling', () => {
    it('treats null as false', () => {
      const result = computeBooleanConsensus(null, true, true)
      expect(result).toBe(true) // [false, true, true] → 2 trues
    })

    it('treats all nulls as false', () => {
      const result = computeBooleanConsensus(null, null, null)
      expect(result).toBe(false) // [false, false, false] → 0 trues
    })

    it('treats undefined as false', () => {
      const result = computeBooleanConsensus(undefined, true, true)
      expect(result).toBe(true) // [false, true, true] → 2 trues
    })

    it('handles mix of null and undefined', () => {
      const result = computeBooleanConsensus(null, undefined, true)
      expect(result).toBe(false) // [false, false, true] → 1 true
    })

    it('returns false when two are null and one is false', () => {
      const result = computeBooleanConsensus(null, null, false)
      expect(result).toBe(false) // [false, false, false] → 0 trues
    })

    it('returns true when two are true and one is null', () => {
      const result = computeBooleanConsensus(true, true, null)
      expect(result).toBe(true) // [true, true, false] → 2 trues
    })

    it('returns true when two are true and one is undefined', () => {
      const result = computeBooleanConsensus(true, true, undefined)
      expect(result).toBe(true) // [true, true, false] → 2 trues
    })
  })

  describe('edge cases', () => {
    it('handles all combinations with exactly 2 trues', () => {
      expect(computeBooleanConsensus(true, true, false)).toBe(true)
      expect(computeBooleanConsensus(true, false, true)).toBe(true)
      expect(computeBooleanConsensus(false, true, true)).toBe(true)
    })

    it('handles all combinations with exactly 1 true', () => {
      expect(computeBooleanConsensus(true, false, false)).toBe(false)
      expect(computeBooleanConsensus(false, true, false)).toBe(false)
      expect(computeBooleanConsensus(false, false, true)).toBe(false)
    })

    it('handles all combinations with 0 trues', () => {
      expect(computeBooleanConsensus(false, false, false)).toBe(false)
      expect(computeBooleanConsensus(null, false, false)).toBe(false)
      expect(computeBooleanConsensus(null, null, false)).toBe(false)
      expect(computeBooleanConsensus(null, null, null)).toBe(false)
    })

    it('handles all combinations with 3 trues', () => {
      expect(computeBooleanConsensus(true, true, true)).toBe(true)
    })
  })

  describe('Track 1 behavioral parity', () => {
    // These test cases validate exact behavior from bash implementation
    it('matches bash example: true false true → true', () => {
      // Bash: result=$(consensus_boolean_field true false true)
      // Output: true
      const result = computeBooleanConsensus(true, false, true)
      expect(result).toBe(true)
    })

    it('matches bash normalization: non-true → false', () => {
      // Bash: [ "$bool1" = "true" ] && bool1=1 || bool1=0
      // Anything not "true" becomes false
      const result = computeBooleanConsensus(null, false, false)
      expect(result).toBe(false)
    })

    it('matches bash majority vote: count >= 2', () => {
      // Bash: if [ $true_count -ge 2 ]; then echo "true"; else echo "false"; fi
      expect(computeBooleanConsensus(true, true, false)).toBe(true) // count = 2
      expect(computeBooleanConsensus(true, true, true)).toBe(true) // count = 3
      expect(computeBooleanConsensus(true, false, false)).toBe(false) // count = 1
      expect(computeBooleanConsensus(false, false, false)).toBe(false) // count = 0
    })

    it('matches bash behavior for significant_change field', () => {
      // This field is typically boolean in the topic analysis schema
      // Majority of models must agree for consensus to be true
      const result1 = computeBooleanConsensus(true, false, false)
      expect(result1).toBe(false) // Only 1 model detected significant change

      const result2 = computeBooleanConsensus(true, true, false)
      expect(result2).toBe(true) // 2 models detected significant change
    })
  })

  describe('comprehensive coverage', () => {
    it('validates all 27 possible input combinations', () => {
      // 3 positions × 3 values (true/false/null) = 27 combinations
      const inputs: Array<[boolean | null, boolean | null, boolean | null, boolean]> = [
        // All same
        [true, true, true, true], // 3 trues
        [false, false, false, false], // 0 trues
        [null, null, null, false], // 0 trues

        // Two true, one false/null
        [true, true, false, true],
        [true, true, null, true],
        [true, false, true, true],
        [false, true, true, true],
        [true, null, true, true],
        [null, true, true, true],

        // One true, two false/null
        [true, false, false, false],
        [true, false, null, false],
        [true, null, false, false],
        [true, null, null, false],
        [false, true, false, false],
        [false, true, null, false],
        [null, true, false, false],
        [null, true, null, false],
        [false, false, true, false],
        [false, null, true, false],
        [null, false, true, false],
        [null, null, true, false],

        // No true (various combinations of false/null)
        [false, false, null, false],
        [false, null, false, false],
        [false, null, null, false],
        [null, false, false, false],
        [null, false, null, false],
        [null, null, false, false],
      ]

      for (const [val1, val2, val3, expected] of inputs) {
        const result = computeBooleanConsensus(val1, val2, val3)
        expect(result).toBe(expected)
      }
    })
  })
})
