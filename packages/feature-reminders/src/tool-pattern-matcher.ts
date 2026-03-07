/**
 * Anchored token subsequence matching for verification tool patterns.
 *
 * Splits commands on shell operators, then matches pattern tokens as a
 * subsequence of command tokens with the first token anchored (must match
 * exactly at position 0). Wildcard `*` matches any single token.
 *
 * @see docs/plans/2026-03-07-structured-vc-tool-patterns-design.md
 */

import type { ToolPattern } from './types.js'

/** Split a command string into segments on shell operators */
const SHELL_OPERATOR_RE = /\s*(?:&&|\|\||[;|])\s*/

/**
 * Test whether a shell command matches a tool pattern string.
 * First token is anchored; remaining tokens match as subsequence.
 * `*` in the pattern matches any single command token.
 */
export function matchesToolPattern(command: string, pattern: string): boolean {
  if (!command || !pattern) return false

  const segments = command.split(SHELL_OPERATOR_RE)
  const patternTokens = pattern.split(/\s+/)
  if (patternTokens.length === 0) return false

  return segments.some((segment) => {
    const cmdTokens = segment.trim().split(/\s+/)
    if (cmdTokens.length === 0 || cmdTokens[0] === '') return false

    // First token must match exactly (anchored to command start)
    if (cmdTokens[0] !== patternTokens[0]) return false

    // Remaining pattern tokens: subsequence match
    let pi = 1
    for (let ci = 1; ci < cmdTokens.length && pi < patternTokens.length; ci++) {
      if (patternTokens[pi] === '*' || patternTokens[pi] === cmdTokens[ci]) {
        pi++
      }
    }
    return pi === patternTokens.length
  })
}

/**
 * Find the first matching ToolPattern for a command.
 * Skips disabled patterns (tool: null). Returns null if no match.
 */
export function findMatchingPattern(command: string, patterns: ToolPattern[]): ToolPattern | null {
  for (const pattern of patterns) {
    if (pattern.tool === null) continue
    if (matchesToolPattern(command, pattern.tool)) return pattern
  }
  return null
}
