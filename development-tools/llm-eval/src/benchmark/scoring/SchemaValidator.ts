/**
 * Schema validation for topic extraction outputs
 *
 * Validates JSON structure, required fields, and type/range constraints.
 * Scoring breakdown:
 * - Valid JSON structure: 30 points
 * - Required fields present: 30 points (proportional)
 * - Type/range validation: 40 points (8 checks × 5 points each)
 */

import { TopicAnalysisSchema } from './schemas'
import type { SchemaValidationResult } from './types'

/**
 * Required fields in topic analysis output
 */
const REQUIRED_FIELDS = [
  'task_ids',
  'initial_goal',
  'current_objective',
  'clarity_score',
  'confidence',
  'high_clarity_snarky_comment',
  'low_clarity_snarky_comment',
  'significant_change',
] as const

/**
 * Validates topic extraction output against schema
 *
 * @param output - JSON string or parsed object to validate
 * @returns Validation result with score (0-100) and errors
 */
export function validateSchema(output: unknown): SchemaValidationResult {
  const errors: string[] = []
  let score = 0

  // Parse JSON if string (30 pts)
  let parsed: unknown
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output)
      score += 30
    } catch {
      errors.push('Invalid JSON')
      return { score: 0, errors }
    }
  } else {
    parsed = output
    score += 30
  }

  // Check if parsed is an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push('Output must be a JSON object')
    return { score, errors }
  }

  // Required fields present (30 pts, proportional)
  let presentCount = 0
  for (const field of REQUIRED_FIELDS) {
    if (field in parsed) {
      presentCount++
    } else {
      errors.push(`Missing field: ${field}`)
    }
  }

  score += Math.floor((presentCount * 30) / REQUIRED_FIELDS.length)

  // Type and range validation (40 pts total, 5 pts per check, 8 checks)
  let typeErrors = 0

  const obj = parsed as Record<string, unknown>

  // Check clarity_score is int 1-10 (5 pts)
  const clarity = obj['clarity_score']
  if (clarity === undefined || clarity === null) {
    errors.push('clarity_score missing')
    typeErrors++
  } else if (typeof clarity !== 'number') {
    errors.push(`clarity_score not an integer: ${String(clarity)}`)
    typeErrors++
  } else if (!Number.isInteger(clarity)) {
    errors.push(`clarity_score not an integer: ${String(clarity)}`)
    typeErrors++
  } else if (clarity < 1 || clarity > 10) {
    errors.push(`clarity_score out of range [1-10]: ${clarity}`)
    typeErrors++
  }

  // Check confidence is float 0.0-1.0 (5 pts)
  const confidence = obj['confidence']
  if (confidence === undefined || confidence === null) {
    errors.push('confidence missing')
    typeErrors++
  } else if (typeof confidence !== 'number') {
    errors.push(`confidence not a number: ${String(confidence)}`)
    typeErrors++
  } else if (confidence < 0.0 || confidence > 1.0) {
    errors.push(`confidence out of range [0.0-1.0]: ${confidence}`)
    typeErrors++
  }

  // Check significant_change is boolean (5 pts)
  const sigChange = obj['significant_change']
  if (sigChange === undefined || sigChange === null) {
    errors.push('significant_change missing')
    typeErrors++
  } else if (typeof sigChange !== 'boolean') {
    errors.push(`significant_change not a boolean: ${String(sigChange)}`)
    typeErrors++
  }

  // Check initial_goal is string with maxLength 60 (5 pts)
  const initialGoal = obj['initial_goal']
  if (initialGoal === undefined || initialGoal === null) {
    errors.push('initial_goal missing')
    typeErrors++
  } else if (typeof initialGoal !== 'string') {
    errors.push(`initial_goal not a string: ${String(initialGoal)}`)
    typeErrors++
  } else if (initialGoal.length > 60) {
    errors.push(`initial_goal exceeds maxLength 60: ${initialGoal.length} chars`)
    typeErrors++
  }

  // Check current_objective is string with maxLength 60 (5 pts)
  const currentObj = obj['current_objective']
  if (currentObj === undefined || currentObj === null) {
    errors.push('current_objective missing')
    typeErrors++
  } else if (typeof currentObj !== 'string') {
    errors.push(`current_objective not a string: ${String(currentObj)}`)
    typeErrors++
  } else if (currentObj.length > 60) {
    errors.push(`current_objective exceeds maxLength 60: ${currentObj.length} chars`)
    typeErrors++
  }

  // Check task_ids is string or null (5 pts)
  const taskIds = obj['task_ids']
  if (taskIds !== null && taskIds !== undefined && typeof taskIds !== 'string') {
    errors.push(`task_ids wrong type (expected string or null): ${typeof taskIds}`)
    typeErrors++
  }

  // Check snarky comments are strings or null with maxLength 120 (2 × 5 pts = 10 pts)
  for (const field of ['high_clarity_snarky_comment', 'low_clarity_snarky_comment'] as const) {
    const comment = obj[field]
    if (comment !== null && comment !== undefined && typeof comment !== 'string') {
      errors.push(`${field} wrong type: ${typeof comment}`)
      typeErrors++
    } else if (typeof comment === 'string' && comment.length > 120) {
      errors.push(`${field} exceeds maxLength 120: ${comment.length} chars`)
      typeErrors++
    }
  }

  // Calculate type score (40 pts max, 5 pts per check, 8 checks total)
  score += 40 - typeErrors * 5

  return { score, errors }
}

/**
 * Validates topic extraction output using Zod schema (strict validation)
 *
 * This is an alternative to validateSchema that uses Zod's built-in validation.
 * Use this when you need strict type checking without partial scoring.
 *
 * @param output - JSON string or parsed object to validate
 * @returns Validation result with pass/fail and detailed errors
 */
export function validateSchemaStrict(output: unknown): {
  success: boolean
  data?: unknown
  errors: string[]
} {
  let parsed: unknown

  // Parse JSON if string
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output)
    } catch (error) {
      return {
        success: false,
        errors: ['Invalid JSON'],
      }
    }
  } else {
    parsed = output
  }

  // Validate with Zod
  const result = TopicAnalysisSchema.safeParse(parsed)

  if (result.success) {
    return {
      success: true,
      data: result.data,
      errors: [],
    }
  }

  // Extract error messages
  const errors = result.error.errors.map((err) => {
    const path = err.path.join('.')
    return `${path}: ${err.message}`
  })

  return {
    success: false,
    errors,
  }
}
