/**
 * Truncation strategies for statusline token values.
 *
 * All strategies measure visible width (ANSI codes excluded).
 */

import { stripAnsi, visibleLength } from './ansi-utils.js'

/**
 * Right-truncate with trailing ellipsis.
 * "claude-code-sidekick" → "claude-code-si…" (maxLength=15)
 */
export function truncateSuffix(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str
  // For ANSI strings, strip first, truncate, add ellipsis
  const plain = stripAnsi(str)
  if (maxLength <= 1) return '…'
  return plain.slice(0, maxLength - 1) + '…'
}

/**
 * Left-truncate with leading ellipsis.
 * "claude-code-sidekick" → "…ode-sidekick" (maxLength=15)
 */
export function truncatePrefix(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str
  const plain = stripAnsi(str)
  if (maxLength <= 1) return '…'
  return '…' + plain.slice(-(maxLength - 1))
}

/**
 * Path-aware truncation:
 * 1. If fits, return as-is
 * 2. Two segments: left-truncate until it fits
 * 3. 3+ segments: first/…/last, left-truncate first if still too long
 */
export function truncatePath(str: string, maxLength: number): string {
  const plain = stripAnsi(str)
  if (plain.length <= maxLength) return str

  const parts = plain.split('/')

  // Single segment — fall back to prefix truncation
  if (parts.length === 1) {
    return truncatePrefix(plain, maxLength)
  }

  // Two segments — left-truncate the combined string
  if (parts.length === 2) {
    return truncatePrefix(plain, maxLength)
  }

  // 3+ segments: first/…/last
  const first = parts[0]
  const last = parts[parts.length - 1]
  const candidate = `${first}/…/${last}`

  if (candidate.length <= maxLength) {
    return candidate
  }

  // Left-truncate the first segment to fit
  // Format: …<truncated-first>/…/<last>
  // We need: ellipsis + partial-first + "/…/" + last <= maxLength
  const fixedPart = `/…/${last}`
  const availableForFirst = maxLength - fixedPart.length
  if (availableForFirst <= 1) {
    // Not enough room for first segment — just prefix-truncate the whole thing
    return truncatePrefix(plain, maxLength)
  }
  const truncatedFirst = truncatePrefix(first, availableForFirst)
  return `${truncatedFirst}${fixedPart}`
}
