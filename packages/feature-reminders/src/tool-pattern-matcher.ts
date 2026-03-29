/**
 * Anchored token subsequence matching for verification tool patterns.
 *
 * Splits commands on shell operators, then matches pattern tokens as a
 * subsequence of command tokens with the first token anchored (must match
 * exactly at position 0). Wildcard `*` matches any single token.
 *
 * When a known command runner prefix is detected (e.g., `uv run`, `npx`),
 * switches to unanchored subsequence matching — same algorithm without the
 * first-token anchor — so `uv run mypy` matches pattern `mypy`.
 *
 * @see docs/superpowers/specs/2026-03-29-command-runner-aware-pattern-matching-design.md
 */

import type { ToolPattern, CommandRunner } from './types.js'

/** Split a command string into segments on shell operators */
const SHELL_OPERATOR_RE = /\s*(?:&&|\|\||[;|])\s*/

/**
 * Detect if a segment starts with a known command runner prefix.
 * Uses token-level comparison: splits both segment and prefix into tokens
 * and checks that the first N segment tokens exactly equal the prefix tokens.
 * Returns the number of prefix tokens matched, or 0 if no runner matches.
 * When multiple runners match, the longest (most tokens) wins.
 */
export function detectRunnerPrefix(segmentTokens: string[], runners: CommandRunner[]): number {
  let longestMatch = 0

  for (const runner of runners) {
    const prefixTokens = runner.prefix.trim().split(/\s+/)
    if (prefixTokens.length === 0) continue
    if (prefixTokens.length > segmentTokens.length) continue

    let matches = true
    for (let i = 0; i < prefixTokens.length; i++) {
      if (segmentTokens[i] !== prefixTokens[i]) {
        matches = false
        break
      }
    }

    if (matches && prefixTokens.length > longestMatch) {
      longestMatch = prefixTokens.length
    }
  }

  return longestMatch
}

/**
 * Test whether a shell command matches a tool pattern string.
 *
 * Without runners (or when no runner prefix matches): first token is anchored;
 * remaining tokens match as subsequence. `*` in the pattern matches any single
 * command token.
 *
 * With runners: when a segment starts with a known runner prefix, switches to
 * unanchored subsequence matching (scans for first pattern token from any position).
 */
export function matchesToolPattern(command: string, pattern: string, runners?: CommandRunner[]): boolean {
  if (!command || !pattern) return false

  const segments = command.split(SHELL_OPERATOR_RE)
  const patternTokens = pattern.trim().split(/\s+/).filter(Boolean)
  if (patternTokens.length === 0) return false

  const activeRunners = runners?.length ? runners : undefined

  return segments.some((segment) => {
    const cmdTokens = segment.trim().split(/\s+/)
    if (cmdTokens.length === 0 || cmdTokens[0] === '') return false

    const runnerTokenCount = activeRunners ? detectRunnerPrefix(cmdTokens, activeRunners) : 0

    if (runnerTokenCount > 0) {
      // Unanchored subsequence match — scan for first pattern token from any position
      let pi = 0
      for (let ci = runnerTokenCount; ci < cmdTokens.length && pi < patternTokens.length; ci++) {
        if (patternTokens[pi] === '*' || patternTokens[pi] === cmdTokens[ci]) {
          pi++
        }
      }
      return pi === patternTokens.length
    }

    // Anchored: first token must match exactly
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
export function findMatchingPattern(
  command: string,
  patterns: ToolPattern[],
  runners?: CommandRunner[]
): ToolPattern | null {
  for (const pattern of patterns) {
    if (pattern.tool === null) continue
    if (matchesToolPattern(command, pattern.tool, runners)) return pattern
  }
  return null
}
