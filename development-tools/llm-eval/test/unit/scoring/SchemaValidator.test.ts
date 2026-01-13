/**
 * Tests for SchemaValidator
 */

import { describe, it, expect } from 'vitest'
import {
  validateSchema,
  validateSchemaStrict,
} from '../../../src/benchmark/scoring/SchemaValidator'

describe('SchemaValidator', () => {
  describe('validateSchema', () => {
    it('should score valid output as 100 points', () => {
      const validOutput = {
        task_ids: 'TASK-123',
        initial_goal: 'Fix authentication bug',
        current_objective: 'Debug login flow',
        clarity_score: 8,
        confidence: 0.9,
        high_clarity_snarky_comment: 'Another day, another auth bug',
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(validOutput)

      expect(result.score).toBe(100)
      expect(result.errors).toEqual([])
    })

    it('should score valid JSON string as 100 points', () => {
      const validOutput = JSON.stringify({
        task_ids: null,
        initial_goal: 'Implement feature',
        current_objective: 'Write tests',
        clarity_score: 10,
        confidence: 1.0,
        high_clarity_snarky_comment: 'Crystal clear!',
        low_clarity_snarky_comment: null,
        significant_change: true,
      })

      const result = validateSchema(validOutput)

      expect(result.score).toBe(100)
      expect(result.errors).toEqual([])
    })

    it('should return 0 points for invalid JSON', () => {
      const result = validateSchema('{ invalid json }')

      expect(result.score).toBe(0)
      expect(result.errors).toContain('Invalid JSON')
    })

    it('should return 45 points for empty object (JSON + partial type score)', () => {
      const result = validateSchema({})

      // 30 (JSON) + 0 (fields) + 15 (3 nullable fields don't fail type check) = 45
      expect(result.score).toBe(45)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors).toContain('Missing field: task_ids')
    })

    it('should score proportionally for partial field presence', () => {
      const partialOutput = {
        task_ids: 'TASK-123',
        initial_goal: 'Fix bug',
        clarity_score: 5,
        confidence: 0.8,
      }

      const result = validateSchema(partialOutput)

      // 30 (JSON) + 15 (4/8 fields = 50% of 30) + X (type validation)
      expect(result.score).toBeGreaterThanOrEqual(45)
      expect(result.errors).toContain('Missing field: current_objective')
      expect(result.errors).toContain('Missing field: significant_change')
    })

    it('should deduct 5 points for clarity_score out of range', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 15, // Invalid: must be 1-10
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('clarity_score out of range [1-10]: 15')
    })

    it('should deduct 5 points for clarity_score not an integer', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5.5, // Invalid: must be integer
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('clarity_score not an integer: 5.5')
    })

    it('should deduct 5 points for confidence out of range', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 1.5, // Invalid: must be 0.0-1.0
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('confidence out of range [0.0-1.0]: 1.5')
    })

    it('should deduct 5 points for significant_change wrong type', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: 'yes', // Invalid: must be boolean
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('significant_change not a boolean: yes')
    })

    it('should deduct 5 points for initial_goal exceeding maxLength', () => {
      const output = {
        task_ids: null,
        initial_goal: 'A'.repeat(61), // Invalid: maxLength 60
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('initial_goal exceeds maxLength 60: 61 chars')
    })

    it('should deduct 5 points for current_objective exceeding maxLength', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'B'.repeat(61), // Invalid: maxLength 60
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('current_objective exceeds maxLength 60: 61 chars')
    })

    it('should deduct 5 points for task_ids wrong type', () => {
      const output = {
        task_ids: 123, // Invalid: must be string or null
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('task_ids wrong type (expected string or null): number')
    })

    it('should deduct 5 points for snarky comment exceeding maxLength', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 8,
        confidence: 0.5,
        high_clarity_snarky_comment: 'C'.repeat(121), // Invalid: maxLength 120
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain(
        'high_clarity_snarky_comment exceeds maxLength 120: 121 chars'
      )
    })

    it('should deduct 5 points for snarky comment wrong type', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 8,
        confidence: 0.5,
        high_clarity_snarky_comment: 123, // Invalid: must be string or null
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(95) // 100 - 5
      expect(result.errors).toContain('high_clarity_snarky_comment wrong type: number')
    })

    it('should accumulate multiple errors', () => {
      const output = {
        task_ids: 123, // Wrong type
        initial_goal: 'A'.repeat(61), // Too long
        current_objective: 'Test',
        clarity_score: 15, // Out of range
        confidence: 1.5, // Out of range
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: 'maybe', // Wrong type
      }

      const result = validateSchema(output)

      // 30 (JSON) + 30 (all fields) + 40 - (5 errors × 5) = 60 - 25 = 35
      expect(result.score).toBe(75) // 100 - 25
      expect(result.errors.length).toBe(5)
    })

    it('should accept null for task_ids and snarky comments', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      expect(result.score).toBe(100)
      expect(result.errors).toEqual([])
    })

    it('should handle missing vs null correctly', () => {
      const output = {
        // task_ids missing (not null)
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 5,
        confidence: 0.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchema(output)

      // Missing field affects field presence score, not type score
      expect(result.score).toBeLessThan(100)
      expect(result.errors).toContain('Missing field: task_ids')
      // Should NOT have type error for task_ids since it's missing, not wrong type
      expect(result.errors).not.toContain('task_ids wrong type')
    })

    it('should reject array as top-level value', () => {
      const result = validateSchema([{ foo: 'bar' }])

      expect(result.score).toBe(30) // JSON valid but wrong type
      expect(result.errors).toContain('Output must be a JSON object')
    })

    it('should reject null as top-level value', () => {
      const result = validateSchema(null)

      expect(result.score).toBe(30) // JSON valid but wrong type
      expect(result.errors).toContain('Output must be a JSON object')
    })
  })

  describe('validateSchemaStrict', () => {
    it('should pass valid output', () => {
      const validOutput = {
        task_ids: 'TASK-123',
        initial_goal: 'Fix authentication bug',
        current_objective: 'Debug login flow',
        clarity_score: 8,
        confidence: 0.9,
        high_clarity_snarky_comment: 'Another day, another auth bug',
        low_clarity_snarky_comment: null,
        significant_change: false,
      }

      const result = validateSchemaStrict(validOutput)

      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.data).toEqual(validOutput)
    })

    it('should fail invalid JSON', () => {
      const result = validateSchemaStrict('{ invalid json }')

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Invalid JSON')
    })

    it('should fail with detailed Zod errors', () => {
      const output = {
        task_ids: 123,
        initial_goal: 'Test',
        current_objective: 'Test',
        clarity_score: 15,
        confidence: 1.5,
        high_clarity_snarky_comment: null,
        low_clarity_snarky_comment: null,
        significant_change: 'maybe',
      }

      const result = validateSchemaStrict(output)

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should fail for missing required fields', () => {
      const output = {
        task_ids: null,
        initial_goal: 'Test',
        // Missing other required fields
      }

      const result = validateSchemaStrict(output)

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })
})
