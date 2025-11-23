/**
 * Tests for Array Consensus (Union with Majority)
 *
 * Validates behavioral parity with Track 1 bash implementation:
 * scripts/benchmark/lib/consensus.sh::consensus_array_field()
 */

import { describe, it, expect } from 'vitest'
import { computeArrayConsensus } from '../../../src/benchmark/consensus/ArrayConsensus'

describe('ArrayConsensus', () => {
  describe('majority voting (2+ arrays)', () => {
    it('returns item appearing in all 3 arrays', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T123', 'T789'], ['T123', 'T999'])
      expect(result).toEqual(['T123'])
    })

    it('returns items appearing in exactly 2 arrays', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T123', 'T789'], ['T999'])
      expect(result).toEqual(['T123'])
    })

    it('returns multiple items when each appears in 2+ arrays', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T123', 'T789'], ['T456', 'T789'])
      // All three items appear in at least 2 arrays
      expect(result).toHaveLength(3)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
      expect(result).toContain('T789')
    })

    it('returns null when no item appears in 2+ arrays', () => {
      const result = computeArrayConsensus(['T123'], ['T456'], ['T789'])
      expect(result).toBeNull()
    })

    it('returns null when all items are unique', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T789', 'T999'], ['T111', 'T222'])
      expect(result).toBeNull()
    })

    it('includes items from two arrays when third is different', () => {
      const result = computeArrayConsensus(['T123', 'T456', 'T789'], ['T123', 'T456'], ['T999'])
      expect(result).toHaveLength(2)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
    })
  })

  describe('deduplication', () => {
    it('deduplicates items within the same array', () => {
      const result = computeArrayConsensus(['T123', 'T123', 'T456'], ['T123'], ['T456'])
      // T123 appears in 2 arrays, T456 appears in 2 arrays
      expect(result).toHaveLength(2)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
    })

    it('handles duplicates across multiple arrays', () => {
      const result = computeArrayConsensus(['T123', 'T123'], ['T123', 'T123', 'T123'], ['T123'])
      // T123 appears in all 3 arrays, should appear once in result
      expect(result).toEqual(['T123'])
    })

    it('deduplicates result even with duplicates in inputs', () => {
      const result = computeArrayConsensus(
        ['T123', 'T456', 'T123'],
        ['T123', 'T456'],
        ['T456', 'T789', 'T456']
      )
      // T123 in 2 arrays, T456 in all 3 arrays
      expect(result).toHaveLength(2)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
    })
  })

  describe('null and undefined handling', () => {
    it('treats null as empty array', () => {
      const result = computeArrayConsensus(null, ['T123', 'T456'], ['T123', 'T789'])
      expect(result).toEqual(['T123'])
    })

    it('treats undefined as empty array', () => {
      const result = computeArrayConsensus(undefined, ['T123', 'T456'], ['T123', 'T789'])
      expect(result).toEqual(['T123'])
    })

    it('returns null when all inputs are null', () => {
      const result = computeArrayConsensus(null, null, null)
      expect(result).toBeNull()
    })

    it('returns null when all inputs are undefined', () => {
      const result = computeArrayConsensus(undefined, undefined, undefined)
      expect(result).toBeNull()
    })

    it('returns null when all inputs are empty', () => {
      const result = computeArrayConsensus([], [], [])
      expect(result).toBeNull()
    })

    it('returns null when inputs are mix of null, undefined, and empty', () => {
      const result = computeArrayConsensus(null, undefined, [])
      expect(result).toBeNull()
    })

    it('handles mix of null and non-empty arrays', () => {
      const result = computeArrayConsensus(null, ['T123'], ['T123'])
      expect(result).toEqual(['T123'])
    })

    it('handles mix of undefined and non-empty arrays', () => {
      const result = computeArrayConsensus(undefined, ['T123', 'T456'], ['T456'])
      expect(result).toEqual(['T456'])
    })
  })

  describe('empty array handling', () => {
    it('handles one empty array with two non-empty', () => {
      const result = computeArrayConsensus([], ['T123', 'T456'], ['T123'])
      expect(result).toEqual(['T123'])
    })

    it('handles two empty arrays with one non-empty', () => {
      const result = computeArrayConsensus([], [], ['T123'])
      expect(result).toBeNull()
    })

    it('filters out empty strings from arrays', () => {
      const result = computeArrayConsensus(['T123', '', 'T456'], ['T123', ''], ['T456', ''])
      expect(result).toHaveLength(2)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
      expect(result).not.toContain('')
    })
  })

  describe('edge cases', () => {
    it('handles single-element arrays', () => {
      const result = computeArrayConsensus(['T123'], ['T123'], ['T123'])
      expect(result).toEqual(['T123'])
    })

    it('handles arrays with many elements', () => {
      const arr1 = ['T1', 'T2', 'T3', 'T4', 'T5']
      const arr2 = ['T2', 'T3', 'T4', 'T6', 'T7']
      const arr3 = ['T3', 'T4', 'T5', 'T8', 'T9']
      const result = computeArrayConsensus(arr1, arr2, arr3)
      // T3 in all 3, T4 in all 3, T2 in 2, T5 in 2
      expect(result).toHaveLength(4)
      expect(result).toContain('T3')
      expect(result).toContain('T4')
      expect(result).toContain('T2')
      expect(result).toContain('T5')
    })

    it('handles identical arrays', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T123', 'T456'], ['T123', 'T456'])
      expect(result).toHaveLength(2)
      expect(result).toContain('T123')
      expect(result).toContain('T456')
    })

    it('handles arrays where only one pair matches', () => {
      const result = computeArrayConsensus(['T123', 'T456'], ['T123', 'T789'], ['T999', 'T111'])
      expect(result).toEqual(['T123'])
    })

    it('handles complex overlap patterns', () => {
      const result = computeArrayConsensus(
        ['A', 'B', 'C', 'D'],
        ['B', 'C', 'E', 'F'],
        ['C', 'D', 'F', 'G']
      )
      // C in all 3, B in 2, D in 2, F in 2
      expect(result).toHaveLength(4)
      expect(result).toContain('C')
      expect(result).toContain('B')
      expect(result).toContain('D')
      expect(result).toContain('F')
    })
  })

  describe('real-world task ID patterns', () => {
    it('handles typical task ID consensus', () => {
      const result = computeArrayConsensus(
        ['TASK-123', 'TASK-456'],
        ['TASK-123', 'TASK-789'],
        ['TASK-123', 'TASK-999']
      )
      expect(result).toEqual(['TASK-123'])
    })

    it('handles UUID-style task IDs', () => {
      const uuid1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const uuid2 = 'f9e8d7c6-b5a4-3210-fedc-ba0987654321'
      const result = computeArrayConsensus([uuid1, uuid2], [uuid1], [uuid1, 'other-id'])
      expect(result).toEqual([uuid1])
    })

    it('handles numeric string task IDs', () => {
      const result = computeArrayConsensus(['123', '456', '789'], ['123', '456'], ['456', '999'])
      expect(result).toHaveLength(2)
      expect(result).toContain('123')
      expect(result).toContain('456')
    })
  })
})
